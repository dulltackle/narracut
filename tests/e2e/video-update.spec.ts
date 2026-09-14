import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createProjectVNext, openProjectVNext } from '../../src/server/project-lifecycle';
import { createNarracutRequestHandler } from '../../plugins/narracut/src/server';
import { populatePortableProject } from '../helpers/portable-project';
import { installAppToolBridge } from '../helpers/workbench-fixture';

test('真实项目：仅同步、完整视频、独立输出、重开后撤回，保留表格与内部成果', async ({ page }) => {
  test.setTimeout(600000);
  page.setDefaultTimeout(15000);
  const root = await mkdtemp(join(tmpdir(), 'video-update-page-'));
  const directory = join(root, 'project'); await createProjectVNext(directory);
  const fixture = await populatePortableProject(directory);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async input => { const bytes = fixture.urls.get(String(input)); if (!bytes) throw new Error(`未声明的网络请求 ${input}`); return new Response(new Uint8Array(bytes)); };
  let opened = await openProjectVNext(directory);
  const candidate = await opened.candidate({ action: 'create' });
  const prepared = await opened.candidate({ action: 'dependencies', baseline: candidate.baseline, dependencies: {}, packages: [] });
  // 兼容夹具：已有接受修订。以下新同步的构建、采帧、发布及输出均走生产工具。
  await opened.programTransaction(manager => manager.accept({ baseline: prepared.baseline, summary: '存量设计', source: 'candidate', acceptance: {} }, async () => {}));
  await opened.candidate({ action: 'create' });
  await opened.release();
  const handler = createNarracutRequestHandler({ conversation: { threadId: 'video-update-122' } });
  const projectId = JSON.parse(await readFile(join(directory, 'narracut.json'), 'utf8')).projectId;
  let loseUndoReceipt = false, loseStatus = false;
  const raw = async (name: string, args: any = {}) => { if (loseStatus && name === 'project_video_update' && args.action === 'status') throw new Error('查询暂时失败'); const result: any = await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { projectDirectory: directory, projectId, ...args } } }); if (loseUndoReceipt && name === 'project_video_update' && args.action === 'undo') { loseUndoReceipt = false; return { isError: true, structuredContent: { error: { code: 'RESPONSE_LOST', message: '撤回回执丢失' } } }; } return result; };
  const call = async (name: string, args: any = {}) => { const result = await raw(name, args); expect(result.isError, JSON.stringify(result)).not.toBe(true); return result.structuredContent; };
  const resource: any = await handler({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } });
  const server = createServer((_req, res) => res.end(resource.contents[0].text));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`); await installAppToolBridge(page, raw);
    const load = async () => page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), await call('open_project'));
    await load(); await page.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(page.getByRole('button', { name: '仅同步表格内容', exact: true })).toBeEnabled({ timeout: 15000 });
    const beforeDsl = await readFile(join(directory, 'project.json'));
    const beforeCandidate = await call('manage_project_candidate', { action: 'read' });
    await page.getByRole('button', { name: '仅同步表格内容', exact: true }).click();
    await expect(page.locator('[data-preview-screen]')).toBeHidden();
    await expect(page.locator('[data-update-state]')).toContainText('视频已同步', { timeout: 300000 });
    await expect(page.locator('[data-preview-screen]')).toBeVisible();
    await expect(page.getByRole('button', { name: '审阅并接受', exact: true })).toHaveCount(0);
    await mkdir('docs/acceptance/issue122', { recursive: true });
    for (const viewport of [{ width: 902, height: 667 }, { width: 960, height: 640 }, { width: 1200, height: 720 }, { width: 430, height: 860 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.NARRACUT_CAPTURE_OUTPUT) await page.screenshot({ path: `docs/acceptance/issue122/synced-${viewport.width}.png`, fullPage: true });
    }
    const state = await call('project_video_update', { action: 'status' });
    expect(state.undo.kind).toBe('sync');
    expect(state.revision.acceptance.gates).toContainEqual({ operation: 'publish', status: 'available' });
    expect(await readFile(join(directory, 'project.json'))).toEqual(beforeDsl);
    expect(await call('manage_project_candidate', { action: 'read' })).toEqual(beforeCandidate);
    loseStatus = true;
    await expect(page.locator('[data-update-state]')).toContainText('查询暂时失败', { timeout: 15000 });
    await expect(page.locator('[data-preview-screen]')).toBeHidden();
    loseStatus = false;
    await expect(page.locator('[data-preview-screen]')).toBeVisible({ timeout: 15000 });
    const render = await call('project_render', { action: 'status' }); expect(render.source.ready, JSON.stringify(render)).toBe(true);
    await page.evaluate(path => { (window as any).openai.selectDirectory = async () => ({ path }); }, root);
    await page.getByRole('button', { name: '输出视频', exact: true }).click();
    await page.getByRole('button', { name: '选择输出文件夹', exact: true }).click();
    await page.getByRole('button', { name: '开始输出', exact: true }).click();
    await expect(page.getByRole('button', { name: '复制输出路径', exact: true })).toBeVisible({ timeout: 300000 });
    const rendered = await call('project_render', { action: 'status' }); expect(rendered.jobs[0].status).toBe('succeeded');
    expect((await readFile(rendered.jobs[0].outputPath)).length).toBeGreaterThan(1000);

    // 第二次取消不消耗第一次撤回；编辑使旧视频立即不可见。
    await page.getByRole('button', { name: '仅同步表格内容', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消同步', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消同步', exact: true }).click();
    await expect.poll(async () => (await call('project_video_update', { action: 'status' })).job.status, { timeout: 60000 }).toBe('cancelled');
    expect((await call('project_video_update', { action: 'status' })).undo.requestId).toBe(state.undo.requestId);

    await page.getByRole('tab', { name: '表格工作区' }).click();
    await page.getByRole('group', { name: 'Scene 01 行', exact: true }).getByRole('button', { name: '编辑 Narration' }).click();
    await page.getByRole('textbox', { name: 'Scene 01 Narration' }).fill('新内容不自动修改独立画面标题');
    await page.getByRole('textbox', { name: 'Scene 01 Narration' }).blur();
    await expect.poll(async () => (await call('get_workbench')).scenes[0].narration).toBe('新内容不自动修改独立画面标题');
    await page.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(page.locator('[data-preview-screen]')).toBeHidden();
    await expect(page.getByRole('button', { name: '仅同步表格内容', exact: true })).toBeEnabled({ timeout: 15000 });
    await page.getByRole('button', { name: '仅同步表格内容', exact: true }).click();
    await expect(page.locator('[data-update-state]')).toContainText('视频已同步', { timeout: 300000 });
    await expect(page.locator('[data-update-warnings]')).toContainText('本句无声');
    expect((await call('project_render', { action: 'status' })).source.ready).toBe(false);

    const latestDsl = await readFile(join(directory, 'project.json'));
    await call('close_project'); await load();
    await page.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(page.getByRole('button', { name: '撤回上次同步', exact: true })).toBeEnabled();
    loseUndoReceipt = true;
    await page.getByRole('button', { name: '撤回上次同步', exact: true }).click();
    await expect(page.getByRole('button', { name: '撤回上次同步', exact: true })).toBeHidden();
    await expect(page.locator('[data-preview-screen]')).toBeHidden();
    expect((await call('project_video_update', { action: 'status' })).undo).toBeNull();
    expect(await readFile(join(directory, 'project.json'))).toEqual(latestDsl);
  } finally { await page.close(); await handler.dispose(); globalThis.fetch = oldFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

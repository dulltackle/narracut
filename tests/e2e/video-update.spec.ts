import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createProjectVNext, openProjectVNext } from '../../src/server/project-lifecycle';
import { createNarracutRequestHandler } from '../../plugins/narracut/src/server';
import { populatePortableProject } from '../helpers/portable-project';
import { installAppToolBridge } from '../helpers/workbench-fixture';

for (const adjusted of [false, true]) test(`真实项目：${adjusted ? '画面调整恢复最新内容' : '首次生成撤回无设计'}，同步、重开与回执核对`, async ({ page }) => {
  test.setTimeout(600000);
  page.setDefaultTimeout(15000);
  const root = await mkdtemp(join(tmpdir(), 'video-update-page-'));
  let directory = join(root, 'project'); await createProjectVNext(directory);
  const fixture = await populatePortableProject(directory);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async input => { const bytes = fixture.urls.get(String(input)); if (!bytes) throw new Error(`未声明的网络请求 ${input}`); return new Response(new Uint8Array(bytes)); };
  let opened = await openProjectVNext(directory);
  const candidate = await opened.candidate({ action: 'create' });
  const prepared = await opened.candidate({ action: 'dependencies', baseline: candidate.baseline, dependencies: {}, packages: [] });
  // 真实 Agent 入口由 #123 验证；这里通过生产发布事务构造已完成创作。
  const first = await opened.programTransaction(async manager => manager.publishUpdate({ requestId: randomUUID(), kind: 'generate', revisionId: (await manager.updateState()).revisionId, summary: '首次画面', acceptance: {} }, 'candidate', async () => {}));
  if (adjusted) {
    await opened.candidate({ action: 'apply', baseline: prepared.baseline, changes: [{ path: 'resources/palette.json', content: '["#543926","#674837","#724223"]' }] });
    await opened.programTransaction(async manager => manager.publishUpdate({ requestId: randomUUID(), kind: 'adjust', revisionId: (await manager.updateState()).revisionId, summary: '调整后的画面', acceptance: {} }, 'candidate', async () => {}));
  }
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
    await mkdir('docs/acceptance/issue128', { recursive: true });
    for (const viewport of [{ width: 902, height: 667 }, { width: 960, height: 640 }, { width: 1200, height: 720 }, { width: 430, height: 860 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.NARRACUT_CAPTURE_OUTPUT) await page.screenshot({ path: `docs/acceptance/issue128/synced-${adjusted ? 'adjust' : 'generate'}-${viewport.width}.png`, fullPage: true });
    }
    const state = await call('project_video_update', { action: 'status' });
    expect(state.undo.kind).toBe(adjusted ? 'adjust' : 'generate');
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
    await page.getByRole('button', { name: '关闭项目', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Agent 工作区' })).toBeHidden({ timeout: 60000 });
    await rename(directory, join(root, 'moved')); directory = join(root, 'moved'); await load();
    await page.getByRole('tab', { name: 'Agent 工作区' }).click();
    const undoName = adjusted ? '撤回上次画面调整' : '撤回首次生成';
    await expect(page.getByRole('button', { name: undoName, exact: true })).toBeEnabled({ timeout: 60000 });
    await page.getByRole('button', { name: undoName, exact: true }).click();
    await expect(page.locator('[data-update-confirm-cancel]')).toBeFocused();
    await page.locator('[data-update-confirm-cancel]').press('Enter');
    await expect(page.getByRole('button', { name: undoName, exact: true })).toBeFocused();
    await page.getByRole('button', { name: undoName, exact: true }).press('Enter');
    for (const viewport of [{ width: 902, height: 667 }, { width: 960, height: 640 }, { width: 1200, height: 720 }, { width: 430, height: 860 }]) {
      await page.setViewportSize(viewport);
      await page.locator('[data-update-confirmation]').scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const selector of ['[data-update-confirm]', '[data-update-confirm-cancel]', '[data-update-start]']) expect((await page.locator(selector).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if (process.env.NARRACUT_CAPTURE_OUTPUT) await page.screenshot({ path: `docs/acceptance/issue128/confirm-${adjusted ? 'adjust' : 'generate'}-${viewport.width}.png`, fullPage: true });
    }
    loseUndoReceipt = true;
    await page.getByRole('button', { name: '确认撤回', exact: true }).click();
    await expect(page.getByRole('button', { name: undoName, exact: true })).toBeHidden();
    await expect(page.locator('[data-preview-screen]')).toBeHidden();
    expect((await call('project_video_update', { action: 'status' })).undo).toBeNull();
    if (adjusted) {
      await expect.poll(async () => (await call('project_video_update', { action: 'status' })).job.stage, { timeout: 120000, intervals: [100] }).toContain('正在构建');
      // 外部输入变化落在恢复提交之后、同步发布之前，真实生产检查必须拒绝旧证据。
      await writeFile(join(directory, 'video.md'), '# 最新创作说明\n\n同步期间外部保存的内容。\n');
      await expect(page.locator('[data-update-state]')).toContainText('画面设计已恢复，但最新内容同步失败', { timeout: 300000 });
      await expect(page.locator('[data-preview-screen]')).toBeHidden();
      const failedRestore = await call('project_video_update', { action: 'status' });
      expect(failedRestore.revisionId).toBe(first.revision.revisionId);
      expect(failedRestore.undo).toBeNull();
      if (process.env.NARRACUT_CAPTURE_OUTPUT) await page.screenshot({ path: 'docs/acceptance/issue128/restored-sync-failed.png', fullPage: true });
      await page.getByRole('button', { name: '重试同步', exact: true }).click();
      await page.getByRole('button', { name: '取消同步', exact: true }).click();
      await expect(page.locator('[data-update-state]')).toContainText('内容同步已取消', { timeout: 60000 });
      await expect(page.locator('[data-preview-screen]')).toBeHidden();
      await page.getByRole('button', { name: '重试同步', exact: true }).click();
      await expect(page.locator('[data-update-state]')).toContainText('视频已同步', { timeout: 300000 });
      await expect(page.locator('[data-preview-screen]')).toBeVisible();
      const restored = await call('project_video_update', { action: 'status' });
      expect(restored.revision.programFingerprint).toBe(first.revision.programFingerprint);
      expect(restored.restoration.synced).toBe(true);
      expect(restored.revision.acceptance.warnings.join('；')).toContain('本句无声');
    } else {
      await expect(page.locator('[data-update-state]')).toContainText('尚无画面设计');
      expect((await call('project_video_update', { action: 'status' })).hasDesign).toBe(false);
    }
    expect(await readFile(join(directory, 'project.json'))).toEqual(latestDsl);
  } finally { await page.close(); await handler.dispose(); globalThis.fetch = oldFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

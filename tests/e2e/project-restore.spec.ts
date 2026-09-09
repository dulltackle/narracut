import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { handleRequest } from '../../plugins/narracut/src/server';
import { installAppToolBridge } from '../helpers/workbench-fixture';
let host: Server, origin: string;
test.beforeAll(async () => {
  const resource = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } }) as any;
  host = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(resource.contents[0].text); });
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${(host.address() as any).port}`;
});
test.afterAll(async () => { host?.closeAllConnections(); await new Promise<void>(resolve => host ? host.close(() => resolve()) : resolve()); });
for (const width of [1440, 390]) test(`启动台恢复冲突、确认与丢失响应核对 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await page.goto(origin);
  let starts = 0, polls = 0, result: string | undefined;
  const projectId = '10000000-0000-4000-8000-000000000001';
  const plan = { planId: 'sha256:test', projectId, sourcePath: '/来源/原项目', snapshotPath: '/恢复.narracut-recovery.json', rebuildManifest: true, dsl: { from: 'source', bytes: 25 }, program: { current: 'revision-one', history: ['revision-one'], candidate: null, checkpoint: null }, payloads: ['briefLocal', 'briefBase'], baseline: {} };
  await installAppToolBridge(page, (name, args) => {
    if (name === 'open_project') return { isError: true, structuredContent: { error: { message: '打开失败，租约正在使用' } } };
    if (name !== 'restore_project') return { structuredContent: {} };
    if (args.action === 'inspect') return { structuredContent: { projectId, sourceHint: '/旧位置/原项目', capturedAt: '2026-09-09T00:00:00Z', payloads: [{ component: 'briefLocal', bytes: 5 }, { component: 'briefBase', bytes: 4 }] } };
    if (args.action === 'plan') { result = args.briefResult; return { structuredContent: { ...plan, blockers: result === undefined ? [{ code: 'RECOVERY_BRIEF_RESOLUTION_REQUIRED', path: '/来源/原项目/video.md', message: '需要解决 Brief 冲突', next: '编辑完整结果' }] : [], brief: { base: 'BASE', local: 'LOCAL', disk: 'DISK', conflict: result === undefined, result, decision: result === undefined ? 'required' : 'resolved' } } }; }
    if (args.action === 'recover') { starts++; expect(args.briefResult).toBe('合并后的完整结果'); throw new Error('响应丢失'); }
    if (args.action === 'status' && ++polls <= 3) return { structuredContent: { status: 'running', phase: 'copying' } };
    if (args.action === 'status') return { structuredContent: { status: 'completed', result: { projectDirectory: '/新位置/恢复项目', projectId } } };
  });
  await page.evaluate(() => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { status: 'launcher' } } }, '*'));
  if (process.env.NARRACUT_CAPTURE_INCUMBENT === '1') await page.screenshot({ path: `/tmp/narracut-launcher-before-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: '从恢复快照创建', exact: true }).click({ timeout: 3000 });
  await page.getByLabel('恢复快照文件路径').fill('/恢复.narracut-recovery.json');
  await page.getByRole('button', { name: '检查快照', exact: true }).click();
  await expect(page.getByText(projectId, { exact: true }).first()).toBeVisible();
  await page.getByLabel('来源项目目录').fill('/来源/原项目');
  await page.getByRole('button', { name: '检查来源并生成计划' }).click();
  await page.getByRole('button', { name: '解决 Brief 冲突' }).click();
  await page.getByLabel('完整 Brief 结果').fill('合并后的完整结果');
  if (width === 390) await page.getByRole('tab', { name: '来源文件 DISK' }).click();
  await expect(page.getByLabel('完整 Brief 结果')).toHaveValue('合并后的完整结果');
  if (process.env.NARRACUT_CAPTURE_RESTORE === '1') await page.screenshot({ path: `/tmp/narracut-restore-brief-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: '采用此结果并返回恢复计划' }).click();
  await page.getByRole('button', { name: '核对新路径' }).click();
  await page.getByLabel('目标父目录').fill('/新位置'); await page.getByLabel('新文件夹名').fill('恢复项目');
  if (process.env.NARRACUT_CAPTURE_RESTORE === '1') await page.screenshot({ path: `/tmp/narracut-restore-confirm-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: '恢复到新文件夹', exact: true }).click();
  await expect(page.getByText('正在核对恢复结果', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '核对恢复结果', exact: true }).click();
  const cancel = page.getByRole('button', { name: '取消恢复', exact: true });
  await expect(cancel).toBeVisible(); await cancel.focus();
  const scrollTop = await page.locator('[data-restore-root]').evaluate(node => node.scrollTop);
  await expect.poll(() => polls).toBeGreaterThanOrEqual(2);
  await expect(cancel).toBeFocused();
  expect(await page.locator('[data-restore-root]').evaluate(node => node.scrollTop)).toBe(scrollTop);
  if (process.env.NARRACUT_CAPTURE_RESTORE === '1') await page.screenshot({ path: `/tmp/narracut-restore-progress-${width}.png`, fullPage: true });
  await expect(page.getByRole('heading', { name: '恢复已完成', exact: true })).toBeVisible(); expect(starts).toBe(1);
  await page.getByRole('button', { name: '打开恢复项目' }).click();
  await expect(page.getByRole('heading', { name: '恢复已完成', exact: true })).toBeVisible();
  await expect(page.getByText(/打开失败/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

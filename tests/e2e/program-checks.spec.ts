import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { handleRequest } from '../../plugins/narracut/src/server';
import { validResult, installAppToolBridge } from '../helpers/workbench-fixture';
import { CheckBatch, diagnostic, gateOperations, type CheckIdentity } from '../../src/shared/program-checks';
let host: Server, origin: string;
test.beforeAll(async () => {
  const resource = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } }) as any;
  host = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(resource.contents[0].text); });
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${(host.address() as any).port}`;
});
test.afterAll(async () => { host?.closeAllConnections(); await new Promise<void>(resolve => host ? host.close(() => resolve()) : resolve()); });
test('检查面板展示门禁、定位边界、取消与具名过期批次，刷新保留焦点与 Preview 节点', async ({ page }) => {
  const identity: CheckIdentity = { project: validResult().project.projectId, program: 'sha256:' + 'a'.repeat(64), baseline: 'baseline', brief: 'brief', input: 'input', media: 'media', environment: 'environment' };
  const batch = new CheckBatch('batch-one', identity, [
    { id: 'manifest', dependencies: [], run: async () => [diagnostic('MANIFEST_UNKNOWN_FIELD', identity, { kind: 'file', path: 'program.json' })] },
    { id: 'runtime', dependencies: ['manifest'], run: async () => [diagnostic('RUNTIME_FRAME_FAILED', identity, { kind: 'frame', frame: 8, instanceId: 'old-instance' })] },
  ], [{ id: 'visual-1', identity, message: '画面节奏可能偏快', suggestion: '可考虑延长停留时间，由你判断。', location: { kind: 'project' } }]); await batch.run();
  let batches = [batch.view()], first = true;
  await page.goto(origin);
  await installAppToolBridge(page, (name, args) => {
    if (name !== 'project_checks') return { structuredContent: {} };
    if (args.action === 'start' && !first) batches = [batches[0], { ...batch.view(), id: 'batch-two', status: 'running', diagnostics: [], hardOperations: [], stages: [{ id: 'bundle', status: 'running', reason: '' }] }];
    if (args.action === 'start') first = false;
    if (args.action === 'cancel') batches[1] = { ...batches[1], status: 'cancelled', stages: [{ id: 'bundle', status: 'not-run', reason: '用户取消，检查不完整' }] };
    return { structuredContent: { batches, gates: gateOperations(batches.at(-1)!, identity) } };
  });
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), validResult());
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  const panel = page.getByRole('region', { name: '检查与操作状态' });
  await page.getByRole('button', { name: '检查当前候选', exact: true }).click();
  await expect(panel).toContainText('MANIFEST_UNKNOWN_FIELD'); await expect(panel).toContainText('警告 · 不阻断'); await expect(panel).toContainText('主观建议 · 不阻断');
  await expect(panel).toContainText('第 8 帧 · 仅为时间导航上下文');
  await expect(panel.locator('[data-check-gates]')).toContainText('尚未启用');
  await expect(panel.getByRole('button', { name: /忽略/ })).toHaveCount(0);
  await page.evaluate(() => { (window as any).savedPreviewNode = document.querySelector('[data-preview-screen]'); });
  await panel.getByText('阶段及身份详情', { exact: true }).click();
  await panel.getByText('身份与相关位置', { exact: true }).first().click();
  await panel.getByRole('button', { name: '定位时间上下文' }).click();
  await expect(page.locator('[data-preview-state]')).toContainText('另一个 Preview 实例');
  const summary = panel.getByText('身份与相关位置', { exact: true }).first(); await summary.focus();
  batches[0] = { ...batches[0], stale: true };
  await expect(panel.locator('[data-check-stale]')).toBeVisible({ timeout: 6000 }); await expect(summary).toBeFocused();
  expect(await page.evaluate(() => (window as any).savedPreviewNode === document.querySelector('[data-preview-screen]'))).toBe(true);
  await panel.getByRole('button', { name: '重新检查', exact: true }).click();
  await panel.getByRole('button', { name: '取消检查', exact: true }).click();
  await expect(panel.locator('[data-check-status]')).toHaveText('检查已取消，结果不完整');
  await expect(panel.locator('[data-check-problems]')).not.toContainText('RUNTIME_FRAME_FAILED');
  await panel.getByLabel('查看检查批次').selectOption('batch-one');
  await expect(panel.locator('[data-check-object]')).toContainText('已过期，仅供参考');
  await expect(panel.locator('[data-check-problems]')).toContainText('RUNTIME_FRAME_FAILED');
  await mkdir('.impeccable/review/issue-78', { recursive: true });
  await panel.locator('h2').evaluate(node => node.scrollIntoView({ block: 'start' })); await page.screenshot({ path: '.impeccable/review/issue-78/desktop.png' });
  await panel.locator('[data-check-problems]').evaluate(node => node.scrollIntoView({ block: 'start' })); await page.screenshot({ path: '.impeccable/review/issue-78/desktop-problems.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await panel.locator('h2').evaluate(node => node.scrollIntoView({ block: 'start' }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await panel.getByRole('button').all()) if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await panel.locator('[data-check-gates]').evaluate(node => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: '.impeccable/review/issue-78/mobile.png' });
  const overflowing = await panel.locator('.program-check-mark').evaluateAll(nodes => nodes.filter(node => {
    const range = document.createRange(); range.selectNodeContents(node); const text = range.getBoundingClientRect();
    const panel = node.closest('[data-program-checks]')!.getBoundingClientRect();
    return text.right > panel.right || text.left < panel.left;
  }).map(node => node.textContent));
  expect(overflowing).toEqual([]);
  await panel.locator('[data-check-problems]').evaluate(node => node.scrollIntoView({ block: 'start' })); await page.screenshot({ path: '.impeccable/review/issue-78/mobile-problems.png' });
});

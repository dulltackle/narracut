import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { handleRequest } from '../../plugins/narracut/src/server';
import { fixture } from '../helpers/program-fixture';
import { validResult, installAppToolBridge } from '../helpers/workbench-fixture';
import { buildProgramBundle } from '../../src/server/program-bundle';
import { PreviewOrigin, type PreviewDescriptor } from '../../src/server/preview-origin';

let host: Server, origin: string, source: PreviewOrigin, first: PreviewDescriptor, next: PreviewDescriptor;
test.beforeAll(async () => {
  test.setTimeout(120000);
  const resource = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } }) as any;
  host = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(resource.contents[0].text); });
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(host.address() as any).port}`;
  const request = await fixture(); request.input = { ...request.input, durationInFrames: 300, scenes: [
    { ...request.input.scenes[0], time: { startFrame: 0, durationInFrames: 150, source: 'draft' } },
    { ...request.input.scenes[0], id: 'second', time: { startFrame: 150, durationInFrames: 150, source: 'draft' } },
  ] };
  request.program.set('src/RenderProgram.tsx', Buffer.from('import {AbsoluteFill,useCurrentFrame} from "remotion";export function RenderProgram(){const frame=useCurrentFrame();return <AbsoluteFill style={{backgroundColor:"#19322b",color:"#f1f3eb",justifyContent:"center",alignItems:"center",fontSize:26}}><div>成片检查 · 测试画面</div><div>{frame}</div></AbsoluteFill>;}'));
  const bundle = await buildProgramBundle(request); source = new PreviewOrigin();
  first = await source.publish({ ...request, bundle, media: new Map(), parentOrigin: origin, target: 'current', baseline: 'first', label: '当前 · 测试修订', key: 'c'.repeat(48) });
  next = await source.publish({ ...request, bundle, media: new Map(), parentOrigin: origin, target: 'candidate', baseline: 'next', label: '候选 · 测试修订', key: 'd'.repeat(48) });
});
test.afterAll(async () => { await source?.close(); host?.closeAllConnections(); await new Promise<void>(resolve => host ? host.close(() => resolve()) : resolve()); });
test('显式 READY 切换、失败保留画面、精确 Scene 与隐藏暂停，桌面及窄屏可操作', async ({ page }) => {
  await page.goto(origin); let fail = false, stale = false;
  await installAppToolBridge(page, (name, args) => {
    if (name !== 'project_preview') return { structuredContent: {} };
    if (args.action === 'status') return { structuredContent: { stale } };
    if (args.action === 'release') return { structuredContent: {} };
    return fail ? { structuredContent: { error: { message: '测试构建失败' } } } : { structuredContent: { preview: args.target === 'current' ? first : next } };
  });
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), validResult());
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await page.getByRole('button', { name: '构建当前版本', exact: true }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 0');
  await page.getByLabel('帧号', { exact: true }).fill('151'); await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 151');
  await expect(page.locator('[data-playing-scene]')).toContainText('播放 Scene 2');
  await page.evaluate(d => {
    const source = document.querySelector<HTMLIFrameElement>('[data-preview-screen] iframe')!.contentWindow;
    const data = { version: 1, instanceId: d.instanceId, token: d.token, type: 'FRAME', frame: 9 };
    for (const event of [
      { origin: d.origin, source: window, data },
      { origin: 'https://untrusted.invalid', source, data },
      { origin: d.origin, source, data: { ...data, token: 'wrong' } },
      { origin: d.origin, source, data: { ...data, instanceId: 'wrong' } },
    ]) window.dispatchEvent(new MessageEvent('message', event));
  }, first);
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 151');
  await page.getByRole('button', { name: '构建候选', exact: true }).click();
  await expect(page.locator('[data-preview-switch]')).toBeVisible();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 151');
  await page.locator('[data-preview-switch]').click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 0');
  await expect(page.locator('[data-preview-title]')).toContainText('候选');
  await expect(page.locator('[data-preview-screen] iframe:not([hidden])')).toHaveCount(1);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '表格工作区' }).click();
  await page.waitForTimeout(150);
  const paused = await page.locator('[data-frame-output]').textContent(); await page.waitForTimeout(150);
  expect(await page.locator('[data-frame-output]').textContent()).toBe(paused);
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  fail = true; stale = true; await page.getByRole('button', { name: '构建候选', exact: true }).click();
  await expect(page.locator('[data-preview-state]')).toContainText('测试构建失败');
  await expect(page.locator('[data-preview-freshness]')).toContainText('已过期');
  await expect(page.locator('[data-preview-screen] iframe:not([hidden])')).toHaveCount(1);
  await mkdir('.impeccable/review', { recursive: true });
  await page.locator('#workspace-agent').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: '.impeccable/review/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#workspace-agent').evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('[data-build-preview="candidate"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.impeccable/review/mobile.png', fullPage: true });
  await page.locator('[data-frame-output]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.impeccable/review/mobile-controls.png', fullPage: true });
});

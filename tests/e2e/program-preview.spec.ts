import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { handleRequest } from '../../plugins/narracut/src/server';
import { fixture } from '../helpers/program-fixture';
import { validResult, installAppToolBridge } from '../helpers/workbench-fixture';
import { buildProgramBundle } from '../../src/server/program-bundle';
import { PreviewOrigin, type PreviewDescriptor } from '../../src/server/preview-origin';

let host: Server, origin: string, source: PreviewOrigin, first: PreviewDescriptor, next: PreviewDescriptor, empty: PreviewDescriptor;
test.beforeAll(async () => {
  test.setTimeout(120000);
  const resource = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } }) as any;
  host = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(resource.contents[0].text); });
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(host.address() as any).port}`;
  const request = await fixture(); request.input = { ...request.input, durationInFrames: 300, scenes: [
    { ...request.input.scenes[0], id: validResult().scenes[0].id, time: { startFrame: 0, durationInFrames: 150, source: 'draft' } },
    { ...request.input.scenes[0], id: validResult().scenes[1].id, time: { startFrame: 150, durationInFrames: 150, source: 'draft' } },
  ] };
  const mediaDirectory = await mkdtemp(join(tmpdir(), 'narracut-review-media-'));
  const mediaFile = join(mediaDirectory, 'motion.webm');
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=10', '-c:v', 'libvpx', '-b:v', '1M', mediaFile]);
  const bytes = await readFile(mediaFile);
  await rm(mediaDirectory, { recursive: true, force: true });
  const mediaPath = `media/${createHash('sha256').update(bytes).digest('hex')}`;
  const media = new Map([[mediaPath, bytes]]);
  request.input = { ...request.input, assets: [{ id: 'motion', path: 'assets/motion.webm', availability: 'available', src: mediaPath }] };
  request.program.set('src/RenderProgram.tsx', Buffer.from('import {AbsoluteFill,Html5Video} from "remotion";import type {RenderProgramInputV1} from "@narracut/runtime";export function RenderProgram(input:RenderProgramInputV1){const asset=input.assets[0];return <AbsoluteFill>{asset?.availability === "available" ? <Html5Video src={asset.src} muted style={{width:"100%",height:"100%"}}/> : null}</AbsoluteFill>;}'));
  const bundle = await buildProgramBundle(request); source = new PreviewOrigin();
  first = await source.publish({ ...request, bundle, media, parentOrigin: origin, target: 'current', baseline: 'first', label: '当前 · 测试修订', key: 'c'.repeat(48) });
  next = await source.publish({ ...request, bundle, media, parentOrigin: origin, target: 'candidate', baseline: 'next', label: '候选 · 测试修订', key: 'd'.repeat(48) });
  const emptyRequest = { ...request, input: { ...request.input, scenes: [], durationInFrames: 0 } };
  empty = await source.publish({ ...emptyRequest, bundle: await buildProgramBundle(emptyRequest), media, parentOrigin: origin, target: 'candidate', baseline: 'empty', label: '候选 · 零 Scene', key: 'e'.repeat(48) });
});
test.afterAll(async () => { await source?.close(); host?.closeAllConnections(); await new Promise<void>(resolve => host ? host.close(() => resolve()) : resolve()); });
// #122 替代双版本比较与旧画面保留；Bridge 的身份校验与精确帧仍从生产工作台验证。
test('单一已发布视频的精确帧、Bridge 身份校验、隐藏暂停与本地编辑停播', async ({ page }) => {
  await page.goto(origin);
  const revisionId = '10000000-0000-4000-8000-000000000122';
  await installAppToolBridge(page, (name, args) => {
    if (name === 'project_video_update') return { structuredContent: args.action === 'view' ? { preview: { ...first, revisionId, stale: false } } : { hasDesign: true, revisionId, undo: null, job: null, revision: { summary: '单一设计', acceptance: {} } } };
    return { structuredContent: {} };
  });
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), validResult());
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 0');
  await expect(page.getByRole('button', { name: '构建候选', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: '返回候选', exact: true })).toBeHidden();
  await page.getByLabel('帧号', { exact: true }).fill('151'); await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 151');
  await expect(page.locator('[data-playing-scene]')).toContainText('播放 Scene 2');
  await page.evaluate(d => {
    const source = document.querySelector<HTMLIFrameElement>('[data-preview-screen] iframe')!.contentWindow;
    const data = { version: 1, instanceId: d.instanceId, token: d.token, type: 'FRAME', frame: 9 };
    for (const event of [{ origin: d.origin, source: window, data }, { origin: 'https://untrusted.invalid', source, data }, { origin: d.origin, source, data: { ...data, token: 'wrong' } }]) window.dispatchEvent(new MessageEvent('message', event));
  }, first);
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 151');
  await page.getByRole('tab', { name: '表格工作区' }).click();
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 151');
  await page.getByRole('tab', { name: '表格工作区' }).click();
  await page.getByRole('group', { name: 'Scene 01 行', exact: true }).getByRole('button', { name: '编辑 Narration' }).click();
  await page.getByRole('textbox', { name: 'Scene 01 Narration' }).fill('等待选择的最新内容');
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(page.locator('[data-preview-screen]')).toBeHidden();
  await expect(page.locator('[data-update-state]')).toContainText('需要更新视频');
});

test('无设计拒绝同步，失败显示本次检查并保持键盘入口', async ({ page }) => {
  await page.goto(origin); let hasDesign = false, failed = false;
  await installAppToolBridge(page, (name, args) => name === 'project_video_update' ? { structuredContent: args.action === 'view' ? { preview: null } : {
    hasDesign, revisionId: 'revision', undo: null, job: failed ? { requestId: 'failed', status: 'failed', error: '构建失败' } : null,
    revision: { acceptance: { stages: ['旧成功证据'] } }, checks: { batches: [{ diagnostics: [{ message: '本次缺少程序入口' }] }] },
  } } : { structuredContent: {} });
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), validResult());
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(page.getByRole('button', { name: '仅同步表格内容', exact: true })).toBeDisabled();
  await expect(page.locator('[data-update-state]')).toContainText('尚未生成画面设计');
  hasDesign = true; failed = true;
  await expect(page.locator('[data-update-state]')).toContainText('构建失败', { timeout: 10000 });
  await page.getByText('更新检查详情', { exact: true }).click();
  await expect(page.locator('[data-update-evidence]')).toContainText('本次缺少程序入口');
  await expect(page.locator('[data-update-evidence]')).not.toContainText('旧成功证据');
  await expect(page.locator('[data-preview-screen]')).toBeHidden();
});

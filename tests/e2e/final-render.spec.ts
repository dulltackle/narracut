import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { handleRequest } from '../../plugins/narracut/src/server';
import { installAppToolBridge, validResult } from '../helpers/workbench-fixture';
let host: Server, origin: string;
test.beforeAll(async () => {
  const resource = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } }) as any;
  host = createServer((_req, res) => res.end(resource.contents[0].text));
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(host.address() as any).port}`;
});
test.afterAll(async () => { host?.closeAllConnections(); if (host) await new Promise<void>(resolve => host.close(() => resolve())); });

test('最终输出展示准确来源，核对未知结果、取消与重试保持 Scene 选择及焦点', async ({ page }) => {
  const source = { revisionId: '10000000-0000-4000-8000-000000000002', summary: '调整标题位置与开场节奏', key: 'accepted-state', accepted: true, ready: true, issues: [] as any[], durationInFrames: 300, output: { width: 1920, height: 1080, fps: 30 }, details: { bundle: 'sha256:' + 'b'.repeat(64), input: 'sha256:' + 'a'.repeat(64), media: 'sha256:' + 'c'.repeat(64), environment: 'sha256:' + 'd'.repeat(64) } };
  let job: any, starts = 0, disconnected = true;
  await page.goto(origin);
  await installAppToolBridge(page, (name, args) => {
    if (name === 'project_render') {
      if (args.action === 'status') return { structuredContent: { source, jobs: job ? [job] : [] } };
      if (args.action === 'start') {
        starts++; job = { id: 'job', requestId: args.requestId, source: structuredClone(source), outputPath: args.outputPath, status: 'running', stage: 'rebuilding' };
        return { structuredContent: {} }; // 不完整成功回执也必须保持待核对。
      }
      if (args.action === 'result') return disconnected ? { structuredContent: { status: 'known', job: {} } } : { structuredContent: { status: 'known', job } };
      if (args.action === 'cancel') { job.status = 'cancelling'; return { structuredContent: { job } }; }
    }
    if (name === 'project_acceptance') return { structuredContent: { current: source.revisionId, revisions: [] } };
    if (name === 'project_delivery') return { structuredContent: { delivery: null, checks: { batches: [], gates: [] } } };
    return { structuredContent: {} };
  });
  await page.evaluate(() => { (window as any).openai.selectDirectory = async () => ({ path: '/tmp/我的成片' }); });
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), validResult());
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  const region = page.getByRole('region', { name: '最终 Render', exact: true });
  const selectedScene = await page.locator('[data-scene-row][data-selected="true"]').getAttribute('data-scene-id');
  await expect(page.getByRole('textbox', { name: 'Composer', exact: true })).toHaveCount(0);
  await expect(region).toContainText('10000000 · 调整标题位置与开场节奏');
  await expect(region).toContainText('正在查看的 Preview 与本次输出来源不同');
  await region.getByRole('button', { name: '查看目标修订', exact: true }).click();
  await expect(page.locator('[data-preview-title]')).toBeFocused();
  await expect(region).toContainText('已接受，尚未输出');
  await expect(region.getByRole('button', { name: '选择输出文件夹' })).toBeHidden();
  await region.getByRole('button', { name: '输出视频', exact: true }).click();
  await expect(region.getByRole('button', { name: '选择输出文件夹' })).toBeFocused();
  await page.evaluate(() => { (window as any).openai.selectDirectory = async () => { throw new Error('输出文件夹暂不可用，请重新选择。'); }; });
  await region.getByRole('button', { name: '选择输出文件夹' }).click();
  await expect(region).toContainText('输出文件夹暂不可用');
  await page.waitForTimeout(4500);
  await expect(region).toContainText('输出文件夹暂不可用');
  await page.evaluate(() => { (window as any).openai.selectDirectory = async () => ({ path: '/tmp/我的成片' }); });
  await region.getByRole('button', { name: '选择输出文件夹' }).click();
  await expect(region).toContainText('10.00 秒 · 1920 × 1080 · 30 fps');
  await expect(region).toContainText('/tmp/我的成片/narracut-10000000-');
  await mkdir('.impeccable/review', { recursive: true });
  await region.evaluate(node => node.scrollIntoView({ block: 'start' }));
  if (process.env.NARRACUT_CAPTURE_OUTPUT) await page.screenshot({ path: '.impeccable/review/render-desktop.png', fullPage: true });
  await region.getByRole('button', { name: '开始输出', exact: true }).click();
  await expect(region).toContainText('正在核对 Render 状态');
  await expect(region.getByRole('button', { name: '开始输出', exact: true })).toBeDisabled();
  expect(starts).toBe(1); disconnected = false;
  await region.getByRole('button', { name: '核对 Render 状态', exact: true }).click();
  await expect(region).toContainText('正在离线重建已接受 Bundle');
  job.stage = 'frames'; job.renderedFrames = 90;
  await expect(region).toContainText('90 / 300 帧', { timeout: 10000 });
  await page.getByRole('tab', { name: '表格工作区' }).click();
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(region).toContainText('90 / 300 帧'); await expect(page.locator('[data-scene-row][data-selected="true"]')).toHaveAttribute('data-scene-id', selectedScene!);
  await region.getByRole('button', { name: '取消 Render', exact: true }).click();
  await expect(region).toContainText('正在取消并清理产物');
  job.status = 'cancelled';
  await expect(region).toContainText('已取消，未生成完整产物', { timeout: 10000 });
  job.status = 'failed'; job.retryable = false; job.error = { code: 'RENDER_FRAME_FAILED', message: '帧 99 的内容执行失败，请修复候选并重新验收。' };
  source.ready = false; source.issues = [job.error];
  await expect(region).toContainText('此状态已接受，但已阻断再次 Render', { timeout: 10000 });
  await expect(region.getByRole('button', { name: '重试 Render', exact: true })).toBeHidden();
  await region.getByRole('button', { name: '前往候选检查与验收', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭审阅详情' })).toBeVisible();
  await expect(page.locator('[data-candidate-region]')).toBeFocused();
  await page.getByRole('button', { name: '关闭审阅详情' }).click();
  await expect(region.getByRole('button', { name: '前往候选检查与验收', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await region.evaluate(node => node.scrollIntoView({ block: 'start' }));
  if (process.env.NARRACUT_CAPTURE_OUTPUT) await page.screenshot({ path: '.impeccable/review/render-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await region.getByRole('button').all()) if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  job.retryable = true; job.error = { code: 'RENDER_ENCODE_FAILED', message: '编码器故障，恢复后可重试。' }; source.ready = true; source.issues = [];
  await expect(region.getByRole('button', { name: '重试 Render', exact: true })).toBeVisible({ timeout: 10000 });
  await region.getByRole('button', { name: '重试 Render', exact: true }).click();
  await expect(region.getByRole('button', { name: '选择输出文件夹' })).toBeFocused();
  job.status = 'succeeded'; job.stage = 'completed'; job.projectUpdated = true;
  await expect(region).toContainText('这是启动时状态的产物', { timeout: 10000 });
  await expect(region.getByRole('button', { name: '在文件夹中显示' })).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (path: string) => { (window as any).copiedOutput = path; } } }); });
  const readonly = { ...validResult(), writable: false };
  await page.evaluate(value => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: value } }, '*'), readonly);
  await expect(region).toContainText('当前为只读');
  await region.getByRole('button', { name: '复制输出路径' }).click();
  expect(await page.evaluate(() => (window as any).copiedOutput)).toBe(job.outputPath);
  await expect(page.locator('[data-scene-row][data-selected="true"]')).toHaveAttribute('data-scene-id', selectedScene!); expect(starts).toBe(1);
});

for (const viewport of [{ width: 902, height: 667 }, { width: 960, height: 640 }, { width: 1200, height: 720 }, { width: 430, height: 800 }]) {
  test(`输出阻断逐项定位、收起返回焦点且长内容可达 ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(origin);
    const result = validResult();
    const sceneId = result.scenes[0].id;
    const source = { revisionId: 'accepted-revision', summary: '已接受的草稿', key: 'draft', accepted: true, ready: false,
      issues: [{ code: 'RENDER_DRAFT_DURATION', message: '缺少匹配 Speech，请生成后重新验收。', location: { sceneId } },
        { code: 'RENDER_MEDIA_MISSING', message: '文件缺失，请恢复原文件或重新验收。', location: { path: 'assets/' + '很长的文件名称'.repeat(25) + '.png' } },
        { code: 'RENDER_NOT_ACCEPTED', message: '当前输入与验收证据不匹配，请重新验收。' }] };
    let starts = 0;
    await installAppToolBridge(page, (name, args) => {
      if (name === 'project_render') { if (args.action === 'start') starts++; return { structuredContent: { source, jobs: [] } }; }
      return { structuredContent: {} };
    });
    await page.evaluate(value => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: value } }, '*'), result);
    await page.getByRole('tab', { name: 'Agent 工作区' }).click();
    const region = page.getByRole('region', { name: '最终 Render', exact: true });
    await expect(region).toContainText('缺少匹配 Speech');
    await region.getByRole('button', { name: '输出视频', exact: true }).click();
    await expect(region.getByRole('button', { name: '开始输出', exact: true })).toBeDisabled();
    await region.getByRole('button', { name: '收起输出' }).click();
    await expect(region.getByRole('button', { name: '输出视频', exact: true })).toBeFocused();
    await region.getByRole('button', { name: '输出视频', exact: true }).press('Enter');
    await mkdir('docs/acceptance/issue114', { recursive: true });
    await region.evaluate(node => node.scrollIntoView({ block: 'start' }));
    if (process.env.NARRACUT_CAPTURE_OUTPUT) await page.screenshot({ path: `docs/acceptance/issue114/blocked-${viewport.width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await region.getByRole('button', { name: `定位 Scene 并修复：${sceneId}`, exact: true }).click();
    await expect(page.getByRole('tab', { name: '表格工作区' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`[data-scene-id="${sceneId}"][data-selected="true"]`)).toBeVisible();
    expect(starts).toBe(0);
  });
}

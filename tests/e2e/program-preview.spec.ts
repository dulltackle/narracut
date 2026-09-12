import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
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
  request.program.set('src/RenderProgram.tsx', Buffer.from('import {AbsoluteFill,useCurrentFrame} from "remotion";export function RenderProgram(){const frame=useCurrentFrame();return <AbsoluteFill style={{backgroundColor:"#19322b",color:"#f1f3eb",justifyContent:"center",alignItems:"center",fontSize:26}}><div>成片检查 · 测试画面</div><div>{frame}</div></AbsoluteFill>;}'));
  const bundle = await buildProgramBundle(request); source = new PreviewOrigin();
  first = await source.publish({ ...request, bundle, media: new Map(), parentOrigin: origin, target: 'current', baseline: 'first', label: '当前 · 测试修订', key: 'c'.repeat(48) });
  next = await source.publish({ ...request, bundle, media: new Map(), parentOrigin: origin, target: 'candidate', baseline: 'next', label: '候选 · 测试修订', key: 'd'.repeat(48) });
  const emptyRequest = { ...request, input: { ...request.input, scenes: [], durationInFrames: 0 } };
  empty = await source.publish({ ...emptyRequest, bundle: await buildProgramBundle(emptyRequest), media: new Map(), parentOrigin: origin, target: 'candidate', baseline: 'empty', label: '候选 · 零 Scene', key: 'e'.repeat(48) });
});
test.afterAll(async () => { await source?.close(); host?.closeAllConnections(); await new Promise<void>(resolve => host ? host.close(() => resolve()) : resolve()); });
test('显式 READY 切换、失败保留画面、精确 Scene 与隐藏暂停，桌面及窄屏可操作', async ({ page }) => {
  await page.goto(origin); let fail = false;
  await installAppToolBridge(page, (name, args) => {
    if (name !== 'project_preview') return { structuredContent: {} };
    if (args.action === 'status') return { structuredContent: { stale: false, freshness: { brief: { status: 'latest', review: args.instanceId === first.instanceId ? 'reviewed' : 'pending' }, input: { status: 'latest' }, media: { status: 'latest' }, environment: { status: 'latest' } } } };
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
  await page.getByRole('button', { name: /^Scene 02：/ }).click();
  expect(await page.locator('[data-frame-output]').textContent()).toBe(paused);
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 150');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '表格工作区' }).click();
  await page.getByRole('button', { name: /^Scene 01：/ }).focus();
  await expect(page.getByRole('button', { name: /^Scene 02：/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Scene 03：/ }).click();
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(page.locator('[data-preview-state]')).toContainText('不含所选 Scene');
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 150');
  await page.getByLabel('帧号', { exact: true }).fill('149');
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 149');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.locator('[data-playing-scene]')).toContainText('播放 Scene 2');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.locator('.scene-select[aria-pressed="true"]')).toHaveAttribute('aria-label', /^Scene 03：/);
  fail = true; await page.getByRole('button', { name: '构建候选', exact: true }).click();
  await expect(page.locator('[data-preview-state]')).toContainText('测试构建失败');
  await expect(page.locator('[data-preview-freshness]')).toContainText('已过期');
  await expect(page.locator('[data-preview-screen] iframe:not([hidden])')).toHaveCount(1);
  await page.getByText('版本与输入新鲜度', { exact: true }).click();
  await page.locator('[data-version-switch="current"]').click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 0');
  await expect(page.locator('[data-preview-freshness]')).toBeHidden();
  await expect(page.locator('[data-version="candidate"] [data-version-eligibility]')).toContainText('不能用于接受');
  await expect(page.locator('[data-preview-screen] iframe')).toHaveCount(2);
  await expect(page.locator('[data-version="current"] [data-evidence="brief"]')).toContainText('已复核');
  await expect(page.locator('[data-version="candidate"] [data-evidence="brief"]')).toContainText('待接受复核');
  await page.locator('[data-version-switch="candidate"]').click();
  await mkdir('.impeccable/review' , { recursive: true });
  await page.locator('#workspace-agent').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: '.impeccable/review/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#workspace-agent').evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('[data-build-preview="candidate"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.impeccable/review/mobile.png', fullPage: true });
  await page.locator('[data-preview-screen]').scrollIntoViewIfNeeded();
  await expect(page.frameLocator('[data-preview-screen] iframe:not([hidden])').getByText('成片检查 · 测试画面', { exact: true })).toBeInViewport();
  await page.screenshot({ path: '.impeccable/review/mobile-screen.png', fullPage: true });
  await page.locator('[data-frame-output]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.impeccable/review/mobile-controls.png', fullPage: true });
});

test('首次及目标初始化失败可恢复，失败目标不替换来源画面', async ({ page }) => {
  await page.goto(origin); let broken = true;
  await installAppToolBridge(page, (name, args) => {
    if (name !== 'project_preview' || args.action !== 'build') return { structuredContent: { stale: false } };
    const descriptor = args.target === 'current' ? first : next;
    return { structuredContent: { preview: broken ? { ...descriptor, identity: { ...descriptor.identity, bundle: 'wrong-identity' } } : descriptor } };
  });
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), validResult());
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await page.locator('[data-build-preview="current"]').click();
  await expect(page.locator('[data-version="current"] [data-version-state]')).toContainText('初始化失败');
  broken = false;
  await page.locator('[data-build-preview="current"]').click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 0');
  await page.getByLabel('帧号', { exact: true }).fill('90');
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 90');
  broken = true;
  await page.locator('[data-build-preview="candidate"]').click();
  await expect(page.locator('[data-version="candidate"] [data-version-state]')).toContainText('初始化失败');
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 90');
  await expect(page.locator('[data-preview-screen] iframe:not([hidden])')).toHaveAttribute('title', first.label);
  await expect(page.locator('[data-preview-freshness]')).toBeHidden();
  broken = false;
  await page.locator('[data-build-preview="candidate"]').click();
  await expect(page.locator('[data-preview-switch]')).toBeVisible();
  await page.locator('[data-preview-switch]').click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 0');
  await expect(page.locator('[data-preview-screen] iframe')).toHaveCount(2);
});


test('零 Scene 显示明确空状态并隐藏播放控制', async ({ page }) => {
  await page.goto(origin);
  await installAppToolBridge(page, (name, args) => ({ structuredContent: name === 'project_preview' && args.action === 'build' ? { preview: empty } : { stale: false } }));
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), validResult(0));
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await page.locator('[data-build-preview="candidate"]').click();
  await expect(page.locator('[data-preview-state]')).toContainText('暂无可播放 Scene');
  await expect(page.locator('.preview-controls')).toBeHidden();
  await expect(page.locator('[data-frame-output]')).toHaveText('尚无已提交帧');
});

test('代表帧采集不抢占当前版本；显式证据定位切换准确实例并等待帧确认', async ({ page }) => {
  const { CandidateDelivery } = await import('../../src/shared/candidate-delivery');
  const identity = { project:'p',program:'program',baseline:next.baseline,brief:'brief',input:'input',media:'media',environment:'environment' };
  const delivery = new CandidateDelivery('proof', { instanceId:next.instanceId,bundle:next.identity.bundle,identity }, next.input);
  let prepared = false;
  await page.goto(origin);
  await installAppToolBridge(page, (name,args) => {
    if(name==='project_preview') {
      if(args.action==='build')return {structuredContent:{preview:args.target==='current'?first:next}};
      return {structuredContent:{stale:false,freshness:{brief:{status:'latest',review:'pending'},input:{status:'latest'},media:{status:'latest'},environment:{status:'latest'}}}};
    }
    if(name==='project_delivery') {
      if(args.action==='prepare')prepared=true;
      return {structuredContent:{delivery:prepared?delivery.view():null,collecting:prepared,status:'incomplete',checks:{batches:[],gates:[]},output:next.input.output}};
    }
    return {structuredContent:{}};
  });
  await page.evaluate(result=>window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:result}},'*'),validResult());
  await page.getByRole('tab',{name:'Agent 工作区'}).click();
  await page.locator('[data-build-preview="current"]').click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 0');
  await page.getByLabel('帧号',{exact:true}).fill('90');await page.locator('[data-jump]').click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 90');
  await page.locator('[data-build-preview="candidate"]').click();
  await expect(page.locator('[data-delivery-progress]')).toContainText('已采集 0 / 6');
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 90');
  await expect(page.locator('[data-preview-title]')).toContainText('当前');
  const selected = await page.locator('.scene-select[aria-pressed="true"]').getAttribute('aria-label');
  await page.getByText('展开代表帧证据',{exact:true}).click();
  await page.locator('[data-evidence-seek="149"]').first().click();
  await expect(page.locator('[data-preview-state]')).toBeFocused();
  await expect(page.locator('[data-preview-state]')).toBeInViewport();
  await expect(page.locator('[data-preview-title]')).toContainText('候选');
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 149');
  await expect(page.locator('[data-play]')).toHaveText('播放');
  expect(await page.locator('.scene-select[aria-pressed="true"]').getAttribute('aria-label')).toBe(selected);
});

test('当前对话任务回执与任务刷新只提供候选切换入口，保留当前 Preview 实例和帧', async ({ page }) => {
  await page.goto(origin);
  const task = { taskId: 'task-preview-82', status: 'waiting', reason: 'CANDIDATE_READY', instruction: '调整成片表现', stage: 'deliver', preview: next };
  const calls: string[] = [];
  await installAppToolBridge(page, (name, args) => {
    if ((name === 'project_acceptance' && args.action === 'accept') || (name === 'project_render' && args.action === 'start')) calls.push(name);
    if (name === 'start_creation_task' || name === 'get_creation_task') return { structuredContent: { creationTask: task } };
    if (name === 'project_preview' && args.action === 'build') return { structuredContent: { preview: first } };
    return { structuredContent: { stale: false } };
  });
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), validResult());
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await page.getByRole('button', { name: '构建当前版本', exact: true }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 0');
  await page.locator('[data-frame-input]').fill('4'); await page.locator('[data-jump]').click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 4');
  const current = await page.locator('[data-preview-screen] iframe:not([hidden])').elementHandle();
  await page.getByRole('tab', { name: '表格工作区' }).click();
  await page.evaluate(creationTask => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { creationTask } } }, '*'), task);
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(page.locator('[data-preview-screen] iframe')).toHaveCount(2);
  await expect(page.locator('[data-preview-screen] iframe:not([hidden])')).toHaveAttribute('title', first.label);
  expect(await current!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 4');
  expect(calls).not.toContain('project_acceptance');
  expect(calls).not.toContain('project_render');
});

for (const width of [1440, 390]) test(`任务状态变化及 Scene 建议重排删除保留 Preview 帧与 Scene 选择 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(origin);
  const initial = validResult(2);
  const notify = (result: unknown) => page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), result);
  let task: any = { taskId: 'acceptance-60', status: 'waiting', reason: 'SCENE_CHANGE_REQUIRED', instruction: '保留内容并调整开场', stage: 'read', suggestions: [{ sceneId: initial.scenes[1]!.id, observation: '需要精简', action: '缩短 Narration', content: '欢迎', reason: '开场更紧凑', required: true, satisfied: false, condition: { field: 'narration', description: '请精简旁白' } }] };
  const writes: string[] = [];
  await installAppToolBridge(page, (name, args) => {
    if (name === 'project_preview') return { structuredContent: args.action === 'build' ? { preview: first } : { stale: false } };
    if (name === 'get_creation_task') return { structuredContent: { creationTask: task } };
    if ((name === 'project_acceptance' && args.action === 'accept') || (name === 'project_render' && args.action === 'start') || name === 'save_project_scenes') writes.push(name);
    return { structuredContent: {} };
  });
  await notify(initial);
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await page.getByRole('button', { name: '构建当前版本', exact: true }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 0');
  await page.locator('[data-frame-input]').fill('4'); await page.locator('[data-jump]').click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 4');
  const current = await page.locator('[data-preview-screen] iframe:not([hidden])').elementHandle();
  for (const [status, reason] of [['waiting', 'SCENE_CHANGE_REQUIRED'], ['running', null], ['stopped', 'USER_STOPPED'], ['running', null], ['stopped', 'CODEX_USAGE_LIMIT'], ['waiting', 'CANDIDATE_READY']]) {
    task = { ...task, status, reason }; await notify({ creationTask: task });
    await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 4');
    expect(await current!.evaluate(node => node.isConnected)).toBe(true);
    await expect(page.getByRole('textbox', { name: 'Composer' })).toHaveCount(0);
  }
  task = { ...task, status: 'waiting', reason: 'SCENE_CHANGE_REQUIRED' };
  const reordered = { ...initial, projectRevision: `sha256:${'2'.repeat(64)}`, scenes: [...initial.scenes].reverse(), projectDsl: { ...initial.projectDsl, scenes: [...initial.projectDsl.scenes].reverse() } };
  await notify({ ...reordered, creationTask: task });
  await page.getByRole('button', { name: '定位 Scene', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Scene 01 Narration', exact: true })).toBeFocused();
  await expect(page.locator('[data-scene-row]').first()).toHaveAttribute('data-selected', 'true');
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 4');
  await notify({ ...initial, projectRevision: `sha256:${'3'.repeat(64)}`, scenes: initial.scenes.slice(0, 1), projectDsl: { ...initial.projectDsl, scenes: initial.projectDsl.scenes.slice(0, 1) }, creationTask: task });
  await expect(page.locator('.scene-todo')).toContainText('Scene 已删除');
  await expect(page.getByRole('button', { name: '定位 Scene', exact: true })).toBeDisabled();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 4');
  expect(await current!.evaluate(node => node.isConnected)).toBe(true);
  expect(writes).toEqual([]);
});

test('当前对话已准备候选时优先审阅，单画面比较并保留版本，更新不抢占', async ({ page }) => {
  await page.goto(origin);
  let candidate = next;
  await installAppToolBridge(page, (name, args) => {
    if (name === 'get_workbench') return { structuredContent: { ...validResult(), control: { status: 'editable' }, conversation: { status: 'bound', threadId: 'preview-test' } } };
    if (name !== 'project_preview') return { structuredContent: {} };
    if (args.action === 'view') return { structuredContent: { preview: args.target === 'candidate' ? candidate : first } };
    return { structuredContent: { stale: false } };
  });
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), { ...validResult(), conversation: { status: 'bound', threadId: 'review-current' } });
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(page.locator('[data-preview-title]')).toContainText('正在查看：候选', { timeout: 10000 });
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 0');
  await expect(page.locator('[data-preview-screen] iframe')).toHaveCount(2);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '对比当前', exact: true }).click();
  await expect(page.locator('[data-preview-title]')).toContainText('正在查看：当前');
  await expect(page.locator('[data-preview-screen] iframe:not([hidden])')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '表格工作区' }).click();
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(page.locator('[data-preview-title]')).toContainText('正在查看：当前');
  await page.getByRole('button', { name: '返回候选', exact: true }).click();
  await expect(page.locator('[data-preview-title]')).toContainText('正在查看：候选');
  candidate = empty;
  await expect(page.getByRole('button', { name: '新候选已就绪 · 切换查看' })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-preview-title]')).toContainText(next.label);
  await expect(page.locator('[data-preview-screen] iframe')).toHaveCount(2);
  await page.getByRole('button', { name: '新候选已就绪 · 切换查看' }).click();
  await expect(page.locator('[data-preview-title]')).toContainText('零 Scene');
  await expect(page.locator('[data-preview-screen] iframe:not([hidden])')).toHaveCount(1);
});

test('同内容重新构建仍接纳新证据；当前实例的查看副本不挤占比较槽位', async ({ page }) => {
  const rebuilt = source.fork(next, origin);
  let published = next;
  const released: string[] = [];
  await page.goto(origin);
  await installAppToolBridge(page, (name, args) => {
    if (name === 'get_workbench') return { structuredContent: { ...validResult(), control: { status: 'editable' }, conversation: { status: 'bound', threadId: 'preview-test' } } };
    if (name !== 'project_preview') return { structuredContent: {} };
    if (args.action === 'build') return { structuredContent: { preview: published } };
    if (args.action === 'release') released.push(args.instanceId);
    if (args.action === 'view') return { structuredContent: { preview: args.target === 'candidate' ? { ...source.fork(published, origin), sourceInstanceId: published.instanceId } : first } };
    return { structuredContent: { stale: false } };
  });
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), { ...validResult(), conversation: { status: 'bound', threadId: 'review-rebuild' } });
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await page.getByRole('button', { name: '构建候选', exact: true }).click();
  await expect(page.locator('[data-frame-output]')).toContainText('已提交帧 0');
  await expect(page.locator('[data-preview-screen] iframe')).toHaveCount(2, { timeout: 10000 });
  expect(await page.locator('[data-preview-screen] iframe').evaluateAll(nodes => nodes.map(node => (node as HTMLIFrameElement).src))).toContain(first.url);
  published = rebuilt;
  await page.getByRole('button', { name: '构建候选', exact: true }).click();
  await expect(page.getByRole('button', { name: '新候选已就绪 · 切换查看' })).toBeVisible();
  await page.getByRole('button', { name: '新候选已就绪 · 切换查看' }).click();
  await expect(page.locator('[data-preview-screen] iframe:not([hidden])')).toHaveAttribute('src', rebuilt.url);
  await expect.poll(() => released).toContain(next.instanceId);
});

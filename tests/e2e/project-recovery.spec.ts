import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { handleRequest } from '../../plugins/narracut/src/server';
import { validResult, installAppToolBridge } from '../helpers/workbench-fixture';
import { sealRecovery, recoveryHash } from '../../src/server/project-recovery';
let host: Server, origin: string;
test.beforeAll(async () => {
  const resource = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } }) as any;
  host = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(resource.contents[0].text); });
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${(host.address() as any).port}`;
});
test.afterAll(async () => { host?.closeAllConnections(); await new Promise<void>(resolve => host ? host.close(() => resolve()) : resolve()); });
for (const width of [1440, 390]) test(`恢复页冻结背景、封存、核对未知导出并保持焦点 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.goto(origin);
  const initial = validResult(); let sealed: any, exports = 0, leave = 0;
  const baseline = { projectId: initial.project.projectId, dsl: [{ path: 'project.json', fingerprint: initial.projectRevision }], brief: [{ path: 'video.md', fingerprint: initial.videoBrief.revision }], current: [{ path: '.narracut/current.json', fingerprint: recoveryHash('current'), bindings: { '.narracut/revisions/10000000-0000-4000-8000-000000000001/revision.json': recoveryHash('metadata'), '.narracut/revisions/10000000-0000-4000-8000-000000000001/render-program': recoveryHash('program') } }], candidate: [{ path: '.narracut/candidate.json', fingerprint: null, bindings: { candidate: null, checkpoint: null, dependencies: null } }] };
  await installAppToolBridge(page, (name, args) => {
    if (name !== 'project_recovery') return { structuredContent: {} };
    if (args.action === 'check') return { structuredContent: { status: 'valid' } };
    if (args.action === 'seal') { sealed = sealRecovery(initial.project.directory, initial.project.projectId, baseline, args.draft); return { structuredContent: { status: 'sealed', cut: sealed } }; }
    if (args.action === 'export') { exports++; throw new Error('测试响应丢失'); }
    if (args.action === 'status') return { structuredContent: { status: 'exported', path: '/用户/恢复/' + '很长的项目名称'.repeat(10) + '.narracut-recovery.json' } };
    if (args.action === 'leave') { leave++; return { structuredContent: { status: 'launcher' } }; }
  });
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), initial);
  await page.getByRole('button', { name: '编辑 Narration', exact: true }).first().click();
  await page.locator('.narration-editor').fill('尚未保存的恢复内容');
  await page.evaluate(() => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { status: 'identity-lost', error: { message: '项目清单已移走；租约不能继续使用。' } } } }, '*'));
  const dialog = page.getByRole('dialog', { name: '项目身份已失效，编辑已停止' });
  await expect(dialog).toContainText('恢复截面已封存');
  await expect(dialog.locator('h1')).toBeFocused();
  expect(JSON.parse(Buffer.from(sealed.payload.dsl.base64, 'base64').toString()).scenes[0].narration.text).toBe('尚未保存的恢复内容');
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  await dialog.getByRole('button', { name: '返回启动器', exact: true }).click();
  await expect(dialog).toContainText('离开将丢失');
  await dialog.getByRole('button', { name: '继续保留并导出' }).click();
  expect(leave).toBe(0);
  await dialog.getByRole('button', { name: '选择导出文件夹…' }).click();
  await expect(dialog).toContainText('没有目录选择能力');
  await dialog.locator('input').fill('/tmp/恢复.narracut-recovery.json');
  await dialog.getByRole('button', { name: '导出恢复快照…' }).click();
  await expect(dialog).toContainText('正在核对导出结果');
  await expect(dialog.getByRole('button', { name: '导出恢复快照…' })).toBeDisabled();
  await dialog.getByRole('button', { name: '核对导出结果' }).click();
  await expect(dialog).toContainText('已确认导出'); expect(exports).toBe(1);
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), validResult(2));
  await expect(dialog).toBeVisible();
  await dialog.locator('input').focus();
  await dialog.evaluate(element => { element.scrollTop = 0; });
  if (process.env.NARRACUT_CAPTURE_RECOVERY === '1') await page.screenshot({ path: `/tmp/narracut-recovery-${width}.png`, fullPage: true });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: '返回启动器', exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(leave).toBe(1);
});
for (const mode of ['empty', 'brief', 'both', 'conflict']) test(`恢复清单与载荷一致：${mode}`, async ({ page }) => {
  await page.goto(origin);
  const initial = validResult(); let cut: any, left = 0;
  const baseline = { projectId: initial.project.projectId, dsl: [{ path: 'project.json', fingerprint: initial.projectRevision }], brief: [{ path: 'video.md', fingerprint: mode === 'conflict' ? recoveryHash('外部 Brief') : initial.videoBrief.revision }], current: [{ path: '.narracut/current.json', fingerprint: recoveryHash('current'), bindings: { '.narracut/revisions/10000000-0000-4000-8000-000000000001/revision.json': recoveryHash('metadata'), '.narracut/revisions/10000000-0000-4000-8000-000000000001/render-program': recoveryHash('program') } }], candidate: [{ path: '.narracut/candidate.json', fingerprint: null, bindings: { candidate: null, checkpoint: null, dependencies: null } }] };
  await installAppToolBridge(page, (name, args) => {
    if (name === 'save_project_scenes') return new Promise(() => {});
    if (name === 'save_project_video_brief') return mode === 'conflict' ? { structuredContent: { status: 'brief-conflict', disk: { content: '外部 Brief', revision: recoveryHash('外部 Brief') } } } : new Promise(() => {});
    if (name !== 'project_recovery') return { structuredContent: {} };
    if (args.action === 'check') return { structuredContent: { status: 'valid' } };
    if (args.action === 'seal') { cut = sealRecovery(initial.project.directory, initial.project.projectId, baseline, args.draft); return { structuredContent: { status: 'sealed', cut } }; }
    if (args.action === 'export') return { isError: true, structuredContent: { status: 'recovery-failed', error: { message: '目标已存在，请选择新文件。' } } };
    if (args.action === 'leave') { left++; return { structuredContent: { status: 'launcher' } }; }
  });
  await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), initial);
  if (mode === 'both') {
    await page.getByRole('button', { name: '编辑 Narration', exact: true }).first().click();
    await page.locator('.narration-editor').fill('保留 Scene');
  }
  if (mode !== 'empty') {
    await page.locator('[data-open-brief]').first().click();
    await page.locator('[data-brief-editor]').fill('保留 Brief LOCAL');
    if (mode === 'conflict') { await expect(page.locator('[data-brief-merge]')).toBeVisible(); await page.locator('[data-brief-merge]').fill('正在合并的 LOCAL'); }
  }
  await page.evaluate(() => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { status: 'identity-lost', error: { message: '项目访问权已失效。' } } } }, '*'));
  const dialog = page.locator('#recovery-page');
  if (mode === 'empty') {
    await expect(dialog).toContainText('没有需要导出的未保存 Scene 或 Brief 改动');
    expect(cut).toBeNull(); await expect(dialog.locator('[data-recovery-export]')).toBeDisabled();
    await dialog.getByRole('button', { name: '返回启动器' }).click(); expect(left).toBe(1);
  } else {
    await expect(dialog).toContainText('恢复截面已封存');
    expect(Boolean(cut.payload.dsl)).toBe(mode === 'both');
    expect(Buffer.from(cut.payload.briefLocal.base64, 'base64').toString()).toBe(mode === 'conflict' ? '正在合并的 LOCAL' : '保留 Brief LOCAL');
    expect(Boolean(cut.payload.briefBase)).toBe(mode === 'conflict');
    await page.evaluate(() => { (window as any).openai.selectDirectory = async () => null; });
    await dialog.locator('[data-recovery-pick]').click(); await expect(dialog).toContainText('已取消选择');
    await dialog.locator('input').fill('/tmp/已存在.narracut-recovery.json');
    await dialog.locator('[data-recovery-export]').click(); await expect(dialog).toContainText('目标已存在');
    await expect(dialog.locator('input')).toHaveValue('/tmp/已存在.narracut-recovery.json');
    await expect(dialog.locator('[data-recovery-export]')).toBeEnabled();
    await dialog.locator('[data-recovery-leave]').click();
    await dialog.locator('[data-recovery-confirm-leave]').click(); expect(left).toBe(1);
  }
});

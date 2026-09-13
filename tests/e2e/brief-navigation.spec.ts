import { expect, test, type Page } from '@playwright/test';
import { handleRequest } from '../../plugins/narracut/src/server';
import { validResult, installAppToolBridge } from '../helpers/workbench-fixture';

async function load(page: Page, result: unknown) {
  const resource: any = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } });
  await page.setContent(resource.contents[0].text);
  await send(page, result);
}
async function send(page: Page, result: unknown) {
  await page.evaluate(structuredContent => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent } }, '*'), result);
}

test('Brief 离开才保存，组合输入与后台刷新保留文字，关闭后的失败不抢焦点', async ({ page }) => {
  const initial = validResult(8);
  await load(page, initial);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await installAppToolBridge(page, async (name) => {
    if (name !== 'save_project_video_brief') return { structuredContent: {} };
    calls++; await gate;
    return { structuredContent: { status: 'brief-save-failed', error: { message: '磁盘暂时不可写' } } };
  });
  await page.getByRole('button', { name: /Video Brief.*已保存/ }).click();
  const editor = page.getByRole('textbox', { name: 'Video Brief 原始 Markdown' });
  await editor.dispatchEvent('compositionstart');
  await editor.fill('中文组合输入');
  await page.waitForTimeout(600);
  expect(calls).toBe(0);
  await send(page, initial);
  await expect(editor).toHaveValue('中文组合输入');
  await editor.dispatchEvent('compositionend');
  await page.waitForTimeout(600);
  expect(calls).toBe(0);
  await page.getByRole('button', { name: '关闭 Video Brief 编辑器' }).click();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  release();
  await expect(page.getByRole('region', { name: '保存与连接状态' })).toContainText('磁盘暂时不可写');
  await expect(page.getByRole('tab', { name: 'Agent 工作区' })).toBeFocused();
  await page.getByRole('button', { name: '返回 Brief 编辑' }).click();
  await expect(editor).toHaveValue('中文组合输入');
});

import { createNarracutRequestHandler } from '../../plugins/narracut/src/server';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('Brief 再次冲突保留三方证据及合并草稿，导出不解除冲突，持久成功才收尾', async ({ page }) => {
  const parent = await mkdtemp(join(tmpdir(), 'narracut-115-'));
  const root = join(parent, '长项目名称-雨后散步');
  const exports = join(parent, 'exports'); await mkdir(exports);
  const handler = createNarracutRequestHandler();
  const call = async (name: string, args: any): Promise<any> => handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  let exportMode = 'cancel';
  let mergeRelease!: () => void;
  let holdSave = false;
  let saveStarted = false;
  const gate = new Promise<void>(resolve => { mergeRelease = resolve; });
  try {
    const initial = (await call('create_project', { projectDirectory: root })).structuredContent;
    await load(page, initial);
    await installAppToolBridge(page, async (name, args) => {
      if (name === 'save_project_video_brief' && holdSave) { saveStarted = true; await gate; }
      if (name === 'export_project_video_brief_local' && exportMode === 'fail') return { isError: true, structuredContent: { error: { message: '导出目录不可写' } } };
      return call(name, args);
    });
    await page.exposeFunction('pick115', () => exportMode === 'cancel' ? null : { path: exports });
    await page.evaluate(() => { (window as any).openai.selectDirectory = () => (window as any).pick115(); });
    const entry = page.getByRole('button', { name: /Video Brief/ });
    await entry.click();
    const editor = page.getByRole('textbox', { name: 'Video Brief 原始 Markdown' });
    await expect(editor).toHaveValue('');
    await editor.fill('# 本地\n\n保留中文目标。');
    await writeFile(join(root, 'video.md'), '# 磁盘第一版\n');
    await editor.blur();
    await expect(page.getByRole('heading', { name: '外部冲突', exact: true })).toBeVisible();
    const merge = page.getByRole('textbox', { name: '合并结果', exact: true });
    await merge.fill('# 完整合并草稿\n本地与磁盘内容。');
    await page.getByRole('button', { name: '关闭 Video Brief 编辑器' }).click();
    await page.getByRole('tab', { name: 'Agent 工作区' }).click();
    await page.getByRole('button', { name: '处理 Brief 冲突' }).click();
    await expect(merge).toHaveValue('# 完整合并草稿\n本地与磁盘内容。');
    await page.getByRole('button', { name: '导出本地内容' }).click();
    await expect(page.getByText('已取消导出；本地内容和合并草稿仍保留。')).toBeVisible();
    exportMode = 'fail';
    await page.getByRole('button', { name: '导出本地内容' }).click();
    await expect(page.getByRole('alert')).toContainText('导出目录不可写');
    exportMode = 'ok';
    await page.getByRole('button', { name: '导出本地内容' }).click();
    await expect(page.getByText(/本地内容已导出到/)).toContainText(exports);
    expect(await readFile(join(exports, 'video-brief-local.md'), 'utf8')).toBe('# 本地\n\n保留中文目标。');
    await expect(merge).toHaveValue('# 完整合并草稿\n本地与磁盘内容。');
    expect(await readFile(join(root, 'video.md'), 'utf8')).toBe('# 磁盘第一版\n');
    await page.getByRole('button', { name: '放弃本地，采用磁盘内容' }).click();
    await expect(page.getByRole('button', { name: '取消，保留本地' })).toBeFocused();
    await page.getByRole('button', { name: '取消，保留本地' }).click();
    await writeFile(join(root, 'video.md'), '# 磁盘第二版\n');
    await page.getByRole('button', { name: '保存合并结果', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('磁盘再次变化');
    await expect(merge).toHaveValue('# 完整合并草稿\n本地与磁盘内容。');
    await expect(page.getByRole('textbox', { name: 'LOCAL 只读证据' })).toHaveValue('# 本地\n\n保留中文目标。');
    await expect(page.getByRole('textbox', { name: 'DISK 只读证据' })).toHaveValue('# 磁盘第二版\n');
    holdSave = true;
    await page.getByRole('button', { name: '保存合并结果', exact: true }).click();
    await expect.poll(() => saveStarted).toBe(true);
    await expect(page.getByRole('heading', { name: '外部冲突', exact: true })).toBeVisible();
    mergeRelease();
    await expect(editor).toHaveValue('# 完整合并草稿\n本地与磁盘内容。');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await readFile(join(root, 'video.md'), 'utf8')).toBe('# 完整合并草稿\n本地与磁盘内容。');
    await page.getByRole('button', { name: '关闭 Video Brief 编辑器' }).click();
    await page.getByRole('button', { name: '关闭项目', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择项目文件夹', exact: true })).toBeVisible();
    expect((await call('open_project', { projectDirectory: root })).structuredContent.videoBrief.content).toBe('# 完整合并草稿\n本地与磁盘内容。');
  } finally { mergeRelease(); await handler.dispose(); await rm(parent, { recursive: true, force: true }); }
});

for (const viewport of [{width:902,height:667},{width:960,height:640},{width:1200,height:720},{width:430,height:860}]) {
  test(`项目工具与长 Brief 在 ${viewport.width}px 可达，弹窗键盘与工作位置保留`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const initial = validResult(30);
    initial.project.folderName = '很长的中文项目文件夹名称'.repeat(6);
    initial.project.directory = '/work/projects/' + initial.project.folderName;
    initial.videoBrief.content = ('# 章节\n\n这是一段完整中文创作目标。\n').repeat(120);
    await load(page, initial);
    await installAppToolBridge(page, () => ({ structuredContent: { history: [] } }));
    for (const name of ['声音配置', '程序历史', '打开项目检查', '关闭项目']) {
      const button = page.getByRole('button', { name, exact:true }); await expect(button).toBeVisible();
      const box = (await button.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    const info = page.getByRole('button', { name: /^项目信息：/ });
    await info.click(); await expect(page.getByRole('dialog', {name:'项目信息'})).toContainText(initial.project.directory);
    await page.keyboard.press('Escape'); await expect(info).toBeFocused();
    const scenes = page.getByRole('region', {name:'Scene 可编辑接触印样'}).getByLabel('Scene 列表', {exact:true});
    await scenes.evaluate(el => el.scrollTop = 200);
    const top = await scenes.evaluate(el => el.scrollTop);
    await page.getByRole('button', { name:/Video Brief/ }).click();
    const editor = page.getByRole('textbox', {name:'Video Brief 原始 Markdown'});
    await editor.evaluate((el: HTMLTextAreaElement) => { el.setSelectionRange(150,150); el.scrollTop=350; });
    await send(page, initial); await expect(editor).toBeFocused();
    expect(await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(150);
    await page.keyboard.press('Escape'); await expect(page.getByRole('button',{name:/Video Brief/})).toBeFocused();
    expect(await scenes.evaluate(el => el.scrollTop)).toBe(top);
    await page.getByRole('button',{name:/Video Brief/}).click();
    expect(await editor.evaluate(el => el.scrollTop)).toBe(350);
    expect(await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(150);
    await page.getByRole('button',{name:'关闭 Video Brief 编辑器'}).focus();
    await page.keyboard.press('Tab'); await expect(editor).toBeFocused();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'程序历史'}).click();
    await expect(page.getByRole('dialog',{name:'修订历史'})).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByRole('button',{name:'程序历史'})).toBeFocused();
    await page.getByRole('button',{name:'声音配置'}).click();
    await expect(page.getByRole('heading',{name:'声音配置'})).toBeVisible();
    await page.getByRole('button',{name:'关闭项目 TTS 配置'}).click();
    await expect(page.getByRole('button',{name:'声音配置'})).toBeFocused();
    await page.getByRole('button',{name:'打开项目检查'}).click();
    await expect(page.getByRole('heading',{name:'项目检查',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'项目 TTS 配置',exact:true})).toHaveCount(0);
  });
}

test('失去写权后保留 Brief 冲突、禁止提交，放弃前可取消', async ({ page }) => {
  const initial = validResult(2);
  await load(page, initial);
  let saves = 0;
  await installAppToolBridge(page, name => {
    if (name === 'save_project_video_brief') { saves++; return { structuredContent: { status: 'brief-conflict', disk: { content: '# 磁盘', revision: `sha256:${'d'.repeat(64)}` } } }; }
    return { structuredContent: {} };
  });
  await page.getByRole('button',{name:/Video Brief/}).click();
  const editor = page.getByRole('textbox',{name:'Video Brief 原始 Markdown'});
  await editor.fill('# 本地'); await editor.blur();
  const merge = page.getByRole('textbox',{name:'合并结果',exact:true});
  await merge.fill('# 未提交合并');
  await send(page, { ...initial, writable:false });
  await expect(merge).toHaveValue('# 未提交合并');
  await expect(merge).toHaveAttribute('readonly','');
  for (const name of ['保存合并结果','导出本地内容','放弃本地，采用磁盘内容']) await expect(page.getByRole('button',{name,exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'处理 Brief 冲突'}).click();
  await expect(merge).toHaveValue('# 未提交合并'); expect(saves).toBe(1);
});

test('普通失败显式重试保存真实字节，保存期间新输入不会被回执覆盖', async ({ page }) => {
  const parent = await mkdtemp(join(tmpdir(), 'narracut-115-save-')), root=join(parent,'project');
  const handler = createNarracutRequestHandler();
  const call = async (name: string, args: any): Promise<any> => handler({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
  let release!: () => void; const gate = new Promise<void>(resolve=>release=resolve); let attempts=0;
  try {
    const initial=(await call('create_project',{projectDirectory:root})).structuredContent;
    await load(page,initial);
    await installAppToolBridge(page,async (name,args)=> {
      if(name==='save_project_video_brief') {
        attempts++;
        if(attempts===1) return {structuredContent:{status:'brief-save-failed',error:{message:'测试磁盘故障'}}};
        if(attempts===2) await gate;
      }
      return call(name,args);
    });
    await page.getByRole('button',{name:/Video Brief/}).click();
    const editor=page.getByRole('textbox',{name:'Video Brief 原始 Markdown'});
    await editor.fill('# 第一份\n中文成果。'); await editor.blur();
    await expect(page.getByRole('alert')).toContainText('测试磁盘故障');
    expect(await readFile(join(root,'video.md'),'utf8')).toBe('');
    await page.getByRole('button',{name:'关闭 Video Brief 编辑器'}).click();
    await page.getByRole('button',{name:'重试 Brief 保存',exact:true}).click();
    await page.getByRole('button',{name:'返回 Brief 编辑',exact:true}).click();
    await expect.poll(()=>attempts).toBe(2);
    await editor.fill('# 第二份\n保存中继续编辑。');
    release();
    await expect.poll(async()=>readFile(join(root,'video.md'),'utf8')).toBe('# 第一份\n中文成果。');
    await expect(editor).toHaveValue('# 第二份\n保存中继续编辑。');
    await page.getByRole('button',{name:'关闭 Video Brief 编辑器'}).click();
    await expect.poll(async()=>readFile(join(root,'video.md'),'utf8')).toBe('# 第二份\n保存中继续编辑。');
  } finally { release(); await handler.dispose(); await rm(parent,{recursive:true,force:true}); }
});

test('关闭项目期间冻结编辑，失败恢复输入且不丢本地内容', async ({ page }) => {
  await load(page, validResult(1));
  let release!: () => void; const gate = new Promise<void>(resolve => release=resolve);
  await installAppToolBridge(page, async name => {
    if(name === 'close_project') { await gate; return {isError:true,structuredContent:{error:{message:'关闭暂未完成'}}}; }
    return {structuredContent:{}};
  });
  await page.getByRole('button',{name:'关闭项目',exact:true}).click();
  await expect(page.getByRole('region',{name:'保存与连接状态'})).toContainText('正在关闭项目');
  await page.getByRole('button',{name:/Video Brief/}).click();
  const editor=page.getByRole('textbox',{name:'Video Brief 原始 Markdown'});
  await expect(editor).toHaveAttribute('readonly','');
  release();
  await expect(editor).not.toHaveAttribute('readonly','');
  await expect(editor).toHaveValue(validResult(1).videoBrief.content);
});

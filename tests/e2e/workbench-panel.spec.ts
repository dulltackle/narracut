import { expect, test } from '@playwright/test';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorkbenchPanel } from '../../plugins/narracut/src/workbench-panel';
import { createProjectVNext } from '../../src/server/project-lifecycle';
import sharp from 'sharp';

test('双面板同步只读状态，失权保留文字草稿，重新获得控制权不自动补交', async ({ page, context }) => {
  const root = await mkdtemp(join(tmpdir(), 'panel-control-'));
  const first = await startWorkbenchPanel({ threadId: 'panel-first' });
  const second = await startWorkbenchPanel({ threadId: 'panel-second' });
  const other = await context.newPage();
  const call = async (panel: typeof first, name: string, args = {}) => (await (await page.request.post(`${panel.url}rpc`, {
    headers: { Origin: new URL(panel.url).origin }, data: { id: 1, method: 'tools/call', params: { name, arguments: args } },
  })).json()).result;
  try {
    const created = (await call(first, 'create_project', { projectDirectory: join(root, '共享创作项目') })).structuredContent;
    const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
    await page.goto(first.url);
    const app = page.frameLocator('iframe');
    await app.getByRole('button', { name: '新增第一个 Scene' }).click();
    const editor = app.getByRole('textbox', { name: 'Scene 01 Narration' });
    await editor.fill('已保存的旁白'); await editor.blur();
    await expect.poll(async () => (await call(first, 'get_workbench')).structuredContent.scenes[0]?.narration).toBe('已保存的旁白');
    await call(second, 'open_project', identity);
    await other.goto(second.url);
    const viewer = other.frameLocator('iframe');
    await expect(viewer.getByText('只读 · 项目由另一对话控制', { exact: true })).toBeVisible();
    await viewer.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(viewer.locator('[data-build-preview="current"]')).toBeDisabled();
    await viewer.getByRole('tab', { name: '表格工作区' }).click();
    await viewer.getByRole('button', { name: '打开项目检查' }).click();
    await viewer.getByRole('button', { name: /Video Brief/ }).click();
    const brief = viewer.getByRole('textbox', { name: 'Video Brief 原始 Markdown' });
    await expect(brief).toHaveJSProperty('readOnly', true);
    if (!await editor.isVisible()) await app.locator('[data-edit-narration]').first().click();
    await page.route(`${first.url}rpc`, async route => {
      if (route.request().postDataJSON().params.name === 'save_project_scenes') { await route.fulfill({ json: { jsonrpc: '2.0', id: route.request().postDataJSON().id, result: { isError: true, structuredContent: { error: { code: 'PROJECT_CONTROL_REQUIRED', message: '项目由另一对话控制' } } } } }); }
      else await route.continue();
    });
    await editor.fill('尚未保存的草稿');
    await call(second, 'project_control', { ...identity, action: 'takeover' });
    await expect(app.getByText('编辑已暂停，未保存草稿已保留', { exact: true })).toBeVisible();
    await expect(viewer.getByText('当前对话可编辑', { exact: true })).toBeVisible();
    await expect(brief).toHaveJSProperty('readOnly', false);
    await viewer.getByRole('button', { name: '关闭 Video Brief 编辑器' }).click();
    await app.getByText('核对草稿与最新内容', { exact: true }).click();
    await expect(app.getByRole('textbox', { name: 'Scene 01 保留的草稿' })).toContainText('尚未保存的草稿');
    await expect(app.getByRole('button', { name: '复制保留草稿' })).toBeEnabled();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      // 桌面与窄屏截图已在有界视觉核对中保存；回归只验证溢出和交互。
      expect(await app.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.unroute(`${first.url}rpc`);
    await call(first, 'project_control', { ...identity, action: 'takeover' });
    await expect(app.getByText('当前对话可编辑', { exact: true })).toBeVisible();
    expect((await call(first, 'get_workbench')).structuredContent.scenes[0].narration).toBe('已保存的旁白');
    await app.getByRole('button', { name: '保存核对后的草稿' }).click();
    await expect.poll(async () => (await call(first, 'get_workbench')).structuredContent.scenes[0].narration).toBe('尚未保存的草稿');
  } finally { await page.close(); await other.close(); await second.close(); await first.close(); await rm(root, { recursive: true, force: true }); }
});

test('非项目目录以弹窗说明失败原因并支持重新选择', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'panel-invalid-'));
  const panel = await startWorkbenchPanel({ threadId: 'thread-invalid-directory' });
  let selections = 0;
  try {
    await page.route(`${panel.url}rpc`, async route => {
      const request = route.request().postDataJSON();
      if (request.params.name !== 'select_project_directory') return route.continue();
      selections++;
      await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { structuredContent: { path: root } } } });
    });
    await page.goto(panel.url);
    const app = page.frameLocator('iframe');
    await app.getByRole('button', { name: '选择项目文件夹', exact: true }).click();
    const dialog = app.getByRole('dialog', { name: '无法打开项目' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(root);
    await expect(dialog).toContainText('narracut.json');
    await page.screenshot({ path: '/tmp/narracut-open-error-desktop.png' });
    await page.setViewportSize({ width: 390, height: 667 });
    await page.screenshot({ path: '/tmp/narracut-open-error-mobile.png' });
    await dialog.getByRole('button', { name: '重新选择文件夹' }).click();
    await expect.poll(() => selections).toBe(2);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(app.getByRole('button', { name: '选择项目文件夹', exact: true })).toBeFocused();
  } finally { await page.close(); await panel.close(); await rm(root, { recursive: true, force: true }); }
});

test('项目名称连续输入保留输入节点、焦点和光标', async ({ page }) => {
  const panel = await startWorkbenchPanel({ threadId: 'thread-launcher-input' });
  try {
    await page.goto(panel.url);
    const field = page.frameLocator('iframe').getByRole('textbox', { name: '项目文件夹名' });
    await field.fill('ac');
    await field.press('ArrowLeft');
    await page.keyboard.type('b');
    await expect(field).toHaveValue('abc');
    await expect(field).toBeFocused();
    expect(await field.evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(2);
    const retained = await field.evaluate(input => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      (input as HTMLInputElement).value = '海边采访';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '采访' }));
      const retained = input.isConnected && document.activeElement === input;
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '采访' }));
      return retained;
    });
    expect(retained).toBe(true);
    await expect(field).toHaveValue('海边采访');
  } finally { await page.close(); await panel.close(); }
});

for (const width of [902, 780, 680, 390]) {
  test(`启动器在 ${width} × 667 面板内可滚动到创建按钮`, async ({ page }) => {
    const panel = await startWorkbenchPanel({ threadId: 'thread-launcher-scroll' });
    try {
      await page.setViewportSize({ width, height: 667 });
      await page.goto(panel.url);
      const app = page.frameLocator('iframe');
      await expect(app.getByRole('button', { name: '选择父文件夹' })).toBeVisible();
      const ticket = app.locator('.launch-ticket');
      await ticket.hover({ position: { x: 100, y: 100 } });
      await page.mouse.wheel(0, 2400);
      const create = app.getByRole('button', { name: '原子创建并打开' });
      await expect.poll(async () => create.evaluate(button => {
        const rect = button.getBoundingClientRect();
        const footer = document.querySelector('.launch-footer')!.getBoundingClientRect();
        const ticket = document.querySelector('.launch-ticket')!.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= footer.top && rect.left >= ticket.left && rect.right <= ticket.right;
      })).toBe(true);
      expect(await ticket.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    } finally { await page.close(); await panel.close(); }
  });
}

for (const action of ['create', 'open'] as const) {
  test(`公开面板通过启动器${action === 'create' ? '创建' : '打开'}项目并保留编辑和审阅入口`, async ({ page }) => {
    const root = await mkdtemp(join(tmpdir(), 'panel-e2e-'));
    const projectDirectory = join(root, '当前对话的视频项目');
    const assetPath = join(root, '面板素材.png');
    await sharp({ create: { width: 32, height: 32, channels: 3, background: '#4e88df' } }).png().toFile(assetPath);
    if (action === 'open') await createProjectVNext(projectDirectory);
    const panel = await startWorkbenchPanel({ threadId: 'thread-public-entry' });
    try {
      // 系统文件夹窗口是宿主交互边界；其余请求经过真实面板 HTTP 入口与项目服务。
      await page.route(`${panel.url}rpc`, async route => {
        const request = route.request().postDataJSON();
        if (request.params.name === 'select_workbench_path') return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { content: [], structuredContent: request.params.arguments.kind === 'files' ? { paths: [assetPath] } : { path: root } } } });
        if (request.params.name !== 'select_project_directory') return route.continue();
        await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { content: [], structuredContent: { path: action === 'create' ? root : projectDirectory } } } });
      });
      await page.goto(panel.url);
      const app = page.frameLocator('iframe[title="Narracut 完整工作台"]');
      await expect(app.getByText('已关联当前对话 · 查看详情')).toBeVisible();
      if (action === 'create') {
        await app.getByRole('button', { name: '选择父文件夹' }).click();
        await app.getByRole('textbox', { name: '项目文件夹名' }).fill('当前对话的视频项目');
        await app.getByRole('button', { name: '原子创建并打开' }).click();
      } else await app.getByRole('button', { name: '选择项目文件夹' }).click();
      await expect(app.getByRole('heading', { name: '项目中还没有 Scene' })).toBeVisible();
      await expect(app.getByRole('textbox', { name: 'Composer', exact: true })).toHaveCount(0);
      await app.getByRole('button', { name: '新增第一个 Scene' }).click();
      const editor = app.getByRole('textbox', { name: 'Scene 01 Narration' });
      await editor.fill('从当前对话检查一段视频。'); await editor.blur();
      await expect.poll(async () => (await (await page.request.get(`${panel.url}state`)).json()).structuredContent.scenes[0]?.narration).toBe('从当前对话检查一段视频。');
      await page.reload();
      await expect(app.locator('.narration-view').filter({ hasText: '从当前对话检查一段视频。' })).toBeVisible();
      await app.getByText('已关联当前对话 · 查看详情').click();
      await expect(app.getByText('thread-public-entry', { exact: true })).toBeVisible();
      await expect(app.getByText(projectDirectory, { exact: true }).first()).toBeVisible();
      await app.getByText('已关联当前对话 · 查看详情').click();
      await expect(app.getByRole('button', { name: /第 01 个 Scene 的 Asset/ })).toBeVisible();
      await app.getByRole('button', { name: /第 01 个 Scene 的 Asset/ }).click();
      await app.getByRole('button', { name: '导入并绑定', exact: true }).click();
      await expect(app.getByLabel('Asset 导入结果')).toContainText('已导入并绑定');
      const imported = (await (await page.request.get(`${panel.url}state`)).json()).structuredContent;
      expect(imported.projectDsl.assets).toHaveLength(1);
      expect(imported.projectDsl.scenes[0].assetIds).toHaveLength(1);
      await app.getByRole('tab', { name: 'Agent 工作区' }).click();
      await expect(app.locator('[data-program-preview]')).toBeVisible();
      await expect(app.locator('[data-final-render]')).toBeVisible();
      await app.getByRole('tab', { name: '表格工作区' }).click();
      if (action === 'create') {
        for (const width of [1440, 680, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await expect(app.locator('.narration-view').filter({ hasText: '从当前对话检查一段视频。' })).toBeVisible();
          await page.screenshot({ path: `/tmp/narracut-93-${width}.png` });
          expect(await app.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
        }
      }
    } finally { await page.close(); await panel.close(); await rm(root, { recursive: true, force: true }); }
  });
}

test('面板首次状态请求 503 后重试恢复原项目且数据不变', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'panel-retry-'));
  const directory = join(root, '重试验收项目');
  const assetPath = join(root, '素材.png');
  await createProjectVNext(directory);
  await sharp({ create: { width: 32, height: 32, channels: 3, background: '#4e88df' } }).png().toFile(assetPath);
  const panel = await startWorkbenchPanel({ threadId: 'thread-retry' });
  let attempts = 0;
  const retryCalls: string[] = [];
  let retryPhase = false;
  try {
    await page.request.post(`${panel.url}rpc`, { headers: { Origin: new URL(panel.url).origin }, data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_project', arguments: { projectDirectory: directory } } } });
    await page.route(`${panel.url}rpc`, async route => {
      const request = route.request().postDataJSON();
      if (retryPhase) retryCalls.push(request.params.name);
      if (request.params.name === 'select_workbench_path') return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { structuredContent: { paths: [assetPath] } } } });
      await route.continue();
    });
    await page.goto(panel.url);
    const app = page.frameLocator('iframe');
    await app.getByRole('button', { name: '新增第一个 Scene' }).click();
    const editor = app.getByRole('textbox', { name: 'Scene 01 Narration' });
    await editor.fill('重试后应保留这段内容。'); await editor.blur();
    await app.getByRole('button', { name: /第 01 个 Scene 的 Asset/ }).click();
    await app.getByRole('button', { name: '导入并绑定', exact: true }).click();
    await expect(app.getByLabel('Asset 导入结果')).toContainText('已导入并绑定');
    const state = async () => (await (await page.request.get(`${panel.url}state`)).json()).structuredContent;
    const before = await state();
    expect(before.projectDsl.scenes).toHaveLength(1);
    expect(before.projectDsl.scenes[0].narration.text).toBe('重试后应保留这段内容。');
    expect(before.projectDsl.assets).toHaveLength(1);
    expect(before.projectDsl.scenes[0].assetIds).toHaveLength(1);
    const filesBefore = await Promise.all(['narracut.json', 'project.json', 'video.md'].map(name => readFile(join(directory, name), 'utf8')));
    const entriesBefore = await readdir(root);
    retryPhase = true;
    await page.route(`${panel.url}state`, async route => {
      if (++attempts === 1) return route.fulfill({ status: 503, json: { error: { message: '测试：面板状态暂不可用（503）' } } });
      await route.continue();
    });
    await page.reload();
    await expect(page.getByText('测试：面板状态暂不可用（503）')).toBeVisible();
    await page.screenshot({ path: '/tmp/narracut-retry-503.png' });
    await page.getByRole('button', { name: '重试显示工作台' }).click();
    await expect(app.locator('.narration-view').filter({ hasText: '重试后应保留这段内容。' })).toBeVisible();
    await expect(page.locator('#feedback')).toBeHidden();
    const after = await state();
    expect(after.project.projectId).toBe(before.project.projectId);
    expect(after.project.directory).toBe(directory);
    expect(after.projectDsl).toEqual(before.projectDsl);
    expect(await Promise.all(['narracut.json', 'project.json', 'video.md'].map(name => readFile(join(directory, name), 'utf8')))).toEqual(filesBefore);
    expect(await readdir(root)).toEqual(entriesBefore);
    expect(retryCalls).not.toContain('create_project');
    expect(retryCalls).not.toContain('open_project');
    expect(attempts).toBe(2);
    await page.screenshot({ path: '/tmp/narracut-retry-restored.png' });
  } finally { await page.close(); await panel.close(); await rm(root, { recursive: true, force: true }); }
});

test('最终 Render 用统一系统目录选择桥接接收输出路径', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'panel-render-picker-'));
  const directory = join(root, '项目'); await createProjectVNext(directory);
  const panel = await startWorkbenchPanel({ threadId: 'thread-render-picker' });
  let picked = false;
  try {
    await page.request.post(`${panel.url}rpc`, { headers: { Origin: new URL(panel.url).origin }, data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_project', arguments: { projectDirectory: directory } } } });
    await page.route(`${panel.url}rpc`, async route => {
      const request = route.request().postDataJSON();
      if (request.params.name === 'select_workbench_path') {
        expect(request.params.arguments.kind).toBe('directory'); picked = true;
        return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { content: [], structuredContent: { path: root } } } });
      }
      // 此用例只核对真实面板的选址桥接；准备状态是渲染服务公开边界夹具，实际渲染门禁由原套件验证。
      if (request.params.name === 'project_render') return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { content: [], structuredContent: { source: {
        revisionId: '10000000-0000-4000-8000-000000000002', summary: '选址测试', key: 'ready', accepted: true, ready: true, issues: [], durationInFrames: 30, output: { width: 320, height: 240, fps: 30 }, details: {},
      }, jobs: [] } } } });
      await route.continue();
    });
    await page.goto(panel.url); const app = page.frameLocator('iframe');
    await app.getByRole('tab', { name: 'Agent 工作区' }).click();
    await app.getByRole('button', { name: '输出视频', exact: true }).click();
    await app.getByRole('button', { name: '选择输出文件夹', exact: true }).click();
    await expect(app.locator('[data-render-location]')).toContainText(root);
    expect(picked).toBe(true);
  } finally { await page.close(); await panel.close(); await rm(root, { recursive: true, force: true }); }
});

test('重载时项目身份失效也显示具体原因和重试入口', async ({ page }) => {
  const panel = await startWorkbenchPanel({ threadId: 'thread-retry' });
  try {
    await page.route(`${panel.url}state`, route => route.fulfill({ json: {
      isError: true, structuredContent: { status: 'identity-lost', error: { code: 'PROJECT_IDENTITY_LOST', message: '项目清单已被移除，无法确认项目身份。' } }, content: [],
    } }));
    await page.goto(panel.url);
    await expect(page.getByText(/项目清单已被移除/)).toBeVisible();
    await expect(page.getByRole('button', { name: '重试显示工作台' })).toBeVisible();
  } finally { await page.close(); await panel.close(); }
});

test('身份无法核实时显示原因并禁用启动器写入口', async ({ page }) => {
  const panel = await startWorkbenchPanel();
  try {
    await page.goto(panel.url);
    const app = page.frameLocator('iframe');
    await expect(app.locator('.launch-footer[role=status]')).toContainText('无法确认当前 Codex 对话');
    await expect(app.getByRole('button', { name: '选择父文件夹' })).toBeDisabled();
    await expect(app.getByRole('button', { name: '选择项目文件夹' })).toBeDisabled();
  } finally { await page.close(); await panel.close(); }
});

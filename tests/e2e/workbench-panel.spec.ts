import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorkbenchPanel } from '../../plugins/narracut/src/workbench-panel';
import { createProjectVNext } from '../../src/server/project-lifecycle';
import sharp from 'sharp';

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

test('面板读取失败后明确重试，不重复创建已就绪项目', async ({ page }) => {
  const panel = await startWorkbenchPanel({ threadId: 'thread-retry' });
  let attempts = 0;
  try {
    await page.route(`${panel.url}state`, async route => {
      if (++attempts === 1) return route.fulfill({ status: 503, json: { error: { message: '测试：面板状态暂不可用' } } });
      await route.continue();
    });
    await page.goto(panel.url);
    await expect(page.getByText(/测试：面板状态暂不可用/)).toBeVisible();
    await page.getByRole('button', { name: '重试显示工作台' }).click();
    await expect(page.frameLocator('iframe').getByRole('button', { name: '选择父文件夹' })).toBeVisible();
    await expect(page.locator('#feedback')).toBeHidden();
    expect(attempts).toBe(2);
  } finally { await page.close(); await panel.close(); }
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
    await app.getByRole('button', { name: '准备最终 Render', exact: true }).click();
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

import { expect, test } from '@playwright/test';
import { handleRequest } from '../../plugins/narracut/src/server';
import { createNarracutRequestHandler } from '../../plugins/narracut/src/server';
import { createProjectVNext } from '../../src/server/project-lifecycle';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('启动器完成宿主握手后显示创建和打开入口，并能选择目录', async ({ page }) => {
  const resource = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } }) as { contents: Array<{ text: string }> };
  const result = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'show_launcher', arguments: {} } });
  await page.setContent('<iframe title="Narracut" style="width:100%;height:900px"></iframe>');
  await page.evaluate(({ html, result }) => {
    const frame = document.querySelector('iframe')!;
    // 真实宿主在视图声明就绪后才交付工具结果。
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow) return;
      const message = event.data;
      if (message.method === 'ui/initialize') {
        if (!message.params.appCapabilities || message.params.protocolVersion !== '2026-01-26') {
          frame.contentWindow!.postMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: '初始化参数无效' } }, '*');
          return;
        }
        frame.contentWindow!.postMessage({ jsonrpc: '2.0', id: message.id, result: {
          protocolVersion: '2026-01-26', hostInfo: { name: 'test-host', version: '1' }, hostCapabilities: {}, hostContext: {},
        } }, '*');
      } else if (message.method === 'ui/notifications/initialized') {
        frame.contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result }, '*');
      } else if (message.method === 'tools/call') {
        const valid = message.params.name === 'select_project_directory';
        frame.contentWindow!.postMessage({ jsonrpc: '2.0', id: message.id, result: valid
          ? { structuredContent: { path: message.params.arguments.purpose === 'create-parent' ? '/tmp/测试项目' : null }, content: [] }
          : { isError: true, structuredContent: { error: { message: '未预期的工具调用' } }, content: [] },
        }, '*');
      }
    });
    frame.srcdoc = html;
  }, { html: resource.contents[0]!.text, result });
  const app = page.frameLocator('iframe');
  await expect(app.getByRole('button', { name: '选择父文件夹' })).toBeVisible({ timeout: 2000 });
  await expect(app.getByRole('button', { name: '选择项目文件夹' })).toBeVisible();
  await expect(app.getByText('连接中', { exact: true })).toHaveCount(0);
  await app.getByRole('button', { name: '选择父文件夹' }).click();
  await expect(app.locator('[data-parent-path]')).toHaveText('/tmp/测试项目', { timeout: 2000 });
  await app.getByRole('button', { name: '选择项目文件夹' }).click();
  await expect(app.locator('.launch-error')).toHaveCount(0);
});

for (const action of ['create', 'open'] as const) {
  test(`标准宿主通道完成项目${action === 'create' ? '创建' : '打开'}`, async ({ page }) => {
    const root = await mkdtemp(join(tmpdir(), 'narracut-launcher-'));
    const projectDirectory = join(root, '中文 项目');
    const handler = createNarracutRequestHandler();
    const calls: string[] = [];
    try {
      if (action === 'open') await createProjectVNext(projectDirectory);
      const resource: any = await handler({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } });
      const result = await handler({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'show_launcher', arguments: {} } });
      await page.exposeFunction('callLauncherTool', async (params: any) => {
        calls.push(params.name);
        if (params.name === 'select_project_directory') {
          expect(params.arguments.purpose).toBe(action === 'create' ? 'create-parent' : 'open-project');
          return { structuredContent: { path: action === 'create' ? root : projectDirectory }, content: [] };
        }
        return handler({ jsonrpc: '2.0', id: 3, method: 'tools/call', params });
      });
      await page.setContent('<iframe title="Narracut" style="width:100%;height:900px"></iframe>');
      await page.evaluate(({ html, result }) => {
        const frame = document.querySelector('iframe')!;
        window.addEventListener('message', async event => {
          if (event.source !== frame.contentWindow) return;
          const message = event.data;
          if (message.method === 'ui/initialize') frame.contentWindow!.postMessage({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2026-01-26', hostCapabilities: {}, hostInfo: { name: 'test', version: '1' }, hostContext: {} } }, '*');
          else if (message.method === 'ui/notifications/initialized') frame.contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result }, '*');
          else if (message.method === 'tools/call') {
            const result = await (window as any).callLauncherTool(message.params);
            frame.contentWindow!.postMessage({ jsonrpc: '2.0', id: message.id, result }, '*');
          }
        });
        frame.srcdoc = html;
      }, { html: resource.contents[0].text, result });
      const app = page.frameLocator('iframe');
      if (action === 'create') {
        await app.getByRole('button', { name: '选择父文件夹' }).click();
        await app.getByRole('textbox', { name: '项目文件夹名' }).fill('中文 项目');
        await app.getByRole('button', { name: '原子创建并打开' }).click();
      } else await app.getByRole('button', { name: '选择项目文件夹' }).click();
      await expect(app.getByRole('heading', { name: '项目中还没有 Scene' })).toBeVisible();
      expect(calls).toContain('select_project_directory');
      expect(calls).toContain(action === 'create' ? 'create_project' : 'open_project');
      expect(JSON.parse(await readFile(join(projectDirectory, 'narracut.json'), 'utf8')).projectId).toBeTruthy();
    } finally {
      await page.close();
      await handler.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
}

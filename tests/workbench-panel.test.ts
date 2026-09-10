import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { startWorkbenchPanel } from '../plugins/narracut/src/workbench-panel';
import { createNarracutRequestHandler } from '../plugins/narracut/src/server';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

it('公开面板入口在同一对话中创建项目，重载只读取已就绪项目', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-panel-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const panel = await startWorkbenchPanel({ threadId: 'thread-panel-test' });
  cleanup.push(panel.close);
  const rpc = async (name: string, args = {}) => {
    const response = await fetch(`${panel.url}rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(panel.url).origin }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return (await response.json()).result;
  };
  expect((await fetch(panel.url)).status).toBe(200);
  const created = await rpc('create_project', { projectDirectory: join(root, '面板项目') });
  expect(created.isError).not.toBe(true);
  expect(created.structuredContent.conversation).toMatchObject({ status: 'bound', threadId: 'thread-panel-test' });
  const first = await (await fetch(`${panel.url}state`)).json();
  const second = await (await fetch(`${panel.url}state`)).json();
  expect(second.structuredContent.project.projectId).toBe(first.structuredContent.project.projectId);
  expect(second.structuredContent.operation).not.toBe('created');
});

it('对话身份缺失时，生产 MCP 入口与面板均拒绝伪造身份后的写操作', async () => {
  const handler = createNarracutRequestHandler({ conversation: null });
  cleanup.push(handler.dispose);
  const request = { jsonrpc: '2.0' as const, id: 1, method: 'tools/call', params: {
    name: 'create_project', arguments: { projectDirectory: '/tmp/不得创建的项目', threadId: 'forged' },
  } };
  expect(await handler(request)).toMatchObject({ isError: true, structuredContent: { error: { code: 'HOST_CONVERSATION_UNAVAILABLE' } } });
  const panel = await startWorkbenchPanel(); cleanup.push(panel.close);
  const response = await fetch(`${panel.url}rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(panel.url).origin }, body: JSON.stringify(request) });
  expect(await response.json()).toMatchObject({ result: { isError: true, structuredContent: { error: { code: 'HOST_CONVERSATION_UNAVAILABLE' } } } });
});

it('其他网站不能使用本地面板调用项目工具', async () => {
  const panel = await startWorkbenchPanel({ threadId: 'thread-panel-test' }); cleanup.push(panel.close);
  expect((await fetch(`${panel.url}rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: '{}' })).status).toBe(403);
  expect((await fetch(new URL('/rpc', panel.url))).status).toBe(404);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    get(panel.url, { headers: { Host: 'unrelated.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  expect(status).toBe(404);
});

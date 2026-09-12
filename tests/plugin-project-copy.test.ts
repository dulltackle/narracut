import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createNarracutRequestHandler } from '../plugins/narracut/src/server';

it('插件关闭来源、复制并打开独立副本，提供可轮询的真实阶段', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-copy-'));
  const handler = createNarracutRequestHandler();
  const call = async (name: string, args: unknown) => await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any;
  try {
    const created = (await call('create_project', { projectDirectory: join(root, 'source') })).structuredContent;
    let copy = (await call('copy_project', { action: 'start', projectDirectory: join(root, 'source'), projectId: created.project.projectId, targetDirectory: join(root, 'target') })).structuredContent;
    expect(copy.status, JSON.stringify({ created, copy })).toBe('running');
    for (let i = 0; i < 100 && copy.status === 'running'; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      copy = (await call('copy_project', { action: 'status', operationId: copy.operationId })).structuredContent;
    }
    expect(copy.status).toBe('opened');
    expect(copy.workspace.project.directory).toBe(join(root, 'target'));
    expect(copy.workspace.project.projectId).not.toBe(created.project.projectId);
  } finally { await handler.dispose(); }
});

it('手工副本的同 ID 冲突必须显式选择，转换后身份独立', async () => {
  const { cp } = await import('node:fs/promises');
  const { createProjectVNext } = await import('../src/server/project-lifecycle');
  const root = await mkdtemp(join(tmpdir(), 'plugin-identity-'));
  const source = join(root, 'source'), selected = join(root, 'selected');
  const original = await createProjectVNext(source);
  await cp(source, selected, { recursive: true });
  const handler = createNarracutRequestHandler();
  const call = async (args: unknown) => (await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_project', arguments: args } }) as any).structuredContent;
  try {
    await call({ projectDirectory: source });
    const conflict = await call({ projectDirectory: selected });
    expect(conflict).toMatchObject({ status: 'identity-conflict', currentDirectory: source, selectedDirectory: selected });
    const converted = await call({ projectDirectory: selected, identityChoice: 'convert' });
    expect(converted.status).toBe('valid');
    expect(converted.project.projectId).not.toBe(original.projectId);
  } finally { await handler.dispose(); }
});

it('同进程另一插件会话也识别重复身份，取消不关闭原工作区', async () => {
  const { cp } = await import('node:fs/promises');
  const { createProjectVNext } = await import('../src/server/project-lifecycle');
  const root = await mkdtemp(join(tmpdir(), 'plugin-cross-session-'));
  const source = join(root, 'source'), selected = join(root, 'selected');
  await createProjectVNext(source); await cp(source, selected, { recursive: true });
  const a = createNarracutRequestHandler(), b = createNarracutRequestHandler();
  const call = async (handler: typeof a, args: unknown) => (await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_project', arguments: args } }) as any).structuredContent;
  try {
    await call(a, { projectDirectory: source });
    expect(await call(b, { projectDirectory: selected })).toMatchObject({ status: 'identity-conflict', currentDirectory: source });
    expect(await call(b, { projectDirectory: selected, identityChoice: 'cancel' })).toMatchObject({ status: 'open-cancelled' });
    expect(await call(a, { projectDirectory: source })).toMatchObject({ status: 'valid' });
  } finally { await a.dispose(); await b.dispose(); }
});

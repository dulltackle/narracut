import { expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createNarracutRequestHandler } from '../plugins/narracut/src/server';

const io = vi.hoisted(() => ({ pending: null as null | { entered: () => void; release: Promise<void>; directory: string; stage: string } }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, readFile: async (...args: any[]) => {
    const bytes = await (fs.readFile as any)(...args);
    const pending = io.pending;
    // 仅延迟真实临时写入已就绪后的文件系统读取，所有业务请求仍走公开 MCP 桥。
    if (pending?.stage === 'identity' && String(args[0]) === join(pending.directory, 'narracut.json') && (await fs.readdir(dirname(String(args[0])))).some(name => /^\.project\.json\..*\.tmp$/.test(name))) {
      io.pending = null; pending.entered(); await pending.release;
    }
    return bytes;
  }, open: async (...args: any[]) => {
    const handle = await (fs.open as any)(...args);
    const close = handle.close.bind(handle);
    handle.close = async () => {
      await close();
      const pending = io.pending;
      if (pending?.stage === 'revision' && String(args[0]) === join(pending.directory, 'project.json') && (await fs.readdir(pending.directory)).some(name => /^\.project\.json\..*\.tmp$/.test(name))) {
        io.pending = null; pending.entered(); await pending.release;
      }
    };
    return handle;
  } };
});

it.each(['identity', 'revision'])('Scene 保存的 %s 最后磁盘校验遇到撤权时，拒绝旧请求且不污染项目身份', async stage => {
  const root = await mkdtemp(join(tmpdir(), 'control-commit-race-'));
  const first = createNarracutRequestHandler({ conversation: { threadId: 'race-first' } });
  const second = createNarracutRequestHandler({ conversation: { threadId: 'race-second' } });
  const call = async (handler: typeof first, name: string, args = {}) => await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any;
  let release!: () => void;
  try {
    const created = (await call(first, 'create_project', { projectDirectory: join(root, '项目') })).structuredContent;
    const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
    await call(second, 'open_project', identity);
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    io.pending = { stage, directory: identity.projectDirectory, entered, release: new Promise<void>(resolve => { release = resolve; }) };
    const saving = call(first, 'save_project_scenes', { ...identity, baselineRevision: created.projectRevision, project: { assets: [], scenes: [{ id: '30000000-0000-4000-8000-000000000001', narration: { text: '不应落盘' }, assetIds: [] }] } }).catch(error => ({ isError: true, error }));
    await Promise.race([waiting, saving.then(result => { throw new Error('保存未到达校验门：' + JSON.stringify(result)); })]);
    const transfer = call(second, 'project_control', { ...identity, action: 'takeover' });
    await expect.poll(async () => (await call(first, 'save_project_scenes')).structuredContent?.error?.code).toBe('PROJECT_CONTROL_REQUIRED');
    release();
    expect((await saving).isError).toBe(true);
    expect((await transfer).structuredContent).toMatchObject({ writable: true, projectDsl: { assets: [], scenes: [] } });
    expect((await call(first, 'get_workbench')).structuredContent).toMatchObject({ status: 'valid', writable: false });
  } finally { release?.(); io.pending = null; await second.dispose(); await first.dispose(); await rm(root, { recursive: true, force: true }); }
});

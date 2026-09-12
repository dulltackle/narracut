import { mkdtemp, rename, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createNarracutRequestHandler } from '../plugins/narracut/src/server';
import { validateRecovery } from '../src/server/project-recovery';
it('插件统一阻断新工具调用、封存一次并核对重复导出请求', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'plugin-recovery-')), root = join(parent, 'project');
  const handler = createNarracutRequestHandler();
  const call = async (name: string, args: unknown) => await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any;
  try {
    const created = (await call('create_project', { projectDirectory: root })).structuredContent;
    const identity = { projectDirectory: root, projectId: created.project.projectId };
    await rename(join(root, 'narracut.json'), join(root, 'manifest-away'));
    expect((await call('project_recovery', { ...identity, action: 'check' })).structuredContent.status).toBe('identity-lost');
    expect((await call('save_project_video_brief', { ...identity, content: '禁止写入', baselineRevision: created.videoBrief.revision })).structuredContent.status).toBe('identity-lost');
    const sealed = (await call('project_recovery', { ...identity, action: 'seal', draft: { briefLocal: '未保存的目标' } })).structuredContent;
    expect(sealed.status).toBe('sealed');
    const operationId = randomUUID(), target = join(parent, '恢复.narracut-recovery.json');
    const exported = (await call('project_recovery', { ...identity, action: 'export', target, operationId })).structuredContent;
    expect(exported.status).toBe('exported');
    expect((await call('project_recovery', { ...identity, action: 'status', operationId })).structuredContent).toEqual(exported);
    expect(validateRecovery(await readFile(target, 'utf8')).recoveryCutId).toBe(sealed.cut.recoveryCutId);
    expect((await call('project_recovery', { ...identity, action: 'leave' })).structuredContent.status).toBe('launcher');
  } finally { await handler.dispose(); }
});
it('正常工作台转移后旧会话仍可封存未保存编辑并离开', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'plugin-recovery-transfer-')), root = join(parent, 'project');
  const old = createNarracutRequestHandler(), next = createNarracutRequestHandler();
  const call = async (handler: typeof old, name: string, args: unknown) => await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any;
  try {
    const created = (await call(old, 'create_project', { projectDirectory: root })).structuredContent;
    const identity = { projectDirectory: root, projectId: created.project.projectId };
    expect((await call(next, 'open_project', { projectDirectory: root })).structuredContent.status).toBe('valid');
    expect((await call(old, 'save_project_video_brief', { ...identity, content: '旧端编辑', baselineRevision: created.videoBrief.revision })).structuredContent.status).toBe('identity-lost');
    const sealed = (await call(old, 'project_recovery', { ...identity, action: 'seal', draft: { briefLocal: '旧端编辑' } })).structuredContent;
    expect(sealed.status).toBe('sealed');
    expect(sealed.cut.payload.briefLocal).toBeDefined();
    expect((await call(old, 'project_recovery', { ...identity, action: 'leave' })).structuredContent.status).toBe('launcher');
    expect((await call(next, 'save_project_video_brief', { ...identity, content: '新端编辑', baselineRevision: created.videoBrief.revision })).structuredContent.status).toBe('brief-saved');
  } finally { await old.dispose(); await next.dispose(); }
});

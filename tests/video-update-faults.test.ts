import { test, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';
const fault = vi.hoisted(() => ({ phase: '' }));
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, rename: async (...args: Parameters<typeof fs.rename>) => {
    const update = String(args[1]).endsWith('/current.json') && String(args[0]).includes('/update-');
    if (update && fault.phase === 'before') throw new Error('发布前中断');
    await fs.rename(...args);
    if (update && fault.phase === 'after') throw new Error('提交后回执中断');
  } };
});
test('公开项目事务：发布／撤回提交点两侧中断，重开核对只认整份指针', async () => {
  const root = await mkdtemp(join(tmpdir(), 'update-fault-')), path = join(root, 'project');
  await createProjectVNext(path); let opened = await openProjectVNext(path);
  try {
    await opened.candidate({ action: 'create' });
    const initial = await opened.programTransaction(manager => manager.updateState());
    const request = { requestId: randomUUID(), kind: 'generate' as const, revisionId: initial.revisionId, summary: '生成完整设计', acceptance: {} };
    const before = await readFile(join(path, '.narracut/current.json'));
    fault.phase = 'before';
    await expect(opened.programTransaction(manager => manager.publishUpdate(request, 'candidate', async () => {}))).rejects.toThrow('发布前中断');
    expect(await readFile(join(path, '.narracut/current.json'))).toEqual(before);
    fault.phase = 'after';
    await expect(opened.programTransaction(manager => manager.publishUpdate(request, 'candidate', async () => {}))).rejects.toThrow('提交后回执中断');
    fault.phase = ''; await opened.release(); opened = await openProjectVNext(path);
    const state = await opened.programTransaction(manager => manager.updateState());
    expect(state).toMatchObject({ hasDesign: true, undo: { requestId: request.requestId, previousRevisionId: null }, result: { status: 'published', requestId: request.requestId } });
    expect((await opened.programTransaction(manager => manager.publishUpdate(request, 'candidate', async () => {}))).revision.revisionId).toBe(state.revisionId);
    const undo = { requestId: randomUUID(), operationId: request.requestId };
    const published = await readFile(join(path, '.narracut/current.json'));
    fault.phase = 'before';
    await expect(opened.programTransaction(manager => manager.undoUpdate(undo, async () => {}))).rejects.toThrow('发布前中断');
    expect(await readFile(join(path, '.narracut/current.json'))).toEqual(published);
    fault.phase = 'after';
    await expect(opened.programTransaction(manager => manager.undoUpdate(undo, async () => {}))).rejects.toThrow('提交后回执中断');
    fault.phase = ''; await opened.release(); opened = await openProjectVNext(path);
    expect(await opened.programTransaction(manager => manager.updateState())).toMatchObject({ hasDesign: false, undo: null, result: { status: 'undone', requestId: undo.requestId } });
    expect(await opened.programTransaction(manager => manager.undoUpdate(undo, async () => {}))).toMatchObject({ status: 'undone' });
  } finally { fault.phase = ''; await opened.release(); await rm(root, { recursive: true, force: true }); }
});

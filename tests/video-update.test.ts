import { test, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';

// 公开项目事务边界：验证页面无法注入的原子提交中断与重开语义。
test('发布与一步撤回跨重开一致，失败不消费记录，撤回保留表格和存量候选', async () => {
  const root = await mkdtemp(join(tmpdir(), 'update-122-'));
  const path = join(root, 'project'); await createProjectVNext(path);
  let opened = await openProjectVNext(path);
  try {
    const candidate = await opened.candidate({ action: 'create' });
    const dsl = await readFile(join(path, 'project.json'));
    const requestId = randomUUID();
    const first = await opened.programTransaction(async manager => {
      const state = await manager.updateState();
      expect(state.hasDesign).toBe(false);
      return manager.publishUpdate({ requestId, kind: 'generate', revisionId: state.revisionId, summary: '首次画面', acceptance: {} }, 'candidate', async () => {});
    });
    const committed = await readFile(join(path, '.narracut/current.json'));
    await expect(opened.programTransaction(manager => manager.publishUpdate({ requestId: randomUUID(), kind: 'sync', revisionId: first.revision.revisionId, summary: '失败同步', acceptance: {} }, 'current', async () => { throw new Error('提交前中断'); }))).rejects.toThrow('提交前中断');
    expect(await readFile(join(path, '.narracut/current.json'))).toEqual(committed);
    await opened.release(); opened = await openProjectVNext(path);
    const state = await opened.programTransaction(manager => manager.updateState());
    expect(state.undo?.requestId).toBe(requestId);
    const undoId = randomUUID();
    const undone = await opened.programTransaction(manager => manager.undoUpdate({ requestId: undoId, operationId: requestId }, async () => {}));
    expect(undone.status).toBe('undone');
    expect(await opened.programTransaction(manager => manager.updateState())).toMatchObject({ hasDesign: false, undo: null });
    expect(await opened.programTransaction(manager => manager.undoUpdate({ requestId: undoId, operationId: requestId }, async () => {}))).toEqual(undone);
    await expect(opened.programTransaction(manager => manager.undoUpdate({ requestId: randomUUID(), operationId: requestId }, async () => {}))).rejects.toThrow();
    expect(await readFile(join(path, 'project.json'))).toEqual(dsl);
    expect(await opened.candidate({ action: 'read' })).toEqual(candidate);
  } finally { await opened.release(); await rm(root, { recursive: true, force: true }); }
});

test('同步公开服务拒绝空设计，不生成默认设计，重复请求仅返回原结果', async () => {
  const { ProjectPreview } = await import('../src/server/project-preview');
  const { ProjectVideoUpdate } = await import('../src/server/project-video-update');
  const root = await mkdtemp(join(tmpdir(), 'sync-122-')); const path = join(root, 'project');
  await createProjectVNext(path); const opened = await openProjectVNext(path);
  const preview = new ProjectPreview(), update = new ProjectVideoUpdate(preview);
  try {
    const original = await readFile(join(path, '.narracut/current.json'));
    const requestId = randomUUID();
    await expect(update.start(opened, { requestId, parentOrigin: 'https://narracut.invalid' })).rejects.toThrow('尚未生成');
    expect(await readFile(join(path, '.narracut/current.json'))).toEqual(original);
    expect((await opened.candidate({ action: 'read' })).status).toBe('absent');
  } finally { await update.close(); await preview.close(); await opened.release(); await rm(root, { recursive: true, force: true }); }
});

test('第二次成功才换代一步记录；撤回中断、旧请求重放和恢复来源核验不丢失成果', async () => {
  const { recoveryBaseline } = await import('../src/server/project-recovery');
  const { writeFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'update-boundary-')); const path = join(root, 'project');
  await createProjectVNext(path); let opened = await openProjectVNext(path);
  try {
    await opened.candidate({ action: 'create' });
    const generateId = randomUUID();
    const first = await opened.programTransaction(async manager => manager.publishUpdate({ requestId: generateId, kind: 'generate', revisionId: (await manager.updateState()).revisionId, summary: '初次生成', acceptance: {} }, 'candidate', async () => {}));
    const secondId = randomUUID();
    const second = await opened.programTransaction(manager => manager.publishUpdate({ requestId: secondId, kind: 'sync', revisionId: first.revision.revisionId, summary: '同步新表格', acceptance: {} }, 'current', async () => {}));
    expect((await opened.programTransaction(manager => manager.updateState())).undo?.requestId).toBe(generateId);
    const before = await readFile(join(path, '.narracut/current.json'));
    await expect(opened.programTransaction(manager => manager.undoUpdate({ requestId: randomUUID(), operationId: generateId }, async () => { throw new Error('撤回提交前中断'); }))).rejects.toThrow('撤回提交前中断');
    expect(await readFile(join(path, '.narracut/current.json'))).toEqual(before);
    const baseline = await recoveryBaseline(path, opened.inspection.manifest.projectId);
    expect(baseline.current[0].bindings?.[`.narracut/revisions/${first.revision.revisionId}/render-program`]).toBe(first.revision.programFingerprint);
    await opened.release(); opened = await openProjectVNext(path);
    await opened.programTransaction(manager => manager.undoUpdate({ requestId: randomUUID(), operationId: generateId }, async () => {}));
    expect(await opened.programTransaction(manager => manager.updateState())).toMatchObject({ hasDesign: false, undo: null });
    await expect(opened.programTransaction(manager => manager.publishUpdate({ requestId: secondId, kind: 'sync', revisionId: first.revision.revisionId, summary: '迟到重放', acceptance: {} }, 'current', async () => {}))).rejects.toThrow('已处理');
    await writeFile(join(path, '.narracut/revisions', second.revision.revisionId, 'render-program/src/RenderProgram.tsx'), '被外部破坏');
    await expect(opened.programTransaction(manager => manager.updateState())).rejects.toThrow();
    expect(second.revision.programFingerprint).toBe(first.revision.programFingerprint);
  } finally { await opened.release(); await rm(root, { recursive: true, force: true }); }
});

test('正式复制保留一步撤回及其程序绑定，副本撤回不改变来源', async () => {
  const { copyProjectVNext } = await import('../src/server/project-copy');
  const root = await mkdtemp(join(tmpdir(), 'update-copy-')), path = join(root, 'source'), target = join(root, 'copy');
  await createProjectVNext(path); const opened = await openProjectVNext(path);
  try {
    await opened.candidate({ action: 'create' });
    const requestId = randomUUID();
    await opened.programTransaction(async manager => manager.publishUpdate({ requestId, kind: 'generate', revisionId: (await manager.updateState()).revisionId, summary: '正式复制的设计', acceptance: {} }, 'candidate', async () => {}));
    await opened.programTransaction(async manager => manager.publishUpdate({ requestId: randomUUID(), kind: 'sync', revisionId: (await manager.updateState()).revisionId, summary: '同步不替换可移动的画面撤回', acceptance: {} }, 'current', async () => {}));
    const sourcePointer = await readFile(join(path, '.narracut/current.json'));
    await opened.release();
    await copyProjectVNext(path, target);
    expect(await readFile(join(target, '.narracut/current.json'))).toEqual(sourcePointer);
    const copied = await openProjectVNext(target);
    try {
      expect((await copied.programTransaction(manager => manager.updateState())).undo?.requestId).toBe(requestId);
      await copied.programTransaction(manager => manager.undoUpdate({ requestId: randomUUID(), operationId: requestId }, async () => {}));
      expect((await copied.programTransaction(manager => manager.updateState())).hasDesign).toBe(false);
      expect(await readFile(join(path, '.narracut/current.json'))).toEqual(sourcePointer);
    } finally { await copied.release(); }
  } finally { await opened.release(); await rm(root, { recursive: true, force: true }); }
});

test('准备请求尚未返回时取消，核对结束前不能启动下一轮', async () => {
  const { ProjectPreview } = await import('../src/server/project-preview');
  const { ProjectVideoUpdate } = await import('../src/server/project-video-update');
  const root = await mkdtemp(join(tmpdir(), 'update-preparing-')), path = join(root, 'project');
  await createProjectVNext(path); const opened = await openProjectVNext(path);
  const preview = new ProjectPreview(), update = new ProjectVideoUpdate(preview);
  let release!: () => void;
  try {
    await opened.candidate({ action: 'create' });
    await opened.programTransaction(async manager => manager.publishUpdate({ requestId: randomUUID(), kind: 'generate', revisionId: (await manager.updateState()).revisionId, summary: '已有画面', acceptance: {} }, 'candidate', async () => {}));
    const before = await readFile(join(path, '.narracut/current.json'));
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = opened.programTransaction(() => new Promise<void>(resolve => { release = resolve; entered(); }));
    await ready;
    const requestId = randomUUID();
    const starting = update.start(opened, { requestId, parentOrigin: 'https://narracut.invalid' });
    const rejected = expect(starting).rejects.toThrow();
    expect(update.cancel(requestId).job?.status).toBe('cancelling');
    await expect(update.start(opened, { requestId: randomUUID(), parentOrigin: 'https://narracut.invalid' })).rejects.toThrow('正在核对');
    release(); await held; await rejected;
    expect((await update.status(opened, requestId)).requestStatus).toBe('cancelled');
    expect(await readFile(join(path, '.narracut/current.json'))).toEqual(before);
  } finally { release?.(); await update.close(); await preview.close(); await opened.release(); await rm(root, { recursive: true, force: true }); }
});

test('恢复沿用新发布权威与一步撤回，来源指针变化阻断且不增加快照载荷', async () => {
  const { recoveryBaseline, sealRecovery, RecoveryExports } = await import('../src/server/project-recovery');
  const { planRecovery, recoverProject } = await import('../src/server/project-restore');
  const { writeFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'update-restore-')), path = join(root, 'source');
  await createProjectVNext(path); const opened = await openProjectVNext(path);
  try {
    await opened.candidate({ action: 'create' });
    const requestId = randomUUID();
    await opened.programTransaction(async manager => manager.publishUpdate({ requestId, kind: 'generate', revisionId: (await manager.updateState()).revisionId, summary: '恢复来源设计', acceptance: {} }, 'candidate', async () => {}));
    await opened.programTransaction(async manager => manager.publishUpdate({ requestId: randomUUID(), kind: 'sync', revisionId: (await manager.updateState()).revisionId, summary: '同步不替换可移动的画面撤回', acceptance: {} }, 'current', async () => {}));
    const pointer = await readFile(join(path, '.narracut/current.json'));
    const cut = sealRecovery(path, opened.inspection.manifest.projectId, await recoveryBaseline(path, opened.inspection.manifest.projectId), { briefLocal: '尚未保存的创作意图' })!;
    const snapshot = join(root, 'snapshot.narracut-recovery.json');
    await new RecoveryExports().run(cut, snapshot, randomUUID());
    expect(Object.keys(JSON.parse(await readFile(snapshot, 'utf8')).payload)).toEqual(['briefLocal']);
    await opened.release();
    const plan = await planRecovery(snapshot, path);
    expect(plan.blockers).toEqual([]);
    const target = join(root, 'restored');
    await recoverProject(snapshot, path, target, { planId: plan.planId });
    expect(await readFile(join(target, '.narracut/current.json'))).toEqual(pointer);
    const restored = await openProjectVNext(target);
    try {
      expect((await restored.programTransaction(manager => manager.updateState())).undo?.requestId).toBe(requestId);
      await restored.programTransaction(manager => manager.undoUpdate({ requestId: randomUUID(), operationId: requestId }, async () => {}));
      expect((await restored.programTransaction(manager => manager.updateState())).hasDesign).toBe(false);
    } finally { await restored.release(); }
    const changed = JSON.parse(pointer.toString()); changed.update.undo.at = '2026-01-01T00:00:00.000Z';
    await writeFile(join(path, '.narracut/current.json'), JSON.stringify(changed));
    expect((await planRecovery(snapshot, path)).blockers.some(item => item.path.endsWith('current.json'))).toBe(true);
  } finally { await opened.release(); await rm(root, { recursive: true, force: true }); }
});

test('最终输入核对期间失权不得提交发布或消费撤回', async () => {
  const { writeFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'update-lease-')), path = join(root, 'project');
  await createProjectVNext(path); const opened = await openProjectVNext(path);
  try {
    await opened.candidate({ action: 'create' });
    const state = await opened.programTransaction(manager => manager.updateState());
    const before = await readFile(join(path, '.narracut/current.json'));
    let checks = 0;
    await expect(opened.programTransaction(manager => manager.publishUpdate({ requestId: randomUUID(), kind: 'generate', revisionId: state.revisionId, summary: '失权时不得发布', acceptance: {} }, 'candidate', async () => {
      if (++checks === 2) await writeFile(join(path, '.narracut/workspace.lease'), JSON.stringify({ ...JSON.parse(await readFile(join(path, '.narracut/workspace.lease'), 'utf8')), token: randomUUID() }));
    }))).rejects.toThrow();
    expect(await readFile(join(path, '.narracut/current.json'))).toEqual(before);
  } finally { await opened.release(); await rm(root, { recursive: true, force: true }); }
});

test('超过历史窗口的同步仍固定画面创作与恢复目标，移动后撤回与同步回执独立', async () => {
  const { rename } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'design-undo-128-')); let path = join(root, 'project');
  await createProjectVNext(path); let opened = await openProjectVNext(path);
  try {
    await opened.candidate({ action: 'create' });
    const publish = async (kind: 'generate' | 'adjust' | 'sync', requestId = randomUUID()) => opened.programTransaction(async manager => manager.publishUpdate({ requestId, kind, revisionId: (await manager.updateState()).revisionId, summary: kind, acceptance: {} }, kind === 'sync' ? 'current' : 'candidate', async () => {}));
    const first = await publish('generate');
    const candidate = await opened.candidate({ action: 'read' });
    await opened.candidate({ action: 'apply', baseline: candidate.baseline, changes: [{ path: 'resources/adjustment.txt', content: '第二版画面' }] });
    for (const message of ['画面调整失败', '画面调整已取消']) {
      await expect(opened.programTransaction(async manager => manager.publishUpdate({ requestId: randomUUID(), kind: 'adjust', revisionId: (await manager.updateState()).revisionId, summary: message, acceptance: {} }, 'candidate', async () => { throw new Error(message); }))).rejects.toThrow(message);
      expect((await opened.programTransaction(manager => manager.updateState())).undo?.requestId).toBe(first.revision.requestId);
    }
    const adjusted = await publish('adjust');
    const undo = (await opened.programTransaction(manager => manager.updateState())).undo;
    for (let i = 0; i < 22; i++) await publish('sync');
    expect((await opened.programTransaction(manager => manager.updateState())).undo).toEqual(undo);
    await opened.release(); await rename(path, join(root, 'moved')); path = join(root, 'moved'); opened = await openProjectVNext(path);
    const request = { requestId: randomUUID(), operationId: adjusted.revision.requestId! };
    await opened.programTransaction(manager => manager.undoUpdate(request, async () => {}));
    expect(await opened.programTransaction(manager => manager.updateState())).toMatchObject({ hasDesign: true, revisionId: first.revision.revisionId, undo: null, restoration: { synced: false } });
    await publish('sync');
    expect(await opened.programTransaction(manager => manager.updateState())).toMatchObject({ undo: null, restoration: { requestId: request.requestId, synced: true }, revision: { programFingerprint: first.revision.programFingerprint } });
    expect(await opened.programTransaction(manager => manager.undoUpdate(request, async () => {}))).toMatchObject({ status: 'undone' });
    await expect(opened.programTransaction(manager => manager.undoUpdate({ ...request, requestId: randomUUID() }, async () => {}))).rejects.toThrow('不可撤回');
  } finally { await opened.release(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('存量同步记录不冒充画面创作，后续同步仍说明无法验证', async () => {
  const { writeFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'legacy-undo-128-')), path = join(root, 'project');
  await createProjectVNext(path); const opened = await openProjectVNext(path);
  try {
    await opened.candidate({ action: 'create' });
    const first = await opened.programTransaction(async manager => manager.publishUpdate({ requestId: randomUUID(), kind: 'generate', revisionId: (await manager.updateState()).revisionId, summary: '生成', acceptance: {} }, 'candidate', async () => {}));
    const pointerPath = join(path, '.narracut/current.json');
    const pointer = JSON.parse(await readFile(pointerPath, 'utf8')); pointer.update.undo.kind = 'sync';
    await writeFile(pointerPath, JSON.stringify(pointer));
    expect(await opened.programTransaction(manager => manager.updateState())).toMatchObject({ undo: null, undoUnavailable: expect.stringContaining('存量记录') });
    await expect(opened.programTransaction(manager => manager.undoUpdate({ requestId: randomUUID(), operationId: first.revision.requestId! }, async () => {}))).rejects.toThrow('不可撤回');
    await opened.programTransaction(manager => manager.publishUpdate({ requestId: randomUUID(), kind: 'sync', revisionId: first.revision.revisionId, summary: '同步', acceptance: {} }, 'current', async () => {}));
    expect(await opened.programTransaction(manager => manager.updateState())).toMatchObject({ undo: null, undoUnavailable: expect.stringContaining('存量记录') });
  } finally { await opened.release(); await rm(root, { recursive: true, force: true }); }
});

test('关闭排空已提交撤回后的状态读取，不在关闭后启动自动同步', async () => {
  const { ProjectPreview } = await import('../src/server/project-preview');
  const { ProjectVideoUpdate } = await import('../src/server/project-video-update');
  const root = await mkdtemp(join(tmpdir(), 'undo-close-128-')), path = join(root, 'project');
  await createProjectVNext(path); const opened = await openProjectVNext(path);
  const preview = new ProjectPreview(), update = new ProjectVideoUpdate(preview);
  let release!: () => void;
  try {
    await opened.candidate({ action: 'create' });
    for (const kind of ['generate', 'adjust'] as const) await opened.programTransaction(async manager => manager.publishUpdate({ requestId: randomUUID(), kind, revisionId: (await manager.updateState()).revisionId, summary: kind, acceptance: {} }, 'candidate', async () => {}));
    const undo = (await opened.programTransaction(manager => manager.updateState())).undo!;
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
    // 在公开项目事务返回处延迟回执，不替换程序或执行胶囊。
    const delayed = { ...opened, programTransaction: async <T>(fn: Parameters<typeof opened.programTransaction<T>>[0]) => {
      const result = await opened.programTransaction(fn);
      if (++calls === 2) { entered(); await held; }
      return result;
    } };
    const operation = update.undo(delayed, { requestId: randomUUID(), operationId: undo.requestId, parentOrigin: 'https://narracut.invalid' });
    await ready;
    expect(update.busy).toBe(true);
    let closed = false; const closing = update.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    release(); await operation; await closing;
    expect(update.busy).toBe(false);
    const status = await update.status(opened);
    expect(status.job).toBeNull();
    expect(status.restoration?.synced).toBe(false);
    expect(status.undo).toBeNull();
  } finally { release?.(); await update.close(); await preview.close(); await opened.release(); await rm(root, { recursive: true, force: true }); }
});

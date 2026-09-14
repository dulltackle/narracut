import type { RecoveryCommit } from './project-recovery';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { rename, rm, mkdir, lstat } from 'node:fs/promises';
import { z } from 'zod';
import { regular, directory, readTree, identity, writeTree, writeBytes, syncDirectory, CandidateError } from './project-candidate';
const uuid = z.string().uuid(), digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const refSchema = z.object({ revisionId: uuid, metadata: digest, program: digest, requestId: uuid.optional() }).strict();
const updateSchema = z.object({ hasDesign: z.boolean(), undo: z.object({ requestId: uuid, kind: z.enum(['sync', 'generate', 'adjust']), at: z.string().datetime(), previousRevisionId: uuid.nullable(), revisionId: uuid }).strict().nullable(), result: z.object({ requestId: uuid, operationId: uuid, status: z.enum(['published', 'undone']) }).strict() }).strict();
export type UpdateRequest = { requestId: string; kind: 'sync' | 'generate' | 'adjust'; revisionId: string; summary: string; acceptance: Record<string, unknown> };
const pointerSchema = z.object({ revisionId: uuid, history: z.array(refSchema).min(1).max(20).optional(),
  consumed: z.object({ pointer: digest, generation: z.string().regex(/^\.narracut\/candidate-[0-9a-f-]{36}$/), requestId: uuid, taskCheckpoint: digest.optional() }).strict().optional(),
  update: updateSchema.optional(),
  pruned: z.array(uuid).max(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.update?.undo && (value.update.undo.revisionId !== value.revisionId || !value.update.hasDesign || (value.update.undo.previousRevisionId && !value.history?.some(ref => ref.revisionId === value.update!.undo!.previousRevisionId)))) ctx.addIssue({ code: 'custom', message: '视频更新撤回记录与修订不一致' });
  if (value.history && (value.history[0].revisionId !== value.revisionId || new Set(value.history.map(item => item.revisionId)).size !== value.history.length)) ctx.addIssue({ code: 'custom', message: '当前修订与历史不一致' });
});
const metadataSchema = z.object({ revisionId: uuid, previousRevisionId: uuid.nullable(), briefFingerprint: digest.optional(), source: z.string(), summary: z.string(),
  acceptedAt: z.string().datetime().optional(), programFingerprint: digest.optional(), inputFingerprint: digest.optional(), sourceRevision: uuid.optional(), acceptance: z.record(z.string(), z.unknown()).optional(), requestId: uuid.optional(),
}).strict();
type Pointer = z.infer<typeof pointerSchema>;
export type Revision = z.infer<typeof metadataSchema>;
const hash = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export async function readCurrentPointer(project: string): Promise<Pointer> {
  await directory(join(project, '.narracut'));
  return pointerSchema.parse(JSON.parse((await regular(join(project, '.narracut/current.json'), 16384)).toString()));
}
export async function verifyRevision(project: string, id: string) {
  uuid.parse(id); const pointer = await readCurrentPointer(project);
  const ref = pointer.history?.find(item => item.revisionId === id);
  if (!ref && id !== pointer.revisionId) throw new CandidateError('REVISION_NOT_RETAINED', '修订已移出历史。');
  await directory(join(project, '.narracut/revisions'));
  const root = join(project, '.narracut/revisions', id); await directory(root);
  const bytes = await regular(join(root, 'revision.json'), 1048576);
  const metadata = metadataSchema.parse(JSON.parse(bytes.toString()));
  if (metadata.acceptance && !ref) throw new CandidateError('REVISION_INTEGRITY_FAILED', '已接受修订缺少完整历史绑定。');
  const tree = await readTree(join(root, 'render-program')), program = identity(tree);
  if (metadata.revisionId !== id || (ref && (ref.metadata !== hash(bytes) || ref.program !== program)) || (metadata.programFingerprint && metadata.programFingerprint !== program)) throw new CandidateError('REVISION_INTEGRITY_FAILED', '修订字节或元数据发生变化；不能使用损坏修订。');
  return { metadata, tree, ref: { revisionId: id, metadata: hash(bytes), program, requestId: metadata.requestId } };
}
/** current.json 同时选定修订、有限历史及已消费候选；清理不参与提交结果。 */
export function createRevisionStore(project: string, assertWritable: () => Promise<void>, observeCommit?: RecoveryCommit) {
  const internal = join(project, '.narracut');
  async function history() {
    await assertWritable(); const pointer = await readCurrentPointer(project);
    const refs = pointer.history ?? [(await verifyRevision(project, pointer.revisionId)).ref];
    const revisions = await Promise.all(refs.map(async ref => {
      try { return { ...(await verifyRevision(project, ref.revisionId)).metadata, current: ref.revisionId === pointer.revisionId, valid: true, error: null }; }
      catch (error) { return { revisionId: ref.revisionId, current: ref.revisionId === pointer.revisionId, valid: false, error: (error as Error).message, requestId: ref.requestId ?? (ref.revisionId === pointer.revisionId ? pointer.consumed?.requestId : undefined), summary: '已接受修订 · 完整性失败' } as Partial<Revision> & { revisionId: string; current: boolean; valid: boolean; error: string | null }; }
    }));
    const pendingPaths = [...(pointer.consumed ? ['candidate', 'checkpoint'].map(name => join(project, pointer.consumed!.generation, name)) : []), ...(pointer.pruned ?? []).map(id => join(internal, 'revisions', id))];
    const taskCleanupPending = !!await endedTaskReason(project);
    const cleanupPending = taskCleanupPending || (await Promise.all(pendingPaths.map(path => lstat(path).then(() => true, error => error.code !== 'ENOENT')))).some(Boolean);
    return { current: pointer.revisionId, limit: 20, revisions, cleanupPending, taskCleanupPending };
  }
  async function cleanup() {
    await assertWritable(); const pointer = await readCurrentPointer(project);
    try {
      await syncDirectory(internal);
      await cleanupEndedTask(project);
      if (pointer.consumed) {
        const path = join(internal, 'candidate.json');
        let bytes: Buffer | undefined;
        try { bytes = await regular(path, 4194304); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (bytes && hash(bytes) === pointer.consumed.pointer) {
          const state = JSON.parse(bytes.toString());
          const temp = join(internal, `consumed-${randomUUID()}.json`);
          try {
            const next = Buffer.from(JSON.stringify({ ...state, candidate: null, checkpoint: null }));
            await writeBytes(temp, next);
            await assertWritable();
            if (!bytes.equals(await regular(path, 4194304))) throw new Error('清理期间候选指针变化');
            observeCommit?.(path, next, false);
            await rename(temp, path);
            observeCommit?.(path, next, true);
            await syncDirectory(internal);
          } finally { await rm(temp, { force: true }); }
        }
        let exists = true;
        try { await directory(join(project, pointer.consumed.generation)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false; else throw error; }
        if (exists) for (const name of ['candidate', 'checkpoint']) await rm(join(project, pointer.consumed.generation, name), { recursive: true, force: true });
      }
      await directory(join(internal, 'revisions'));
      for (const id of pointer.pruned ?? []) {
        if (pointer.history?.some(item => item.revisionId === id)) throw new Error('不能删除保留修订');
        await rm(join(internal, 'revisions', id), { recursive: true, force: true });
      }
      return { cleanupPending: false };
    } catch (error) { return { cleanupPending: true, cleanupError: (error as Error).message }; }
  }
  async function accept(request: { baseline: string; summary: string; source: string; acceptance: Record<string, unknown>; requestId?: string }, tree: Awaited<ReturnType<typeof readTree>>, raw: Buffer, state: { sourceRevision: string; candidate: { path: string } | null }, validate: () => Promise<void>) {
    if ((await cleanup()).cleanupPending) throw new CandidateError('ACCEPTANCE_CLEANUP_PENDING', '请先重试上次接受的清理。');
    const beforeBytes = await regular(join(internal, 'current.json'), 16384), before = await readCurrentPointer(project);
    if (before.update) throw new CandidateError('UPDATE_REQUIRED', '项目已使用视频更新流程，请通过完整更新发布，不能再接受旧候选。');
    const previous = await verifyRevision(project, before.revisionId);
    const id = randomUUID(), requestId = request.requestId ?? randomUUID();
    const record = request.acceptance as { identity?: { brief?: string; input?: string } };
    const revision = metadataSchema.parse({ revisionId: id, previousRevisionId: before.revisionId, sourceRevision: state.sourceRevision, acceptedAt: new Date().toISOString(), programFingerprint: identity(tree), briefFingerprint: record.identity?.brief, inputFingerprint: record.identity?.input, summary: request.summary, source: request.source, acceptance: request.acceptance, requestId });
    const root = join(internal, 'revisions', id), temporary = join(internal, `accept-${id}.json`);
    let committed = false;
    try {
      await assertWritable(); await mkdir(root); await writeTree(join(root, 'render-program'), tree);
      const bytes = Buffer.from(JSON.stringify(revision)); if (bytes.length > 1048576) throw new Error('精简验收记录超过 1 MiB');
      await writeBytes(join(root, 'revision.json'), bytes); await syncDirectory(root); await syncDirectory(join(internal, 'revisions'));
      if (identity(await readTree(join(root, 'render-program'))) !== revision.programFingerprint) throw new Error('待发布修订校验失败');
      const all = [{ revisionId: id, metadata: hash(bytes), program: revision.programFingerprint!, requestId }, ...(before.history ?? [previous.ref])];
      const taskCheckpoint = await taskCheckpointFingerprint(project);
      const next = pointerSchema.parse({ revisionId: id, history: all.slice(0, 20), pruned: all.slice(20).map(item => item.revisionId), consumed: { pointer: hash(raw), generation: state.candidate!.path.replace(/\/candidate$/, ''), requestId, taskCheckpoint } });
      await writeBytes(temporary, Buffer.from(JSON.stringify(next)));
      await validate(); await assertWritable();
      if (!beforeBytes.equals(await regular(join(internal, 'current.json'), 16384))) throw new Error('当前指针在提交前发生变化');
      await verifyRevision(project, before.revisionId);
      if (!(await regular(join(root, 'revision.json'), 1048576)).equals(bytes) || identity(await readTree(join(root, 'render-program'))) !== revision.programFingerprint) throw new Error('待提交修订在复核期间被改写');
      observeCommit?.(join(internal, 'current.json'), Buffer.from(JSON.stringify(next)), false);
      await rename(temporary, join(internal, 'current.json')); committed = true;
      observeCommit?.(join(internal, 'current.json'), Buffer.from(JSON.stringify(next)), true);
      const sync = await syncDirectory(internal).then(() => ({}), () => ({ cleanupPending: true, cleanupError: '当前指针已提交，目录同步待重试' }));
      return { status: 'accepted' as const, revision, ...await cleanup(), ...sync };
    } catch (error) {
      if (committed) return { status: 'accepted' as const, revision, cleanupPending: true, cleanupError: (error as Error).message };
      throw new CandidateError('ACCEPTANCE_NOT_COMMITTED', `未接受，当前修订与候选已保留。${(error as Error).message}`);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (!committed) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  async function updateState() {
    await assertWritable();
    const pointer = await readCurrentPointer(project);
    const revision = await verifyRevision(project, pointer.revisionId);
    return { revisionId: pointer.revisionId, hasDesign: pointer.update?.hasDesign ?? !!revision.metadata.acceptance,
      undo: pointer.update?.undo ?? null, result: pointer.update?.result ?? null, revision: revision.metadata };
  }
  // 与修订及恢复绑定共用一个 rename；绝不把撤回拆成第二个文件提交。
  async function commitUpdate(beforeBytes: Buffer, next: Pointer, validate: () => Promise<void>) {
    const temporary = join(internal, `update-${randomUUID()}.json`), bytes = Buffer.from(JSON.stringify(pointerSchema.parse(next)));
    try {
      await writeBytes(temporary, bytes);
      await validate(); await assertWritable();
      if (!beforeBytes.equals(await regular(join(internal, 'current.json'), 16384))) throw new CandidateError('UPDATE_STALE', '视频状态已变化，请核对原操作。');
      await validate();
      observeCommit?.(join(internal, 'current.json'), bytes, false);
      await rename(temporary, join(internal, 'current.json'));
      observeCommit?.(join(internal, 'current.json'), bytes, true);
      await syncDirectory(internal);
    } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }
  async function publishUpdate(request: UpdateRequest, tree: Awaited<ReturnType<typeof readTree>>, validate: () => Promise<void>) {
    uuid.parse(request.requestId);
    const beforeBytes = await regular(join(internal, 'current.json'), 16384), before = await readCurrentPointer(project);
    if (before.update?.result.requestId === request.requestId) {
      if (before.update.result.status !== 'published') throw new CandidateError('UPDATE_REQUEST_REUSED', '此操作身份已用于撤回。');
      return { status: 'published' as const, revision: (await verifyRevision(project, before.revisionId)).metadata };
    }
    if (before.history?.some(ref => ref.requestId === request.requestId)) throw new CandidateError('UPDATE_ALREADY_PROCESSED', '此更新已处理，不能重新应用。');
    const previous = await verifyRevision(project, before.revisionId);
    if (before.revisionId !== request.revisionId) throw new CandidateError('UPDATE_STALE', '同步来源已变化。');
    const hasDesign = before.update?.hasDesign ?? !!previous.metadata.acceptance;
    if (request.kind === 'sync' && !hasDesign) throw new CandidateError('UPDATE_NO_DESIGN', '尚未生成画面设计，请先在当前对话生成。');
    const id = randomUUID(), root = join(internal, 'revisions', id);
    const record = request.acceptance as { identity?: { brief?: string; input?: string } };
    const revision = metadataSchema.parse({ revisionId: id, previousRevisionId: before.revisionId, sourceRevision: before.revisionId,
      source: request.kind, summary: request.summary, acceptedAt: new Date().toISOString(), requestId: request.requestId,
      programFingerprint: identity(tree), briefFingerprint: record.identity?.brief, inputFingerprint: record.identity?.input, acceptance: request.acceptance });
    // 未发布目录属于内部成果；回执不明时保留，不能删除可能已被指针引用的字节。
    await mkdir(root); await writeTree(join(root, 'render-program'), tree);
    const bytes = Buffer.from(JSON.stringify(revision));
    if (bytes.length > 1048576) throw new Error('发布证据超过 1 MiB');
    await writeBytes(join(root, 'revision.json'), bytes); await syncDirectory(root); await syncDirectory(join(internal, 'revisions'));
    const refs = [{ revisionId: id, metadata: hash(bytes), program: identity(tree), requestId: request.requestId }, ...(before.history ?? [previous.ref])];
    const next = pointerSchema.parse({ ...before, revisionId: id, history: refs.slice(0,20), pruned: refs.slice(20).map(ref => ref.revisionId),
      update: { hasDesign: true, undo: { requestId: request.requestId, kind: request.kind, at: revision.acceptedAt!, previousRevisionId: hasDesign ? before.revisionId : null, revisionId: id },
        result: { requestId: request.requestId, operationId: request.requestId, status: 'published' } } });
    await commitUpdate(beforeBytes, next, async () => {
      await validate(); await verifyRevision(project, before.revisionId);
      if (!(await regular(join(root, 'revision.json'), 1048576)).equals(bytes) || identity(await readTree(join(root, 'render-program'))) !== revision.programFingerprint) throw new CandidateError('UPDATE_INTEGRITY_FAILED', '待发布设计字节已变化。');
    });
    return { status: 'published' as const, revision };
  }
  async function undoUpdate(request: { requestId: string; operationId: string }, validate: () => Promise<void>) {
    uuid.parse(request.requestId); uuid.parse(request.operationId);
    const beforeBytes = await regular(join(internal, 'current.json'), 16384), before = await readCurrentPointer(project);
    const result = { status: 'undone' as const, requestId: request.requestId, operationId: request.operationId };
    if (before.update?.result.requestId === request.requestId && before.update.result.operationId === request.operationId && before.update.result.status === 'undone') return result;
    const undo = before.update?.undo;
    if (!undo || undo.requestId !== request.operationId) throw new CandidateError('UPDATE_NOT_UNDOABLE', '此更新已不可撤回，请核对最近操作。');
    const target = undo.previousRevisionId ?? before.revisionId;
    await verifyRevision(project, target);
    const refs = before.history!;
    const next = pointerSchema.parse({ ...before, revisionId: target, history: [refs.find(ref => ref.revisionId === target)!, ...refs.filter(ref => ref.revisionId !== target)],
      update: { hasDesign: undo.previousRevisionId !== null, undo: null, result: { ...result } } });
    await commitUpdate(beforeBytes, next, async () => { await validate(); await verifyRevision(project, target); });
    return result;
  }
  return { history, cleanup, accept, updateState, publishUpdate, undoUpdate, verify: (id: string) => verifyRevision(project, id) };
}

/** 指纹只消费提交时的旧检查点；后续新任务不会被旧收尾删除。 */
export async function taskCheckpointFingerprint(project: string) {
  try { return hash(await regular(join(project, '.narracut/agent-task.json'), 20_000_000)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
export async function endedTaskReason(project: string) {
  const fingerprint = await taskCheckpointFingerprint(project);
  if (!fingerprint) return null;
  if ((await readCurrentPointer(project)).consumed?.taskCheckpoint === fingerprint) return 'CANDIDATE_ACCEPTED' as const;
  try {
    const candidate = JSON.parse((await regular(join(project, '.narracut/candidate.json'), 4194304)).toString());
    if (candidate.candidate === null && candidate.checkpoint === null && candidate.taskCheckpoint === fingerprint) return 'CANDIDATE_ABANDONED' as const;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return null;
}
export async function cleanupEndedTask(project: string) {
  if (await endedTaskReason(project)) await rm(join(project, '.narracut/agent-task.json'), { force: true });
}

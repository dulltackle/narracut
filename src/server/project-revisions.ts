import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { rename, rm, mkdir, lstat } from 'node:fs/promises';
import { z } from 'zod';
import { regular, directory, readTree, identity, writeTree, writeBytes, syncDirectory, CandidateError } from './project-candidate';
const uuid = z.string().uuid(), digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const refSchema = z.object({ revisionId: uuid, metadata: digest, program: digest, requestId: uuid.optional() }).strict();
const pointerSchema = z.object({ revisionId: uuid, history: z.array(refSchema).min(1).max(20).optional(),
  consumed: z.object({ pointer: digest, generation: z.string().regex(/^\.narracut\/candidate-[0-9a-f-]{36}$/), requestId: uuid }).strict().optional(),
  pruned: z.array(uuid).max(1).optional(),
}).strict().superRefine((value, ctx) => {
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
export function createRevisionStore(project: string, assertWritable: () => Promise<void>) {
  const internal = join(project, '.narracut');
  async function history() {
    await assertWritable(); const pointer = await readCurrentPointer(project);
    const refs = pointer.history ?? [(await verifyRevision(project, pointer.revisionId)).ref];
    const revisions = await Promise.all(refs.map(async ref => {
      try { return { ...(await verifyRevision(project, ref.revisionId)).metadata, current: ref.revisionId === pointer.revisionId, valid: true, error: null }; }
      catch (error) { return { revisionId: ref.revisionId, current: ref.revisionId === pointer.revisionId, valid: false, error: (error as Error).message, requestId: ref.requestId ?? (ref.revisionId === pointer.revisionId ? pointer.consumed?.requestId : undefined), summary: '已接受修订 · 完整性失败' } as Partial<Revision> & { revisionId: string; current: boolean; valid: boolean; error: string | null }; }
    }));
    const pendingPaths = [...(pointer.consumed ? ['candidate', 'checkpoint'].map(name => join(project, pointer.consumed!.generation, name)) : []), ...(pointer.pruned ?? []).map(id => join(internal, 'revisions', id))];
    const cleanupPending = (await Promise.all(pendingPaths.map(path => lstat(path).then(() => true, error => error.code !== 'ENOENT')))).some(Boolean);
    return { current: pointer.revisionId, limit: 20, revisions, cleanupPending };
  }
  async function cleanup() {
    await assertWritable(); const pointer = await readCurrentPointer(project);
    try {
      await syncDirectory(internal);
      if (pointer.consumed) {
        const path = join(internal, 'candidate.json');
        let bytes: Buffer | undefined;
        try { bytes = await regular(path, 4194304); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (bytes && hash(bytes) === pointer.consumed.pointer) {
          const state = JSON.parse(bytes.toString());
          const temp = join(internal, `consumed-${randomUUID()}.json`);
          try {
            await writeBytes(temp, Buffer.from(JSON.stringify({ ...state, candidate: null, checkpoint: null })));
            await assertWritable();
            if (!bytes.equals(await regular(path, 4194304))) throw new Error('清理期间候选指针变化');
            await rename(temp, path); await syncDirectory(internal);
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
      const next = pointerSchema.parse({ revisionId: id, history: all.slice(0, 20), pruned: all.slice(20).map(item => item.revisionId), consumed: { pointer: hash(raw), generation: state.candidate!.path.replace(/\/candidate$/, ''), requestId } });
      await writeBytes(temporary, Buffer.from(JSON.stringify(next)));
      await validate(); await assertWritable();
      if (!beforeBytes.equals(await regular(join(internal, 'current.json'), 16384))) throw new Error('当前指针在提交前发生变化');
      await verifyRevision(project, before.revisionId);
      if (!(await regular(join(root, 'revision.json'), 1048576)).equals(bytes) || identity(await readTree(join(root, 'render-program'))) !== revision.programFingerprint) throw new Error('待提交修订在复核期间被改写');
      await rename(temporary, join(internal, 'current.json')); committed = true;
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
  return { history, cleanup, accept, verify: (id: string) => verifyRevision(project, id) };
}

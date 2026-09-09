import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { link, lstat, open, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { RECOVERY_LIMIT, RECOVERY_BRIEF_LIMIT, recoveryBaselineEntry, recoveryHash, validateRecovery } from './project-recovery';
import { decodeUtf8, inspectProjectVNext, MANIFEST_JSON_LIMITS, PROJECT_JSON_LIMITS, validateProjectVNextForSave, validateProjectVNextResources, readBoundedControlFile, type ProjectManifestVNext } from './project-vnext-inspection';
import { parseStrictJson } from './strict-json';
import { createCandidateManager, syncDirectory } from './project-candidate';
import { readCurrentPointer, verifyRevision } from './project-revisions';
import { assertPersistentSame, walkPersistentProject } from './project-copy';
import { RecoveryPublicationUncertain, publishProjectVNext } from './project-lifecycle';

export class RecoveryError extends Error {
  constructor(readonly code: string, readonly path: string, message: string) { super(message); }
}
export type RecoveryProblem = { code: string; path: string; message: string; next: string };
export type RecoveryPlan = {
  planId: string; snapshotPath: string; sourcePath: string; projectId: string; capturedAt: string;
  rebuildManifest: boolean; blockers: RecoveryProblem[];
  dsl: { from: 'snapshot' | 'source'; bytes: number };
  brief: { base?: string; local?: string; disk?: string; result?: string; conflict: boolean; decision: 'source' | 'local' | 'resolved' | 'required' };
  program: { current?: string; history: string[]; candidate?: string | null; checkpoint?: string | null };
  payloads: string[]; baseline: unknown; sourceFingerprint: string;
};
const inside = (root: string, path: string) => { const rel = relative(root, path); return !rel || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
const textPayload = (item: { base64: string } | undefined) => item === undefined ? undefined : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(item.base64, 'base64'));
export async function inspectRecovery(snapshotPath: string) {
  try {
    const bytes = await readBoundedControlFile(resolve(snapshotPath), 'recovery', RECOVERY_LIMIT);
    return validateRecovery(bytes);
  } catch (error) {
    const diagnostic = (error as any).diagnostics?.[0];
    if (diagnostic?.code === 'PROJECT_CONTROL_FILE_LIMIT_EXCEEDED') throw Object.assign(new RecoveryError('RECOVERY_SNAPSHOT_LIMIT_EXCEEDED', snapshotPath, diagnostic.message), diagnostic, { code: 'RECOVERY_SNAPSHOT_LIMIT_EXCEEDED' });
    if (['ENOENT', 'EACCES', 'ENOTDIR'].includes((error as any).code)) throw new RecoveryError('RECOVERY_SNAPSHOT_UNAVAILABLE', snapshotPath, '恢复快照不可读取，请检查明确路径与权限。');
    throw error;
  }
}
function problem(error: unknown, path: string): RecoveryProblem {
  const value = error as { code?: string; path?: string; message?: string };
  return { code: value.code ?? 'RECOVERY_BASELINE_MISMATCH', path: value.path ?? path, message: value.message ?? String(error), next: '修复此来源内容或明确选择另一份匹配来源，然后重新检查。' };
}
async function sourceManifest(source: string, projectId: string): Promise<{ manifest: ProjectManifestVNext; rebuild: boolean }> {
  const path = join(source, 'narracut.json');
  let parsed: any;
  try {
    const bytes = await readBoundedControlFile(path, 'narracut.json', 4096);
    parsed = parseStrictJson(decodeUtf8(bytes, path, 'narracut.json', false), MANIFEST_JSON_LIMITS);
  } catch (error) {
    // 缺失或损坏清单可以重建；路径不可读、链接和资源预算错误不能作为重建借口。
    const code = (error as any).code;
    if (code !== 'ENOENT' && !['PROJECT_CONTENT_INVALID', 'PROJECT_CONTROL_FILE_INVALID_JSON', 'PROJECT_CONTROL_FILE_DUPLICATE_FIELD'].includes(code)) throw error;
    if ((error as any).diagnostics?.some((item: any) => ['PROJECT_CONTROL_FILE_LIMIT_EXCEEDED', 'PROJECT_REQUIRED_CONTENT_INVALID'].includes(item.code))) throw error;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (z.uuid().safeParse(parsed.projectId).success && parsed.projectId !== projectId) throw new RecoveryError('RECOVERY_SOURCE_PROJECT_ID_MISMATCH', path, '来源 Project ID 与快照不同，不能恢复。');
    if (Number.isInteger(parsed.formatVersion) && parsed.formatVersion !== 1) throw new RecoveryError('RECOVERY_SOURCE_PROJECT_FORMAT_MISMATCH', path, '来源格式与快照不同，不能恢复。');
  }
  const valid = parsed?.kind === 'narracut-project' && parsed.formatVersion === 1 && parsed.projectId === projectId && Object.keys(parsed).length === 3;
  return { manifest: { kind: 'narracut-project', formatVersion: 1, projectId }, rebuild: !valid };
}
async function verifyPrograms(source: string) {
  const pointer = await readCurrentPointer(source);
  const history = pointer.history?.map(ref => ref.revisionId) ?? [pointer.revisionId];
  const problems: RecoveryProblem[] = [];
  for (const id of history) {
    try { await verifyRevision(source, id); } catch (error) { problems.push(problem(error, join(source, '.narracut/revisions', id))); }
  }
  const candidate = await (await createCandidateManager(source, async () => {}))({ action: 'read' });
  if (candidate.error || ['integrity-failed', 'external-change'].includes(candidate.status)) problems.push(problem(candidate.error ?? new Error('候选完整性无效。'), join(source, '.narracut/candidate.json')));
  return { problems, program: { current: pointer.revisionId, history, candidate: candidate.candidate?.path ?? null, checkpoint: candidate.checkpoint?.path ?? null } };
}
export async function planRecovery(snapshotPath: string, sourcePath: string, briefResult?: string): Promise<RecoveryPlan> {
  if (!sourcePath) throw new RecoveryError('RECOVERY_SOURCE_UNAVAILABLE', sourcePath, '必须明确指定来源目录。');
  const snapshot = await inspectRecovery(snapshotPath);
  const source = resolve(sourcePath), blockers: RecoveryProblem[] = [];
  let rebuildManifest = false, sourceFingerprint = '', program: RecoveryPlan['program'] = { history: [] };
  const local = textPayload(snapshot.payload.briefLocal), base = textPayload(snapshot.payload.briefBase);
  const brief: RecoveryPlan['brief'] = { local, base, conflict: false, decision: local === undefined ? 'source' : 'local' };
  let dslBytes = snapshot.payload.dsl?.bytes ?? 0, matched: Record<string, unknown> = {};
  const collect = async (path: string, action: () => Promise<void>) => {
    try { await action(); }
    catch (error) {
      const diagnostics = (error as any).diagnostics;
      if (diagnostics?.length) for (const diagnostic of diagnostics) blockers.push(problem({ ...diagnostic, path: join(source, diagnostic.component ?? '') }, path));
      else blockers.push(problem(error, path));
    }
  };
  await collect(source, async () => {
    const facts = await lstat(source);
    if (!facts.isDirectory() || facts.isSymbolicLink()) throw new Error('来源必须是明确指定的普通目录。');
    sourceFingerprint = recoveryHash(JSON.stringify([...await walkPersistentProject(source, null, undefined, undefined, true)]));
  });
  await collect(join(source, 'narracut.json'), async () => {
    const result = await sourceManifest(source, snapshot.projectId); rebuildManifest = result.rebuild;
    await inspectProjectVNext(source, { recoveryManifest: result.manifest, verifyAllRenderPrograms: true });
  });
  // 每一条原始字节基线独立收集问题，二选一必须命中完整指纹与全部绑定。
  for (const key of ['dsl', 'brief', 'current', 'candidate'] as const) {
    await collect(join(source, snapshot.baseline[key][0]!.path), async () => {
      const observed = await recoveryBaselineEntry(source, key);
      const match = snapshot.baseline[key].find(entry => isDeepStrictEqual(entry, observed));
      if (!match) throw new RecoveryError('RECOVERY_BASELINE_MISMATCH', join(source, snapshot.baseline[key][0]!.path), `${snapshot.baseline[key][0]!.path} 的原始字节或对象绑定不匹配。`);
      matched[key] = match;
    });
  }
  await collect(join(source, '.narracut'), async () => { const result = await verifyPrograms(source); program = result.program; blockers.push(...result.problems); });
  await collect(join(source, 'video.md'), async () => {
    brief.disk = decodeUtf8(await readBoundedControlFile(join(source, 'video.md'), 'video.md', RECOVERY_BRIEF_LIMIT), 'video.md', 'video.md', true);
    brief.conflict = local !== undefined && base !== undefined && base !== brief.disk && local !== brief.disk && local !== base;
    brief.result = local === undefined || local === base ? brief.disk : local;
    if (brief.conflict) { brief.decision = 'required'; delete brief.result; }
    if (briefResult !== undefined) {
      const bytes = Buffer.from(briefResult);
      if (bytes.length > RECOVERY_BRIEF_LIMIT || decodeUtf8(bytes, 'briefResult', 'video.md', true) !== briefResult) throw new Error('Brief 结果必须是最多 2 MiB 的严格 UTF-8。');
      brief.result = briefResult; brief.decision = 'resolved'; brief.conflict = false;
    }
  });
  if (snapshot.payload.dsl) await collect(join(source, 'project.json'), async () => {
    const project = validateProjectVNextForSave(parseStrictJson(textPayload(snapshot.payload.dsl)!, PROJECT_JSON_LIMITS)).project;
    await validateProjectVNextResources(source, project);
  });
  if (!snapshot.payload.dsl) await collect(join(source, 'project.json'), async () => { dslBytes = (await lstat(join(source, 'project.json'))).size; });
  if (brief.conflict) blockers.push({ code: 'RECOVERY_BRIEF_RESOLUTION_REQUIRED', path: join(source, 'video.md'), message: 'Brief BASE、LOCAL 与 DISK 存在冲突，需要明确完整结果。', next: '对照三份内容，编辑完整结果并返回恢复计划。' });
  await collect(source, async () => {
    if (sourceFingerprint && sourceFingerprint !== recoveryHash(JSON.stringify([...await walkPersistentProject(source, null, undefined, undefined, true)]))) throw new RecoveryError('RECOVERY_SOURCE_CHANGED_DURING_COPY', source, '检查期间来源发生变化，请重新检查。');
  });
  const sorted = [...new Map(blockers.map(item => [`${item.path}:${item.code}:${item.message}`, item])).values()].sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  const planId = recoveryHash(JSON.stringify([snapshot.sha256, source, sourceFingerprint, brief.result, matched]));
  return { planId, snapshotPath: resolve(snapshotPath), sourcePath: source, projectId: snapshot.projectId, capturedAt: snapshot.capturedAt, rebuildManifest, blockers: sorted.length <= 100 ? sorted : [...sorted.slice(0, 99), { code: 'DIAGNOSTICS_TRUNCATED', path: source, message: `还有 ${sorted.length - 99} 条阻断问题未展示。`, next: '先修复已列问题，然后重新检查。' }], dsl: { from: snapshot.payload.dsl ? 'snapshot' : 'source', bytes: dslBytes }, brief, program, payloads: Object.keys(snapshot.payload), baseline: matched, sourceFingerprint };
}
export type RecoverOptions = { planId: string; briefResult?: string; confirmTemporaryCleanup?: boolean; signal?: AbortSignal; onPhase?: (phase: 'copying' | 'applying' | 'validating' | 'publishing') => void };
export async function recoverProject(snapshotPath: string, sourcePath: string, targetPath: string, options: RecoverOptions) {
  const plan = await planRecovery(snapshotPath, sourcePath, options.briefResult);
  if (plan.blockers.length) throw new RecoveryError(plan.blockers[0]!.code, sourcePath, plan.blockers.map(item => item.message).join('\n'));
  if (plan.planId !== options.planId) throw new RecoveryError('RECOVERY_SOURCE_CHANGED_DURING_COPY', sourcePath, '来源或恢复内容已变化，请返回重新检查。');
  const source = await realpath(sourcePath);
  let target: string;
  try { target = join(await realpath(dirname(resolve(targetPath))), basename(resolve(targetPath))); }
  catch { throw new RecoveryError('RECOVERY_TARGET_UNAVAILABLE', targetPath, '目标父目录不可读取，请选择可用的父目录。'); }
  if (inside(source, target)) throw new RecoveryError('RECOVERY_TARGET_UNAVAILABLE', target, '恢复目标必须位于来源项目之外。');
  const snapshot = await inspectRecovery(snapshotPath);
  const identifiers = [plan.projectId, plan.program.current!];
  const result = await publishProjectVNext(target, { confirmTemporaryCleanup: options.confirmTemporaryCleanup, createId: () => identifiers.shift()! }, 'recover', async temporary => {
    options.signal?.throwIfAborted(); options.onPhase?.('copying');
    const copied = await walkPersistentProject(source, temporary, options.signal);
    assertPersistentSame(copied, await walkPersistentProject(temporary, null, options.signal));
    options.signal?.throwIfAborted(); options.onPhase?.('applying');
    const write = async (path: string, bytes: Buffer) => { const handle = await open(join(temporary, path), 'w', 0o600); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } };
    if (plan.rebuildManifest) await write('narracut.json', Buffer.from(JSON.stringify({ kind: 'narracut-project', formatVersion: 1, projectId: plan.projectId })));
    if (snapshot.payload.dsl) await write('project.json', Buffer.from(snapshot.payload.dsl.base64, 'base64'));
    await write('video.md', Buffer.from(plan.brief.result!));
    options.signal?.throwIfAborted(); options.onPhase?.('validating');
    await inspectProjectVNext(temporary, { verifyAllRenderPrograms: true });
    const checked = await verifyPrograms(temporary);
    if (checked.problems.length) throw new Error(checked.problems.map(item => item.message).join('\n'));
    for (const [path, kind] of [...copied].reverse()) if (kind === 'directory') await syncDirectory(join(temporary, path));
    options.signal?.throwIfAborted(); options.onPhase?.('publishing');
    const current = await planRecovery(snapshotPath, sourcePath, options.briefResult);
    if (current.planId !== plan.planId || current.blockers.length) throw new RecoveryError('RECOVERY_SOURCE_CHANGED_DURING_COPY', sourcePath, '复制期间来源发生变化，已取消发布；请重新检查。');
    options.signal?.throwIfAborted();
  });
  return { ...result, revisionId: plan.program.current! };
}
export async function extractRecovery(snapshotPath: string, sourcePath: string, component: 'dsl' | 'briefLocal' | 'briefBase', targetPath: string) {
  const snapshot = await inspectRecovery(snapshotPath), plan = await planRecovery(snapshotPath, sourcePath);
  if (!plan.blockers.some(item => item.code !== 'RECOVERY_BRIEF_RESOLUTION_REQUIRED')) throw new RecoveryError('RECOVERY_EXTRACTION_UNAVAILABLE', sourcePath, '完整恢复未被来源问题阻断，请使用恢复计划。');
  const payload = snapshot.payload[component];
  if (!payload) throw new RecoveryError('RECOVERY_PAYLOAD_MISSING', snapshotPath, '快照不包含所选内容。');
  const parent = await realpath(dirname(resolve(targetPath))), target = join(parent, basename(resolve(targetPath)));
  for (const root of [sourcePath, snapshot.sourcePath]) if (inside(await realpath(root).catch(() => resolve(root)), target)) throw new RecoveryError('RECOVERY_TARGET_UNAVAILABLE', target, '提取文件必须位于项目之外。');
  // 任何项目的子目录都不能作为普通提取物的落点。
  for (let ancestor = parent; ; ancestor = dirname(ancestor)) {
    try { await lstat(join(ancestor, 'narracut.json')); throw new RecoveryError('RECOVERY_TARGET_UNAVAILABLE', target, '提取文件不能写入项目目录。'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (ancestor === dirname(ancestor)) break;
  }
  const parentHandle = await open(parent, 'r'), parentIdentity = await parentHandle.stat();
  const anchor = process.platform === 'win32' ? parent : `/dev/fd/${parentHandle.fd}`;
  const temporary = join(anchor, `.extract-${randomUUID()}.tmp`), destination = join(anchor, basename(target));
  let temporaryIdentity: { dev: number; ino: number } | undefined, linkAttempted = false;
  let failure: Error | undefined;
  let published: { path: string; component: string; kind: 'file'; cleanupWarning?: { path: string; message: string } } | undefined;
  const verifyParent = async () => {
    const current = await lstat(parent);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== parentIdentity.dev || current.ino !== parentIdentity.ino) throw new Error('提取目录已变化，请保留现场并核对结果。');
  };
  try {
    await verifyParent();
    const handle = await open(temporary, 'wx', 0o600);
    temporaryIdentity = await handle.stat();
    try { await handle.writeFile(Buffer.from(payload.base64, 'base64')); await handle.sync(); } finally { await handle.close(); }
    await verifyParent();
    linkAttempted = true; await link(temporary, destination);
    await verifyParent(); await parentHandle.sync();
    published = { path: target, component, kind: 'file' };
    return published;
  } catch (error) {
    failure = linkAttempted && (error as NodeJS.ErrnoException).code !== 'EEXIST' ? new ExtractionUncertain(target, component, payload.sha256, join(parent, basename(temporary)), temporaryIdentity!) : error as Error;
    throw failure;
  } finally {
    try {
      const facts = await lstat(temporary).catch(() => null);
      if (facts && temporaryIdentity && facts.dev === temporaryIdentity.dev && facts.ino === temporaryIdentity.ino) await rm(temporary);
    } catch (error) {
      if (published) published.cleanupWarning = { path: join(parent, basename(temporary)), message: `提取已完成；本次临时文件尚未清理：${(error as Error).message}` };
      else if (failure) failure.message += ` 本次临时文件尚未清理：${join(parent, basename(temporary))}。`;
    } finally {
      try { await parentHandle.close(); } catch (error) {
        if (published) published.cleanupWarning ??= { path: parent, message: `提取已完成；目录句柄收尾失败：${(error as Error).message}` };
      }
    }
  }
}

class ExtractionUncertain extends RecoveryError {
  constructor(path: string, readonly component: string, readonly expectedHash: string, readonly temporaryPath: string, readonly temporaryIdentity: { dev: number; ino: number }) { super('RECOVERY_PUBLISH_FAILED', path, '提取已进入提交阶段，正在核对持久结果。'); }
}

/** 宿主保留单次操作回执；响应丢失只查询同一 ID，不能启动第二次发布。 */
export class RecoveryOperations {
  #operations = new Map<string, { signature: string; state: Record<string, any>; controller: AbortController; done: Promise<void> }>();
  async call(input: any) {
    const schema = z.object({ action: z.enum(['inspect', 'plan', 'content', 'recover', 'extract', 'status', 'cancel']), snapshotPath: z.string().optional(), sourcePath: z.string().optional(), targetPath: z.string().optional(), planId: z.string().optional(), briefResult: z.string().optional(), component: z.enum(['dsl', 'briefLocal', 'briefBase']).optional(), operationId: z.uuid().optional(), confirmTemporaryCleanup: z.boolean().optional() }).strict();
    input = schema.parse(input);
    if (['status', 'cancel'].includes(input.action)) {
      const operation = this.#operations.get(input.operationId);
      if (!operation) throw new RecoveryError('RECOVERY_OPERATION_UNKNOWN', '', '尚未收到该恢复请求；请使用原操作 ID 重试。');
      if (input.action === 'cancel' && operation.state.phase !== 'publishing') operation.controller.abort();
      if (operation.state.status === 'uncertain' && operation.state.uncertain instanceof RecoveryPublicationUncertain) {
        try {
          operation.state.result = await operation.state.uncertain.reconcile(); operation.state.status = 'completed'; delete operation.state.uncertain;
        } catch { /* 保留不明状态，不启动第二次发布。 */ }
      }
      if (operation.state.status === 'uncertain' && operation.state.uncertain instanceof ExtractionUncertain) {
        const error = operation.state.uncertain as ExtractionUncertain;
        try {
          const residue = await lstat(error.temporaryPath).catch(() => null);
          const target = await lstat(error.path);
          if (residue && residue.dev === error.temporaryIdentity.dev && residue.ino === error.temporaryIdentity.ino && target.dev === residue.dev && target.ino === residue.ino) await rm(error.temporaryPath);
          const bytes = await readBoundedControlFile(error.path, error.component, error.component === 'dsl' ? 10 * 1024 * 1024 : RECOVERY_BRIEF_LIMIT);
          if (recoveryHash(bytes) !== error.expectedHash) throw error;
          await syncDirectory(dirname(error.path));
          operation.state.status = 'completed'; operation.state.result = { path: error.path, component: error.component, kind: 'file' };
          delete operation.state.uncertain;
        } catch { /* 结果仍不明确，只允许继续核对同一操作。 */ }
      }
      return { ...operation.state };
    }
    if (!input.snapshotPath) throw new Error('请选择恢复快照。');
    if (input.action === 'inspect' || input.action === 'content') {
      const snapshot = await inspectRecovery(input.snapshotPath);
      if (input.action === 'content') {
        if (!input.component || !snapshot.payload[input.component as keyof typeof snapshot.payload]) throw new Error('快照不包含所选内容。');
        return { content: textPayload(snapshot.payload[input.component as keyof typeof snapshot.payload]) };
      }
      return { snapshotPath: resolve(input.snapshotPath), projectId: snapshot.projectId, capturedAt: snapshot.capturedAt, sourceHint: snapshot.sourcePath, snapshotId: snapshot.snapshotId, sha256: snapshot.sha256, baseline: snapshot.baseline, payloads: Object.entries(snapshot.payload).map(([component, item]) => ({ component, bytes: item.bytes, sha256: item.sha256 })) };
    }
    if (!input.sourcePath) throw new Error('必须明确指定来源目录。');
    if (input.action === 'plan') return await planRecovery(input.snapshotPath, input.sourcePath, input.briefResult);
    if (!input.operationId || !input.targetPath) throw new Error('发布需要操作 ID 与明确的新目标。');
    const signature = JSON.stringify(input), previous = this.#operations.get(input.operationId);
    if (previous) {
      if (previous.signature !== signature) throw new Error('操作 ID 与恢复内容或目标不匹配。');
      return { ...previous.state };
    }
    if ([...this.#operations.values()].some(item => ['running', 'uncertain'].includes(item.state.status))) throw new Error('另一项恢复或提取操作尚未结束。');
    if (input.action === 'recover' && !input.planId) throw new Error('请先检查并确认恢复计划。');
    if (input.action === 'extract' && !input.component) throw new Error('请选择提取内容。');
    const state: Record<string, any> = { operationId: input.operationId, status: 'running', phase: 'checking', targetPath: input.targetPath };
    const controller = new AbortController();
    const done = (async () => {
      try {
        const result = input.action === 'recover'
          ? await recoverProject(input.snapshotPath, input.sourcePath, input.targetPath, { planId: input.planId, briefResult: input.briefResult, confirmTemporaryCleanup: input.confirmTemporaryCleanup, signal: controller.signal, onPhase: phase => { state.phase = phase; } })
          : await extractRecovery(input.snapshotPath, input.sourcePath, input.component, input.targetPath);
        state.status = 'completed'; state.result = result;
      } catch (error) {
        if (error instanceof ExtractionUncertain || error instanceof RecoveryPublicationUncertain) { state.status = 'uncertain'; state.uncertain = error; }
        else { state.status = 'failed'; state.error = problem(error, input.targetPath); }
      }
    })();
    this.#operations.set(input.operationId, { signature, state, controller, done });
    return { ...state };
  }
  async close() { await Promise.all([...this.#operations.values()].map(item => item.done)); }
}

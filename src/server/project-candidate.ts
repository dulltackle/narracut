import type { RecoveryCommit } from './project-recovery';
import { createRevisionStore, readCurrentPointer, taskCheckpointFingerprint, cleanupEndedTask } from './project-revisions';
import { buildProgramBundle, type ProgramBuildRequest } from './program-bundle';
import { coordinateDependencies, verifyPackageBytes, type DependencyUpdate, type OfflinePackages } from './project-dependencies';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class CandidateError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export type CandidateRequest = DependencyUpdate & {
  action: 'read' | 'create' | 'apply' | 'discard' | 'dependencies' | 'adopt';
  baseline?: string;
  sourceRevision?: string;
  confirmed?: boolean;
  changes?: Array<{ path: string; content: string | null }>;
};
type TreeRef = { path: string; identity: string };
type State = { version: 1; sourceRevision: string; candidate: TreeRef | null; checkpoint: TreeRef | null; offline?: string; offlineIdentity?: string; offlineKeys?: string[]; taskCheckpoint?: string };
export type CandidateStatus = {
  status: 'absent' | 'saved' | 'external-change' | 'integrity-failed';
  baseline: string;
  sourceRevision: string;
  candidate: TreeRef | null;
  checkpoint: TreeRef | null;
  offline?: string;
  error?: { code: string; message: string };
};
type Tree = Map<string, Buffer | null>;
const hash = (bytes: string | Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fail = (code: string, message: string): never => { throw new CandidateError(code, message); };
const MAX_BYTES = 32 * 1024 * 1024;
const safePath = (path: string) => path.length <= 1024 && !path.includes('\\') && !path.includes('\0') &&
  path.split('/').every(p => p && p !== '.' && p !== '..' && !['node_modules', 'bundle', '.cache'].includes(p));
export async function regular(path: string, max = MAX_BYTES) {
  const facts = await lstat(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > max) throw new Error('文件类型或大小无效');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) throw new Error('文件类型或大小无效');
    return await handle.readFile();
  } finally { await handle.close(); }
}
export async function directory(path: string) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('目录完整性无效');
  return `${stat.dev}:${stat.ino}`;
}
export async function readTree(root: string): Promise<Tree> {
  const tree: Tree = new Map();
  let bytes = 0;
  async function walk(path: string, prefix: string, depth: number) {
    if (depth > 24) throw new Error('程序树超过 24 层');
    const identity = await directory(path);
    for (const name of (await readdir(path)).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (!safePath(relative) || tree.size >= 4096) throw new Error('程序树路径或数量无效');
      const full = join(path, name);
      const stat = await lstat(full);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        tree.set(relative, null);
        await walk(full, relative, depth + 1);
      } else {
        const content = await regular(full);
        bytes += content.length;
        if (bytes > MAX_BYTES) throw new Error('程序树超过 32 MiB');
        tree.set(relative, content);
      }
    }
    if (await directory(path) !== identity) throw new Error('读取期间目录被替换');
  }
  await walk(root, '', 0);
  for (const required of ['program.json', 'package.json', 'pnpm-lock.yaml', 'src/RenderProgram.tsx']) {
    if (!Buffer.isBuffer(tree.get(required))) throw new Error(`程序树缺少 ${required}`);
  }
  if (tree.get('src') !== null || tree.get('resources') !== null) throw new Error('程序树缺少 src/ 或 resources/');
  for (const path of tree.keys()) {
    if (!['program.json', 'package.json', 'pnpm-lock.yaml', 'src', 'resources'].includes(path) &&
      !path.startsWith('src/') && !path.startsWith('resources/')) throw new Error('程序树包含未允许的顶层路径');
  }
  return tree;
}
async function readOffline(project: string, state: State) {
  if (!state.offline) return undefined;
  if (!Array.isArray(state.offlineKeys) || state.offlineKeys.some(key => !/^[0-9a-f]{128}$/.test(key)) ||
      hash(JSON.stringify([...new Set(state.offlineKeys)].sort())) !== state.offlineIdentity) fail('DEPENDENCY_INTEGRITY_FAILED', '离线依赖索引无效。');
  const root = join(project, state.offline);
  await directory(dirname(root));
  const store: OfflinePackages = new Map();
  const rawStore: OfflinePackages = new Map();
  const observed: Array<[string, string]> = [];
  try { await directory(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { store, rawStore, intact: false, signature: hash('missing-directory') };
    throw error;
  }
  for (const filename of (await readdir(root)).sort()) {
    if (!/^[0-9a-f]{128}\.tgz$/.test(filename)) fail('DEPENDENCY_INTEGRITY_FAILED', '离线依赖库包含非法路径。');
    const bytes = await regular(join(root, filename));
    const key = filename.slice(0, -4);
    observed.push([key, hash(bytes)]); rawStore.set(key, bytes);
    try { verifyPackageBytes(key, bytes); store.set(key, bytes); }
    catch { /* 损坏字节只用于基线；只有显式协调可以重新下载。 */ }
  }
  return { store, rawStore, intact: offlineIdentity(store) === state.offlineIdentity && store.size === observed.length,
    signature: hash(JSON.stringify(observed)) };
}
const offlineIdentity = (store: OfflinePackages) => hash(JSON.stringify([...store.keys()].sort()));
const offlineSignature = (store: OfflinePackages) => hash(JSON.stringify([...store].sort(([a], [b]) => a.localeCompare(b)).map(([key, bytes]) => [key, hash(bytes)])));
export function identity(tree: Tree) {
  return hash(JSON.stringify([...tree].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, bytes]) => [path, bytes === null ? 'directory' : hash(bytes)])));
}
export async function writeBytes(path: string, bytes: Buffer) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
export async function writeTree(root: string, tree: Tree) {
  await mkdir(root);
  for (const [path, bytes] of [...tree].sort(([a], [b]) => a.length - b.length)) {
    if (bytes === null) await mkdir(join(root, path));
    else await writeBytes(join(root, path), bytes);
  }
  // 先持久化树内目录项，再发布单一候选/检查点指针。
  for (const [path, bytes] of [...tree].reverse()) if (bytes === null) await syncDirectory(join(root, path));
  await syncDirectory(root);
}
export async function syncDirectory(path: string) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** 所有调用由项目租约内的共享保存队列串行化；单一 rename 是批次提交点。 */
export async function createCandidateManager(project: string, assertWritable: () => Promise<void>, observeCommit?: RecoveryCommit) {
  const internal = join(project, '.narracut');
  const internalIdentity = await directory(internal);
  const pointer = join(internal, 'candidate.json');
  const assertCurrent = async () => {
    await assertWritable();
    if (await directory(internal) !== internalIdentity) fail('PROJECT_IDENTITY_LOST', '项目内部目录身份变化；已停止候选写入。');
  };
  async function currentRevision() {
    const value = await readCurrentPointer(project);
    if (!/^[0-9a-f-]{36}$/i.test(value.revisionId)) throw new Error('当前修订身份无效');
    return value.revisionId as string;
  }
  const revisions = createRevisionStore(project, assertCurrent, observeCommit);
  async function pointerBytes() {
    try { return await regular(pointer, 4 * 1024 * 1024); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  const refValid = (ref: TreeRef) => ref && /^\.narracut\/candidate-[0-9a-f-]{36}\/(candidate|checkpoint)$/.test(ref.path) && /^sha256:[0-9a-f]{64}$/.test(ref.identity);
  async function inspect(): Promise<{ view: CandidateStatus; state: State | null; tree?: Tree; offline?: Awaited<ReturnType<typeof readOffline>>; raw: Buffer | null }> {
    await assertCurrent();
    const sourceRevision = await currentRevision();
    let raw: Buffer | null = null;
    let state: State | null = null;
    try {
      raw = await pointerBytes();
      if (raw === null) return { view: { status: 'absent', sourceRevision, baseline: hash('absent'), candidate: null, checkpoint: null }, state: null, raw };
      const parsed = JSON.parse(raw.toString()) as State;
      if (parsed.version !== 1 || !/^[0-9a-f-]{36}$/i.test(parsed.sourceRevision) || !(parsed.candidate === null || refValid(parsed.candidate)) ||
        !(parsed.checkpoint === null || (refValid(parsed.checkpoint) && dirname(parsed.checkpoint.path) === dirname(parsed.candidate?.path ?? '') && parsed.checkpoint.path.endsWith('/checkpoint'))) || (parsed.candidate !== null && !parsed.candidate.path.endsWith('/candidate')) || (parsed.candidate === null && parsed.checkpoint !== null) || (parsed.offline !== undefined && !/^\.narracut\/candidate-[0-9a-f-]{36}\/dependencies$/.test(parsed.offline))) throw new Error('候选指针完整性无效');
      const accepted = await readCurrentPointer(project);
      if (accepted.consumed?.pointer === hash(raw)) { parsed.candidate = null; parsed.checkpoint = null; }
      state = parsed;
      const offline = await readOffline(project, state);
      if (!state.candidate) return { raw, state, offline, view: { status: 'absent', ...(offline && !offline.intact ? { error: { code: 'DEPENDENCY_INTEGRITY_FAILED', message: '保留离线库缺包或损坏；请先显式创建候选，再协调修复。' } } : {}), sourceRevision, baseline: hash(JSON.stringify([hash(raw), offline?.signature ?? null])), candidate: null, checkpoint: null, ...(state.offline ? { offline: state.offline } : {}) } };
      await directory(dirname(join(project, state.candidate.path)));
      const tree = await readTree(join(project, state.candidate.path));
      const treeId = identity(tree);
      let checkpointId: string | null = null;
      if (state.checkpoint) {
        await directory(dirname(join(project, state.checkpoint.path)));
        checkpointId = identity(await readTree(join(project, state.checkpoint.path)));
        if (checkpointId !== state.checkpoint.identity) throw new Error('恢复检查点字节发生变化');
      }
      const external = treeId !== state.candidate.identity;
      return { raw, state, tree, offline, view: {
        status: external ? 'external-change' : offline && !offline.intact ? 'integrity-failed' : 'saved', sourceRevision: state.sourceRevision,
        baseline: hash(JSON.stringify([hash(raw), treeId, checkpointId, offline?.signature ?? null])),
        candidate: { ...state.candidate, identity: treeId }, checkpoint: state.checkpoint,
        ...(state.offline ? { offline: state.offline } : {}),
        ...(!external && offline && !offline.intact ? { error: { code: 'DEPENDENCY_INTEGRITY_FAILED', message: '离线依赖库缺包或损坏；请显式协调修复，普通操作不会补包。' } } : {}),
        ...(external ? { error: { code: 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', message: '候选发生外部变化，外部字节已保留。需要重新检查；未提交修改不得覆盖。' } } : {}),
      } };
    } catch (error) {
      return { raw, state, view: { status: 'integrity-failed', sourceRevision, baseline: hash(raw ?? 'invalid'),
        candidate: state?.candidate ?? null, checkpoint: state?.checkpoint ?? null,
        error: { code: 'CANDIDATE_INTEGRITY_FAILED', message: `候选或恢复检查点完整性失败，已保留现场。请外部修复后重新检查，或明确放弃。${(error as Error).message}` },
      } };
    }
  }
  const operate = async (request: CandidateRequest, validate?: () => Promise<void>): Promise<CandidateStatus> => {
    if (request.action !== 'read') await revisions.cleanup();
    const before = await inspect();
    if (request.action === 'read') return before.view;
    if (request.action === 'create' && before.view.status !== 'absent') fail('CANDIDATE_ALREADY_EXISTS', '项目已经存在唯一候选；请继续使用或明确放弃。');
    if (request.action !== 'create' && request.baseline !== before.view.baseline) fail('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', '候选基线已变化；本批未保存，外部字节与恢复检查点已保留。');
    if (request.action === 'discard') {
      if (!request.confirmed) fail('CANDIDATE_DISCARD_CONFIRMATION_REQUIRED', '放弃不可撤销，需要明确确认。');
      if (before.view.status === 'absent') return before.view;
      await assertCurrent();
      if (!(await pointerBytes())?.equals(before.raw ?? Buffer.alloc(0))) fail('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', '候选指针已变化，未放弃。');
      {
        const taskCheckpoint = await taskCheckpointFingerprint(project);
        const tombstone = Buffer.from(JSON.stringify({ version: 1, sourceRevision: before.view.sourceRevision, ...before.state, candidate: null, checkpoint: null, taskCheckpoint }));
        const temporary = join(internal, `discard-${randomUUID()}.json`);
        try { await writeBytes(temporary, tombstone); await assertCurrent();
          if (!(await pointerBytes())?.equals(before.raw ?? Buffer.alloc(0))) fail('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', '候选指针已变化，未放弃。');
          if ((await inspect()).view.baseline !== before.view.baseline) fail('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', '候选字节已变化，请重新核对后明确放弃。');
          await validate?.(); observeCommit?.(pointer, tombstone, false); await rename(temporary, pointer); observeCommit?.(pointer, tombstone, true); }
        finally { await rm(temporary, { force: true }).catch(() => undefined); }
        await syncDirectory(internal).catch(() => undefined);
        await cleanupEndedTask(project).catch(() => undefined);
        for (const ref of [before.state?.candidate, before.state?.checkpoint]) if (ref) await rm(join(project, ref.path), { recursive: true, force: true }).catch(() => undefined);
        return { status: 'absent', baseline: hash(JSON.stringify([hash(tombstone), before.offline?.signature ?? null])), sourceRevision: before.view.sourceRevision, candidate: null, checkpoint: null, ...(before.state?.offline ? { offline: before.state.offline } : {}) };
      }
    }
    if (request.action === 'adopt' && !request.confirmed) fail('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', '需要明确确认外部候选。');
    if (request.action !== 'create' && ((before.view.status !== 'saved' && !(request.action === 'adopt' && before.view.status === 'external-change') && !(request.action === 'dependencies' && before.view.error?.code === 'DEPENDENCY_INTEGRITY_FAILED')) || !before.tree)) {
      fail(before.view.error?.code ?? 'CANDIDATE_MISSING', before.view.error?.message ?? '请先显式创建候选。');
    }
    const sourceRevision = await currentRevision();
    const creationRevision = request.action === 'create' && request.sourceRevision ? request.sourceRevision : sourceRevision;
    if (request.action === 'create') await revisions.verify(creationRevision);
    const currentRoot = join(internal, 'revisions', creationRevision, 'render-program');
    let next: Tree;
    let offline = request.action === 'create' ? before.offline?.rawStore : before.offline?.store;
    if (request.action === 'create') {
      await directory(join(internal, 'revisions'));
      await directory(dirname(currentRoot));
      next = await readTree(currentRoot);
    } else if (request.action === 'adopt') {
      next = new Map(before.tree);
    } else if (request.action === 'dependencies') {
      const retainedLocks: Buffer[] = [];
      await directory(join(internal, 'revisions'));
      for (const revision of await readdir(join(internal, 'revisions'))) {
        if (!/^[0-9a-f-]{36}$/i.test(revision)) fail('DEPENDENCY_LOCK_INVALID', '保留修订目录身份无效。');
        await directory(join(internal, 'revisions', revision));
        const retained = await readTree(join(internal, 'revisions', revision, 'render-program'));
        retainedLocks.push(retained.get('pnpm-lock.yaml')!);
      }
      if (before.state?.checkpoint) retainedLocks.push((await readTree(join(project, before.state.checkpoint.path))).get('pnpm-lock.yaml')!);
      const update = await coordinateDependencies(before.tree!.get('package.json')!, before.tree!.get('pnpm-lock.yaml')!, offline ?? new Map(), request, retainedLocks, before.state?.offlineKeys);
      if (before.state?.offlineKeys?.some(key => !update.store.has(key))) fail('DEPENDENCY_INTEGRITY_FAILED', '仍有保留离线包无法修复；请提供其精确版本和摘要。');
      next = new Map(before.tree);
      next.set('package.json', update.manifest);
      next.set('pnpm-lock.yaml', update.lock);
      offline = update.store;
    } else {
      next = new Map(before.tree);
      if (!Array.isArray(request.changes) || request.changes.length === 0 || request.changes.length > 256) fail('CANDIDATE_BATCH_INVALID', '修改批次必须包含 1–256 项。');
      const seen = new Set<string>();
      for (const change of request.changes!) {
        if (!change || typeof change.path !== 'string' || !safePath(change.path) ||
          !(change.path === 'program.json' || change.path.startsWith('src/') || change.path.startsWith('resources/')) ||
          !(change.content === null || typeof change.content === 'string') || seen.has(change.path)) fail('CANDIDATE_BATCH_INVALID', '批次路径、内容或重复项无效；依赖文件只能由依赖协调修改。');
        seen.add(change.path);
        if (next.get(change.path) === null) fail('CANDIDATE_BATCH_INVALID', '不能将目录作为文件修改。');
        if (change.content === null) next.delete(change.path);
        else {
          const bytes = Buffer.from(change.content, 'utf8');
          if (bytes.length > MAX_BYTES || bytes.toString() !== change.content) fail('CANDIDATE_BATCH_INVALID', '内容超限或不是严格 UTF-8。');
          const parts = change.path.split('/');
          for (let i = 1; i < parts.length; i++) {
            const parent = parts.slice(0, i).join('/');
            if (Buffer.isBuffer(next.get(parent))) fail('CANDIDATE_BATCH_INVALID', '文件与目录路径冲突。');
            next.set(parent, null);
          }
          next.set(change.path, bytes);
        }
      }
    }
    const generation = `.narracut/candidate-${randomUUID()}`;
    const root = join(project, generation);
    let committed = false;
    try {
      await assertCurrent();
      await mkdir(root);
      await writeTree(join(root, 'candidate'), next);
      if (offline) {
        await mkdir(join(root, 'dependencies'));
        for (const [key, bytes] of offline) await writeBytes(join(root, 'dependencies', `${key}.tgz`), bytes);
        await syncDirectory(join(root, 'dependencies'));
      }
      const treeId = identity(await readTree(join(root, 'candidate')));
      if (before.tree) await writeTree(join(root, 'checkpoint'), before.tree);
      const state: State = { version: 1, sourceRevision: request.action === 'create' ? creationRevision : before.state?.sourceRevision ?? sourceRevision,
        candidate: { path: `${generation}/candidate`, identity: treeId },
        checkpoint: before.tree ? { path: `${generation}/checkpoint`, identity: identity(before.tree) } : null,
        ...(offline ? { offline: `${generation}/dependencies`, offlineIdentity: request.action === 'create' && before.offline && !before.offline.intact ? before.state!.offlineIdentity : offlineIdentity(offline), offlineKeys: request.action === 'create' && before.offline && !before.offline.intact ? before.state!.offlineKeys : [...offline.keys()].sort() } : {}) };
      const bytes = Buffer.from(JSON.stringify(state));
      await writeBytes(join(root, 'state.json'), bytes);
      await syncDirectory(root);
      await assertCurrent();
      const latest = await inspect();
      if (latest.view.baseline !== before.view.baseline || latest.view.status !== before.view.status ||
        await currentRevision() !== sourceRevision ||
        (request.action === 'create' && identity(await readTree(currentRoot)) !== treeId)) fail('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', '提交前发生外部变化；本批未保存，上一份候选已保留。');
      await validate?.();
      observeCommit?.(pointer, bytes, false);
      await rename(join(root, 'state.json'), pointer);
      observeCommit?.(pointer, bytes, true);
      committed = true;
      await syncDirectory(internal).catch(() => undefined);
      if (before.state?.candidate || before.state?.offline) await rm(dirname(join(project, before.state.candidate?.path ?? before.state.offline!)), { recursive: true, force: true }).catch(() => undefined);
      return { status: request.action === 'create' && before.offline && !before.offline.intact ? 'integrity-failed' : 'saved',
        ...(request.action === 'create' && before.offline && !before.offline.intact ? { error: { code: 'DEPENDENCY_INTEGRITY_FAILED', message: '离线依赖库缺包或损坏；请显式协调修复，普通操作不会补包。' } } : {}), sourceRevision: state.sourceRevision,
        baseline: hash(JSON.stringify([hash(bytes), treeId, state.checkpoint?.identity ?? null, offline ? offlineSignature(offline) : null])),
        candidate: state.candidate, checkpoint: state.checkpoint, ...(state.offline ? { offline: state.offline } : {}) };
    } catch (error) {
      if (error instanceof CandidateError) throw error;
      return fail('CANDIDATE_SAVE_FAILED', `本批未保存，上一份候选与恢复检查点已保留。${(error as Error).message}`);
    } finally {
      if (!committed) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  };
  return Object.assign(operate, {
    history: revisions.history,
    cleanupAcceptance: revisions.cleanup,
    async accept(request: { baseline: string; summary: string; source: string; acceptance: Record<string, unknown>; requestId?: string }, validate: () => Promise<void>) {
      const before = await inspect();
      if (before.view.status !== 'saved' || !before.tree || !before.raw || before.view.baseline !== request.baseline) fail('ACCEPTANCE_STALE', '候选已变化或不完整，请重新审阅。');
      return revisions.accept(request, before.tree!, before.raw!, before.state!, async () => {
        await validate();
        const latest = await inspect();
        if (latest.view.status !== 'saved' || latest.view.baseline !== before.view.baseline) fail('ACCEPTANCE_STALE', '提交前候选已变化，请重新审阅。');
      });
    },
    async previewSource(target: 'current' | 'candidate') {
      const snapshot = await inspect();
      const revision = await currentRevision();
      if (target === 'current') await revisions.verify(revision);
      const tree = target === 'current' ? await readTree(join(internal, 'revisions', revision, 'render-program')) : snapshot.tree;
      if (!tree || (target === 'candidate' && snapshot.view.status !== 'saved')) fail('CANDIDATE_BASELINE_CONFLICT', '没有完整可播放程序。');
      return { revision, identity: identity(tree!), manifest: Buffer.from(tree!.get('program.json') ?? ''), baseline: snapshot.view.baseline, program: new Map([...tree!].filter((entry): entry is [string, Buffer] => entry[1] !== null).map(([path, bytes]) => [path, Buffer.from(bytes)])), offline: new Map([...(snapshot.offline?.store ?? [])].map(([key, bytes]) => [key, Buffer.from(bytes)])) };
    },
    async build(request: Omit<ProgramBuildRequest, 'program' | 'offline'> & { baseline: string; target?: 'current' | 'candidate'; sourceIdentity?: string }) {
      const before = await inspect();
      if ((request.target !== 'current' && (before.view.status !== 'saved' || !before.tree)) || before.view.baseline !== request.baseline) {
        throw new CandidateError('CANDIDATE_BASELINE_CONFLICT', '候选不完整或已变化；请重新读取后构建。');
      }
      const revision = await currentRevision();
      const tree = request.target === 'current' ? await readTree(join(internal, 'revisions', revision, 'render-program')) : before.tree!;
      if (request.sourceIdentity && request.sourceIdentity !== identity(tree)) fail('CANDIDATE_BASELINE_CONFLICT', '程序在构建前已变化。');
      const program = new Map([...tree].filter((entry): entry is [string, Buffer] => entry[1] !== null));
      const bundle = await buildProgramBundle({ ...request, program, offline: before.offline?.store ?? new Map() });
      const after = await inspect();
      if ((request.target !== 'current' && after.view.status !== 'saved') || after.view.baseline !== before.view.baseline || (request.target === 'current' && (await currentRevision() !== revision || identity(await readTree(join(internal, 'revisions', revision, 'render-program'))) !== identity(tree)))) {
        throw new CandidateError('CANDIDATE_BASELINE_CONFLICT', '构建期间候选或离线库已变化；结果已丢弃。');
      }
      return bundle;
    },
  });

}

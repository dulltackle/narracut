import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class CandidateError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export type CandidateRequest = {
  action: 'read' | 'create' | 'apply' | 'discard';
  baseline?: string;
  confirmed?: boolean;
  changes?: Array<{ path: string; content: string | null }>;
};
type TreeRef = { path: string; identity: string };
type State = { version: 1; sourceRevision: string; candidate: TreeRef; checkpoint: TreeRef | null };
export type CandidateStatus = {
  status: 'absent' | 'saved' | 'external-change' | 'integrity-failed';
  baseline: string;
  sourceRevision: string;
  candidate: TreeRef | null;
  checkpoint: TreeRef | null;
  error?: { code: string; message: string };
};
type Tree = Map<string, Buffer | null>;
const hash = (bytes: string | Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fail = (code: string, message: string): never => { throw new CandidateError(code, message); };
const MAX_BYTES = 32 * 1024 * 1024;
const safePath = (path: string) => path.length <= 1024 && !path.includes('\\') && !path.includes('\0') &&
  path.split('/').every(p => p && p !== '.' && p !== '..' && !['node_modules', 'bundle', '.cache'].includes(p));
async function regular(path: string, max = MAX_BYTES) {
  const facts = await lstat(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > max) throw new Error('文件类型或大小无效');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) throw new Error('文件类型或大小无效');
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function directory(path: string) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('目录完整性无效');
  return `${stat.dev}:${stat.ino}`;
}
async function readTree(root: string): Promise<Tree> {
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
function identity(tree: Tree) {
  return hash(JSON.stringify([...tree].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, bytes]) => [path, bytes === null ? 'directory' : hash(bytes)])));
}
async function writeBytes(path: string, bytes: Buffer) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function writeTree(root: string, tree: Tree) {
  await mkdir(root);
  for (const [path, bytes] of [...tree].sort(([a], [b]) => a.length - b.length)) {
    if (bytes === null) await mkdir(join(root, path));
    else await writeBytes(join(root, path), bytes);
  }
  // 先持久化树内目录项，再发布单一候选/检查点指针。
  for (const [path, bytes] of [...tree].reverse()) if (bytes === null) await syncDirectory(join(root, path));
  await syncDirectory(root);
}
async function syncDirectory(path: string) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** 所有调用由项目租约内的共享保存队列串行化；单一 rename 是批次提交点。 */
export async function createCandidateManager(project: string, assertWritable: () => Promise<void>) {
  const internal = join(project, '.narracut');
  const internalIdentity = await directory(internal);
  const pointer = join(internal, 'candidate.json');
  const assertCurrent = async () => {
    await assertWritable();
    if (await directory(internal) !== internalIdentity) fail('PROJECT_IDENTITY_LOST', '项目内部目录身份变化；已停止候选写入。');
  };
  async function currentRevision() {
    const value = JSON.parse((await regular(join(internal, 'current.json'), 4096)).toString());
    if (!/^[0-9a-f-]{36}$/i.test(value.revisionId)) throw new Error('当前修订身份无效');
    return value.revisionId as string;
  }
  async function pointerBytes() {
    try { return await regular(pointer, 16384); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  const refValid = (ref: TreeRef) => ref && /^\.narracut\/candidate-[0-9a-f-]{36}\/(candidate|checkpoint)$/.test(ref.path) && /^sha256:[0-9a-f]{64}$/.test(ref.identity);
  async function inspect(): Promise<{ view: CandidateStatus; state: State | null; tree?: Tree; raw: Buffer | null }> {
    await assertCurrent();
    const sourceRevision = await currentRevision();
    let raw: Buffer | null = null;
    let state: State | null = null;
    try {
      raw = await pointerBytes();
      if (raw === null) return { view: { status: 'absent', sourceRevision, baseline: hash('absent'), candidate: null, checkpoint: null }, state: null, raw };
      const parsed = JSON.parse(raw.toString()) as State;
      if (parsed.version !== 1 || !/^[0-9a-f-]{36}$/i.test(parsed.sourceRevision) || !refValid(parsed.candidate) ||
        !(parsed.checkpoint === null || (refValid(parsed.checkpoint) && dirname(parsed.checkpoint.path) === dirname(parsed.candidate.path) && parsed.checkpoint.path.endsWith('/checkpoint'))) || !parsed.candidate.path.endsWith('/candidate')) throw new Error('候选指针完整性无效');
      state = parsed;
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
      return { raw, state, tree, view: {
        status: external ? 'external-change' : 'saved', sourceRevision: state.sourceRevision,
        baseline: hash(JSON.stringify([hash(raw), treeId, checkpointId])),
        candidate: { ...state.candidate, identity: treeId }, checkpoint: state.checkpoint,
        ...(external ? { error: { code: 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', message: '候选发生外部变化，外部字节已保留。需要重新检查；未提交修改不得覆盖。' } } : {}),
      } };
    } catch (error) {
      return { raw, state, view: { status: 'integrity-failed', sourceRevision, baseline: hash(raw ?? 'invalid'),
        candidate: state?.candidate ?? null, checkpoint: state?.checkpoint ?? null,
        error: { code: 'CANDIDATE_INTEGRITY_FAILED', message: `候选或恢复检查点完整性失败，已保留现场。请外部修复后重新检查，或明确放弃。${(error as Error).message}` },
      } };
    }
  }
  return async (request: CandidateRequest): Promise<CandidateStatus> => {
    const before = await inspect();
    if (request.action === 'read') return before.view;
    if (request.action === 'create' && before.view.status !== 'absent') fail('CANDIDATE_ALREADY_EXISTS', '项目已经存在唯一候选；请继续使用或明确放弃。');
    if (request.action !== 'create' && request.baseline !== before.view.baseline) fail('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', '候选基线已变化；本批未保存，外部字节与恢复检查点已保留。');
    if (request.action === 'discard') {
      if (!request.confirmed) fail('CANDIDATE_DISCARD_CONFIRMATION_REQUIRED', '放弃不可撤销，需要明确确认。');
      if (before.view.status === 'absent') return before.view;
      await assertCurrent();
      if (!(await pointerBytes())?.equals(before.raw ?? Buffer.alloc(0))) fail('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', '候选指针已变化，未放弃。');
      await rm(pointer);
      if (before.state) await rm(dirname(join(project, before.state.candidate.path)), { recursive: true, force: true }).catch(() => undefined);
      return { status: 'absent', baseline: hash('absent'), sourceRevision: await currentRevision(), candidate: null, checkpoint: null };
    }
    if (request.action !== 'create' && (before.view.status !== 'saved' || !before.tree)) {
      fail(before.view.error?.code ?? 'CANDIDATE_MISSING', before.view.error?.message ?? '请先显式创建候选。');
    }
    const sourceRevision = await currentRevision();
    const currentRoot = join(internal, 'revisions', sourceRevision, 'render-program');
    let next: Tree;
    if (request.action === 'create') {
      await directory(join(internal, 'revisions'));
      await directory(dirname(currentRoot));
      next = await readTree(currentRoot);
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
      const treeId = identity(await readTree(join(root, 'candidate')));
      if (before.tree) await writeTree(join(root, 'checkpoint'), before.tree);
      const state: State = { version: 1, sourceRevision: before.state?.sourceRevision ?? sourceRevision,
        candidate: { path: `${generation}/candidate`, identity: treeId },
        checkpoint: before.tree ? { path: `${generation}/checkpoint`, identity: identity(before.tree) } : null };
      const bytes = Buffer.from(JSON.stringify(state));
      await writeBytes(join(root, 'state.json'), bytes);
      await syncDirectory(root);
      await assertCurrent();
      const latest = await inspect();
      if (latest.view.baseline !== before.view.baseline || latest.view.status !== before.view.status ||
        await currentRevision() !== sourceRevision ||
        (request.action === 'create' && identity(await readTree(currentRoot)) !== treeId)) fail('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', '提交前发生外部变化；本批未保存，上一份候选已保留。');
      await rename(join(root, 'state.json'), pointer);
      committed = true;
      await syncDirectory(internal).catch(() => undefined);
      if (before.state) await rm(dirname(join(project, before.state.candidate.path)), { recursive: true, force: true }).catch(() => undefined);
      return { status: 'saved', sourceRevision: state.sourceRevision,
        baseline: hash(JSON.stringify([hash(bytes), treeId, state.checkpoint?.identity ?? null])),
        candidate: state.candidate, checkpoint: state.checkpoint };
    } catch (error) {
      if (error instanceof CandidateError) throw error;
      return fail('CANDIDATE_SAVE_FAILED', `本批未保存，上一份候选与恢复检查点已保留。${(error as Error).message}`);
    } finally {
      if (!committed) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

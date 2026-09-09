import { endedTaskReason, readCurrentPointer } from './project-revisions';
import { syncDirectory } from './project-candidate';
import { copiedTask } from './project-identity';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rm, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep, dirname, basename } from 'node:path';
import { openProjectVNext, publishProjectVNext, ProjectLifecycleError } from './project-lifecycle';
import { inspectProjectVNext } from './project-vnext-inspection';

export type CopyProjectOptions = {
  confirmTemporaryCleanup?: boolean;
  signal?: AbortSignal;
  onPhase?: (phase: 'copying' | 'validating' | 'publishing') => void;
};
const excluded = (path: string) => path === '.narracut-operation.json' || path === '.narracut/workspace.lease' ||
  /^\.narracut\/(cache|bundles|previews|node_modules|logs|tmp)(\/|$)/.test(path) ||
  path.split('/').some(name => name === '.DS_Store' || name === 'Thumbs.db' || name.endsWith('.narracut-tmp')) ||
  /^((assets|speech)\/\.(import|speech|probe)-|\.narracut\/\.task-)/.test(path) ||
  /^\.(project\.json|narracut\.json|tts\.json|video\.md)\.[0-9a-f-]+\.tmp$/.test(path) ||
  /^\.narracut\/(task-[0-9a-f-]+\.tmp|(accept|discard|consumed)-[0-9a-f-]+\.json)$/.test(path) ||
  /^(node_modules|bundle|\.cache)(\/|$)/.test(path);

/** 分块读取以支持大资源；逐文件字节指纹与目录身份共同检测复制期间外部变化。 */
async function rewrite(path: string, bytes: string | Buffer) {
  const file = await open(path, 'w');
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function walk(root: string, destination: string | null, signal?: AbortSignal, keep: (path: string) => boolean = () => true) {
  const entries = new Map<string, string>();
  async function visit(path: string) {
    signal?.throwIfAborted();
    const full = join(root, path), before = await lstat(full);
    if (before.isSymbolicLink()) throw new Error(`不能复制符号链接：${full}`);
    if (before.isDirectory()) {
      entries.set(path, 'directory');
      if (destination && path) await mkdir(join(destination, path));
      for (const name of (await readdir(full)).sort()) {
        const child = path ? `${path}/${name}` : name;
        if (!excluded(child) && keep(child)) await visit(child);
      }
    } else {
      if (!before.isFile() || before.nlink !== 1) throw new Error(`不能复制非独立普通文件：${full}`);
      const source = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const target = destination ? await open(join(destination, path), 'wx', 0o600) : null;
      try {
        const anchored = await source.stat();
        if (anchored.dev !== before.dev || anchored.ino !== before.ino || !anchored.isFile() || anchored.nlink !== 1) throw new Error(`复制文件身份变化：${full}`);
        const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
        for (;;) {
          signal?.throwIfAborted();
          const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          const bytes = buffer.subarray(0, bytesRead);
          hash.update(bytes);
          if (target) await target.writeFile(bytes);
        }
        await target?.sync();
        entries.set(path, hash.digest('hex'));
      } finally { await source.close(); await target?.close(); }
    }
    const after = await lstat(full);
    if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error(`复制期间来源发生变化：${full}`);
  }
  await visit('');
  return entries;
}
function assertSame(a: Map<string, string>, b: Map<string, string>) {
  if (a.size !== b.size || [...a].some(([path, hash]) => b.get(path) !== hash)) throw new Error('复制期间持久内容发生变化，已取消发布。');
}
export async function copyProjectVNext(sourcePath: string, targetPath: string, options: CopyProjectOptions = {}) {
  const source = await realpath(resolve(sourcePath));
  const target = join(await realpath(dirname(resolve(targetPath))), basename(resolve(targetPath)));
  const rel = relative(source, target);
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep))) throw new Error('复制目标必须位于来源项目之外。');
  // 不请求工作区移交：仍打开的来源必须先由调用方完成保存和关闭。
  const opened = await openProjectVNext(source);
  let published: { projectDirectory: string; projectId: string; revisionId: string; cleanupWarning?: { message: string; path: string } } | null = null;
  try {
    const candidate = await opened.candidate({ action: 'read' });
    const current = await readCurrentPointer(source);
    const revisions = new Set([current.revisionId, ...(current.history ?? []).map(item => item.revisionId)]);
    const retained = [candidate.candidate?.path, candidate.checkpoint?.path, candidate.offline].filter((path): path is string => !!path);
    const keep = (path: string) => {
      const revision = /^\.narracut\/revisions\/([^/]+)/.exec(path);
      if (revision && !revisions.has(revision[1])) return false;
      if (/^\.narracut\/candidate-/.test(path)) return retained.some(ref => path === ref || path.startsWith(`${ref}/`) || ref.startsWith(`${path}/`));
      return true;
    };
    if (candidate.status === 'integrity-failed') throw new Error(candidate.error?.message ?? '候选完整性校验失败');
    const result = await publishProjectVNext(target, options, 'copy', async (temporary, projectId) => {
      options.signal?.throwIfAborted(); options.onPhase?.('copying');
      const before = await walk(source, temporary, options.signal, keep);
      options.onPhase?.('validating');
      // 操作标记不属于项目字节，目标校验单独忽略。
      const copied = await walk(temporary, null, options.signal);
      copied.delete('.narracut-operation.json');
      assertSame(before, copied);
      await rewrite(join(temporary, 'narracut.json'), JSON.stringify({ ...opened.inspection.manifest, projectId }));
      const taskPath = join(temporary, '.narracut', 'agent-task.json');
      let taskBytes: string | null = null;
      try { taskBytes = await readFile(taskPath, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (taskBytes !== null) {
        const task = await endedTaskReason(source) ? null : copiedTask(Buffer.from(taskBytes), opened.inspection.manifest.projectId, projectId);
        if (task) await rewrite(taskPath, task);
        else await rm(taskPath);
      }
      const inspection = await inspectProjectVNext(temporary);
      if (inspection.manifest.projectId !== projectId) throw new Error('副本身份校验失败。');
      for (const [path, value] of [...before].reverse()) if (value === 'directory') await syncDirectory(join(temporary, path));
      assertSame(before, await walk(source, null, options.signal, keep));
      options.signal?.throwIfAborted(); options.onPhase?.('publishing');
    });
    published = { ...result, revisionId: candidate.sourceRevision };
    return published;
  } catch (error) {
    if (error instanceof ProjectLifecycleError) throw error;
    throw new ProjectLifecycleError('PROJECT_COPY_FAILED', target, `复制失败：${error instanceof Error ? error.message : error}`, { cause: error });
  } finally {
    try { await opened.release(); }
    catch (error) {
      if (!published) throw error;
      published.cleanupWarning = { path: join(source, '.narracut/workspace.lease'), message: `副本已创建；来源租约收尾失败：${error instanceof Error ? error.message : error}` };
    }
  }
}

import { mkdtemp, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';
import { copyProjectVNext } from '../src/server/project-copy';

it('完整复制持久项目并生成独立身份，排除租约和派生产物', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-copy-'));
  const source = join(root, 'source'), target = join(root, 'target');
  const original = await createProjectVNext(source);
  await writeFile(join(source, 'video.md'), '另一种创作方向');
  await writeFile(join(source, 'assets', 'original.bin'), Buffer.from([1, 2, 3]));
  await mkdir(join(source, '.narracut', 'cache'));
  await writeFile(join(source, '.narracut', 'cache', 'preview'), 'derived');
  const result = await copyProjectVNext(source, target);
  expect(result.projectId).not.toBe(original.projectId);
  expect(await readFile(join(target, 'video.md'), 'utf8')).toBe('另一种创作方向');
  expect(await readFile(join(target, 'assets', 'original.bin'))).toEqual(Buffer.from([1, 2, 3]));
  await expect(access(join(target, '.narracut', 'cache'))).rejects.toMatchObject({ code: 'ENOENT' });
  const opened = await openProjectVNext(target);
  expect(opened.inspection.manifest.projectId).toBe(result.projectId);
  await opened.release();
});

it('停止候选携带新任务身份与原始指令，清除宿主线程和执行证据', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-copy-task-'));
  const source = join(root, 'source'), target = join(root, 'target');
  const original = await createProjectVNext(source);
  const opened = await openProjectVNext(source);
  const candidate = await opened.candidate({ action: 'create' });
  await opened.release();
  const task = { taskId: '30000000-0000-4000-8000-000000000001', projectId: original.projectId, instruction: '保留原始创作指令', status: 'stopped', reason: 'USER_STOPPED', threadPointer: 'codex-thread', lastSafeStage: 'modify', candidateBaseline: candidate.baseline, inputIdentity: 'old-input', pending: null };
  await writeFile(join(source, '.narracut', 'agent-task.json'), JSON.stringify(task));
  const result = await copyProjectVNext(source, target);
  const copy = JSON.parse(await readFile(join(target, '.narracut', 'agent-task.json'), 'utf8'));
  expect(copy).toMatchObject({ projectId: result.projectId, instruction: task.instruction, status: 'stopped', threadPointer: null, inputIdentity: null, candidateBaseline: candidate.baseline });
  expect(copy.taskId).not.toBe(task.taskId);
  expect(JSON.parse(await readFile(join(source, '.narracut', 'agent-task.json'), 'utf8'))).toEqual(task);
});

it('拒绝仍打开的来源和已有空目标，取消复制清理半成品', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-copy-failure-'));
  const source = join(root, 'source'), target = join(root, 'target');
  await createProjectVNext(source);
  const opened = await openProjectVNext(source);
  await expect(copyProjectVNext(source, target)).rejects.toMatchObject({ code: 'PROJECT_IN_USE' });
  await opened.release();
  await mkdir(target);
  await expect(copyProjectVNext(source, target)).rejects.toMatchObject({ code: 'PROJECT_CREATE_TARGET_EXISTS' });
  const controller = new AbortController();
  await expect(copyProjectVNext(source, join(root, 'cancelled'), { signal: controller.signal, onPhase: phase => { if (phase === 'validating') controller.abort(); } })).rejects.toThrow();
  await expect(access(join(root, 'cancelled'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(join(root, '.cancelled.narracut-tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('复制结果返回保留下来的当前修订身份', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-copy-revision-'));
  const original = await createProjectVNext(join(root, 'source'));
  const copy = await copyProjectVNext(join(root, 'source'), join(root, 'target'));
  expect(copy.revisionId).toBe(original.revisionId);
});

it('来源在复制期间变化时拒绝发布，不留下可打开半成品', async () => {
  const { writeFileSync } = await import('node:fs');
  const root = await mkdtemp(join(tmpdir(), 'narracut-copy-change-'));
  const source = join(root, 'source'), target = join(root, 'target');
  await createProjectVNext(source);
  await expect(copyProjectVNext(source, target, { onPhase: phase => { if (phase === 'validating') writeFileSync(join(source, 'video.md'), '外部更新'); } })).rejects.toThrow('变化');
  await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(join(root, '.target.narracut-tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('固定临时目录只有复制操作与目标匹配且明确确认才清理', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-copy-residue-'));
  const source = join(root, 'source'), target = join(root, 'target'), temporary = join(root, '.target.narracut-tmp');
  await createProjectVNext(source);
  await mkdir(temporary);
  const marker = { kind: 'narracut-operation', version: 1, operation: 'create', targetDirectory: target, operationToken: 'previous' };
  await writeFile(join(temporary, '.narracut-operation.json'), JSON.stringify(marker));
  await expect(copyProjectVNext(source, target, { confirmTemporaryCleanup: true })).rejects.toMatchObject({ code: 'PROJECT_TEMPORARY_RESIDUE_UNOWNED' });
  await writeFile(join(temporary, '.narracut-operation.json'), JSON.stringify({ ...marker, operation: 'copy' }));
  await expect(copyProjectVNext(source, target)).rejects.toMatchObject({ code: 'PROJECT_TEMPORARY_RESIDUE' });
  const result = await copyProjectVNext(source, target, { confirmTemporaryCleanup: true });
  expect(result.projectDirectory).toBe(target);
});

it('CLI copy 默认完成后退出，只在显式 --open 时启动工作区', async () => {
  const { runCopyCli } = await import('../src/server/cli');
  const root = await mkdtemp(join(tmpdir(), 'narracut-copy-cli-'));
  await createProjectVNext(join(root, 'source'));
  let starts = 0;
  const startServer = async () => { starts++; return { url: 'http://localhost', close: async () => {} } as any; };
  const result = await runCopyCli({ args: [join(root, 'source'), join(root, 'target')], startServer });
  expect(result.server).toBeUndefined(); expect(starts).toBe(0);
  const opened = await runCopyCli({ args: [join(root, 'source'), join(root, 'opened'), '--open'], startServer });
  expect(starts).toBe(1);
  await opened.server?.close();
});

it('发布后的来源租约清理失败不会掩盖已创建副本', async () => {
  const { writeFileSync } = await import('node:fs');
  const root = await mkdtemp(join(tmpdir(), 'narracut-copy-release-'));
  const source = join(root, 'source'), target = join(root, 'target');
  await createProjectVNext(source);
  const copied = await copyProjectVNext(source, target, { onPhase: phase => { if (phase === 'publishing') writeFileSync(join(source, '.narracut/workspace.lease'), 'invalid-json'); } });
  expect(copied.cleanupWarning).toMatchObject({ path: join(source, '.narracut/workspace.lease') });
  expect(JSON.parse(await readFile(join(target, 'narracut.json'), 'utf8')).projectId).toBe(copied.projectId);
});

it('复制保留完整修订历史、候选恢复检查点与可校验的离线依赖', async () => {
  const { fixture } = await import('./helpers/program-fixture');
  const { parse } = await import('yaml');
  const { vi } = await import('vitest');
  const root = await mkdtemp(join(tmpdir(), 'narracut-copy-history-'));
  const source = join(root, 'source'), target = join(root, 'target');
  const initial = await createProjectVNext(source);
  const program = await fixture();
  for (const [path, bytes] of program.program) await writeFile(join(source, '.narracut/revisions', initial.revisionId, 'render-program', path), bytes);
  const urls = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(parse(program.program.get('pnpm-lock.yaml')!.toString()).packages) as [string, any][]) {
    const split = id.lastIndexOf('@'), name = id.slice(0, split), version = id.slice(split + 1);
    urls.set(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, program.offline.get(Buffer.from(value.resolution.integrity.slice(7), 'base64').toString('hex'))!);
  }
  vi.stubGlobal('fetch', async (url: string) => new Response(new Uint8Array(urls.get(url)!)));
  const opened = await openProjectVNext(source);
  try {
    let candidate = await opened.candidate({ action: 'create' });
    candidate = await opened.candidate({ action: 'dependencies', baseline: candidate.baseline, dependencies: {}, packages: [] });
    await opened.programTransaction(manager => manager.accept({ baseline: candidate.baseline, summary: '保留离线依赖的修订', source: 'candidate', acceptance: {} }, async () => {}));
    candidate = await opened.candidate({ action: 'create' });
    candidate = await opened.candidate({ action: 'apply', baseline: candidate.baseline, changes: [{ path: 'resources/direction.txt', content: '未接受的新方向' }] });
    const history = await opened.programTransaction(manager => manager.history());
    await opened.release();
    await copyProjectVNext(source, target);
    const copied = await openProjectVNext(target);
    try {
      const after = await copied.candidate({ action: 'read' });
      expect(after).toEqual(candidate);
      expect((await copied.programTransaction(manager => manager.history())).revisions).toEqual(history.revisions);
      expect(await readFile(join(target, candidate.candidate!.path, 'resources/direction.txt'), 'utf8')).toBe('未接受的新方向');
      for (const [key, bytes] of program.offline) expect(await readFile(join(target, candidate.offline!, `${key}.tgz`))).toEqual(bytes);
    } finally { await copied.release(); }
  } finally { await opened.release(); vi.unstubAllGlobals(); }
}, 30000);

import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';

it('零 Scene 显式创建唯一候选，原子换代上一份检查点，重启保留并明确放弃', async () => {
  const directory = join(await mkdtemp(join(tmpdir(), 'candidate-')), 'project');
  await createProjectVNext(directory);
  let project = await openProjectVNext(directory);
  try {
    expect((await project.candidate({ action: 'read' })).status).toBe('absent');
    const results = await Promise.allSettled([project.candidate({ action: 'create' }), project.candidate({ action: 'create' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const first = await project.candidate({ action: 'read' });
    expect(first.status).toBe('saved');
    const before = await readFile(join(directory, first.candidate!.path, 'src/RenderProgram.tsx'), 'utf8');
    const second = await project.candidate({ action: 'apply', baseline: first.baseline, changes: [{ path: 'src/RenderProgram.tsx', content: before + '\n// 第二批\n' }] });
    expect(second.checkpoint?.identity).toBe(first.candidate?.identity);
    expect(await readFile(join(directory, second.checkpoint!.path, 'src/RenderProgram.tsx'), 'utf8')).toBe(before);
    await expect(project.candidate({ action: 'apply', baseline: second.baseline, changes: [{ path: '../outside', content: 'bad' }] })).rejects.toMatchObject({ code: 'CANDIDATE_BATCH_INVALID' });
    expect(await project.candidate({ action: 'read' })).toEqual(second);
    await project.release();
    project = await openProjectVNext(directory);
    expect(await project.candidate({ action: 'read' })).toEqual(second);
    await project.candidate({ action: 'discard', baseline: second.baseline, confirmed: true });
    expect((await project.candidate({ action: 'read' })).status).toBe('absent');
    await expect(access(join(directory, second.candidate!.path))).rejects.toThrow();
    await expect(access(join(directory, second.checkpoint!.path))).rejects.toThrow();
  } finally { await project.release(); }
});

it('外部字节改变使旧批次失效，损坏候选重启后保留且不覆盖检查点', async () => {
  const directory = join(await mkdtemp(join(tmpdir(), 'candidate-external-')), 'project');
  await createProjectVNext(directory);
  let project = await openProjectVNext(directory);
  try {
    const first = await project.candidate({ action: 'create' });
    const second = await project.candidate({ action: 'apply', baseline: first.baseline, changes: [{ path: 'resources/proof.txt', content: 'safe' }] });
    const externalPath = join(directory, second.candidate!.path, 'resources/proof.txt');
    await writeFile(externalPath, 'external');
    expect((await project.candidate({ action: 'read' })).status).toBe('external-change');
    await expect(project.candidate({ action: 'apply', baseline: second.baseline, changes: [{ path: 'resources/proof.txt', content: 'stale' }] })).rejects.toMatchObject({ code: 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED' });
    expect(await readFile(externalPath, 'utf8')).toBe('external');
    const { unlink } = await import('node:fs/promises');
    await unlink(join(directory, second.candidate!.path, 'program.json'));
    await project.release();
    project = await openProjectVNext(directory);
    const broken = await project.candidate({ action: 'read' });
    expect(broken.status).toBe('integrity-failed');
    expect(broken.checkpoint).toEqual(second.checkpoint);
    expect(await readFile(externalPath, 'utf8')).toBe('external');
    await expect(project.candidate({ action: 'discard', baseline: broken.baseline })).rejects.toMatchObject({ code: 'CANDIDATE_DISCARD_CONFIRMATION_REQUIRED' });
    await project.candidate({ action: 'discard', baseline: broken.baseline, confirmed: true });
  } finally { await project.release(); }
});

it('项目清单身份失效时拒绝候选创建与修改', async () => {
  const directory = join(await mkdtemp(join(tmpdir(), 'candidate-identity-')), 'project');
  await createProjectVNext(directory);
  const project = await openProjectVNext(directory);
  try {
    const first = await project.candidate({ action: 'create' });
    const path = join(directory, 'narracut.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...manifest, projectId: '10000000-0000-4000-8000-000000000000' }));
    await expect(project.candidate({ action: 'apply', baseline: first.baseline, changes: [{ path: 'resources/a.txt', content: 'no' }] })).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_LOST' });
    expect(await readFile(join(directory, first.candidate!.path, 'program.json'), 'utf8')).toContain('apiVersion');
  } finally { await project.release(); }
});

it('临时树验证失败不提交，恢复检查点外部变化单独报告完整性失败', async () => {
  const directory = join(await mkdtemp(join(tmpdir(), 'candidate-failure-')), 'project');
  await createProjectVNext(directory);
  const project = await openProjectVNext(directory);
  try {
    const first = await project.candidate({ action: 'create' });
    const second = await project.candidate({ action: 'apply', baseline: first.baseline, changes: [{ path: 'resources/one.txt', content: 'one' }] });
    await expect(project.candidate({ action: 'apply', baseline: second.baseline, changes: [{ path: 'src/RenderProgram.tsx', content: null }] })).rejects.toMatchObject({ code: 'CANDIDATE_SAVE_FAILED' });
    expect(await project.candidate({ action: 'read' })).toEqual(second);
    await writeFile(join(directory, second.checkpoint!.path, 'resources/foreign.txt'), 'changed');
    expect((await project.candidate({ action: 'read' })).error?.code).toBe('CANDIDATE_INTEGRITY_FAILED');
    expect(await readFile(join(directory, second.candidate!.path, 'resources/one.txt'), 'utf8')).toBe('one');
  } finally { await project.release(); }
});

it('候选内特殊文件不会阻塞读取或共享保存队列', async () => {
  const directory = join(await mkdtemp(join(tmpdir(), 'candidate-fifo-')), 'project');
  await createProjectVNext(directory);
  const project = await openProjectVNext(directory);
  try {
    const first = await project.candidate({ action: 'create' });
    const { execFileSync } = await import('node:child_process');
    execFileSync('mkfifo', [join(directory, first.candidate!.path, 'resources/blocked')]);
    const result = await project.candidate({ action: 'read' });
    expect(result.status).toBe('integrity-failed');
    const saved = await project.saveVideoBrief('仍可保存 Brief', project.inspection.videoBriefRevision);
    expect(saved.status).toBe('saved');
  } finally { await project.release(); }
});

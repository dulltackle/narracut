import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProjectVNext } from '../src/server/project-lifecycle';
import { recoveryBaseline, sealRecovery, RecoveryExports } from '../src/server/project-recovery';
import { inspectRecovery, planRecovery, recoverProject, extractRecovery } from '../src/server/project-restore';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(draft = { briefLocal: '恢复的目标' }) {
  const parent = await mkdtemp(join(tmpdir(), 'restore-')); roots.push(parent);
  const source = join(parent, 'source'), created = await createProjectVNext(source);
  const cut = sealRecovery(source, created.projectId, await recoveryBaseline(source, created.projectId), draft)!;
  const snapshot = join(parent, 'snapshot.narracut-recovery.json');
  await new RecoveryExports().run(cut, snapshot, randomUUID());
  return { parent, source, snapshot, created };
}
it('只读计划不创建租约，确认后保留原身份、当前修订和快照并恢复 Brief', async () => {
  const { parent, source, snapshot, created } = await fixture();
  const bytes = await readFile(snapshot), original = await readFile(join(source, '.narracut/current.json'));
  const inspection = await inspectRecovery(snapshot);
  expect(inspection.projectId).toBe(created.projectId);
  const plan = await planRecovery(snapshot, source);
  expect(plan.blockers).toEqual([]);
  expect(plan.brief.result).toBe('恢复的目标');
  expect(await readdir(join(source, '.narracut'))).not.toContain('workspace.lease');
  const target = join(parent, 'restored');
  const result = await recoverProject(snapshot, source, target, { planId: plan.planId });
  expect(result.projectId).toBe(created.projectId);
  expect(await readFile(join(target, 'video.md'), 'utf8')).toBe('恢复的目标');
  expect(await readFile(join(target, '.narracut/current.json'))).toEqual(original);
  expect(await readFile(join(source, 'video.md'), 'utf8')).toBe('');
  expect(await readFile(snapshot)).toEqual(bytes);
  await expect(recoverProject(snapshot, source, target, { planId: plan.planId })).rejects.toThrow();
});
it('损坏清单可重建，可靠的不同身份和每条基线差异分别阻断', async () => {
  const { parent, source, snapshot, created } = await fixture();
  await writeFile(join(source, 'narracut.json'), '{损坏');
  let plan = await planRecovery(snapshot, source);
  expect(plan.blockers).toEqual([]); expect(plan.rebuildManifest).toBe(true);
  await recoverProject(snapshot, source, join(parent, 'rebuilt'), { planId: plan.planId });
  expect(JSON.parse(await readFile(join(parent, 'rebuilt/narracut.json'), 'utf8')).projectId).toBe(created.projectId);
  await writeFile(join(source, 'narracut.json'), JSON.stringify({ kind: 'bad', projectId: randomUUID(), formatVersion: 1 }));
  await writeFile(join(source, 'project.json'), '{"scenes":[],"assets":[]}');
  await writeFile(join(source, 'video.md'), '来源被改过');
  plan = await planRecovery(snapshot, source);
  expect(plan.blockers.some(item => item.path.endsWith('narracut.json'))).toBe(true);
  expect(plan.blockers.some(item => item.path.endsWith('project.json'))).toBe(true);
  expect(plan.blockers.some(item => item.path.endsWith('video.md'))).toBe(true);
  const extracted = await extractRecovery(snapshot, source, 'briefLocal', join(parent, '抢救.md'));
  expect(extracted.kind).toBe('file'); expect(await readFile(extracted.path, 'utf8')).toBe('恢复的目标');
});
it('Brief 三方冲突只改变计划，旧确认和复制期间变化不发布项目', async () => {
  const { parent, source, created } = await fixture();
  await writeFile(join(source, 'video.md'), 'DISK');
  const cut = sealRecovery(source, created.projectId, await recoveryBaseline(source, created.projectId), { briefLocal: 'LOCAL', briefBase: 'BASE' })!;
  const snapshot = join(parent, 'conflict.narracut-recovery.json'); await new RecoveryExports().run(cut, snapshot, randomUUID());
  let plan = await planRecovery(snapshot, source);
  expect(plan.brief.conflict).toBe(true); expect(plan.brief.base).toBe('BASE');
  plan = await planRecovery(snapshot, source, ''); expect(plan.blockers).toEqual([]); expect(plan.brief.result).toBe('');
  await expect(recoverProject(snapshot, source, join(parent, 'stale'), { planId: plan.planId })).rejects.toThrow();
  await recoverProject(snapshot, source, join(parent, 'resolved'), { planId: plan.planId, briefResult: '' });
  const changing = recoverProject(snapshot, source, join(parent, 'changing'), { planId: plan.planId, briefResult: '', onPhase: phase => { if (phase === 'applying') writeFileSync(join(source, 'video.md'), '复制时改动'); } });
  await expect(changing).rejects.toThrow('来源发生变化');
  expect(await readdir(parent)).not.toContain('changing');
  expect(await readdir(parent)).not.toContain('.changing.narracut-tmp');
  expect(await readFile(join(source, 'video.md'), 'utf8')).toBe('复制时改动');
  expect(await readFile(join(parent, 'resolved/video.md'), 'utf8')).toBe('');
});
it('严格载荷验证在 10 MiB DSL 与 2 MiB Brief 端点通过，超限、重复字段和非法 UTF-8 拒绝', async () => {
  const { source, snapshot, parent } = await fixture();
  const original = JSON.parse(await readFile(snapshot, 'utf8'));
  const { recoveryHash } = await import('../src/server/project-recovery');
  async function payload(content: Buffer, component: 'dsl' | 'briefLocal') {
    const { sha256, ...body } = structuredClone(original);
    body.payload = { [component]: { bytes: content.length, sha256: recoveryHash(content), base64: content.toString('base64') } };
    await writeFile(snapshot, JSON.stringify({ ...body, sha256: recoveryHash(JSON.stringify(body)) }));
  }
  const dsl = '{"assets":[],"scenes":[]}';
  await payload(Buffer.from(dsl + ' '.repeat(10 * 1024 * 1024 - dsl.length)), 'dsl');
  expect((await inspectRecovery(snapshot)).payload.dsl!.bytes).toBe(10 * 1024 * 1024);
  await payload(Buffer.from(dsl + ' '.repeat(10 * 1024 * 1024 + 1 - dsl.length)), 'dsl');
  await expect(inspectRecovery(snapshot)).rejects.toThrow();
  await payload(Buffer.from('\uFEFF' + 'a'.repeat(2 * 1024 * 1024 - 3)), 'briefLocal');
  expect((await inspectRecovery(snapshot)).payload.briefLocal!.bytes).toBe(2 * 1024 * 1024);
  await payload(Buffer.alloc(2 * 1024 * 1024 + 1, 97), 'briefLocal');
  await expect(inspectRecovery(snapshot)).rejects.toThrow();
  await payload(Buffer.from('{"assets":[],"scenes":[],"scenes":[]}'), 'dsl');
  await expect(inspectRecovery(snapshot)).rejects.toThrow();
  await expect(planRecovery(snapshot, source)).rejects.toThrow();
  await expect(extractRecovery(snapshot, source, 'dsl', join(parent, 'bad.json'))).rejects.toThrow();
  await payload(Buffer.from([0xc0, 0xaf]), 'briefLocal');
  await expect(inspectRecovery(snapshot)).rejects.toThrow();
  await writeFile(snapshot, Buffer.alloc(20_622_001, 32));
  await expect(inspectRecovery(snapshot)).rejects.toMatchObject({ code: 'RECOVERY_SNAPSHOT_LIMIT_EXCEEDED' });
});
it('匹配的崩溃残留需确认才清理；标记不匹配、既有空目标和取消都不发布', async () => {
  const { mkdir } = await import('node:fs/promises');
  const { parent, source, snapshot } = await fixture();
  const plan = await planRecovery(snapshot, source), target = join(parent, 'target'), residue = join(parent, '.target.narracut-tmp');
  await mkdir(residue);
  await writeFile(join(residue, '.narracut-operation.json'), JSON.stringify({ kind: 'narracut-operation', version: 1, operation: 'recover', targetDirectory: target, operationToken: randomUUID() }));
  await expect(recoverProject(snapshot, source, target, { planId: plan.planId })).rejects.toMatchObject({ code: 'PROJECT_TEMPORARY_RESIDUE', path: residue });
  await recoverProject(snapshot, source, target, { planId: plan.planId, confirmTemporaryCleanup: true });
  const empty = join(parent, 'empty'); await mkdir(empty);
  await expect(recoverProject(snapshot, source, empty, { planId: plan.planId })).rejects.toThrow();
  expect(await readdir(empty)).toEqual([]);
  const wrong = join(parent, '.wrong.narracut-tmp'); await mkdir(wrong); await writeFile(join(wrong, 'keep'), '保留');
  await expect(recoverProject(snapshot, source, join(parent, 'wrong'), { planId: plan.planId, confirmTemporaryCleanup: true })).rejects.toMatchObject({ code: 'PROJECT_TEMPORARY_RESIDUE_UNOWNED' });
  expect(await readFile(join(wrong, 'keep'), 'utf8')).toBe('保留');
  const abort = new AbortController();
  await expect(recoverProject(snapshot, source, join(parent, 'cancelled'), { planId: plan.planId, signal: abort.signal, onPhase: phase => { if (phase === 'applying') abort.abort(); } })).rejects.toThrow();
  expect(await readdir(parent)).not.toContain('cancelled');
  expect(await readdir(parent)).not.toContain('.cancelled.narracut-tmp');
});
it('DSL、LOCAL 与可选 BASE 独立提取为普通文件；不覆盖、写入项目或容忍坏编码', async () => {
  const { parent, source, created } = await fixture();
  await writeFile(join(source, 'video.md'), 'DISK');
  const dsl = '{ "assets": [], "scenes": [] }';
  const cut = sealRecovery(source, created.projectId, await recoveryBaseline(source, created.projectId), { dsl, briefLocal: '', briefBase: 'BASE' })!;
  const snapshot = join(parent, 'all.narracut-recovery.json'); await new RecoveryExports().run(cut, snapshot, randomUUID());
  const bytes = await readFile(snapshot);
  await rm(join(source, '.narracut/current.json'));
  for (const [component, content] of [['dsl', dsl], ['briefLocal', ''], ['briefBase', 'BASE']] as const) {
    const target = join(parent, `${component}.txt`);
    await extractRecovery(snapshot, source, component, target);
    expect(await readFile(target, 'utf8')).toBe(content);
    await expect(extractRecovery(snapshot, source, component, target)).rejects.toThrow();
    await expect(extractRecovery(snapshot, source, component, join(source, 'bad.txt'))).rejects.toThrow();
  }
  expect(await readFile(snapshot)).toEqual(bytes);
  const { sha256, ...body } = JSON.parse(bytes.toString());
  const { recoveryHash } = await import('../src/server/project-recovery');
  body.payload.briefLocal = { bytes: 1, sha256: recoveryHash('a'), base64: 'YR==' };
  await writeFile(snapshot, JSON.stringify({ ...body, sha256: recoveryHash(JSON.stringify(body)) }));
  await expect(extractRecovery(snapshot, source, 'dsl', join(parent, 'invalid.txt'))).rejects.toThrow();
});
it('CLI inspect/dry-run/recover/extract 共用契约，默认不打开工作区', async () => {
  const { runRecoveryCli } = await import('../src/server/cli');
  const { parent, source, snapshot } = await fixture();
  const log = () => {}, inspect = await runRecoveryCli({ args: ['inspect', snapshot], log });
  const plan = await runRecoveryCli({ args: ['dry-run', snapshot, source], log });
  const result = await runRecoveryCli({ args: [snapshot, source, join(parent, 'cli'), '--plan', plan.planId], log }, true);
  expect(result.projectId).toBe(inspect.projectId); expect(result.server).toBeUndefined();
  await rm(join(source, 'project.json'));
  const extracted = await runRecoveryCli({ args: ['extract', snapshot, source, 'briefLocal', join(parent, 'cli.md')], log });
  expect(extracted.kind).toBe('file');
});
it('宿主重复请求与丢失回执只核对同一发布，不重新创建', async () => {
  const { RecoveryOperations } = await import('../src/server/project-restore');
  const { parent, source, snapshot } = await fixture();
  const service = new RecoveryOperations(), plan = await planRecovery(snapshot, source);
  const args = { action: 'recover', snapshotPath: snapshot, sourcePath: source, targetPath: join(parent, 'host'), planId: plan.planId, operationId: randomUUID() };
  await service.call(args); await service.close();
  const receipt = await service.call({ action: 'status', operationId: args.operationId });
  expect(receipt).toMatchObject({ status: 'completed' }); expect(await service.call(args)).toEqual(receipt);
  await expect(service.call({ ...args, targetPath: join(parent, 'different') })).rejects.toThrow('不匹配');
});

it('恢复保留完整修订历史、候选恢复检查点与可校验的离线依赖', async () => {
  const { openProjectVNext } = await import('../src/server/project-lifecycle');
  const { fixture } = await import('./helpers/program-fixture');
  const { parse } = await import('yaml');
  const { vi } = await import('vitest');
  const root = await mkdtemp(join(tmpdir(), 'narracut-copy-history-'));
  roots.push(root);
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
    const snapshot = join(root, 'history.narracut-recovery.json');
    const cut = sealRecovery(source, initial.projectId, await recoveryBaseline(source, initial.projectId), { briefLocal: '待恢复的新 Brief' })!;
    await new RecoveryExports().run(cut, snapshot, randomUUID());
    const plan = await planRecovery(snapshot, source);
    expect(plan.blockers).toEqual([]);
    await recoverProject(snapshot, source, target, { planId: plan.planId });
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
it('恢复元数据的字符串与原始字节预算包含端点，超限拒绝且不尽力提取', async () => {
  const { snapshot } = await fixture();
  const original = JSON.parse(await readFile(snapshot, 'utf8'));
  const { recoveryHash } = await import('../src/server/project-recovery');
  const signed = (value: any) => { const { sha256, ...body } = value; return JSON.stringify({ ...body, sha256: recoveryHash(JSON.stringify(body)) }); };
  await writeFile(snapshot, signed({ ...original, sourcePath: '/' + 'a'.repeat(32767) }));
  expect((await inspectRecovery(snapshot)).sourcePath.length).toBe(32768);
  await writeFile(snapshot, signed({ ...original, sourcePath: '/' + 'a'.repeat(32768) }));
  await expect(inspectRecovery(snapshot)).rejects.toMatchObject({ code: 'RECOVERY_SNAPSHOT_LIMIT_EXCEEDED', metric: 'stringScalars' });
  const text = signed(original), encodedBytes = original.payload.briefLocal.base64.length;
  const padding = 1024 * 1024 - Buffer.byteLength(text) + encodedBytes;
  await writeFile(snapshot, text + ' '.repeat(padding)); await expect(inspectRecovery(snapshot)).resolves.toMatchObject({ projectId: original.projectId });
  await writeFile(snapshot, text + ' '.repeat(padding + 1));
  await expect(inspectRecovery(snapshot)).rejects.toMatchObject({ code: 'RECOVERY_SNAPSHOT_LIMIT_EXCEEDED', component: 'metadata' });
});
it('单个在途提交的两种精确指纹在计划中消除，其他来源结果不能进入确认', async () => {
  const { snapshot, source } = await fixture();
  const { recoveryHash } = await import('../src/server/project-recovery');
  const { sha256, ...body } = JSON.parse(await readFile(snapshot, 'utf8'));
  body.baseline.brief.push({ path: 'video.md', fingerprint: recoveryHash('在途提交') });
  await writeFile(snapshot, JSON.stringify({ ...body, sha256: recoveryHash(JSON.stringify(body)) }));
  let plan = await planRecovery(snapshot, source); expect(plan.blockers).toEqual([]);
  expect((plan.baseline as any).brief.fingerprint).toBe(recoveryHash(''));
  await writeFile(join(source, 'video.md'), '在途提交');
  plan = await planRecovery(snapshot, source); expect(plan.blockers).toEqual([]);
  expect((plan.baseline as any).brief.fingerprint).toBe(recoveryHash('在途提交'));
  await writeFile(join(source, 'video.md'), '未经允许的内容');
  expect((await planRecovery(snapshot, source)).blockers.some(item => item.code === 'RECOVERY_BASELINE_MISMATCH')).toBe(true);
});

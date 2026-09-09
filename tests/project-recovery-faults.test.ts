import { test, expect, vi } from 'vitest';
import { mkdtemp, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';
import { recoveryHash, RecoveryExports, RecoveryExportUncertain, validateRecovery } from '../src/server/project-recovery';
const fault = vi.hoisted(() => ({ target: '', after: false, callback: null as null | (() => Promise<void>) }));
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, link: async (...args: Parameters<typeof fs.link>) => {
    if (fault.target.endsWith('.narracut-recovery.json') && String(args[1]).endsWith('/' + fault.target.split('/').at(-1)) && fault.callback) {
      const callback = fault.callback; fault.callback = null;
      if (fault.after) { fault.after = false; await fs.link(...args); }
      await callback();
    }
    return fs.link(...args);
  }, rename: async (...args: Parameters<typeof fs.rename>) => {
    if ((String(args[1]) === fault.target || fault.target.endsWith('.narracut-recovery.json') && String(args[1]).endsWith('/' + fault.target.split('/').at(-1))) && fault.callback) { const callback = fault.callback; fault.callback = null; if (fault.after) { fault.after = false; await fs.rename(...args); } await callback(); }
    return fs.rename(...args);
  } };
});
for (const component of ['dsl', 'brief', 'candidate'] as const) test(`在途 ${component} 提交后封存核对安全成果，迟到输入不改变截面`, async () => {
  const parent = await mkdtemp(join(tmpdir(), 'recovery-flight-')), root = join(parent, 'project');
  await createProjectVNext(root); const opened = await openProjectVNext(root);
  const dsl = { assets: [], scenes: [{ id: randomUUID(), narration: { text: '保存中的旁白' }, assetIds: [] }] };
  let resolveEntered!: () => void, release!: () => void;
  const entered = new Promise<void>(r => resolveEntered = r), gate = new Promise<void>(r => release = r);
  fault.target = join(root, component === 'dsl' ? 'project.json' : component === 'brief' ? 'video.md' : '.narracut/candidate.json');
  fault.callback = async () => { resolveEntered(); await gate; };
  const pending = component === 'dsl' ? opened.saveProject(dsl, opened.inspection.projectRevision) : component === 'brief' ? opened.saveVideoBrief('保存中的目标', opened.inspection.videoBriefRevision) : opened.candidate({ action: 'create' });
  try {
    await entered;
    await rename(join(root, 'narracut.json'), join(root, 'away'));
    await expect(opened.assertWritable()).rejects.toThrow();
    const sealed = opened.freezeRecovery({ dsl: component === 'dsl' ? JSON.stringify(dsl) : undefined, briefLocal: component === 'brief' ? '保存中的目标' : '保留的 LOCAL' });
    release(); await pending;
    const cut = await sealed;
    if (component === 'brief') expect(cut).toBeNull();
    else if (component === 'dsl') { expect(cut?.payload.dsl).toBeUndefined(); expect(cut?.payload.briefLocal).toBeDefined(); }
    else {
      expect(cut?.baseline.candidate).toHaveLength(1);
      expect(cut?.baseline.candidate[0].fingerprint).toBe(recoveryHash(await readFile(join(root, '.narracut/candidate.json'))));
      expect(Object.keys(cut!.payload)).toEqual(['briefLocal']);
    }
    expect(await opened.freezeRecovery({ briefLocal: '迟到' })).toEqual(cut);
  } finally { release(); fault.callback = null; await opened.release(); }
});
test('原子提交结果暂不可读时保留提交前与拟提交两种精确基线', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'recovery-unknown-')), root = join(parent, 'project');
  await createProjectVNext(root); const opened = await openProjectVNext(root);
  const before = opened.inspection.videoBriefRevision;
  fault.target = join(root, 'video.md');
  fault.callback = async () => { await rename(join(root, 'narracut.json'), join(root, 'away')); throw new Error('提交结果不可读'); };
  try {
    await expect(opened.saveVideoBrief('LOCAL', before)).rejects.toThrow();
    const cut = await opened.freezeRecovery({ briefLocal: 'LOCAL', briefBase: '' });
    expect(cut?.baseline.brief.map(item => item.fingerprint)).toEqual([before, recoveryHash('LOCAL')]);
    expect(cut?.payload.briefLocal).toBeDefined();
    expect(cut?.payload.briefBase).toBeDefined();
  } finally { fault.callback = null; await opened.release(); }
});
test('导出进入提交阶段后回执不明可核对；同一请求不重新发布', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'recovery-export-fault-')), root = join(parent, 'project');
  await createProjectVNext(root); const opened = await openProjectVNext(root);
  const cut = (await opened.freezeRecovery({ briefLocal: '保留 LOCAL' }))!;
  const exporter = new RecoveryExports(), target = join(parent, '恢复.narracut-recovery.json'), operationId = randomUUID();
  // 第一次提交前报告故障：保留结果不明状态，不将请求已发送视为成功。
  fault.target = target; fault.callback = async () => { throw new Error('文件系统回执丢失'); };
  await expect(exporter.run(cut, target, operationId)).rejects.toBeInstanceOf(RecoveryExportUncertain);
  await expect(exporter.status(operationId)).rejects.toThrow('导出文件不存在');
  // 另一次正常导出使用新身份，原操作仍不能被重放成新快照。
  const success = await exporter.run(cut, join(parent, '另一份.narracut-recovery.json'), randomUUID());
  expect(validateRecovery(await readFile(success.path, 'utf8')).recoveryCutId).toBe(cut.recoveryCutId);
  await expect(exporter.run(cut, target, operationId)).rejects.toBeInstanceOf(RecoveryExportUncertain);
  await opened.release();
});

test('原子发布实际成功但回执丢失时，通过持久文件核对成功且不再写入', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'recovery-receipt-')), root = join(parent, 'project');
  await createProjectVNext(root); const opened = await openProjectVNext(root);
  const cut = (await opened.freezeRecovery({ briefLocal: '待抢救' }))!;
  const exporter = new RecoveryExports(), target = join(parent, '恢复.narracut-recovery.json'), id = randomUUID();
  fault.target = target; fault.after = true; fault.callback = async () => { throw new Error('已发布但回执丢失'); };
  await expect(exporter.run(cut, target, id)).rejects.toBeInstanceOf(RecoveryExportUncertain);
  const bytes = await readFile(target, 'utf8');
  expect(await exporter.status(id)).toEqual({ path: target, snapshotId: validateRecovery(bytes).snapshotId });
  expect(await readFile(target, 'utf8')).toBe(bytes);
  await opened.release();
});
test('发布瞬间目标出现也不覆盖第三方文件', async () => {
  const { writeFile } = await import('node:fs/promises');
  const parent = await mkdtemp(join(tmpdir(), 'recovery-no-clobber-')), root = join(parent, 'project');
  await createProjectVNext(root); const opened = await openProjectVNext(root);
  const cut = (await opened.freezeRecovery({ briefLocal: '保留 LOCAL' }))!;
  const target = join(parent, '恢复.narracut-recovery.json');
  fault.target = target; fault.callback = async () => { await writeFile(target, '第三方新文件'); };
  await expect(new RecoveryExports().run(cut, target, randomUUID())).rejects.toThrow('目标已存在');
  expect(await readFile(target, 'utf8')).toBe('第三方新文件');
  await opened.release();
});
test('接受后候选清理的原子提交也纳入身份失效对账', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'recovery-consumed-')), root = join(parent, 'project');
  await createProjectVNext(root); const opened = await openProjectVNext(root);
  const candidate = await opened.candidate({ action: 'create' });
  fault.target = join(root, '.narracut/candidate.json');
  fault.callback = async () => {
    await rename(join(root, 'narracut.json'), join(root, 'away'));
    await expect(opened.assertWritable()).rejects.toThrow();
  };
  try {
    const accepted = await opened.programTransaction(manager => manager.accept({ baseline: candidate.baseline, summary: '接受完整候选', source: 'candidate', acceptance: {} }, async () => {}));
    expect(accepted.status).toBe('accepted');
    const cut = await opened.freezeRecovery({ briefLocal: '未保存 Brief' });
    expect(cut?.baseline.candidate[0].fingerprint).toBe(recoveryHash(await readFile(join(root, '.narracut/candidate.json'))));
    expect(Object.values(cut!.baseline.candidate[0].bindings!)).toEqual([null, null, null]);
  } finally { fault.callback = null; await opened.release(); }
});

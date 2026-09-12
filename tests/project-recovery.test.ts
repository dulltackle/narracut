import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rename, writeFile, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';
import { RecoveryExports, validateRecovery, recoveryHash } from '../src/server/project-recovery';

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'narracut-recovery-'));
  const root = join(parent, 'project'); await createProjectVNext(root);
  const opened = await openProjectVNext(root);
  return { parent, root, opened };
}
describe('身份失效与恢复快照', () => {
  it('清单短暂消失后永久撤销写权，重复封存和导出保持同一截面', async () => {
    const { parent, root, opened } = await fixture();
    const manifest = join(root, 'narracut.json'), moved = join(root, 'manifest-away');
    await rename(manifest, moved);
    await expect(opened.assertWritable()).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_LOST' });
    await rename(moved, manifest);
    await expect(opened.saveVideoBrief('不能写', opened.inspection.videoBriefRevision)).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_LOST' });
    const cut = await opened.freezeRecovery({ briefLocal: '未保存的创作目标' });
    expect(cut?.payload.briefLocal?.base64).toBe(Buffer.from('未保存的创作目标').toString('base64'));
    expect(cut?.payload.briefBase).toBeUndefined();
    expect(await opened.freezeRecovery({ briefLocal: '迟到的修改' })).toEqual(cut);
    cut!.payload.briefLocal!.base64 = '破坏调用方副本';
    const sealed = (await opened.freezeRecovery({}))!;
    const exporter = new RecoveryExports();
    const id = randomUUID(), target = join(parent, '一.narracut-recovery.json');
    const result = await exporter.run(sealed, target, id);
    expect(await exporter.status(id)).toEqual(result);
    const firstBytes = await readFile(target, 'utf8'), first = validateRecovery(firstBytes);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    const next = await exporter.run(sealed, join(parent, '二.narracut-recovery.json'), randomUUID());
    const second = validateRecovery(await readFile(next.path, 'utf8'));
    expect(second.snapshotId).not.toBe(first.snapshotId);
    expect(second.recoveryCutId).toBe(first.recoveryCutId);
    expect(second.baseline).toEqual(first.baseline);
    expect(second.payload).toEqual(first.payload);
    expect(await readFile(target, 'utf8')).toBe(firstBytes);
    await expect(exporter.run(sealed, target, randomUUID())).rejects.toThrow('目标已存在');
    await expect(exporter.run(sealed, join(root, '内部.narracut-recovery.json'), randomUUID())).rejects.toThrow('项目目录之外');
    const alias = join(parent, 'alias'); await symlink(root, alias);
    await expect(exporter.run(sealed, join(alias, '内部.narracut-recovery.json'), randomUUID())).rejects.toThrow('项目目录之外');
    expect(() => validateRecovery(firstBytes.replace('"payload":', '"unknown":true,"payload":'))).toThrow();
    expect(() => validateRecovery(firstBytes.replace(first.payload.briefLocal!.base64, '%%%='))).toThrow();
    const missingBindings = JSON.parse(firstBytes);
    delete missingBindings.sha256; delete missingBindings.baseline.current[0].bindings;
    expect(() => validateRecovery(JSON.stringify({ ...missingBindings, sha256: recoveryHash(JSON.stringify(missingBindings)) }))).toThrow('身份绑定');
    expect(() => validateRecovery(firstBytes.replace('"base64"', '"base\\u00364"'))).toThrow();
    await opened.release();
  });
  it('已确认保存不导出，无内存成果不创建快照；Brief 冲突仅携带必要 BASE', async () => {
    const { root, opened } = await fixture();
    await opened.saveVideoBrief('已保存', opened.inspection.videoBriefRevision);
    await rename(join(root, 'narracut.json'), join(root, 'away'));
    await expect(opened.assertWritable()).rejects.toThrow();
    expect(await opened.freezeRecovery({ briefLocal: '已保存' })).toBeNull();
    await opened.release();
    const next = await fixture();
    await writeFile(join(next.root, 'video.md'), '磁盘外部编辑');
    await next.opened.saveVideoBrief('LOCAL', next.opened.inspection.videoBriefRevision);
    await rename(join(next.root, 'narracut.json'), join(next.root, 'away'));
    const cut = await next.opened.freezeRecovery({ briefLocal: 'LOCAL', briefBase: '' });
    expect(cut?.payload.briefBase?.bytes).toBe(0);
    expect(cut?.baseline.brief[0].fingerprint).toBe(recoveryHash('磁盘外部编辑'));
    await next.opened.release();
  });
  it('目录替换后不使用替代项目作恢复基线，并阻断候选和任务提交', async () => {
    const { root, opened } = await fixture();
    const baseline = opened.inspection.projectRevision;
    await rename(root, root + '-old'); await createProjectVNext(root);
    await expect(opened.candidate({ action: 'create' })).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_LOST' });
    let ran = false;
    await expect(opened.programTransaction(async () => { ran = true; })).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_LOST' });
    expect(ran).toBe(false);
    const cut = await opened.freezeRecovery({ dsl: '{"assets": [], "scenes": []}' });
    expect(cut?.baseline.dsl[0].fingerprint).toBe(baseline);
    await opened.release();
  });
});

it('连续本地保存与后续未保存编辑不额外携带 BASE', async () => {
  const { opened } = await fixture();
  await opened.saveVideoBrief('已确认中间保存', opened.inspection.videoBriefRevision);
  const cut = await opened.freezeRecovery({ briefLocal: '仍在输入的后续编辑', briefBase: '' });
  expect(cut?.payload.briefLocal).toBeDefined();
  expect(cut?.payload.briefBase).toBeUndefined();
  await opened.release();
});
it('不可访问或不存在的目录、非法扩展名和已移动原项目均保留截面', async () => {
  const { mkdir, chmod } = await import('node:fs/promises');
  const { parent, root, opened } = await fixture();
  const cut = (await opened.freezeRecovery({ briefLocal: '必须保留' }))!;
  const exporter = new RecoveryExports();
  await expect(exporter.run(cut, join(parent, '不存在', '恢复.narracut-recovery.json'), randomUUID())).rejects.toThrow();
  await expect(exporter.run(cut, join(parent, '错误.json'), randomUUID())).rejects.toThrow('新 .narracut-recovery.json');
  await rename(root, root + '-moved');
  await expect(exporter.run(cut, join(root + '-moved', '恢复.narracut-recovery.json'), randomUUID(), opened.recoveryRootIdentity)).rejects.toThrow('已移动的原项目');
  const forbidden = join(parent, '不可访问'); await mkdir(forbidden); await chmod(forbidden, 0);
  try {
    if (process.getuid?.() !== 0) await expect(exporter.run(cut, join(forbidden, '恢复.narracut-recovery.json'), randomUUID())).rejects.toThrow();
  } finally { await chmod(forbidden, 0o700); }
  expect(await opened.freezeRecovery({ briefLocal: '不得替换' })).toEqual(cut);
  const success = await exporter.run(cut, join(parent, '恢复.narracut-recovery.json'), randomUUID());
  expect(validateRecovery(await readFile(success.path, 'utf8')).payload).toEqual(cut.payload);
  await opened.release();
});

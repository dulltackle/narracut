import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createProjectVNext } from '../src/server/project-lifecycle';
import { recoveryBaseline, sealRecovery, RecoveryExports } from '../src/server/project-recovery';
import { RecoveryOperations, planRecovery, recoverProject } from '../src/server/project-restore';
const fault = vi.hoisted(() => ({ cleanup: false, linkAfter: false, renameTarget: '', projectPath: '', readBytes: 0 }));
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs,
    link: async (...args: Parameters<typeof fs.link>) => { await fs.link(...args); if (fault.linkAfter && String(args[0]).includes('.extract-')) { fault.linkAfter = false; throw new Error('提取发布回执丢失'); } },
    rm: async (...args: Parameters<typeof fs.rm>) => { if (fault.cleanup && String(args[0]).includes('.extract-')) throw Object.assign(new Error('无法清理提取临时文件'), { code: 'EACCES' }); return fs.rm(...args); },
    rename: async (...args: Parameters<typeof fs.rename>) => { await fs.rename(...args); if (String(args[1]) === fault.renameTarget) throw new Error('原子发布回执丢失'); },
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (String(args[0]) === fault.projectPath) {
        const read = handle.read.bind(handle);
        handle.read = (async (...values: any[]) => { const result = await (read as any)(...values); fault.readBytes += result.bytesRead; return result; }) as typeof handle.read;
      }
      return handle;
    },
  };
});
const roots: string[] = [];
afterEach(async () => { fault.cleanup = false; fault.linkAfter = false; fault.renameTarget = ''; fault.projectPath = ''; fault.readBytes = 0; await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'restore-fault-')); roots.push(parent);
  const source = join(parent, 'source'), created = await createProjectVNext(source);
  const cut = sealRecovery(source, created.projectId, await recoveryBaseline(source, created.projectId), { briefLocal: 'LOCAL' })!;
  const snapshot = join(parent, 'snapshot.narracut-recovery.json'); await new RecoveryExports().run(cut, snapshot, randomUUID());
  return { parent, source, created, snapshot };
}
it('已发布提取物的清理错误保留完成事实及准确残留路径', async () => {
  const { parent, source, snapshot } = await fixture(); await rm(join(source, 'project.json'));
  fault.cleanup = true;
  const service = new RecoveryOperations(), request = { action: 'extract', snapshotPath: snapshot, sourcePath: source, targetPath: join(parent, 'extracted.md'), component: 'briefLocal', operationId: randomUUID() };
  await service.call(request); await service.close();
  const status = await service.call({ action: 'status', operationId: request.operationId });
  expect(status).toMatchObject({ status: 'completed', result: { kind: 'file', cleanupWarning: { path: expect.stringMatching(/\.extract-.*\.tmp$/) } } });
  expect(await readFile(request.targetPath, 'utf8')).toBe('LOCAL'); expect(await service.call(request)).toEqual(status);
});
it('原子恢复发布已经发生但回执丢失时，通过本次目录身份和标记确认完成', async () => {
  const { parent, source, snapshot, created } = await fixture();
  const plan = await planRecovery(snapshot, source), target = join(parent, 'restored'); fault.renameTarget = target;
  const result = await recoverProject(snapshot, source, target, { planId: plan.planId });
  expect(result.projectId).toBe(created.projectId); expect(result.revisionId).toBe(created.revisionId);
  expect(await readFile(join(target, 'video.md'), 'utf8')).toBe('LOCAL');
});
it('超限来源控制文件在读取前失败关闭', async () => {
  const { source, snapshot } = await fixture(); fault.projectPath = join(source, 'project.json');
  await writeFile(fault.projectPath, Buffer.alloc(10 * 1024 * 1024 + 1, 32));
  const plan = await planRecovery(snapshot, source);
  expect(plan.blockers).toHaveLength(1);
  expect(plan.blockers[0]!.code).toBe('PROJECT_CONTROL_FILE_LIMIT_EXCEEDED');
  expect(fault.readBytes).toBe(0);
});

it('提取实际发布后丢失回执，状态核对确认同一文件且不重新发布', async () => {
  const { parent, source, snapshot } = await fixture(); await rm(join(source, 'project.json')); fault.linkAfter = true;
  const service = new RecoveryOperations(), request = { action: 'extract', snapshotPath: snapshot, sourcePath: source, targetPath: join(parent, 'extracted.md'), component: 'briefLocal', operationId: randomUUID() };
  await service.call(request); await service.close();
  expect(await service.call({ action: 'status', operationId: request.operationId })).toMatchObject({ status: 'completed', result: { path: request.targetPath, kind: 'file' } });
  expect(await readFile(request.targetPath, 'utf8')).toBe('LOCAL');
});
it('提取目标冲突且清理失败时指出准确残留，既有文件保持原样', async () => {
  const { parent, source, snapshot } = await fixture(); await rm(join(source, 'project.json'));
  const target = join(parent, 'exists.md'); await writeFile(target, '既有文件'); fault.cleanup = true;
  const service = new RecoveryOperations(), operationId = randomUUID();
  await service.call({ action: 'extract', snapshotPath: snapshot, sourcePath: source, targetPath: target, component: 'briefLocal', operationId }); await service.close();
  expect(await service.call({ action: 'status', operationId })).toMatchObject({ status: 'failed', error: { message: expect.stringContaining(`${parent}/.extract-`) } });
  expect(await readFile(target, 'utf8')).toBe('既有文件');
});

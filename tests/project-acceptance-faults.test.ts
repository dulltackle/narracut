import { test, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectAcceptance } from '../src/server/project-acceptance';
import { ProjectPreview } from '../src/server/project-preview';
import { ProjectChecks } from '../src/server/project-checks';
import { ProjectDelivery } from '../src/server/project-delivery';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';
const fault = vi.hoisted(() => ({ phase: '' }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (fault.phase === 'discard-commit' && String(args[1]).endsWith('/candidate.json')) throw new Error('注入放弃提交失败');
      if (fault.phase === 'consume' && String(args[1]).endsWith('/candidate.json') && String(args[0]).includes('/consumed-')) throw new Error('注入候选消费清理失败');
      if (fault.phase === 'commit' && String(args[1]).endsWith('/current.json')) throw new Error('注入原子提交失败');
      return fs.rename(...args);
    },
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (fault.phase === 'task-cleanup' && String(args[0]).endsWith('/agent-task.json')) throw new Error('注入任务清理失败');
      if (fault.phase === 'cleanup' && String(args[0]).endsWith('/candidate')) throw new Error('注入清理失败');
      return fs.rm(...args);
    },
  };
});
test('提交点前失败保持原状态；提交点后清理失败不可撤销且重启能幂等恢复', async () => {
  const root = await mkdtemp(join(tmpdir(), 'accept-fault-')), path = join(root, 'project');
  await createProjectVNext(path); let opened = await openProjectVNext(path);
  try {
    const initial = await opened.candidate({ action: 'create' });
    const candidate = await opened.candidate({ action: 'apply', baseline: initial.baseline, changes: [{path:'resources/test.txt',content:'完整候选'}] });
    const before = await readFile(join(path,'.narracut/current.json'));
    fault.phase = 'commit';
    await expect(opened.programTransaction(manager=>manager.accept({baseline:candidate.baseline,summary:'接受',source:'candidate',acceptance:{}},async()=>{}))).rejects.toThrow('未接受');
    expect(await readFile(join(path,'.narracut/current.json'))).toEqual(before);
    expect(await opened.candidate({action:'read'})).toEqual(candidate);
    const beforeCandidate = await readFile(join(path,'.narracut/candidate.json'));
    fault.phase = 'consume';
    const result = await opened.programTransaction(manager=>manager.accept({baseline:candidate.baseline,summary:'接受',source:'candidate',acceptance:{}},async()=>{}));
    expect(result).toMatchObject({status:'accepted',cleanupPending:true});
    expect(await readFile(join(path,'.narracut/candidate.json'))).toEqual(beforeCandidate);
    expect((await opened.candidate({action:'read'})).status).toBe('absent');
    expect(JSON.parse(await readFile(join(path,'.narracut/current.json'),'utf8')).revisionId).toBe(result.revision.revisionId);
    await opened.release(); opened=await openProjectVNext(path);
    expect((await opened.candidate({action:'read'})).status).toBe('absent');
    expect((await opened.programTransaction(manager=>manager.history())).cleanupPending).toBe(true);
    fault.phase='cleanup';
    expect((await opened.programTransaction(manager=>manager.cleanupAcceptance())).cleanupPending).toBe(true);
    expect((await opened.candidate({action:'read'})).status).toBe('absent');
    fault.phase='';
    expect(await opened.programTransaction(manager=>manager.cleanupAcceptance())).toEqual({cleanupPending:false});
    expect(await opened.programTransaction(manager=>manager.cleanupAcceptance())).toEqual({cleanupPending:false});
    await expect(readFile(join(path,candidate.candidate!.path,'resources/test.txt'))).rejects.toThrow();
    await expect(readFile(join(path,candidate.checkpoint!.path,'program.json'))).rejects.toThrow();
    expect((await opened.programTransaction(manager=>manager.history())).current).toBe(result.revision.revisionId);
  }finally{fault.phase='';await opened.release();await rm(root,{recursive:true,force:true});}
});

test('接受的提交点同时使旧任务检查点失效，收尾失败不允许重启恢复旧任务', async () => {
  const { writeFile } = await import('node:fs/promises');
  const { endedTaskReason } = await import('../src/server/project-revisions');
  const root = await mkdtemp(join(tmpdir(), 'task-accept-fault-')), path = join(root, 'project');
  await createProjectVNext(path); const opened = await openProjectVNext(path);
  try {
    const candidate = await opened.candidate({ action: 'create' });
    const checkpoint = join(path, '.narracut/agent-task.json');
    await writeFile(checkpoint, JSON.stringify({ taskId: '旧任务', instruction: '保持原文' }));
    fault.phase = 'commit';
    await expect(opened.programTransaction(manager => manager.accept({ baseline: candidate.baseline, summary: '接受', source: 'candidate', acceptance: {} }, async () => {}))).rejects.toThrow('未接受');
    expect(await endedTaskReason(path)).toBeNull();
    fault.phase = 'task-cleanup';
    const requestId = '10000000-0000-4000-8000-000000000113';
    const result = await opened.programTransaction(manager => manager.accept({ baseline: candidate.baseline, summary: '接受', source: 'candidate', acceptance: {}, requestId }, async () => {}));
    expect(result).toMatchObject({ status: 'accepted', cleanupPending: true });
    expect((await opened.candidate({ action: 'read' })).status).toBe('absent');
    expect(await endedTaskReason(path)).toBe('CANDIDATE_ACCEPTED');
    fault.phase = '';
    const preview = new ProjectPreview();
    const acceptance = new ProjectAcceptance(new ProjectDelivery(preview, new ProjectChecks(preview)), preview);
    expect(await acceptance.operate(opened, { action: 'result', requestId })).toMatchObject({ status: 'accepted', taskCleanupPending: true });
    expect(JSON.parse(await readFile(checkpoint, 'utf8')).taskId).toBe('旧任务');
    await opened.programTransaction(manager => manager.cleanupAcceptance());
    await expect(readFile(checkpoint)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(checkpoint, '新任务');
    await opened.programTransaction(manager => manager.cleanupAcceptance());
    expect(await readFile(checkpoint, 'utf8')).toBe('新任务');
  } finally { fault.phase = ''; await opened.release(); await rm(root, { recursive: true, force: true }); }
});

test('放弃提交前故障保留三项，提交后收尾故障原子隐藏三项且保留当前修订', async () => {
  const { writeFile } = await import('node:fs/promises');
  const { endedTaskReason } = await import('../src/server/project-revisions');
  const root = await mkdtemp(join(tmpdir(), 'task-discard-fault-')), path = join(root, 'project');
  await createProjectVNext(path); const opened = await openProjectVNext(path);
  try {
    const first = await opened.candidate({ action: 'create' });
    const candidate = await opened.candidate({ action: 'apply', baseline: first.baseline, changes: [{ path: 'resources/proof.txt', content: '保留字节' }] });
    const checkpoint = join(path, '.narracut/agent-task.json');
    await writeFile(checkpoint, '旧任务检查点');
    const current = await readFile(join(path, '.narracut/current.json'));
    fault.phase = 'discard-commit';
    await expect(opened.candidate({ action: 'discard', baseline: candidate.baseline, confirmed: true })).rejects.toThrow();
    expect(await opened.candidate({ action: 'read' })).toEqual(candidate);
    expect(await endedTaskReason(path)).toBeNull();
    fault.phase = 'task-cleanup';
    expect((await opened.candidate({ action: 'discard', baseline: candidate.baseline, confirmed: true })).status).toBe('absent');
    expect(await endedTaskReason(path)).toBe('CANDIDATE_ABANDONED');
    expect(await readFile(join(path, '.narracut/current.json'))).toEqual(current);
  } finally { fault.phase = ''; await opened.release(); await rm(root, { recursive: true, force: true }); }
});

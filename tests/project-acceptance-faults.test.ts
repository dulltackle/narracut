import { test, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';
const fault = vi.hoisted(() => ({ phase: '' }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (fault.phase === 'consume' && String(args[1]).endsWith('/candidate.json') && String(args[0]).includes('/consumed-')) throw new Error('注入候选消费清理失败');
      if (fault.phase === 'commit' && String(args[1]).endsWith('/current.json')) throw new Error('注入原子提交失败');
      return fs.rename(...args);
    },
    rm: async (...args: Parameters<typeof fs.rm>) => {
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

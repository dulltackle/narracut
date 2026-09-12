import { test, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';

test('接受完整候选原子切换当前、消费检查点并在重开后保留修订', async () => {
  const root = await mkdtemp(join(tmpdir(), 'accept-storage-')), path = join(root, 'project');
  await createProjectVNext(path); let opened = await openProjectVNext(path);
  try {
    const original = JSON.parse(await readFile(join(path, '.narracut/current.json'), 'utf8')).revisionId;
    const first = await opened.candidate({ action: 'create' });
    const candidate = await opened.candidate({ action: 'apply', baseline: first.baseline, changes: [{ path: 'resources/note.txt', content: '已接受的完整程序' }] });
    const result = await opened.programTransaction(manager => manager.accept({ baseline: candidate.baseline, summary: '调整标题', source: 'candidate', acceptance: { protocolVersion: 1 } }, async () => {}));
    expect(result.status).toBe('accepted');
    expect(result.revision.previousRevisionId).toBe(original);
    expect(result.revision.programFingerprint).toBe(candidate.candidate!.identity);
    expect((await opened.candidate({ action: 'read' })).status).toBe('absent');
    await opened.release(); opened = await openProjectVNext(path);
    expect((await opened.programTransaction(manager => manager.history())).revisions[0].revisionId).toBe(result.revision.revisionId);
    expect(await readFile(join(path, '.narracut/revisions', result.revision.revisionId, 'render-program/resources/note.txt'), 'utf8')).toBe('已接受的完整程序');
  } finally { await opened.release(); await rm(root, { recursive: true, force: true }); }
});

test('提交前复核失败保留旧当前与候选；历史有界且损坏项占名额，不能回退或覆盖候选', async () => {
  const root = await mkdtemp(join(tmpdir(), 'accept-history-')), path = join(root, 'project');
  await createProjectVNext(path); const opened = await openProjectVNext(path);
  try {
    const candidate = await opened.candidate({ action: 'create' });
    const original = await readFile(join(path, '.narracut/current.json'));
    await expect(opened.programTransaction(manager => manager.accept({ baseline: candidate.baseline, summary: '失败', source: 'candidate', acceptance: {} }, async () => { throw new Error('输入已变化'); }))).rejects.toThrow('未接受');
    expect(await readFile(join(path, '.narracut/current.json'))).toEqual(original);
    expect(await opened.candidate({ action: 'read' })).toEqual(candidate);
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) {
      const next = i === 0 ? candidate : await opened.candidate({ action: 'create' });
      const result = await opened.programTransaction(manager => manager.accept({ baseline: next.baseline, summary: `接受 ${i}`, source: 'candidate', acceptance: {} }, async () => {}));
      ids.push(result.revision.revisionId);
    }
    const history = await opened.programTransaction(manager => manager.history());
    expect(history.revisions).toHaveLength(20);
    expect(history.revisions.map(item => item.revisionId)).toEqual(ids.slice(1).reverse());
    await expect(opened.candidate({ action: 'create', sourceRevision: ids[0] })).rejects.toThrow('移出历史');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(path, '.narracut/revisions', ids[1], 'render-program/resources/damage.txt'), '外部改写');
    const damaged = await opened.programTransaction(manager => manager.history());
    expect(damaged.revisions).toHaveLength(20); expect(damaged.revisions.at(-1)?.valid).toBe(false);
    await expect(opened.candidate({ action: 'create', sourceRevision: ids[1] })).rejects.toThrow('损坏');
    const restored = await opened.candidate({ action: 'create', sourceRevision: ids[2] });
    expect(restored.sourceRevision).toBe(ids[2]);
    expect(JSON.parse(await readFile(join(path, '.narracut/current.json'), 'utf8')).revisionId).toBe(ids[20]);
    await expect(opened.candidate({ action: 'create', sourceRevision: ids[3] })).rejects.toMatchObject({ code: 'CANDIDATE_ALREADY_EXISTS' });
  } finally { await opened.release(); await rm(root, { recursive: true, force: true }); }
}, 30000);

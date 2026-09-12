import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';
import { ProjectChecks } from '../src/server/project-checks';
import { ProjectPreview } from '../src/server/project-preview';
test('真实候选同时报告 Manifest 与离线依赖错误，独立环境检查继续；换代使整批过期', async () => {
  const root = await mkdtemp(join(tmpdir(), 'checks-project-')); const directory = join(root, 'project');
  await createProjectVNext(directory); const opened = await openProjectVNext(directory); const preview = new ProjectPreview(); const checks = new ProjectChecks(preview);
  try {
    const created = await opened.candidate({ action: 'create' });
    const broken = await opened.candidate({ action: 'apply', baseline: created.baseline, changes: [{ path: 'program.json', content: '{invalid json' }] });
    await checks.start(opened);
    let result = await checks.status(opened);
    for (let attempt = 0; result.batches.at(-1)?.status === 'running' && attempt < 50; attempt++) { await new Promise(resolve => setTimeout(resolve, 20)); result = await checks.status(opened); }
    expect(result.batches[0].status).toBe('complete');
    expect(result.batches[0].diagnostics.map(item => item.code)).toEqual(expect.arrayContaining(['MANIFEST_INVALID', 'DEPENDENCY_UNAVAILABLE']));
    expect(result.batches[0].stages.find(item => item.id === 'build')).toMatchObject({ status: 'not-run' });
    expect(result.batches[0].stages.find(item => item.id === 'capsule')?.status).not.toBe('not-run');
    expect(result.batches[0].diagnostics.find(item => item.code === 'MANIFEST_INVALID')).toMatchObject({ location: { kind: 'file', path: 'program.json' }, identity: { program: broken.candidate?.identity } });
    await opened.candidate({ action: 'apply', baseline: broken.baseline, changes: [{ path: 'program.json', content: '{"apiVersion":1,"output":{"width":320,"height":180,"fps":30}}' }] });
    result = await checks.status(opened); expect(result.batches[0].stale).toBe(true);
    expect(result.gates.map(item => item.status)).toEqual(['blocked','blocked','blocked','disabled']);
    await checks.start(opened); result = await checks.status(opened);
    expect(result.batches).toHaveLength(2); expect(result.batches[0].stale).toBe(true);
    expect(result.batches[1].diagnostics.some(item => item.code === 'MANIFEST_INVALID')).toBe(false);
  } finally { checks.clear(); await preview.close(); await opened.release(); await rm(root, { recursive: true, force: true }); }
}, 120000);
test('捕获期间候选换代拒绝创建混合批次，不能把新程序错误贴到旧身份', async () => {
  const root = await mkdtemp(join(tmpdir(), 'checks-race-')); const directory = join(root, 'project');
  await createProjectVNext(directory); const opened = await openProjectVNext(directory); const preview = new ProjectPreview(); const checks = new ProjectChecks(preview);
  try {
    const candidate = await opened.candidate({ action: 'create' });
    let release!: () => void; const sourceRead = new Promise<void>(resolve => { release = resolve; });
    const read = opened.readPreviewSource;
    opened.readPreviewSource = async target => { const value = await read(target); release(); return value; };
    const capture = preview.capture.bind(preview);
    preview.capture = async (...args) => {
      await sourceRead;
      await opened.candidate({ action: 'apply', baseline: candidate.baseline, changes: [{ path: 'program.json', content: '{"apiVersion":2}' }] });
      return capture(...args);
    };
    await expect(checks.start(opened)).rejects.toThrow('未创建混合批次');
    expect((await checks.status(opened)).batches).toEqual([]);
  } finally { checks.clear(); await preview.close(); await opened.release(); await rm(root, { recursive: true, force: true }); }
}, 120000);
test('媒体捕获失败不能豁免其余成功观察之间的基线冲突', async () => {
  const root = await mkdtemp(join(tmpdir(), 'checks-partial-race-')); const directory = join(root, 'project');
  await createProjectVNext(directory); const opened = await openProjectVNext(directory); const preview = new ProjectPreview(); const checks = new ProjectChecks(preview);
  try {
    const created = await opened.candidate({ action: 'create' }); const operate = opened.candidate;
    let release!: () => void; const updated = new Promise<void>(resolve => { release = resolve; });
    opened.candidate = async request => { if (request.action === 'read') await updated; return operate(request); };
    const read = opened.readPreviewSource;
    opened.readPreviewSource = async target => {
      const value = await read(target);
      await operate({ action: 'apply', baseline: created.baseline, changes: [{ path: 'src/change.txt', content: 'new identity' }] });
      release(); return value;
    };
    preview.capture = async () => { throw new Error('媒体读取失败'); };
    await expect(checks.start(opened)).rejects.toThrow('未创建混合批次');
    expect((await checks.status(opened)).batches).toEqual([]);
  } finally { checks.clear(); await preview.close(); await opened.release(); await rm(root, { recursive: true, force: true }); }
}, 120000);

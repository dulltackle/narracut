import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, afterEach } from 'vitest';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';

// 依赖下载包含真实 OS 胶囊认证，首次调用需要完成资源与浏览器验收。
vi.setConfig({ testTimeout: 30_000 });
afterEach(() => vi.unstubAllGlobals());
it('依赖协调拒绝非精确声明与非公共来源，失败不改变候选且不联网', async () => {
  const directory = join(await mkdtemp(join(tmpdir(), 'dependencies-')), 'project');
  await createProjectVNext(directory);
  const project = await openProjectVNext(directory);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  try {
    const before = await project.candidate({ action: 'create' });
    for (const version of ['^1.0.0', 'latest', 'file:../secret', 'git+https://host/repo', 'https://host/a.tgz']) {
      await expect(project.candidate({ action: 'dependencies', baseline: before.baseline, dependencies: { example: version }, packages: [] })).rejects.toMatchObject({ code: 'DEPENDENCY_SOURCE_UNSUPPORTED' });
      expect(await project.candidate({ action: 'read' })).toEqual(before);
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally { await project.release(); }
});

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { parse, stringify } from 'yaml';

function archive(meta: Record<string, unknown>, path = 'package/package.json', type = '0') {
  const content = Buffer.from(JSON.stringify(meta));
  const header = Buffer.alloc(512);
  header.write(path); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0', 257);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  return gzipSync(Buffer.concat([header, content, Buffer.alloc((512 - content.length % 512) % 512), Buffer.alloc(1024)]));
}
function pin(name: string, version: string, bytes: Buffer) {
  return { name, version, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
}
async function fixture() {
  const directory = join(await mkdtemp(join(tmpdir(), 'dependency-graph-')), 'project');
  await createProjectVNext(directory);
  const current = JSON.parse(await readFile(join(directory, '.narracut/current.json'), 'utf8'));
  const lockPath = join(directory, '.narracut/revisions', current.revisionId, 'render-program/pnpm-lock.yaml');
  let lock = await readFile(lockPath, 'utf8');
  const files = new Map<string, Buffer>();
  const metas = [
    { name: 'react', version: '19.2.8' },
    { name: 'react-dom', version: '19.2.8', dependencies: { scheduler: '^0.27.0' }, peerDependencies: { react: '^19.2.8' } },
    { name: 'remotion', version: '4.0.512', peerDependencies: { react: '>=16.8.0', 'react-dom': '>=16.8.0' } },
    { name: 'scheduler', version: '0.27.0' },
  ];
  const parsed = parse(lock);
  for (const meta of metas) {
    const bytes = archive(meta); const p = pin(meta.name, meta.version, bytes);
    lock = lock.replace(parsed.packages[`${p.name}@${p.version}`].resolution.integrity, p.integrity);
    files.set(`https://registry.npmjs.org/${p.name}/-/${p.name}-${p.version}.tgz`, bytes);
  }
  await writeFile(lockPath, lock);
  const fetch = vi.fn(async (url: string) => {
    const bytes = files.get(url);
    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  const project = await openProjectVNext(directory);
  return { directory, project, files, fetch };
}

it('精确依赖与完整锁图、离线库一起发布，检查点与重启、普通修改和放弃都保留包且不联网', async () => {
  const { directory, project, files, fetch } = await fixture();
  let opened = project;
  try {
    const before = await opened.candidate({ action: 'create' });
    const bytes = archive({ name: 'example', version: '1.0.0', dependencies: { helper: '^2.0.0' }, scripts: { postinstall: 'touch /tmp/never-execute' } });
    const helper = archive({ name: 'helper', version: '2.1.0' });
    files.set('https://registry.npmjs.org/example/-/example-1.0.0.tgz', bytes);
    files.set('https://registry.npmjs.org/helper/-/helper-2.1.0.tgz', helper);
    const saved = await opened.candidate({ action: 'dependencies', baseline: before.baseline, dependencies: { example: '1.0.0' }, packages: [pin('example', '1.0.0', bytes), pin('helper', '2.1.0', helper)] });
    expect(saved.checkpoint?.identity).toBe(before.candidate?.identity);
    const lock = parse(await readFile(join(directory, saved.candidate!.path, 'pnpm-lock.yaml'), 'utf8'));
    expect(lock.importers['.'].dependencies.example).toEqual({ specifier: '1.0.0', version: '1.0.0' });
    expect(lock.snapshots['example@1.0.0'].dependencies).toEqual({ helper: '2.1.0' });
    expect(JSON.parse(await readFile(join(directory, saved.checkpoint!.path, 'package.json'), 'utf8')).dependencies.example).toBeUndefined();
    expect(await readdir(join(directory, saved.offline!))).toHaveLength(6);
    expect(await readFile(join(directory, saved.offline!, `${createHash('sha512').update(bytes).digest('hex')}.tgz`))).toEqual(bytes);
    fetch.mockClear(); fetch.mockRejectedValue(new Error('断网'));
    await opened.release(); opened = await openProjectVNext(directory);
    expect(await opened.candidate({ action: 'read' })).toEqual(saved);
    const changed = await opened.candidate({ action: 'apply', baseline: saved.baseline, changes: [{ path: 'resources/proof.txt', content: 'offline' }] });
    expect(await readdir(join(directory, changed.offline!))).toHaveLength(6);
    const discarded = await opened.candidate({ action: 'discard', baseline: changed.baseline, confirmed: true });
    expect(discarded.status).toBe('absent');
    expect(await readdir(join(directory, discarded.offline!))).toHaveLength(6);
    await expect(access(join(directory, changed.candidate!.path))).rejects.toThrow();
    await opened.release(); opened = await openProjectVNext(directory);
    const recreated = await opened.candidate({ action: 'create' });
    expect(await readdir(join(directory, recreated.offline!))).toHaveLength(6);
    expect(fetch).not.toHaveBeenCalled();
  } finally { await opened.release(); }
});

it('拒绝凭据、私有 registry、Remotion 异版和缺失摘要，均在下载前失败', async () => {
  const { project, fetch } = await fixture();
  try {
    const before = await project.candidate({ action: 'create' });
    const bytes = archive({ name: 'example', version: '1.0.0' });
    for (const extra of [{ registry: 'https://private.example' }, { credentials: 'secret' }, { token: 'secret' }]) {
      await expect(project.candidate({ action: 'dependencies', baseline: before.baseline, dependencies: { example: '1.0.0' }, packages: [pin('example', '1.0.0', bytes)], ...extra })).rejects.toMatchObject({ code: 'DEPENDENCY_SOURCE_UNSUPPORTED' });
    }
    await expect(project.candidate({ action: 'dependencies', baseline: before.baseline, dependencies: { '@remotion/shapes': '4.0.511' }, packages: [pin('@remotion/shapes', '4.0.511', bytes)] })).rejects.toMatchObject({ code: 'REMOTION_VERSION_MISMATCH' });
    await expect(project.candidate({ action: 'dependencies', baseline: before.baseline, dependencies: { example: '1.0.0' }, packages: [{ name: 'example', version: '1.0.0', integrity: '' }] })).rejects.toMatchObject({ code: 'DEPENDENCY_SOURCE_UNSUPPORTED' });
    expect(fetch).not.toHaveBeenCalled();
  } finally { await project.release(); }
});

it('下载被篡改、越界重定向、包身份伪装、恶意 tar 或传递来源不合法时整批回滚', async () => {
  const { directory, project, files, fetch } = await fixture();
  try {
    const before = await project.candidate({ action: 'create' });
    const namesBefore = await readdir(join(directory, '.narracut'));
    const bytes = archive({ name: 'aaa-example', version: '1.0.0' });
    const request = { action: 'dependencies' as const, baseline: before.baseline, dependencies: { 'aaa-example': '1.0.0' }, packages: [pin('aaa-example', '1.0.0', bytes)] };
    const url = 'https://registry.npmjs.org/aaa-example/-/aaa-example-1.0.0.tgz';
    files.set(url, Buffer.from('tampered'));
    await expect(project.candidate(request)).rejects.toMatchObject({ code: 'DEPENDENCY_INTEGRITY_FAILED' });
    for (const location of ['https://private.example/a.tgz', 'http://registry.npmjs.org/a.tgz', 'https://secret@registry.npmjs.org/a.tgz']) {
      fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }));
      const calls = fetch.mock.calls.length;
      await expect(project.candidate(request)).rejects.toMatchObject({ code: 'DEPENDENCY_SOURCE_UNSUPPORTED' });
      expect(fetch.mock.calls.length - calls).toBe(1);
    }
    for (const bad of [archive({ name: 'imposter', version: '1.0.0' }), archive({}, 'package/../../escape'), archive({}, 'package/link', '2'), archive({ name: 'aaa-example', version: '1.0.0', dependencies: { secret: 'https://host/secret.tgz' } })]) {
      files.set(url, bad);
      await expect(project.candidate({ ...request, packages: [pin('aaa-example', '1.0.0', bad)] })).rejects.toMatchObject({ code: 'DEPENDENCY_SOURCE_UNSUPPORTED' });
      expect(await project.candidate({ action: 'read' })).toEqual(before);
      expect(await readdir(join(directory, '.narracut'))).toEqual(namesBefore);
    }
  } finally { await project.release(); }
});

it('下载期间外部候选修改阻止提交，已经下载的包不会提前发布', async () => {
  const { directory, project, files, fetch } = await fixture();
  try {
    const before = await project.candidate({ action: 'create' });
    const bytes = archive({ name: 'aaa-example', version: '1.0.0' });
    files.set('https://registry.npmjs.org/aaa-example/-/aaa-example-1.0.0.tgz', bytes);
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementationOnce(async (url) => {
      await writeFile(join(directory, before.candidate!.path, 'resources/external.txt'), '外部修改');
      return original(url);
    });
    const directories = await readdir(join(directory, '.narracut'));
    await expect(project.candidate({ action: 'dependencies', baseline: before.baseline, dependencies: { 'aaa-example': '1.0.0' }, packages: [pin('aaa-example', '1.0.0', bytes)] })).rejects.toMatchObject({ code: 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED' });
    expect(await readdir(join(directory, '.narracut'))).toEqual(directories);
    expect((await project.candidate({ action: 'read' })).status).toBe('external-change');
    expect(JSON.parse(await readFile(join(directory, before.candidate!.path, 'package.json'), 'utf8')).dependencies['aaa-example']).toBeUndefined();
  } finally { await project.release(); }
});

it('离线包损坏或缺失时只读报告失败，不补包或改变锁图', async () => {
  const { directory, project, fetch } = await fixture();
  try {
    const before = await project.candidate({ action: 'create' });
    const saved = await project.candidate({ action: 'dependencies', baseline: before.baseline, dependencies: {}, packages: [] });
    fetch.mockClear(); fetch.mockRejectedValue(new Error('断网'));
    const lock = await readFile(join(directory, saved.candidate!.path, 'pnpm-lock.yaml'));
    const files = await readdir(join(directory, saved.offline!));
    await writeFile(join(directory, saved.offline!, files[0]!), '损坏');
    expect((await project.candidate({ action: 'read' })).status).toBe('integrity-failed');
    expect(await readFile(join(directory, saved.candidate!.path, 'pnpm-lock.yaml'))).toEqual(lock);
    expect(fetch).not.toHaveBeenCalled();
  } finally { await project.release(); }
});

it('锁图存在完整离线包时显式协调也无需联网，重复协调保留完整恢复检查点', async () => {
  const { directory, project, fetch } = await fixture();
  try {
    const before = await project.candidate({ action: 'create' });
    const saved = await project.candidate({ action: 'dependencies', baseline: before.baseline, dependencies: {}, packages: [] });
    fetch.mockClear(); fetch.mockRejectedValue(new Error('断网'));
    const repeated = await project.candidate({ action: 'dependencies', baseline: saved.baseline, dependencies: {}, packages: [] });
    expect(repeated.candidate!.identity).toBe(saved.candidate!.identity);
    expect(repeated.checkpoint!.identity).toBe(saved.candidate!.identity);
    expect(await readdir(join(directory, repeated.offline!))).toHaveLength(4);
    expect(fetch).not.toHaveBeenCalled();
  } finally { await project.release(); }
});

it('首次升级依赖同时补齐当前修订和恢复检查点的旧版本，并可显式修复旧包损坏', async () => {
  const { directory, project, files, fetch } = await fixture();
  try {
    const before = await project.candidate({ action: 'create' });
    const oldBytes = files.get('https://registry.npmjs.org/scheduler/-/scheduler-0.27.0.tgz')!;
    const oldKey = createHash('sha512').update(oldBytes).digest('hex');
    const updated = archive({ name: 'scheduler', version: '0.27.1' });
    files.set('https://registry.npmjs.org/scheduler/-/scheduler-0.27.1.tgz', updated);
    const saved = await project.candidate({ action: 'dependencies', baseline: before.baseline, dependencies: { scheduler: '0.27.1' }, packages: [pin('scheduler', '0.27.1', updated)] });
    expect(await readdir(join(directory, saved.offline!))).toHaveLength(5);
    expect(await readFile(join(directory, saved.offline!, `${oldKey}.tgz`))).toEqual(oldBytes);
    expect(await readFile(join(directory, saved.checkpoint!.path, 'pnpm-lock.yaml'), 'utf8')).toContain('scheduler@0.27.0');
    await writeFile(join(directory, saved.offline!, `${oldKey}.tgz`), '损坏');
    fetch.mockClear();
    const broken = await project.candidate({ action: 'read' });
    expect(broken.status).toBe('integrity-failed');
    expect(fetch).not.toHaveBeenCalled();
    const repaired = await project.candidate({ action: 'dependencies', baseline: broken.baseline, dependencies: {}, packages: [] });
    expect(repaired.status).toBe('saved');
    expect(repaired.candidate!.identity).toBe(saved.candidate!.identity);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://registry.npmjs.org/scheduler/-/scheduler-0.27.0.tgz']);
    expect(await readFile(join(directory, repaired.offline!, `${oldKey}.tgz`))).toEqual(oldBytes);
  } finally { await project.release(); }
});

it('同名传递依赖允许多个精确版本，锁图分别指向各包兼容的固定选择', async () => {
  const { directory, project, files } = await fixture();
  try {
    const before = await project.candidate({ action: 'create' });
    const metas = [
      { name: 'left', version: '1.0.0', dependencies: { helper: '^1.0.0' } },
      { name: 'right', version: '1.0.0', dependencies: { helper: '^2.0.0' } },
      { name: 'helper', version: '1.1.0' }, { name: 'helper', version: '2.1.0' },
    ];
    const packages = metas.map(meta => {
      const bytes = archive(meta);
      files.set(`https://registry.npmjs.org/${meta.name}/-/${meta.name}-${meta.version}.tgz`, bytes);
      return pin(meta.name, meta.version, bytes);
    });
    const saved = await project.candidate({ action: 'dependencies', baseline: before.baseline, dependencies: { left: '1.0.0', right: '1.0.0' }, packages });
    const lock = parse(await readFile(join(directory, saved.candidate!.path, 'pnpm-lock.yaml'), 'utf8'));
    expect(lock.snapshots['left@1.0.0'].dependencies.helper).toBe('1.1.0');
    expect(lock.snapshots['right@1.0.0'].dependencies.helper).toBe('2.1.0');
    expect(await readdir(join(directory, saved.offline!))).toHaveLength(8);
  } finally { await project.release(); }
});

it('放弃后的保留库损坏仍可离线创建候选，再通过唯一协调入口显式修复', async () => {
  const { directory, project, fetch } = await fixture();
  try {
    const before = await project.candidate({ action: 'create' });
    const saved = await project.candidate({ action: 'dependencies', baseline: before.baseline, dependencies: {}, packages: [] });
    const absent = await project.candidate({ action: 'discard', baseline: saved.baseline, confirmed: true });
    const files = await readdir(join(directory, absent.offline!));
    await writeFile(join(directory, absent.offline!, files[0]!), '损坏');
    fetch.mockClear();
    expect((await project.candidate({ action: 'read' })).status).toBe('absent');
    const candidate = await project.candidate({ action: 'create' });
    expect(candidate.status).toBe('integrity-failed');
    expect(await project.candidate({ action: 'read' })).toEqual(candidate);
    expect(fetch).not.toHaveBeenCalled();
    const repaired = await project.candidate({ action: 'dependencies', baseline: candidate.baseline, dependencies: {}, packages: [] });
    expect(repaired.status).toBe('saved');
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { await project.release(); }
});

it('初始修订的 pnpm peer 快照在未改写锁文件时可读取离线图', async () => {
  const { directory, project, files } = await fixture();
  try {
    const current = JSON.parse(await readFile(join(directory, '.narracut/current.json'), 'utf8'));
    const root = join(directory, '.narracut/revisions', current.revisionId, 'render-program');
    const manifest = await readFile(join(root, 'package.json'));
    const lock = await readFile(join(root, 'pnpm-lock.yaml'));
    const store = new Map([...files.values()].map(bytes => [createHash('sha512').update(bytes).digest('hex'), bytes]));
    const { readOfflineDependencyGraph } = await import('../src/server/project-dependencies');
    const result = readOfflineDependencyGraph(manifest, lock, store);
    expect([...result.graph.keys()].sort()).toEqual(['react-dom@19.2.8', 'react@19.2.8', 'remotion@4.0.512', 'scheduler@0.27.0']);
    expect(result.graph.get('remotion@4.0.512')?.dependencies['react-dom']).toBe('react-dom@19.2.8');
    const ambiguous = parse(lock.toString());
    ambiguous.snapshots['react-dom@19.2.8'] = structuredClone(ambiguous.snapshots['react-dom@19.2.8(react@19.2.8)']);
    expect(() => readOfflineDependencyGraph(manifest, Buffer.from(stringify(ambiguous)), store)).toThrow('多个 peer 上下文');
    const wrongReference = parse(lock.toString());
    wrongReference.importers['.'].dependencies['react-dom'].version = '19.2.8(react@99.0.0)';
    expect(() => readOfflineDependencyGraph(manifest, Buffer.from(stringify(wrongReference)), store)).toThrow('快照不一致');
    expect(await readFile(join(root, 'pnpm-lock.yaml'))).toEqual(lock);
  } finally { await project.release(); }
});

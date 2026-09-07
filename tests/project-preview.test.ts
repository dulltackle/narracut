import { expect, test, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';
import { fixture } from './helpers/program-fixture';
import { parse as parseYaml } from 'yaml';
import { ProjectPreview } from '../src/server/project-preview';
test('当前 Preview 捕获跟随真实指针及完整源码身份，候选基线不充当当前修订', async () => {
  const root = await mkdtemp(join(tmpdir(), 'preview-project-')); const path = join(root, 'project');
  await createProjectVNext(path); const opened = await openProjectVNext(path); const preview = new ProjectPreview();
  try {
    const assetId = '20000000-0000-4000-8000-000000000001';
    await writeFile(join(path, 'assets/fixture.txt'), 'first media');
    await writeFile(join(path, 'project.json'), JSON.stringify({ assets: [{ id: assetId, path: 'assets/fixture.txt' }], scenes: [{ id: '30000000-0000-4000-8000-000000000001', narration: { text: '素材检查' }, assetIds: [assetId] }] }));
    const first = await preview.capture(opened, 'current');
    await writeFile(join(path, 'assets/fixture.txt'), 'second media');
    const replaced = await preview.capture(opened, 'current');
    expect(replaced.signature).not.toBe(first.signature);
    expect([...first.media.values()][0].toString()).toBe('first media');
    expect([...replaced.media.values()][0].toString()).toBe('second media');
    const current = JSON.parse(await readFile(join(path, '.narracut/current.json'), 'utf8')).revisionId;
    await writeFile(join(path, '.narracut/revisions', current, 'render-program/src/RenderProgram.tsx'), 'export function RenderProgram(){return null;}');
    const edited = await preview.capture(opened, 'current'); expect(edited.signature).not.toBe(first.signature);
    await opened.candidate({ action: 'create' });
    const next = '10000000-0000-4000-8000-000000000002';
    await cp(join(path, '.narracut/revisions', current), join(path, '.narracut/revisions', next), { recursive: true });
    await writeFile(join(path, '.narracut/current.json'), JSON.stringify({ revisionId: next }));
    const moved = await preview.capture(opened, 'current'); expect(moved.revision).toBe(next); expect(moved.signature).not.toBe(edited.signature);
  } finally { await preview.close(); await opened.release(); await rm(root, { recursive: true, force: true }); }
});

test('分项新鲜度绑定对应版本，Brief 重新构建仍待复核，候选失败不污染当前', async () => {
  const root = await mkdtemp(join(tmpdir(), 'preview-freshness-')); const path = join(root, 'project');
  await createProjectVNext(path);
  const request = await fixture();
  const pointer = JSON.parse(await readFile(join(path, '.narracut/current.json'), 'utf8'));
  for (const [file, bytes] of request.program) await writeFile(join(path, '.narracut/revisions', pointer.revisionId, 'render-program', file), bytes);
  const lock = parseYaml(request.program.get('pnpm-lock.yaml')!.toString());
  const urls = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(lock.packages) as [string, any][]) {
    const split = id.lastIndexOf('@'), name = id.slice(0, split), version = id.slice(split + 1);
    urls.set(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, request.offline.get(Buffer.from(value.resolution.integrity.slice(7), 'base64').toString('hex'))!);
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(new Uint8Array(urls.get(url)!))));
  const opened = await openProjectVNext(path); const preview = new ProjectPreview();
  try {
    const assetId = '20000000-0000-4000-8000-000000000001';
    await writeFile(join(path, 'assets/fixture.txt'), 'first');
    await writeFile(join(path, 'project.json'), JSON.stringify({ assets: [{ id: assetId, path: 'assets/fixture.txt' }], scenes: [{ id: '30000000-0000-4000-8000-000000000001', narration: { text: '检查' }, assetIds: [assetId] }] }));
    const created = await opened.candidate({ action: 'create' });
    const candidate = await opened.candidate({ action: 'dependencies', baseline: created.baseline, dependencies: {}, packages: [] });
    const current = await preview.build(opened, 'current', 'http://localhost:12345');
    expect(current.freshness).toMatchObject({ brief: { status: 'latest', review: 'reviewed' }, input: { status: 'latest' }, media: { status: 'latest' }, environment: { status: 'latest' } });
    const next = await preview.build(opened, 'candidate', 'http://localhost:12345');
    expect(next.freshness?.brief).toMatchObject({ status: 'latest', review: 'pending' });
    await opened.candidate({ action: 'apply', baseline: candidate.baseline, changes: [{ path: 'src/RenderProgram.tsx', content: 'invalid typescript {' }] });
    await expect(preview.build(opened, 'candidate', 'http://localhost:12345')).rejects.toThrow();
    expect(await preview.status(opened, current.instanceId)).toMatchObject({ stale: false, freshness: { input: { status: 'latest' }, media: { status: 'latest' } } });
    expect(await preview.status(opened, next.instanceId)).toMatchObject({ stale: true });
    await writeFile(join(path, 'video.md'), '新的创作要求');
    expect(await preview.status(opened, current.instanceId)).toMatchObject({ stale: true, freshness: { brief: { status: 'stale', review: 'pending' } } });
    const rebuilt = await preview.build(opened, 'current', 'http://localhost:12345');
    expect(rebuilt.freshness?.brief).toMatchObject({ status: 'latest', review: 'pending' });
    await writeFile(join(path, 'assets/fixture.txt'), 'replacement');
    expect(await preview.status(opened, rebuilt.instanceId)).toMatchObject({ stale: true, freshness: { media: { status: 'stale' }, input: { status: 'stale' }, environment: { status: 'latest' } } });
    preview.release(rebuilt.instanceId);
    expect(await preview.status(opened, rebuilt.instanceId)).toMatchObject({ stale: true, freshness: { brief: { status: 'unknown', review: 'unknown' } } });
  } finally { vi.unstubAllGlobals(); await preview.close(); await opened.release(); await rm(root, { recursive: true, force: true }); }}, 120000);

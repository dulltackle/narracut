import { randomUUID, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { acceptedRenderFixture } from './helpers/accepted-render-fixture';
import { openProjectVNext } from '../src/server/project-lifecycle';
import { inspectProjectVNext } from '../src/server/project-vnext-inspection';

// 比较实际持久化字节，覆盖候选、检查点、保留修订及离线库，而非只比较返回状态。
async function dependencyBytes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(path: string) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const relative = join(path, entry.name);
      if (entry.isDirectory()) await visit(relative);
      else if (['package.json', 'pnpm-lock.yaml'].includes(entry.name) || entry.name.endsWith('.tgz')) {
        result[relative] = createHash('sha512').update(await readFile(join(root, relative))).digest('hex');
      }
    }
  }
  await visit('.narracut');
  return result;
}

test('#73：协调之后检查、Preview、冷缓存 Render、历史回退与重开不下载、不改锁、不回收引用包', async () => {
  const f = await acceptedRenderFixture();
  const fetch = vi.fn(() => { throw new Error('显式协调结束后不得下载'); });
  vi.stubGlobal('fetch', fetch);
  try {
    const candidate = await f.opened.candidate({ action: 'read' });
    expect(candidate.checkpoint).not.toBeNull();
    const before = await dependencyBytes(f.directory);
    await inspectProjectVNext(f.directory);
    await f.preview.build(f.opened, 'current', 'http://127.0.0.1:45678');
    await f.preview.build(f.opened, 'candidate', 'http://127.0.0.1:45678');
    expect(await dependencyBytes(f.directory)).toEqual(before);
    // 真实检查、代表帧采集、交付与接受，随后强制冷缓存离线重建并输出 MP4。
    await f.accept();
    const accepted = await dependencyBytes(f.directory);
    f.preview.clear();
    const state = await f.render.status(f.opened), requestId = randomUUID();
    await f.render.start(f.opened, { requestId, key: state.source.key, outputPath: join(f.root, 'offline.mp4') });
    await vi.waitFor(() => expect(['succeeded', 'failed', 'cancelled']).toContain(f.render.result(requestId).job?.status), { timeout: 60000, interval: 100 });
    expect(f.render.result(requestId).job).toMatchObject({ status: 'succeeded' });
    expect((await readFile(join(f.root, 'offline.mp4'))).length).toBeGreaterThan(1000);
    expect(await dependencyBytes(f.directory)).toEqual(accepted);
    const history = await f.opened.programTransaction(manager => manager.history());
    const previous = history.revisions.find(revision => !revision.current)!;
    const restored = await f.opened.candidate({ action: 'create', sourceRevision: previous.revisionId });
    expect(await readFile(join(f.directory, restored.candidate!.path, 'pnpm-lock.yaml'))).toEqual(await readFile(join(f.directory, '.narracut/revisions', previous.revisionId, 'render-program/pnpm-lock.yaml')));
    const afterRestore = await dependencyBytes(f.directory);
    // 回退会原子迁移候选代目录：保留修订路径不变，离线包按摘要名称比较。
    for (const [path, digest] of Object.entries(accepted).filter(([path]) => path.includes('/revisions/'))) expect(afterRestore[path]).toBe(digest);
    const packages = (bytes: Record<string, string>) => Object.fromEntries(Object.entries(bytes).filter(([path]) => path.endsWith('.tgz')).map(([path, digest]) => [path.split('/').at(-1)!, digest]));
    expect(packages(afterRestore)).toEqual(packages(accepted));
    await f.preview.build(f.opened, 'candidate', 'http://127.0.0.1:45678');
    await inspectProjectVNext(f.directory);
    expect(await dependencyBytes(f.directory)).toEqual(afterRestore);
    await f.opened.release();
    const reopened = await openProjectVNext(f.directory);
    try { expect(await reopened.candidate({ action: 'read' })).toEqual(restored); }
    finally { await reopened.release(); }
    expect(await dependencyBytes(f.directory)).toEqual(afterRestore);
    expect(fetch).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 180000);

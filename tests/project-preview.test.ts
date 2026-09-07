import { expect, test } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';
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

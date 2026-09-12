import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import sharp from 'sharp';
import { fixture } from './program-fixture';
import { previewDigest } from '../../src/server/preview-origin';
import { probeSpeechDurationMs, ttsProfileId, writeProjectTtsConfig } from '../../src/server/project-speech-vnext';

/** 准备已有 Speech 和真实 npm 包；移动后的所有操作禁止访问 registry。 */
export async function populatePortableProject(directory: string) {
  const request = await fixture();
  const dependency = await readFile(new URL('../fixtures/portable-project/color-name-2.0.0.tgz', import.meta.url));
  const integrity = `sha512-${createHash('sha512').update(dependency).digest('base64')}`;
  request.offline.set(createHash('sha512').update(dependency).digest('hex'), dependency);
  const manifest = JSON.parse(request.program.get('package.json')!.toString());
  delete manifest.dependencies['bundle-fixture']; manifest.dependencies['color-name'] = '2.0.0';
  const lock = parse(request.program.get('pnpm-lock.yaml')!.toString());
  delete lock.packages['bundle-fixture@1.0.0']; delete lock.snapshots['bundle-fixture@1.0.0'];
  delete lock.importers['.'].dependencies['bundle-fixture'];
  lock.packages['color-name@2.0.0'] = { resolution: { integrity } }; lock.snapshots['color-name@2.0.0'] = {};
  lock.importers['.'].dependencies['color-name'] = { specifier: '2.0.0', version: '2.0.0' };
  request.program.set('package.json', Buffer.from(JSON.stringify(manifest)));
  request.program.set('pnpm-lock.yaml', Buffer.from(stringify(lock)));
  request.program.set('src/RenderProgram.tsx', await readFile(new URL('../fixtures/portable-project/RenderProgram.tsx.txt', import.meta.url)));
  request.program.set('src/color-name.d.ts', Buffer.from('declare module "color-name" { const colors: Record<string, number[]>; export default colors; }'));
  request.program.set('resources/palette.json', Buffer.from('["#152f38", "#463b20", "#283b27"]'));
  const revision = JSON.parse(await readFile(join(directory, '.narracut/current.json'), 'utf8')).revisionId;
  for (const [path, bytes] of request.program) { await mkdir(join(directory, '.narracut/revisions', revision, 'render-program', path, '..'), { recursive: true }); await writeFile(join(directory, '.narracut/revisions', revision, 'render-program', path), bytes); }
  const config = { provider: 'tokendance' as const, model: 'minimax-speech-2.8-turbo' as const, voice: 'Chinese (Mandarin)_News_Anchor' as const, speed: 1, volume: 1, pitch: 0 };
  await writeProjectTtsConfig(directory, config);
  await sharp({ create: { width: 320, height: 240, channels: 3, background: '#173e45' } }).png().toFile(join(directory, 'assets/still.png'));
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=2', '-c:v', 'libvpx', '-b:v', '1M', join(directory, 'assets/motion.webm')]);
  const assets = ['still.png', 'motion.webm'].map((name, index) => ({ id: `20000000-0000-4000-8000-00000000000${index + 1}`, path: `assets/${name}` }));
  const scenes = [];
  for (let index = 0; index < 3; index++) {
    const id = `30000000-0000-4000-8000-00000000000${index + 1}`, path = `speech/${id}.mp3`, text = '你好';
    await writeFile(join(directory, path), await readFile(new URL('../fixtures/portable-project/hello.mp3', import.meta.url)));
    scenes.push({ id, narration: { text }, assetIds: index === 2 ? [] : [assets[index]!.id], speech: { path, durationMs: await probeSpeechDurationMs(join(directory, path)), sourceTextHash: previewDigest(text), ttsProfileId: ttsProfileId(config), audioContentHash: previewDigest(await readFile(join(directory, path))) } });
  }
  await writeFile(join(directory, 'project.json'), JSON.stringify({ assets, scenes }));
  await writeFile(join(directory, 'video.md'), '# 可移动短片\n\n保留三幕顺序，以叠化连接素材，使用 seeded 套准线动画。\n');
  const urls = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(lock.packages) as [string, any][]) {
    const split = id.lastIndexOf('@'), name = id.slice(0, split), version = id.slice(split + 1);
    urls.set(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, request.offline.get(Buffer.from(value.resolution.integrity.slice(7), 'base64').toString('hex'))!);
  }
  return { urls, scenes };
}

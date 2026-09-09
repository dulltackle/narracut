import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { parse } from 'yaml';
import { vi } from 'vitest';
import { fixture } from './program-fixture';
import { createProjectVNext, openProjectVNext } from '../../src/server/project-lifecycle';
import { ProjectPreview } from '../../src/server/project-preview';
import { ProjectChecks } from '../../src/server/project-checks';
import { ProjectDelivery } from '../../src/server/project-delivery';
import { ProjectAcceptance } from '../../src/server/project-acceptance';
import { ProjectRender } from '../../src/server/project-render';
import { writeProjectTtsConfig, ttsProfileId, probeSpeechDurationMs } from '../../src/server/project-speech-vnext';
import { previewDigest } from '../../src/server/preview-origin';
import { runRemotionCli } from '../../src/server/video-media';

export async function acceptedRenderFixture(programSource?: string) {
  const root = await mkdtemp(join(tmpdir(), 'final-render-')), directory = join(root, 'project');
  await createProjectVNext(directory);
  const request = await fixture();
  request.program.set('src/RenderProgram.tsx', Buffer.from('import type {RenderProgramInputV1} from "@narracut/runtime";' + (programSource ?? 'import {AbsoluteFill,useCurrentFrame} from "remotion";export function RenderProgram(){return <AbsoluteFill style={{backgroundColor:useCurrentFrame()<9?"red":"blue"}}/>}').replace('RenderProgram()', 'RenderProgram(input: RenderProgramInputV1)')));
  const revision = JSON.parse(await readFile(join(directory, '.narracut/current.json'), 'utf8')).revisionId;
  for (const [path, bytes] of request.program) await writeFile(join(directory, '.narracut/revisions', revision, 'render-program', path), bytes);
  const urls = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(parse(request.program.get('pnpm-lock.yaml')!.toString()).packages) as [string, any][]) {
    const split = id.lastIndexOf('@'), name = id.slice(0, split), version = id.slice(split + 1);
    urls.set(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, request.offline.get(Buffer.from(value.resolution.integrity.slice(7), 'base64').toString('hex'))!);
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(new Uint8Array(urls.get(url)!))));
  const config = { provider: 'tokendance' as const, model: 'minimax-speech-2.8-turbo' as const, voice: 'Chinese (Mandarin)_News_Anchor' as const, speed: 1, volume: 1, pitch: 0 };
  await writeProjectTtsConfig(directory, config);
  const sceneId = randomUUID(), assetId = randomUUID(), speechPath = `speech/${sceneId}.mp3`;
  await runRemotionCli('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.45', '-c:a', 'libmp3lame', join(directory, speechPath)]);
  const durationMs = await probeSpeechDurationMs(join(directory, speechPath));
  const media = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'green' } }).png().toBuffer();
  await writeFile(join(directory, 'assets/source.png'), media);
  const project = { assets: [{ id: assetId, path: 'assets/source.png' }], scenes: [{ id: sceneId, narration: { text: '测试旁白' }, assetIds: [assetId], speech: { path: speechPath, durationMs, sourceTextHash: previewDigest('测试旁白'), ttsProfileId: ttsProfileId(config), audioContentHash: previewDigest(await readFile(join(directory, speechPath))) } }] };
  await writeFile(join(directory, 'project.json'), JSON.stringify(project));
  const opened = await openProjectVNext(directory), preview = new ProjectPreview(), checks = new ProjectChecks(preview), delivery = new ProjectDelivery(preview, checks), acceptance = new ProjectAcceptance(delivery, preview), render = new ProjectRender(preview);
  async function accept() {
    if ((await opened.candidate({ action: 'read' })).status === 'absent') await opened.candidate({ action: 'create' });
    const descriptor = await preview.build(opened, 'candidate', 'http://127.0.0.1:45678');
    await checks.start(opened); await delivery.operate(opened, { action: 'prepare', instanceId: descriptor.instanceId });
    let state = await delivery.status(opened);
    await vi.waitFor(async () => { state = await delivery.status(opened); if (state.collecting || state.checks.batches.at(-1)?.status === 'running') throw new Error('等待证据'); }, { timeout: 30000, interval: 100 });
    for (const frame of state.delivery!.frames) {
      if (!frame.digest) throw new Error(`代表帧采集失败：${JSON.stringify(frame)}`);
      await delivery.operate(opened, { action: 'image', deliveryId: state.delivery!.id, frame: frame.frame });
    }
    await delivery.operate(opened, { action: 'review', deliveryId: state.delivery!.id, reviews: state.delivery!.frames.map(frame => ({ frame: frame.frame, digest: frame.digest, observation: '代表帧颜色符合预期' })) });
    await delivery.operate(opened, { action: 'describe', deliveryId: state.delivery!.id, report: { goal: '验证最终输出', summary: '前半段红色，后半段蓝色', warnings: [], suggestions: [] } });
    state = await delivery.status(opened);
    await delivery.operate(opened, { action: 'displayed', deliveryId: state.delivery!.id, reportRevision: state.delivery!.reportRevision, batchId: state.checks.batches.at(-1)!.id, warningsKey: state.warningsKey });
    const reviewed = await acceptance.operate(opened, { action: 'review' });
    await acceptance.operate(opened, { action: 'accept', ...reviewed.confirmation, confirmed: true });
    return descriptor;
  }
  const candidate = await opened.candidate({ action: 'create' });
  await opened.candidate({ action: 'dependencies', baseline: candidate.baseline, dependencies: {}, packages: [] });
  return { root, directory, project, media, opened, preview, acceptance, render, accept,
    async close() { await render.close(); delivery.clear(); checks.clear(); await preview.close(); await opened.release(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); },
  };
}

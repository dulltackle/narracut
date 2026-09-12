import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, vi } from 'vitest';
import { acceptedRenderFixture } from './helpers/accepted-render-fixture';
import { runRemotionCli } from '../src/server/video-media';

test('最终 Render 只接受当前已验收状态，复用 Bundle 并发布含权威音轨的逐帧产物', async () => {
  const f = await acceptedRenderFixture();
  try {
    expect((await f.render.status(f.opened)).source).toMatchObject({ accepted: false, ready: false });
    const preview = await f.accept();
    const state = await f.render.status(f.opened);
    expect(state.source.ready).toBe(true);
    const requestId = randomUUID(), outputPath = join(f.root, 'result.mp4');
    const { job } = await f.render.start(f.opened, { requestId, outputPath, key: state.source.key });
    expect(job.source.details).toMatchObject({ bundle: preview.identity.bundle, media: preview.identity.media, environment: preview.identity.environment });
    await vi.waitFor(() => expect(['succeeded', 'failed', 'cancelled']).toContain(f.render.result(requestId).job?.status), { timeout: 60000, interval: 200 });
    const result = f.render.result(requestId).job!;
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'succeeded' });
    expect(result).toMatchObject({ stage: 'completed', outputPath, projectUpdated: false });
    const { stdout } = await runRemotionCli('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', outputPath]);
    const streams = JSON.parse(stdout.toString()).streams;
    expect(streams.find((stream: any) => stream.codec_type === 'video')).toMatchObject({ width: 320, height: 240, nb_read_frames: String(preview.input.durationInFrames), avg_frame_rate: '30/1' });
    expect(streams.some((stream: any) => stream.codec_type === 'audio')).toBe(true);
    for (const [frame, channel] of [[0, 0], [preview.input.durationInFrames - 1, 2]]) {
      const imagePath = join(f.root, `frame-${frame}.png`);
      await runRemotionCli('ffmpeg', ['-v', 'error', '-ss', String(frame / 30), '-i', outputPath, '-frames:v', '1', imagePath]);
      const { default: sharp } = await import('sharp');
      const pixel = await sharp(imagePath).resize(1, 1).removeAlpha().raw().toBuffer();
      expect(pixel[channel]).toBeGreaterThan(230);
      expect(pixel[channel === 0 ? 2 : 0]).toBeLessThan(25);
    }
    expect((await readFile(outputPath)).length).toBeGreaterThan(1000);
    expect((await f.render.start(f.opened, { requestId, outputPath, key: state.source.key })).job.id).toBe(job.id);
  } finally { await f.close(); }
}, 180000);

test('发布时输出位置故障不撤销接受，恢复后能重新执行并成功发布', async () => {
  const f = await acceptedRenderFixture();
  try {
    await f.accept();
    const state = await f.render.status(f.opened), outputPath = join(f.root, 'retry.mp4'), requestId = randomUUID();
    await f.render.start(f.opened, { key: state.source.key, outputPath, requestId });
    // 模拟选址后另一个进程占用了文件名，真实发布不得覆盖。
    await writeFile(outputPath, '已有文件');
    await vi.waitFor(() => expect(f.render.result(requestId).job?.status).toBe('failed'), { timeout: 60000, interval: 100 });
    expect(f.render.result(requestId).job).toMatchObject({ retryable: true, error: { code: 'EEXIST' } });
    expect(await readFile(outputPath, 'utf8')).toBe('已有文件');
    expect((await f.render.status(f.opened)).source).toMatchObject({ accepted: true, ready: true });
    await rm(outputPath);
    const retryId = randomUUID();
    await f.render.start(f.opened, { key: state.source.key, outputPath, requestId: retryId });
    await vi.waitFor(() => expect(['succeeded', 'failed']).toContain(f.render.result(retryId).job?.status), { timeout: 60000, interval: 100 });
    expect(f.render.result(retryId).job, JSON.stringify(f.render.result(retryId))).toMatchObject({ status: 'succeeded' });
  } finally { await f.close(); }
}, 180000);


test('缓存丢失只离线重建同一 Bundle，期间媒体变化终止产物且恢复原字节后可重试', async () => {
  const f = await acceptedRenderFixture();
  try {
    const preview = await f.accept();
    f.preview.clear();
    vi.stubGlobal('fetch', async () => { throw new Error('重建不得联网'); });
    const state = await f.render.status(f.opened);
    const outputPath = join(f.root, 'rebuilt.mp4'), requestId = randomUUID();
    await f.render.start(f.opened, { key: state.source.key, outputPath, requestId });
    await vi.waitFor(() => expect(f.render.result(requestId).job?.stage).toBe('rebuilding'), { timeout: 10000, interval: 50 });
    await vi.waitFor(() => expect(['succeeded', 'failed', 'cancelled']).toContain(f.render.result(requestId).job?.status), { timeout: 60000, interval: 100 });
    expect(f.render.result(requestId).job, JSON.stringify(f.render.result(requestId))).toMatchObject({ status: 'succeeded' });
    expect(f.render.result(requestId).job?.source.details).toMatchObject({ bundle: preview.identity.bundle });
    await expect(f.render.start(f.opened, { key: state.source.key, outputPath, requestId: randomUUID() })).rejects.toMatchObject({ code: 'RENDER_OUTPUT_FAILED' });
    expect((await f.render.status(f.opened)).source).toMatchObject({ accepted: true, ready: true });
    const changedId = randomUUID(), changedPath = join(f.root, 'changed.mp4');
    await f.render.start(f.opened, { key: state.source.key, outputPath: changedPath, requestId: changedId });
    await vi.waitFor(() => expect(f.render.result(changedId).job?.stage).toBe('rebuilding'), { timeout: 10000, interval: 50 });
    await writeFile(join(f.directory, 'assets/source.png'), '媒体在执行期间被替换');
    await vi.waitFor(() => expect(f.render.result(changedId).job?.status).toBe('failed'), { timeout: 10000, interval: 100 });
    expect(f.render.result(changedId).job).toMatchObject({ error: { code: 'RENDER_MEDIA_CHANGED', location: { path: 'assets/source.png' } }, retryable: true });
    await expect(readFile(changedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(join(f.directory, 'assets/source.png'), f.media);
    expect((await f.render.status(f.opened)).source).toMatchObject({ accepted: true, ready: true });
    const cancelledId = randomUUID(), cancelledPath = join(f.root, 'cancelled.mp4');
    const { job } = await f.render.start(f.opened, { key: state.source.key, outputPath: cancelledPath, requestId: cancelledId });
    await expect(f.render.start(f.opened, { key: state.source.key, outputPath: join(f.root, 'concurrent.mp4'), requestId: randomUUID() })).rejects.toMatchObject({ code: 'RENDER_BUSY' });
    f.render.cancel(job.id);
    await vi.waitFor(() => expect(f.render.result(cancelledId).job?.status).toBe('cancelled'), { timeout: 10000, interval: 100 });
    await expect(readFile(cancelledPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await f.close(); }
}, 180000);

test('当前输入缺项阻断；保留的接受记录不能用不同 Bundle 指纹重建', async () => {
  const f = await acceptedRenderFixture();
  try {
    await f.accept();
    for (const [project, code] of [
      [{ ...f.project, scenes: [] }, 'RENDER_ZERO_SCENES'],
      [{ ...f.project, scenes: f.project.scenes.map(({ speech, ...scene }) => scene) }, 'RENDER_DRAFT_DURATION'],
      [{ ...f.project, scenes: f.project.scenes.map(scene => ({ ...scene, narration: { text: '' } })) }, 'PROJECT_CONTENT_INVALID'],
    ] as const) {
      await writeFile(join(f.directory, 'project.json'), JSON.stringify(project));
      const state = await f.render.status(f.opened);
      expect(state.source).toMatchObject({ accepted: true, ready: false });
      expect(state.source.issues.map(issue => issue.code)).toContain(code);
      await expect(f.render.start(f.opened, { key: state.source.key, outputPath: join(f.root, 'blocked.mp4'), requestId: randomUUID() })).rejects.toMatchObject({ code: 'RENDER_NOT_READY' });
    }
    await writeFile(join(f.directory, 'project.json'), JSON.stringify(f.project));
    await rm(join(f.directory, 'assets/source.png'));
    expect((await f.render.status(f.opened)).source.issues).toContainEqual(expect.objectContaining({ code: 'RENDER_MEDIA_MISSING', location: { path: 'assets/source.png' } }));
    await writeFile(join(f.directory, 'assets/source.png'), f.media);
    const history = await f.opened.programTransaction(manager => manager.history());
    const accepted = history.revisions.find(item => item.current)!.acceptance!;
    // 通过存储边界构造保留自旧构建的接受记录；内容不变，原 Bundle 已不可取得。
    const candidate = await f.opened.candidate({ action: 'create' });
    await f.opened.programTransaction(manager => manager.accept({ baseline: candidate.baseline, summary: '旧构建接受记录', source: 'candidate', acceptance: { ...accepted, bundle: `sha256:${'0'.repeat(64)}` } }, async () => {}));
    f.preview.clear();
    const state = await f.render.status(f.opened), requestId = randomUUID();
    await f.render.start(f.opened, { key: state.source.key, outputPath: join(f.root, 'different.mp4'), requestId });
    await vi.waitFor(() => expect(f.render.result(requestId).job?.status).toBe('failed'), { timeout: 30000, interval: 100 });
    expect(f.render.result(requestId).job?.error?.code).toBe('BUNDLE_FINGERPRINT_MISMATCH');
    await expect(readFile(join(f.root, 'different.mp4'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.render.status(f.opened)).source.accepted).toBe(true);
  } finally { await f.close(); }
}, 180000);

test('代表帧以外的新内容失败阻断同一状态再次 Render，接受事实保持不变', async () => {
  const f = await acceptedRenderFixture('import {AbsoluteFill,useCurrentFrame} from "remotion";export function RenderProgram(){if(useCurrentFrame()===3)throw "该帧内容无效";return <AbsoluteFill style={{backgroundColor:"red"}}/>}');
  try {
    await f.accept();
    const state = await f.render.status(f.opened), requestId = randomUUID(), outputPath = join(f.root, 'failed.mp4');
    await f.render.start(f.opened, { key: state.source.key, outputPath, requestId });
    await vi.waitFor(() => expect(f.render.result(requestId).job?.status).toBe('failed'), { timeout: 30000, interval: 100 });
    expect(f.render.result(requestId).job).toMatchObject({ retryable: false, error: { code: 'RENDER_FRAME_FAILED', location: { frame: 3 } } });
    expect((await f.render.status(f.opened)).source).toMatchObject({ accepted: true, ready: false });
    await expect(f.render.start(f.opened, { key: state.source.key, outputPath, requestId: randomUUID() })).rejects.toMatchObject({ code: 'RENDER_NOT_READY' });
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await f.close(); }
}, 180000);

test('含 Speech 的连续前后切帧保持快照采集就绪', async () => {
  const f = await acceptedRenderFixture();
  try {
    const descriptor = await f.accept();
    const { capturePreviewFrames } = await import('../src/server/preview-evidence');
    const files = f.preview.source.snapshot(descriptor.url);
    for (let batch = 0; batch < 6; batch++) {
      const captured = await capturePreviewFrames(descriptor, files, [0, 10, 2, 11, 1, 12, 3, 13, 4, 14, 5, 9]);
      expect(captured.filter(frame => frame.error).map(({ frame, error, errorCode }) => ({ frame, error, errorCode }))).toEqual([]);
    }
  } finally { await f.close(); }
}, 180000);

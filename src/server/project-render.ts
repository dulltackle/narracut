import { randomUUID, randomBytes } from 'node:crypto';
import { constants, watch, type FSWatcher } from 'node:fs';
import { open, realpath, link, unlink, lstat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { OpenedProjectVNext } from './project-lifecycle';
import { ProjectPreview, snapshotFile } from './project-preview';
import { PreviewOrigin, previewDigest } from './preview-origin';
import { programEnvironmentIdentity, buildProgramBundle } from './program-bundle';
import { FinalRenderError, renderAcceptedProgram } from './program-render';

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const recordSchema = z.object({ protocolVersion: z.literal(1), checkerVersion: z.literal(1), bridgeVersion: z.literal(1), bundle: digest,
  identity: z.object({ project: z.string(), program: digest, brief: digest, input: digest, media: digest, environment: digest }),
  gates: z.array(z.object({ operation: z.string(), status: z.string() })),
});
type RenderIssue = { code: string; message: string; location?: { frame?: number; path?: string; sceneId?: string } };
type RenderSource = { revisionId: string; summary: string; key: string; accepted: boolean; ready: boolean; issues: RenderIssue[]; durationInFrames?: number; output?: { width: number; height: number; fps: number }; details?: unknown };
export type FinalRenderJob = { id: string; requestId: string; source: RenderSource; outputPath: string; status: 'running' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed'; stage: 'preparing' | 'rebuilding' | 'frames' | 'encoding' | 'publishing' | 'completed'; renderedFrames?: number; error?: RenderIssue; retryable?: boolean; projectUpdated?: boolean };
const contentCodes = new Set(['RENDER_FRAME_FAILED', 'RUNTIME_FRAME_FAILED', 'RUNTIME_CONTRACT_VIOLATION', 'STATIC_NONDETERMINISTIC_API', 'STATIC_FORBIDDEN_CAPABILITY']);
const problem = (error: unknown): RenderIssue => ({ code: (error as any)?.code ?? 'RENDER_OPERATION_FAILED', message: (error as Error)?.message ?? '无法确认 Render 状态。', ...((error as FinalRenderError)?.location ? { location: (error as FinalRenderError).location } : {}) });

/** 每个已打开项目一个最终任务；接受事实来自不可变修订，任务不能改写验收记录。 */
export class ProjectRender {
  #jobs = new Map<string, FinalRenderJob>();
  #blocked = new Map<string, RenderIssue>();
  #pending = new Set<string>();
  #preparing?: Promise<void>;
  #closing = false;
  #abort?: AbortController;
  #running?: Promise<void>;
  constructor(private preview: ProjectPreview) {}
  async #inspect(opened: OpenedProjectVNext) {
    return opened.programTransaction(async manager => {
      const history = await manager.history(), current = history.revisions.find(item => item.current)!;
      const source: RenderSource = { revisionId: history.current, summary: current.summary ?? '当前修订', key: '', accepted: !!current.acceptance, ready: false, issues: [] };
      try {
        if (!current.valid) throw new FinalRenderError('REVISION_INTEGRITY_FAILED', current.error ?? '当前修订完整性无法确认。');
        if (!current.acceptance) throw new FinalRenderError('RENDER_NOT_ACCEPTED', '当前视频状态尚未验收，请前往候选检查与接受流程。');
        const parsed = recordSchema.safeParse(current.acceptance);
        if (!parsed.success || !parsed.data.gates.some(gate => gate.operation === 'accept' && gate.status === 'available')) throw new FinalRenderError('RENDER_ACCEPTANCE_INVALID', '验收记录或协议身份无法确认，请重新形成候选并验收。');
        const record = parsed.data;
        const local = { ...opened, candidate: manager, readPreviewSource: manager.previewSource };
        const capture = await this.preview.capture(local, 'current');
        source.durationInFrames = capture.input.durationInFrames; source.output = capture.input.output;
        const environment = await programEnvironmentIdentity();
        const identity = { project: opened.inspection.manifest.projectId, program: capture.sourceIdentity, brief: capture.brief, input: capture.projectInput,
          media: previewDigest(JSON.stringify([...capture.media].map(([path, bytes]) => [path, previewDigest(bytes)]).sort())), environment };
        source.key = previewDigest(JSON.stringify([source.revisionId, record.bundle, identity]));
        source.details = { bundle: record.bundle, ...identity };
        if (!capture.input.scenes.length) source.issues.push({ code: 'RENDER_ZERO_SCENES', message: '零 Scene 无法最终 Render，请在表格工作区补充内容后重新验收。' });
        for (const scene of capture.input.scenes) {
          if (!scene.narration.trim()) source.issues.push({ code: 'RENDER_EMPTY_NARRATION', message: 'Narration 为空，请在表格工作区补充并重新验收。', location: { sceneId: scene.id } });
          if (scene.time.source !== 'speech') source.issues.push({ code: 'RENDER_DRAFT_DURATION', message: '缺少有效 Speech，当前使用 Draft Duration；请生成 Speech 后重新验收。', location: { sceneId: scene.id } });
        }
        for (const asset of capture.input.assets) if (asset.availability !== 'available') source.issues.push({ code: 'RENDER_MEDIA_MISSING', message: '执行所需 Asset 缺失，恢复原字节后重新检查；字节变化则重新验收。', location: { path: asset.path } });
        if (Object.keys(identity).some(key => identity[key as keyof typeof identity] !== record.identity[key as keyof typeof identity])) source.issues.push({ code: 'RENDER_NOT_ACCEPTED', message: '当前输入、媒体或执行环境已不对应验收记录；恢复原状态，或形成新候选重新验收。' });
        const blocked = this.#blocked.get(source.key); if (blocked) source.issues.push(blocked);
        source.ready = source.issues.length === 0;
        return { source, capture, record, program: await manager.previewSource('current') };
      } catch (error) { source.issues.push(problem(error)); return { source }; }
    });
  }
  async status(opened: OpenedProjectVNext) { return { source: (await this.#inspect(opened)).source, jobs: structuredClone([...this.#jobs.values()]) }; }
  async start(opened: OpenedProjectVNext, args: { requestId: string; key: string; outputPath: string }) {
    if (this.#closing) throw new FinalRenderError('RENDER_BUSY', '项目正在关闭，请等待完成。');
    z.string().uuid().parse(args.requestId);
    const known = [...this.#jobs.values()].find(job => job.requestId === args.requestId);
    if (known) return { job: structuredClone(known) };
    if (this.#abort) throw new FinalRenderError('RENDER_BUSY', '当前项目已有最终 Render，请等待完成或取消。');
    if (!isAbsolute(args.outputPath) || !args.outputPath.endsWith('.mp4') || /[\0\r\n]/.test(args.outputPath)) throw new FinalRenderError('RENDER_OUTPUT_FAILED', '请通过系统选择器指定新的 MP4 输出位置。');
    // 在首个 await 前保留唯一执行槽，包含准备与校验阶段。
    const abort = this.#abort = new AbortController();
    let preparedDone!: () => void;
    this.#preparing = new Promise<void>(resolve => { preparedDone = resolve; });
    this.#pending.add(args.requestId);
    try {
      const prepared = await this.#inspect(opened);
      if (!prepared.source.ready || prepared.source.key !== args.key || !prepared.capture || !prepared.record || !prepared.program) throw new FinalRenderError('RENDER_NOT_READY', prepared.source.issues.map(issue => issue.message).join('；') || '准备期间接受状态发生变化，请重新准备最终 Render。');
      const parent = await realpath(dirname(args.outputPath));
      const outputPath = join(parent, basename(args.outputPath));
      try { await lstat(outputPath); throw new FinalRenderError('RENDER_OUTPUT_FAILED', '输出文件已存在，请选择新位置；不会覆盖已有文件。'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      abort.signal.throwIfAborted();
      const job: FinalRenderJob = { id: randomUUID(), requestId: args.requestId, source: prepared.source, outputPath, status: 'running', stage: 'preparing' };
      this.#jobs.set(job.id, job);
      this.#running = this.#run(opened, prepared as Required<typeof prepared>, job, abort);
      this.#pending.delete(args.requestId);
      return { job: structuredClone(job) };
    } catch (error) { this.#pending.delete(args.requestId); this.#abort = undefined; throw error; }
    finally { preparedDone(); this.#preparing = undefined; }
  }
  result(requestId: string) { const job = [...this.#jobs.values()].find(job => job.requestId === requestId); return { status: job ? 'known' : this.#pending.has(requestId) ? 'preparing' : 'not-started', ...(job ? { job: structuredClone(job) } : {}) }; }
  cancel(id: string) { const job = this.#jobs.get(id); if (!job) throw new FinalRenderError('RENDER_UNKNOWN', '找不到此 Render。'); if (job.status === 'running') { job.status = 'cancelling'; this.#abort?.abort(); } return { job: structuredClone(job) }; }
  async close() {
    this.#closing = true; this.#abort?.abort();
    try { await this.#preparing; await this.#running; this.#jobs.clear(); this.#blocked.clear(); this.#pending.clear(); }
    finally { this.#closing = false; }
  }
  async #run(opened: OpenedProjectVNext, prepared: { capture: Awaited<ReturnType<ProjectPreview['capture']>>; record: z.infer<typeof recordSchema>; program: Awaited<ReturnType<OpenedProjectVNext['readPreviewSource']>> }, job: FinalRenderJob, abort: AbortController) {
    const { capture, record } = prepared, watchers: FSWatcher[] = [];
    const origin = new PreviewOrigin();
    let mediaFailure: FinalRenderError | undefined;
    let temporary: string | undefined, published = false;
    let outcome: Partial<FinalRenderJob> = {};
    const changed = (path: string) => { mediaFailure ??= new FinalRenderError('RENDER_MEDIA_CHANGED', 'Render 期间媒体发生变化，已终止并丢弃产物；请恢复媒体后重新检查。', { path }); abort.abort(); };
    const verifyMedia = async () => {
      for (const [path, digest] of capture.mediaPaths) {
        try { if (previewDigest(await snapshotFile(opened.inspection.projectDirectory, path, 256 * 1024 * 1024)) !== digest) changed(path); }
        catch { changed(path); }
      }
      if (mediaFailure) throw mediaFailure; abort.signal.throwIfAborted();
    };
    try {
      const parents = new Map<string, Set<string>>();
      for (const path of capture.mediaPaths.keys()) { const parent = dirname(path); if (!parents.has(parent)) parents.set(parent, new Set()); parents.get(parent)!.add(basename(path)); }
      for (const [parent, names] of parents) {
        const watcher = watch(join(opened.inspection.projectDirectory, parent), (_event, file) => { if (!file || names.has(String(file))) changed(join(parent, String(file ?? ''))); });
        watcher.on('error', () => changed(parent)); watchers.push(watcher);
      }
      await verifyMedia();
      let bundle = this.preview.cachedBundle(record.bundle);
      if (!bundle) {
        job.stage = 'rebuilding';
        bundle = await buildProgramBundle({ program: prepared.program.program, offline: prepared.program.offline, input: capture.input, speech: capture.speech, media: capture.media, signal: abort.signal });
      }
      if (bundle.identity !== record.bundle || bundle.environmentIdentity !== record.identity.environment || await programEnvironmentIdentity() !== record.identity.environment) throw new FinalRenderError('BUNDLE_FINGERPRINT_MISMATCH', '无法重建同一已接受 Bundle；恢复原认证环境与离线依赖后重试，不同结果必须通过新候选验收。');
      const latest = await this.#inspect(opened);
      if (!latest.source.ready || latest.source.key !== job.source.key) throw new FinalRenderError('RENDER_NOT_READY', '启动前接受记录或输入发生变化，请重新准备最终 Render。');
      const descriptor = await origin.publish({ bundle, input: capture.input, speech: capture.speech, media: capture.media, parentOrigin: 'https://narracut.invalid', target: 'current', baseline: capture.baseline, label: job.source.summary, key: randomBytes(24).toString('hex') });
      const bytes = await renderAcceptedProgram(descriptor, origin.snapshot(descriptor.url), capture.speech, abort.signal, value => Object.assign(job, value));
      job.stage = 'publishing'; await verifyMedia();
      if (await programEnvironmentIdentity() !== record.identity.environment) throw new FinalRenderError('CAPSULE_UNAVAILABLE', '执行环境在 Render 期间变化，未生成产物。');
      temporary = join(dirname(job.outputPath), `.narracut-render-${randomUUID()}.tmp`);
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      await verifyMedia();
      await link(temporary, job.outputPath); published = true;
      await verifyMedia();
      const parent = await open(dirname(job.outputPath), constants.O_RDONLY | constants.O_DIRECTORY);
      try { await parent.sync(); } finally { await parent.close(); }
      job.projectUpdated = (await this.#inspect(opened)).source.key !== job.source.key;
      await verifyMedia();
      outcome = { status: 'succeeded', stage: 'completed' };
    } catch (error) {
      if (published && temporary) {
        const [own, target] = await Promise.all([lstat(temporary), lstat(job.outputPath)]).catch(() => []);
        if (own && target && own.dev === target.dev && own.ino === target.ino) await unlink(job.outputPath).catch(() => {});
      }
      if (abort.signal.aborted && !mediaFailure) outcome = { status: 'cancelled' };
      else {
        const issue = problem(mediaFailure ?? error), retryable = !contentCodes.has(issue.code);
        outcome = { status: 'failed', error: issue, retryable };
        if (!retryable) this.#blocked.set(job.source.key, issue);
      }
    } finally {
      for (const watcher of watchers) watcher.close();
      if (temporary) await unlink(temporary).catch(() => {});
      await origin.close();
      this.#abort = undefined; this.#running = undefined;
      Object.assign(job, outcome);
    }
  }
}

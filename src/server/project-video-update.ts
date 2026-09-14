import { z } from 'zod';
import type { OpenedProjectVNext } from './project-lifecycle';
import { ProjectPreview } from './project-preview';
import { ProjectChecks } from './project-checks';
import { CandidateError } from './project-candidate';
import { representativePlan } from '../shared/representative-frames';
import { capturePreviewFrames } from './preview-evidence';
import { previewDigest } from './preview-origin';

export type VideoUpdateJob = { requestId: string; status: 'running' | 'cancelling' | 'published' | 'cancelled' | 'failed'; stage: string; error?: string; revisionId?: string };
/** 仅同步不创建候选、不改程序、不合成声音。执行可取消，发布才占用保存事务。 */
export class ProjectVideoUpdate {
  #job?: VideoUpdateJob;
  #running?: Promise<void>;
  #abort?: AbortController;
  #checks: ProjectChecks;
  #closing = false;
  #preparingRequest?: string;
  constructor(private preview: ProjectPreview) { this.#checks = new ProjectChecks(preview, 'current'); }
  get busy() { return !!this.#abort; }
  async status(opened: OpenedProjectVNext, requestId?: string) {
    const state = await opened.programTransaction(manager => manager.updateState());
    const candidate = await opened.candidate({ action: 'read' });
    return { ...state, requestStatus: !requestId ? undefined : state.result?.requestId === requestId ? state.result.status : this.#job?.requestId === requestId ? this.#job.status : this.#preparingRequest === requestId ? 'running' : 'not-started', checks: await this.#checks.status(opened), job: this.#job ? structuredClone(this.#job) : null,
      compatibility: candidate.status !== 'absent' ? `保留的内部成果：${candidate.status}。仅同步沿用当前设计；继续创作或恢复完整性请在当前对话处理，不会自动发布或删除。` : candidate.error?.message ?? null };
  }
  #viewing?: Promise<any>;
  async view(opened: OpenedProjectVNext, parentOrigin: string) {
    if (this.busy || this.#closing) return { preview: null };
    if (this.#viewing) return this.#viewing;
    this.#viewing = (async () => {
      const state = await opened.programTransaction(manager => manager.updateState());
      const record = state.revision.acceptance as any;
      if (!state.hasDesign || state.result?.status === 'undone' || !record?.identity || !record.gates?.some((gate: any) => ['publish', 'accept'].includes(gate.operation) && gate.status === 'available')) return { preview: null };
      const capture = await this.preview.capture(opened, 'current');
      if (capture.projectInput !== record.identity.input || capture.sourceIdentity !== record.identity.program || capture.brief !== record.identity.brief) return { preview: null };
      let view = await this.preview.view(opened, 'current', parentOrigin);
      if (!view.preview || view.preview.stale) {
        if (view.preview) this.preview.release(view.preview.sourceInstanceId);
        const descriptor = await this.preview.build(opened, 'current', parentOrigin);
        if (descriptor.identity.bundle !== record.bundle) { this.preview.release(descriptor.instanceId); throw new Error('重建结果与发布证据不一致，请重新同步。'); }
        view = await this.preview.view(opened, 'current', parentOrigin);
      }
      if (this.busy || this.#closing || view.preview?.stale || (await opened.programTransaction(manager => manager.updateState())).revisionId !== state.revisionId) return { preview: null };
      return view;
    })();
    try { return await this.#viewing; } finally { this.#viewing = undefined; }
  }
  async start(opened: OpenedProjectVNext, args: { requestId: string; parentOrigin: string }) {
    z.string().uuid().parse(args.requestId);
    if (this.#closing) throw new Error('项目正在关闭。');
    if (this.#job?.requestId === args.requestId) return { job: structuredClone(this.#job) };
    if (this.busy) throw new Error('正在核对本次更新，请等待完成。');
    const abort = this.#abort = new AbortController(); this.#preparingRequest = args.requestId;
    // 首次读取也属于在途操作；关闭和取消必须等它结束。
    let ready!: () => void; const preparing = new Promise<void>(resolve => { ready = resolve; }); this.#running = preparing;
    try {
      const state = await opened.programTransaction(manager => manager.updateState());
      if (state.result?.requestId === args.requestId) return { job: { requestId: args.requestId, status: state.result.status, stage: '已核对持久结果', revisionId: state.revisionId } };
      if (!state.hasDesign) throw new CandidateError('UPDATE_NO_DESIGN', '尚未生成画面设计，请先在当前对话生成。');
      abort.signal.throwIfAborted();
      this.preview.invalidate();
      const job: VideoUpdateJob = { requestId: args.requestId, status: 'running', stage: '正在检查最新表格与画面设计' }; this.#job = job;
      this.#running = this.#run(opened, args, state.revisionId, job, abort);
      return { job: structuredClone(job) };
    } catch (error) { this.#job = { requestId: args.requestId, status: abort.signal.aborted ? 'cancelled' : 'failed', stage: abort.signal.aborted ? '已取消，请重新选择更新方式' : '同步未开始', error: (error as Error).message }; this.#abort = undefined; throw error; }
    finally { this.#preparingRequest = undefined; ready(); if (this.#running === preparing) { this.#running = undefined; this.#abort = undefined; } }
  }
  cancel(requestId: string) {
    if (this.busy && (this.#job?.requestId === requestId || this.#preparingRequest === requestId)) { if (this.#job?.requestId !== requestId) this.#job = { requestId, status: 'cancelling', stage: '正在取消并核对在途结果' }; else { this.#job.status = 'cancelling'; this.#job.stage = '正在取消并核对在途结果'; } this.#abort?.abort(); }
    return { job: this.#job ? structuredClone(this.#job) : null };
  }
  async undo(opened: OpenedProjectVNext, args: { requestId: string; operationId: string }) {
    if (this.busy || this.#closing) throw new Error('正在核对更新，暂不能撤回。');
    const abort = this.#abort = new AbortController();
    this.preview.invalidate();
    const operation = opened.programTransaction(manager => manager.undoUpdate(args, async () => { abort.signal.throwIfAborted(); }));
    this.#running = operation.then(() => {}, () => {});
    try { return await operation; } finally { this.#abort = undefined; this.#running = undefined; }
  }
  async close() { this.#closing = true; this.#abort?.abort(); this.#checks.invalidate(); await this.#running; await this.#viewing?.catch(() => {}); this.#checks.clear(); this.#job = undefined; this.#closing = false; }
  async #run(opened: OpenedProjectVNext, args: { requestId: string; parentOrigin: string }, revisionId: string, job: VideoUpdateJob, abort: AbortController) {
    let instanceId: string | undefined;
    try {
      const before = await this.preview.capture(opened, 'current');
      abort.signal.throwIfAborted();
      const checks = await this.#checks.start(opened);
      const batchId = checks.batches.at(-1)!.id;
      const cancel = () => { this.#checks.cancel(batchId); };
      abort.signal.addEventListener('abort', cancel, { once: true });
      if (abort.signal.aborted) cancel();
      let checked;
      try { checked = await this.#checks.wait(opened); }
      finally { abort.signal.removeEventListener('abort', cancel); }
      abort.signal.throwIfAborted();
      if (checked.gates.find(gate => gate.operation === 'preview')?.status !== 'available') throw new Error('必要检查未通过，请在检查详情查看原因后重试。');
      job.stage = '正在构建最新内容的完整视频';
      this.preview.releaseCurrent();
      const descriptor = await this.preview.build(opened, 'current', args.parentOrigin, abort.signal); instanceId = descriptor.instanceId;
      job.stage = '正在验证代表帧与运行契约';
      const plan = representativePlan(descriptor.input, []), frames = [];
      for (let offset = 0; offset < plan.length; offset += 12) {
        abort.signal.throwIfAborted();
        const captured = await capturePreviewFrames(descriptor, this.preview.source.snapshot(descriptor.url), plan.slice(offset, offset + 12).map(item => item.frame), abort.signal);
        for (const frame of captured) {
          if (frame.error || !frame.image) throw new Error(frame.error ?? '代表帧未完成');
          frames.push({ frame: frame.frame, digest: previewDigest(frame.image) });
        }
      }
      const batch = checked.batches.at(-1)!;
      const warnings = batch.diagnostics.filter(item => item.severity === 'warning').map(item => `${item.message} ${item.suggestion}`);
      for (const scene of descriptor.input.scenes) if (scene.time.source === 'draft') warnings.push(`Scene ${descriptor.input.scenes.indexOf(scene) + 1} 缺少有效 Speech：本句无声，使用草稿时长。最终输出前请生成 Speech 并重新同步。`);
      if (batch.truncated || batch.warningsTruncated) throw new Error('检查信息已截断，请修复后重新同步。');
      const record = { protocolVersion: 1, checkerVersion: 1, bridgeVersion: 1, identity: batch.identity, bundle: descriptor.identity.bundle, instanceId,
        stages: batch.stages, frames, warnings, gates: [{ operation: 'publish', status: 'available' }], zeroScenes: !descriptor.input.scenes.length };
      job.stage = '正在发布并保存一步撤回记录';
      await opened.programTransaction(async manager => {
        const local = { ...opened, candidate: manager, readPreviewSource: manager.previewSource };
        return manager.publishUpdate({ requestId: args.requestId, kind: 'sync', revisionId, summary: '仅同步表格内容，沿用现有画面设计', acceptance: record }, 'current', async () => {
          abort.signal.throwIfAborted();
          if ((await this.preview.capture(local, 'current')).signature !== before.signature || (await this.preview.status(local, descriptor.instanceId)).stale) throw new CandidateError('UPDATE_STALE', '表格、媒体或画面设计已变化，请重新选择更新方式。');
          abort.signal.throwIfAborted();
        });
      });
      const state = await opened.programTransaction(manager => manager.updateState());
      this.preview.accept(descriptor.instanceId, state.revisionId);
      job.status = 'published'; job.stage = '视频已同步'; job.revisionId = state.revisionId;
    } catch (error) {
      // rename 后的同步/回执失败必须以持久指针核对，不能报告未发布并重试应用。
      let state;
      try { state = await opened.programTransaction(manager => manager.updateState()); } catch { /* 失权或身份失效交给重开核对。 */ }
      if (state?.result?.requestId === args.requestId && state.result.status === 'published') {
        job.status = 'published'; job.stage = '已核对视频发布'; job.revisionId = state.revisionId;
        if (instanceId) this.preview.accept(instanceId, state.revisionId);
      } else {
        job.status = abort.signal.aborted ? 'cancelled' : 'failed'; job.stage = abort.signal.aborted ? '已取消，请重新选择更新方式' : '同步失败，请重新选择更新方式'; job.error = (error as Error).message;
        if (instanceId) this.preview.release(instanceId);
      }
    } finally { this.#abort = undefined; this.#running = undefined; }
  }
}

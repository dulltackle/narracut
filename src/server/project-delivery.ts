import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CandidateDelivery } from '../shared/candidate-delivery';
import type { BatchView, CheckIdentity, GateEvidence } from '../shared/program-checks';
import { sameIdentity } from '../shared/program-checks';
import type { OpenedProjectVNext } from './project-lifecycle';
import { ProjectPreview } from './project-preview';
import { ProjectChecks } from './project-checks';
import { capturePreviewFrames } from './preview-evidence';
import { previewDigest } from './preview-origin';
const warningKey = (batch: BatchView) => previewDigest(JSON.stringify([batch.id, batch.status, batch.identity, batch.diagnostics.filter(item => item.severity === 'warning'), batch.visualWarnings, batch.truncated, batch.warningsTruncated]));
const text = z.string().trim().min(1).max(4000);
const reportSchema = z.object({ goal: text, summary: text, warnings: z.array(text).max(100), suggestions: z.array(z.object({ sceneId: text, observation: text, action: text, content: text, reason: text }).strict()).max(100) }).strict();
const supplementsSchema = z.array(z.object({ frame: z.number().int().nonnegative(), source: z.enum(['transition','motion']), reason: text.max(2000) }).strict()).max(1000);
/** 会话级单一候选交付；PNG 只存在于有界派生缓存，项目中不写图像或 Agent 对话。 */
export class ProjectDelivery {
  #displayedKey?: string; #read = new Set<string>(); #output?: { width: number; height: number; fps: number };
  #current?: CandidateDelivery; #images = new Map<number, Buffer>(); #controller?: AbortController; #busy = false; #generation = 0;
  constructor(private preview: ProjectPreview, private checks: ProjectChecks) { checks.evidence = (latest, batch) => this.evidence(latest, batch); }
  evidence(latest: CheckIdentity | null, batch?: BatchView): GateEvidence | undefined {
    const current = this.#current;
    if (!current || current.view().stale || !latest || !sameIdentity(current.binding.identity, latest) || this.preview.latestCandidate() !== current.binding.instanceId) return undefined;
    // 完整报告也是交付条件，不能仅由帧采集齐备打开门禁。
    const evidence = current.evidence(); evidence.warningsDisplayed &&= current.complete() && !!batch && batch.status === 'complete' && this.#displayedKey === warningKey(batch); return evidence;
  }
  async #fresh(opened: OpenedProjectVNext, current: CandidateDelivery) {
    try {
      const state = await this.preview.status(opened, current.binding.instanceId);
      current.invalidate(state.stale || this.preview.latestCandidate() !== current.binding.instanceId ? null : this.preview.evidenceSnapshot(current.binding.instanceId).binding);
    } catch { current.invalidate(null); }
    return current === this.#current && !current.view().stale;
  }
  async operate(opened: OpenedProjectVNext, args: any) {
    if (args.action === 'prepare') {
      const snapshot = this.preview.evidenceSnapshot(args.instanceId);
      if (this.#current && this.#current.binding.instanceId === args.instanceId && !args.supplements && await this.#fresh(opened, this.#current)) return this.status(opened);
      const supplements = supplementsSchema.parse(args.supplements ?? []);
      this.clear(); const current = new CandidateDelivery(randomUUID(), snapshot.binding, snapshot.descriptor.input, supplements); this.#current = current; this.#output = snapshot.descriptor.input.output;
      if (!(await this.#fresh(opened, current))) throw new Error('候选 Preview 已过期，请重新构建。');
      this.#collect(opened, current); return this.status(opened);
    }
    if (args.action === 'status') return this.status(opened);
    const current = this.#current;
    if (!current || args.deliveryId !== current.id || !(await this.#fresh(opened, current))) throw new Error('交付身份不存在或已过期，请重新准备最新证据。');
    if (args.action === 'retry') this.#collect(opened, current);
    else if (args.action === 'describe') current.describe(reportSchema.parse(args.report));
    else if (args.action === 'review') {
      const records = z.array(z.object({ frame: z.number().int().nonnegative(), digest: text, observation: text }).strict()).min(1).max(12).parse(args.reviews);
      // 整批先验证，避免部分检查写入后再失败。
      const view = current.view();
      if (records.some(item => !view.frames.some(frame => frame.frame === item.frame && frame.status === 'captured' && frame.digest === item.digest))) throw new Error('检查引用的图像或摘要不匹配。');
      if (records.some(item => !this.#read.has(`${item.frame}:${item.digest}`))) throw new Error('请先读取准确帧图像，再提交检查观察。');
      for (const record of records) current.review(record.frame, record.digest, record.observation);
    } else if (args.action === 'displayed') {
      const checks = await this.checks.status(opened);
      const batch = checks.batches.at(-1);
      if (current !== this.#current) throw new Error('交付已过期，请重新准备。');
      if (batch && batch.status === 'complete' && !batch.stale && batch.id === args.batchId && args.warningsKey === warningKey(batch) && sameIdentity(batch.identity, current.binding.identity) && !batch.truncated && !batch.warningsTruncated) { current.displayWarnings(args.reportRevision); this.#displayedKey = warningKey(batch); }
    } else if (args.action === 'image') {
      const image = this.#images.get(args.frame), frame = current.view().frames.find(item => item.frame === args.frame);
      if (!image || !frame?.digest) throw new Error('此帧尚未成功采集，请重试失败项。');
      this.#read.add(`${args.frame}:${frame.digest}`);
      return { image: image.toString('base64'), mimeType: 'image/png', deliveryId: current.id, binding: current.binding, frame: args.frame, digest: frame.digest };
    } else throw new Error('不支持的交付操作。');
    return this.status(opened);
  }
  #collect(opened: OpenedProjectVNext, current: CandidateDelivery) {
    if (this.#busy || !current.view().frames.some(frame => frame.status !== 'captured')) return;
    this.#busy = true; const controller = new AbortController(); this.#controller = controller; const generation = this.#generation;
    void (async () => {
      try {
        const todo = current.view().frames.filter(item => item.status !== 'captured');
        for (let offset = 0; offset < todo.length; offset += 12) {
          if (generation !== this.#generation || !(await this.#fresh(opened, current))) break;
          const frames = todo.slice(offset, offset + 12).map(item => item.frame);
          try {
            const snapshot = this.preview.evidenceSnapshot(current.binding.instanceId);
            const results = await capturePreviewFrames(snapshot.descriptor, this.preview.source.snapshot(snapshot.descriptor.url), frames, controller.signal);
            if (generation !== this.#generation || !(await this.#fresh(opened, current))) break;
            for (const item of results) {
              if (!item.image || item.error) { current.fail(item.frame, item.error ?? '采集没有返回图像'); continue; }
              const total = [...this.#images.values()].reduce((sum, image) => sum + image.length, 0);
              if (total + item.image.length > 64 * 1024 * 1024) { current.fail(item.frame, '整套图像超过 64 MiB，请减小输出尺寸后重新准备'); continue; }
              this.#images.set(item.frame, item.image); current.capture(item.frame, previewDigest(item.image));
            }
          } catch (error) {
            if (generation !== this.#generation || !(await this.#fresh(opened, current))) break;
            for (const frame of frames) current.fail(frame, (error as Error).message);
          }
        }
      } finally { if (generation === this.#generation) this.#busy = false; }
    })();
  }
  async status(opened: OpenedProjectVNext) {
    const current = this.#current; if (current) await this.#fresh(opened, current);
    const checks = await this.checks.status(opened);
    if (current !== this.#current) return { delivery: null, checks, collecting: false };
    const delivery = current?.view() ?? null;
    const batch = checks.batches.at(-1);
    if (delivery) { delivery.warningsDisplayed = this.evidence(batch?.identity ?? null, batch)?.warningsDisplayed ?? false; delivery.complete &&= delivery.warningsDisplayed; }
    const eligible = checks.gates.find(gate => gate.operation === 'delivery')?.status === 'available';
    return { delivery, checks, warningsKey: batch ? warningKey(batch) : null, output: this.#output, collecting: this.#busy, status: delivery?.stale ? 'stale' : delivery?.complete && eligible ? 'ready' : 'incomplete' };
  }
  invalidate() { this.#current?.invalidate(null); this.#generation++; this.#controller?.abort(); this.#busy = false; }
  consume(instanceId: string) { if (this.#current?.binding.instanceId === instanceId) this.clear(); }
  clear() { this.#generation++; this.#controller?.abort(); this.#current = undefined; this.#images.clear(); this.#read.clear(); this.#displayedKey = undefined; this.#output = undefined; this.#busy = false; }
}

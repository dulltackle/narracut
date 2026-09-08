import { sameIdentity, type CheckIdentity, type GateEvidence } from './program-checks';
import { representativePlan, type SupplementalFrame, type PlannedFrame } from './representative-frames';
export type DeliveryBinding = { instanceId: string; bundle: string; identity: CheckIdentity };
export type SceneSuggestion = { sceneId: string; observation: string; action: string; content: string; reason: string };
export type DeliveryReport = { goal: string; summary: string; warnings: string[]; suggestions: SceneSuggestion[] };
export type FrameEvidence = PlannedFrame & { status: 'pending' | 'captured' | 'failed'; digest?: string; error?: string; observation?: string };
/** 一套证据只有一个绑定，失效不可逆；重采集必须创建新套件。 */
export class CandidateDelivery {
  readonly binding: DeliveryBinding;
  #frames: FrameEvidence[]; #stale = false; #report?: DeliveryReport; #revision = 0; #displayed = -1;
  constructor(readonly id: string, binding: DeliveryBinding, private input: Parameters<typeof representativePlan>[0], supplements: SupplementalFrame[] = []) {
    this.binding = structuredClone(binding); this.input = structuredClone(input);
    this.#frames = representativePlan(input, supplements).map(point => ({ ...point, status: 'pending' }));
  }
  invalidate(latest: DeliveryBinding | null) {
    if (!latest || latest.instanceId !== this.binding.instanceId || latest.bundle !== this.binding.bundle || !sameIdentity(latest.identity, this.binding.identity) || Object.values(latest.identity).some(value => !value)) this.#stale = true;
  }
  #frame(frame: number) { if (this.#stale) throw new Error('整套证据已过期，请针对最新 Preview 重新准备。'); const item = this.#frames.find(item => item.frame === frame); if (!item) throw new Error('帧不属于完整计划。'); return item; }
  capture(frame: number, digest: string) { const item = this.#frame(frame); item.status = 'captured'; item.digest = digest; delete item.error; delete item.observation; }
  fail(frame: number, reason: string) { const item = this.#frame(frame); item.status = 'failed'; item.error = reason; delete item.digest; delete item.observation; }
  review(frame: number, digest: string, observation: string) {
    const item = this.#frame(frame);
    if (item.status !== 'captured' || item.digest !== digest || !observation.trim() || observation.length > 4000) throw new Error('检查必须引用已采集图像的准确摘要并提供观察。');
    item.observation = observation;
  }
  describe(report: DeliveryReport) {
    if (this.#stale) throw new Error('已过期交付不能更新报告。');
    if (!report.goal.trim() || !report.summary.trim() || report.suggestions.some(item => !this.input.scenes.some(scene => scene.id === item.sceneId))) throw new Error('交付需要目标、变更摘要及存在的稳定 Scene ID。');
    this.#report = structuredClone(report); this.#revision++; this.#displayed = -1;
  }
  displayWarnings(revision: number) { if (!this.#stale && this.#report && revision === this.#revision) this.#displayed = revision; }
  evidence(): GateEvidence {
    return { ...structuredClone(this.binding), previewReady: !this.#stale, representativeFrames: !this.#stale && this.#frames.every(item => item.status === 'captured' && !!item.observation), warningsDisplayed: !this.#stale && !!this.#report && this.#displayed === this.#revision, explicitAcceptance: false, zeroScenes: this.input.scenes.length === 0 };
  }
  complete() { const evidence = this.evidence(); return !this.#stale && !!this.#report && evidence.representativeFrames && evidence.warningsDisplayed; }
  view() {
    return structuredClone({ version: 1 as const, id: this.id, binding: this.binding, stale: this.#stale, frames: this.#frames, captured: this.#frames.filter(item => item.status === 'captured').length, checked: this.#frames.filter(item => !!item.observation).length, report: this.#report ?? null, reportRevision: this.#revision, warningsDisplayed: this.#displayed === this.#revision, zeroScenes: !this.input.scenes.length, complete: this.complete() });
  }
}

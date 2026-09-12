import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { OpenedProjectVNext } from './project-lifecycle';
import { ProjectDelivery } from './project-delivery';
import { ProjectPreview } from './project-preview';
import { gateOperations } from '../shared/program-checks';
import { previewDigest } from './preview-origin';
import { CandidateError } from './project-candidate';

/** 用户确认绑定整套报告及完整视频状态；所有写操作复用项目保存队列。 */
export class ProjectAcceptance {
  constructor(private delivery: ProjectDelivery, private preview: ProjectPreview) {}
  async review(opened: OpenedProjectVNext) {
    const state = await this.delivery.status(opened), delivery = state.delivery, batch = state.checks.batches.at(-1);
    if (!delivery || delivery.stale || !delivery.complete || !delivery.report || !batch) throw new CandidateError('ACCEPTANCE_NOT_READY', '证据缺失或过期，请前往检查详情或重新准备候选证据。');
    const evidence = this.delivery.evidence(batch.identity, batch);
    const gate = gateOperations(batch, batch.identity, evidence && { ...evidence, explicitAcceptance: true }, undefined, { accept: true }).find(item => item.operation === 'accept')!;
    if (gate.status !== 'available') throw new CandidateError('ACCEPTANCE_BLOCKED', gate.reason);
    const snapshot = this.preview.evidenceSnapshot(delivery.binding.instanceId);
    this.preview.source.snapshot(snapshot.descriptor.url);
    const history = await opened.programTransaction(manager => manager.history());
    const candidate = await opened.candidate({ action: 'read' });
    if (candidate.baseline !== batch.identity.baseline || candidate.status !== 'saved') throw new CandidateError('ACCEPTANCE_STALE', '候选已变化，请重新审阅。');
    const record = {
      protocolVersion: 1, checkerVersion: 1, bridgeVersion: 1,
      identity: delivery.binding.identity, bundle: delivery.binding.bundle, instanceId: delivery.binding.instanceId,
      batchId: batch.id, stages: batch.stages.map(({ id, status }) => ({ id, status })),
      warnings: [...delivery.report.warnings, ...batch.diagnostics.filter(item => item.severity === 'warning').map(item => `${item.code}：${item.message} ${item.suggestion}`), ...batch.visualWarnings.map(item => `${item.message} ${item.suggestion}`)],
      frames: delivery.frames.map(({ frame, reasons, digest }) => ({ frame, reasons, digest })), zeroScenes: delivery.zeroScenes,
      gates: [{ operation: gate.operation, status: gate.status, reason: gate.reason }],
    };
    const summary = delivery.report.summary;
    const key = previewDigest(JSON.stringify([delivery, batch, history.current, history.revisions.map(item => item.revisionId), record]));
    return { key, summary, record, sourceRevision: candidate.sourceRevision, currentRevision: history.current, willPrune: history.revisions.length >= 20, baseline: candidate.baseline, requestId: randomUUID() };
  }
  async operate(opened: OpenedProjectVNext, args: any): Promise<any> {
    if (args.action === 'review') return { confirmation: await this.review(opened) };
    if (args.action === 'history') return opened.programTransaction(manager => manager.history());
    if (args.action === 'cleanup') return opened.programTransaction(manager => manager.cleanupAcceptance());
    if (args.action === 'from-history') {
      const revisionId = z.string().uuid().parse(args.revisionId);
      const candidate = await opened.candidate({ action: 'create', sourceRevision: revisionId });
      this.delivery.clear(); return { status: 'candidate-created', candidate };
    }
    const requestId = z.string().uuid().parse(args.requestId);
    return opened.programTransaction(async manager => {
      // 回调已持有队列；只读捕获必须使用此事务内接口，避免等待自己。
      const local = { ...opened, candidate: manager, readPreviewSource: manager.previewSource, programTransaction: async <T>(run: (value: typeof manager) => Promise<T>) => run(manager) };
      const history = await manager.history();
      const known = history.revisions.find(item => item.requestId === requestId);
      if (known) {
        const instanceId = known.acceptance?.instanceId as string;
        if (known.current && known.valid) this.preview.accept(instanceId, known.revisionId);
        this.delivery.consume(instanceId);
        return { status: 'accepted', revision: known, ...await manager.cleanupAcceptance() };
      }
      if (args.action === 'result') {
        const candidate = await manager({ action: 'read' });
        return { status: args.currentRevision === history.current && args.baseline === candidate.baseline && candidate.status === 'saved' ? 'not-committed' : 'unknown' };
      }
      if (args.action !== 'accept' || args.confirmed !== true || typeof args.key !== 'string') throw new CandidateError('ACCEPTANCE_CONFIRMATION_REQUIRED', '需要用户明确接受完整候选。');
      const reviewed = await this.review(local);
      if (reviewed.key !== args.key) throw new CandidateError('ACCEPTANCE_STALE', '确认期间候选、输入或检查已变化，请重新审阅。');
      const result = await manager.accept({ baseline: reviewed.baseline, summary: reviewed.summary, source: 'candidate', acceptance: reviewed.record, requestId }, async () => {
        if ((await this.review(local)).key !== reviewed.key) throw new CandidateError('ACCEPTANCE_STALE', '提交前证据已变化，请重新审阅。');
      });
      this.preview.accept(reviewed.record.instanceId, result.revision.revisionId); this.delivery.consume(reviewed.record.instanceId);
      return result;
    });
  }
}

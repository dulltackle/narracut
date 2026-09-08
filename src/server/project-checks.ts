import { randomUUID } from 'node:crypto';
import { CheckBatch, diagnostic, diagnosticCatalog, gateOperations, type BatchView, type GateEvidence, type CheckIdentity, type Diagnostic, type StageCheck } from '../shared/program-checks';
import type { OpenedProjectVNext } from './project-lifecycle';
import { checkProgramManifest, programEnvironmentIdentity } from './program-bundle';
import { readOfflineDependencyGraph } from './project-dependencies';
import { ProjectPreview } from './project-preview';
import { previewDigest } from './preview-origin';

/** 仅驻留当前工作台会话；保留最近两批具名结果，不持久化第二份检查历史。 */
export class ProjectChecks {
  evidence?: (latest: CheckIdentity | null, batch?: BatchView) => GateEvidence | undefined;
  #batches: CheckBatch[] = []; #starting = false; #generation = 0;
  constructor(private preview: ProjectPreview) {}
  async #capture(opened: OpenedProjectVNext) {
    const [candidate, source, capture, environment] = await Promise.allSettled([
      opened.candidate({ action: 'read' }), opened.readPreviewSource('candidate'),
      this.preview.capture(opened, 'candidate', true), programEnvironmentIdentity(),
    ]);
    // 单项读取失败只留下未知字段，不能豁免其他成功观察之间的一致性核对。
    const baselines = [candidate.status === 'fulfilled' ? candidate.value.baseline : null,
      source.status === 'fulfilled' ? source.value.baseline : null, capture.status === 'fulfilled' ? capture.value.baseline : null].filter(value => value !== null);
    const programs = [source.status === 'fulfilled' ? source.value.identity : null,
      capture.status === 'fulfilled' ? capture.value.sourceIdentity : null].filter(value => value !== null);
    const coherent = new Set(baselines).size <= 1 && new Set(programs).size <= 1;
    const identity: CheckIdentity = {
      project: opened.inspection.manifest.projectId,
      program: source.status === 'fulfilled' ? source.value.identity : candidate.status === 'fulfilled' ? candidate.value.candidate?.identity ?? null : null,
      baseline: candidate.status === 'fulfilled' ? candidate.value.baseline : null,
      brief: capture.status === 'fulfilled' ? capture.value.brief : null,
      input: capture.status === 'fulfilled' ? capture.value.projectInput : null,
      media: capture.status === 'fulfilled' ? previewDigest(JSON.stringify([...capture.value.media].map(([path, bytes]) => [path, previewDigest(bytes)]).sort())) : null,
      environment: environment.status === 'fulfilled' ? environment.value : null,
    };
    return { identity: coherent ? identity : { ...identity, program: null, baseline: null }, candidate, source, capture, environment, coherent };
  }
  async start(opened: OpenedProjectVNext) {
    if (this.#starting || this.#batches.at(-1)?.view().status === 'running') throw new Error('已有检查正在运行。');
    this.#starting = true; const generation = this.#generation;
    try {
      const snapshot = await this.#capture(opened);
      if (generation !== this.#generation) throw new Error('检查所属项目已关闭。');
      for (const batch of this.#batches) batch.invalidate(snapshot.identity);
      if (!snapshot.coherent) throw new Error('检查准备期间候选已变化；未创建混合批次，请重新检查。');
      const { identity } = snapshot;
      const fromError = (error: unknown, fallback: string): Diagnostic => {
        const code = (error as { code?: string })?.code;
        const item = diagnostic(code && diagnosticCatalog[code] ? code : fallback, identity);
        if (code && !diagnosticCatalog[code]) item.externalCode = code;
        if (item.stage === 'manifest') item.location = { kind: 'file', path: 'program.json' };
        // 构建工具没有证明文件/Scene 因果关系时，只定位整个程序。
        return item;
      };
      const checks: StageCheck[] = [
        { id: 'layout', dependencies: [], run: async () => snapshot.source.status === 'rejected' ? [fromError(snapshot.source.reason, 'LAYOUT_INVALID')] : [] },
        { id: 'manifest', dependencies: ['layout'], run: async () => {
          try { return checkProgramManifest(snapshot.source.status === 'fulfilled' ? snapshot.source.value.manifest : undefined).warnings.map(code => diagnostic(code, identity, { kind: 'file', path: 'program.json' })); }
          catch (error) { return [fromError(error, 'MANIFEST_INVALID')]; }
        } },
        { id: 'dependencies', dependencies: ['layout'], run: async () => {
          if (snapshot.source.status !== 'fulfilled') return [];
          const { program, offline } = snapshot.source.value;
          try { readOfflineDependencyGraph(program.get('package.json') ?? Buffer.alloc(0), program.get('pnpm-lock.yaml') ?? Buffer.alloc(0), offline); return []; }
          catch (error) { return [fromError(error, 'DEPENDENCY_LOCK_INVALID')]; }
        } },
        { id: 'capsule', dependencies: [], run: async () => snapshot.environment.status === 'rejected' ? [fromError(snapshot.environment.reason, 'CAPSULE_UNAVAILABLE')] : [] },
        { id: 'build', dependencies: ['manifest','dependencies','capsule'], run: async signal => {
          if (snapshot.capture.status !== 'fulfilled' || snapshot.source.status !== 'fulfilled') return [fromError(snapshot.capture.status === 'rejected' ? snapshot.capture.reason : undefined, 'RUNTIME_CONTRACT_VIOLATION')];
          try {
            const value = snapshot.capture.value;
            const bundle = await opened.buildCandidateBundle({ input: value.input, speech: value.speech, baseline: value.baseline, sourceIdentity: value.sourceIdentity, target: 'candidate', signal });
            if (bundle.environmentIdentity !== identity.environment) {
              batch.invalidate({ ...identity, environment: bundle.environmentIdentity });
              throw Object.assign(new Error('构建使用的执行环境身份已变化，请重新检查。'), { code: 'CHECK_IDENTITY_CHANGED' });
            }
            return [];
          } catch (error) {
            if (['CANDIDATE_BASELINE_CONFLICT','CHECK_IDENTITY_CHANGED'].includes((error as { code?: string }).code ?? '')) throw error;
            const facts = (error as { diagnostics?: Array<{ code: string; path?: string }> }).diagnostics;
            return facts?.length ? facts.map(fact => { const item = fromError(fact, 'BUNDLE_FAILED'); if (fact.path) item.location = { kind: 'file', path: fact.path }; return item; }) : [fromError(error, 'BUNDLE_FAILED')];
          }
        } },
      ];
      const batch = new CheckBatch(randomUUID(), identity, checks);
      this.#batches.push(batch); this.#batches = this.#batches.slice(-2);
      void batch.run().then(async () => {
        if (generation !== this.#generation) return;
        try { batch.invalidate((await this.#capture(opened)).identity); }
        catch { batch.invalidate({ ...identity, project: null }); }
      });
      return this.#view(identity);
    } finally { this.#starting = false; }
  }
  cancel(id: string) { const batch = this.#batches.find(item => item.id === id); batch?.cancel(); return this.#view(null); }
  async status(opened: OpenedProjectVNext) {
    if (!this.#batches.length) return this.#view(null);
    const latest = (await this.#capture(opened)).identity;
    for (const batch of this.#batches) batch.invalidate(latest);
    return this.#view(latest);
  }
  #view(latest: CheckIdentity | null) {
    const batches = this.#batches.map(batch => batch.view());
    // 接受仍需用户明确整体确认；最终 Render 独立判定。
    return { batches, gates: gateOperations(batches.at(-1) ?? null, latest, this.evidence?.(latest, batches.at(-1)), undefined, { preview: true, delivery: true, accept: true }) };
  }
  clear() { this.#generation++; for (const batch of this.#batches) batch.cancel(); this.#batches = []; }
}

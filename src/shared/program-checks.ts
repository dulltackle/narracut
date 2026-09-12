/** 检查器协议 v1：诊断事实、批次新鲜度与操作门禁各自独立。 */
export type CheckIdentity = Readonly<Record<'project' | 'program' | 'baseline' | 'brief' | 'input' | 'media' | 'environment', string | null>>;
export type StageId = 'layout' | 'manifest' | 'dependencies' | 'capsule' | 'build' | 'static' | 'typecheck' | 'bundle' | 'composition' | 'runtime' | 'evidence' | 'render';
export type Location = { kind: 'project' | 'file' | 'scene' | 'frame'; path?: string; sceneId?: string; frame?: number; instanceId?: string };
export type Operation = 'preview' | 'delivery' | 'accept' | 'render';
const groups: [StageId, string, string, string[]][] = [
  ['layout', 'Render Program 目录不符合要求。', '修复程序目录、缺失文件或越界路径，再重新检查。', ['LAYOUT_INVALID','LAYOUT_REQUIRED_PATH_MISSING','LAYOUT_PATH_ESCAPE','LAYOUT_FORBIDDEN_ARTIFACT']],
  ['manifest', 'Manifest 声明无效或不受支持。', '修正 program.json 的协议版本及正整数输出格式。', ['MANIFEST_INVALID','MANIFEST_API_UNSUPPORTED','OUTPUT_FORMAT_INVALID']],
  ['dependencies', '精确依赖或离线库不可用。', '通过依赖协调修复声明、锁图与离线包，再重新检查。', ['DEPENDENCY_MANIFEST_INVALID','DEPENDENCY_LOCK_INVALID','DEPENDENCY_LOCK_OUT_OF_SYNC','DEPENDENCY_SOURCE_UNSUPPORTED','DEPENDENCY_INTEGRITY_FAILED','DEPENDENCY_UNAVAILABLE','REMOTION_VERSION_MISMATCH','DEPENDENCY_INSTALL_FAILED']],
  ['static', '程序访问禁止能力或使用非确定性行为。', '移除宿主、网络或跨帧状态访问，改用纯函数与显式种子。', ['STATIC_FORBIDDEN_CAPABILITY','STATIC_NONDETERMINISTIC_API']],
  ['typecheck', '程序未通过固定类型检查。', '修正 Render Program 类型与入口契约，再重新检查。', ['TYPECHECK_FAILED']],
  ['bundle', '不可变 Bundle 检查失败。', '修复源码与构建产物；保持同一认证环境和完整 Source Map。', ['BUNDLE_FAILED','BUNDLE_SOURCEMAP_MISSING','BUNDLE_FINGERPRINT_MISMATCH']],
  ['composition', 'Composition 与权威输入不一致。', '使用 Runtime 提供的输出格式、Scene 顺序与时间。', ['COMPOSITION_INVALID']],
  ['capsule', '执行胶囊无法完成认证或执行。', '恢复认证执行环境或降低资源占用后重试。', ['CAPSULE_UNAVAILABLE','CAPSULE_SELF_TEST_FAILED','CAPSULE_TIMEOUT','CAPSULE_RESOURCE_EXCEEDED']],
  ['runtime', 'Runtime 契约或帧执行失败。', '修复程序入口、Bridge 或报错帧；不得访问外部资源。', ['RUNTIME_ENTRY_INVALID','RUNTIME_METADATA_INVALID','RUNTIME_BRIDGE_FAILED','RUNTIME_FRAME_FAILED','RUNTIME_CONTRACT_VIOLATION','RUNTIME_EXTERNAL_ACCESS_BLOCKED']],
  ['evidence', '验收证据不完整或身份不符。', '针对最新候选 Preview 补齐代表帧检查。', ['EVIDENCE_PLAN_INCOMPLETE','EVIDENCE_CAPTURE_FAILED','EVIDENCE_IDENTITY_MISMATCH']],
  ['render', '最终 Render 未能完成。', '核对已接受修订、媒体、编码器与输出位置，再重试。', ['RENDER_MEDIA_CHANGED','RENDER_FRAME_FAILED','RENDER_ENCODE_FAILED','RENDER_OUTPUT_FAILED']],
];
export const diagnosticCatalog: Record<string, { stage: StageId; message: string; suggestion: string; warning?: boolean }> = {};
for (const [stage, message, suggestion, codes] of groups) for (const code of codes) diagnosticCatalog[code] = { stage, message, suggestion };
for (const [code, stage, message, suggestion] of [
  ['MANIFEST_UNKNOWN_FIELD','manifest','Manifest 含未知字段。','核对并移除不使用的字段。'],
  ['STATIC_DEPRECATED_API','static','程序使用已弃用 API。','迁移到当前 Runtime API。'],
  ['CAPSULE_RESOURCE_NEAR_LIMIT','capsule','执行资源接近上限。','减少计算或媒体资源占用。'],
  ['RESULT_TRUNCATED','evidence','诊断已截断。','修复已列出的问题后重新检查。'],
] as const) diagnosticCatalog[code] = { stage, message, suggestion, warning: true };
export type Diagnostic = { code: string; stage: StageId; identity: CheckIdentity; message: string; suggestion: string; location: Location; related: Location[]; severity: 'error' | 'warning'; operations: Operation[]; externalCode?: string };
export function diagnostic(code: string, identity: CheckIdentity, location: Location = { kind: 'project' }): Diagnostic {
  const entry = diagnosticCatalog[code];
  if (!entry) throw new Error(`未登记的诊断代码：${code}`);
  return { code, ...entry, identity: { ...identity }, location, related: [], severity: entry.warning ? 'warning' : 'error', operations: entry.warning ? [] : entry.stage === 'render' ? ['render'] : entry.stage === 'evidence' ? ['delivery','accept'] : ['preview','delivery','accept'] };
}
export function sameIdentity(a: CheckIdentity, b: CheckIdentity) { return (Object.keys(a) as (keyof CheckIdentity)[]).every(key => a[key] === b[key]); }
const stageOrder: StageId[] = ['layout','manifest','dependencies','capsule','typecheck','static','build','bundle','composition','runtime','evidence','render'];
const canonical = (value: unknown): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,item]) => [key, JSON.parse(canonical(item))])) : value);
export function normalizeDiagnostics(values: Diagnostic[], limit = 100) {
  const unique = [...new Map(values.map(value => [canonical(value), value])).values()];
  unique.sort((a,b) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage) || (canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0));
  const bound = Math.max(1, Math.min(100, Math.floor(limit) || 100));
  return { diagnostics: unique.slice(0, bound), truncated: Math.max(0, unique.length - bound), total: unique.length };
}
export type VisualWarning = { id: string; identity: CheckIdentity; message: string; suggestion: string; location: Location };
export type Stage = { id: StageId; status: 'waiting' | 'running' | 'passed' | 'issues' | 'not-run'; reason: string };
export type StageCheck = { id: StageId; dependencies: StageId[]; run: (signal: AbortSignal) => Promise<Diagnostic[]> };
export type BatchView = { version: 1; id: string; identity: CheckIdentity; status: 'running' | 'complete' | 'cancelled'; stale: boolean; stages: Stage[]; diagnostics: Diagnostic[]; truncated: number; total: number; hardOperations: Operation[]; visualWarnings: VisualWarning[]; warningsTruncated: number };
export class CheckBatch {
  #controller = new AbortController(); #status: BatchView['status'] = 'running'; #stale = false; #diagnostics: Diagnostic[] = []; #stages: Stage[];
  constructor(readonly id: string, readonly identity: CheckIdentity, private checks: StageCheck[], private visualWarnings: VisualWarning[] = []) {
    this.identity = Object.freeze({ ...identity });
    if (visualWarnings.some(warning => !sameIdentity(warning.identity, identity))) throw new Error('主观警告必须绑定同一完整状态身份。');
    this.visualWarnings = structuredClone(visualWarnings).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const seen = new Set<StageId>();
    for (const check of checks) { if (seen.has(check.id) || check.dependencies.some(id => !seen.has(id))) throw new Error('检查依赖图必须按拓扑顺序定义且无重复阶段。'); seen.add(check.id); }
    this.#stages = checks.map(check => ({ id: check.id, status: 'waiting', reason: '' }));
  }
  invalidate(latest: CheckIdentity) { if (!sameIdentity(this.identity, latest)) this.#stale = true; }
  cancel() { if (this.#status !== 'running') return; this.#status = 'cancelled'; this.#controller.abort(); for (const stage of this.#stages) if (['waiting','running'].includes(stage.status)) { stage.status = 'not-run'; stage.reason = '用户取消，检查不完整'; } }
  async run() {
    const tasks = new Map<StageId, Promise<void>>();
    for (const check of this.checks) {
      const dependencies = check.dependencies.map(id => tasks.get(id)!);
      const task = (async () => {
        await Promise.all(dependencies);
        const stage = this.#stages.find(item => item.id === check.id)!;
        if (this.#controller.signal.aborted) return;
        const missing = check.dependencies.filter(id => this.#stages.find(item => item.id === id)!.status !== 'passed');
        if (missing.length) { stage.status = 'not-run'; stage.reason = `前置阶段未通过：${missing.join('、')}`; return; }
        stage.status = 'running';
        let results: Diagnostic[];
        try { results = await check.run(this.#controller.signal); }
        catch { if (this.#controller.signal.aborted) return; stage.status = 'not-run'; stage.reason = '检查器操作失败，请重试'; return; }
        if (this.#controller.signal.aborted) return;
        if (results.some(item => !sameIdentity(item.identity, this.identity))) { this.#stale = true; stage.status = 'not-run'; stage.reason = '结果身份不符，未并入本批次'; return; }
        this.#diagnostics.push(...results); stage.status = results.some(item => item.severity === 'error') ? 'issues' : 'passed';
      })(); tasks.set(check.id, task);
    }
    await Promise.all(tasks.values()); if (!this.#controller.signal.aborted) this.#status = 'complete';
  }
  view(): BatchView { return structuredClone({ version: 1, id: this.id, identity: this.identity, status: this.#status, stale: this.#stale, stages: this.#stages, visualWarnings: this.visualWarnings.slice(0,100), warningsTruncated: Math.max(0,this.visualWarnings.length - 100), ...normalizeDiagnostics(this.#diagnostics), hardOperations: (['preview','delivery','accept','render'] as Operation[]).filter(operation => this.#diagnostics.some(item => item.severity === 'error' && item.operations.includes(operation))) }); }
}
export type GateEvidence = { identity: CheckIdentity; bundle: string; instanceId: string | null; previewReady: boolean; representativeFrames: boolean; warningsDisplayed: boolean; explicitAcceptance: boolean; zeroScenes: boolean };
export type AcceptedEvidence = { identity: CheckIdentity; bundle: string; currentBundle: string; recordFresh: boolean; renderReady: boolean; preflight: boolean; blocked: boolean };
export function gateOperations(batch: BatchView | null, latest: CheckIdentity | null, evidence?: GateEvidence, accepted?: AcceptedEvidence, enabled: Partial<Record<Operation, boolean>> = { preview: true, delivery: true }) {
  const fresh = !!batch && !!latest && !batch.stale && sameIdentity(batch.identity, latest) && Object.values(latest).every(value => value !== null);
  const checks = fresh && batch!.status === 'complete' && batch!.stages.length > 0 && batch!.stages.filter(stage => !['evidence','render'].includes(stage.id)).every(stage => stage.status === 'passed');
  const preview = !!checks && !batch!.hardOperations.includes('preview');
  const bound = !!evidence && !!latest && sameIdentity(evidence.identity, latest) && !!evidence.bundle;
  const delivery = preview && bound && (evidence!.zeroScenes || (evidence!.previewReady && !!evidence!.instanceId && evidence!.representativeFrames)) && evidence!.warningsDisplayed && !batch!.truncated && !batch!.warningsTruncated && !batch!.hardOperations.includes('delivery');
  const accept = delivery && evidence!.explicitAcceptance && !batch!.hardOperations.includes('accept');
  const render = !!accepted && accepted.recordFresh && !!accepted.bundle && accepted.bundle === accepted.currentBundle && accepted.renderReady && accepted.preflight && !accepted.blocked;
  const reasons = {
    preview: !batch ? '尚未检查当前候选' : batch.status === 'cancelled' ? '检查已取消，结果不完整' : !fresh ? '整批结果已过期或身份尚未确认' : !checks ? '必要检查尚未全部通过' : '必要检查通过；允许草稿时间与零 Scene',
    delivery: !preview ? '先完成候选必要检查' : !bound ? '缺少绑定最新候选的 Preview 证据' : !evidence!.zeroScenes && (!evidence!.previewReady || !evidence!.representativeFrames || !evidence!.instanceId) ? '最新 Preview 或代表帧检查尚未齐备' : !evidence!.warningsDisplayed || !!batch!.truncated || !!batch!.warningsTruncated ? '全部警告尚未实际展示，或诊断已截断' : '最新 Preview、代表帧与警告展示齐备',
    accept: !delivery ? '候选尚不具备交付条件' : !evidence!.explicitAcceptance ? '仍须用户明确整体接受候选' : '用户已明确整体接受，证据绑定一致',
    render: !accepted ? '尚无已接受修订的验收记录' : !accepted.recordFresh ? '已接受修订的记录已过期' : accepted.bundle !== accepted.currentBundle ? 'Bundle 与接受记录不一致' : !accepted.renderReady ? '需要正式 Speech 时间与可渲染 Scene' : !accepted.preflight || accepted.blocked ? '已接受修订的 Render 前检查未通过' : '已接受修订满足最终 Render 条件',
  };
  const next = { preview: '检查当前候选；通过后在上方构建候选', delivery: '构建最新候选 Preview 并完成代表帧审核', accept: '完成交付检查后明确整体接受', render: '针对已接受修订补齐正式时间及 Render 前检查' };
  return (['preview','delivery','accept','render'] as const).map(operation => ({ operation, eligible: { preview,delivery,accept,render }[operation], status: !enabled[operation] ? 'disabled' : { preview,delivery,accept,render }[operation] ? 'available' : 'blocked', reason: reasons[operation], next: !enabled[operation] ? '此操作尚未启用' : next[operation] }));
}

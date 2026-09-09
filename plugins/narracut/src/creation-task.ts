import { endedTaskReason, cleanupEndedTask } from '../../../src/server/project-revisions';
import { sceneSuggestion, pendingSuggestion, evaluateSuggestion, briefProposal, pendingMessage, messageDecision, authorizesBrief } from './creation-interaction';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rename, rm, open } from 'node:fs/promises';
import { z } from 'zod';
import type { CodexHostAdapter, CodexHostEvent } from './codex-host';
import { codexStopReason } from './codex-host';
import type { OpenedProjectVNext } from '../../../src/server/project-lifecycle';
import { directory, regular, syncDirectory } from '../../../src/server/project-candidate';
import { ProjectPreview } from '../../../src/server/project-preview';
import { ProjectChecks } from '../../../src/server/project-checks';
import { sameIdentity } from '../../../src/shared/program-checks';
import { ProjectDelivery } from '../../../src/server/project-delivery';


const stages = ['read', 'modify', 'check', 'preview', 'frames', 'deliver'] as const;
const checkpointSchema = z.object({
  taskId: z.string().uuid(), projectId: z.string().uuid(), instruction: z.string().min(1).max(4000),
  status: z.enum(['running', 'waiting', 'stopped', 'terminated']), reason: z.string().nullable(),
  threadPointer: z.string().nullable(), lastSafeStage: z.enum(stages).nullable(),
  candidateBaseline: z.string().nullable(), inputIdentity: z.string().nullable(),
  pending: z.string().max(4000).nullable(),
  waitingReason: z.string().nullable().default(null),
  suggestions: z.array(pendingSuggestion).max(100).default([]),
  briefProposal: briefProposal.nullable().default(null),
  pendingMessage: pendingMessage.nullable().default(null),
  toolApproval: z.object({ approvalId: z.string(), threadId: z.string(), turnId: z.string(), summary: z.string().max(4000) }).nullable().default(null),
}).strict();
export type CreationCheckpoint = z.infer<typeof checkpointSchema>;
const reportText = z.string().min(1).max(4000);
const answerSchema = z.object({
  verificationToken: z.string(), action: z.enum(['apply', 'dependencies', 'deliver', 'wait', 'brief']),
  changes: z.array(z.object({ path: z.string().max(1024), content: z.string().max(256_000).nullable() }).strict()).max(12),
  dependencies: z.array(z.object({ name: z.string(), version: z.string() }).strict()).max(100).default([]),
  packages: z.array(z.object({ name: z.string(), version: z.string(), integrity: z.string() }).strict()).max(256).default([]),
  summary: reportText, divergence: z.string().max(4000), warnings: z.array(reportText).max(100),
  suggestions: z.array(sceneSuggestion).max(100),
  brief: z.object({ content: z.string().max(2097152), purpose: reportText }).strict().nullable().default(null),
  reviews: z.array(z.object({ frame: z.number().int().nonnegative(), digest: reportText, observation: reportText }).strict()).max(12),
}).strict();
export type CreationState = CreationCheckpoint & { externalBaseline: string | null; stage: typeof stages[number]; divergence: string; preview: unknown | null; deliveryId: string | null };
const externalMessage = '已保留外部修改，已丢弃 Agent 未提交修改。继续后，Agent 将基于外部候选和最新项目内容重新检查并创作。';
class InputsChanged extends Error {}
type Driver = { token: string; turnId: string | null; signature: string };
/** 一个项目只保留一项任务。模型没有项目写能力，只有此服务可以提交其经过校验的批次。 */
export class CreationTask {
  #state: CreationState | null = null;
  #driver: Driver | null = null;
  #operation: 'stopping' | 'stop-uncertain' | 'reconciling' | 'transfer-uncertain' | null = null;
  #interrupted: { threadId: string; turnId: string } | null = null;
  #replacementThread = false;
  #transferred = false;
  #connectionNotice: 'taken-over' | null = null;
  #recovery: { code: 'TASK_CHECKPOINT_INVALID'; candidateBaseline: string; candidatePath: string | null; previousTaskId: string | null } | null = null;
  get recovery() { return this.#recovery ? { ...this.#recovery } : null; }
  async #invalid() {
    const candidate = await this.opened.candidate({ action: 'read' });
    this.#recovery = { code: 'TASK_CHECKPOINT_INVALID', candidateBaseline: candidate.baseline, candidatePath: candidate.candidate?.path ?? null, previousTaskId: this.#state?.taskId ?? null };
  }

  #timer: ReturnType<typeof setInterval>;
  #observing = false;
  #snapshotValue: Awaited<ReturnType<ProjectPreview['capture']>> | null = null;
  #starting = false;
  #busy = false;
  #early: CodexHostEvent[] = [];
  #closed = false;
  #unsubscribe: () => void;
  #noProgress = 0;
  #messageMode: { original: string; resume: boolean; stopped: boolean } | null = null;
  #briefChange: { id: string; base: string; content: string; revision: string } | null = null;
  #discussion = '';
  #sceneSavePending = false;
  #parentOrigin = 'null';
  #pendingRun: Promise<void> = Promise.resolve();
  constructor(private opened: OpenedProjectVNext, private host: CodexHostAdapter,
    private preview: ProjectPreview, private checks: ProjectChecks, private delivery: ProjectDelivery) {
    this.#timer = setInterval(() => {
      if (this.#observing || this.#closed) return;
      this.#observing = true;
      this.#pendingRun = this.#pendingRun.then(() => this.#observe()).catch(error => this.#stop(error)).finally(() => { this.#observing = false; });
    }, 500);
    this.#timer.unref();
    this.#unsubscribe = host.subscribe(event => {
      if (this.#starting && this.#driver?.turnId === null) { this.#early.push(event); return; }
      this.#pendingRun = this.#pendingRun.then(() => this.#event(event)).catch(error => this.#stop(error));
    });
  }
  get ownsCandidate() { return !this.#closed && !this.#transferred && this.#state?.status === 'running' && !this.#operation && !this.#recovery; }
  get blocksCandidateWrites() { return this.ownsCandidate || this.#busy || this.#operation !== null; }
  async status() {
    if (!this.#closed && !this.#operation && !this.#recovery && this.#state?.status === 'waiting' && this.#state.reason === 'CANDIDATE_READY') {
      const latest = await this.delivery.status(this.opened);
      if (!latest.delivery || latest.delivery.stale) {
        this.#state.reason = 'USER_DECISION_REQUIRED';
        this.#state.pending = '交付证据已过期或不可用；不能作为当前成果。';
        await this.#save();
      }
    }
    return this.value;
  }
  get value() { return this.#state ? { ...structuredClone(this.#state), briefChange: this.#briefChange, discussion: this.#discussion, operation: this.#operation, replacementThread: this.#replacementThread, transferred: this.#transferred, connectionNotice: this.#connectionNotice } : null; }
  async load(transferred = false) {
    try {
      const ended = await endedTaskReason(this.opened.inspection.projectDirectory);
      if (ended) {
        await this.opened.programTransaction(() => cleanupEndedTask(this.opened.inspection.projectDirectory)).catch(() => undefined);
        return;
      }
      const checkpoint = checkpointSchema.parse(JSON.parse((await regular(this.#path(), 20_000_000)).toString()));
      if (checkpoint.projectId !== this.opened.inspection.manifest.projectId) throw new Error('任务项目身份不匹配');
      this.#state = { ...checkpoint, externalBaseline: null, status: checkpoint.status === 'terminated' ? 'terminated' : 'stopped', reason: checkpoint.status === 'terminated' ? checkpoint.reason : 'APP_RESTARTED', waitingReason: checkpoint.waitingReason ?? (checkpoint.status === 'waiting' ? checkpoint.reason : null), stage: 'read', divergence: '', preview: null, deliveryId: null };
      if (transferred) { this.#state.status = checkpoint.status; this.#state.reason = checkpoint.reason; this.#connectionNotice = 'taken-over'; }
      if (transferred && checkpoint.pendingMessage) {
        this.#state.status = checkpoint.pendingMessage.previousStatus === 'stopped' ? 'stopped' : 'waiting';
        this.#state.reason = this.#state.status === 'stopped' ? checkpoint.pendingMessage.previousReason : 'INSTRUCTION_CONFIRMATION_REQUIRED';
        this.#state.pendingMessage!.reply = '线程已转移，消息识别未完成。原文仍保留，请返回修改或仅作讨论；尚未追加创作指令。';
      }
      const candidate = await this.opened.candidate({ action: 'read' });
      if (checkpoint.status !== 'terminated' && checkpoint.candidateBaseline !== candidate.baseline) throw new Error('任务候选检查点不匹配');
      if (checkpoint.briefProposal?.status === 'saved') { const proposal = checkpoint.briefProposal; this.#briefChange = { id: proposal.id, base: proposal.base, content: proposal.content, revision: this.opened.inspection.videoBriefRevision }; }
      await this.#save();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && (await this.opened.candidate({ action: 'read' })).status === 'absent') return;
      await this.#invalid();
    }
    if (transferred && this.#state && !this.#recovery && this.#state.status !== 'terminated') {
      this.#operation = 'reconciling';
      try {
        await this.#bindThread(); this.#operation = null;
        if (this.#state.status === 'running') this.#pendingRun = this.#run('任务由另一工作台接管。依据检查点、当前候选和最新项目内容重新开始。').catch(error => this.#stop(error));
      } catch (error) {
        this.#operation = null; this.#state.status = 'stopped'; this.#state.reason = codexStopReason(error); await this.#save();
      }
    }
  }
  /** 交接屏障先撤销写权，再等待正在落盘的批次与中断回执；失败不能释放项目租约。 */
  async transfer() {
    if (this.#busy) throw new Error('任务操作尚未完成，线程连接结果待核对');
    if (this.#transferred) return;
    this.#operation = 'reconciling';
    const driver = this.#driver; this.#driver = null;
    if (driver?.turnId && this.#state?.threadPointer) this.#interrupted = { threadId: this.#state.threadPointer, turnId: driver.turnId };
    try {
      if (this.#interrupted) { await this.host.interruptTurn(this.#interrupted); this.#interrupted = null; }
      await this.#pendingRun;
      if (this.#interrupted) { await this.host.interruptTurn(this.#interrupted); this.#interrupted = null; }
      if (this.#state) {
        this.#state.threadPointer = null;
        await this.#save();
      }
      this.#transferred = true; this.#operation = null;
      await this.close();
    } catch (error) { this.#operation = 'transfer-uncertain'; throw error; }
  }
  #path() { return join(this.opened.inspection.projectDirectory, '.narracut', 'agent-task.json'); }
  async #save() {
    if (!this.#state || this.#state.status === 'terminated') return;
    const { externalBaseline: _externalBaseline, stage: _stage, divergence: _divergence, preview: _preview, deliveryId: _delivery, ...checkpoint } = this.#state;
    const bytes = JSON.stringify(checkpointSchema.parse(checkpoint));
    await this.opened.programTransaction(() => this.#writeCheckpoint(bytes));
  }
  async #writeCheckpoint(bytes: string, validate?: () => Promise<void>) {
      const parent = join(this.opened.inspection.projectDirectory, '.narracut');
      const identity = await directory(parent), temporary = join(parent, `task-${randomUUID()}.tmp`);
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        if (identity !== await directory(parent)) throw new Error('任务目录已替换');
        await validate?.();
        await this.opened.assertWritable();
        await rename(temporary, this.#path());
        await syncDirectory(parent).catch(() => undefined);
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }
  async start(instruction: string, parentOrigin = 'null') {
    if (this.#closed || this.#transferred) throw new Error('任务已转移到另一线程');
    if (this.#recovery) throw new Error('TASK_CHECKPOINT_INVALID：请明确用新任务接管候选。');
    if (this.#busy || this.#state && this.#state.status !== 'terminated') throw new Error('已有创作任务；追加要求与接管尚未接入，草稿已保留。');
    if (!instruction.trim() || instruction.length > 4000) throw new Error('请填写 1–4000 字的明确创作目标。');
    this.#parentOrigin = parentOrigin;
    this.#busy = true;
    try {
      const candidate = await this.opened.candidate({ action: 'read' });
      if (candidate.status !== 'absent') throw new Error('已有候选；本次不会替换或接管，草稿已保留。');
      this.#state = { taskId: randomUUID(), projectId: this.opened.inspection.manifest.projectId, instruction,
        externalBaseline: null, status: 'running', reason: null, threadPointer: null, lastSafeStage: null, candidateBaseline: null,
        inputIdentity: null, pending: null, waitingReason: null, suggestions: [], briefProposal: null, pendingMessage: null, toolApproval: null, stage: 'read', divergence: '', preview: null, deliveryId: null };
      await this.#save();
      const created = await this.opened.candidate({ action: 'create' });
      this.#state.candidateBaseline = created.baseline;
      await this.#save();
      this.#pendingRun = this.#run().catch(error => this.#stop(error));
      return this.value;
    } catch (error) {
      if (this.#state) await this.#stop(error);
      throw error;
    } finally { this.#busy = false; }
  }
  /** 接管只替换单一任务检查点；候选文件字节保持不变。 */
  async takeover(instruction: string, baseline: string, parentOrigin = 'null', requestId?: string) {
    if (this.#closed || this.#transferred) throw new Error('任务已转移到另一线程');
    if (requestId && this.#state?.taskId === requestId && this.#state.instruction === instruction) return this.value;
    if (requestId) z.string().uuid().parse(requestId);
    if (this.#busy || this.#operation || this.ownsCandidate || !instruction?.trim() || instruction.length > 4000) throw new Error('请停止活动任务并填写 1–4000 字的新目标。');
    this.#busy = true;
    const previous = this.#state;
    try {
      await this.#pendingRun;
      await this.opened.programTransaction(async manager => {
        let candidate = await manager({ action: 'read' });
        if (candidate.baseline !== baseline) throw new Error('候选再次变化，请核对候选对象后再次明确提交。');
        if (candidate.status === 'external-change') candidate = await manager({ action: 'adopt', baseline, confirmed: true });
        if (candidate.status !== 'saved') throw new Error(candidate.error?.message ?? '请先在候选区域处理完整性问题。');
        const checkpoint: CreationCheckpoint = { taskId: requestId ?? randomUUID(), projectId: this.opened.inspection.manifest.projectId, instruction,
          status: 'running', reason: null, threadPointer: null, lastSafeStage: null, candidateBaseline: candidate.baseline,
          inputIdentity: null, pending: null, waitingReason: null, suggestions: [], briefProposal: null, pendingMessage: null, toolApproval: null };
        await this.#writeCheckpoint(JSON.stringify(checkpoint), async () => {
          if ((await manager({ action: 'read' })).baseline !== candidate.baseline) throw new Error('候选再次变化，请核对候选对象后再次明确提交。');
        });
        if (previous) { previous.status = 'terminated'; previous.reason = 'TASK_SUPERSEDED'; }
        this.#state = { ...checkpoint, externalBaseline: null, stage: 'read', divergence: '', preview: null, deliveryId: null };
      });
      this.#driver = null; this.checks.invalidate(); this.delivery.invalidate();
      this.#recovery = null; this.#parentOrigin = parentOrigin; this.#messageMode = null; this.#briefChange = null; this.#discussion = ''; this.#replacementThread = false;
      this.#pendingRun = this.#run('用户以新目标明确接管现有候选。重新读取并检查最新内容。').catch(error => this.#stop(error));
      return this.value;
    } catch (error) { await this.#invalid(); throw error; }
    finally { this.#busy = false; }
  }
  async #validateCheckpoint() {
    try {
      const checkpoint = checkpointSchema.parse(JSON.parse((await regular(this.#path(), 20_000_000)).toString()));
      const candidate = await this.opened.candidate({ action: 'read' });
      const { externalBaseline, stage, divergence, preview, deliveryId, ...current } = this.#state!;
      if (JSON.stringify(checkpoint) !== JSON.stringify(checkpointSchema.parse(current)) || checkpoint.projectId !== this.opened.inspection.manifest.projectId || checkpoint.candidateBaseline !== candidate.baseline) throw new Error('检查点不一致');
    } catch {
      await this.#invalid();
      throw new Error('TASK_CHECKPOINT_INVALID：任务检查点缺失、损坏或与候选不一致，无法继续原任务。候选已保留；这不代表候选损坏。');
    }
  }
  async #stopByUser() {
    const state = this.#state!;
    if (state.status === 'stopped' && !this.#operation) return this.value;
    if (!this.#operation && state.status === 'waiting') state.waitingReason = state.reason;
    this.#operation = 'stopping';
    const driver = this.#driver; this.#driver = null; this.#messageMode = null;
    if (driver?.turnId && state.threadPointer) this.#interrupted = { threadId: state.threadPointer, turnId: driver.turnId };
    this.checks.invalidate(); this.delivery.invalidate();
    try {
      if (this.#interrupted) { await this.host.interruptTurn(this.#interrupted); this.#interrupted = null; }
      await this.#pendingRun;
      if (this.#interrupted) { await this.host.interruptTurn(this.#interrupted); this.#interrupted = null; }
      const candidate = await this.opened.candidate({ action: 'read' });
      if (state.waitingReason === 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED') { state.candidateBaseline = candidate.baseline; state.externalBaseline = candidate.baseline; }
      else if (candidate.baseline !== state.candidateBaseline) await this.#invalid();
      state.status = 'stopped'; state.reason = 'USER_STOPPED';
      await this.#save(); this.#operation = null;
      return this.value;
    } catch (error) {
      this.#operation = 'stop-uncertain';
      throw new Error(`停止结果待核对：${(error as Error).message}`);
    }
  }
  async #observe() {
    if (!this.ownsCandidate || this.#messageMode) return;
    const snapshot = await this.#snapshot();
    if (!this.ownsCandidate || this.#messageMode) return;
    if (snapshot.baseline !== this.#state!.candidateBaseline) throw Object.assign(new Error(externalMessage), { code: 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED' });
    if (this.#state!.inputIdentity && snapshot.signature !== this.#state!.inputIdentity) await this.#catchUp(snapshot);
  }
  /** 仅成功持久化后的项目事件核对待办；等待期间不启动模型、不轮询输入。 */
  projectSaved() {
    this.#sceneSavePending = true;
    this.#pendingRun = this.#pendingRun.then(async () => {
      const state = this.#state;
      if (state?.status !== 'waiting' || state.reason !== 'SCENE_CHANGE_REQUIRED') return;
      this.#sceneSavePending = false;
      const snapshot = await this.#snapshot();
      if (state.status !== 'waiting' || state.reason !== 'SCENE_CHANGE_REQUIRED') return;
      const next = state.suggestions.map(item => evaluateSuggestion(item, snapshot.input));
      if (JSON.stringify(next) === JSON.stringify(state.suggestions)) return;
      state.suggestions = next;
      const remaining = next.filter(item => item.required && !item.satisfied);
      state.pending = remaining.length ? `还有 ${remaining.length} 项必要修改未满足。${remaining.some(item => item.missing) ? '目标 Scene 已删除，请继续任务重新判断目标。' : ''}` : '必要修改已保存，正在继续同一任务';
      await this.#save();
      if (!remaining.length && state.status === 'waiting' && state.reason === 'SCENE_CHANGE_REQUIRED') await this.#catchUp(snapshot);
    }).catch(error => this.#stop(error));
  }
  async #fresh() {
    this.#assert();
    const snapshot = await this.#snapshot();
    if (snapshot.baseline !== this.#state!.candidateBaseline) throw Object.assign(new Error(externalMessage), { code: 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED' });
    if (snapshot.signature !== this.#state!.inputIdentity) throw new InputsChanged('项目内容已更新');
    return snapshot;
  }
  async #catchUp(snapshot: Awaited<ReturnType<ProjectPreview['capture']>>) {
    const driver = this.#driver; this.#driver = null;
    if (driver?.turnId && this.#state?.threadPointer) await this.host.interruptTurn({ threadId: this.#state.threadPointer, turnId: driver.turnId }).catch(() => undefined);
    const previous = this.#snapshotValue;
    const changes: string[] = [];
    if (!previous || previous.brief !== snapshot.brief) changes.push('Brief');
    if (!previous || JSON.stringify(previous.input.scenes) !== JSON.stringify(snapshot.input.scenes)) changes.push('Scene');
    if (!previous || JSON.stringify(previous.input.assets) !== JSON.stringify(snapshot.input.assets) || JSON.stringify([...previous.media.keys()]) !== JSON.stringify([...snapshot.media.keys()])) changes.push('Asset / Speech');
    const state = this.#state!;
    if (state.status === 'stopped' || state.status === 'terminated' || this.#closed) return;
    state.inputIdentity = snapshot.signature;
    state.status = 'running'; state.reason = null; state.stage = 'read'; state.preview = null; state.deliveryId = null;
    state.pending = `${changes.join('、') || '项目输入'} 已更新，正在重新检查`;
    this.#noProgress = 0;
    this.preview.invalidate(); this.delivery.invalidate();
    this.checks.invalidate();
    await this.#run('旧身份下的结果均已作废。请依据最新项目内容重新检查并创作。');
  }
  async continueExternal(baseline: string) {
    if (this.#closed || this.#transferred) throw new Error('任务已转移到另一线程');
    if (this.#busy || this.#operation || this.#recovery || !this.#state || !['waiting', 'stopped'].includes(this.#state.status) || (this.#state.waitingReason ?? this.#state.reason) !== 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED') throw new Error('当前任务不在等待外部候选确认。');
    this.#busy = true;
    try {
      await this.#pendingRun;
      if (this.#state.status === 'stopped') await this.#validateCheckpoint();
      const candidate = await this.opened.candidate({ action: 'read' });
      if (baseline !== candidate.baseline) { this.#state.externalBaseline = candidate.baseline; this.#state.pending = `候选再次变化。${externalMessage}`; await this.#save(); return this.value; }
      const adopted = await this.opened.candidate({ action: 'adopt', baseline, confirmed: true });
      this.#state.candidateBaseline = adopted.baseline; this.#state.externalBaseline = null;
      if (this.#state.status === 'stopped') await this.#bindThread();
      this.#state.waitingReason = null;
      this.#state.status = 'running'; this.#state.reason = null; this.#state.preview = null; this.#state.deliveryId = null; this.#state.stage = 'read';
      this.#state.pending = '正在基于外部候选重新检查并创作'; this.#noProgress = 0;
      await this.#save();
      this.#pendingRun = this.#run().catch(error => this.#stop(error));
      return this.value;
    } catch (error) { if (this.#recovery) throw error; this.#state!.status = 'stopped'; this.#state!.reason = codexStopReason(error); this.#state!.pending = externalMessage; await this.#save(); throw error; }
    finally { this.#busy = false; }
  }
  async #interrupt() {
    const driver = this.#driver; this.#driver = null;
    if (driver?.turnId && this.#state?.threadPointer) await this.host.interruptTurn({ threadId: this.#state.threadPointer, turnId: driver.turnId });
  }
  async respond(input: { action: string; id?: string; instruction?: string }) {
    if (this.#closed || this.#transferred) throw new Error('任务已转移到另一线程');
    if (this.#busy || !this.#state || this.#state.status === 'terminated' || this.#operation && input.action !== 'stop' || this.#recovery) throw new Error('当前没有可操作任务或操作尚未完成');
    this.#busy = true;
    try {
      if (input.action === 'stop') return await this.#stopByUser();
      await this.#pendingRun;
      const state = this.#state;
      if (state.status === 'stopped') await this.#validateCheckpoint();
      if (input.action === 'approve-tool' || input.action === 'reject-tool') {
        if (!state.toolApproval || state.toolApproval.approvalId !== input.id) throw new Error('工具审批已过期');
        if (!this.#driver || state.toolApproval.threadId !== state.threadPointer) {
          state.toolApproval = null; state.waitingReason = null;
          state.pending = '原工具请求已失效；继续时会重新判断并按需申请批准。';
          await this.#save();
          if (state.status !== 'stopped') {
            if (input.action === 'approve-tool') await this.#resume('原工具请求已失效，丢弃旧工具调用；重新判断并按需申请批准。');
            else { state.status = 'stopped'; state.reason = 'CODEX_INTERRUPTED'; await this.#save(); }
          }
          return this.value;
        }
        if (!this.host.resolveApproval) throw new Error('当前宿主不支持工具审批回执');
        await this.host.resolveApproval(input.id!, input.action === 'approve-tool');
      } else if (input.action === 'message') {
        if (state.toolApproval) throw new Error('请先处理工具审批；普通消息不能代替批准。');
        const original = input.instruction;
        if (!original?.trim() || original.length > 4000 || state.pendingMessage) throw new Error('请先处理拟保存的原文片段，或填写 1–4000 字消息');
        const resume = state.status === 'running';
        await this.#interrupt();
        state.pendingMessage = { id: randomUUID(), original, fragments: [], reply: '正在识别本次消息；尚未追加创作指令。', previousStatus: state.status as 'running' | 'waiting' | 'stopped', previousReason: state.reason };
        this.#messageMode = { original, resume, stopped: state.status === 'stopped' };
        state.status = 'running';
        await this.#save();
        this.#pendingRun = this.#classify(original).catch(error => this.#stop(error));
      } else if (['confirm-message', 'discuss-message', 'edit-message'].includes(input.action)) {
        if (!state.pendingMessage || state.pendingMessage.id !== input.id) throw new Error('消息确认已过期');
        const previous = state.pendingMessage;
        if (this.#messageMode) {
          if (input.action === 'confirm-message') throw new Error('正在识别消息，请等待拟保存片段');
          const stopped = this.#messageMode.stopped; this.#messageMode = null; await this.#interrupt();
          state.status = stopped ? 'stopped' : 'waiting';
        }
        if (input.action === 'confirm-message') {
          if (!state.pendingMessage.fragments.length) throw new Error('没有可追加的明确原文片段，请返回修改');
          this.#append(state.pendingMessage.fragments.join('\n'));
        }
        state.pendingMessage = null;
        await this.#save();
        if (input.action === 'confirm-message' && state.status !== 'stopped') await this.#resume();
        else if (input.action !== 'confirm-message') {
          if (state.status !== 'stopped') { state.status = previous.previousStatus; state.reason = previous.previousReason; }
          if (state.status === 'running') await this.#resume();
          else { await this.#save(); if (this.#sceneSavePending) this.projectSaved(); }
        }
      } else if (input.action === 'ack-brief') {
        if (!state.briefProposal || state.briefProposal.id !== input.id || state.briefProposal.status !== 'saved') throw new Error('Brief 保存回执已过期');
        if (state.status === 'waiting' && state.reason === 'BRIEF_SAVED') await this.#resume('Brief 已保存并形成完整撤销项，请继续候选创作。');
      } else if (['accept-brief', 'reject-brief'].includes(input.action)) {
        const proposal = state.briefProposal;
        if (!proposal || proposal.id !== input.id || !['review', 'stale'].includes(proposal.status)) throw new Error('Brief 提案已过期或已处理');
        if (input.action === 'reject-brief') {
          proposal.status = 'rejected'; state.pending = '已保留原 Brief。可按当前创作指令继续。';
          state.reason = 'BRIEF_REJECTED'; await this.#save();
        } else {
          if (proposal.status === 'stale') throw new Error('Brief 已变化，请重新生成提案');
          const saved = await this.opened.saveVideoBrief(proposal.content, proposal.baseline);
          if (saved.status === 'conflict') {
            proposal.status = 'stale'; state.pending = 'Brief 已变化，原提案不能覆盖最新内容。请重新生成提案。'; await this.#save();
          } else {
            this.opened.inspection = saved.inspection;
            this.#briefChange = { id: proposal.id, base: proposal.base, content: proposal.content, revision: saved.inspection.videoBriefRevision };
            proposal.status = 'saved'; await this.#save();
            if (state.status !== 'stopped') { state.status = 'waiting'; state.reason = 'BRIEF_SAVED'; state.pending = 'Brief 已保存，正在同步完整撤销项。'; await this.#save(); }
          }
        }
      } else if (input.action === 'continue' || input.action === 'regenerate-brief') {
        if (state.status === 'running' || state.pendingMessage || state.reason === 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED' || state.waitingReason === 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED' || state.waitingReason === 'TOOL_APPROVAL_REQUIRED' || state.reason === 'TOOL_APPROVAL_REQUIRED') throw new Error('请先处理当前待办');
        if (input.action === 'continue' && state.briefProposal?.status === 'review') throw new Error('请先接受或拒绝 Brief 提案');
        if (input.action === 'regenerate-brief') state.briefProposal = null;
        await this.#resume(input.action === 'regenerate-brief' ? '请依据最新 Brief 重新生成完整提案，等待用户审核。' : '用户明确选择按当前创作指令继续。已拒绝的 Brief 提案不得再次自动保存。');
      } else throw new Error('未知任务操作');
      return this.value;
    } finally { this.#busy = false; }
  }
  #append(fragment: string) {
    const instruction = this.#state!.instruction + '\n\n' + fragment;
    if (instruction.length > 4000) throw new Error('累计创作指令超过 4000 字，原文片段已保留');
    this.#state!.instruction = instruction;
  }
  async #resume(feedback = '') {
    const state = this.#state!;
    if (state.status === 'stopped') await this.#validateCheckpoint();
    if ((state.waitingReason ?? state.reason) === 'SCENE_CHANGE_REQUIRED') {
      const snapshot = await this.#snapshot();
      state.suggestions = state.suggestions.map(item => evaluateSuggestion(item, snapshot.input));
      if (state.suggestions.some(item => item.required && !item.satisfied && !item.missing)) {
        state.status = 'waiting'; state.reason = 'SCENE_CHANGE_REQUIRED'; state.waitingReason = 'SCENE_CHANGE_REQUIRED';
        state.pending = '必要 Scene 条件尚未满足。完成并保存所等待修改后，同一任务会继续。';
        await this.#save(); return;
      }
    }
    this.#operation = 'reconciling';
    try { if (state.status === 'stopped') await this.#bindThread(); }
    catch (error) {
      this.#operation = null; state.status = 'stopped'; state.reason = codexStopReason(error);
      state.pending = null; await this.#save(); return;
    }
    this.#operation = null;
    state.status = 'running'; state.reason = null; state.waitingReason = null; state.pending = null; state.stage = 'read';
    state.inputIdentity = null; state.preview = null; state.deliveryId = null; this.#noProgress = 0;
    await this.#save();
    this.#pendingRun = this.#run(feedback).catch(error => this.#stop(error));
  }
  async #bindThread() {
    const state = this.#state!, projectDirectory = this.opened.inspection.projectDirectory;
    let replacement = false;
    let threadId: string;
    if (state.threadPointer) {
      try { threadId = (await this.host.resumeThread({ threadId: state.threadPointer, projectDirectory })).threadId; }
      catch (error) {
        if (codexStopReason(error) !== 'CODEX_THREAD_UNAVAILABLE') throw error;
        threadId = (await this.host.createThread({ projectDirectory, purpose: 'creation' })).threadId;
        replacement = true;
      }
    } else threadId = (await this.host.createThread({ projectDirectory, purpose: 'creation' })).threadId;
    if (this.#closed) throw new Error('当前驱动已失去写权。');
    const previous = state.threadPointer;
    state.threadPointer = threadId;
    try { await this.#save(); } catch (error) { state.threadPointer = previous; throw error; }
    this.#replacementThread = replacement;
  }
  async #classify(original: string) {
    this.#assert();
    const state = this.#state!, snapshot = await this.#snapshot();
    state.inputIdentity = snapshot.signature;
    if (!state.threadPointer) state.threadPointer = (await this.host.createThread({ projectDirectory: this.opened.inspection.projectDirectory, purpose: 'creation' })).threadId;
    const driver: Driver = { token: randomUUID(), turnId: null, signature: snapshot.signature };
    this.#driver = driver; this.#starting = true;
    try {
      const turn = await this.host.startTurn({ threadId: state.threadPointer, projectDirectory: this.opened.inspection.projectDirectory, verificationToken: driver.token, outputSchema: z.toJSONSchema(messageDecision), prompt: [
        '只分类并回答当前用户消息，不创作、不写文件、不执行工具。creation 仅用于整条消息都是明确创作命令；问题、状态询问、审批答复和闲聊是 discussion。混合消息 mixed；不确定 ambiguous。',
        'fragments 必须是按原顺序提取的精确原文连续片段，不得改字或扩大授权。creation 返回整条原文；discussion 返回空数组。mixed/ambiguous 拟保存部分先等待用户确认。reply 用中文回答问题或说明待确认事项。',
        'divergence 明确说明 Brief 内容、本次用户要求及采用方向；没有实质分歧则空字符串。',
        `当前指令：${JSON.stringify(state.instruction)}；任务原因：${state.reason}；Brief：${JSON.stringify(snapshot.input.videoBrief)}`,
        `本次消息：${JSON.stringify(original)}`,
        `verificationToken 必须返回：${driver.token}`,
      ].join('\n') });
      if (!this.ownsCandidate || this.#closed) { this.#interrupted = { threadId: state.threadPointer!, turnId: turn.turnId }; await this.host.interruptTurn(this.#interrupted); this.#interrupted = null; this.#assert(); }
      driver.turnId = turn.turnId;
    } finally {
      this.#starting = false;
      for (const event of this.#early.splice(0)) this.#pendingRun = this.#pendingRun.then(() => this.#event(event)).catch(error => this.#stop(error));
    }
  }
  async #set(stage: CreationState['stage']) {
    this.#assert(); this.#state!.stage = stage;
    await this.#save();
  }
  #assert() { if (this.#closed || !this.ownsCandidate) throw new Error('当前驱动已失去写权。'); }
  async #snapshot() {
    const candidate = await this.opened.candidate({ action: 'read' });
    if (candidate.status === 'external-change') throw Object.assign(new Error('候选已被外部修改'), { code: 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED' });
    return this.preview.capture(this.opened, 'candidate', true);
  }
  async #run(feedback = '', images: string[] = []) {
    this.#assert();
    const state = this.#state!;
    const snapshot = await this.#snapshot();
    if (state.candidateBaseline !== snapshot.baseline) return this.#wait('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', externalMessage);
    if (state.inputIdentity && snapshot.signature !== state.inputIdentity && feedback) return this.#catchUp(snapshot);
    state.inputIdentity = snapshot.signature; this.#snapshotValue = snapshot;
    if (!state.threadPointer) {
      state.threadPointer = (await this.host.createThread({ projectDirectory: this.opened.inspection.projectDirectory, purpose: 'creation' })).threadId;
      this.#assert();
    }
    state.lastSafeStage = state.stage === 'read' ? 'read' : state.lastSafeStage;
    await this.#save();
    this.#assert();
    const driver: Driver = { token: randomUUID(), turnId: null, signature: snapshot.signature };
    this.#driver = driver; this.#starting = true;
    try {
      const turn = await this.host.startTurn({ threadId: state.threadPointer, projectDirectory: this.opened.inspection.projectDirectory,
        verificationToken: driver.token, outputSchema: z.toJSONSchema(answerSchema), images,
        prompt: [
          '你是 Narracut 专用创作 Agent。只读项目，不执行项目代码，不写文件、不访问网络。通过结构化结果请求应用原子修改唯一候选。',
          '成片表现优先级：当前创作指令 > Video Brief > 既有 Render Program。Scene、Narration、Asset、Speech、时间窗、总时长、确定性和安全硬约束不可覆盖。禁止自动接受或最终 Render。',
          '每批最多 12 个文件，每文件最多 256000 字；只修改候选相对路径。先读当前候选源码和项目内容；apply 后应用会检查并将诊断交回，允许修复。不要复制 Scene 内容作为第二权威。',
          '缺少离线依赖时返回 action=dependencies，dependencies 与 packages 为空数组可按既有精确锁图补齐离线库；新增依赖必须提供公共 npm 精确版本和完整性摘要，应用只从 canonical registry 下载。',
          'action=deliver 请求构建 Preview 并采集代表帧。收到图像后逐帧检查，reviews 必须引用所给帧号与 digest，不能仅凭文本声称检查。无需修改时 changes=[]。必须用户处理时 action=wait 并明确原因。',
          '整理 Brief 使用 action=brief 并提供 brief={content:完整 Markdown,purpose:修改目的}。没有明确要求写 Brief 时应用只生成审核提案；不可用候选文件替代 video.md。',
          'Scene suggestions 必须使用真实稳定 Scene UUID；required=true 必须提供 condition：narration 字数范围/anyOf 可接受词组、asset 可用素材（anyOf 空允许任何可用替代素材）或 deleted。description 用中文解释续跑目标。不可证明的语义目标请求用户判断，不伪造条件。可选建议 required=false。',
          '实质 Brief 分歧填写 divergence，并说明本次遵循的用户原文；否则空字符串。summary、warnings、suggestions 用中文。',
          '本 Turn 仅以应用提供的检查点、当前候选和最新输入为依据。丢弃旧 Turn 未提交修改、工具调用及中间判断，不从对话恢复它们。检查与 Preview 证据缺失或过期时必须重跑。',
        `最后完成的安全阶段：${state.lastSafeStage ?? '尚无'}（不代表检查证据仍有效）。`,
        `当前创作指令（精确原文）：${JSON.stringify(state.instruction)}`,
          `最新 Runtime 输入：${JSON.stringify(snapshot.input)}`,
          `候选：${snapshot.candidate.candidate?.path}；完整身份：${snapshot.signature}`,
          `verificationToken 必须原样返回：${driver.token}`,
          feedback,
        ].join('\n') });
      if (!this.ownsCandidate || this.#closed) { this.#interrupted = { threadId: state.threadPointer!, turnId: turn.turnId }; await this.host.interruptTurn(this.#interrupted); this.#interrupted = null; this.#assert(); }
      driver.turnId = turn.turnId;
    } finally {
      this.#starting = false;
      for (const event of this.#early.splice(0)) this.#pendingRun = this.#pendingRun.then(() => this.#event(event)).catch(error => this.#stop(error));
    }
  }
  async #event(event: CodexHostEvent) {
    if (this.#closed) return;
    if (event.type === 'approval-resolved') {
      const state = this.#state, approval = state?.toolApproval;
      if (!state || !approval || approval.approvalId !== event.approvalId || approval.threadId !== event.threadId || approval.turnId !== event.turnId) return;
      state.toolApproval = null;
      if (state.waitingReason === 'TOOL_APPROVAL_REQUIRED') state.waitingReason = null;
      if (state.status === 'stopped' || this.#operation) { await this.#save(); return; }
      if (state.status !== 'waiting' || state.reason !== 'TOOL_APPROVAL_REQUIRED') return;
      if (!event.approved) throw new Error('CODEX_INTERRUPTED');
      else { state.status = 'running'; state.reason = null; }
      state.pending = null; await this.#save(); return;
    }
    if (event.type === 'host-unavailable' && this.#state && ['running', 'waiting'].includes(this.#state.status)) throw new Error('CODEX_UNAVAILABLE');
    if (!this.#operation && this.#state?.status === 'waiting' && event.type !== 'host-unavailable' && event.threadId === this.#state.threadPointer && this.#driver && (!event.turnId || event.turnId === this.#driver.turnId)) {
      if (event.type === 'thread-unavailable') throw new Error('CODEX_THREAD_UNAVAILABLE');
      if (event.type === 'turn-completed') throw new Error(codexStopReason({ message: event.error }));
    }
    if (!this.ownsCandidate || this.#closed || event.type === 'host-unavailable') return;
    if (event.threadId !== this.#state!.threadPointer) return;
    const driver = this.#driver;
    if (event.type === 'approval-required') {
      if (!driver || driver.turnId !== event.turnId) return;
      this.#state!.toolApproval = { approvalId: event.approvalId, threadId: event.threadId, turnId: event.turnId, summary: event.summary.slice(0, 4000) };
      this.#state!.status = 'waiting'; this.#state!.reason = 'TOOL_APPROVAL_REQUIRED'; this.#state!.waitingReason = 'TOOL_APPROVAL_REQUIRED'; this.#state!.pending = event.summary.slice(0, 4000);
      await this.#save(); return;
    }
    if (event.type === 'thread-unavailable') {
      if (event.turnId && event.turnId !== driver?.turnId) return;
      throw new Error('CODEX_THREAD_UNAVAILABLE');
    }
    if (!driver || event.turnId !== driver.turnId) return;
    if (event.status !== 'completed' || !event.output) throw new Error(codexStopReason({ message: event.error }));
    this.#driver = null;
    if (this.#messageMode) {
      const mode = this.#messageMode;
      const answer = messageDecision.parse(JSON.parse(event.output));
      if (answer.verificationToken !== driver.token) throw new Error('消息分类身份不匹配');
      let cursor = 0;
      for (const fragment of answer.fragments) {
        const offset = mode.original.indexOf(fragment, cursor);
        if (offset < 0) throw new Error('拟保存片段不是按顺序提取的精确用户原文');
        cursor = offset + fragment.length;
      }
      this.#messageMode = null;
      this.#discussion = answer.reply; this.#state!.divergence = answer.divergence;
      if (answer.kind === 'creation') {
        this.#append(mode.original); this.#state!.pendingMessage = null;
        if (mode.stopped) { this.#state!.status = 'stopped'; await this.#save(); return; }
        return this.#resume();
      }
      if (answer.kind === 'discussion') {
        this.#state!.pendingMessage = null;
        if (mode.resume) return this.#resume();
        if (mode.stopped) { this.#state!.status = 'stopped'; await this.#save(); return; }
        await this.#wait(this.#state!.reason ?? 'USER_DECISION_REQUIRED', answer.reply);
        if (this.#sceneSavePending) this.projectSaved();
        return;
      }
      this.#state!.pendingMessage!.fragments = answer.fragments;
      this.#state!.pendingMessage!.reply = answer.reply;
      if (mode.stopped) { this.#state!.status = 'stopped'; this.#state!.pending = '确认后保存原文，仍需明确继续任务。'; await this.#save(); return; }
      return this.#wait('INSTRUCTION_CONFIRMATION_REQUIRED', '请确认拟保存的精确原文片段；确认前不会执行创作部分。');
    }
    const answer = answerSchema.parse(JSON.parse(event.output));
    if (answer.verificationToken !== driver.token) throw new Error('创作结果驱动身份不匹配');
    const snapshot = await this.#snapshot();
    if (snapshot.baseline !== this.#state!.candidateBaseline) return this.#wait('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', externalMessage);
    if (snapshot.signature !== driver.signature) throw new InputsChanged('项目输入已变化');
    this.#state!.divergence = answer.divergence;
    this.#state!.suggestions = answer.suggestions.map(item => {
      if (item.required && !item.condition) throw new Error('必要 Scene 建议必须说明可核对的目标条件');
      return evaluateSuggestion({ ...item, satisfied: false, missing: false }, snapshot.input);
    });
    if (this.#state!.suggestions.some(item => item.required && !item.satisfied)) return this.#wait('SCENE_CHANGE_REQUIRED', answer.summary);
    if (answer.action === 'wait' && answer.suggestions.length) {
      if (++this.#noProgress >= 3) throw new Error('NO_PROGRESS');
      return this.#run('建议均为可选或已满足，不应阻断任务。请继续候选创作或交付；保留可选建议供用户判断。');
    }
    if (answer.action === 'wait') return this.#wait(this.#state!.suggestions.some(item => item.required && !item.satisfied) ? 'SCENE_CHANGE_REQUIRED' : 'USER_DECISION_REQUIRED', answer.summary);
    if (answer.action === 'brief') {
      if (!answer.brief) throw new Error('Brief 提案缺少完整结果');
      const proposal = { id: randomUUID(), base: snapshot.input.videoBrief, baseline: snapshot.brief, ...answer.brief, status: 'review' as const };
      this.#state!.briefProposal = proposal;
      if (!authorizesBrief(this.#state!.instruction)) return this.#wait('BRIEF_REVIEW_REQUIRED', answer.brief.purpose);
      const saved = await this.opened.saveVideoBrief(proposal.content, proposal.baseline, () => this.#assert());
      if (saved.status === 'conflict') {
        this.#state!.briefProposal.status = 'stale';
        return this.#wait('BRIEF_REVIEW_REQUIRED', 'Brief 已变化，请重新生成提案。');
      }
      this.opened.inspection = saved.inspection;
      this.#state!.briefProposal.status = 'saved';
      this.#briefChange = { id: proposal.id, base: proposal.base, content: proposal.content, revision: saved.inspection.videoBriefRevision };
      this.#state!.inputIdentity = null;
      return this.#wait('BRIEF_SAVED', '已按明确指令保存 Brief，正在同步完整撤销项。');
    }
    if (answer.action === 'apply' || answer.action === 'dependencies') {
      if (answer.action === 'apply' && !answer.changes.length) { if (++this.#noProgress >= 3) throw new Error('NO_PROGRESS'); return this.#run('未产生持久成果，请提交修改或请求交付。'); }
      this.#state!.preview = null; this.#state!.deliveryId = null;
      this.delivery.clear();
      await this.#set('modify');
      const applied = await this.opened.programTransaction(async manager => {
        const view = { ...this.opened, candidate: manager, readPreviewSource: manager.previewSource };
        return manager(answer.action === 'dependencies' ? { action: 'dependencies', baseline: snapshot.baseline, dependencies: Object.fromEntries(answer.dependencies.map(item => [item.name, item.version])), packages: answer.packages } : { action: 'apply', baseline: snapshot.baseline, changes: answer.changes }, async () => {
          this.#assert();
          if ((await this.preview.capture(view, 'candidate', true)).signature !== driver.signature) throw new Error('项目输入已变化；本批未提交。');
          this.#assert();
        });
      });
      this.#state!.candidateBaseline = applied.baseline; this.#state!.lastSafeStage = 'modify';
      this.#noProgress = applied.candidate?.identity === snapshot.candidate.candidate?.identity ? this.#noProgress + 1 : 0;
      if (this.#noProgress >= 3) throw new Error('NO_PROGRESS');
      this.#state!.inputIdentity = (await this.#snapshot()).signature;
      await this.#set('check');
      await this.checks.start(this.opened);
      const checked = await this.#poll(async () => this.checks.status(this.opened), value => value.batches.at(-1)?.status !== 'running');
      this.#state!.lastSafeStage = 'check';
      return this.#run(`候选检查：${JSON.stringify(checked)}。修复问题或请求 deliver。`);
    }
    if (this.#state!.stage !== 'frames') {
      await this.#set('check');
      await this.checks.start(this.opened);
      const checked = await this.#poll(() => this.checks.status(this.opened), value => value.batches.at(-1)?.status !== 'running');
      if (checked.batches.at(-1)?.stale || checked.gates.find(gate => gate.operation === 'preview')?.status !== 'available') {
        if (++this.#noProgress >= 3) throw new Error('NO_PROGRESS');
        return this.#run(`检查尚未通过，请修复或明确等待用户：${JSON.stringify(checked)}`);
      }
      this.#state!.lastSafeStage = 'check';
    }
    await this.#fresh();
    await this.#set('preview');
    if (!this.#state!.preview) {
      const descriptor = await this.preview.build(this.opened, 'candidate', this.#parentOrigin);
      try { await this.#fresh(); } catch (error) { this.preview.release(descriptor.instanceId); throw error; }
      this.#state!.preview = descriptor; this.#state!.lastSafeStage = 'preview';
      await this.delivery.operate(this.opened, { action: 'prepare', instanceId: descriptor.instanceId });
    }
    await this.#set('frames');
    const deliveryState = await this.#poll(() => this.delivery.status(this.opened), value => !value.collecting);
    const current = deliveryState.delivery;
    if (!current || current.stale) throw new Error('交付证据已过期');
    this.#state!.deliveryId = current.id;
    if (answer.reviews.length) await this.delivery.operate(this.opened, { action: 'review', deliveryId: current.id, reviews: answer.reviews });
    const latest = (await this.delivery.status(this.opened)).delivery!;
    const remaining = latest.frames.filter(frame => !frame.observation);
    if (remaining.some(frame => frame.status !== 'captured')) return this.#wait('USER_DECISION_REQUIRED', '代表帧采集失败，请在候选交付区检查并重试。');
    if (remaining.length) {
      const images: string[] = [], refs: unknown[] = [];
      for (const frame of remaining.slice(0, 12)) {
        const result = await this.delivery.operate(this.opened, { action: 'image', deliveryId: current.id, frame: frame.frame }) as { image: string; digest: string };
        images.push(`data:image/png;base64,${result.image}`); refs.push({ frame: frame.frame, digest: result.digest });
      }
      if (!answer.reviews.length && ++this.#noProgress >= 3) throw new Error('NO_PROGRESS');
      if (answer.reviews.length) this.#noProgress = 0;
      return this.#run(`检查附带图像，按顺序对应：${JSON.stringify(refs)}。返回 deliver 和 reviews。`, images);
    }
    const evidence = await this.delivery.status(this.opened);
    const batch = evidence.checks.batches.at(-1);
    if (!batch || batch.stale || batch.status !== 'complete' || !sameIdentity(batch.identity, current.binding.identity)) throw new Error('交付与检查不属于同一完整状态身份');
    this.#state!.lastSafeStage = 'frames'; await this.#set('deliver');
    await this.delivery.operate(this.opened, { action: 'describe', deliveryId: current.id,
      report: { goal: this.#state!.instruction, summary: answer.summary, warnings: [...new Set([...answer.warnings, ...(snapshot.input.scenes.length === 0 ? ['没有可播放 Scene；请在表格工作区添加 Scene。'] : snapshot.input.scenes.some(scene => scene.time.source === 'draft') ? ['缺少 Speech，当前使用 Draft Duration；不能用于最终 Render。'] : [])])], suggestions: answer.suggestions.filter(item => !item.required).map(({ sceneId, observation, action, content, reason }) => ({ sceneId, observation, action, content, reason })) } });
    await this.#fresh();
    this.#state!.pending = null;
    this.#state!.lastSafeStage = 'deliver';
    return this.#wait('CANDIDATE_READY', '候选已就绪；请查看交付、检查结果与警告，由你决定是否接受。');
  }
  async #poll<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    for (;;) { await this.#fresh(); const value = await read(); await this.#fresh(); if (done(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  async #wait(reason: string, pending: string) {
    this.#assert();
    if (reason === 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED') this.#state!.externalBaseline = (await this.opened.candidate({ action: 'read' })).baseline;
    this.#driver = null; this.#state!.status = 'waiting'; this.#state!.reason = reason; this.#state!.waitingReason = reason; this.#state!.pending = pending; await this.#save();
  }
  async #stop(error: unknown) {
    if (!this.#state || this.#closed || this.#operation || ['stopped', 'terminated'].includes(this.#state.status)) return;
    if (this.ownsCandidate) {
      try {
        const snapshot = await this.#snapshot();
        if (snapshot.baseline !== this.#state.candidateBaseline) error = Object.assign(new Error(externalMessage), { code: 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED' });
        else if (!['CODEX_USAGE_LIMIT', 'CODEX_AUTH_REQUIRED', 'CODEX_UNAVAILABLE', 'CODEX_INTERRUPTED', 'CODEX_THREAD_UNAVAILABLE', 'NO_PROGRESS'].some(code => (error as { code?: string }).code === code || (error as Error).message === code) && snapshot.signature !== this.#state.inputIdentity) { await this.#catchUp(snapshot); return; }
      } catch (next) { error = next; }
    }
    const driver = this.#driver; this.#driver = null;
    if (driver?.turnId && this.#state.threadPointer) {
      this.#interrupted = { threadId: this.#state.threadPointer, turnId: driver.turnId };
      try { await this.host.interruptTurn(this.#interrupted); this.#interrupted = null; }
      catch { this.#operation = 'stop-uncertain'; }
    }
    this.#state.toolApproval = null;
    if (this.#state.waitingReason === 'TOOL_APPROVAL_REQUIRED') this.#state.waitingReason = null;
    if ((error as { code?: string }).code === 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED') { this.preview.invalidate(); this.delivery.invalidate(); this.checks.invalidate(); this.#state.externalBaseline = (await this.opened.candidate({ action: 'read' })).baseline; this.#state.status = 'waiting'; this.#state.reason = 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED'; this.#state.pending = externalMessage; await this.#save().catch(() => undefined); return; }
    this.#state.status = 'stopped'; this.#state.reason = codexStopReason(error);
    this.#state.pending = null;
    await this.#save().catch(() => undefined);
  }
  async terminate(reason: 'CANDIDATE_ACCEPTED' | 'CANDIDATE_ABANDONED') {
    this.#driver = null;
    this.#recovery = null;
    if (this.#state) {
      this.#state.status = 'terminated'; this.#state.reason = reason; this.#state.pending = null;
      this.#state.toolApproval = null; this.#state.pendingMessage = null; this.#state.suggestions = [];
    }
    // 终结事实已由候选/修订指针提交；不得重新保存或复活旧任务检查点。
    await this.opened.programTransaction(() => cleanupEndedTask(this.opened.inspection.projectDirectory));
  }
  async close() {
    clearInterval(this.#timer); this.#closed = true; this.#unsubscribe(); const driver = this.#driver; this.#driver = null;
    if (driver?.turnId && this.#state?.threadPointer) await this.host.interruptTurn({ threadId: this.#state.threadPointer, turnId: driver.turnId }).catch(() => undefined);
    await this.#pendingRun;
  }
}

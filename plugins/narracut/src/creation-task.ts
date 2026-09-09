import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rename, rm, open } from 'node:fs/promises';
import { z } from 'zod';
import type { CodexHostAdapter, CodexHostEvent } from './codex-host';
import type { OpenedProjectVNext } from '../../../src/server/project-lifecycle';
import { directory, regular } from '../../../src/server/project-candidate';
import { ProjectPreview } from '../../../src/server/project-preview';
import { ProjectChecks } from '../../../src/server/project-checks';
import { ProjectDelivery } from '../../../src/server/project-delivery';


const stages = ['read', 'modify', 'check', 'preview', 'frames', 'deliver'] as const;
const checkpointSchema = z.object({
  taskId: z.string().uuid(), projectId: z.string().uuid(), instruction: z.string().min(1).max(4000),
  status: z.enum(['running', 'waiting', 'stopped', 'terminated']), reason: z.string().nullable(),
  threadPointer: z.string().nullable(), lastSafeStage: z.enum(stages).nullable(),
  candidateBaseline: z.string().nullable(), inputIdentity: z.string().nullable(),
  pending: z.string().max(4000).nullable(),
}).strict();
export type CreationCheckpoint = z.infer<typeof checkpointSchema>;
const reportText = z.string().min(1).max(4000);
const answerSchema = z.object({
  verificationToken: z.string(), action: z.enum(['apply', 'dependencies', 'deliver', 'wait']),
  changes: z.array(z.object({ path: z.string().max(1024), content: z.string().max(256_000).nullable() }).strict()).max(12),
  dependencies: z.array(z.object({ name: z.string(), version: z.string() }).strict()).max(100).default([]),
  packages: z.array(z.object({ name: z.string(), version: z.string(), integrity: z.string() }).strict()).max(256).default([]),
  summary: reportText, divergence: z.string().max(4000), warnings: z.array(reportText).max(100),
  suggestions: z.array(z.object({ sceneId: reportText, observation: reportText, action: reportText, content: reportText, reason: reportText }).strict()).max(100),
  reviews: z.array(z.object({ frame: z.number().int().nonnegative(), digest: reportText, observation: reportText }).strict()).max(12),
}).strict();
export type CreationState = CreationCheckpoint & { stage: typeof stages[number]; divergence: string; preview: unknown | null; deliveryId: string | null };
type Driver = { token: string; turnId: string | null; signature: string };
/** 一个项目只保留一项任务。模型没有项目写能力，只有此服务可以提交其经过校验的批次。 */
export class CreationTask {
  #state: CreationState | null = null;
  #driver: Driver | null = null;
  #starting = false;
  #busy = false;
  #early: CodexHostEvent[] = [];
  #closed = false;
  #unsubscribe: () => void;
  #noProgress = 0;
  #parentOrigin = 'null';
  #pendingRun: Promise<void> = Promise.resolve();
  constructor(private opened: OpenedProjectVNext, private host: CodexHostAdapter,
    private preview: ProjectPreview, private checks: ProjectChecks, private delivery: ProjectDelivery) {
    this.#unsubscribe = host.subscribe(event => {
      if (this.#starting && this.#driver?.turnId === null) { this.#early.push(event); return; }
      this.#pendingRun = this.#pendingRun.then(() => this.#event(event)).catch(error => this.#stop(error));
    });
  }
  get ownsCandidate() { return this.#state?.status === 'running'; }
  async status() {
    if (this.#state?.reason === 'CANDIDATE_READY') {
      const latest = await this.delivery.status(this.opened);
      if (!latest.delivery || latest.delivery.stale) {
        this.#state.reason = 'USER_DECISION_REQUIRED';
        this.#state.pending = '交付证据已过期或不可用；不能作为当前成果，自动追赶尚未接入。';
        await this.#save();
      }
    }
    return this.value;
  }
  get value() { return this.#state ? structuredClone(this.#state) : null; }
  async load() {
    try {
      const checkpoint = checkpointSchema.parse(JSON.parse((await regular(this.#path(), 32_000)).toString()));
      if (checkpoint.projectId !== this.opened.inspection.manifest.projectId) throw new Error('任务项目身份不匹配');
      const candidate = await this.opened.candidate({ action: 'read' });
      if (checkpoint.status !== 'terminated' && checkpoint.candidateBaseline !== candidate.baseline) throw new Error('任务候选检查点不匹配');
      this.#state = { ...checkpoint, status: checkpoint.status === 'terminated' ? 'terminated' : 'stopped', reason: checkpoint.status === 'terminated' ? checkpoint.reason : 'APP_RESTARTED', stage: checkpoint.lastSafeStage ?? 'read', divergence: '', preview: null, deliveryId: null };
      await this.#save();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('TASK_CHECKPOINT_INVALID：任务检查点无法恢复；候选保留。');
    }
  }
  #path() { return join(this.opened.inspection.projectDirectory, '.narracut', 'agent-task.json'); }
  async #save() {
    if (!this.#state) return;
    const { stage: _stage, divergence: _divergence, preview: _preview, deliveryId: _delivery, ...checkpoint } = this.#state;
    const bytes = JSON.stringify(checkpointSchema.parse(checkpoint));
    await this.opened.programTransaction(async () => {
      const parent = join(this.opened.inspection.projectDirectory, '.narracut');
      const identity = await directory(parent), temporary = join(parent, `task-${randomUUID()}.tmp`);
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        if (identity !== await directory(parent)) throw new Error('任务目录已替换');
        await rename(temporary, this.#path());
        const parentHandle = await open(parent, 'r');
        try { await parentHandle.sync(); } finally { await parentHandle.close(); }
      } finally { await rm(temporary, { force: true }); }
    });
  }
  async start(instruction: string, parentOrigin = 'null') {
    if (this.#busy || this.#state && this.#state.status !== 'terminated') throw new Error('已有创作任务；追加要求与接管尚未接入，草稿已保留。');
    if (!instruction.trim() || instruction.length > 4000) throw new Error('请填写 1–4000 字的明确创作目标。');
    this.#parentOrigin = parentOrigin;
    this.#busy = true;
    try {
      const candidate = await this.opened.candidate({ action: 'read' });
      if (candidate.status !== 'absent') throw new Error('已有候选；本次不会替换或接管，草稿已保留。');
      this.#state = { taskId: randomUUID(), projectId: this.opened.inspection.manifest.projectId, instruction,
        status: 'running', reason: null, threadPointer: null, lastSafeStage: null, candidateBaseline: null,
        inputIdentity: null, pending: null, stage: 'read', divergence: '', preview: null, deliveryId: null };
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
  async #set(stage: CreationState['stage']) {
    this.#assert(); this.#state!.stage = stage;
    await this.#save();
  }
  #assert() { if (this.#closed || this.#state?.status !== 'running') throw new Error('当前驱动已失去写权。'); }
  async #snapshot() {
    const candidate = await this.opened.candidate({ action: 'read' });
    if (candidate.status === 'external-change') throw Object.assign(new Error('候选已被外部修改'), { code: 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED' });
    return this.preview.capture(this.opened, 'candidate', true);
  }
  async #run(feedback = '', images: string[] = []) {
    this.#assert();
    const state = this.#state!;
    const snapshot = await this.#snapshot();
    if (state.candidateBaseline !== snapshot.baseline) return this.#wait('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', '候选发生外部变化，外部字节已保留；当前版本尚不支持确认后接管。');
    state.inputIdentity = snapshot.signature;
    if (!state.threadPointer) {
      state.threadPointer = (await this.host.createThread({ projectDirectory: this.opened.inspection.projectDirectory, purpose: 'creation' })).threadId;
      this.#assert();
    }
    state.lastSafeStage = state.stage === 'read' ? 'read' : state.lastSafeStage;
    await this.#save();
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
          '实质 Brief 分歧填写 divergence，并说明本次遵循的用户原文；否则空字符串。summary、warnings、suggestions 用中文。',
          `当前创作指令（精确原文）：${JSON.stringify(state.instruction)}`,
          `最新 Runtime 输入：${JSON.stringify(snapshot.input)}`,
          `候选：${snapshot.candidate.candidate?.path}；完整身份：${snapshot.signature}`,
          `verificationToken 必须原样返回：${driver.token}`,
          feedback,
        ].join('\n') });
      this.#assert(); driver.turnId = turn.turnId;
    } finally {
      this.#starting = false;
      for (const event of this.#early.splice(0)) this.#pendingRun = this.#pendingRun.then(() => this.#event(event)).catch(error => this.#stop(error));
    }
  }
  async #event(event: CodexHostEvent) {
    if (!this.ownsCandidate || this.#closed) return;
    if (event.type === 'host-unavailable') throw new Error('CODEX_UNAVAILABLE');
    if (event.threadId !== this.#state!.threadPointer) return;
    const driver = this.#driver;
    if (event.type === 'thread-unavailable') {
      if (event.turnId && event.turnId !== driver?.turnId) return;
      throw new Error('CODEX_THREAD_UNAVAILABLE');
    }
    if (!driver || event.turnId !== driver.turnId) return;
    this.#driver = null;
    if (event.status !== 'completed' || !event.output) throw new Error('CODEX_INTERRUPTED');
    const answer = answerSchema.parse(JSON.parse(event.output));
    if (answer.verificationToken !== driver.token) throw new Error('创作结果驱动身份不匹配');
    const snapshot = await this.#snapshot();
    if (snapshot.baseline !== this.#state!.candidateBaseline) return this.#wait('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', '候选已被外部修改；外部字节已保留，接管尚未接入。');
    if (snapshot.signature !== driver.signature) throw new Error('项目输入或候选已变化；旧结果已丢弃，自动追赶尚未接入。');
    this.#state!.divergence = answer.divergence;
    if (answer.action === 'wait') return this.#wait(answer.suggestions.length ? 'SCENE_CHANGE_REQUIRED' : 'USER_DECISION_REQUIRED', answer.summary);
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
    await this.#set('preview');
    if (!this.#state!.preview) {
      const descriptor = await this.preview.build(this.opened, 'candidate', this.#parentOrigin);
      this.#assert(); this.#state!.preview = descriptor; this.#state!.lastSafeStage = 'preview';
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
    this.#state!.lastSafeStage = 'frames'; await this.#set('deliver');
    await this.delivery.operate(this.opened, { action: 'describe', deliveryId: current.id,
      report: { goal: this.#state!.instruction, summary: answer.summary, warnings: [...new Set([...answer.warnings, ...(snapshot.input.scenes.length === 0 ? ['没有可播放 Scene；请在表格工作区添加 Scene。'] : snapshot.input.scenes.some(scene => scene.time.source === 'draft') ? ['缺少 Speech，当前使用 Draft Duration；不能用于最终 Render。'] : [])])], suggestions: answer.suggestions } });
    this.#state!.lastSafeStage = 'deliver';
    return this.#wait('CANDIDATE_READY', '候选已就绪；请查看交付、检查结果与警告，由你决定是否接受。');
  }
  async #poll<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    for (;;) { this.#assert(); const value = await read(); if (done(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  async #wait(reason: string, pending: string) {
    this.#assert(); this.#driver = null; this.#state!.status = 'waiting'; this.#state!.reason = reason; this.#state!.pending = pending; await this.#save();
  }
  async #stop(error: unknown) {
    this.#driver = null;
    if (!this.#state || this.#closed) return;
    if ((error as { code?: string }).code === 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED') { this.#state.status = 'waiting'; this.#state.reason = 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED'; this.#state.pending = '候选发生外部变化，外部字节已保留；当前版本尚不支持确认后接管。'; await this.#save().catch(() => undefined); return; }
    this.#state.status = 'stopped'; this.#state.reason = ['CODEX_UNAVAILABLE','CODEX_INTERRUPTED','CODEX_THREAD_UNAVAILABLE','NO_PROGRESS'].includes((error as Error).message) ? (error as Error).message : 'CODEX_INTERRUPTED';
    this.#state.pending = String((error as Error).message).slice(0, 4000);
    await this.#save().catch(() => undefined);
  }
  async terminate(reason: 'CANDIDATE_ACCEPTED' | 'CANDIDATE_ABANDONED') {
    if (!this.#state) return;
    this.#driver = null; this.#state.status = 'terminated'; this.#state.reason = reason; this.#state.pending = null; await this.#save();
  }
  async close() {
    this.#closed = true; this.#unsubscribe(); const driver = this.#driver; this.#driver = null;
    if (driver?.turnId && this.#state?.threadPointer) await this.host.interruptTurn({ threadId: this.#state.threadPointer, turnId: driver.turnId }).catch(() => undefined);
    await this.#pendingRun;
  }
}

import { randomUUID } from 'node:crypto';
import { CodexThreadUnavailableError, type CodexHostAdapter, type CodexHostEvent, type StartCodexTurnInput } from './codex-host';

/** 当前 Agent 通过工具领取步骤并提交结果；不启动模型进程，也不取得桌面线程写权。 */
export class CurrentConversationHost implements CodexHostAdapter {
  #listeners = new Set<(event: CodexHostEvent) => void>();
  #pending: (StartCodexTurnInput & { stepId: string }) | null = null;
  #closed = false;
  constructor(private readonly threadId: string | null) {}
  subscribe(listener: (event: CodexHostEvent) => void) {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  async createThread(): Promise<{ threadId: string }> { throw new Error('当前对话创作不能创建专用线程。'); }
  async resumeThread(input: { threadId: string }) {
    if (this.#closed || !this.threadId || input.threadId !== this.threadId) throw new CodexThreadUnavailableError(input.threadId);
    return { threadId: this.threadId };
  }
  async startTurn(input: StartCodexTurnInput) {
    await this.resumeThread(input);
    if (this.#pending) throw new Error('当前创作步骤尚未处理。');
    const stepId = randomUUID();
    this.#pending = { ...structuredClone(input), stepId };
    return { turnId: stepId };
  }
  read() { return this.#pending ? structuredClone(this.#pending) : null; }
  submit(stepId: string, output: string) {
    const pending = this.#pending;
    if (this.#closed || !pending || pending.stepId !== stepId) throw new Error('创作步骤已失效，请读取当前任务。');
    this.#pending = null;
    for (const listener of this.#listeners) listener({ type: 'turn-completed', threadId: pending.threadId, turnId: stepId, status: 'completed', output });
  }
  async interruptTurn(input: { threadId: string; turnId: string }) {
    if (this.#pending?.threadId === input.threadId && this.#pending.stepId === input.turnId) this.#pending = null;
  }
  async dispose() { this.#closed = true; this.#pending = null; this.#listeners.clear(); }
}

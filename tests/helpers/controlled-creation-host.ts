import type { CodexHostAdapter, CodexHostEvent, StartCodexTurnInput } from '../../plugins/narracut/src/codex-host';

/** 只替换 Codex 宿主边界；候选提交与任务检查点仍走真实项目服务。 */
export class ControlledCreationHost implements CodexHostAdapter {
  listeners = new Set<(event: CodexHostEvent) => void>();
  turns: (StartCodexTurnInput & { turnId: string })[] = [];
  interruptions = 0;
  async createThread(): Promise<{ threadId: string }> { throw new Error('重开不得创建线程'); }
  async resumeThread(input: { threadId: string }) { return { threadId: input.threadId }; }
  subscribe(listener: (event: CodexHostEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async startTurn(input: StartCodexTurnInput) { const turnId = `turn-${this.turns.length}`; this.turns.push({ ...input, turnId }); return { turnId }; }
  async interruptTurn() { this.interruptions++; }
  async dispose() {}
  complete(changes: { path: string; content: string }[]) {
    const turn = this.turns.at(-1)!;
    this.emit({ type: 'turn-completed', threadId: turn.threadId, turnId: turn.turnId, status: 'completed', output: JSON.stringify({
      verificationToken: turn.verificationToken, action: 'apply', changes, summary: '关闭期间保存成果', divergence: '', warnings: [], suggestions: [], reviews: [],
    }) });
  }
  interrupt() { const turn = this.turns.at(-1)!; this.emit({ type: 'turn-completed', threadId: turn.threadId, turnId: turn.turnId, status: 'interrupted' }); }
  emit(event: CodexHostEvent) { for (const listener of this.listeners) listener(event); }
}

import { describe, expect, it } from "vitest";

import {
  AgentHostValidationService,
  CodexThreadUnavailableError,
  type CodexHostAdapter,
  type CodexHostEvent,
  type StartCodexTurnInput,
} from "../plugins/narracut/src/codex-host";

const PROJECT = {
  projectDirectory: "/work/projects/product-demo",
  projectId: "10000000-0000-4000-8000-000000000001",
  sceneCount: 3,
} as const;

class FakeCodexHost implements CodexHostAdapter {
  readonly createdThreads: string[] = [];
  readonly resumedThreads: string[] = [];
  readonly turns: Array<StartCodexTurnInput & { turnId: string }> = [];
  readonly interruptedTurns: Array<{ threadId: string; turnId: string }> = [];
  unavailableThreads = new Set<string>();
  hostUnavailable = false;
  startTurnFailures = 0;
  #listener: ((event: CodexHostEvent) => void) | undefined;

  subscribe(listener: (event: CodexHostEvent) => void): () => void {
    this.#listener = listener;
    return () => {
      if (this.#listener === listener) this.#listener = undefined;
    };
  }

  async createThread(): Promise<{ threadId: string }> {
    if (this.hostUnavailable) throw new Error("Codex host unavailable");
    const threadId = `thread-${this.createdThreads.length + 1}`;
    this.createdThreads.push(threadId);
    return { threadId };
  }

  async resumeThread(input: { threadId: string }): Promise<{ threadId: string }> {
    this.resumedThreads.push(input.threadId);
    if (this.unavailableThreads.has(input.threadId)) {
      throw new CodexThreadUnavailableError(input.threadId);
    }
    return { threadId: input.threadId };
  }

  async startTurn(input: StartCodexTurnInput): Promise<{ turnId: string }> {
    if (this.startTurnFailures > 0) {
      this.startTurnFailures -= 1;
      throw new Error("Codex turn start failed");
    }
    const turnId = `turn-${this.turns.length + 1}`;
    this.turns.push({ ...input, turnId });
    return { turnId };
  }

  async interruptTurn(input: { threadId: string; turnId: string }): Promise<void> {
    this.interruptedTurns.push(input);
  }

  async dispose(): Promise<void> {}

  emit(event: CodexHostEvent): void {
    this.#listener?.(event);
  }
}

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `generated-${index}`;
}

function completionFor(
  host: FakeCodexHost,
  turnIndex: number,
  overrides: Record<string, unknown> = {},
): CodexHostEvent {
  const turn = host.turns[turnIndex]!;
  return {
    type: "turn-completed",
    threadId: turn.threadId,
    turnId: turn.turnId,
    status: "completed",
    output: JSON.stringify({
      verificationToken: turn.verificationToken,
      projectId: PROJECT.projectId,
      sceneCount: PROJECT.sceneCount,
      summary: "Codex 已在只读边界内核对 Project VNext 身份。",
      ...overrides,
    }),
  };
}

describe("Codex 创作线程宿主边界", () => {
  it("创建专用线程并只接受经过任务与当前驱动身份校验的结果", async () => {
    const host = new FakeCodexHost();
    const service = new AgentHostValidationService(host, {
      idFactory: ids("task-1", "driver-1", "challenge-1"),
    });

    const running = await service.start(PROJECT);

    expect(running).toMatchObject({
      taskId: "task-1",
      status: "running",
      connection: { status: "connected", threadId: "thread-1" },
      projectModified: false,
    });
    expect(host.turns[0]).toMatchObject({
      threadId: "thread-1",
      projectDirectory: PROJECT.projectDirectory,
      verificationToken: "challenge-1",
    });

    host.emit(completionFor(host, 0));

    expect(service.get("task-1")).toMatchObject({
      status: "succeeded",
      result: {
        projectId: PROJECT.projectId,
        sceneCount: 3,
        summary: "Codex 已在只读边界内核对 Project VNext 身份。",
      },
      projectModified: false,
      checkpoint: null,
    });
  });

  it("线程丢失后停止；继续会自动创建替代线程并拒绝旧回调", async () => {
    const host = new FakeCodexHost();
    const service = new AgentHostValidationService(host, {
      idFactory: ids("task-1", "driver-1", "challenge-1", "driver-2", "challenge-2"),
    });
    await service.start(PROJECT);

    host.emit({ type: "thread-unavailable", threadId: "thread-1", turnId: "turn-1" });
    expect(service.get("task-1")).toMatchObject({
      status: "stopped",
      reason: "CODEX_THREAD_UNAVAILABLE",
      connection: { status: "unavailable", threadId: "thread-1" },
      checkpoint: { threadPointer: "thread-1" },
    });

    host.unavailableThreads.add("thread-1");
    const resumed = await service.continue("task-1");
    expect(resumed).toMatchObject({
      status: "running",
      connection: { status: "connected", threadId: "thread-2", replaced: true },
    });

    host.emit(completionFor(host, 0));
    expect(service.get("task-1")).toMatchObject({
      status: "running",
      diagnostic: { code: "LATE_DRIVER_CALLBACK_REJECTED" },
      connection: { threadId: "thread-2" },
    });

    host.emit(completionFor(host, 1));
    expect(service.get("task-1")).toMatchObject({ status: "succeeded" });
  });

  it("停止会先撤销当前驱动，再中断宿主 Turn，并保留可继续的最小检查点", async () => {
    const host = new FakeCodexHost();
    const service = new AgentHostValidationService(host, {
      idFactory: ids("task-1", "driver-1", "challenge-1"),
    });
    await service.start(PROJECT);

    const stopped = await service.stop("task-1");

    expect(stopped).toMatchObject({
      status: "stopped",
      reason: "USER_STOPPED",
      checkpoint: {
        taskId: "task-1",
        status: "stopped",
        reason: "USER_STOPPED",
        threadPointer: "thread-1",
      },
    });
    expect(stopped.checkpoint).toEqual({
      taskId: "task-1",
      status: "stopped",
      reason: "USER_STOPPED",
      threadPointer: "thread-1",
    });
    expect(JSON.stringify(stopped.checkpoint)).not.toMatch(
      /conversation|reasoning|toolLog|token|uncommitted|history/i,
    );
    expect(host.interruptedTurns).toEqual([{ threadId: "thread-1", turnId: "turn-1" }]);

    host.emit(completionFor(host, 0));
    expect(service.get("task-1")).toMatchObject({
      status: "stopped",
      diagnostic: { code: "LATE_DRIVER_CALLBACK_REJECTED" },
    });
  });

  it("宿主不可用时稳定停止并保留重试入口", async () => {
    const host = new FakeCodexHost();
    host.hostUnavailable = true;
    const service = new AgentHostValidationService(host, {
      idFactory: ids("task-1"),
    });

    const stopped = await service.start(PROJECT);

    expect(stopped).toMatchObject({
      taskId: "task-1",
      status: "stopped",
      reason: "CODEX_UNAVAILABLE",
      connection: { status: "unavailable" },
      availableActions: ["continue"],
      projectModified: false,
    });
  });

  it("Turn 启动失败时保留最新绑定线程指针，继续不会制造孤立线程", async () => {
    const host = new FakeCodexHost();
    host.startTurnFailures = 1;
    const service = new AgentHostValidationService(host, {
      idFactory: ids("task-1", "driver-1", "challenge-1"),
    });

    const stopped = await service.start(PROJECT);
    expect(stopped).toMatchObject({
      status: "stopped",
      connection: { status: "unavailable", threadId: "thread-1" },
      checkpoint: { threadPointer: "thread-1" },
    });

    const continued = await service.continue("task-1");
    expect(continued).toMatchObject({
      status: "running",
      connection: { status: "connected", threadId: "thread-1", replaced: false },
    });
    expect(host.createdThreads).toEqual(["thread-1"]);
    expect(host.resumedThreads).toEqual(["thread-1"]);
  });

  it("停止后仍接收线程可用性遥测，但不恢复旧驱动写权或覆盖停止原因", async () => {
    const host = new FakeCodexHost();
    const service = new AgentHostValidationService(host, {
      idFactory: ids("task-1", "driver-1", "challenge-1"),
    });
    await service.start(PROJECT);
    await service.stop("task-1");

    host.emit({ type: "thread-unavailable", threadId: "thread-1" });
    expect(service.get("task-1")).toMatchObject({
      status: "stopped",
      reason: "USER_STOPPED",
      connection: { status: "unavailable", threadId: "thread-1" },
      checkpoint: { reason: "USER_STOPPED", threadPointer: "thread-1" },
    });
  });

  it("替代线程创建后 Turn 启动失败时改存替代指针", async () => {
    const host = new FakeCodexHost();
    const service = new AgentHostValidationService(host, {
      idFactory: ids(
        "task-1",
        "driver-1",
        "challenge-1",
        "driver-2",
        "challenge-2",
        "driver-3",
        "challenge-3",
      ),
    });
    await service.start(PROJECT);
    host.emit({ type: "thread-unavailable", threadId: "thread-1", turnId: "turn-1" });
    host.unavailableThreads.add("thread-1");
    host.startTurnFailures = 1;

    const stopped = await service.continue("task-1");
    expect(stopped).toMatchObject({
      status: "stopped",
      connection: { status: "unavailable", threadId: "thread-2", replaced: true },
      checkpoint: { threadPointer: "thread-2" },
    });

    const continued = await service.continue("task-1");
    expect(continued).toMatchObject({
      status: "running",
      connection: { status: "connected", threadId: "thread-2", replaced: false },
    });
    expect(host.createdThreads).toEqual(["thread-1", "thread-2"]);
    expect(host.resumedThreads).toEqual(["thread-1", "thread-2"]);
  });
});

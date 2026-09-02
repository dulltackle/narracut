import { randomUUID } from "node:crypto";

export type CodexHostEvent =
  | {
    type: "turn-completed";
    threadId: string;
    turnId: string;
    status: "completed" | "interrupted" | "failed";
    output?: string;
    error?: string;
  }
  | { type: "thread-unavailable"; threadId: string; turnId?: string }
  | { type: "host-unavailable"; error?: string };

export type StartCodexTurnInput = {
  threadId: string;
  projectDirectory: string;
  prompt: string;
  verificationToken: string;
  outputSchema: Record<string, unknown>;
};

export interface CodexHostAdapter {
  subscribe(listener: (event: CodexHostEvent) => void): () => void;
  createThread(input: { projectDirectory: string }): Promise<{ threadId: string }>;
  resumeThread(input: { threadId: string; projectDirectory: string }): Promise<{ threadId: string }>;
  startTurn(input: StartCodexTurnInput): Promise<{ turnId: string }>;
  interruptTurn(input: { threadId: string; turnId: string }): Promise<void>;
  dispose(): Promise<void>;
}

export class CodexThreadUnavailableError extends Error {
  readonly threadId: string;

  constructor(threadId: string) {
    super(`Codex 创作线程 ${threadId} 不可用。`);
    this.name = "CodexThreadUnavailableError";
    this.threadId = threadId;
  }
}

type ValidationStatus = "running" | "stopped" | "succeeded";
type StopReason = "USER_STOPPED" | "CODEX_INTERRUPTED" | "CODEX_THREAD_UNAVAILABLE" | "CODEX_UNAVAILABLE";

export type HostValidationCheckpoint = {
  taskId: string;
  status: "running" | "stopped";
  reason: StopReason | null;
  threadPointer: string | null;
};

export type HostValidationState = {
  taskId: string;
  status: ValidationStatus;
  reason: StopReason | null;
  connection: {
    status: "connected" | "unavailable";
    threadId: string | null;
    replaced: boolean;
  };
  result: null | {
    projectId: string;
    sceneCount: number;
    summary: string;
    verification: { taskId: string; driverId: string };
  };
  diagnostic: null | { code: string; message: string };
  checkpoint: HostValidationCheckpoint | null;
  availableActions: Array<"stop" | "continue">;
  projectModified: false;
};

type ValidationRequest = {
  projectDirectory: string;
  projectId: string;
  sceneCount: number;
};

type Driver = {
  id: string;
  threadId: string;
  turnId: string;
  verificationToken: string;
};

type Task = {
  request: ValidationRequest;
  state: HostValidationState;
  activeDriver: Driver | null;
};

type ServiceOptions = {
  idFactory?: () => string;
};

const validationOutputSchema = {
  type: "object",
  required: ["verificationToken", "projectId", "sceneCount", "summary"],
  properties: {
    verificationToken: { type: "string" },
    projectId: { type: "string" },
    sceneCount: { type: "integer", minimum: 0 },
    summary: { type: "string", maxLength: 240 },
  },
  additionalProperties: false,
} as const;

function checkpointFor(task: Task): HostValidationCheckpoint | null {
  if (task.state.status === "succeeded") return null;
  return {
    taskId: task.state.taskId,
    status: task.state.status,
    reason: task.state.reason,
    threadPointer: task.state.connection.threadId,
  };
}

function availableActions(status: ValidationStatus): Array<"stop" | "continue"> {
  if (status === "running") return ["stop"];
  if (status === "stopped") return ["continue"];
  return [];
}

function publicState(task: Task): HostValidationState {
  return {
    ...task.state,
    connection: { ...task.state.connection },
    result: task.state.result === null
      ? null
      : { ...task.state.result, verification: { ...task.state.result.verification } },
    diagnostic: task.state.diagnostic === null ? null : { ...task.state.diagnostic },
    checkpoint: checkpointFor(task),
    availableActions: [...task.state.availableActions],
  };
}

function boundedMessage(message: unknown, fallback: string): string {
  if (typeof message !== "string" || message.trim() === "") return fallback;
  return message.trim().slice(0, 240);
}

function validationPrompt(task: Task, verificationToken: string): string {
  return [
    "这是 Narracut 的一次固定 Codex 创作线程宿主验证，不是创作任务。",
    "只读检查当前工作目录中的 narracut.json 与 project.json；不要创建、修改或删除任何文件，也不要执行网络操作。",
    `确认 Project ID 是 ${task.request.projectId}，Scene 数量是 ${task.request.sceneCount}。`,
    `最终只返回符合给定 JSON Schema 的对象，其中 verificationToken 必须原样返回 ${verificationToken}。`,
    "summary 用一句中文说明已在只读边界内核对 Project VNext 身份。",
  ].join("\n");
}

export class AgentHostValidationService {
  readonly #host: CodexHostAdapter;
  readonly #idFactory: () => string;
  readonly #tasks = new Map<string, Task>();
  readonly #driverOwners = new Map<string, string>();
  readonly #unsubscribe: () => void;

  constructor(host: CodexHostAdapter, options: ServiceOptions = {}) {
    this.#host = host;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#unsubscribe = host.subscribe((event) => this.#handleHostEvent(event));
  }

  async start(request: ValidationRequest): Promise<HostValidationState> {
    const taskId = this.#idFactory();
    const task: Task = {
      request,
      activeDriver: null,
      state: {
        taskId,
        status: "stopped",
        reason: "CODEX_UNAVAILABLE",
        connection: { status: "unavailable", threadId: null, replaced: false },
        result: null,
        diagnostic: null,
        checkpoint: null,
        availableActions: ["continue"],
        projectModified: false,
      },
    };
    this.#tasks.set(taskId, task);
    await this.#bindAndRun(task, null);
    return publicState(task);
  }

  get(taskId: string): HostValidationState {
    return publicState(this.#requireTask(taskId));
  }

  async stop(taskId: string): Promise<HostValidationState> {
    const task = this.#requireTask(taskId);
    const driver = task.activeDriver;
    task.activeDriver = null;
    this.#setStopped(task, "USER_STOPPED");
    if (driver !== null) {
      try {
        await this.#host.interruptTurn({ threadId: driver.threadId, turnId: driver.turnId });
      } catch (error) {
        task.state.diagnostic = {
          code: "HOST_INTERRUPT_FAILED",
          message: boundedMessage(error instanceof Error ? error.message : error, "Codex Turn 未能确认中断。"),
        };
      }
    }
    return publicState(task);
  }

  async continue(taskId: string): Promise<HostValidationState> {
    const task = this.#requireTask(taskId);
    if (task.state.status !== "stopped") {
      throw new Error("只有已停止的宿主验证任务可以继续。");
    }
    const threadPointer = task.state.connection.threadId;
    await this.#bindAndRun(task, threadPointer);
    return publicState(task);
  }

  async dispose(): Promise<void> {
    this.#unsubscribe();
    await this.#host.dispose();
  }

  #requireTask(taskId: string): Task {
    const task = this.#tasks.get(taskId);
    if (task === undefined) throw new Error(`未知宿主验证任务：${taskId}`);
    return task;
  }

  async #bindAndRun(task: Task, threadPointer: string | null): Promise<void> {
    task.state.diagnostic = null;
    let threadId = threadPointer;
    let replaced = false;
    try {
      if (threadPointer === null) {
        ({ threadId } = await this.#host.createThread({
          projectDirectory: task.request.projectDirectory,
        }));
      } else {
        try {
          ({ threadId } = await this.#host.resumeThread({
            threadId: threadPointer,
            projectDirectory: task.request.projectDirectory,
          }));
        } catch (error) {
          if (!(error instanceof CodexThreadUnavailableError)) throw error;
          ({ threadId } = await this.#host.createThread({
            projectDirectory: task.request.projectDirectory,
          }));
          replaced = true;
        }
      }

      if (threadId === null) throw new Error("Codex Thread 绑定未返回有效指针。");
      const driverId = this.#idFactory();
      const verificationToken = this.#idFactory();
      const { turnId } = await this.#host.startTurn({
        threadId,
        projectDirectory: task.request.projectDirectory,
        verificationToken,
        prompt: validationPrompt(task, verificationToken),
        outputSchema: validationOutputSchema,
      });
      const driver = { id: driverId, threadId, turnId, verificationToken };
      task.activeDriver = driver;
      this.#driverOwners.set(`${threadId}:${turnId}`, task.state.taskId);
      task.state.status = "running";
      task.state.reason = null;
      task.state.connection = { status: "connected", threadId, replaced };
      task.state.result = null;
      task.state.availableActions = availableActions("running");
      task.state.checkpoint = checkpointFor(task);
    } catch (error) {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_UNAVAILABLE");
      task.state.connection = {
        status: "unavailable",
        threadId,
        replaced,
      };
      task.state.diagnostic = {
        code: "CODEX_HOST_UNAVAILABLE",
        message: boundedMessage(error instanceof Error ? error.message : error, "Codex 宿主不可用。"),
      };
    }
  }

  #setStopped(task: Task, reason: StopReason): void {
    task.state.status = "stopped";
    task.state.reason = reason;
    task.state.result = null;
    task.state.availableActions = availableActions("stopped");
    task.state.checkpoint = checkpointFor(task);
  }

  #handleHostEvent(event: CodexHostEvent): void {
    if (event.type === "host-unavailable") {
      for (const task of this.#tasks.values()) {
        if (task.state.status === "succeeded") continue;
        if (task.activeDriver !== null) {
          task.activeDriver = null;
          this.#setStopped(task, "CODEX_UNAVAILABLE");
        }
        task.state.connection.status = "unavailable";
        task.state.diagnostic = {
          code: "CODEX_HOST_UNAVAILABLE",
          message: boundedMessage(event.error, "Codex 宿主连接已中断。"),
        };
      }
      return;
    }

    const turnKey = event.turnId === undefined ? null : `${event.threadId}:${event.turnId}`;
    let task = turnKey === null ? undefined : this.#tasks.get(this.#driverOwners.get(turnKey) ?? "");
    task ??= [...this.#tasks.values()].find((candidate) =>
      candidate.state.connection.threadId === event.threadId
    );
    if (task === undefined) return;

    const driver = task.activeDriver;
    if (
      event.type === "thread-unavailable" &&
      driver === null &&
      task.state.status === "stopped" &&
      task.state.connection.threadId === event.threadId
    ) {
      task.state.connection.status = "unavailable";
      task.state.diagnostic = {
        code: "CODEX_THREAD_UNAVAILABLE",
        message: "Codex 创作线程不可用；继续时将自动创建替代线程。",
      };
      return;
    }
    const isCurrent = driver !== null &&
      driver.threadId === event.threadId &&
      (event.turnId === undefined || driver.turnId === event.turnId);
    if (!isCurrent) {
      task.state.diagnostic = {
        code: "LATE_DRIVER_CALLBACK_REJECTED",
        message: "已拒绝失去写权的旧 Codex 创作线程回调；当前任务状态未改变。",
      };
      return;
    }

    if (event.type === "thread-unavailable") {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_THREAD_UNAVAILABLE");
      task.state.connection.status = "unavailable";
      task.state.diagnostic = {
        code: "CODEX_THREAD_UNAVAILABLE",
        message: "Codex 创作线程不可用；继续时将自动创建替代线程。",
      };
      return;
    }

    if (event.status !== "completed" || event.output === undefined) {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_INTERRUPTED");
      task.state.diagnostic = {
        code: "CODEX_TURN_INTERRUPTED",
        message: boundedMessage(event.error, "Codex 验证 Turn 未完成。"),
      };
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(event.output) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
      parsed = value as Record<string, unknown>;
    } catch {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_INTERRUPTED");
      task.state.diagnostic = {
        code: "HOST_VALIDATION_RESULT_INVALID",
        message: "Codex 返回了无法验证的结构化结果。",
      };
      return;
    }

    const summary = parsed.summary;
    const normalizedSummary = typeof summary === "string" ? summary.trim() : "";
    const valid = parsed.verificationToken === driver.verificationToken &&
      parsed.projectId === task.request.projectId &&
      parsed.sceneCount === task.request.sceneCount &&
      typeof summary === "string" &&
      normalizedSummary !== "" &&
      summary.length <= 240;
    if (!valid) {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_INTERRUPTED");
      task.state.diagnostic = {
        code: "HOST_VALIDATION_IDENTITY_MISMATCH",
        message: "Codex 结果未通过任务、驱动或项目身份校验。",
      };
      return;
    }

    task.activeDriver = null;
    task.state.status = "succeeded";
    task.state.reason = null;
    task.state.result = {
      projectId: task.request.projectId,
      sceneCount: task.request.sceneCount,
      summary: normalizedSummary,
      verification: { taskId: task.state.taskId, driverId: driver.id },
    };
    task.state.availableActions = availableActions("succeeded");
    task.state.checkpoint = null;
  }
}

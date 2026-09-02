import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import {
  CodexThreadUnavailableError,
  type CodexHostAdapter,
  type CodexHostEvent,
  type StartCodexTurnInput,
} from "./codex-host";

type JsonRpcResponse = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type PendingRequest = {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type CodexAppServerHostOptions = {
  command?: string;
  commandArgs?: string[];
  requestTimeoutMs?: number;
};

type ThreadResponse = { thread?: { id?: unknown } };
type TurnResponse = { turn?: { id?: unknown } };

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rpcError(method: string, error: JsonRpcResponse["error"]): Error {
  const message = error?.message?.trim() || "未知 App Server 错误";
  return new Error(`${method} 失败：${message}`);
}

export class CodexAppServerHost implements CodexHostAdapter {
  readonly #command: string;
  readonly #commandArgs: string[];
  readonly #requestTimeoutMs: number;
  readonly #listeners = new Set<(event: CodexHostEvent) => void>();
  readonly #pending = new Map<number, PendingRequest>();
  readonly #agentMessages = new Map<string, string>();
  readonly #activeTurns = new Map<string, string>();
  #child: ChildProcessWithoutNullStreams | null = null;
  #lineReader: Interface | null = null;
  #ready: Promise<void> | null = null;
  #requestId = 0;
  #stderrTail = "";
  #disposed = false;

  constructor(options: CodexAppServerHostOptions = {}) {
    this.#command = options.command ?? (process.env.NARRACUT_CODEX_COMMAND?.trim() || "codex");
    this.#commandArgs = options.commandArgs ?? ["app-server", "--stdio"];
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  }

  subscribe(listener: (event: CodexHostEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async createThread(input: { projectDirectory: string }): Promise<{ threadId: string }> {
    await this.#ensureReady();
    const result = await this.#request("thread/start", {
      cwd: input.projectDirectory,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "narracut-host-validation",
      developerInstructions: [
        "你正在执行 Narracut 的固定宿主边界验证。",
        "只允许读取当前工作目录；不得创建、修改或删除文件，不得访问网络。",
        "最终响应必须严格符合 turn/start 提供的 outputSchema。",
      ].join("\n"),
    }) as ThreadResponse;
    const threadId = result.thread?.id;
    if (typeof threadId !== "string" || threadId === "") {
      throw new Error("thread/start 未返回 Codex Thread ID。");
    }
    return { threadId };
  }

  async resumeThread(input: { threadId: string; projectDirectory: string }): Promise<{ threadId: string }> {
    await this.#ensureReady();
    let result: ThreadResponse;
    try {
      result = await this.#request("thread/resume", {
        threadId: input.threadId,
        cwd: input.projectDirectory,
        approvalPolicy: "never",
        sandbox: "read-only",
        excludeTurns: true,
      }) as ThreadResponse;
    } catch {
      throw new CodexThreadUnavailableError(input.threadId);
    }
    const threadId = result.thread?.id;
    if (threadId !== input.threadId) throw new CodexThreadUnavailableError(input.threadId);
    return { threadId: input.threadId };
  }

  async startTurn(input: StartCodexTurnInput): Promise<{ turnId: string }> {
    await this.#ensureReady();
    const result = await this.#request("turn/start", {
      threadId: input.threadId,
      input: [{ type: "text", text: input.prompt, text_elements: [] }],
      cwd: input.projectDirectory,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      outputSchema: input.outputSchema,
    }) as TurnResponse;
    const turnId = result.turn?.id;
    if (typeof turnId !== "string" || turnId === "") {
      throw new Error("turn/start 未返回 Codex Turn ID。");
    }
    this.#activeTurns.set(input.threadId, turnId);
    return { turnId };
  }

  async interruptTurn(input: { threadId: string; turnId: string }): Promise<void> {
    await this.#ensureReady();
    await this.#request("turn/interrupt", input);
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    const child = this.#child;
    const error = new Error("Codex App Server 已关闭。");
    if (child !== null) this.#shutdownChild(child, error, false);
    else this.#clearTransientState(error);
  }

  async #ensureReady(): Promise<void> {
    if (this.#disposed) throw new Error("Codex App Server 适配器已关闭。");
    if (this.#ready !== null) return this.#ready;
    this.#ready = this.#start();
    try {
      await this.#ready;
    } catch (error) {
      this.#ready = null;
      throw error;
    }
  }

  async #start(): Promise<void> {
    const child = spawn(this.#command, this.#commandArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.#child = child;
    this.#stderrTail = "";
    this.#lineReader = createInterface({ input: child.stdout });
    this.#lineReader.on("line", (line) => this.#handleLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.#stderrTail = `${this.#stderrTail}${chunk}`.slice(-2_000);
    });
    child.once("error", (error) => this.#handleExit(child, error));
    child.once("exit", (code, signal) => {
      if (this.#child !== child) return;
      const detail = this.#stderrTail.trim();
      this.#handleExit(child, new Error(
        detail || `Codex App Server 已退出（code=${String(code)}, signal=${String(signal)}）。`,
      ));
    });

    try {
      await this.#request("initialize", {
        clientInfo: { name: "narracut", title: "Narracut", version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      this.#notify("initialized");
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.#shutdownChild(child, reason, false);
      throw reason;
    }
  }

  #request(method: string, params: unknown): Promise<unknown> {
    const child = this.#child;
    if (child === null || child.stdin.destroyed) {
      return Promise.reject(new Error("Codex App Server 未连接。"));
    }
    const id = ++this.#requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending.delete(id)) return;
        const error = new Error(`${method} 超过 ${this.#requestTimeoutMs}ms 未响应。`);
        reject(error);
        this.#handleExit(child, error);
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { method, resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`, (error) => {
        if (error === null || error === undefined) return;
        const pending = this.#pending.get(id);
        if (pending === undefined) return;
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        reject(error);
        this.#handleExit(child, error);
      });
    });
  }

  #notify(method: string, params: unknown = {}): void {
    const child = this.#child;
    if (child === null || child.stdin.destroyed) return;
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  #handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      const child = this.#child;
      if (child !== null) this.#handleExit(child, new Error("Codex App Server 返回了无效 JSON。"));
      return;
    }

    if (message.id !== undefined && message.method === undefined) {
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      clearTimeout(pending.timer);
      this.#pending.delete(message.id);
      if (message.error !== undefined) pending.reject(rpcError(pending.method, message.error));
      else pending.resolve(message.result);
      return;
    }

    if (message.id !== undefined && message.method !== undefined) {
      this.#child?.stdin.write(`${JSON.stringify({
        id: message.id,
        error: { code: -32601, message: `Narracut 不支持宿主请求 ${message.method}。` },
      })}\n`);
      return;
    }

    const params = objectValue(message.params);
    if (message.method === "item/completed" && params !== null) {
      const item = objectValue(params.item);
      if (
        typeof params.threadId === "string" &&
        typeof params.turnId === "string" &&
        item?.type === "agentMessage" &&
        typeof item.text === "string"
      ) {
        this.#agentMessages.set(`${params.threadId}:${params.turnId}`, item.text);
      }
      return;
    }

    if (message.method === "turn/completed" && params !== null) {
      const threadId = params.threadId;
      const turn = objectValue(params.turn);
      const turnId = turn?.id;
      const status = turn?.status;
      if (
        turn === null ||
        typeof threadId !== "string" ||
        typeof turnId !== "string" ||
        (status !== "completed" && status !== "interrupted" && status !== "failed")
      ) return;
      const items = Array.isArray(turn.items) ? turn.items : [];
      const finalMessage = items
        .map(objectValue)
        .filter((item) => item?.type === "agentMessage" && typeof item.text === "string")
        .at(-1)?.text;
      const messageKey = `${threadId}:${turnId}`;
      const output = typeof finalMessage === "string"
        ? finalMessage
        : this.#agentMessages.get(messageKey);
      this.#agentMessages.delete(messageKey);
      this.#activeTurns.delete(threadId);
      this.#emit({
        type: "turn-completed",
        threadId,
        turnId,
        status,
        ...(output === undefined ? {} : { output }),
        ...(turn.error === null || turn.error === undefined
          ? {}
          : { error: JSON.stringify(turn.error).slice(0, 240) }),
      });
      return;
    }

    if ((message.method === "thread/closed" || message.method === "thread/deleted") && params !== null) {
      const threadId = params.threadId;
      if (typeof threadId !== "string") return;
      const turnId = this.#activeTurns.get(threadId);
      this.#activeTurns.delete(threadId);
      if (turnId !== undefined) this.#agentMessages.delete(`${threadId}:${turnId}`);
      this.#emit({
        type: "thread-unavailable",
        threadId,
        turnId,
      });
    }
  }

  #clearTransientState(error: Error): void {
    this.#lineReader?.close();
    this.#lineReader = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#agentMessages.clear();
    this.#activeTurns.clear();
  }

  #shutdownChild(
    child: ChildProcessWithoutNullStreams,
    error: Error,
    emitUnavailable: boolean,
  ): void {
    if (this.#child !== child) return;
    this.#child = null;
    this.#ready = null;
    this.#clearTransientState(error);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (emitUnavailable && !this.#disposed) {
      this.#emit({ type: "host-unavailable", error: error.message });
    }
  }

  #handleExit(child: ChildProcessWithoutNullStreams, error: Error): void {
    this.#shutdownChild(child, error, true);
  }

  #emit(event: CodexHostEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

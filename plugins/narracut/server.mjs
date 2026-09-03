// plugins/narracut/src/server.ts
import { readFile as readFile2 } from "node:fs/promises";
import { basename as basename2, isAbsolute as isAbsolute2 } from "node:path";
import { fileURLToPath } from "node:url";

// plugins/narracut/src/codex-app-server-host.ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// plugins/narracut/src/codex-host.ts
import { randomUUID } from "node:crypto";
var CodexThreadUnavailableError = class extends Error {
  threadId;
  constructor(threadId) {
    super(`Codex \u521B\u4F5C\u7EBF\u7A0B ${threadId} \u4E0D\u53EF\u7528\u3002`);
    this.name = "CodexThreadUnavailableError";
    this.threadId = threadId;
  }
};
var validationOutputSchema = {
  type: "object",
  required: ["verificationToken", "projectId", "sceneCount", "summary"],
  properties: {
    verificationToken: { type: "string" },
    projectId: { type: "string" },
    sceneCount: { type: "integer", minimum: 0 },
    summary: { type: "string", maxLength: 240 }
  },
  additionalProperties: false
};
function checkpointFor(task) {
  if (task.state.status === "succeeded") return null;
  return {
    taskId: task.state.taskId,
    status: task.state.status,
    reason: task.state.reason,
    threadPointer: task.state.connection.threadId
  };
}
function availableActions(status) {
  if (status === "running") return ["stop"];
  if (status === "stopped") return ["continue"];
  return [];
}
function publicState(task) {
  return {
    ...task.state,
    connection: { ...task.state.connection },
    result: task.state.result === null ? null : { ...task.state.result, verification: { ...task.state.result.verification } },
    diagnostic: task.state.diagnostic === null ? null : { ...task.state.diagnostic },
    checkpoint: checkpointFor(task),
    availableActions: [...task.state.availableActions]
  };
}
function boundedMessage(message, fallback) {
  if (typeof message !== "string" || message.trim() === "") return fallback;
  return message.trim().slice(0, 240);
}
function validationPrompt(task, verificationToken) {
  return [
    "\u8FD9\u662F Narracut \u7684\u4E00\u6B21\u56FA\u5B9A Codex \u521B\u4F5C\u7EBF\u7A0B\u5BBF\u4E3B\u9A8C\u8BC1\uFF0C\u4E0D\u662F\u521B\u4F5C\u4EFB\u52A1\u3002",
    "\u53EA\u8BFB\u68C0\u67E5\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\u4E2D\u7684 narracut.json \u4E0E project.json\uFF1B\u4E0D\u8981\u521B\u5EFA\u3001\u4FEE\u6539\u6216\u5220\u9664\u4EFB\u4F55\u6587\u4EF6\uFF0C\u4E5F\u4E0D\u8981\u6267\u884C\u7F51\u7EDC\u64CD\u4F5C\u3002",
    `\u786E\u8BA4 Project ID \u662F ${task.request.projectId}\uFF0CScene \u6570\u91CF\u662F ${task.request.sceneCount}\u3002`,
    `\u6700\u7EC8\u53EA\u8FD4\u56DE\u7B26\u5408\u7ED9\u5B9A JSON Schema \u7684\u5BF9\u8C61\uFF0C\u5176\u4E2D verificationToken \u5FC5\u987B\u539F\u6837\u8FD4\u56DE ${verificationToken}\u3002`,
    "summary \u7528\u4E00\u53E5\u4E2D\u6587\u8BF4\u660E\u5DF2\u5728\u53EA\u8BFB\u8FB9\u754C\u5185\u6838\u5BF9 Project VNext \u8EAB\u4EFD\u3002"
  ].join("\n");
}
var AgentHostValidationService = class {
  #host;
  #idFactory;
  #tasks = /* @__PURE__ */ new Map();
  #driverOwners = /* @__PURE__ */ new Map();
  #unsubscribe;
  constructor(host, options = {}) {
    this.#host = host;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#unsubscribe = host.subscribe((event) => this.#handleHostEvent(event));
  }
  async start(request) {
    const taskId = this.#idFactory();
    const task = {
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
        projectModified: false
      }
    };
    this.#tasks.set(taskId, task);
    await this.#bindAndRun(task, null);
    return publicState(task);
  }
  get(taskId) {
    return publicState(this.#requireTask(taskId));
  }
  async stop(taskId) {
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
          message: boundedMessage(error instanceof Error ? error.message : error, "Codex Turn \u672A\u80FD\u786E\u8BA4\u4E2D\u65AD\u3002")
        };
      }
    }
    return publicState(task);
  }
  async continue(taskId) {
    const task = this.#requireTask(taskId);
    if (task.state.status !== "stopped") {
      throw new Error("\u53EA\u6709\u5DF2\u505C\u6B62\u7684\u5BBF\u4E3B\u9A8C\u8BC1\u4EFB\u52A1\u53EF\u4EE5\u7EE7\u7EED\u3002");
    }
    const threadPointer = task.state.connection.threadId;
    await this.#bindAndRun(task, threadPointer);
    return publicState(task);
  }
  async dispose() {
    this.#unsubscribe();
    await this.#host.dispose();
  }
  #requireTask(taskId) {
    const task = this.#tasks.get(taskId);
    if (task === void 0) throw new Error(`\u672A\u77E5\u5BBF\u4E3B\u9A8C\u8BC1\u4EFB\u52A1\uFF1A${taskId}`);
    return task;
  }
  async #bindAndRun(task, threadPointer) {
    task.state.diagnostic = null;
    let threadId = threadPointer;
    let replaced = false;
    try {
      if (threadPointer === null) {
        ({ threadId } = await this.#host.createThread({
          projectDirectory: task.request.projectDirectory
        }));
      } else {
        try {
          ({ threadId } = await this.#host.resumeThread({
            threadId: threadPointer,
            projectDirectory: task.request.projectDirectory
          }));
        } catch (error) {
          if (!(error instanceof CodexThreadUnavailableError)) throw error;
          ({ threadId } = await this.#host.createThread({
            projectDirectory: task.request.projectDirectory
          }));
          replaced = true;
        }
      }
      if (threadId === null) throw new Error("Codex Thread \u7ED1\u5B9A\u672A\u8FD4\u56DE\u6709\u6548\u6307\u9488\u3002");
      const driverId = this.#idFactory();
      const verificationToken = this.#idFactory();
      const { turnId } = await this.#host.startTurn({
        threadId,
        projectDirectory: task.request.projectDirectory,
        verificationToken,
        prompt: validationPrompt(task, verificationToken),
        outputSchema: validationOutputSchema
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
        replaced
      };
      task.state.diagnostic = {
        code: "CODEX_HOST_UNAVAILABLE",
        message: boundedMessage(error instanceof Error ? error.message : error, "Codex \u5BBF\u4E3B\u4E0D\u53EF\u7528\u3002")
      };
    }
  }
  #setStopped(task, reason) {
    task.state.status = "stopped";
    task.state.reason = reason;
    task.state.result = null;
    task.state.availableActions = availableActions("stopped");
    task.state.checkpoint = checkpointFor(task);
  }
  #handleHostEvent(event) {
    if (event.type === "host-unavailable") {
      for (const task2 of this.#tasks.values()) {
        if (task2.state.status === "succeeded") continue;
        if (task2.activeDriver !== null) {
          task2.activeDriver = null;
          this.#setStopped(task2, "CODEX_UNAVAILABLE");
        }
        task2.state.connection.status = "unavailable";
        task2.state.diagnostic = {
          code: "CODEX_HOST_UNAVAILABLE",
          message: boundedMessage(event.error, "Codex \u5BBF\u4E3B\u8FDE\u63A5\u5DF2\u4E2D\u65AD\u3002")
        };
      }
      return;
    }
    const turnKey = event.turnId === void 0 ? null : `${event.threadId}:${event.turnId}`;
    let task = turnKey === null ? void 0 : this.#tasks.get(this.#driverOwners.get(turnKey) ?? "");
    task ??= [...this.#tasks.values()].find(
      (candidate) => candidate.state.connection.threadId === event.threadId
    );
    if (task === void 0) return;
    const driver = task.activeDriver;
    if (event.type === "thread-unavailable" && driver === null && task.state.status === "stopped" && task.state.connection.threadId === event.threadId) {
      task.state.connection.status = "unavailable";
      task.state.diagnostic = {
        code: "CODEX_THREAD_UNAVAILABLE",
        message: "Codex \u521B\u4F5C\u7EBF\u7A0B\u4E0D\u53EF\u7528\uFF1B\u7EE7\u7EED\u65F6\u5C06\u81EA\u52A8\u521B\u5EFA\u66FF\u4EE3\u7EBF\u7A0B\u3002"
      };
      return;
    }
    const isCurrent = driver !== null && driver.threadId === event.threadId && (event.turnId === void 0 || driver.turnId === event.turnId);
    if (!isCurrent) {
      task.state.diagnostic = {
        code: "LATE_DRIVER_CALLBACK_REJECTED",
        message: "\u5DF2\u62D2\u7EDD\u5931\u53BB\u5199\u6743\u7684\u65E7 Codex \u521B\u4F5C\u7EBF\u7A0B\u56DE\u8C03\uFF1B\u5F53\u524D\u4EFB\u52A1\u72B6\u6001\u672A\u6539\u53D8\u3002"
      };
      return;
    }
    if (event.type === "thread-unavailable") {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_THREAD_UNAVAILABLE");
      task.state.connection.status = "unavailable";
      task.state.diagnostic = {
        code: "CODEX_THREAD_UNAVAILABLE",
        message: "Codex \u521B\u4F5C\u7EBF\u7A0B\u4E0D\u53EF\u7528\uFF1B\u7EE7\u7EED\u65F6\u5C06\u81EA\u52A8\u521B\u5EFA\u66FF\u4EE3\u7EBF\u7A0B\u3002"
      };
      return;
    }
    if (event.status !== "completed" || event.output === void 0) {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_INTERRUPTED");
      task.state.diagnostic = {
        code: "CODEX_TURN_INTERRUPTED",
        message: boundedMessage(event.error, "Codex \u9A8C\u8BC1 Turn \u672A\u5B8C\u6210\u3002")
      };
      return;
    }
    let parsed;
    try {
      const value = JSON.parse(event.output);
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
      parsed = value;
    } catch {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_INTERRUPTED");
      task.state.diagnostic = {
        code: "HOST_VALIDATION_RESULT_INVALID",
        message: "Codex \u8FD4\u56DE\u4E86\u65E0\u6CD5\u9A8C\u8BC1\u7684\u7ED3\u6784\u5316\u7ED3\u679C\u3002"
      };
      return;
    }
    const summary = parsed.summary;
    const normalizedSummary = typeof summary === "string" ? summary.trim() : "";
    const valid = parsed.verificationToken === driver.verificationToken && parsed.projectId === task.request.projectId && parsed.sceneCount === task.request.sceneCount && typeof summary === "string" && normalizedSummary !== "" && summary.length <= 240;
    if (!valid) {
      task.activeDriver = null;
      this.#setStopped(task, "CODEX_INTERRUPTED");
      task.state.diagnostic = {
        code: "HOST_VALIDATION_IDENTITY_MISMATCH",
        message: "Codex \u7ED3\u679C\u672A\u901A\u8FC7\u4EFB\u52A1\u3001\u9A71\u52A8\u6216\u9879\u76EE\u8EAB\u4EFD\u6821\u9A8C\u3002"
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
      verification: { taskId: task.state.taskId, driverId: driver.id }
    };
    task.state.availableActions = availableActions("succeeded");
    task.state.checkpoint = null;
  }
};

// plugins/narracut/src/codex-app-server-host.ts
function objectValue(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function rpcError(method, error) {
  const message = error?.message?.trim() || "\u672A\u77E5 App Server \u9519\u8BEF";
  return new Error(`${method} \u5931\u8D25\uFF1A${message}`);
}
var CodexAppServerHost = class {
  #command;
  #commandArgs;
  #requestTimeoutMs;
  #listeners = /* @__PURE__ */ new Set();
  #pending = /* @__PURE__ */ new Map();
  #agentMessages = /* @__PURE__ */ new Map();
  #activeTurns = /* @__PURE__ */ new Map();
  #child = null;
  #lineReader = null;
  #ready = null;
  #requestId = 0;
  #stderrTail = "";
  #disposed = false;
  constructor(options = {}) {
    this.#command = options.command ?? (process.env.NARRACUT_CODEX_COMMAND?.trim() || "codex");
    this.#commandArgs = options.commandArgs ?? ["app-server", "--stdio"];
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 15e3;
  }
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  async createThread(input) {
    await this.#ensureReady();
    const result = await this.#request("thread/start", {
      cwd: input.projectDirectory,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "narracut-host-validation",
      developerInstructions: [
        "\u4F60\u6B63\u5728\u6267\u884C Narracut \u7684\u56FA\u5B9A\u5BBF\u4E3B\u8FB9\u754C\u9A8C\u8BC1\u3002",
        "\u53EA\u5141\u8BB8\u8BFB\u53D6\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\uFF1B\u4E0D\u5F97\u521B\u5EFA\u3001\u4FEE\u6539\u6216\u5220\u9664\u6587\u4EF6\uFF0C\u4E0D\u5F97\u8BBF\u95EE\u7F51\u7EDC\u3002",
        "\u6700\u7EC8\u54CD\u5E94\u5FC5\u987B\u4E25\u683C\u7B26\u5408 turn/start \u63D0\u4F9B\u7684 outputSchema\u3002"
      ].join("\n")
    });
    const threadId = result.thread?.id;
    if (typeof threadId !== "string" || threadId === "") {
      throw new Error("thread/start \u672A\u8FD4\u56DE Codex Thread ID\u3002");
    }
    return { threadId };
  }
  async resumeThread(input) {
    await this.#ensureReady();
    let result;
    try {
      result = await this.#request("thread/resume", {
        threadId: input.threadId,
        cwd: input.projectDirectory,
        approvalPolicy: "never",
        sandbox: "read-only",
        excludeTurns: true
      });
    } catch {
      throw new CodexThreadUnavailableError(input.threadId);
    }
    const threadId = result.thread?.id;
    if (threadId !== input.threadId) throw new CodexThreadUnavailableError(input.threadId);
    return { threadId: input.threadId };
  }
  async startTurn(input) {
    await this.#ensureReady();
    const result = await this.#request("turn/start", {
      threadId: input.threadId,
      input: [{ type: "text", text: input.prompt, text_elements: [] }],
      cwd: input.projectDirectory,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      outputSchema: input.outputSchema
    });
    const turnId = result.turn?.id;
    if (typeof turnId !== "string" || turnId === "") {
      throw new Error("turn/start \u672A\u8FD4\u56DE Codex Turn ID\u3002");
    }
    this.#activeTurns.set(input.threadId, turnId);
    return { turnId };
  }
  async interruptTurn(input) {
    await this.#ensureReady();
    await this.#request("turn/interrupt", input);
  }
  async dispose() {
    this.#disposed = true;
    const child = this.#child;
    const error = new Error("Codex App Server \u5DF2\u5173\u95ED\u3002");
    if (child !== null) this.#shutdownChild(child, error, false);
    else this.#clearTransientState(error);
  }
  async #ensureReady() {
    if (this.#disposed) throw new Error("Codex App Server \u9002\u914D\u5668\u5DF2\u5173\u95ED\u3002");
    if (this.#ready !== null) return this.#ready;
    this.#ready = this.#start();
    try {
      await this.#ready;
    } catch (error) {
      this.#ready = null;
      throw error;
    }
  }
  async #start() {
    const child = spawn(this.#command, this.#commandArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });
    this.#child = child;
    this.#stderrTail = "";
    this.#lineReader = createInterface({ input: child.stdout });
    this.#lineReader.on("line", (line) => this.#handleLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.#stderrTail = `${this.#stderrTail}${chunk}`.slice(-2e3);
    });
    child.once("error", (error) => this.#handleExit(child, error));
    child.once("exit", (code, signal) => {
      if (this.#child !== child) return;
      const detail = this.#stderrTail.trim();
      this.#handleExit(child, new Error(
        detail || `Codex App Server \u5DF2\u9000\u51FA\uFF08code=${String(code)}, signal=${String(signal)}\uFF09\u3002`
      ));
    });
    try {
      await this.#request("initialize", {
        clientInfo: { name: "narracut", title: "Narracut", version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false }
      });
      this.#notify("initialized");
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.#shutdownChild(child, reason, false);
      throw reason;
    }
  }
  #request(method, params) {
    const child = this.#child;
    if (child === null || child.stdin.destroyed) {
      return Promise.reject(new Error("Codex App Server \u672A\u8FDE\u63A5\u3002"));
    }
    const id = ++this.#requestId;
    return new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending.delete(id)) return;
        const error = new Error(`${method} \u8D85\u8FC7 ${this.#requestTimeoutMs}ms \u672A\u54CD\u5E94\u3002`);
        reject(error);
        this.#handleExit(child, error);
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { method, resolve: resolve3, reject, timer });
      child.stdin.write(`${JSON.stringify({ method, id, params })}
`, (error) => {
        if (error === null || error === void 0) return;
        const pending = this.#pending.get(id);
        if (pending === void 0) return;
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        reject(error);
        this.#handleExit(child, error);
      });
    });
  }
  #notify(method, params = {}) {
    const child = this.#child;
    if (child === null || child.stdin.destroyed) return;
    child.stdin.write(`${JSON.stringify({ method, params })}
`);
  }
  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      const child = this.#child;
      if (child !== null) this.#handleExit(child, new Error("Codex App Server \u8FD4\u56DE\u4E86\u65E0\u6548 JSON\u3002"));
      return;
    }
    if (message.id !== void 0 && message.method === void 0) {
      const pending = this.#pending.get(message.id);
      if (pending === void 0) return;
      clearTimeout(pending.timer);
      this.#pending.delete(message.id);
      if (message.error !== void 0) pending.reject(rpcError(pending.method, message.error));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== void 0 && message.method !== void 0) {
      this.#child?.stdin.write(`${JSON.stringify({
        id: message.id,
        error: { code: -32601, message: `Narracut \u4E0D\u652F\u6301\u5BBF\u4E3B\u8BF7\u6C42 ${message.method}\u3002` }
      })}
`);
      return;
    }
    const params = objectValue(message.params);
    if (message.method === "item/completed" && params !== null) {
      const item = objectValue(params.item);
      if (typeof params.threadId === "string" && typeof params.turnId === "string" && item?.type === "agentMessage" && typeof item.text === "string") {
        this.#agentMessages.set(`${params.threadId}:${params.turnId}`, item.text);
      }
      return;
    }
    if (message.method === "turn/completed" && params !== null) {
      const threadId = params.threadId;
      const turn = objectValue(params.turn);
      const turnId = turn?.id;
      const status = turn?.status;
      if (turn === null || typeof threadId !== "string" || typeof turnId !== "string" || status !== "completed" && status !== "interrupted" && status !== "failed") return;
      const items = Array.isArray(turn.items) ? turn.items : [];
      const finalMessage = items.map(objectValue).filter((item) => item?.type === "agentMessage" && typeof item.text === "string").at(-1)?.text;
      const messageKey = `${threadId}:${turnId}`;
      const output = typeof finalMessage === "string" ? finalMessage : this.#agentMessages.get(messageKey);
      this.#agentMessages.delete(messageKey);
      this.#activeTurns.delete(threadId);
      this.#emit({
        type: "turn-completed",
        threadId,
        turnId,
        status,
        ...output === void 0 ? {} : { output },
        ...turn.error === null || turn.error === void 0 ? {} : { error: JSON.stringify(turn.error).slice(0, 240) }
      });
      return;
    }
    if ((message.method === "thread/closed" || message.method === "thread/deleted") && params !== null) {
      const threadId = params.threadId;
      if (typeof threadId !== "string") return;
      const turnId = this.#activeTurns.get(threadId);
      this.#activeTurns.delete(threadId);
      if (turnId !== void 0) this.#agentMessages.delete(`${threadId}:${turnId}`);
      this.#emit({
        type: "thread-unavailable",
        threadId,
        turnId
      });
    }
  }
  #clearTransientState(error) {
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
  #shutdownChild(child, error, emitUnavailable) {
    if (this.#child !== child) return;
    this.#child = null;
    this.#ready = null;
    this.#clearTransientState(error);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (emitUnavailable && !this.#disposed) {
      this.#emit({ type: "host-unavailable", error: error.message });
    }
  }
  #handleExit(child, error) {
    this.#shutdownChild(child, error, true);
  }
  #emit(event) {
    for (const listener of this.#listeners) listener(event);
  }
};

// src/server/project-vnext-inspection.ts
import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// src/server/strict-json.ts
var StrictJsonFailure = class extends Error {
  constructor(code, message, jsonPath, metric, actual, limit) {
    super(message);
    this.code = code;
    this.jsonPath = jsonPath;
    this.metric = metric;
    this.actual = actual;
    this.limit = limit;
    this.name = "StrictJsonFailure";
  }
  code;
  jsonPath;
  metric;
  actual;
  limit;
};
function childPath(parent, key) {
  return /^[A-Za-z_$][\w$]*$/u.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}
function utf8Length(codePoint) {
  if (codePoint <= 127) return 1;
  if (codePoint <= 2047) return 2;
  if (codePoint <= 65535) return 3;
  return 4;
}
function parseStrictJson(input, limits) {
  let cursor = 0;
  let arrayItems = 0;
  let objectFields = 0;
  let nodes = 0;
  const invalid = (message, path) => {
    throw new StrictJsonFailure("PROJECT_CONTROL_FILE_INVALID_JSON", message, path);
  };
  const exceeded = (metric, actual, limit, path) => {
    throw new StrictJsonFailure(
      "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      `JSON \u7684 ${metric} \u4E3A ${actual}\uFF0C\u8D85\u8FC7\u4E0A\u9650 ${limit}\uFF1B\u8BF7\u7F29\u51CF\u8BE5\u5185\u5BB9\u540E\u91CD\u8BD5\u3002`,
      path,
      metric,
      actual,
      limit
    );
  };
  const whitespace = () => {
    while (cursor < input.length && /[\u0009\u000a\u000d\u0020]/u.test(input[cursor])) cursor += 1;
  };
  const accountNode = (path) => {
    nodes += 1;
    if (nodes > limits.maxNodes) exceeded("nodes", nodes, limits.maxNodes, path);
  };
  const accountString = (scalars, bytes, path) => {
    if (scalars > limits.maxStringScalars) {
      exceeded("stringScalars", scalars, limits.maxStringScalars, path);
    }
    if (bytes > limits.maxStringBytes) {
      exceeded("stringBytes", bytes, limits.maxStringBytes, path);
    }
  };
  const stringToken = (path, decode) => {
    const start = cursor;
    if (input[cursor] !== '"') invalid("JSON \u5B57\u7B26\u4E32\u7F3A\u5C11\u8D77\u59CB\u5F15\u53F7\u3002", path);
    cursor += 1;
    let scalars = 0;
    let bytes = 0;
    while (cursor < input.length) {
      const codeUnit = input.charCodeAt(cursor);
      if (codeUnit === 34) {
        cursor += 1;
        accountString(scalars, bytes, path);
        return decode ? JSON.parse(input.slice(start, cursor)) : void 0;
      }
      if (codeUnit < 32) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u672A\u8F6C\u4E49\u63A7\u5236\u5B57\u7B26\u3002", path);
      if (codeUnit === 92) {
        const escape = input[cursor + 1];
        if (escape === void 0) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u672A\u5B8C\u6210\u7684\u8F6C\u4E49\u3002", path);
        if ('"\\/bfnrt'.includes(escape)) {
          scalars += 1;
          bytes += 1;
          cursor += 2;
          accountString(scalars, bytes, path);
          continue;
        }
        if (escape !== "u") invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u975E\u6CD5\u8F6C\u4E49\u3002", path);
        const firstHex = input.slice(cursor + 2, cursor + 6);
        if (!/^[0-9a-fA-F]{4}$/u.test(firstHex)) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u975E\u6CD5 Unicode \u8F6C\u4E49\u3002", path);
        const first = Number.parseInt(firstHex, 16);
        let codePoint2 = first;
        let width2 = 6;
        if (first >= 55296 && first <= 56319) {
          if (input.slice(cursor + 6, cursor + 8) !== "\\u") {
            invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u5B64\u7ACB\u7684\u9AD8\u4F4D\u4EE3\u7406\u9879\u3002", path);
          }
          const secondHex = input.slice(cursor + 8, cursor + 12);
          if (!/^[0-9a-fA-F]{4}$/u.test(secondHex)) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u975E\u6CD5 Unicode \u8F6C\u4E49\u3002", path);
          const second = Number.parseInt(secondHex, 16);
          if (second < 56320 || second > 57343) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u5B64\u7ACB\u7684\u9AD8\u4F4D\u4EE3\u7406\u9879\u3002", path);
          codePoint2 = 65536 + (first - 55296 << 10) + second - 56320;
          width2 = 12;
        } else if (first >= 56320 && first <= 57343) {
          invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u5B64\u7ACB\u7684\u4F4E\u4F4D\u4EE3\u7406\u9879\u3002", path);
        }
        scalars += 1;
        bytes += utf8Length(codePoint2);
        cursor += width2;
        accountString(scalars, bytes, path);
        continue;
      }
      let codePoint = codeUnit;
      let width = 1;
      if (codeUnit >= 55296 && codeUnit <= 56319) {
        const second = input.charCodeAt(cursor + 1);
        if (!(second >= 56320 && second <= 57343)) invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u5B64\u7ACB\u7684\u9AD8\u4F4D\u4EE3\u7406\u9879\u3002", path);
        codePoint = 65536 + (codeUnit - 55296 << 10) + second - 56320;
        width = 2;
      } else if (codeUnit >= 56320 && codeUnit <= 57343) {
        invalid("JSON \u5B57\u7B26\u4E32\u5305\u542B\u5B64\u7ACB\u7684\u4F4E\u4F4D\u4EE3\u7406\u9879\u3002", path);
      }
      scalars += 1;
      bytes += utf8Length(codePoint);
      cursor += width;
      accountString(scalars, bytes, path);
    }
    return invalid("JSON \u5B57\u7B26\u4E32\u7F3A\u5C11\u7ED3\u675F\u5F15\u53F7\u3002", path);
  };
  const parseValue = (depth, path) => {
    if (depth > limits.maxDepth) exceeded("depth", depth, limits.maxDepth, path);
    accountNode(path);
    whitespace();
    const current = input[cursor];
    if (current === "{") {
      cursor += 1;
      whitespace();
      const keys = /* @__PURE__ */ new Set();
      if (input[cursor] === "}") {
        cursor += 1;
        return;
      }
      while (true) {
        whitespace();
        const key = stringToken(path, true);
        const valuePath = childPath(path, key);
        objectFields += 1;
        if (objectFields > limits.maxObjectFields) {
          exceeded("objectFields", objectFields, limits.maxObjectFields, valuePath);
        }
        if (keys.has(key)) {
          throw new StrictJsonFailure(
            "PROJECT_CONTROL_FILE_DUPLICATE_FIELD",
            `JSON \u5B57\u6BB5 ${valuePath} \u91CD\u590D\uFF1B\u8BF7\u53EA\u4FDD\u7559\u4E00\u4E2A\u5B57\u6BB5\u3002`,
            valuePath
          );
        }
        keys.add(key);
        whitespace();
        if (input[cursor] !== ":") invalid("JSON \u5BF9\u8C61\u5B57\u6BB5\u540D\u540E\u7F3A\u5C11\u5192\u53F7\u3002", valuePath);
        cursor += 1;
        parseValue(depth + 1, valuePath);
        whitespace();
        if (input[cursor] === "}") {
          cursor += 1;
          return;
        }
        if (input[cursor] !== ",") invalid("JSON \u5BF9\u8C61\u5B57\u6BB5\u4E4B\u95F4\u7F3A\u5C11\u9017\u53F7\u3002", path);
        cursor += 1;
      }
    }
    if (current === "[") {
      if (limits.forbidArrays) exceeded("arrays", 1, 0, path);
      cursor += 1;
      whitespace();
      if (input[cursor] === "]") {
        cursor += 1;
        return;
      }
      let index = 0;
      while (true) {
        arrayItems += 1;
        if (arrayItems > limits.maxArrayItems) {
          exceeded("arrayItems", arrayItems, limits.maxArrayItems, `${path}[${index}]`);
        }
        parseValue(depth + 1, `${path}[${index}]`);
        index += 1;
        whitespace();
        if (input[cursor] === "]") {
          cursor += 1;
          return;
        }
        if (input[cursor] !== ",") invalid("JSON \u6570\u7EC4\u9879\u4E4B\u95F4\u7F3A\u5C11\u9017\u53F7\u3002", path);
        cursor += 1;
      }
    }
    if (current === '"') {
      stringToken(path, false);
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (input.startsWith(literal, cursor)) {
        cursor += literal.length;
        return;
      }
    }
    const number = input.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (number !== void 0) {
      if (number.length > limits.maxNumberBytes) {
        exceeded("numberBytes", number.length, limits.maxNumberBytes, path);
      }
      cursor += number.length;
      return;
    }
    invalid("JSON \u5305\u542B\u975E\u6CD5\u503C\u3002", path);
  };
  whitespace();
  parseValue(1, "$");
  whitespace();
  if (cursor !== input.length) invalid("JSON \u6839\u503C\u540E\u5B58\u5728\u989D\u5916\u5185\u5BB9\u3002", "$");
  return JSON.parse(input);
}

// src/server/project-vnext-inspection.ts
var ProjectInspectionError = class extends Error {
  constructor(code, path, message, diagnostics = [], options) {
    super(message, options);
    this.code = code;
    this.path = path;
    this.diagnostics = diagnostics;
    this.name = "ProjectInspectionError";
  }
  code;
  path;
  diagnostics;
};
function invalidControlFile(path, diagnostic, options) {
  return new ProjectInspectionError(
    "PROJECT_CONTENT_INVALID",
    path,
    diagnostic.message,
    [diagnostic],
    options
  );
}
function invalidContent(path, diagnostics) {
  const first = diagnostics[0];
  return new ProjectInspectionError(
    "PROJECT_CONTENT_INVALID",
    path,
    first?.message ?? "Project VNext \u5185\u5BB9\u65E0\u6548\uFF1B\u8BF7\u4FEE\u590D\u62A5\u544A\u7684\u95EE\u9898\u540E\u91CD\u8BD5\u3002",
    diagnostics
  );
}
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function compareStableText(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function jsonPropertyPath(parent, key) {
  return /^[A-Za-z_$][\w$]*$/u.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}
function validateProjectManifest(manifest) {
  const diagnostics = [];
  for (const key of Object.keys(manifest)) {
    if (!["kind", "formatVersion", "projectId"].includes(key)) {
      diagnostics.push({
        code: "PROJECT_MANIFEST_SCHEMA_INVALID",
        component: "narracut.json",
        jsonPath: jsonPropertyPath("$", key),
        message: `narracut.json \u5305\u542B\u672A\u77E5\u5B57\u6BB5 ${key}\uFF1B\u8BF7\u5220\u9664\u8BE5\u5B57\u6BB5\u3002`
      });
    }
  }
  if (!Number.isInteger(manifest.formatVersion)) {
    diagnostics.push({
      code: "PROJECT_MANIFEST_SCHEMA_INVALID",
      component: "narracut.json",
      jsonPath: "$.formatVersion",
      message: "formatVersion \u5FC5\u987B\u662F\u6574\u6570 1\uFF1B\u8BF7\u4FEE\u6B63\u9879\u76EE\u6E05\u5355\u3002"
    });
  }
  if (typeof manifest.projectId !== "string" || !UUID_PATTERN.test(manifest.projectId)) {
    diagnostics.push({
      code: "PROJECT_MANIFEST_SCHEMA_INVALID",
      component: "narracut.json",
      jsonPath: "$.projectId",
      message: "projectId \u5FC5\u987B\u662F\u89C4\u8303\u7684\u5C0F\u5199 UUID\uFF1B\u8BF7\u4F7F\u7528\u6709\u6548\u9879\u76EE\u6E05\u5355\u3002"
    });
  }
  return diagnostics.sort((left, right) => compareStableText(
    `${left.jsonPath}${left.code}`,
    `${right.jsonPath}${right.code}`
  ));
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function schemaDiagnostic(code, jsonPath, message) {
  return { code, component: "project.json", jsonPath, message };
}
function unknownFields(value, allowed, jsonPath, diagnostics) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      diagnostics.push(schemaDiagnostic(
        "PROJECT_DSL_SCHEMA_INVALID",
        jsonPropertyPath(jsonPath, key),
        `${jsonPath} \u5305\u542B\u672A\u77E5\u5B57\u6BB5 ${key}\uFF1B\u8BF7\u5220\u9664\u8BE5\u5B57\u6BB5\u3002`
      ));
    }
  }
}
function isCanonicalResourcePath(value, root) {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\") || value.includes("\0") || [...value].length > 1024 || Buffer.byteLength(value, "utf8") > 1024) return false;
  const parts = value.split("/");
  return parts[0] === root && parts.length > 1 && parts.every((part) => part !== "" && part !== "." && part !== "..");
}
function boundedDiagnostics(diagnostics) {
  const unique = /* @__PURE__ */ new Map();
  for (const diagnostic of diagnostics) {
    const identity = `${diagnostic.jsonPath ?? ""}${diagnostic.code}${diagnostic.message}`;
    if (!unique.has(identity)) unique.set(identity, diagnostic);
  }
  const sorted = [...unique.values()].sort((left, right) => compareStableText(
    `${left.jsonPath ?? ""}${left.code}`,
    `${right.jsonPath ?? ""}${right.code}`
  ));
  if (sorted.length <= 100) return sorted;
  return [
    ...sorted.slice(0, 99),
    {
      code: "DIAGNOSTICS_TRUNCATED",
      component: "project.json",
      message: `\u9879\u76EE\u8FD8\u6709 ${sorted.length - 99} \u6761\u95EE\u9898\u672A\u5C55\u793A\uFF1B\u8BF7\u5148\u4FEE\u590D\u5DF2\u5217\u95EE\u9898\u540E\u91CD\u65B0\u68C0\u67E5\u3002`,
      metric: "diagnostics",
      actual: sorted.length,
      limit: 100
    }
  ];
}
function validateProjectDsl(value) {
  const diagnostics = [];
  if (!isRecord(value)) {
    return {
      diagnostics: [schemaDiagnostic(
        "PROJECT_DSL_SCHEMA_INVALID",
        "$",
        "project.json \u6839\u503C\u5FC5\u987B\u662F\u5BF9\u8C61\uFF1B\u8BF7\u63D0\u4F9B assets \u4E0E scenes\u3002"
      )]
    };
  }
  unknownFields(value, ["assets", "scenes"], "$", diagnostics);
  const assets = value.assets;
  const scenes = value.scenes;
  if (!Array.isArray(assets)) {
    diagnostics.push(schemaDiagnostic(
      "PROJECT_DSL_SCHEMA_INVALID",
      "$.assets",
      "assets \u5FC5\u987B\u662F\u6570\u7EC4\uFF1B\u8BF7\u4FEE\u6B63 Project DSL\u3002"
    ));
  }
  if (!Array.isArray(scenes)) {
    diagnostics.push(schemaDiagnostic(
      "PROJECT_DSL_SCHEMA_INVALID",
      "$.scenes",
      "scenes \u5FC5\u987B\u662F\u6570\u7EC4\uFF1B\u8BF7\u4FEE\u6B63 Project DSL\u3002"
    ));
  }
  if (!Array.isArray(assets) || !Array.isArray(scenes)) {
    return { diagnostics: boundedDiagnostics(diagnostics) };
  }
  if (assets.length > 1e3) {
    return { diagnostics: [{
      code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      component: "project.json",
      jsonPath: "$.assets[1000]",
      message: `assets \u6709 ${assets.length} \u9879\uFF0C\u8D85\u8FC7\u4E0A\u9650 1000\uFF1B\u8BF7\u79FB\u9664\u591A\u4F59 Asset\u3002`,
      metric: "assets",
      actual: assets.length,
      limit: 1e3
    }] };
  }
  if (scenes.length > 1e3) {
    return { diagnostics: [{
      code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      component: "project.json",
      jsonPath: "$.scenes[1000]",
      message: `scenes \u6709 ${scenes.length} \u9879\uFF0C\u8D85\u8FC7\u4E0A\u9650 1000\uFF1B\u8BF7\u79FB\u9664\u591A\u4F59 Scene\u3002`,
      metric: "scenes",
      actual: scenes.length,
      limit: 1e3
    }] };
  }
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    if (isRecord(asset) && typeof asset.path === "string") {
      const bytes = Buffer.byteLength(asset.path, "utf8");
      const scalars = [...asset.path].length;
      if (bytes > 1024) {
        return { diagnostics: [{
          code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
          component: "project.json",
          jsonPath: `$.assets[${index}].path`,
          message: `Asset path \u4E3A ${bytes} UTF-8 \u5B57\u8282\uFF0C\u8D85\u8FC7\u4E0A\u9650 1024\uFF1B\u8BF7\u7F29\u77ED\u8DEF\u5F84\u3002`,
          metric: "pathBytes",
          actual: bytes,
          limit: 1024
        }] };
      }
      if (scalars > 1024) {
        return { diagnostics: [{
          code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
          component: "project.json",
          jsonPath: `$.assets[${index}].path`,
          message: `Asset path \u6709 ${scalars} \u4E2A Unicode \u6807\u91CF\uFF0C\u8D85\u8FC7\u4E0A\u9650 1024\uFF1B\u8BF7\u7F29\u77ED\u8DEF\u5F84\u3002`,
          metric: "pathScalars",
          actual: scalars,
          limit: 1024
        }] };
      }
    }
  }
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (!isRecord(scene)) continue;
    if (Array.isArray(scene.assetIds) && scene.assetIds.length > 256) {
      return { diagnostics: [{
        code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
        component: "project.json",
        jsonPath: `$.scenes[${index}].assetIds[256]`,
        message: `Scene \u7684 assetIds \u6709 ${scene.assetIds.length} \u9879\uFF0C\u8D85\u8FC7\u4E0A\u9650 256\uFF1B\u8BF7\u79FB\u9664\u591A\u4F59\u5F15\u7528\u3002`,
        metric: "sceneAssetIds",
        actual: scene.assetIds.length,
        limit: 256
      }] };
    }
    if (isRecord(scene.speech)) {
      if (typeof scene.speech.path === "string") {
        const bytes = Buffer.byteLength(scene.speech.path, "utf8");
        const scalars = [...scene.speech.path].length;
        if (bytes > 1024 || scalars > 1024) {
          const metric = bytes > 1024 ? "pathBytes" : "pathScalars";
          const actual = bytes > 1024 ? bytes : scalars;
          return { diagnostics: [{
            code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
            component: "project.json",
            jsonPath: `$.scenes[${index}].speech.path`,
            message: `Speech path \u7684 ${metric} \u4E3A ${actual}\uFF0C\u8D85\u8FC7\u4E0A\u9650 1024\uFF1B\u8BF7\u7F29\u77ED\u8DEF\u5F84\u3002`,
            metric,
            actual,
            limit: 1024
          }] };
        }
      }
      if (typeof scene.speech.ttsProfileId === "string" && [...scene.speech.ttsProfileId].length > 256) {
        const actual = [...scene.speech.ttsProfileId].length;
        return { diagnostics: [{
          code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
          component: "project.json",
          jsonPath: `$.scenes[${index}].speech.ttsProfileId`,
          message: `ttsProfileId \u6709 ${actual} \u4E2A Unicode \u6807\u91CF\uFF0C\u8D85\u8FC7\u4E0A\u9650 256\uFF1B\u8BF7\u7F29\u77ED\u8BE5\u6807\u8BC6\u3002`,
          metric: "ttsProfileIdScalars",
          actual,
          limit: 256
        }] };
      }
    }
  }
  const assetIds = /* @__PURE__ */ new Set();
  const assetPaths = /* @__PURE__ */ new Set();
  assets.forEach((asset, index) => {
    const path = `$.assets[${index}]`;
    if (!isRecord(asset)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", path, `${path} \u5FC5\u987B\u662F Asset \u5BF9\u8C61\u3002`));
      return;
    }
    unknownFields(asset, ["id", "path"], path, diagnostics);
    if (typeof asset.id !== "string" || !UUID_PATTERN.test(asset.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.id`, "Asset id \u5FC5\u987B\u662F\u89C4\u8303\u7684\u5C0F\u5199 UUID\u3002"));
    } else if (assetIds.has(asset.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_ID_DUPLICATE", `${path}.id`, `Asset id ${asset.id} \u91CD\u590D\uFF1B\u8BF7\u4E3A\u6BCF\u4E2A Asset \u4F7F\u7528\u552F\u4E00 ID\u3002`));
    } else {
      assetIds.add(asset.id);
    }
    if (typeof asset.path !== "string" || !isCanonicalResourcePath(asset.path, "assets")) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_PATH_INVALID", `${path}.path`, "Asset path \u5FC5\u987B\u662F assets/ \u4E0B\u7684\u89C4\u8303\u9879\u76EE\u76F8\u5BF9\u8DEF\u5F84\u3002"));
    } else if (assetPaths.has(asset.path)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_PATH_DUPLICATE", `${path}.path`, `Asset path ${asset.path} \u91CD\u590D\uFF1B\u8BF7\u4F7F\u7528\u552F\u4E00\u8DEF\u5F84\u3002`));
    } else {
      assetPaths.add(asset.path);
    }
  });
  const sceneIds = /* @__PURE__ */ new Set();
  scenes.forEach((scene, index) => {
    const path = `$.scenes[${index}]`;
    if (!isRecord(scene)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", path, `${path} \u5FC5\u987B\u662F Scene \u5BF9\u8C61\u3002`));
      return;
    }
    unknownFields(scene, ["id", "narration", "assetIds", "speech"], path, diagnostics);
    if (typeof scene.id !== "string" || !UUID_PATTERN.test(scene.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.id`, "Scene id \u5FC5\u987B\u662F\u89C4\u8303\u7684\u5C0F\u5199 UUID\u3002"));
    } else if (sceneIds.has(scene.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_ID_DUPLICATE", `${path}.id`, `Scene id ${scene.id} \u91CD\u590D\uFF1B\u8BF7\u4E3A\u6BCF\u4E2A Scene \u4F7F\u7528\u552F\u4E00 ID\u3002`));
    } else {
      sceneIds.add(scene.id);
    }
    if (!isRecord(scene.narration)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.narration`, "narration \u5FC5\u987B\u662F\u53EA\u542B text \u7684\u5BF9\u8C61\u3002"));
    } else {
      unknownFields(scene.narration, ["text"], `${path}.narration`, diagnostics);
      if (typeof scene.narration.text !== "string") {
        diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.narration.text`, "Narration text \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u3002"));
      }
    }
    if (!Array.isArray(scene.assetIds)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.assetIds`, "assetIds \u5FC5\u987B\u662F UUID \u6570\u7EC4\u3002"));
    } else {
      const references = /* @__PURE__ */ new Set();
      scene.assetIds.forEach((assetId, assetIndex) => {
        const referencePath = `${path}.assetIds[${assetIndex}]`;
        if (typeof assetId !== "string" || !UUID_PATTERN.test(assetId)) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", referencePath, "Asset \u5F15\u7528\u5FC5\u987B\u662F\u89C4\u8303\u7684\u5C0F\u5199 UUID\u3002"));
        } else if (references.has(assetId)) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_REFERENCE_DUPLICATE", referencePath, `Scene \u91CD\u590D\u5F15\u7528 Asset ${assetId}\uFF1B\u8BF7\u79FB\u9664\u91CD\u590D\u9879\u3002`));
        } else {
          references.add(assetId);
          if (!assetIds.has(assetId)) {
            diagnostics.push(schemaDiagnostic("PROJECT_DSL_REFERENCE_INVALID", referencePath, `Asset \u5F15\u7528 ${assetId} \u672A\u5728 assets \u4E2D\u767B\u8BB0\uFF1B\u8BF7\u767B\u8BB0\u6216\u79FB\u9664\u8BE5\u5F15\u7528\u3002`));
          }
        }
      });
    }
    if ("speech" in scene) {
      if (!isRecord(scene.speech)) {
        diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech`, "speech \u7F3A\u7701\u65F6\u5FC5\u987B\u7701\u7565\u5B57\u6BB5\uFF0C\u5B58\u5728\u65F6\u5FC5\u987B\u662F\u5B8C\u6574\u5BF9\u8C61\u3002"));
      } else {
        unknownFields(scene.speech, ["path", "durationMs", "sourceTextHash", "ttsProfileId"], `${path}.speech`, diagnostics);
        const expectedPath = typeof scene.id === "string" ? `speech/${scene.id}.mp3` : void 0;
        if (typeof scene.speech.path !== "string" || !isCanonicalResourcePath(scene.speech.path, "speech") || scene.speech.path !== expectedPath) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_PATH_INVALID", `${path}.speech.path`, `Speech path \u5FC5\u987B\u7CBE\u786E\u4E3A ${expectedPath ?? "speech/<sceneId>.mp3"}\u3002`));
        }
        if (!Number.isSafeInteger(scene.speech.durationMs) || scene.speech.durationMs <= 0) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech.durationMs`, "durationMs \u5FC5\u987B\u662F\u6B63\u5B89\u5168\u6574\u6570\u3002"));
        }
        const narrationText = isRecord(scene.narration) && typeof scene.narration.text === "string" ? scene.narration.text : void 0;
        const expectedHash = narrationText === void 0 ? void 0 : `sha256:${createHash("sha256").update(narrationText, "utf8").digest("hex")}`;
        if (typeof scene.speech.sourceTextHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(scene.speech.sourceTextHash) || expectedHash !== void 0 && scene.speech.sourceTextHash !== expectedHash) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SPEECH_MISMATCH", `${path}.speech.sourceTextHash`, "sourceTextHash \u5FC5\u987B\u5339\u914D\u5F53\u524D Narration \u7684\u539F\u59CB UTF-8 \u5B57\u8282\u3002"));
        }
        if (typeof scene.speech.ttsProfileId !== "string") {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech.ttsProfileId`, "ttsProfileId \u5FC5\u987B\u662F\u4E0D\u8D85\u8FC7 256 \u4E2A Unicode \u6807\u91CF\u7684\u5B57\u7B26\u4E32\u3002"));
        }
      }
    }
  });
  return {
    ...diagnostics.length === 0 ? { project: value } : {},
    diagnostics: boundedDiagnostics(diagnostics)
  };
}
function decodeUtf8(bytes, path, component, allowBom) {
  if (!allowBom && bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    throw invalidControlFile(path, {
      code: "PROJECT_CONTROL_FILE_INVALID_UTF8",
      component,
      message: `${component} \u4E0D\u5F97\u5305\u542B UTF-8 BOM\uFF1B\u8BF7\u79FB\u9664 BOM \u540E\u91CD\u8BD5\u3002`
    });
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: allowBom }).decode(bytes);
  } catch (cause) {
    throw invalidControlFile(path, {
      code: "PROJECT_CONTROL_FILE_INVALID_UTF8",
      component,
      message: `${component} \u4E0D\u662F\u4E25\u683C UTF-8\uFF1B\u8BF7\u4EE5 UTF-8 \u91CD\u65B0\u4FDD\u5B58\u540E\u91CD\u8BD5\u3002`
    }, { cause });
  }
}
var MANIFEST_JSON_LIMITS = {
  maxDepth: 4,
  maxArrayItems: 0,
  maxObjectFields: 16,
  maxNodes: 32,
  maxStringScalars: 256,
  maxStringBytes: 1024,
  maxNumberBytes: 64,
  forbidArrays: true
};
var PROJECT_JSON_LIMITS = {
  maxDepth: 8,
  maxArrayItems: 1e5,
  maxObjectFields: 32e3,
  maxNodes: 2e5,
  maxStringScalars: 65536,
  maxStringBytes: 256 * 1024,
  maxNumberBytes: 64
};
function parseControlJson(input, path, component, limits) {
  try {
    return parseStrictJson(input, limits);
  } catch (cause) {
    if (!(cause instanceof StrictJsonFailure)) throw cause;
    throw invalidControlFile(path, {
      code: cause.code,
      component,
      message: cause.message,
      jsonPath: cause.jsonPath,
      ...cause.metric === void 0 ? {} : { metric: cause.metric },
      ...cause.actual === void 0 ? {} : { actual: cause.actual },
      ...cause.limit === void 0 ? {} : { limit: cause.limit }
    }, { cause });
  }
}
async function readBoundedControlFile(path, component, limit) {
  const pathFacts = await lstat(path);
  if (!pathFacts.isFile() || pathFacts.isSymbolicLink() || pathFacts.nlink !== 1) {
    throw invalidControlFile(path, {
      code: "PROJECT_REQUIRED_CONTENT_INVALID",
      component,
      message: `${component} \u5FC5\u987B\u662F\u65E0\u7B26\u53F7\u94FE\u63A5\u3001\u65E0\u786C\u94FE\u63A5\u7684\u666E\u901A\u6587\u4EF6\uFF1B\u8BF7\u66FF\u6362\u8BE5\u8DEF\u5F84\u540E\u91CD\u8BD5\u3002`
    });
  }
  const handle = await open(path, "r");
  try {
    const facts = await handle.stat();
    if (!facts.isFile() || facts.dev !== pathFacts.dev || facts.ino !== pathFacts.ino) {
      throw invalidControlFile(path, {
        code: "PROJECT_REQUIRED_CONTENT_INVALID",
        component,
        message: `${component} \u5728\u68C0\u67E5\u671F\u95F4\u88AB\u66FF\u6362\uFF1B\u8BF7\u505C\u6B62\u5916\u90E8\u4FEE\u6539\u540E\u91CD\u8BD5\u3002`
      });
    }
    if (facts.size > limit) {
      throw invalidControlFile(path, {
        code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
        component,
        message: `${component} \u4E3A ${facts.size} \u5B57\u8282\uFF0C\u8D85\u8FC7\u4E0A\u9650 ${limit}\uFF1B\u8BF7\u7F29\u51CF\u6587\u4EF6\u540E\u91CD\u8BD5\u3002`,
        metric: "bytes",
        actual: facts.size,
        limit
      });
    }
    const bytes = Buffer.allocUnsafe(limit + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > limit) {
      throw invalidControlFile(path, {
        code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
        component,
        message: `${component} \u5728\u8BFB\u53D6\u671F\u95F4\u8D85\u8FC7 ${limit} \u5B57\u8282\uFF1B\u8BF7\u505C\u6B62\u5916\u90E8\u4FEE\u6539\u5E76\u7F29\u51CF\u6587\u4EF6\u540E\u91CD\u8BD5\u3002`,
        metric: "bytes",
        actual: total,
        limit
      });
    }
    return bytes.subarray(0, total);
  } finally {
    await handle.close();
  }
}
async function requireDirectory(path) {
  const facts = await lstat(path);
  if (!facts.isDirectory() || facts.isSymbolicLink()) throw new Error(`\u5FC5\u9700\u76EE\u5F55\u65E0\u6548\uFF1A${path}`);
}
async function requireFile(path) {
  const facts = await lstat(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1) {
    throw new Error(`\u5FC5\u9700\u6587\u4EF6\u65E0\u6548\uFF1A${path}`);
  }
}
function isFileSystemError(error) {
  return error instanceof Error && "code" in error;
}
function missingContent(path, component) {
  return invalidContent(path, [{
    code: "PROJECT_REQUIRED_CONTENT_MISSING",
    component,
    message: `\u7F3A\u5C11\u5FC5\u9700\u7684 ${component}\uFF1B\u8BF7\u6062\u590D\u5B8C\u6574 Project VNext \u5185\u5BB9\u540E\u91CD\u8BD5\u3002`
  }]);
}
function invalidResource(path, component, message) {
  return invalidContent(path, [{ code: "PROJECT_RESOURCE_INVALID", component, message }]);
}
async function validateOrdinaryResource(projectDirectory, relativePath, required) {
  const parts = relativePath.split("/");
  const directoryIdentities = [];
  for (let index = 0; index < parts.length; index += 1) {
    const component = parts.slice(0, index + 1).join("/");
    const path = join(projectDirectory, component);
    let facts;
    try {
      facts = await lstat(path);
    } catch (cause) {
      if (isFileSystemError(cause) && cause.code === "ENOENT" && !required) return;
      if (isFileSystemError(cause) && cause.code === "ENOENT") {
        throw missingContent(path, component);
      }
      throw new ProjectInspectionError(
        "PROJECT_PATH_UNAVAILABLE",
        path,
        `\u65E0\u6CD5\u68C0\u67E5\u8D44\u6E90 ${path}\uFF1B\u8BF7\u68C0\u67E5\u8DEF\u5F84\u548C\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
        [],
        { cause }
      );
    }
    const isLeaf = index === parts.length - 1;
    if (!isLeaf && (!facts.isDirectory() || facts.isSymbolicLink())) {
      throw invalidResource(
        path,
        component,
        `${component} \u5FC5\u987B\u662F\u65E0\u7B26\u53F7\u94FE\u63A5\u7684\u666E\u901A\u76EE\u5F55\uFF1B\u8BF7\u66FF\u6362\u8BE5\u8DEF\u5F84\u3002`
      );
    }
    if (!isLeaf) directoryIdentities.push({ path, dev: facts.dev, ino: facts.ino });
    if (isLeaf && (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1)) {
      throw invalidResource(
        path,
        relativePath,
        `${relativePath} \u5FC5\u987B\u662F\u65E0\u7B26\u53F7\u94FE\u63A5\u3001\u65E0\u786C\u94FE\u63A5\u7684\u666E\u901A\u6587\u4EF6\uFF1B\u8BF7\u66FF\u6362\u8BE5\u8D44\u6E90\u3002`
      );
    }
  }
  const resourcePath = join(projectDirectory, relativePath);
  const allowedRoot = await realpath(join(projectDirectory, parts[0]));
  const resolvedResource = await realpath(resourcePath);
  const relation = relative(allowedRoot, resolvedResource);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw invalidResource(
      resourcePath,
      relativePath,
      `${relativePath} \u89E3\u6790\u5230 ${allowedRoot} \u4E4B\u5916\uFF1B\u8BF7\u79FB\u9664\u8DEF\u5F84\u4E2D\u7684\u94FE\u63A5\u3002`
    );
  }
  for (const identity of directoryIdentities) {
    const current = await lstat(identity.path);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) {
      throw invalidResource(
        identity.path,
        relative(projectDirectory, identity.path),
        `${relative(projectDirectory, identity.path)} \u5728\u68C0\u67E5\u671F\u95F4\u88AB\u66FF\u6362\uFF1B\u8BF7\u505C\u6B62\u5916\u90E8\u4FEE\u6539\u540E\u91CD\u8BD5\u3002`
      );
    }
  }
}
async function readStableDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareStableText(left.name, right.name));
  return entries;
}
var MAX_DIRECTORY_TREE_DEPTH = 32;
var MAX_DIRECTORY_TREE_DIRECTORIES = 4096;
function directoryTreeLimit(projectDirectory, path, metric, actual, limit) {
  const component = relative(projectDirectory, path) || ".";
  return invalidControlFile(path, {
    code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
    component,
    metric,
    actual,
    limit,
    message: `${component} \u7684${metric === "directoryDepth" ? "\u76EE\u5F55\u6DF1\u5EA6" : "\u5DF2\u68C0\u67E5\u76EE\u5F55\u6570"}\u4E3A ${actual}\uFF0C\u8D85\u8FC7\u4E0A\u9650 ${limit}\uFF1B\u8BF7\u7CBE\u7B80\u9879\u76EE\u5185\u90E8\u6811\u540E\u91CD\u8BD5\u3002`
  });
}
async function discoverRenderProgramDirectories(projectDirectory) {
  const excludedRoots = /* @__PURE__ */ new Set(["assets", "speech", "renders"]);
  const stack = [{ directory: projectDirectory, depth: 0 }];
  const programs = [];
  let directoriesVisited = 0;
  while (stack.length > 0) {
    const { directory, depth } = stack.pop();
    directoriesVisited += 1;
    if (directoriesVisited > MAX_DIRECTORY_TREE_DIRECTORIES) {
      throw directoryTreeLimit(projectDirectory, directory, "directories", directoriesVisited, MAX_DIRECTORY_TREE_DIRECTORIES);
    }
    let entries;
    try {
      entries = await readStableDirectory(directory);
    } catch (cause) {
      throw new ProjectInspectionError(
        "PROJECT_PATH_UNAVAILABLE",
        directory,
        `\u65E0\u6CD5\u68C0\u67E5\u9879\u76EE\u5185\u5BB9\u76EE\u5F55 ${directory}\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
        [],
        { cause }
      );
    }
    for (const entry of [...entries].reverse()) {
      if (directory === projectDirectory && excludedRoots.has(entry.name)) continue;
      if (["node_modules", ".cache", "bundle"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      const facts = await lstat(path);
      if (facts.isSymbolicLink() || !facts.isDirectory()) continue;
      const childDepth = depth + 1;
      if (childDepth > MAX_DIRECTORY_TREE_DEPTH) {
        throw directoryTreeLimit(projectDirectory, path, "directoryDepth", childDepth, MAX_DIRECTORY_TREE_DEPTH);
      }
      if (entry.name === "render-program") {
        programs.push(path);
      } else {
        stack.push({ directory: path, depth: childDepth });
      }
    }
  }
  programs.sort(compareStableText);
  return programs;
}
async function validateRenderProgramDirectory(projectDirectory, programDirectory) {
  const projectRoot = await realpath(projectDirectory);
  const resolvedProgram = await realpath(programDirectory);
  const programRelation = relative(projectRoot, resolvedProgram);
  if (programRelation === ".." || programRelation.startsWith(`..${sep}`) || isAbsolute(programRelation)) {
    throw invalidResource(
      programDirectory,
      relative(projectDirectory, programDirectory),
      "Render Program \u89E3\u6790\u5230\u9879\u76EE\u76EE\u5F55\u4E4B\u5916\uFF1B\u8BF7\u79FB\u9664\u7236\u8DEF\u5F84\u4E2D\u7684\u94FE\u63A5\u3002"
    );
  }
  const requiredEntries = [
    ["program.json", "file"],
    ["package.json", "file"],
    ["pnpm-lock.yaml", "file"],
    ["src", "directory"],
    ["src/RenderProgram.tsx", "file"],
    ["resources", "directory"]
  ];
  for (const [entry, kind] of requiredEntries) {
    const path = join(programDirectory, ...entry.split("/"));
    let facts;
    try {
      facts = await lstat(path);
    } catch (cause) {
      if (isFileSystemError(cause) && cause.code === "ENOENT") {
        throw missingContent(path, relative(projectDirectory, path));
      }
      throw new ProjectInspectionError(
        "PROJECT_PATH_UNAVAILABLE",
        path,
        `\u65E0\u6CD5\u68C0\u67E5 Render Program \u8DEF\u5F84 ${path}\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
        [],
        { cause }
      );
    }
    const valid = kind === "directory" ? facts.isDirectory() && !facts.isSymbolicLink() : facts.isFile() && !facts.isSymbolicLink() && facts.nlink === 1;
    if (!valid) {
      throw invalidResource(
        path,
        relative(projectDirectory, path),
        `${relative(projectDirectory, path)} \u5FC5\u987B\u662F\u65E0\u94FE\u63A5\u7684\u666E\u901A${kind === "directory" ? "\u76EE\u5F55" : "\u6587\u4EF6"}\u3002`
      );
    }
  }
  const stack = [{ directory: programDirectory, depth: 0 }];
  let directoriesVisited = 0;
  while (stack.length > 0) {
    const { directory, depth } = stack.pop();
    directoriesVisited += 1;
    if (directoriesVisited > MAX_DIRECTORY_TREE_DIRECTORIES) {
      throw directoryTreeLimit(projectDirectory, directory, "directories", directoriesVisited, MAX_DIRECTORY_TREE_DIRECTORIES);
    }
    for (const entry of [...await readStableDirectory(directory)].reverse()) {
      const path = join(directory, entry.name);
      const component = relative(projectDirectory, path);
      if (["node_modules", ".cache", "bundle"].includes(entry.name)) {
        throw invalidResource(path, component, `Render Program \u4E0D\u5F97\u643A\u5E26 ${entry.name} \u6D3E\u751F\u4EA7\u7269\uFF1B\u8BF7\u5C06\u5176\u79FB\u51FA\u9879\u76EE\u3002`);
      }
      const facts = await lstat(path);
      if (facts.isSymbolicLink()) {
        throw invalidResource(path, component, `${component} \u662F\u7B26\u53F7\u94FE\u63A5\uFF1BRender Program \u6811\u53EA\u5141\u8BB8\u666E\u901A\u6587\u4EF6\u548C\u76EE\u5F55\u3002`);
      }
      if (facts.isDirectory()) {
        const childDepth = depth + 1;
        if (childDepth > MAX_DIRECTORY_TREE_DEPTH) {
          throw directoryTreeLimit(projectDirectory, path, "directoryDepth", childDepth, MAX_DIRECTORY_TREE_DEPTH);
        }
        stack.push({ directory: path, depth: childDepth });
      } else if (!facts.isFile() || facts.nlink !== 1) {
        throw invalidResource(path, component, `${component} \u4E0D\u662F\u65E0\u786C\u94FE\u63A5\u7684\u666E\u901A\u6587\u4EF6\uFF1B\u8BF7\u66FF\u6362\u8BE5\u8D44\u6E90\u3002`);
      }
    }
  }
  if (await realpath(programDirectory) !== resolvedProgram) {
    throw invalidResource(
      programDirectory,
      relative(projectDirectory, programDirectory),
      "Render Program \u5728\u68C0\u67E5\u671F\u95F4\u88AB\u66FF\u6362\uFF1B\u8BF7\u505C\u6B62\u5916\u90E8\u4FEE\u6539\u540E\u91CD\u8BD5\u3002"
    );
  }
}
async function inspectProjectVNext(inputPath) {
  const projectDirectory = resolve(inputPath);
  try {
    await requireDirectory(projectDirectory);
  } catch (cause) {
    throw new ProjectInspectionError(
      "PROJECT_PATH_UNAVAILABLE",
      projectDirectory,
      `\u65E0\u6CD5\u8BFB\u53D6\u9879\u76EE\u76EE\u5F55 ${projectDirectory}\uFF1B\u8BF7\u68C0\u67E5\u8DEF\u5F84\u548C\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
      [],
      { cause }
    );
  }
  const manifestPath = join(projectDirectory, "narracut.json");
  let manifestBuffer;
  try {
    manifestBuffer = await readBoundedControlFile(manifestPath, "narracut.json", 4 * 1024);
  } catch (cause) {
    if (cause instanceof ProjectInspectionError) throw cause;
    if (isFileSystemError(cause) && cause.code === "ENOENT") {
      throw new ProjectInspectionError(
        "NOT_A_NARRACUT_PROJECT",
        manifestPath,
        `\u76EE\u5F55\u4E2D\u6CA1\u6709 narracut.json\uFF1B\u8BF7\u9009\u62E9 Project VNext \u9879\u76EE\u76EE\u5F55\u3002`,
        [],
        { cause }
      );
    }
    throw new ProjectInspectionError(
      "PROJECT_PATH_UNAVAILABLE",
      manifestPath,
      `\u65E0\u6CD5\u8BFB\u53D6 ${manifestPath}\uFF1B\u8BF7\u68C0\u67E5\u8DEF\u5F84\u548C\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
      [],
      { cause }
    );
  }
  const manifestBytes = decodeUtf8(manifestBuffer, manifestPath, "narracut.json", false);
  const parsedManifest = parseControlJson(
    manifestBytes,
    manifestPath,
    "narracut.json",
    MANIFEST_JSON_LIMITS
  );
  if (typeof parsedManifest !== "object" || parsedManifest === null || Array.isArray(parsedManifest) || !("kind" in parsedManifest) || parsedManifest.kind !== "narracut-project") {
    throw new ProjectInspectionError(
      "NOT_A_NARRACUT_PROJECT",
      manifestPath,
      `\u8BE5\u76EE\u5F55\u6CA1\u6709\u6709\u6548\u7684 Project VNext \u6807\u8BC6\uFF1B\u8BF7\u9009\u62E9\u5305\u542B kind=narracut-project \u6E05\u5355\u7684\u9879\u76EE\u76EE\u5F55\u3002`
    );
  }
  const manifest = parsedManifest;
  if (Number.isInteger(manifest.formatVersion) && manifest.formatVersion !== 1) {
    throw new ProjectInspectionError(
      "PROJECT_FORMAT_UNSUPPORTED",
      manifestPath,
      `\u9879\u76EE\u683C\u5F0F\u7248\u672C ${String(manifest.formatVersion)} \u4E0D\u53D7\u652F\u6301\uFF1B\u8BF7\u4F7F\u7528\u652F\u6301\u8BE5\u683C\u5F0F\u7684 Narracut \u7248\u672C\u3002`
    );
  }
  const manifestDiagnostics = validateProjectManifest(manifest);
  if (manifestDiagnostics.length > 0) throw invalidContent(manifestPath, manifestDiagnostics);
  const requiredEntries = [
    [join(projectDirectory, "assets"), "assets/", "directory"],
    [join(projectDirectory, "speech"), "speech/", "directory"],
    [join(projectDirectory, "renders"), "renders/", "directory"]
  ];
  for (const [path, component, kind] of requiredEntries) {
    try {
      if (kind === "directory") await requireDirectory(path);
      else await requireFile(path);
    } catch (cause) {
      if (isFileSystemError(cause) && cause.code !== "ENOENT") {
        throw new ProjectInspectionError(
          "PROJECT_PATH_UNAVAILABLE",
          path,
          `\u65E0\u6CD5\u8BFB\u53D6 ${path}\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
          [],
          { cause }
        );
      }
      throw missingContent(path, component);
    }
  }
  const renderProgramDirectories = await discoverRenderProgramDirectories(projectDirectory);
  if (renderProgramDirectories.length === 0) {
    throw missingContent(
      projectDirectory,
      "\u81F3\u5C11\u4E00\u4EFD\u5019\u9009\u6216\u4FEE\u8BA2\u5185\u90E8\u7684 render-program/"
    );
  }
  for (const programDirectory of renderProgramDirectories) {
    await validateRenderProgramDirectory(projectDirectory, programDirectory);
  }
  let projectBuffer;
  let videoBuffer;
  try {
    [projectBuffer, videoBuffer] = await Promise.all([
      readBoundedControlFile(
        join(projectDirectory, "project.json"),
        "project.json",
        10 * 1024 * 1024
      ),
      readBoundedControlFile(
        join(projectDirectory, "video.md"),
        "video.md",
        2 * 1024 * 1024
      )
    ]);
  } catch (cause) {
    if (cause instanceof ProjectInspectionError) throw cause;
    const path = isFileSystemError(cause) && typeof cause.path === "string" ? cause.path : projectDirectory;
    const component = path.startsWith(`${projectDirectory}/`) ? path.slice(projectDirectory.length + 1) : path;
    if (isFileSystemError(cause) && cause.code === "ENOENT") {
      throw missingContent(path, component);
    }
    throw new ProjectInspectionError(
      "PROJECT_PATH_UNAVAILABLE",
      path,
      `\u65E0\u6CD5\u8BFB\u53D6 ${path}\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
      [],
      { cause }
    );
  }
  const projectBytes = decodeUtf8(
    projectBuffer,
    join(projectDirectory, "project.json"),
    "project.json",
    false
  );
  const videoBytes = decodeUtf8(
    videoBuffer,
    join(projectDirectory, "video.md"),
    "video.md",
    true
  );
  const projectPath = join(projectDirectory, "project.json");
  const parsedProject = parseControlJson(
    projectBytes,
    projectPath,
    "project.json",
    PROJECT_JSON_LIMITS
  );
  const projectValidation = validateProjectDsl(parsedProject);
  if (projectValidation.project === void 0) {
    throw invalidContent(projectPath, projectValidation.diagnostics);
  }
  for (const asset of projectValidation.project.assets) {
    await validateOrdinaryResource(projectDirectory, asset.path, false);
  }
  for (const scene of projectValidation.project.scenes) {
    if (scene.speech !== void 0) {
      await validateOrdinaryResource(projectDirectory, scene.speech.path, true);
    }
  }
  return {
    projectDirectory,
    manifest,
    project: projectValidation.project,
    videoBrief: videoBytes,
    renderPrograms: { directories: renderProgramDirectories },
    warnings: []
  };
}

// src/server/project-lifecycle.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import {
  lstat as lstat2,
  mkdir,
  open as openFile,
  readFile,
  readdir as readdir2,
  realpath as realpath2,
  rename,
  rmdir,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join as join2, resolve as resolve2 } from "node:path";
var STARTER_REACT_VERSION = "19.2.8";
var STARTER_REMOTION_VERSION = "4.0.512";
var ProjectLifecycleError = class extends Error {
  constructor(code, path, message, options = {}) {
    super(message, options);
    this.code = code;
    this.path = path;
    this.name = "ProjectLifecycleError";
  }
  code;
  path;
};
var OPERATION_MARKER = ".narracut-operation.json";
var activeLeasePaths = /* @__PURE__ */ new Set();
function isCreateOperationMarker(value, projectDirectory, operationToken) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const marker = value;
  return Object.keys(marker).length === 5 && marker.kind === "narracut-operation" && marker.version === 1 && marker.operation === "create" && marker.targetDirectory === projectDirectory && typeof marker.operationToken === "string" && marker.operationToken.length > 0 && (operationToken === void 0 || marker.operationToken === operationToken);
}
async function pathExists(path) {
  try {
    await lstat2(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
async function removeConfirmedCreateResidue(temporaryDirectory, projectDirectory, confirmed) {
  const facts = await lstat2(temporaryDirectory);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `\u4E34\u65F6\u8DEF\u5F84\u4E0D\u662F\u53EF\u786E\u8BA4\u5F52\u5C5E\u7684\u666E\u901A\u76EE\u5F55\uFF1A${temporaryDirectory}\u3002Narracut \u62D2\u7EDD\u5220\u9664\u3002`
    );
  }
  const markerPath = join2(temporaryDirectory, OPERATION_MARKER);
  let marker;
  try {
    const markerFacts = await lstat2(markerPath);
    if (!markerFacts.isFile() || markerFacts.isSymbolicLink() || markerFacts.nlink !== 1 || markerFacts.size > 4096) {
      throw new Error("invalid marker");
    }
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `\u4E34\u65F6\u76EE\u5F55\u7F3A\u5C11\u53EF\u9A8C\u8BC1\u7684\u521B\u5EFA\u6807\u8BB0\uFF1A${temporaryDirectory}\u3002Narracut \u62D2\u7EDD\u5220\u9664\u3002`
    );
  }
  if (!isCreateOperationMarker(marker, projectDirectory)) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `\u4E34\u65F6\u76EE\u5F55\u6807\u8BB0\u4E0E\u672C\u6B21\u521B\u5EFA\u76EE\u6807\u4E0D\u5339\u914D\uFF1A${temporaryDirectory}\u3002Narracut \u62D2\u7EDD\u5220\u9664\u3002`
    );
  }
  if (!confirmed) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE",
      temporaryDirectory,
      `\u53D1\u73B0\u4E0E\u672C\u6B21\u76EE\u6807\u5339\u914D\u7684\u521B\u5EFA\u6B8B\u7559\uFF1A${temporaryDirectory}\u3002\u8BF7\u786E\u8BA4\u6E05\u7406\u540E\u4ECE\u5934\u91CD\u8BD5\u3002`
    );
  }
  const currentFacts = await lstat2(temporaryDirectory);
  if (currentFacts.dev !== facts.dev || currentFacts.ino !== facts.ino || !currentFacts.isDirectory()) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `\u4E34\u65F6\u76EE\u5F55\u5728\u786E\u8BA4\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF1A${temporaryDirectory}\u3002Narracut \u62D2\u7EDD\u5220\u9664\u3002`
    );
  }
  await rm(temporaryDirectory, { recursive: true });
}
function starterLockfile() {
  return `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      react:
        specifier: ${STARTER_REACT_VERSION}
        version: ${STARTER_REACT_VERSION}
      react-dom:
        specifier: ${STARTER_REACT_VERSION}
        version: ${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION})
      remotion:
        specifier: ${STARTER_REMOTION_VERSION}
        version: ${STARTER_REMOTION_VERSION}(react-dom@${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION}))(react@${STARTER_REACT_VERSION})

packages:

  react-dom@${STARTER_REACT_VERSION}:
    resolution: {integrity: sha512-rVprimfGBG3DR+Tq0IQG2DT5PxKth1WIGDmj5yPmlzr4YBe7uyE+Du4oVqTDXZSHGGGXRtTJEGSSePyQCMBglQ==}
    peerDependencies:
      react: ^${STARTER_REACT_VERSION}

  react@${STARTER_REACT_VERSION}:
    resolution: {integrity: sha512-PWaYA1L/q9u2u7xYQi+Y3L3Yfnie7XyLeaJICV1MGD6LprsBxcAqGjYyr0eY3p+QdsA+x/Irkt4Qif8D63+Sbw==}
    engines: {node: '>=0.10.0'}

  remotion@${STARTER_REMOTION_VERSION}:
    resolution: {integrity: sha512-L47ImosLFn/uSEGhgV6nO9agEjrRTD+xfeIC4QlGSkCkHjG4IpH2dm0psRoLrK0eo8iiUc4rwUFNnNxQpLnx2w==}
    peerDependencies:
      react: '>=16.8.0'
      react-dom: '>=16.8.0'

  scheduler@0.27.0:
    resolution: {integrity: sha512-eNv+WrVbKu1f3vbYJT/xtiF5syA5HPIMtf9IgY/nKg0sWqzAUEvqY/xm7OcZc/qafLx/iO9FgOmeSAp4v5ti/Q==}

snapshots:

  react-dom@${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION}):
    dependencies:
      react: ${STARTER_REACT_VERSION}
      scheduler: 0.27.0

  react@${STARTER_REACT_VERSION}: {}

  remotion@${STARTER_REMOTION_VERSION}(react-dom@${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION}))(react@${STARTER_REACT_VERSION}):
    dependencies:
      react: ${STARTER_REACT_VERSION}
      react-dom: ${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION})

  scheduler@0.27.0: {}
`;
}
function starterManifest(projectId) {
  return JSON.stringify({ kind: "narracut-project", formatVersion: 1, projectId });
}
function starterCurrent(revisionId) {
  return JSON.stringify({ revisionId });
}
function starterRevision(revisionId) {
  return JSON.stringify({
    revisionId,
    previousRevisionId: null,
    source: "starter",
    summary: "Narracut starter Render Program"
  });
}
function starterProgramManifest() {
  return JSON.stringify({ apiVersion: 1, output: { width: 1920, height: 1080, fps: 30 } });
}
function starterPackageManifest() {
  return JSON.stringify({
    private: true,
    dependencies: {
      react: STARTER_REACT_VERSION,
      "react-dom": STARTER_REACT_VERSION,
      remotion: STARTER_REMOTION_VERSION
    }
  });
}
function starterSource() {
  return 'import { AbsoluteFill } from "remotion";\n\ntype RenderProgramInputV1 = Readonly<{ apiVersion: 1 }>;\n\nexport function RenderProgram(input: RenderProgramInputV1) {\n  void input;\n  return <AbsoluteFill style={{ backgroundColor: "#090d0e" }} />;\n}\n';
}
async function writeStarterProject(temporaryDirectory, projectId, revisionId) {
  const renderProgramDirectory = join2(
    temporaryDirectory,
    ".narracut",
    "revisions",
    revisionId,
    "render-program"
  );
  await Promise.all([
    mkdir(join2(temporaryDirectory, "assets"), { recursive: true }),
    mkdir(join2(temporaryDirectory, "speech"), { recursive: true }),
    mkdir(join2(temporaryDirectory, "renders"), { recursive: true }),
    mkdir(join2(renderProgramDirectory, "src"), { recursive: true }),
    mkdir(join2(renderProgramDirectory, "resources"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(join2(temporaryDirectory, "narracut.json"), starterManifest(projectId)),
    writeFile(join2(temporaryDirectory, "project.json"), '{"assets":[],"scenes":[]}'),
    writeFile(join2(temporaryDirectory, "video.md"), ""),
    writeFile(join2(temporaryDirectory, ".narracut", "current.json"), starterCurrent(revisionId)),
    writeFile(
      join2(temporaryDirectory, ".narracut", "revisions", revisionId, "revision.json"),
      starterRevision(revisionId)
    ),
    writeFile(join2(renderProgramDirectory, "program.json"), starterProgramManifest()),
    writeFile(join2(renderProgramDirectory, "package.json"), starterPackageManifest()),
    writeFile(join2(renderProgramDirectory, "pnpm-lock.yaml"), starterLockfile()),
    writeFile(join2(renderProgramDirectory, "src", "RenderProgram.tsx"), starterSource())
  ]);
}
async function validateStarterProject(temporaryDirectory, projectId, revisionId) {
  const renderProgramDirectory = join2(
    temporaryDirectory,
    ".narracut",
    "revisions",
    revisionId,
    "render-program"
  );
  const [
    inspection,
    manifest,
    projectDsl,
    videoBrief,
    current,
    revision,
    programManifest,
    packageManifest,
    lockfile,
    source
  ] = await Promise.all([
    inspectProjectVNext(temporaryDirectory),
    readFile(join2(temporaryDirectory, "narracut.json"), "utf8"),
    readFile(join2(temporaryDirectory, "project.json"), "utf8"),
    readFile(join2(temporaryDirectory, "video.md"), "utf8"),
    readFile(join2(temporaryDirectory, ".narracut", "current.json"), "utf8"),
    readFile(join2(temporaryDirectory, ".narracut", "revisions", revisionId, "revision.json"), "utf8"),
    readFile(join2(renderProgramDirectory, "program.json"), "utf8"),
    readFile(join2(renderProgramDirectory, "package.json"), "utf8"),
    readFile(join2(renderProgramDirectory, "pnpm-lock.yaml"), "utf8"),
    readFile(join2(renderProgramDirectory, "src", "RenderProgram.tsx"), "utf8")
  ]);
  if (inspection.manifest.projectId !== projectId || inspection.project.assets.length !== 0 || inspection.project.scenes.length !== 0 || inspection.videoBrief !== "" || manifest !== starterManifest(projectId) || projectDsl !== '{"assets":[],"scenes":[]}' || videoBrief !== "" || current !== starterCurrent(revisionId) || revision !== starterRevision(revisionId) || programManifest !== starterProgramManifest() || packageManifest !== starterPackageManifest() || lockfile !== starterLockfile() || source !== starterSource()) {
    throw new Error("starter \u9879\u76EE\u590D\u6838\u7ED3\u679C\u4E0E\u521B\u5EFA\u8F93\u5165\u4E0D\u4E00\u81F4\u3002");
  }
}
var INTERNAL_JSON_LIMITS = {
  maxDepth: 8,
  maxArrayItems: 32,
  maxObjectFields: 64,
  maxNodes: 256,
  maxStringScalars: 4096,
  maxStringBytes: 16384,
  maxNumberBytes: 32
};
var UUID_PATTERN2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readRegularUtf8(path, maxBytes) {
  const facts = await lstat2(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > maxBytes) {
    throw new Error(`\u4E0D\u662F\u53D7\u652F\u6301\u7684\u666E\u901A\u6587\u4EF6\uFF1A${path}`);
  }
  return readFile(path, "utf8");
}
async function validateCurrentProjectState(inspection) {
  const projectDirectory = inspection.projectDirectory;
  const currentPath = join2(projectDirectory, ".narracut", "current.json");
  try {
    const current = parseStrictJson(
      await readRegularUtf8(currentPath, 4096),
      INTERNAL_JSON_LIMITS
    );
    if (!isPlainRecord(current) || Object.keys(current).length !== 1 || typeof current.revisionId !== "string" || !UUID_PATTERN2.test(current.revisionId)) {
      throw new Error("\u5F53\u524D\u4FEE\u8BA2\u6307\u9488\u65E0\u6548\u3002");
    }
    const revisionId = current.revisionId;
    const revisionDirectory = join2(projectDirectory, ".narracut", "revisions", revisionId);
    const renderProgramDirectory = join2(revisionDirectory, "render-program");
    if (!inspection.renderPrograms.directories.includes(renderProgramDirectory)) {
      throw new Error("\u5F53\u524D\u4FEE\u8BA2\u6CA1\u6709\u53EF\u68C0\u67E5\u7684 Render Program\u3002");
    }
    const [revision, program, packageJson, lockfile, source] = await Promise.all([
      readRegularUtf8(join2(revisionDirectory, "revision.json"), 16384).then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join2(renderProgramDirectory, "program.json"), 16384).then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join2(renderProgramDirectory, "package.json"), 65536).then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join2(renderProgramDirectory, "pnpm-lock.yaml"), 1048576),
      readRegularUtf8(join2(renderProgramDirectory, "src", "RenderProgram.tsx"), 10485760)
    ]);
    if (!isPlainRecord(revision) || Object.keys(revision).some(
      (key) => !["revisionId", "previousRevisionId", "source", "summary"].includes(key)
    ) || revision.revisionId !== revisionId || !(revision.previousRevisionId === null || typeof revision.previousRevisionId === "string" && UUID_PATTERN2.test(revision.previousRevisionId)) || typeof revision.source !== "string" || typeof revision.summary !== "string") {
      throw new Error("\u5F53\u524D\u4FEE\u8BA2\u5143\u6570\u636E\u65E0\u6548\u3002");
    }
    const output = isPlainRecord(program) && isPlainRecord(program.output) ? program.output : null;
    if (!isPlainRecord(program) || program.apiVersion !== 1 || output === null || ![output.width, output.height, output.fps].every(
      (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0
    )) {
      throw new Error("\u5F53\u524D Render Program manifest \u65E0\u6548\u3002");
    }
    if (!isPlainRecord(packageJson) || !isPlainRecord(packageJson.dependencies)) {
      throw new Error("\u5F53\u524D Render Program package manifest \u65E0\u6548\u3002");
    }
    const dependencies = Object.entries(packageJson.dependencies);
    if (packageJson.private !== true || dependencies.length === 0 || dependencies.some(
      ([, version]) => typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)
    ) || dependencies.some(
      ([name, version]) => !lockfile.includes(`      ${name}:
        specifier: ${String(version)}
`)
    ) || !source.includes("export function RenderProgram(input:")) {
      throw new Error("\u5F53\u524D Render Program \u4F9D\u8D56\u6216\u5165\u53E3\u65E0\u6548\u3002");
    }
  } catch (cause) {
    if (cause instanceof ProjectLifecycleError) throw cause;
    throw new ProjectLifecycleError(
      "PROJECT_CURRENT_INVALID",
      currentPath,
      `\u5F53\u524D Render Program \u4FEE\u8BA2\u65E0\u6548\uFF1A${projectDirectory}\u3002Narracut \u4E0D\u4F1A\u6253\u5F00\u6216\u4FEE\u590D\u8BE5\u9879\u76EE\u3002`,
      { cause }
    );
  }
}
async function captureDirectoryIdentity(path) {
  const facts = await lstat2(path);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new Error(`\u8DEF\u5F84\u4E0D\u662F\u666E\u901A\u76EE\u5F55\uFF1A${path}`);
  }
  return { dev: facts.dev, ino: facts.ino };
}
function hasIdentity(facts, identity) {
  return facts.dev === identity.dev && facts.ino === identity.ino;
}
async function cleanupOwnedTemporaryDirectory(temporaryDirectory, identity, markerWritten, projectDirectory, operationToken) {
  let facts;
  try {
    facts = await lstat2(temporaryDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, identity)) {
    throw new Error("\u521B\u5EFA\u4E34\u65F6\u76EE\u5F55\u5DF2\u88AB\u66FF\u6362\uFF0C\u65E0\u6CD5\u8BC1\u660E\u6E05\u7406\u6240\u6709\u6743\u3002");
  }
  if (markerWritten) {
    const marker = JSON.parse(await readRegularUtf8(
      join2(temporaryDirectory, OPERATION_MARKER),
      4096
    ));
    if (!isCreateOperationMarker(marker, projectDirectory, operationToken)) {
      throw new Error("\u521B\u5EFA\u4E34\u65F6\u76EE\u5F55\u6807\u8BB0\u5DF2\u53D8\u5316\uFF0C\u65E0\u6CD5\u8BC1\u660E\u6E05\u7406\u6240\u6709\u6743\u3002");
    }
  }
  await rm(temporaryDirectory, { recursive: true });
}
async function cleanupTargetReservation(projectDirectory, identity) {
  let facts;
  try {
    facts = await lstat2(projectDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, identity)) {
    throw new Error("\u53D1\u5E03\u76EE\u6807\u4FDD\u7559\u76EE\u5F55\u5DF2\u88AB\u66FF\u6362\uFF0C\u65E0\u6CD5\u8BC1\u660E\u6E05\u7406\u6240\u6709\u6743\u3002");
  }
  if ((await readdir2(projectDirectory)).length !== 0) {
    throw new Error("\u53D1\u5E03\u76EE\u6807\u4FDD\u7559\u76EE\u5F55\u51FA\u73B0\u5916\u90E8\u5185\u5BB9\uFF0CNarracut \u62D2\u7EDD\u5220\u9664\u3002");
  }
  await rmdir(projectDirectory);
}
async function createProjectVNext(inputPath, options = {}) {
  const projectDirectory = resolve2(inputPath);
  const projectName = basename(projectDirectory);
  if (projectName === "" || projectName === "." || projectName === "..") {
    throw new ProjectLifecycleError(
      "PROJECT_CREATE_TARGET_INVALID",
      projectDirectory,
      "\u521B\u5EFA\u76EE\u6807\u5FC5\u987B\u662F\u5E26\u6709\u9879\u76EE\u6587\u4EF6\u5939\u540D\u7684\u7EDD\u5BF9\u8DEF\u5F84\u3002"
    );
  }
  const temporaryDirectory = join2(dirname(projectDirectory), `.${projectName}.narracut-tmp`);
  const createId = options.createId ?? randomUUID2;
  const projectId = createId();
  const revisionId = createId();
  const operationToken = randomUUID2();
  let temporaryIdentity = null;
  let markerWritten = false;
  let targetReservationIdentity = null;
  try {
    if (await pathExists(projectDirectory)) {
      throw new ProjectLifecycleError(
        "PROJECT_CREATE_TARGET_EXISTS",
        projectDirectory,
        `\u521B\u5EFA\u76EE\u6807\u5DF2\u5B58\u5728\uFF1A${projectDirectory}\u3002\u8BF7\u9009\u62E9\u5C1A\u4E0D\u5B58\u5728\u7684\u65B0\u8DEF\u5F84\u3002`
      );
    }
    if (await pathExists(temporaryDirectory)) {
      await removeConfirmedCreateResidue(
        temporaryDirectory,
        projectDirectory,
        options.confirmTemporaryCleanup === true
      );
    }
    await mkdir(temporaryDirectory);
    temporaryIdentity = await captureDirectoryIdentity(temporaryDirectory);
    await writeFile(join2(temporaryDirectory, OPERATION_MARKER), JSON.stringify({
      kind: "narracut-operation",
      version: 1,
      operation: "create",
      targetDirectory: projectDirectory,
      operationToken
    }));
    markerWritten = true;
    await writeStarterProject(temporaryDirectory, projectId, revisionId);
    await validateStarterProject(temporaryDirectory, projectId, revisionId);
    if (process.platform !== "win32") {
      try {
        await mkdir(projectDirectory);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          throw new ProjectLifecycleError(
            "PROJECT_CREATE_TARGET_EXISTS",
            projectDirectory,
            `\u539F\u5B50\u53D1\u5E03\u524D\u76EE\u6807\u5DF2\u7ECF\u51FA\u73B0\uFF1A${projectDirectory}\u3002Narracut \u62D2\u7EDD\u63A5\u7BA1\u3002`,
            { cause: error }
          );
        }
        throw error;
      }
      targetReservationIdentity = await captureDirectoryIdentity(projectDirectory);
    } else if (await pathExists(projectDirectory)) {
      throw new ProjectLifecycleError(
        "PROJECT_CREATE_TARGET_EXISTS",
        projectDirectory,
        `\u539F\u5B50\u53D1\u5E03\u524D\u76EE\u6807\u5DF2\u7ECF\u51FA\u73B0\uFF1A${projectDirectory}\u3002Narracut \u62D2\u7EDD\u63A5\u7BA1\u3002`
      );
    }
    await unlink(join2(temporaryDirectory, OPERATION_MARKER));
    markerWritten = false;
    if (targetReservationIdentity !== null) {
      const currentReservation = await lstat2(projectDirectory);
      if (!currentReservation.isDirectory() || currentReservation.isSymbolicLink() || !hasIdentity(currentReservation, targetReservationIdentity) || (await readdir2(projectDirectory)).length !== 0) {
        throw new ProjectLifecycleError(
          "PROJECT_CREATE_TARGET_EXISTS",
          projectDirectory,
          `\u539F\u5B50\u53D1\u5E03\u65F6\u76EE\u6807\u4FDD\u7559\u76EE\u5F55\u53D1\u751F\u53D8\u5316\uFF1A${projectDirectory}\u3002Narracut \u62D2\u7EDD\u8986\u76D6\u3002`
        );
      }
    }
    await rename(temporaryDirectory, projectDirectory);
    temporaryIdentity = null;
    targetReservationIdentity = null;
    return { projectDirectory, projectId, revisionId };
  } catch (cause) {
    try {
      if (targetReservationIdentity !== null) {
        await cleanupTargetReservation(projectDirectory, targetReservationIdentity);
      }
      if (temporaryIdentity !== null) {
        await cleanupOwnedTemporaryDirectory(
          temporaryDirectory,
          temporaryIdentity,
          markerWritten,
          projectDirectory,
          operationToken
        );
      }
    } catch (cleanupCause) {
      throw new ProjectLifecycleError(
        "PROJECT_CREATE_CLEANUP_FAILED",
        temporaryDirectory,
        `\u521B\u5EFA\u5931\u8D25\uFF0C\u4E14\u65E0\u6CD5\u8BC1\u660E\u4E34\u65F6\u4EA7\u7269\u4ECD\u5F52\u672C\u6B21\u64CD\u4F5C\u6240\u6709\uFF1B\u5DF2\u4FDD\u7559\u73B0\u573A\uFF1A${temporaryDirectory}\u3002`,
        { cause: cleanupCause }
      );
    }
    if (cause instanceof ProjectLifecycleError) throw cause;
    throw new ProjectLifecycleError(
      "PROJECT_CREATE_FAILED",
      projectDirectory,
      `\u65E0\u6CD5\u521B\u5EFA Project VNext\uFF1A${projectDirectory}\u3002`,
      { cause }
    );
  }
}
async function readProcessIdentity(pid) {
  if (process.platform !== "linux") return null;
  try {
    const statBytes = await readFile(`/proc/${pid}/stat`, "utf8");
    const commandEnd = statBytes.lastIndexOf(")");
    if (commandEnd < 0) return null;
    return statBytes.slice(commandEnd + 2).trim().split(/\s+/u)[19] ?? null;
  } catch {
    return null;
  }
}
async function leaseHolderIsAlive(marker) {
  if (!Number.isSafeInteger(marker.pid) || marker.pid <= 0) return true;
  try {
    process.kill(marker.pid, 0);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    return true;
  }
  if (marker.processIdentity === null) return true;
  const currentIdentity = await readProcessIdentity(marker.pid);
  return currentIdentity === null || currentIdentity === marker.processIdentity;
}
function isLeaseMarker(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const marker = value;
  return marker.kind === "narracut-project-lease" && marker.version === 1 && typeof marker.projectDirectory === "string" && typeof marker.projectId === "string" && typeof marker.pid === "number" && (marker.processIdentity === null || typeof marker.processIdentity === "string") && typeof marker.token === "string";
}
async function clearStaleLease(leasePath) {
  let facts;
  let marker;
  try {
    facts = await lstat2(leasePath);
    if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > 4096) return false;
    marker = JSON.parse(await readFile(leasePath, "utf8"));
  } catch {
    return false;
  }
  if (!isLeaseMarker(marker) || await leaseHolderIsAlive(marker)) return false;
  const currentFacts = await lstat2(leasePath);
  if (currentFacts.dev !== facts.dev || currentFacts.ino !== facts.ino) return false;
  await unlink(leasePath);
  return true;
}
async function acquireProjectLease(inspection) {
  const projectDirectory = inspection.projectDirectory;
  const leasePath = join2(projectDirectory, ".narracut", "workspace.lease");
  if (activeLeasePaths.has(leasePath)) {
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `\u9879\u76EE\u5DF2\u7531\u53E6\u4E00\u4E2A Narracut \u5DE5\u4F5C\u533A\u5360\u7528\uFF1A${projectDirectory}\u3002`
    );
  }
  const marker = {
    kind: "narracut-project-lease",
    version: 1,
    projectDirectory,
    projectId: inspection.manifest.projectId,
    pid: process.pid,
    processIdentity: await readProcessIdentity(process.pid),
    token: randomUUID2()
  };
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await openFile(leasePath, "wx", 384);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (attempt === 0 && await clearStaleLease(leasePath)) continue;
      throw new ProjectLifecycleError(
        "PROJECT_IN_USE",
        projectDirectory,
        `\u9879\u76EE\u5DF2\u7531\u53E6\u4E00\u4E2A Narracut \u5DE5\u4F5C\u533A\u5360\u7528\uFF1A${projectDirectory}\u3002`,
        { cause: error }
      );
    }
  }
  if (handle === void 0) {
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `\u65E0\u6CD5\u53D6\u5F97\u9879\u76EE\u5199\u5165\u79DF\u7EA6\uFF1A${projectDirectory}\u3002`
    );
  }
  try {
    await handle.writeFile(JSON.stringify(marker));
    await handle.sync();
  } catch (cause) {
    await handle.close();
    await rm(leasePath, { force: true });
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `\u65E0\u6CD5\u5199\u5165\u9879\u76EE\u79DF\u7EA6\uFF1A${projectDirectory}\u3002`,
      { cause }
    );
  }
  await handle.close();
  let leaseDirectoryHandle;
  try {
    leaseDirectoryHandle = await openFile(dirname(leasePath), "r");
  } catch (cause) {
    await rm(leasePath, { force: true });
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `\u65E0\u6CD5\u951A\u5B9A\u9879\u76EE\u79DF\u7EA6\u76EE\u5F55\uFF1A${projectDirectory}\u3002`,
      { cause }
    );
  }
  activeLeasePaths.add(leasePath);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    activeLeasePaths.delete(leasePath);
    const anchoredLeasePath = process.platform === "win32" ? leasePath : `/dev/fd/${leaseDirectoryHandle.fd}/workspace.lease`;
    try {
      const current = JSON.parse(await readFile(anchoredLeasePath, "utf8"));
      if (current.token === marker.token) await unlink(anchoredLeasePath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    } finally {
      await leaseDirectoryHandle.close();
    }
  };
}
async function openProjectVNext(inputPath) {
  const projectDirectory = await realpath2(resolve2(inputPath)).catch(() => resolve2(inputPath));
  try {
    const initialInspection = await inspectProjectVNext(projectDirectory);
    await validateCurrentProjectState(initialInspection);
    const release = await acquireProjectLease(initialInspection);
    try {
      const inspection = await inspectProjectVNext(projectDirectory);
      await validateCurrentProjectState(inspection);
      if (inspection.manifest.projectId !== initialInspection.manifest.projectId) {
        throw new ProjectLifecycleError(
          "PROJECT_IDENTITY_LOST",
          projectDirectory,
          `\u53D6\u5F97\u79DF\u7EA6\u65F6\u9879\u76EE\u8EAB\u4EFD\u53D1\u751F\u53D8\u5316\uFF1A${projectDirectory}\u3002`
        );
      }
      return { inspection, release };
    } catch (error) {
      await release();
      throw error;
    }
  } catch (error) {
    if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
      throw error;
    }
    throw new ProjectLifecycleError(
      "PROJECT_OPEN_FAILED",
      projectDirectory,
      `\u65E0\u6CD5\u6253\u5F00 Project VNext\uFF1A${projectDirectory}\u3002`,
      { cause: error }
    );
  }
}

// plugins/narracut/src/server.ts
var SERVER_VERSION = "0.1.0";
var MCP_PROTOCOL_VERSION = "2025-06-18";
var WORKBENCH_URI = "ui://narracut/workbench-v1.html";
var WORKBENCH_PATH = fileURLToPath(new URL(
  import.meta.url.endsWith("/server.mjs") ? "./workbench.html" : "../workbench.html",
  import.meta.url
));
var ASSET_BASE = import.meta.url.endsWith("/server.mjs") ? "./assets/" : "../assets/";
var PAPER_TEXTURE_PATH = fileURLToPath(new URL(`${ASSET_BASE}contact-paper-texture.webp`, import.meta.url));
var FILM_TEXTURE_PATH = fileURLToPath(new URL(`${ASSET_BASE}film-edge-texture.webp`, import.meta.url));
var DISPLAY_FONT_PATH = fileURLToPath(new URL(`${ASSET_BASE}fonts/ubuntu-sans-display.woff2`, import.meta.url));
var readOnlyToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};
var taskToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};
var tools = [
  {
    name: "health_check",
    title: "\u68C0\u67E5 Narracut \u8FDE\u63A5",
    description: "\u786E\u8BA4 Narracut \u672C\u5730 MCP \u5DF2\u8FDE\u63A5\uFF0C\u5E76\u8FD4\u56DE\u542F\u52A8\u5668\u4E0E\u9879\u76EE\u5DE5\u4F5C\u53F0\u80FD\u529B\u8FB9\u754C\u3002",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      required: ["status", "server", "readOnly"],
      properties: {
        status: { type: "string", enum: ["connected"] },
        server: { type: "string" },
        readOnly: { type: "boolean" }
      },
      additionalProperties: false
    },
    annotations: readOnlyToolAnnotations
  },
  {
    name: "show_launcher",
    title: "\u6253\u5F00 Narracut \u9879\u76EE\u542F\u52A8\u5668",
    description: "\u5728\u6CA1\u6709\u9879\u76EE\u53C2\u6570\u65F6\u6253\u5F00 Narracut \u542F\u52A8\u5668\uFF0C\u7528\u7CFB\u7EDF\u6587\u4EF6\u5939\u9009\u62E9\u7A97\u53E3\u521B\u5EFA\u6216\u6253\u5F00 Project VNext\u3002",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } }
  },
  {
    name: "create_project",
    title: "\u539F\u5B50\u521B\u5EFA\u5E76\u6253\u5F00 Narracut \u9879\u76EE",
    description: "\u5728\u7528\u6237\u660E\u786E\u9009\u62E9\u7684\u4E0D\u5B58\u5728\u7EDD\u5BF9\u8DEF\u5F84\u540C\u7EA7\u751F\u6210 Project VNext\uFF0C\u5B8C\u6574\u6821\u9A8C\u540E\u539F\u5B50\u53D1\u5E03\u5E76\u53D6\u5F97\u5199\u5165\u79DF\u7EA6\u3002\u4E0D\u4F1A\u8054\u7F51\u3001\u5B89\u88C5\u4F9D\u8D56\u6216\u8986\u76D6\u5DF2\u6709\u76EE\u5F55\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        confirmTemporaryCleanup: { type: "boolean" }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } }
  },
  {
    name: "open_project",
    title: "\u6253\u5F00 Narracut \u9879\u76EE",
    description: "\u4E25\u683C\u6821\u9A8C\u7528\u6237\u660E\u786E\u9009\u62E9\u7684 Project VNext \u7EDD\u5BF9\u76EE\u5F55\u5E76\u53D6\u5F97\u72EC\u5360\u5199\u5165\u79DF\u7EA6\uFF1B\u4E0D\u4F1A\u521B\u5EFA\u3001\u8865\u5168\u3001\u8FC1\u79FB\u6216\u6539\u5199\u666E\u901A\u76EE\u5F55\u4E0E\u635F\u574F\u9879\u76EE\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: { projectDirectory: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } }
  },
  {
    name: "inspect_project",
    title: "\u68C0\u67E5 Narracut \u9879\u76EE",
    description: "\u53EA\u8BFB\u68C0\u67E5\u7528\u6237\u660E\u786E\u7ED9\u51FA\u7684 Project VNext \u7EDD\u5BF9\u76EE\u5F55\uFF0C\u8FD4\u56DE\u9879\u76EE\u8EAB\u4EFD\u3001Scene \u4E0E\u56FA\u5B9A\u63A7\u5236\u6587\u4EF6\u72B6\u6001\uFF0C\u5E76\u6253\u5F00\u5DE5\u4F5C\u53F0\u3002\u4E0D\u4F1A\u6D4F\u89C8\u5176\u4ED6\u76EE\u5F55\u3001\u5199\u6587\u4EF6\u3001\u6267\u884C Shell \u6216\u8BBF\u95EE\u7F51\u7EDC\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: {
        projectDirectory: {
          type: "string",
          minLength: 1,
          description: "\u7528\u6237\u660E\u786E\u6307\u5B9A\u7684 Project VNext \u7EDD\u5BF9\u76EE\u5F55\u3002"
        }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } }
  },
  {
    name: "start_agent_host_validation",
    title: "\u5F00\u59CB Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1",
    description: "\u4E3A\u7528\u6237\u660E\u786E\u7ED9\u51FA\u7684 Project VNext \u76EE\u5F55\u521B\u5EFA\u4E13\u7528 Codex \u521B\u4F5C\u7EBF\u7A0B\uFF0C\u5E76\u8FD0\u884C\u56FA\u5B9A\u7684\u53EA\u8BFB\u5BBF\u4E3B\u9A8C\u8BC1\u4EFB\u52A1\u3002\u4E0D\u4F1A\u4FEE\u6539\u9879\u76EE\u5185\u5BB9\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations
  },
  {
    name: "get_agent_host_validation",
    title: "\u8BFB\u53D6 Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1\u72B6\u6001",
    description: "\u53EA\u8BFB\u8FD4\u56DE\u4E00\u6B21\u4E34\u65F6\u5BBF\u4E3B\u9A8C\u8BC1\u4EFB\u52A1\u7684\u5F53\u524D\u7A33\u5B9A\u72B6\u6001\u3002",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations
  },
  {
    name: "stop_agent_host_validation",
    title: "\u505C\u6B62 Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1",
    description: "\u64A4\u9500\u5F53\u524D Codex \u521B\u4F5C\u7EBF\u7A0B\u7684\u9A71\u52A8\u6743\u5E76\u505C\u6B62\u9A8C\u8BC1 Turn\uFF0C\u4FDD\u7559\u6700\u5C0F\u53EF\u7EE7\u7EED\u68C0\u67E5\u70B9\u3002",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: { ...taskToolAnnotations, idempotentHint: true }
  },
  {
    name: "continue_agent_host_validation",
    title: "\u7EE7\u7EED Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1",
    description: "\u6062\u590D\u53EF\u7528\u7684\u539F Codex \u521B\u4F5C\u7EBF\u7A0B\uFF1B\u7EBF\u7A0B\u5DF2\u5931\u6548\u65F6\u81EA\u52A8\u521B\u5EFA\u66FF\u4EE3\u7EBF\u7A0B\u5E76\u91CD\u65B0\u9A8C\u8BC1\u3002",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations
  }
];
function connectedState() {
  return { status: "connected", readOnly: true };
}
function launcherConnectionState() {
  return { status: "connected", readOnly: false };
}
function serializeInspection(inspection) {
  const assets = new Map(inspection.project.assets.map((asset) => [asset.id, asset]));
  return {
    status: "valid",
    connection: connectedState(),
    project: {
      directory: inspection.projectDirectory,
      folderName: basename2(inspection.projectDirectory),
      projectId: inspection.manifest.projectId,
      sceneCount: inspection.project.scenes.length,
      assetCount: inspection.project.assets.length
    },
    checks: {
      manifest: { status: "valid", label: "\u9879\u76EE\u6E05\u5355" },
      dsl: { status: "valid", label: "Project DSL" },
      videoBrief: {
        status: "valid",
        label: "video.md",
        bytes: Buffer.byteLength(inspection.videoBrief, "utf8")
      }
    },
    scenes: inspection.project.scenes.map((scene, index) => ({
      id: scene.id,
      index: index + 1,
      narration: scene.narration.text,
      assets: scene.assetIds.map((assetId) => ({
        id: assetId,
        path: assets.get(assetId)?.path ?? null
      })),
      speech: scene.speech === void 0 ? { status: "missing" } : { status: "available", durationMs: scene.speech.durationMs }
    })),
    warnings: inspection.warnings
  };
}
function diagnosticSummary(diagnostics) {
  return diagnostics.map(({ code, component, message, metric, actual, limit, jsonPath }) => ({
    code,
    component,
    message,
    ...metric === void 0 ? {} : { metric },
    ...actual === void 0 ? {} : { actual },
    ...limit === void 0 ? {} : { limit },
    ...jsonPath === void 0 ? {} : { jsonPath }
  }));
}
async function loadWorkbench() {
  const [html, paperTexture, filmTexture, displayFont] = await Promise.all([
    readFile2(WORKBENCH_PATH, "utf8"),
    readFile2(PAPER_TEXTURE_PATH),
    readFile2(FILM_TEXTURE_PATH),
    readFile2(DISPLAY_FONT_PATH)
  ]);
  const materialVariables = `@font-face{font-family:"Narracut Display";src:url("data:font/woff2;base64,${displayFont.toString("base64")}") format("woff2");font-style:normal;font-weight:100 800;font-stretch:75% 100%;font-display:block}:root{--paper-texture:url("data:image/webp;base64,${paperTexture.toString("base64")}");--film-texture:url("data:image/webp;base64,${filmTexture.toString("base64")}")}`;
  return html.replace("/*__NARRACUT_MATERIALS__*/", materialVariables);
}
async function inspectProject(argumentsValue) {
  if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue) || typeof argumentsValue.projectDirectory !== "string") {
    return {
      isError: true,
      structuredContent: {
        status: "invalid",
        connection: connectedState(),
        error: { code: "INVALID_TOOL_INPUT", message: "projectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }
      },
      content: [{ type: "text", text: "\u65E0\u6CD5\u68C0\u67E5\u9879\u76EE\uFF1AprojectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }]
    };
  }
  const projectDirectory = argumentsValue.projectDirectory;
  if (!isAbsolute2(projectDirectory)) {
    return {
      isError: true,
      structuredContent: {
        status: "invalid",
        connection: connectedState(),
        error: { code: "INVALID_TOOL_INPUT", message: "\u53EA\u63A5\u53D7\u7528\u6237\u660E\u786E\u7ED9\u51FA\u7684\u7EDD\u5BF9\u9879\u76EE\u76EE\u5F55\u3002" }
      },
      content: [{ type: "text", text: "\u65E0\u6CD5\u68C0\u67E5\u9879\u76EE\uFF1A\u53EA\u63A5\u53D7\u7EDD\u5BF9\u9879\u76EE\u76EE\u5F55\u3002" }]
    };
  }
  try {
    const inspection = await inspectProjectVNext(projectDirectory);
    const structuredContent = serializeInspection(inspection);
    return {
      structuredContent,
      content: [{
        type: "text",
        text: `${basename2(inspection.projectDirectory)} \u662F\u6709\u6548\u7684 Project VNext\uFF0C\u5171 ${inspection.project.scenes.length} \u4E2A Scene\u3002\u5F53\u524D\u63D2\u4EF6\u53EA\u63D0\u4F9B\u53EA\u8BFB\u68C0\u67E5\u3002`
      }]
    };
  } catch (error) {
    if (error instanceof ProjectInspectionError) {
      return {
        isError: true,
        structuredContent: {
          status: "invalid",
          connection: connectedState(),
          project: { directory: projectDirectory, folderName: basename2(projectDirectory) },
          error: {
            code: error.code,
            path: error.path,
            message: error.message,
            diagnostics: diagnosticSummary(error.diagnostics)
          }
        },
        content: [{ type: "text", text: `Narracut \u9879\u76EE\u68C0\u67E5\u5931\u8D25\uFF1A${error.message}` }]
      };
    }
    throw error;
  }
}
function stringArgument(argumentsValue, name) {
  if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
    return null;
  }
  const value = argumentsValue[name];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
function hostValidationResult(hostValidation, text) {
  return {
    structuredContent: { hostValidation },
    content: [{ type: "text", text }]
  };
}
var ProjectWorkspaceSession = class {
  #opened = null;
  async open(projectDirectory) {
    const next = await openProjectVNext(projectDirectory);
    const previous = this.#opened;
    try {
      if (previous !== null) await previous.release();
    } catch (error) {
      await next.release();
      throw error;
    }
    this.#opened = next;
    return next.inspection;
  }
  async dispose() {
    const opened = this.#opened;
    this.#opened = null;
    if (opened !== null) await opened.release();
  }
};
function lifecycleFailure(error) {
  return {
    isError: true,
    structuredContent: {
      status: "invalid",
      connection: launcherConnectionState(),
      error: {
        code: error.code,
        path: error.path,
        message: error.message,
        ...error instanceof ProjectInspectionError ? { diagnostics: diagnosticSummary(error.diagnostics) } : {}
      }
    },
    content: [{ type: "text", text: `Narracut \u9879\u76EE\u64CD\u4F5C\u5931\u8D25\uFF1A${error.message}` }]
  };
}
async function callTool(params, hostValidation, workspace) {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error("tools/call \u7F3A\u5C11\u53C2\u6570\u3002");
  }
  const { name, arguments: argumentsValue } = params;
  if (name === "health_check") {
    return {
      structuredContent: { status: "connected", server: "narracut", readOnly: true },
      content: [{ type: "text", text: "Narracut \u63D2\u4EF6\u5DF2\u8FDE\u63A5\uFF1B\u53EF\u539F\u5B50\u521B\u5EFA\u3001\u4E25\u683C\u6253\u5F00 Project VNext\uFF0C\u6253\u5F00\u540E\u7684\u9879\u76EE\u5DE5\u4F5C\u53F0\u4FDD\u6301\u53EA\u8BFB\u3002" }]
    };
  }
  if (name === "show_launcher") {
    return {
      structuredContent: { status: "launcher", connection: launcherConnectionState() },
      content: [{ type: "text", text: "Narracut \u9879\u76EE\u542F\u52A8\u5668\u5DF2\u6253\u5F00\uFF1B\u8BF7\u9009\u62E9\u7236\u76EE\u5F55\u521B\u5EFA\u9879\u76EE\uFF0C\u6216\u9009\u62E9\u73B0\u6709 Project VNext \u6253\u5F00\u3002" }]
    };
  }
  if (name === "create_project" || name === "open_project") {
    const projectDirectory = stringArgument(argumentsValue, "projectDirectory");
    if (projectDirectory === null || !isAbsolute2(projectDirectory)) {
      return {
        isError: true,
        structuredContent: {
          status: "invalid",
          connection: launcherConnectionState(),
          error: { code: "INVALID_TOOL_INPUT", message: "projectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u64CD\u4F5C\u9879\u76EE\uFF1AprojectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }]
      };
    }
    let createdProject = false;
    try {
      let operation;
      if (name === "create_project") {
        const confirmTemporaryCleanup = typeof argumentsValue === "object" && argumentsValue !== null && !Array.isArray(argumentsValue) && argumentsValue.confirmTemporaryCleanup === true;
        await createProjectVNext(projectDirectory, { confirmTemporaryCleanup });
        createdProject = true;
        operation = "created";
      } else {
        operation = "opened";
      }
      const inspection = await workspace.open(projectDirectory);
      return {
        structuredContent: { ...serializeInspection(inspection), operation },
        content: [{
          type: "text",
          text: operation === "created" ? `${basename2(inspection.projectDirectory)} \u5DF2\u539F\u5B50\u521B\u5EFA\u5E76\u6253\u5F00\uFF0C\u5171 0 \u4E2A Scene\u3002` : `${basename2(inspection.projectDirectory)} \u5DF2\u4E25\u683C\u6821\u9A8C\u5E76\u6253\u5F00\u3002`
        }]
      };
    } catch (error) {
      if (createdProject) {
        const causeCode = error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError ? error.code : "PROJECT_OPEN_FAILED";
        return {
          isError: true,
          structuredContent: {
            status: "created-not-opened",
            connection: launcherConnectionState(),
            project: { directory: projectDirectory, folderName: basename2(projectDirectory) },
            error: {
              code: "PROJECT_CREATED_NOT_OPENED",
              causeCode,
              path: projectDirectory,
              message: "\u9879\u76EE\u5DF2\u7ECF\u5B8C\u6574\u521B\u5EFA\uFF0C\u4F46\u6682\u65F6\u65E0\u6CD5\u53D6\u5F97\u5DE5\u4F5C\u533A\u79DF\u7EA6\u3002\u8BF7\u4F7F\u7528\u201C\u6253\u5F00\u9879\u76EE\u201D\u91CD\u8BD5\uFF1B\u4E0D\u8981\u518D\u6B21\u521B\u5EFA\u3002"
            }
          },
          content: [{
            type: "text",
            text: `\u9879\u76EE\u5DF2\u7ECF\u521B\u5EFA\u5728 ${projectDirectory}\uFF0C\u4F46\u5C1A\u672A\u6253\u5F00\uFF08${causeCode}\uFF09\u3002`
          }]
        };
      }
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        return lifecycleFailure(error);
      }
      throw error;
    }
  }
  if (name === "inspect_project") return inspectProject(argumentsValue);
  if (name === "start_agent_host_validation") {
    const projectDirectory = stringArgument(argumentsValue, "projectDirectory");
    if (projectDirectory === null || !isAbsolute2(projectDirectory)) {
      return {
        isError: true,
        structuredContent: {
          error: { code: "INVALID_TOOL_INPUT", message: "projectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5F00\u59CB\u5BBF\u4E3B\u9A8C\u8BC1\uFF1AprojectDirectory \u5FC5\u987B\u662F\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002" }]
      };
    }
    try {
      const inspection = await inspectProjectVNext(projectDirectory);
      const state = await hostValidation.start({
        projectDirectory: inspection.projectDirectory,
        projectId: inspection.manifest.projectId,
        sceneCount: inspection.project.scenes.length
      });
      return hostValidationResult(
        state,
        state.status === "running" ? "Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1\u5DF2\u5F00\u59CB\uFF1B\u9879\u76EE\u4FDD\u6301\u53EA\u8BFB\u3002" : "Codex \u5BBF\u4E3B\u5F53\u524D\u4E0D\u53EF\u7528\uFF1B\u9A8C\u8BC1\u5DF2\u505C\u6B62\uFF0C\u53EF\u7A0D\u540E\u7EE7\u7EED\u3002"
      );
    } catch (error) {
      if (error instanceof ProjectInspectionError) {
        return {
          isError: true,
          structuredContent: {
            error: { code: error.code, message: error.message }
          },
          content: [{ type: "text", text: `\u65E0\u6CD5\u5F00\u59CB\u5BBF\u4E3B\u9A8C\u8BC1\uFF1A${error.message}` }]
        };
      }
      throw error;
    }
  }
  if (name === "get_agent_host_validation" || name === "stop_agent_host_validation" || name === "continue_agent_host_validation") {
    const taskId = stringArgument(argumentsValue, "taskId");
    if (taskId === null) {
      return {
        isError: true,
        structuredContent: { error: { code: "INVALID_TOOL_INPUT", message: "taskId \u4E0D\u80FD\u4E3A\u7A7A\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u64CD\u4F5C\u5BBF\u4E3B\u9A8C\u8BC1\uFF1AtaskId \u4E0D\u80FD\u4E3A\u7A7A\u3002" }]
      };
    }
    const state = name === "get_agent_host_validation" ? hostValidation.get(taskId) : name === "stop_agent_host_validation" ? await hostValidation.stop(taskId) : await hostValidation.continue(taskId);
    return hostValidationResult(
      state,
      `Codex \u521B\u4F5C\u7EBF\u7A0B\u9A8C\u8BC1\u72B6\u6001\uFF1A${state.status}\u3002`
    );
  }
  throw new Error(`\u672A\u77E5\u5DE5\u5177\uFF1A${String(name)}`);
}
function createNarracutRequestHandler(options = {}) {
  const hostValidation = new AgentHostValidationService(
    options.codexHost ?? new CodexAppServerHost()
  );
  const workspace = new ProjectWorkspaceSession();
  const requestHandler = async (request) => {
    switch (request.method) {
      case "initialize": {
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "narracut", version: SERVER_VERSION },
          instructions: "\u53EA\u63A5\u89E6\u7528\u6237\u901A\u8FC7\u7CFB\u7EDF\u6587\u4EF6\u5939\u9009\u62E9\u7A97\u53E3\u6216\u53C2\u6570\u660E\u786E\u7ED9\u51FA\u7684\u76EE\u5F55\u3002\u53EF\u4EE5\u5728\u4E0D\u5B58\u5728\u7684\u76EE\u6807\u539F\u5B50\u521B\u5EFA Project VNext\uFF0C\u6216\u4E25\u683C\u6253\u5F00\u6709\u6548\u9879\u76EE\uFF1B\u6253\u5F00\u540E\u7684\u9879\u76EE\u5DE5\u4F5C\u53F0\u4FDD\u6301\u53EA\u8BFB\uFF0CAgent \u5DE5\u4F5C\u533A\u53EF\u8FD0\u884C\u56FA\u5B9A\u7684 Codex \u521B\u4F5C\u7EBF\u7A0B\u5BBF\u4E3B\u9A8C\u8BC1\u3002"
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools };
      case "tools/call":
        return callTool(request.params, hostValidation, workspace);
      case "resources/list":
        return {
          resources: [{
            uri: WORKBENCH_URI,
            name: "Narracut \u5DE5\u4F5C\u53F0",
            description: "Project VNext \u542F\u52A8\u5668\u4E0E\u53EA\u8BFB\u53CC\u5DE5\u4F5C\u533A\u5916\u58F3",
            mimeType: "text/html;profile=mcp-app"
          }]
        };
      case "resources/read": {
        const uri = typeof request.params === "object" && request.params !== null ? request.params.uri : void 0;
        if (uri !== WORKBENCH_URI) throw new Error(`\u672A\u77E5\u8D44\u6E90\uFF1A${String(uri)}`);
        return {
          contents: [{
            uri: WORKBENCH_URI,
            mimeType: "text/html;profile=mcp-app",
            text: await loadWorkbench(),
            _meta: {
              ui: {
                prefersBorder: false,
                csp: { connectDomains: [], resourceDomains: [] }
              }
            }
          }]
        };
      }
      default:
        throw new Error(`\u4E0D\u652F\u6301\u7684\u65B9\u6CD5\uFF1A${request.method}`);
    }
  };
  return Object.assign(requestHandler, {
    dispose: async () => {
      await workspace.dispose();
      await hostValidation.dispose();
    }
  });
}
var handleRequest = createNarracutRequestHandler();
function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}
`);
}
async function handleLine(line, requestHandler) {
  if (line.trim() === "") return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    writeMessage({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (request.id === void 0) return;
  try {
    writeMessage({ jsonrpc: "2.0", id: request.id, result: await requestHandler(request) });
  } catch (error) {
    writeMessage({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" }
    });
  }
}
async function startStdioServer(requestHandler = handleRequest) {
  let inputBuffer = "";
  process.stdin.setEncoding("utf8");
  const keepAlive = setInterval(() => void 0, 6e4);
  try {
    for await (const chunk of process.stdin) {
      inputBuffer += chunk;
      const lines = inputBuffer.split("\n");
      inputBuffer = lines.pop() ?? "";
      for (const line of lines) await handleLine(line, requestHandler);
    }
    if (inputBuffer.trim() !== "") await handleLine(inputBuffer, requestHandler);
  } finally {
    clearInterval(keepAlive);
    await requestHandler.dispose();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await startStdioServer();
export {
  createNarracutRequestHandler,
  handleRequest,
  startStdioServer
};

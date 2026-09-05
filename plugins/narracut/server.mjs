// src/server/project-candidate.ts
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
var CandidateError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
var fail = (code, message) => {
  throw new CandidateError(code, message);
};
var MAX_BYTES = 32 * 1024 * 1024;
var safePath = (path) => path.length <= 1024 && !path.includes("\\") && !path.includes("\0") && path.split("/").every((p) => p && p !== "." && p !== ".." && !["node_modules", "bundle", ".cache"].includes(p));
async function regular(path, max = MAX_BYTES) {
  const facts = await lstat(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > max) throw new Error("\u6587\u4EF6\u7C7B\u578B\u6216\u5927\u5C0F\u65E0\u6548");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) throw new Error("\u6587\u4EF6\u7C7B\u578B\u6216\u5927\u5C0F\u65E0\u6548");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
async function directory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("\u76EE\u5F55\u5B8C\u6574\u6027\u65E0\u6548");
  return `${stat.dev}:${stat.ino}`;
}
async function readTree(root) {
  const tree = /* @__PURE__ */ new Map();
  let bytes = 0;
  async function walk(path, prefix, depth) {
    if (depth > 24) throw new Error("\u7A0B\u5E8F\u6811\u8D85\u8FC7 24 \u5C42");
    const identity2 = await directory(path);
    for (const name of (await readdir(path)).sort()) {
      const relative3 = prefix ? `${prefix}/${name}` : name;
      if (!safePath(relative3) || tree.size >= 4096) throw new Error("\u7A0B\u5E8F\u6811\u8DEF\u5F84\u6216\u6570\u91CF\u65E0\u6548");
      const full = join(path, name);
      const stat = await lstat(full);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        tree.set(relative3, null);
        await walk(full, relative3, depth + 1);
      } else {
        const content = await regular(full);
        bytes += content.length;
        if (bytes > MAX_BYTES) throw new Error("\u7A0B\u5E8F\u6811\u8D85\u8FC7 32 MiB");
        tree.set(relative3, content);
      }
    }
    if (await directory(path) !== identity2) throw new Error("\u8BFB\u53D6\u671F\u95F4\u76EE\u5F55\u88AB\u66FF\u6362");
  }
  await walk(root, "", 0);
  for (const required of ["program.json", "package.json", "pnpm-lock.yaml", "src/RenderProgram.tsx"]) {
    if (!Buffer.isBuffer(tree.get(required))) throw new Error(`\u7A0B\u5E8F\u6811\u7F3A\u5C11 ${required}`);
  }
  if (tree.get("src") !== null || tree.get("resources") !== null) throw new Error("\u7A0B\u5E8F\u6811\u7F3A\u5C11 src/ \u6216 resources/");
  for (const path of tree.keys()) {
    if (!["program.json", "package.json", "pnpm-lock.yaml", "src", "resources"].includes(path) && !path.startsWith("src/") && !path.startsWith("resources/")) throw new Error("\u7A0B\u5E8F\u6811\u5305\u542B\u672A\u5141\u8BB8\u7684\u9876\u5C42\u8DEF\u5F84");
  }
  return tree;
}
function identity(tree) {
  return hash(JSON.stringify([...tree].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => [path, bytes === null ? "directory" : hash(bytes)])));
}
async function writeBytes(path, bytes) {
  const handle = await open(path, "wx", 384);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeTree(root, tree) {
  await mkdir(root);
  for (const [path, bytes] of [...tree].sort(([a], [b]) => a.length - b.length)) {
    if (bytes === null) await mkdir(join(root, path));
    else await writeBytes(join(root, path), bytes);
  }
  for (const [path, bytes] of [...tree].reverse()) if (bytes === null) await syncDirectory(join(root, path));
  await syncDirectory(root);
}
async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function createCandidateManager(project, assertWritable) {
  const internal = join(project, ".narracut");
  const internalIdentity = await directory(internal);
  const pointer = join(internal, "candidate.json");
  const assertCurrent = async () => {
    await assertWritable();
    if (await directory(internal) !== internalIdentity) fail("PROJECT_IDENTITY_LOST", "\u9879\u76EE\u5185\u90E8\u76EE\u5F55\u8EAB\u4EFD\u53D8\u5316\uFF1B\u5DF2\u505C\u6B62\u5019\u9009\u5199\u5165\u3002");
  };
  async function currentRevision() {
    const value = JSON.parse((await regular(join(internal, "current.json"), 4096)).toString());
    if (!/^[0-9a-f-]{36}$/i.test(value.revisionId)) throw new Error("\u5F53\u524D\u4FEE\u8BA2\u8EAB\u4EFD\u65E0\u6548");
    return value.revisionId;
  }
  async function pointerBytes() {
    try {
      return await regular(pointer, 16384);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  const refValid = (ref) => ref && /^\.narracut\/candidate-[0-9a-f-]{36}\/(candidate|checkpoint)$/.test(ref.path) && /^sha256:[0-9a-f]{64}$/.test(ref.identity);
  async function inspect() {
    await assertCurrent();
    const sourceRevision = await currentRevision();
    let raw = null;
    let state = null;
    try {
      raw = await pointerBytes();
      if (raw === null) return { view: { status: "absent", sourceRevision, baseline: hash("absent"), candidate: null, checkpoint: null }, state: null, raw };
      const parsed = JSON.parse(raw.toString());
      if (parsed.version !== 1 || !/^[0-9a-f-]{36}$/i.test(parsed.sourceRevision) || !refValid(parsed.candidate) || !(parsed.checkpoint === null || refValid(parsed.checkpoint) && dirname(parsed.checkpoint.path) === dirname(parsed.candidate.path) && parsed.checkpoint.path.endsWith("/checkpoint")) || !parsed.candidate.path.endsWith("/candidate")) throw new Error("\u5019\u9009\u6307\u9488\u5B8C\u6574\u6027\u65E0\u6548");
      state = parsed;
      await directory(dirname(join(project, state.candidate.path)));
      const tree = await readTree(join(project, state.candidate.path));
      const treeId = identity(tree);
      let checkpointId = null;
      if (state.checkpoint) {
        await directory(dirname(join(project, state.checkpoint.path)));
        checkpointId = identity(await readTree(join(project, state.checkpoint.path)));
        if (checkpointId !== state.checkpoint.identity) throw new Error("\u6062\u590D\u68C0\u67E5\u70B9\u5B57\u8282\u53D1\u751F\u53D8\u5316");
      }
      const external = treeId !== state.candidate.identity;
      return { raw, state, tree, view: {
        status: external ? "external-change" : "saved",
        sourceRevision: state.sourceRevision,
        baseline: hash(JSON.stringify([hash(raw), treeId, checkpointId])),
        candidate: { ...state.candidate, identity: treeId },
        checkpoint: state.checkpoint,
        ...external ? { error: { code: "EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED", message: "\u5019\u9009\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF0C\u5916\u90E8\u5B57\u8282\u5DF2\u4FDD\u7559\u3002\u9700\u8981\u91CD\u65B0\u68C0\u67E5\uFF1B\u672A\u63D0\u4EA4\u4FEE\u6539\u4E0D\u5F97\u8986\u76D6\u3002" } } : {}
      } };
    } catch (error) {
      return { raw, state, view: {
        status: "integrity-failed",
        sourceRevision,
        baseline: hash(raw ?? "invalid"),
        candidate: state?.candidate ?? null,
        checkpoint: state?.checkpoint ?? null,
        error: { code: "CANDIDATE_INTEGRITY_FAILED", message: `\u5019\u9009\u6216\u6062\u590D\u68C0\u67E5\u70B9\u5B8C\u6574\u6027\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u73B0\u573A\u3002\u8BF7\u5916\u90E8\u4FEE\u590D\u540E\u91CD\u65B0\u68C0\u67E5\uFF0C\u6216\u660E\u786E\u653E\u5F03\u3002${error.message}` }
      } };
    }
  }
  return async (request) => {
    const before = await inspect();
    if (request.action === "read") return before.view;
    if (request.action === "create" && before.view.status !== "absent") fail("CANDIDATE_ALREADY_EXISTS", "\u9879\u76EE\u5DF2\u7ECF\u5B58\u5728\u552F\u4E00\u5019\u9009\uFF1B\u8BF7\u7EE7\u7EED\u4F7F\u7528\u6216\u660E\u786E\u653E\u5F03\u3002");
    if (request.action !== "create" && request.baseline !== before.view.baseline) fail("EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED", "\u5019\u9009\u57FA\u7EBF\u5DF2\u53D8\u5316\uFF1B\u672C\u6279\u672A\u4FDD\u5B58\uFF0C\u5916\u90E8\u5B57\u8282\u4E0E\u6062\u590D\u68C0\u67E5\u70B9\u5DF2\u4FDD\u7559\u3002");
    if (request.action === "discard") {
      if (!request.confirmed) fail("CANDIDATE_DISCARD_CONFIRMATION_REQUIRED", "\u653E\u5F03\u4E0D\u53EF\u64A4\u9500\uFF0C\u9700\u8981\u660E\u786E\u786E\u8BA4\u3002");
      if (before.view.status === "absent") return before.view;
      await assertCurrent();
      if (!(await pointerBytes())?.equals(before.raw ?? Buffer.alloc(0))) fail("EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED", "\u5019\u9009\u6307\u9488\u5DF2\u53D8\u5316\uFF0C\u672A\u653E\u5F03\u3002");
      await rm(pointer);
      if (before.state) await rm(dirname(join(project, before.state.candidate.path)), { recursive: true, force: true }).catch(() => void 0);
      return { status: "absent", baseline: hash("absent"), sourceRevision: await currentRevision(), candidate: null, checkpoint: null };
    }
    if (request.action !== "create" && (before.view.status !== "saved" || !before.tree)) {
      fail(before.view.error?.code ?? "CANDIDATE_MISSING", before.view.error?.message ?? "\u8BF7\u5148\u663E\u5F0F\u521B\u5EFA\u5019\u9009\u3002");
    }
    const sourceRevision = await currentRevision();
    const currentRoot = join(internal, "revisions", sourceRevision, "render-program");
    let next;
    if (request.action === "create") {
      await directory(join(internal, "revisions"));
      await directory(dirname(currentRoot));
      next = await readTree(currentRoot);
    } else {
      next = new Map(before.tree);
      if (!Array.isArray(request.changes) || request.changes.length === 0 || request.changes.length > 256) fail("CANDIDATE_BATCH_INVALID", "\u4FEE\u6539\u6279\u6B21\u5FC5\u987B\u5305\u542B 1\u2013256 \u9879\u3002");
      const seen = /* @__PURE__ */ new Set();
      for (const change of request.changes) {
        if (!change || typeof change.path !== "string" || !safePath(change.path) || !(change.path === "program.json" || change.path.startsWith("src/") || change.path.startsWith("resources/")) || !(change.content === null || typeof change.content === "string") || seen.has(change.path)) fail("CANDIDATE_BATCH_INVALID", "\u6279\u6B21\u8DEF\u5F84\u3001\u5185\u5BB9\u6216\u91CD\u590D\u9879\u65E0\u6548\uFF1B\u4F9D\u8D56\u6587\u4EF6\u53EA\u80FD\u7531\u4F9D\u8D56\u534F\u8C03\u4FEE\u6539\u3002");
        seen.add(change.path);
        if (next.get(change.path) === null) fail("CANDIDATE_BATCH_INVALID", "\u4E0D\u80FD\u5C06\u76EE\u5F55\u4F5C\u4E3A\u6587\u4EF6\u4FEE\u6539\u3002");
        if (change.content === null) next.delete(change.path);
        else {
          const bytes = Buffer.from(change.content, "utf8");
          if (bytes.length > MAX_BYTES || bytes.toString() !== change.content) fail("CANDIDATE_BATCH_INVALID", "\u5185\u5BB9\u8D85\u9650\u6216\u4E0D\u662F\u4E25\u683C UTF-8\u3002");
          const parts = change.path.split("/");
          for (let i = 1; i < parts.length; i++) {
            const parent = parts.slice(0, i).join("/");
            if (Buffer.isBuffer(next.get(parent))) fail("CANDIDATE_BATCH_INVALID", "\u6587\u4EF6\u4E0E\u76EE\u5F55\u8DEF\u5F84\u51B2\u7A81\u3002");
            next.set(parent, null);
          }
          next.set(change.path, bytes);
        }
      }
    }
    const generation = `.narracut/candidate-${randomUUID()}`;
    const root = join(project, generation);
    let committed = false;
    try {
      await assertCurrent();
      await mkdir(root);
      await writeTree(join(root, "candidate"), next);
      const treeId = identity(await readTree(join(root, "candidate")));
      if (before.tree) await writeTree(join(root, "checkpoint"), before.tree);
      const state = {
        version: 1,
        sourceRevision: before.state?.sourceRevision ?? sourceRevision,
        candidate: { path: `${generation}/candidate`, identity: treeId },
        checkpoint: before.tree ? { path: `${generation}/checkpoint`, identity: identity(before.tree) } : null
      };
      const bytes = Buffer.from(JSON.stringify(state));
      await writeBytes(join(root, "state.json"), bytes);
      await syncDirectory(root);
      await assertCurrent();
      const latest = await inspect();
      if (latest.view.baseline !== before.view.baseline || latest.view.status !== before.view.status || await currentRevision() !== sourceRevision || request.action === "create" && identity(await readTree(currentRoot)) !== treeId) fail("EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED", "\u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1B\u672C\u6279\u672A\u4FDD\u5B58\uFF0C\u4E0A\u4E00\u4EFD\u5019\u9009\u5DF2\u4FDD\u7559\u3002");
      await rename(join(root, "state.json"), pointer);
      committed = true;
      await syncDirectory(internal).catch(() => void 0);
      if (before.state) await rm(dirname(join(project, before.state.candidate.path)), { recursive: true, force: true }).catch(() => void 0);
      return {
        status: "saved",
        sourceRevision: state.sourceRevision,
        baseline: hash(JSON.stringify([hash(bytes), treeId, state.checkpoint?.identity ?? null])),
        candidate: state.candidate,
        checkpoint: state.checkpoint
      };
    } catch (error) {
      if (error instanceof CandidateError) throw error;
      return fail("CANDIDATE_SAVE_FAILED", `\u672C\u6279\u672A\u4FDD\u5B58\uFF0C\u4E0A\u4E00\u4EFD\u5019\u9009\u4E0E\u6062\u590D\u68C0\u67E5\u70B9\u5DF2\u4FDD\u7559\u3002${error.message}`);
    } finally {
      if (!committed) await rm(root, { recursive: true, force: true }).catch(() => void 0);
    }
  };
}

// plugins/narracut/src/server.ts
import { randomUUID as randomUUID5 } from "node:crypto";
import { readFile as readFile4 } from "node:fs/promises";
import { basename as basename3, isAbsolute as isAbsolute3 } from "node:path";
import { fileURLToPath } from "node:url";

// plugins/narracut/src/codex-app-server-host.ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// plugins/narracut/src/codex-host.ts
import { randomUUID as randomUUID2 } from "node:crypto";
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
    this.#idFactory = options.idFactory ?? randomUUID2;
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
import { createHash as createHash3 } from "node:crypto";
import { lstat as lstat3, open as open3, readdir as readdir2, realpath } from "node:fs/promises";
import { isAbsolute, join as join3, relative, resolve, sep } from "node:path";

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

// src/server/project-speech-vnext.ts
import { execFile } from "node:child_process";
import { createHash as createHash2, randomUUID as randomUUID3 } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat as lstat2, open as open2, readFile as readFile2, rename as rename2, rm as rm2 } from "node:fs/promises";
import { dirname as dirname2, join as join2 } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var DRAFT_DURATION_MS = 5e3;
var TTS_CAPABILITIES = {
  provider: "tokendance",
  models: [
    { value: "minimax-speech-2.8-turbo", label: "MiniMax Speech 2.8 Turbo" }
  ],
  voices: [
    { value: "Chinese (Mandarin)_News_Anchor", label: "\u666E\u901A\u8BDD \xB7 \u65B0\u95FB\u4E3B\u64AD" },
    { value: "Chinese (Mandarin)_Reliable_Executive", label: "\u666E\u901A\u8BDD \xB7 \u6C89\u7A33\u4E3B\u7BA1" }
  ],
  ranges: {
    speed: { min: 0.5, max: 2, step: 0.1 },
    volume: { min: 0.1, max: 10, step: 0.1 },
    pitch: { min: -12, max: 12, step: 1 }
  },
  audio: { format: "mp3", sampleRate: 32e3, bitrate: 128e3, channels: 1 }
};
var ProjectTtsConfigError = class extends Error {
  constructor(message, path, options = {}) {
    super(message, options);
    this.path = path;
    this.name = "ProjectTtsConfigError";
  }
  path;
  code = "TTS_CONFIG_INVALID";
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function inRange(value, range) {
  return typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max;
}
function validateProjectTtsConfig(value) {
  if (!isRecord(value)) throw new ProjectTtsConfigError("tts.json \u6839\u503C\u5FC5\u987B\u662F\u5BF9\u8C61\u3002", "tts.json");
  const keys = Object.keys(value).sort();
  const expected = ["model", "pitch", "provider", "speed", "voice", "volume"].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new ProjectTtsConfigError("tts.json \u53EA\u80FD\u5305\u542B provider\u3001model\u3001voice\u3001speed\u3001volume \u4E0E pitch\u3002", "tts.json");
  }
  if (value.provider !== TTS_CAPABILITIES.provider) {
    throw new ProjectTtsConfigError("provider \u5FC5\u987B\u662F tokendance\u3002", "tts.json");
  }
  if (!TTS_CAPABILITIES.models.some((model) => model.value === value.model)) {
    throw new ProjectTtsConfigError("model \u4E0D\u5728\u670D\u52A1\u7AEF\u58F0\u660E\u7684\u652F\u6301\u8303\u56F4\u5185\u3002", "tts.json");
  }
  if (!TTS_CAPABILITIES.voices.some((voice) => voice.value === value.voice)) {
    throw new ProjectTtsConfigError("voice \u4E0D\u5728\u670D\u52A1\u7AEF\u58F0\u660E\u7684\u652F\u6301\u8303\u56F4\u5185\u3002", "tts.json");
  }
  if (!inRange(value.speed, TTS_CAPABILITIES.ranges.speed)) {
    throw new ProjectTtsConfigError("speed \u5FC5\u987B\u5728 0.5\u20132.0 \u4E4B\u95F4\u3002", "tts.json");
  }
  if (!inRange(value.volume, TTS_CAPABILITIES.ranges.volume)) {
    throw new ProjectTtsConfigError("volume \u5FC5\u987B\u5728 0.1\u201310.0 \u4E4B\u95F4\u3002", "tts.json");
  }
  if (!inRange(value.pitch, TTS_CAPABILITIES.ranges.pitch) || !Number.isInteger(value.pitch)) {
    throw new ProjectTtsConfigError("pitch \u5FC5\u987B\u662F -12\u201312 \u4E4B\u95F4\u7684\u6574\u6570\u3002", "tts.json");
  }
  return value;
}
function ttsProfileId(config) {
  const stable = JSON.stringify({
    provider: config.provider,
    model: config.model,
    voice: config.voice,
    speed: config.speed,
    volume: config.volume,
    pitch: config.pitch,
    audio: TTS_CAPABILITIES.audio
  });
  return `sha256:${createHash2("sha256").update(stable, "utf8").digest("hex")}`;
}
async function readProjectTtsConfig(projectDirectory) {
  const path = join2(projectDirectory, "tts.json");
  let bytes;
  try {
    const facts = await lstat2(path);
    if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > 16 * 1024) {
      throw new ProjectTtsConfigError("tts.json \u5FC5\u987B\u662F\u5C0F\u4E8E 16 KiB \u7684\u65E0\u94FE\u63A5\u666E\u901A\u6587\u4EF6\u3002", path);
    }
    bytes = await readFile2(path);
  } catch (cause) {
    if (cause instanceof ProjectTtsConfigError) throw cause;
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return { status: "unconfigured" };
    }
    throw new ProjectTtsConfigError("\u65E0\u6CD5\u5B89\u5168\u8BFB\u53D6 tts.json\u3002", path, { cause });
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new ProjectTtsConfigError("tts.json \u5FC5\u987B\u662F\u4E25\u683C UTF-8\u3002", path, { cause });
  }
  let parsed;
  try {
    parsed = parseStrictJson(text, {
      maxDepth: 3,
      maxArrayItems: 0,
      maxObjectFields: 8,
      maxNodes: 16,
      maxStringScalars: 256,
      maxStringBytes: 1024,
      maxNumberBytes: 32,
      forbidArrays: true
    });
  } catch (cause) {
    throw new ProjectTtsConfigError("tts.json \u4E0D\u662F\u53D7\u652F\u6301\u7684\u4E25\u683C JSON\u3002", path, { cause });
  }
  const config = validateProjectTtsConfig(parsed);
  return { status: "configured", config, profileId: ttsProfileId(config) };
}
async function writeProjectTtsConfig(projectDirectory, input, assertWritable = async () => void 0) {
  const config = validateProjectTtsConfig(input);
  const path = join2(projectDirectory, "tts.json");
  const temporaryPath = join2(projectDirectory, `.tts.json.${randomUUID3()}.tmp`);
  let committed = false;
  try {
    const handle = await open2(temporaryPath, "wx", 384);
    try {
      await handle.writeFile(Buffer.from(JSON.stringify(config), "utf8"));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertWritable();
    await rename2(temporaryPath, path);
    committed = true;
    try {
      const directory2 = await open2(dirname2(path), "r");
      try {
        await directory2.sync();
      } finally {
        await directory2.close();
      }
    } catch {
    }
  } finally {
    if (!committed) await rm2(temporaryPath, { force: true }).catch(() => void 0);
  }
  return { status: "configured", config, profileId: ttsProfileId(config) };
}
function deriveSceneTimeWindows(scenes, fps) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("fps \u5FC5\u987B\u662F\u6B63\u6570\u3002");
  let startFrame = 0;
  let renderReady = scenes.length > 0;
  const windows = scenes.map((scene) => {
    const durationInFrames = Math.max(1, Math.ceil(scene.durationMs / 1e3 * fps));
    const window = {
      sceneId: scene.sceneId,
      startFrame,
      durationInFrames,
      source: scene.source
    };
    startFrame += durationInFrames;
    if (scene.source === "draft") renderReady = false;
    return window;
  });
  return { durationInFrames: startFrame, renderReady, scenes: windows };
}
async function probeSpeechDurationMs(path) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_name",
    "-of",
    "json",
    path
  ], { encoding: "utf8", timeout: 3e4, maxBuffer: 256 * 1024 });
  const payload = JSON.parse(stdout);
  const duration = typeof payload.format?.duration === "string" ? Number(payload.format.duration) : Number.NaN;
  if (!payload.streams?.some((stream) => stream.codec_name === "mp3") || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("Speech \u4E0D\u662F\u53EF\u89E3\u7801\u7684 MP3\u3002");
  }
  return Math.round(duration * 1e3);
}
async function speechContentHash(path) {
  const handle = await open2(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const hash2 = createHash2("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      hash2.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    return `sha256:${hash2.digest("hex")}`;
  } finally {
    await handle.close();
  }
}
async function inspectProjectSpeech(projectDirectory, scenes, currentProfileId, options = {}) {
  const probe = options.probeDurationMs ?? probeSpeechDurationMs;
  const states = [];
  const durations = [];
  for (const scene of scenes) {
    const speech = scene.speech;
    if (speech === void 0) {
      states.push({ sceneId: scene.id, status: "missing", reason: "\u5F53\u524D Scene \u7F3A\u5C11 Speech\u3002" });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    const currentSourceTextHash = `sha256:${createHash2("sha256").update(scene.narration.text, "utf8").digest("hex")}`;
    if (speech.sourceTextHash !== currentSourceTextHash) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "changed",
        reason: "Speech \u4E0E\u5F53\u524D Narration \u4E0D\u5339\u914D\u3002"
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    if (currentProfileId === void 0 || speech.ttsProfileId !== currentProfileId) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "profile-mismatch",
        reason: "Speech \u4E0E\u5F53\u524D TTS \u914D\u7F6E\u4E0D\u5339\u914D\u3002"
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    const absolutePath = join2(projectDirectory, speech.path);
    let before;
    try {
      before = await lstat2(absolutePath);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error("not ordinary");
    } catch {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "unavailable",
        reason: "Speech \u6587\u4EF6\u7F3A\u5931\u3001\u4E0D\u53EF\u8BFB\u6216\u4E0D\u662F\u65E0\u94FE\u63A5\u666E\u901A\u6587\u4EF6\u3002"
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    if (speech.audioContentHash === void 0) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "changed",
        reason: "Speech \u7F3A\u5C11\u97F3\u9891\u5185\u5BB9\u6458\u8981\uFF0C\u65E0\u6CD5\u8BC1\u660E\u4ECD\u662F\u5DF2\u63D0\u4EA4\u7684\u97F3\u9891\u3002"
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    let actualDurationMs;
    let actualContentHash;
    try {
      [actualDurationMs, actualContentHash] = await Promise.all([
        probe(absolutePath),
        speechContentHash(absolutePath)
      ]);
    } catch {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "decode-failed",
        reason: "Speech \u6587\u4EF6\u65E0\u6CD5\u89E3\u7801\u4E3A MP3\u3002"
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    let after;
    try {
      after = await lstat2(absolutePath);
    } catch {
      after = void 0;
    }
    const changedDuringProbe = after === void 0 || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs;
    if (changedDuringProbe || actualDurationMs !== speech.durationMs || actualContentHash !== speech.audioContentHash) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "changed",
        durationMs: actualDurationMs,
        reason: changedDuringProbe ? "Speech \u6587\u4EF6\u5728\u68C0\u67E5\u671F\u95F4\u53D1\u751F\u539F\u4F4D\u53D8\u5316\u3002" : actualContentHash !== speech.audioContentHash ? "Speech \u97F3\u9891\u5185\u5BB9\u4E0E\u5DF2\u63D0\u4EA4\u6458\u8981\u4E0D\u4E00\u81F4\u3002" : `Speech \u5B9E\u9645\u65F6\u957F ${actualDurationMs} ms \u4E0E\u8BB0\u5F55\u7684 ${speech.durationMs} ms \u4E0D\u4E00\u81F4\u3002`
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    states.push({
      sceneId: scene.id,
      path: speech.path,
      status: "available",
      durationMs: actualDurationMs
    });
    durations.push({ sceneId: scene.id, durationMs: actualDurationMs, source: "speech" });
  }
  const timeline = deriveSceneTimeWindows(durations, options.fps ?? 30);
  return {
    states,
    timeline: {
      ...timeline,
      renderReady: timeline.renderReady && scenes.every((scene) => scene.narration.text.trim() !== "")
    }
  };
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
function isRecord2(value) {
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
    const identity2 = `${diagnostic.jsonPath ?? ""}${diagnostic.code}${diagnostic.message}`;
    if (!unique.has(identity2)) unique.set(identity2, diagnostic);
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
  if (!isRecord2(value)) {
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
    if (isRecord2(asset) && typeof asset.path === "string") {
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
    if (!isRecord2(scene)) continue;
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
    if (isRecord2(scene.speech)) {
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
    if (!isRecord2(asset)) {
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
    if (!isRecord2(scene)) {
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
    if (!isRecord2(scene.narration)) {
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
      if (!isRecord2(scene.speech)) {
        diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech`, "speech \u7F3A\u7701\u65F6\u5FC5\u987B\u7701\u7565\u5B57\u6BB5\uFF0C\u5B58\u5728\u65F6\u5FC5\u987B\u662F\u5B8C\u6574\u5BF9\u8C61\u3002"));
      } else {
        unknownFields(scene.speech, ["path", "durationMs", "sourceTextHash", "ttsProfileId", "audioContentHash"], `${path}.speech`, diagnostics);
        const expectedPath = typeof scene.id === "string" ? `speech/${scene.id}.mp3` : void 0;
        if (typeof scene.speech.path !== "string" || !isCanonicalResourcePath(scene.speech.path, "speech") || scene.speech.path !== expectedPath) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_PATH_INVALID", `${path}.speech.path`, `Speech path \u5FC5\u987B\u7CBE\u786E\u4E3A ${expectedPath ?? "speech/<sceneId>.mp3"}\u3002`));
        }
        if (!Number.isSafeInteger(scene.speech.durationMs) || scene.speech.durationMs <= 0) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech.durationMs`, "durationMs \u5FC5\u987B\u662F\u6B63\u5B89\u5168\u6574\u6570\u3002"));
        }
        const narrationText = isRecord2(scene.narration) && typeof scene.narration.text === "string" ? scene.narration.text : void 0;
        const expectedHash = narrationText === void 0 ? void 0 : `sha256:${createHash3("sha256").update(narrationText, "utf8").digest("hex")}`;
        if (typeof scene.speech.sourceTextHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(scene.speech.sourceTextHash) || expectedHash !== void 0 && scene.speech.sourceTextHash !== expectedHash) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SPEECH_MISMATCH", `${path}.speech.sourceTextHash`, "sourceTextHash \u5FC5\u987B\u5339\u914D\u5F53\u524D Narration \u7684\u539F\u59CB UTF-8 \u5B57\u8282\u3002"));
        }
        if (typeof scene.speech.ttsProfileId !== "string") {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech.ttsProfileId`, "ttsProfileId \u5FC5\u987B\u662F\u4E0D\u8D85\u8FC7 256 \u4E2A Unicode \u6807\u91CF\u7684\u5B57\u7B26\u4E32\u3002"));
        }
        if ("audioContentHash" in scene.speech && (typeof scene.speech.audioContentHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(scene.speech.audioContentHash))) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech.audioContentHash`, "audioContentHash \u5FC5\u987B\u662F\u89C4\u8303\u7684 SHA-256 \u6458\u8981\u3002"));
        }
      }
    }
  });
  return {
    ...diagnostics.length === 0 ? { project: value } : {},
    diagnostics: boundedDiagnostics(diagnostics)
  };
}
function validateProjectVNextForSave(value, projectPath = "project.json") {
  let inputBytes;
  try {
    inputBytes = Buffer.from(JSON.stringify(value), "utf8");
  } catch (cause) {
    throw invalidControlFile(projectPath, {
      code: "PROJECT_DSL_SCHEMA_INVALID",
      component: "project.json",
      jsonPath: "$",
      message: "Project DSL \u5FC5\u987B\u662F\u53EF\u5E8F\u5217\u5316\u7684 JSON \u5BF9\u8C61\u3002"
    }, { cause });
  }
  if (inputBytes.length > 10 * 1024 * 1024) {
    throw invalidControlFile(projectPath, {
      code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      component: "project.json",
      message: `project.json \u4E3A ${inputBytes.length} \u5B57\u8282\uFF0C\u8D85\u8FC7\u4E0A\u9650 ${10 * 1024 * 1024}\uFF1B\u8BF7\u7F29\u51CF\u5185\u5BB9\u540E\u91CD\u8BD5\u3002`,
      metric: "bytes",
      actual: inputBytes.length,
      limit: 10 * 1024 * 1024
    });
  }
  const parsed = parseControlJson(
    inputBytes.toString("utf8"),
    projectPath,
    "project.json",
    PROJECT_JSON_LIMITS
  );
  const validation = validateProjectDsl(parsed);
  if (validation.project === void 0) {
    throw invalidContent(projectPath, validation.diagnostics);
  }
  const project = validation.project;
  const bytes = Buffer.from(JSON.stringify({
    assets: project.assets.map((asset) => ({ id: asset.id, path: asset.path })),
    scenes: project.scenes.map((scene) => ({
      id: scene.id,
      narration: { text: scene.narration.text },
      assetIds: [...scene.assetIds],
      ...scene.speech === void 0 ? {} : {
        speech: {
          path: scene.speech.path,
          durationMs: scene.speech.durationMs,
          sourceTextHash: scene.speech.sourceTextHash,
          ttsProfileId: scene.speech.ttsProfileId,
          ...scene.speech.audioContentHash === void 0 ? {} : { audioContentHash: scene.speech.audioContentHash }
        }
      }
    }))
  }), "utf8");
  return { project, bytes };
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
  const pathFacts = await lstat3(path);
  if (!pathFacts.isFile() || pathFacts.isSymbolicLink() || pathFacts.nlink !== 1) {
    throw invalidControlFile(path, {
      code: "PROJECT_REQUIRED_CONTENT_INVALID",
      component,
      message: `${component} \u5FC5\u987B\u662F\u65E0\u7B26\u53F7\u94FE\u63A5\u3001\u65E0\u786C\u94FE\u63A5\u7684\u666E\u901A\u6587\u4EF6\uFF1B\u8BF7\u66FF\u6362\u8BE5\u8DEF\u5F84\u540E\u91CD\u8BD5\u3002`
    });
  }
  const handle = await open3(path, "r");
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
async function readProjectVNextRevision(projectPath) {
  const bytes = await readBoundedControlFile(projectPath, "project.json", 10 * 1024 * 1024);
  return `sha256:${createHash3("sha256").update(bytes).digest("hex")}`;
}
async function readVideoBriefVNext(videoBriefPath) {
  const buffer = await readBoundedControlFile(videoBriefPath, "video.md", 2 * 1024 * 1024);
  return {
    content: decodeUtf8(buffer, videoBriefPath, "video.md", true),
    revision: `sha256:${createHash3("sha256").update(buffer).digest("hex")}`,
    bytes: buffer.length
  };
}
async function requireDirectory(path) {
  const facts = await lstat3(path);
  if (!facts.isDirectory() || facts.isSymbolicLink()) throw new Error(`\u5FC5\u9700\u76EE\u5F55\u65E0\u6548\uFF1A${path}`);
}
async function requireFile(path) {
  const facts = await lstat3(path);
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
    const path = join3(projectDirectory, component);
    let facts;
    try {
      facts = await lstat3(path);
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
  const resourcePath = join3(projectDirectory, relativePath);
  const allowedRoot = await realpath(join3(projectDirectory, parts[0]));
  const resolvedResource = await realpath(resourcePath);
  const relation = relative(allowedRoot, resolvedResource);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw invalidResource(
      resourcePath,
      relativePath,
      `${relativePath} \u89E3\u6790\u5230 ${allowedRoot} \u4E4B\u5916\uFF1B\u8BF7\u79FB\u9664\u8DEF\u5F84\u4E2D\u7684\u94FE\u63A5\u3002`
    );
  }
  for (const identity2 of directoryIdentities) {
    const current = await lstat3(identity2.path);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity2.dev || current.ino !== identity2.ino) {
      throw invalidResource(
        identity2.path,
        relative(projectDirectory, identity2.path),
        `${relative(projectDirectory, identity2.path)} \u5728\u68C0\u67E5\u671F\u95F4\u88AB\u66FF\u6362\uFF1B\u8BF7\u505C\u6B62\u5916\u90E8\u4FEE\u6539\u540E\u91CD\u8BD5\u3002`
      );
    }
  }
}
async function validateProjectVNextResources(projectDirectory, project, options = {}) {
  const assetStates = [];
  for (const asset of project.assets) {
    const path = join3(projectDirectory, asset.path);
    await validateOrdinaryResource(projectDirectory, asset.path, false);
    let facts;
    try {
      facts = await lstat3(path);
    } catch (cause) {
      assetStates.push({
        id: asset.id,
        path: asset.path,
        status: "unavailable",
        reason: isFileSystemError(cause) && cause.code === "ENOENT" ? "\u6587\u4EF6\u7F3A\u5931\u6216\u5DF2\u88AB\u79FB\u52A8\u3002" : "\u6587\u4EF6\u65E0\u6CD5\u8BFB\u53D6\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u6216\u8BBE\u5907\u72B6\u6001\u3002"
      });
      continue;
    }
    try {
      const handle = await open3(path, "r");
      await handle.close();
      assetStates.push({
        id: asset.id,
        path: asset.path,
        status: "available",
        size: facts.size
      });
    } catch {
      assetStates.push({
        id: asset.id,
        path: asset.path,
        status: "unavailable",
        reason: "\u6587\u4EF6\u65E0\u6CD5\u8BFB\u53D6\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u6216\u8BBE\u5907\u72B6\u6001\u3002"
      });
    }
  }
  const speech = await inspectProjectSpeech(
    projectDirectory,
    project.scenes,
    options.currentTtsProfileId,
    { probeDurationMs: options.probeSpeechDurationMs }
  );
  const speechWarnings = speech.states.filter((state) => state.status !== "available" && state.status !== "missing").map((state, index) => {
    const sceneIndex = project.scenes.findIndex((scene) => scene.id === state.sceneId);
    const code = {
      available: "",
      missing: "PROJECT_SPEECH_MISSING",
      unavailable: "PROJECT_SPEECH_UNAVAILABLE",
      "decode-failed": "PROJECT_SPEECH_DECODE_FAILED",
      changed: "PROJECT_SPEECH_CHANGED",
      "profile-mismatch": "PROJECT_SPEECH_PROFILE_MISMATCH"
    }[state.status];
    return {
      code: code ?? "PROJECT_SPEECH_UNAVAILABLE",
      component: state.path ?? `Scene ${sceneIndex + 1}`,
      jsonPath: `$.scenes[${sceneIndex < 0 ? index : sceneIndex}].speech`,
      message: state.reason ?? "Speech \u5F53\u524D\u4E0D\u53EF\u7528\u4E8E\u6B63\u5F0F Render\u3002"
    };
  });
  return {
    assetStates,
    speechStates: speech.states,
    timeline: speech.timeline,
    warnings: boundedDiagnostics([...assetStates.filter((asset) => asset.status === "unavailable").map((asset) => ({
      code: "PROJECT_ASSET_UNAVAILABLE",
      component: asset.path,
      message: `${asset.path} \u4E0D\u53EF\u7528\uFF1A${asset.reason ?? "\u65E0\u6CD5\u8BFB\u53D6\u3002"}`
    })), ...speechWarnings])
  };
}
async function readStableDirectory(directory2) {
  const entries = await readdir2(directory2, { withFileTypes: true });
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
    const { directory: directory2, depth } = stack.pop();
    directoriesVisited += 1;
    if (directoriesVisited > MAX_DIRECTORY_TREE_DIRECTORIES) {
      throw directoryTreeLimit(projectDirectory, directory2, "directories", directoriesVisited, MAX_DIRECTORY_TREE_DIRECTORIES);
    }
    let entries;
    try {
      entries = await readStableDirectory(directory2);
    } catch (cause) {
      throw new ProjectInspectionError(
        "PROJECT_PATH_UNAVAILABLE",
        directory2,
        `\u65E0\u6CD5\u68C0\u67E5\u9879\u76EE\u5185\u5BB9\u76EE\u5F55 ${directory2}\uFF1B\u8BF7\u68C0\u67E5\u6743\u9650\u540E\u91CD\u8BD5\u3002`,
        [],
        { cause }
      );
    }
    for (const entry of [...entries].reverse()) {
      if (directory2 === projectDirectory && excludedRoots.has(entry.name)) continue;
      if (["node_modules", ".cache", "bundle"].includes(entry.name)) continue;
      const path = join3(directory2, entry.name);
      const facts = await lstat3(path);
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
    const path = join3(programDirectory, ...entry.split("/"));
    let facts;
    try {
      facts = await lstat3(path);
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
    const { directory: directory2, depth } = stack.pop();
    directoriesVisited += 1;
    if (directoriesVisited > MAX_DIRECTORY_TREE_DIRECTORIES) {
      throw directoryTreeLimit(projectDirectory, directory2, "directories", directoriesVisited, MAX_DIRECTORY_TREE_DIRECTORIES);
    }
    for (const entry of [...await readStableDirectory(directory2)].reverse()) {
      const path = join3(directory2, entry.name);
      const component = relative(projectDirectory, path);
      if (["node_modules", ".cache", "bundle"].includes(entry.name)) {
        throw invalidResource(path, component, `Render Program \u4E0D\u5F97\u643A\u5E26 ${entry.name} \u6D3E\u751F\u4EA7\u7269\uFF1B\u8BF7\u5C06\u5176\u79FB\u51FA\u9879\u76EE\u3002`);
      }
      const facts = await lstat3(path);
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
async function inspectProjectVNext(inputPath, options = {}) {
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
  const manifestPath = join3(projectDirectory, "narracut.json");
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
    [join3(projectDirectory, "assets"), "assets/", "directory"],
    [join3(projectDirectory, "speech"), "speech/", "directory"],
    [join3(projectDirectory, "renders"), "renders/", "directory"]
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
        join3(projectDirectory, "project.json"),
        "project.json",
        10 * 1024 * 1024
      ),
      readBoundedControlFile(
        join3(projectDirectory, "video.md"),
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
    join3(projectDirectory, "project.json"),
    "project.json",
    false
  );
  const videoBytes = decodeUtf8(
    videoBuffer,
    join3(projectDirectory, "video.md"),
    "video.md",
    true
  );
  const projectPath = join3(projectDirectory, "project.json");
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
  let tts;
  try {
    tts = await readProjectTtsConfig(projectDirectory);
  } catch (cause) {
    if (cause instanceof ProjectTtsConfigError) {
      throw invalidControlFile(cause.path, {
        code: cause.code,
        component: "tts.json",
        jsonPath: "$",
        message: cause.message
      }, { cause });
    }
    throw cause;
  }
  const { assetStates, speechStates, timeline, warnings } = await validateProjectVNextResources(
    projectDirectory,
    projectValidation.project,
    {
      ...tts.status === "configured" ? { currentTtsProfileId: tts.profileId } : {},
      probeSpeechDurationMs: options.probeSpeechDurationMs
    }
  );
  return {
    projectDirectory,
    manifest,
    project: projectValidation.project,
    projectRevision: `sha256:${createHash3("sha256").update(projectBuffer).digest("hex")}`,
    videoBrief: videoBytes,
    videoBriefRevision: `sha256:${createHash3("sha256").update(videoBuffer).digest("hex")}`,
    renderPrograms: { directories: renderProgramDirectories },
    assetStates,
    tts,
    speechStates,
    timeline,
    warnings
  };
}

// src/server/project-lifecycle.ts
import { createHash as createHash4, randomUUID as randomUUID4 } from "node:crypto";
import { constants as fsConstants2 } from "node:fs";
import {
  access,
  link,
  lstat as lstat4,
  mkdir as mkdir2,
  open as openFile,
  readFile as readFile3,
  readdir as readdir3,
  realpath as realpath2,
  rename as rename3,
  rmdir,
  rm as rm3,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, dirname as dirname3, isAbsolute as isAbsolute2, join as join4, relative as relative2, resolve as resolve2, sep as sep2 } from "node:path";
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
var ProjectTtsConfirmationError = class extends Error {
  constructor(affectedSpeechCount) {
    super(`\u4FDD\u5B58\u5F53\u524D TTS \u914D\u7F6E\u4F1A\u79FB\u9664 ${affectedSpeechCount} \u6761\u4E0D\u5339\u914D\u7684 Speech \u8BB0\u5F55\uFF0C\u9700\u8981\u91CD\u65B0\u786E\u8BA4\u3002`);
    this.affectedSpeechCount = affectedSpeechCount;
    this.name = "ProjectTtsConfirmationError";
  }
  affectedSpeechCount;
  code = "TTS_CONFIRMATION_REQUIRED";
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
    await lstat4(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
async function removeConfirmedCreateResidue(temporaryDirectory, projectDirectory, confirmed) {
  const facts = await lstat4(temporaryDirectory);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `\u4E34\u65F6\u8DEF\u5F84\u4E0D\u662F\u53EF\u786E\u8BA4\u5F52\u5C5E\u7684\u666E\u901A\u76EE\u5F55\uFF1A${temporaryDirectory}\u3002Narracut \u62D2\u7EDD\u5220\u9664\u3002`
    );
  }
  const markerPath = join4(temporaryDirectory, OPERATION_MARKER);
  let marker;
  try {
    const markerFacts = await lstat4(markerPath);
    if (!markerFacts.isFile() || markerFacts.isSymbolicLink() || markerFacts.nlink !== 1 || markerFacts.size > 4096) {
      throw new Error("invalid marker");
    }
    marker = JSON.parse(await readFile3(markerPath, "utf8"));
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
  const currentFacts = await lstat4(temporaryDirectory);
  if (currentFacts.dev !== facts.dev || currentFacts.ino !== facts.ino || !currentFacts.isDirectory()) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `\u4E34\u65F6\u76EE\u5F55\u5728\u786E\u8BA4\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF1A${temporaryDirectory}\u3002Narracut \u62D2\u7EDD\u5220\u9664\u3002`
    );
  }
  await rm3(temporaryDirectory, { recursive: true });
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
    briefFingerprint: revisionOf(Buffer.alloc(0)),
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
  const renderProgramDirectory = join4(
    temporaryDirectory,
    ".narracut",
    "revisions",
    revisionId,
    "render-program"
  );
  await Promise.all([
    mkdir2(join4(temporaryDirectory, "assets"), { recursive: true }),
    mkdir2(join4(temporaryDirectory, "speech"), { recursive: true }),
    mkdir2(join4(temporaryDirectory, "renders"), { recursive: true }),
    mkdir2(join4(renderProgramDirectory, "src"), { recursive: true }),
    mkdir2(join4(renderProgramDirectory, "resources"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(join4(temporaryDirectory, "narracut.json"), starterManifest(projectId)),
    writeFile(join4(temporaryDirectory, "project.json"), '{"assets":[],"scenes":[]}'),
    writeFile(join4(temporaryDirectory, "video.md"), ""),
    writeFile(join4(temporaryDirectory, ".narracut", "current.json"), starterCurrent(revisionId)),
    writeFile(
      join4(temporaryDirectory, ".narracut", "revisions", revisionId, "revision.json"),
      starterRevision(revisionId)
    ),
    writeFile(join4(renderProgramDirectory, "program.json"), starterProgramManifest()),
    writeFile(join4(renderProgramDirectory, "package.json"), starterPackageManifest()),
    writeFile(join4(renderProgramDirectory, "pnpm-lock.yaml"), starterLockfile()),
    writeFile(join4(renderProgramDirectory, "src", "RenderProgram.tsx"), starterSource())
  ]);
}
async function validateStarterProject(temporaryDirectory, projectId, revisionId) {
  const renderProgramDirectory = join4(
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
    readFile3(join4(temporaryDirectory, "narracut.json"), "utf8"),
    readFile3(join4(temporaryDirectory, "project.json"), "utf8"),
    readFile3(join4(temporaryDirectory, "video.md"), "utf8"),
    readFile3(join4(temporaryDirectory, ".narracut", "current.json"), "utf8"),
    readFile3(join4(temporaryDirectory, ".narracut", "revisions", revisionId, "revision.json"), "utf8"),
    readFile3(join4(renderProgramDirectory, "program.json"), "utf8"),
    readFile3(join4(renderProgramDirectory, "package.json"), "utf8"),
    readFile3(join4(renderProgramDirectory, "pnpm-lock.yaml"), "utf8"),
    readFile3(join4(renderProgramDirectory, "src", "RenderProgram.tsx"), "utf8")
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
  const facts = await lstat4(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > maxBytes) {
    throw new Error(`\u4E0D\u662F\u53D7\u652F\u6301\u7684\u666E\u901A\u6587\u4EF6\uFF1A${path}`);
  }
  return readFile3(path, "utf8");
}
async function validateCurrentProjectState(inspection) {
  const projectDirectory = inspection.projectDirectory;
  const currentPath = join4(projectDirectory, ".narracut", "current.json");
  let briefRevision = null;
  try {
    const current = parseStrictJson(
      await readRegularUtf8(currentPath, 4096),
      INTERNAL_JSON_LIMITS
    );
    if (!isPlainRecord(current) || Object.keys(current).length !== 1 || typeof current.revisionId !== "string" || !UUID_PATTERN2.test(current.revisionId)) {
      throw new Error("\u5F53\u524D\u4FEE\u8BA2\u6307\u9488\u65E0\u6548\u3002");
    }
    const revisionId = current.revisionId;
    const revisionDirectory = join4(projectDirectory, ".narracut", "revisions", revisionId);
    const renderProgramDirectory = join4(revisionDirectory, "render-program");
    if (!inspection.renderPrograms.directories.includes(renderProgramDirectory)) {
      throw new Error("\u5F53\u524D\u4FEE\u8BA2\u6CA1\u6709\u53EF\u68C0\u67E5\u7684 Render Program\u3002");
    }
    const [revision, program, packageJson, lockfile, source] = await Promise.all([
      readRegularUtf8(join4(revisionDirectory, "revision.json"), 16384).then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join4(renderProgramDirectory, "program.json"), 16384).then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join4(renderProgramDirectory, "package.json"), 65536).then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join4(renderProgramDirectory, "pnpm-lock.yaml"), 1048576),
      readRegularUtf8(join4(renderProgramDirectory, "src", "RenderProgram.tsx"), 10485760)
    ]);
    if (!isPlainRecord(revision) || Object.keys(revision).some(
      (key) => !["revisionId", "previousRevisionId", "briefFingerprint", "source", "summary"].includes(key)
    ) || revision.revisionId !== revisionId || !(revision.previousRevisionId === null || typeof revision.previousRevisionId === "string" && UUID_PATTERN2.test(revision.previousRevisionId)) || revision.briefFingerprint !== void 0 && (typeof revision.briefFingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(revision.briefFingerprint)) || typeof revision.source !== "string" || typeof revision.summary !== "string") {
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
    briefRevision = typeof revision.briefFingerprint === "string" ? revision.briefFingerprint : null;
  } catch (cause) {
    if (cause instanceof ProjectLifecycleError) throw cause;
    throw new ProjectLifecycleError(
      "PROJECT_CURRENT_INVALID",
      currentPath,
      `\u5F53\u524D Render Program \u4FEE\u8BA2\u65E0\u6548\uFF1A${projectDirectory}\u3002Narracut \u4E0D\u4F1A\u6253\u5F00\u6216\u4FEE\u590D\u8BE5\u9879\u76EE\u3002`,
      { cause }
    );
  }
  return briefRevision;
}
async function captureDirectoryIdentity(path) {
  const facts = await lstat4(path);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new Error(`\u8DEF\u5F84\u4E0D\u662F\u666E\u901A\u76EE\u5F55\uFF1A${path}`);
  }
  return { dev: facts.dev, ino: facts.ino };
}
function hasIdentity(facts, identity2) {
  return facts.dev === identity2.dev && facts.ino === identity2.ino;
}
async function cleanupOwnedTemporaryDirectory(temporaryDirectory, identity2, markerWritten, projectDirectory, operationToken) {
  let facts;
  try {
    facts = await lstat4(temporaryDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, identity2)) {
    throw new Error("\u521B\u5EFA\u4E34\u65F6\u76EE\u5F55\u5DF2\u88AB\u66FF\u6362\uFF0C\u65E0\u6CD5\u8BC1\u660E\u6E05\u7406\u6240\u6709\u6743\u3002");
  }
  if (markerWritten) {
    const marker = JSON.parse(await readRegularUtf8(
      join4(temporaryDirectory, OPERATION_MARKER),
      4096
    ));
    if (!isCreateOperationMarker(marker, projectDirectory, operationToken)) {
      throw new Error("\u521B\u5EFA\u4E34\u65F6\u76EE\u5F55\u6807\u8BB0\u5DF2\u53D8\u5316\uFF0C\u65E0\u6CD5\u8BC1\u660E\u6E05\u7406\u6240\u6709\u6743\u3002");
    }
  }
  await rm3(temporaryDirectory, { recursive: true });
}
async function cleanupTargetReservation(projectDirectory, identity2) {
  let facts;
  try {
    facts = await lstat4(projectDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, identity2)) {
    throw new Error("\u53D1\u5E03\u76EE\u6807\u4FDD\u7559\u76EE\u5F55\u5DF2\u88AB\u66FF\u6362\uFF0C\u65E0\u6CD5\u8BC1\u660E\u6E05\u7406\u6240\u6709\u6743\u3002");
  }
  if ((await readdir3(projectDirectory)).length !== 0) {
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
  const temporaryDirectory = join4(dirname3(projectDirectory), `.${projectName}.narracut-tmp`);
  const createId = options.createId ?? randomUUID4;
  const projectId = createId();
  const revisionId = createId();
  const operationToken = randomUUID4();
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
    await mkdir2(temporaryDirectory);
    temporaryIdentity = await captureDirectoryIdentity(temporaryDirectory);
    await writeFile(join4(temporaryDirectory, OPERATION_MARKER), JSON.stringify({
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
        await mkdir2(projectDirectory);
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
    await unlink(join4(temporaryDirectory, OPERATION_MARKER));
    markerWritten = false;
    if (targetReservationIdentity !== null) {
      const currentReservation = await lstat4(projectDirectory);
      if (!currentReservation.isDirectory() || currentReservation.isSymbolicLink() || !hasIdentity(currentReservation, targetReservationIdentity) || (await readdir3(projectDirectory)).length !== 0) {
        throw new ProjectLifecycleError(
          "PROJECT_CREATE_TARGET_EXISTS",
          projectDirectory,
          `\u539F\u5B50\u53D1\u5E03\u65F6\u76EE\u6807\u4FDD\u7559\u76EE\u5F55\u53D1\u751F\u53D8\u5316\uFF1A${projectDirectory}\u3002Narracut \u62D2\u7EDD\u8986\u76D6\u3002`
        );
      }
    }
    await rename3(temporaryDirectory, projectDirectory);
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
    const statBytes = await readFile3(`/proc/${pid}/stat`, "utf8");
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
    facts = await lstat4(leasePath);
    if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > 4096) return false;
    marker = JSON.parse(await readFile3(leasePath, "utf8"));
  } catch {
    return false;
  }
  if (!isLeaseMarker(marker) || await leaseHolderIsAlive(marker)) return false;
  const currentFacts = await lstat4(leasePath);
  if (currentFacts.dev !== facts.dev || currentFacts.ino !== facts.ino) return false;
  await unlink(leasePath);
  return true;
}
async function acquireProjectLease(inspection) {
  const projectDirectory = inspection.projectDirectory;
  const leasePath = join4(projectDirectory, ".narracut", "workspace.lease");
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
    token: randomUUID4()
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
    await rm3(leasePath, { force: true });
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
    leaseDirectoryHandle = await openFile(dirname3(leasePath), "r");
  } catch (cause) {
    await rm3(leasePath, { force: true });
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `\u65E0\u6CD5\u951A\u5B9A\u9879\u76EE\u79DF\u7EA6\u76EE\u5F55\uFF1A${projectDirectory}\u3002`,
      { cause }
    );
  }
  activeLeasePaths.add(leasePath);
  let released = false;
  const assertCurrent = async () => {
    if (released) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        projectDirectory,
        "\u9879\u76EE\u5DE5\u4F5C\u533A\u79DF\u7EA6\u5DF2\u7ECF\u91CA\u653E\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u3002"
      );
    }
    try {
      const current = JSON.parse(await readFile3(leasePath, "utf8"));
      if (current.token !== marker.token || current.projectId !== marker.projectId) throw new Error("\u79DF\u7EA6\u8EAB\u4EFD\u4E0D\u5339\u914D");
    } catch (cause) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        projectDirectory,
        "\u9879\u76EE\u5199\u5165\u79DF\u7EA6\u5DF2\u7ECF\u5931\u6548\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u5E76\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002",
        { cause }
      );
    }
  };
  const release = async () => {
    if (released) return;
    released = true;
    activeLeasePaths.delete(leasePath);
    const anchoredLeasePath = process.platform === "win32" ? leasePath : `/dev/fd/${leaseDirectoryHandle.fd}/workspace.lease`;
    try {
      const current = JSON.parse(await readFile3(anchoredLeasePath, "utf8"));
      if (current.token === marker.token) await unlink(anchoredLeasePath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    } finally {
      await leaseDirectoryHandle.close();
    }
  };
  return { assertCurrent, release };
}
function revisionOf(bytes) {
  return `sha256:${createHash4("sha256").update(bytes).digest("hex")}`;
}
async function currentProjectRevision(projectFile, message) {
  try {
    return await readProjectVNextRevision(projectFile);
  } catch (cause) {
    throw new ProjectLifecycleError(
      "PROJECT_SAVE_CONFLICT",
      projectFile,
      message,
      { cause }
    );
  }
}
function assertWorkbenchMutation(current, next, projectPath) {
  if (JSON.stringify(current.assets) !== JSON.stringify(next.assets)) {
    throw new ProjectLifecycleError(
      "PROJECT_SAVE_FAILED",
      projectPath,
      "\u672C\u6B21\u4FDD\u5B58\u53EA\u80FD\u4FEE\u6539 Scene\uFF1BAsset \u767B\u8BB0\u8868\u5FC5\u987B\u4FDD\u6301\u4E0D\u53D8\u3002"
    );
  }
  const currentScenes = new Map(current.scenes.map((scene) => [scene.id, scene]));
  for (const scene of next.scenes) {
    const previous = currentScenes.get(scene.id);
    if (previous === void 0) {
      if (scene.speech !== void 0) {
        throw new ProjectLifecycleError(
          "PROJECT_SAVE_FAILED",
          projectPath,
          "\u65B0\u589E\u6216\u590D\u5236\u7684 Scene \u4E0D\u80FD\u521B\u5EFA Speech\uFF1B\u8BF7\u4ECE\u8868\u683C\u5DE5\u4F5C\u533A\u91CD\u8BD5\u3002"
        );
      }
      continue;
    }
    if (scene.narration.text !== previous.narration.text && scene.speech !== void 0) {
      throw new ProjectLifecycleError(
        "PROJECT_SAVE_FAILED",
        projectPath,
        `Scene ${scene.id} \u4FEE\u6539 Narration \u540E\u5FC5\u987B\u79FB\u9664\u5931\u6548 Speech\u3002`
      );
    }
    if (scene.speech !== void 0 && JSON.stringify(scene.speech) !== JSON.stringify(previous.speech)) {
      throw new ProjectLifecycleError(
        "PROJECT_SAVE_FAILED",
        projectPath,
        `Scene ${scene.id} \u7684 Speech \u4E0D\u5C5E\u4E8E\u672C\u7968\u53EF\u5199\u8303\u56F4\u3002`
      );
    }
  }
}
function assetSourceRejection(inspection, code, message) {
  return { status: "rejected", code, message, asset: null, inspection };
}
var MAX_ASSET_FILENAME_BYTES = 255;
function truncateUtf8(value, maxBytes) {
  let result = value;
  while (Buffer.byteLength(result, "utf8") > maxBytes) result = [...result].slice(0, -1).join("");
  return result;
}
function safeAssetFilename(sourcePath) {
  const original = basename(sourcePath).replace(/[\u0000-\u001f\u007f]/gu, "_");
  const fallback = original === "" || original === "." || original === ".." ? "asset" : original;
  if (Buffer.byteLength(fallback, "utf8") <= MAX_ASSET_FILENAME_BYTES) return fallback;
  const extensionIndex = fallback.lastIndexOf(".");
  const extension = extensionIndex > 0 && Buffer.byteLength(fallback.slice(extensionIndex), "utf8") <= 64 ? fallback.slice(extensionIndex) : "";
  const stem = truncateUtf8(
    extension === "" ? fallback : fallback.slice(0, extensionIndex),
    MAX_ASSET_FILENAME_BYTES - Buffer.byteLength(extension, "utf8")
  );
  return `${stem || "asset"}${extension}`;
}
function suffixedAssetFilename(filename, suffix) {
  const extensionIndex = filename.lastIndexOf(".");
  const stem = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : "";
  const marker = suffix === 1 ? "" : `-${suffix}`;
  const stemBudget = MAX_ASSET_FILENAME_BYTES - Buffer.byteLength(marker, "utf8") - Buffer.byteLength(extension, "utf8");
  return `${truncateUtf8(stem, Math.max(1, stemBudget)) || "asset"}${marker}${extension}`;
}
async function uniqueAssetPath(assetsDirectory, sourcePath) {
  const filename = safeAssetFilename(sourcePath);
  for (let suffix = 1; suffix <= 1e4; suffix += 1) {
    const candidate = suffixedAssetFilename(filename, suffix);
    const relativePath = `assets/${candidate}`;
    try {
      await access(join4(assetsDirectory, candidate));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return relativePath;
      throw error;
    }
  }
  return `assets/${randomUUID4()}`;
}
async function isProjectControlFile(projectDirectory, sourcePath, sourceFacts) {
  for (const name of ["narracut.json", "project.json", "video.md"]) {
    const controlPath = join4(projectDirectory, name);
    if (resolve2(sourcePath) === controlPath) return true;
    const controlFacts = await lstat4(controlPath);
    if (sourceFacts.dev === controlFacts.dev && sourceFacts.ino === controlFacts.ino) return true;
  }
  return false;
}
async function copyStableFile(source, opened, temporaryPath, assertDestinationCurrent) {
  let destination = null;
  try {
    await assertDestinationCurrent();
    destination = await openFile(temporaryPath, "wx", 384);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(buffer, written, bytesRead - written, position + written);
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await destination.sync();
    const after = await source.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || position !== opened.size) {
      throw new Error("\u5BFC\u5165\u6E90\u5728\u590D\u5236\u671F\u95F4\u53D1\u751F\u53D8\u5316\u3002");
    }
  } finally {
    await destination?.close().catch(() => void 0);
  }
}
async function replaceProjectFile(projectFile, bytes, assertWritable) {
  const temporaryFile = join4(dirname3(projectFile), `.${basename(projectFile)}.${randomUUID4()}.tmp`);
  let committed = false;
  try {
    const handle = await openFile(temporaryFile, "wx", 384);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertWritable();
    await rename3(temporaryFile, projectFile);
    committed = true;
    try {
      const directory2 = await openFile(dirname3(projectFile), "r");
      try {
        await directory2.sync();
      } finally {
        await directory2.close();
      }
    } catch {
    }
  } finally {
    if (!committed) await rm3(temporaryFile, { force: true }).catch(() => void 0);
  }
}
async function openProjectVNext(inputPath, options = {}) {
  const projectDirectory = await realpath2(resolve2(inputPath)).catch(() => resolve2(inputPath));
  try {
    const initialInspection = await inspectProjectVNext(projectDirectory, options);
    await validateCurrentProjectState(initialInspection);
    const directoryIdentity = await captureDirectoryIdentity(projectDirectory);
    const lease = await acquireProjectLease(initialInspection);
    let assetsDirectoryHandle = null;
    let speechDirectoryHandle = null;
    try {
      const inspection = await inspectProjectVNext(projectDirectory, options);
      const acceptedBriefRevision = await validateCurrentProjectState(inspection);
      inspection.currentRenderProgram = {
        briefRevision: acceptedBriefRevision,
        briefReviewPending: acceptedBriefRevision !== inspection.videoBriefRevision,
        previewPreserved: true
      };
      if (inspection.manifest.projectId !== initialInspection.manifest.projectId) {
        throw new ProjectLifecycleError(
          "PROJECT_IDENTITY_LOST",
          projectDirectory,
          `\u53D6\u5F97\u79DF\u7EA6\u65F6\u9879\u76EE\u8EAB\u4EFD\u53D1\u751F\u53D8\u5316\uFF1A${projectDirectory}\u3002`
        );
      }
      const assetsDirectory = join4(projectDirectory, "assets");
      const assetsDirectoryIdentity = await captureDirectoryIdentity(assetsDirectory);
      assetsDirectoryHandle = await openFile(assetsDirectory, "r");
      const openedAssetsDirectory = await assetsDirectoryHandle.stat();
      if (!openedAssetsDirectory.isDirectory() || !hasIdentity(openedAssetsDirectory, assetsDirectoryIdentity)) {
        throw new ProjectLifecycleError(
          "PROJECT_IDENTITY_LOST",
          assetsDirectory,
          "Asset \u76EE\u5F55\u8EAB\u4EFD\u5728\u6253\u5F00\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u3002"
        );
      }
      const anchoredAssetsDirectory = process.platform === "win32" ? assetsDirectory : `/dev/fd/${assetsDirectoryHandle.fd}`;
      const speechDirectory = join4(projectDirectory, "speech");
      const speechDirectoryIdentity = await captureDirectoryIdentity(speechDirectory);
      speechDirectoryHandle = await openFile(speechDirectory, "r");
      const openedSpeechDirectory = await speechDirectoryHandle.stat();
      if (!openedSpeechDirectory.isDirectory() || !hasIdentity(openedSpeechDirectory, speechDirectoryIdentity)) {
        throw new ProjectLifecycleError(
          "PROJECT_IDENTITY_LOST",
          speechDirectory,
          "Speech \u76EE\u5F55\u8EAB\u4EFD\u5728\u6253\u5F00\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u3002"
        );
      }
      const anchoredSpeechDirectory = process.platform === "win32" ? speechDirectory : `/dev/fd/${speechDirectoryHandle.fd}`;
      let currentInspection = inspection;
      let saveQueue = Promise.resolve();
      let closing = false;
      let releasePromise = null;
      const assertWritable = async () => {
        await lease.assertCurrent();
        let facts;
        try {
          facts = await lstat4(projectDirectory);
        } catch (cause) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u76EE\u5F55\u5DF2\u7ECF\u79FB\u52A8\u6216\u4E0D\u53EF\u7528\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u5E76\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002",
            { cause }
          );
        }
        if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, directoryIdentity)) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u76EE\u5F55\u8EAB\u4EFD\u5DF2\u7ECF\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u5E76\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002"
          );
        }
        try {
          const manifestPath = join4(projectDirectory, "narracut.json");
          const manifestFacts = await lstat4(manifestPath);
          if (!manifestFacts.isFile() || manifestFacts.isSymbolicLink() || manifestFacts.nlink !== 1 || manifestFacts.size > 4096) {
            throw new Error("\u9879\u76EE\u6E05\u5355\u6587\u4EF6\u8EAB\u4EFD\u65E0\u6548");
          }
          const manifest = JSON.parse(await readFile3(manifestPath, "utf8"));
          if (manifest.projectId !== initialInspection.manifest.projectId) {
            throw new Error("\u9879\u76EE\u6E05\u5355\u4E2D\u7684 projectId \u5DF2\u53D8\u5316");
          }
        } catch (cause) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u6E05\u5355\u8EAB\u4EFD\u5DF2\u7ECF\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u5199\u5165\u5E76\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002",
            { cause }
          );
        }
      };
      const candidateManager = await createCandidateManager(projectDirectory, assertWritable);
      const candidate = (request) => {
        if (closing) return Promise.reject(new ProjectLifecycleError("PROJECT_IDENTITY_LOST", projectDirectory, "\u9879\u76EE\u6B63\u5728\u5173\u95ED\u3002"));
        const operation = saveQueue.then(() => candidateManager(request));
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      await candidate({ action: "read" });
      const assertAssetsDirectoryCurrent = async () => {
        await assertWritable();
        let facts;
        try {
          facts = await lstat4(assetsDirectory);
        } catch (cause) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            assetsDirectory,
            "Asset \u76EE\u5F55\u5DF2\u79FB\u52A8\u6216\u4E0D\u53EF\u7528\uFF1BNarracut \u5DF2\u505C\u6B62\u5BFC\u5165\u3002",
            { cause }
          );
        }
        if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, assetsDirectoryIdentity)) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            assetsDirectory,
            "Asset \u76EE\u5F55\u8EAB\u4EFD\u5DF2\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u5BFC\u5165\u3002"
          );
        }
      };
      const assertSpeechDirectoryCurrent = async () => {
        await assertWritable();
        let facts;
        try {
          facts = await lstat4(speechDirectory);
        } catch (cause) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            speechDirectory,
            "Speech \u76EE\u5F55\u5DF2\u79FB\u52A8\u6216\u4E0D\u53EF\u7528\uFF1BNarracut \u5DF2\u505C\u6B62\u751F\u6210\u3002",
            { cause }
          );
        }
        if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, speechDirectoryIdentity)) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            speechDirectory,
            "Speech \u76EE\u5F55\u8EAB\u4EFD\u5DF2\u53D8\u5316\uFF1BNarracut \u5DF2\u505C\u6B62\u751F\u6210\u3002"
          );
        }
      };
      const saveProject = (project, baselineRevision) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u5DE5\u4F5C\u533A\u6B63\u5728\u5173\u95ED\uFF1BNarracut \u5DF2\u505C\u6B62\u63A5\u6536\u65B0\u7684\u5199\u5165\u3002"
          ));
        }
        const operation = saveQueue.then(async () => {
          const projectFile = join4(projectDirectory, "project.json");
          try {
            await assertWritable();
            if (await currentProjectRevision(
              projectFile,
              "\u65E0\u6CD5\u786E\u8BA4 project.json \u4ECD\u662F\u5F53\u524D\u78C1\u76D8\u57FA\u7EBF\uFF1BNarracut \u5DF2\u505C\u6B62\u81EA\u52A8\u4FDD\u5B58\u3002"
            ) !== baselineRevision) {
              throw new ProjectLifecycleError(
                "PROJECT_SAVE_CONFLICT",
                projectFile,
                "project.json \u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF1BNarracut \u5DF2\u505C\u6B62\u81EA\u52A8\u4FDD\u5B58\uFF0C\u4E0D\u4F1A\u8986\u76D6\u78C1\u76D8\u5185\u5BB9\u3002"
              );
            }
            const validated = validateProjectVNextForSave(project, projectFile);
            assertWorkbenchMutation(currentInspection.project, validated.project, projectFile);
            const { assetStates, speechStates, timeline, warnings } = await validateProjectVNextResources(
              projectDirectory,
              validated.project,
              {
                ...currentInspection.tts.status === "configured" ? { currentTtsProfileId: currentInspection.tts.profileId } : {},
                probeSpeechDurationMs: options.probeSpeechDurationMs
              }
            );
            const nextRevision = revisionOf(validated.bytes);
            if (nextRevision !== baselineRevision) {
              await replaceProjectFile(projectFile, validated.bytes, async () => {
                await assertWritable();
                if (await currentProjectRevision(
                  projectFile,
                  "project.json \u5728\u63D0\u4EA4\u524D\u53D8\u5F97\u4E0D\u53EF\u5B89\u5168\u8BFB\u53D6\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                ) !== baselineRevision) {
                  throw new ProjectLifecycleError(
                    "PROJECT_SAVE_CONFLICT",
                    projectFile,
                    "project.json \u5728\u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                  );
                }
              });
            }
            currentInspection = {
              ...currentInspection,
              project: validated.project,
              projectRevision: nextRevision,
              assetStates,
              speechStates,
              timeline,
              warnings
            };
            return { inspection: currentInspection };
          } catch (cause) {
            if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) {
              throw cause;
            }
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_FAILED",
              projectFile,
              "\u65E0\u6CD5\u539F\u5B50\u4FDD\u5B58 project.json\uFF1BNarracut \u5DF2\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002",
              { cause }
            );
          }
        });
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      const saveVideoBrief = (content, baselineRevision) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u5DE5\u4F5C\u533A\u6B63\u5728\u5173\u95ED\uFF1BNarracut \u5DF2\u505C\u6B62\u63A5\u6536\u65B0\u7684\u5199\u5165\u3002"
          ));
        }
        const operation = saveQueue.then(async () => {
          const videoBriefPath = join4(projectDirectory, "video.md");
          try {
            await assertWritable();
            const bytes = Buffer.from(content, "utf8");
            if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== content) {
              throw new ProjectLifecycleError(
                "PROJECT_SAVE_FAILED",
                videoBriefPath,
                "Video Brief \u5305\u542B\u4E0D\u80FD\u8868\u793A\u4E3A\u4E25\u683C UTF-8 \u7684\u5B57\u7B26\uFF1BNarracut \u5DF2\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002"
              );
            }
            if (bytes.length > 2 * 1024 * 1024) {
              throw new ProjectLifecycleError(
                "PROJECT_SAVE_FAILED",
                videoBriefPath,
                `Video Brief \u4E3A ${bytes.length} \u5B57\u8282\uFF0C\u8D85\u8FC7 2 MiB \u4E0A\u9650\uFF1BNarracut \u5DF2\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002`
              );
            }
            const disk = await readVideoBriefVNext(videoBriefPath);
            if (disk.revision !== baselineRevision) return { status: "conflict", disk };
            const nextRevision = revisionOf(bytes);
            if (nextRevision !== baselineRevision) {
              await replaceProjectFile(videoBriefPath, bytes, async () => {
                await assertWritable();
                const current = await readVideoBriefVNext(videoBriefPath);
                if (current.revision !== baselineRevision) {
                  throw new ProjectLifecycleError(
                    "PROJECT_SAVE_CONFLICT",
                    videoBriefPath,
                    "video.md \u5728\u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                  );
                }
              });
            }
            currentInspection = {
              ...currentInspection,
              videoBrief: content,
              videoBriefRevision: nextRevision,
              currentRenderProgram: currentInspection.currentRenderProgram === void 0 ? void 0 : {
                ...currentInspection.currentRenderProgram,
                briefReviewPending: currentInspection.currentRenderProgram.briefRevision !== nextRevision
              }
            };
            return { status: "saved", inspection: currentInspection };
          } catch (cause) {
            if (cause instanceof ProjectLifecycleError && cause.code === "PROJECT_SAVE_CONFLICT") {
              try {
                return { status: "conflict", disk: await readVideoBriefVNext(videoBriefPath) };
              } catch {
                throw cause;
              }
            }
            if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) throw cause;
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_FAILED",
              videoBriefPath,
              "\u65E0\u6CD5\u539F\u5B50\u4FDD\u5B58 video.md\uFF1BNarracut \u5DF2\u4FDD\u7559\u5185\u5B58\u4FEE\u6539\u3002",
              { cause }
            );
          }
        });
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      const exportVideoBriefLocal = async (content, targetDirectory) => {
        await assertWritable();
        const bytes = Buffer.from(content, "utf8");
        if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== content || bytes.length > 2 * 1024 * 1024) {
          throw new ProjectLifecycleError(
            "PROJECT_SAVE_FAILED",
            projectDirectory,
            "Video Brief LOCAL \u5FC5\u987B\u662F\u6700\u591A 2 MiB \u7684\u4E25\u683C UTF-8\uFF1BNarracut \u62D2\u7EDD\u5BFC\u51FA\u3002"
          );
        }
        const destinationDirectory = await realpath2(resolve2(targetDirectory)).catch((cause) => {
          throw new ProjectLifecycleError(
            "PROJECT_SAVE_FAILED",
            resolve2(targetDirectory),
            "\u65E0\u6CD5\u8BBF\u95EE Video Brief LOCAL \u5BFC\u51FA\u76EE\u5F55\u3002",
            { cause }
          );
        });
        const relation = relative2(projectDirectory, destinationDirectory);
        if (relation === "" || !relation.startsWith(`..${sep2}`) && relation !== ".." && !isAbsolute2(relation)) {
          throw new ProjectLifecycleError(
            "PROJECT_SAVE_FAILED",
            destinationDirectory,
            "Video Brief LOCAL \u53EA\u80FD\u5BFC\u51FA\u5230\u9879\u76EE\u76EE\u5F55\u4E4B\u5916\u3002"
          );
        }
        const facts = await lstat4(destinationDirectory);
        if (!facts.isDirectory() || facts.isSymbolicLink()) {
          throw new ProjectLifecycleError(
            "PROJECT_SAVE_FAILED",
            destinationDirectory,
            "Video Brief LOCAL \u5BFC\u51FA\u76EE\u6807\u5FC5\u987B\u662F\u666E\u901A\u76EE\u5F55\u3002"
          );
        }
        for (let suffix = 1; suffix <= 1e4; suffix += 1) {
          const filename = suffix === 1 ? "video-brief-local.md" : `video-brief-local-${suffix}.md`;
          const path = join4(destinationDirectory, filename);
          let handle = null;
          try {
            handle = await openFile(path, "wx", 384);
            await handle.writeFile(bytes);
            await handle.sync();
            return { path, bytes: bytes.length, revision: revisionOf(bytes) };
          } catch (cause) {
            if (cause instanceof Error && "code" in cause && cause.code === "EEXIST") continue;
            if (handle !== null) {
              const openedFacts = await handle.stat().catch(() => null);
              const currentFacts = await lstat4(path).catch(() => null);
              if (openedFacts !== null && currentFacts !== null && openedFacts.dev === currentFacts.dev && openedFacts.ino === currentFacts.ino) await unlink(path).catch(() => void 0);
            }
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_FAILED",
              path,
              "\u65E0\u6CD5\u5BFC\u51FA Video Brief LOCAL\uFF1BNarracut \u6CA1\u6709\u8986\u76D6\u5DF2\u6709\u6587\u4EF6\u3002",
              { cause }
            );
          } finally {
            await handle?.close().catch(() => void 0);
          }
        }
        throw new ProjectLifecycleError(
          "PROJECT_SAVE_FAILED",
          destinationDirectory,
          "\u5BFC\u51FA\u76EE\u5F55\u4E2D\u5DF2\u6709\u8FC7\u591A\u540C\u540D Video Brief LOCAL \u6587\u4EF6\uFF1BNarracut \u6CA1\u6709\u8986\u76D6\u5B83\u4EEC\u3002"
        );
      };
      const importAsset = (input) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u5DE5\u4F5C\u533A\u6B63\u5728\u5173\u95ED\uFF1BNarracut \u5DF2\u505C\u6B62\u63A5\u6536\u65B0\u7684\u5199\u5165\u3002"
          ));
        }
        const operation = saveQueue.then(async () => {
          const projectFile = join4(projectDirectory, "project.json");
          const sourcePath = resolve2(input.sourcePath);
          await assertWritable();
          if (await currentProjectRevision(
            projectFile,
            "\u65E0\u6CD5\u786E\u8BA4 project.json \u4ECD\u662F\u5F53\u524D\u78C1\u76D8\u57FA\u7EBF\uFF1BNarracut \u5DF2\u505C\u6B62\u5BFC\u5165\u3002"
          ) !== input.baselineRevision) {
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_CONFLICT",
              projectFile,
              "project.json \u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF1BNarracut \u5DF2\u505C\u6B62\u5BFC\u5165\uFF0C\u4E0D\u4F1A\u8986\u76D6\u78C1\u76D8\u5185\u5BB9\u3002"
            );
          }
          let pathFacts;
          try {
            pathFacts = await lstat4(sourcePath);
          } catch (cause) {
            return {
              status: "failed",
              code: "ASSET_SOURCE_UNAVAILABLE",
              message: "\u65E0\u6CD5\u8BFB\u53D6\u5BFC\u5165\u6E90\uFF1B\u8BF7\u68C0\u67E5\u6587\u4EF6\u662F\u5426\u4ECD\u5B58\u5728\u4E14\u53EF\u8BBF\u95EE\u3002",
              asset: null,
              inspection: currentInspection
            };
          }
          if (pathFacts.isSymbolicLink()) {
            return assetSourceRejection(
              currentInspection,
              "ASSET_SOURCE_SYMBOLIC_LINK",
              "\u5BFC\u5165\u6E90\u662F\u7B26\u53F7\u94FE\u63A5\uFF1B\u8BF7\u9009\u62E9\u94FE\u63A5\u6307\u5411\u7684\u666E\u901A\u6587\u4EF6\u3002"
            );
          }
          if (!pathFacts.isFile()) {
            return assetSourceRejection(
              currentInspection,
              "ASSET_SOURCE_NOT_FILE",
              pathFacts.isDirectory() ? "\u5BFC\u5165\u6E90\u662F\u76EE\u5F55\uFF1B\u8BF7\u9009\u62E9\u4E00\u4E2A\u6216\u591A\u4E2A\u666E\u901A\u6587\u4EF6\u3002" : "\u5BFC\u5165\u6E90\u4E0D\u662F\u666E\u901A\u6587\u4EF6\uFF1B\u8BF7\u9009\u62E9\u53EF\u590D\u5236\u7684\u666E\u901A\u6587\u4EF6\u3002"
            );
          }
          let source;
          try {
            source = await openFile(sourcePath, fsConstants2.O_RDONLY | (fsConstants2.O_NOFOLLOW ?? 0));
          } catch (cause) {
            return {
              status: "failed",
              code: "ASSET_SOURCE_UNAVAILABLE",
              message: "\u65E0\u6CD5\u5B89\u5168\u6253\u5F00\u5BFC\u5165\u6E90\uFF1B\u8BF7\u91CD\u65B0\u9009\u62E9\u6587\u4EF6\u3002",
              asset: null,
              inspection: currentInspection
            };
          }
          try {
            const sourceFacts = await source.stat();
            if (!sourceFacts.isFile() || !hasIdentity(sourceFacts, pathFacts)) {
              return assetSourceRejection(
                currentInspection,
                "ASSET_SOURCE_CHANGED",
                "\u5BFC\u5165\u6E90\u5728\u6253\u5F00\u65F6\u53D1\u751F\u53D8\u5316\uFF1B\u8BF7\u91CD\u65B0\u9009\u62E9\u6587\u4EF6\u3002"
              );
            }
            if (await isProjectControlFile(projectDirectory, sourcePath, sourceFacts)) {
              return assetSourceRejection(
                currentInspection,
                "ASSET_SOURCE_PROJECT_CONTROL_FILE",
                "\u9879\u76EE\u63A7\u5236\u6587\u4EF6\u4E0D\u80FD\u767B\u8BB0\u4E3A Asset\u3002"
              );
            }
            if (currentInspection.project.assets.length >= 1e3) {
              return assetSourceRejection(
                currentInspection,
                "PROJECT_ASSET_LIMIT_REACHED",
                "\u9879\u76EE\u5DF2\u8FBE\u5230 1,000 \u4E2A Asset \u4E0A\u9650\u3002"
              );
            }
            await assertAssetsDirectoryCurrent();
            const asset = {
              id: randomUUID4(),
              path: await uniqueAssetPath(anchoredAssetsDirectory, sourcePath)
            };
            const temporaryPath = join4(anchoredAssetsDirectory, `.import-${randomUUID4()}.tmp`);
            let finalPath = join4(anchoredAssetsDirectory, basename(asset.path));
            let published = false;
            try {
              await copyStableFile(source, sourceFacts, temporaryPath, assertAssetsDirectoryCurrent);
              for (let attempt = 0; attempt < 1e4; attempt += 1) {
                try {
                  await assertAssetsDirectoryCurrent();
                  await link(temporaryPath, finalPath);
                  published = true;
                  break;
                } catch (cause) {
                  if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST")) throw cause;
                  asset.path = await uniqueAssetPath(anchoredAssetsDirectory, sourcePath);
                  finalPath = join4(anchoredAssetsDirectory, basename(asset.path));
                }
              }
              if (!published) throw new Error("\u65E0\u6CD5\u4E3A Asset \u5206\u914D\u552F\u4E00\u9879\u76EE\u8DEF\u5F84\u3002");
              await assertAssetsDirectoryCurrent();
              await unlink(temporaryPath);
              const project = structuredClone(currentInspection.project);
              project.assets.push(asset);
              const targetScene = input.targetSceneId === void 0 ? void 0 : project.scenes.find((scene) => scene.id === input.targetSceneId);
              const bound = targetScene !== void 0 && targetScene.assetIds.length < 256;
              if (bound) targetScene.assetIds.push(asset.id);
              const validated = validateProjectVNextForSave(project, projectFile);
              const { assetStates, speechStates, timeline, warnings } = await validateProjectVNextResources(
                projectDirectory,
                validated.project,
                {
                  ...currentInspection.tts.status === "configured" ? { currentTtsProfileId: currentInspection.tts.profileId } : {},
                  probeSpeechDurationMs: options.probeSpeechDurationMs
                }
              );
              const nextRevision = revisionOf(validated.bytes);
              await replaceProjectFile(projectFile, validated.bytes, async () => {
                await assertAssetsDirectoryCurrent();
                if (await currentProjectRevision(
                  projectFile,
                  "project.json \u5728\u63D0\u4EA4\u524D\u53D8\u5F97\u4E0D\u53EF\u5B89\u5168\u8BFB\u53D6\uFF1BNarracut \u62D2\u7EDD\u5B8C\u6210\u5BFC\u5165\u3002"
                ) !== input.baselineRevision) {
                  throw new ProjectLifecycleError(
                    "PROJECT_SAVE_CONFLICT",
                    projectFile,
                    "project.json \u5728\u5BFC\u5165\u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                  );
                }
              });
              currentInspection = {
                ...currentInspection,
                project: validated.project,
                projectRevision: nextRevision,
                assetStates,
                speechStates,
                timeline,
                warnings
              };
              return {
                status: bound ? "imported-and-bound" : "imported-unbound",
                code: bound ? "ASSET_IMPORTED_AND_BOUND" : "ASSET_IMPORTED_UNBOUND",
                message: bound ? "Asset \u5DF2\u5BFC\u5165\u5E76\u7ED1\u5B9A\u5230\u539F\u76EE\u6807 Scene\u3002" : targetScene === void 0 && input.targetSceneId !== void 0 ? "Asset \u5DF2\u5BFC\u5165\uFF1B\u539F\u76EE\u6807 Scene \u5DF2\u4E0D\u5B58\u5728\uFF0C\u56E0\u6B64\u4FDD\u6301\u6682\u672A\u7ED1\u5B9A\u3002" : targetScene !== void 0 ? "Asset \u5DF2\u5BFC\u5165\uFF1B\u539F\u76EE\u6807 Scene \u5DF2\u8FBE\u5230 256 \u4E2A\u5F15\u7528\u4E0A\u9650\uFF0C\u56E0\u6B64\u4FDD\u6301\u6682\u672A\u7ED1\u5B9A\u3002" : "Asset \u5DF2\u5BFC\u5165\u5E76\u767B\u8BB0\u4E3A\u6682\u672A\u7ED1\u5B9A\u3002",
                asset,
                inspection: currentInspection
              };
            } catch (cause) {
              if (published) await unlink(finalPath).catch(() => void 0);
              await unlink(temporaryPath).catch(() => void 0);
              if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) throw cause;
              return {
                status: "failed",
                code: "ASSET_IMPORT_FAILED",
                message: cause instanceof Error ? cause.message : "\u65E0\u6CD5\u590D\u5236\u5E76\u767B\u8BB0 Asset\u3002",
                asset: null,
                inspection: currentInspection
              };
            }
          } finally {
            await source.close().catch(() => void 0);
          }
        });
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      const saveTtsSettings = (input) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u5DE5\u4F5C\u533A\u6B63\u5728\u5173\u95ED\uFF1BNarracut \u5DF2\u505C\u6B62\u63A5\u6536 TTS \u914D\u7F6E\u5199\u5165\u3002"
          ));
        }
        const operation = saveQueue.then(async () => {
          const projectFile = join4(projectDirectory, "project.json");
          await assertWritable();
          if (await currentProjectRevision(
            projectFile,
            "\u65E0\u6CD5\u786E\u8BA4 project.json \u4ECD\u662F\u5F53\u524D\u78C1\u76D8\u57FA\u7EBF\uFF1BNarracut \u5DF2\u505C\u6B62\u4FDD\u5B58 TTS \u914D\u7F6E\u3002"
          ) !== input.baselineRevision) {
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_CONFLICT",
              projectFile,
              "project.json \u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF1BNarracut \u5DF2\u505C\u6B62\u4FDD\u5B58 TTS \u914D\u7F6E\u3002"
            );
          }
          const config = validateProjectTtsConfig(input.config);
          const nextProfileId = ttsProfileId(config);
          const previousProjectBytes = await readFile3(projectFile);
          if (revisionOf(previousProjectBytes) !== currentInspection.projectRevision) {
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_CONFLICT",
              projectFile,
              "project.json \u5728\u5EFA\u7ACB TTS \u914D\u7F6E\u56DE\u6EDA\u951A\u70B9\u65F6\u53D1\u751F\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
            );
          }
          const project = structuredClone(currentInspection.project);
          let affectedSpeechCount = 0;
          for (const scene of project.scenes) {
            if (scene.speech !== void 0 && scene.speech.ttsProfileId !== nextProfileId) {
              affectedSpeechCount += 1;
              delete scene.speech;
            }
          }
          if (affectedSpeechCount !== input.expectedAffectedSpeechCount) {
            throw new ProjectTtsConfirmationError(affectedSpeechCount);
          }
          const validated = validateProjectVNextForSave(project, projectFile);
          const previousProjectRevision = currentInspection.projectRevision;
          const nextRevision = revisionOf(validated.bytes);
          const resourceValidation = await validateProjectVNextResources(
            projectDirectory,
            validated.project,
            {
              currentTtsProfileId: nextProfileId,
              probeSpeechDurationMs: options.probeSpeechDurationMs
            }
          );
          let projectWritten = false;
          try {
            if (nextRevision !== previousProjectRevision) {
              await replaceProjectFile(projectFile, validated.bytes, async () => {
                await assertWritable();
                if (await currentProjectRevision(
                  projectFile,
                  "project.json \u5728 TTS \u914D\u7F6E\u63D0\u4EA4\u524D\u53D8\u5F97\u4E0D\u53EF\u5B89\u5168\u8BFB\u53D6\u3002"
                ) !== previousProjectRevision) {
                  throw new ProjectLifecycleError(
                    "PROJECT_SAVE_CONFLICT",
                    projectFile,
                    "project.json \u5728 TTS \u914D\u7F6E\u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                  );
                }
              });
              projectWritten = true;
            }
            const tts = await writeProjectTtsConfig(projectDirectory, config, assertWritable);
            currentInspection = {
              ...currentInspection,
              project: validated.project,
              projectRevision: nextRevision,
              tts,
              ...resourceValidation
            };
            return { affectedSpeechCount, inspection: currentInspection };
          } catch (cause) {
            if (projectWritten) {
              try {
                await replaceProjectFile(projectFile, previousProjectBytes, async () => {
                  await assertWritable();
                  if (await currentProjectRevision(
                    projectFile,
                    "project.json \u5728 TTS \u914D\u7F6E\u56DE\u6EDA\u524D\u53D8\u5F97\u4E0D\u53EF\u5B89\u5168\u8BFB\u53D6\u3002"
                  ) !== nextRevision) {
                    throw new ProjectLifecycleError(
                      "PROJECT_SAVE_CONFLICT",
                      projectFile,
                      "TTS \u914D\u7F6E\u5931\u8D25\u540E project.json \u53C8\u53D1\u751F\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u5E76\u4FDD\u7559\u73B0\u573A\u3002"
                    );
                  }
                });
              } catch (rollbackCause) {
                throw new ProjectLifecycleError(
                  "PROJECT_SAVE_FAILED",
                  projectFile,
                  "TTS \u914D\u7F6E\u63D0\u4EA4\u5931\u8D25\uFF0C\u4E14 Scene \u5F15\u7528\u56DE\u6EDA\u5931\u8D25\uFF1B\u9879\u76EE\u4FDD\u6301\u65E0\u9648\u65E7 Speech \u7684\u5B89\u5168\u72B6\u6001\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u68C0\u67E5\u3002",
                  { cause: rollbackCause }
                );
              }
            }
            if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) throw cause;
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_FAILED",
              join4(projectDirectory, "tts.json"),
              "\u65E0\u6CD5\u539F\u5B50\u4FDD\u5B58 TTS \u914D\u7F6E\uFF1BNarracut \u5DF2\u4FDD\u7559\u539F\u914D\u7F6E\u4E0E Scene \u5185\u5BB9\u3002",
              { cause }
            );
          }
        });
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      const probeSpeechAudio = async (input) => {
        await assertSpeechDirectoryCurrent();
        const probeFile = join4(anchoredSpeechDirectory, `.probe-${input.jobId}.mp3`);
        const decoderPath = process.platform === "linux" ? join4(`/proc/${process.pid}/fd/${speechDirectoryHandle.fd}`, `.probe-${input.jobId}.mp3`) : join4(speechDirectory, `.probe-${input.jobId}.mp3`);
        let created = false;
        try {
          const handle = await openFile(probeFile, "wx", 384);
          created = true;
          try {
            await handle.writeFile(input.audio);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await assertSpeechDirectoryCurrent();
          const durationMs = await (options.probeSpeechDurationMs ?? probeSpeechDurationMs)(decoderPath);
          if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
            throw new Error("Speech \u5B9E\u9645\u65F6\u957F\u5FC5\u987B\u662F\u6B63\u5B89\u5168\u6574\u6570\u3002");
          }
          await assertSpeechDirectoryCurrent();
          return durationMs;
        } finally {
          if (created) await rm3(probeFile, { force: true }).catch(() => void 0);
        }
      };
      const commitSpeech = (input) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "\u9879\u76EE\u5DE5\u4F5C\u533A\u6B63\u5728\u5173\u95ED\uFF1BNarracut \u5DF2\u505C\u6B62\u63A5\u6536 Speech \u7ED3\u679C\u3002"
          ));
        }
        const operation = saveQueue.then(async () => {
          await assertWritable();
          const tts = await readProjectTtsConfig(projectDirectory);
          if (tts.status !== "configured" || tts.profileId !== input.ttsProfileId) {
            return {
              status: "rejected",
              code: "SPEECH_RESULT_CONFIG_CHANGED",
              message: "\u7ED3\u679C\u672A\u5E94\u7528\uFF1ATTS \u914D\u7F6E\u5DF2\u7ECF\u53D8\u5316\u3002",
              inspection: currentInspection
            };
          }
          const scene = currentInspection.project.scenes.find((candidate2) => candidate2.id === input.sceneId);
          if (scene === void 0) {
            return {
              status: "rejected",
              code: "SPEECH_RESULT_SCENE_DELETED",
              message: "\u7ED3\u679C\u672A\u5E94\u7528\uFF1A\u76EE\u6807 Scene \u5DF2\u5220\u9664\u3002",
              inspection: currentInspection
            };
          }
          if (scene.narration.text !== input.narrationText) {
            return {
              status: "rejected",
              code: "SPEECH_RESULT_NARRATION_CHANGED",
              message: "\u7ED3\u679C\u672A\u5E94\u7528\uFF1ANarration \u5DF2\u7ECF\u53D8\u5316\u3002",
              inspection: currentInspection
            };
          }
          if (input.isCancelled?.()) {
            return {
              status: "rejected",
              code: "SPEECH_RESULT_CANCELLED",
              message: "\u7ED3\u679C\u672A\u5E94\u7528\uFF1ASpeech \u751F\u6210\u5DF2\u7ECF\u53D6\u6D88\u3002",
              inspection: currentInspection
            };
          }
          const finalFile = join4(anchoredSpeechDirectory, `${scene.id}.mp3`);
          const temporaryFile = join4(anchoredSpeechDirectory, `.speech-${randomUUID4()}.tmp`);
          const backupFile = join4(anchoredSpeechDirectory, `.speech-${randomUUID4()}.previous`);
          let previousFile = false;
          let published = false;
          try {
            const handle = await openFile(temporaryFile, "wx", 384);
            try {
              await handle.writeFile(input.audio);
              await handle.sync();
            } finally {
              await handle.close();
            }
            try {
              const finalFacts = await lstat4(finalFile);
              if (!finalFacts.isFile() || finalFacts.isSymbolicLink()) {
                throw new ProjectLifecycleError(
                  "PROJECT_IDENTITY_LOST",
                  finalFile,
                  "\u65E2\u6709 Speech \u4E0D\u518D\u662F\u666E\u901A\u6587\u4EF6\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                );
              }
              await link(finalFile, backupFile);
              const backupFacts = await lstat4(backupFile);
              if (!backupFacts.isFile() || backupFacts.isSymbolicLink() || !hasIdentity(backupFacts, finalFacts)) {
                throw new ProjectLifecycleError(
                  "PROJECT_IDENTITY_LOST",
                  backupFile,
                  "\u65E2\u6709 Speech \u5728\u5EFA\u7ACB\u56DE\u6EDA\u951A\u70B9\u65F6\u53D1\u751F\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                );
              }
              previousFile = true;
            } catch (cause) {
              if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
            }
            await assertSpeechDirectoryCurrent();
            if (input.isCancelled?.()) throw new Error("Speech \u751F\u6210\u5DF2\u7ECF\u53D6\u6D88\u3002");
            await rename3(temporaryFile, finalFile);
            published = true;
            const project = structuredClone(currentInspection.project);
            const target = project.scenes.find((candidate2) => candidate2.id === scene.id);
            target.speech = {
              path: `speech/${scene.id}.mp3`,
              durationMs: input.durationMs,
              sourceTextHash: `sha256:${createHash4("sha256").update(input.narrationText, "utf8").digest("hex")}`,
              ttsProfileId: input.ttsProfileId,
              audioContentHash: `sha256:${createHash4("sha256").update(input.audio).digest("hex")}`
            };
            const projectFile = join4(projectDirectory, "project.json");
            const baselineRevision = currentInspection.projectRevision;
            const validated = validateProjectVNextForSave(project, projectFile);
            const { assetStates, speechStates, timeline, warnings } = await validateProjectVNextResources(
              projectDirectory,
              validated.project,
              {
                currentTtsProfileId: tts.profileId,
                probeSpeechDurationMs: options.probeSpeechDurationMs
              }
            );
            if (speechStates.find((state) => state.sceneId === scene.id)?.status !== "available") {
              throw new Error("\u53D1\u5E03\u540E\u7684 Speech \u672A\u901A\u8FC7\u53EF\u89E3\u7801\u6027\u4E0E\u65F6\u957F\u590D\u6838\u3002");
            }
            if (input.isCancelled?.()) throw new Error("Speech \u751F\u6210\u5DF2\u7ECF\u53D6\u6D88\u3002");
            input.onCommitPoint?.();
            await replaceProjectFile(projectFile, validated.bytes, async () => {
              await assertSpeechDirectoryCurrent();
              if (await currentProjectRevision(
                projectFile,
                "project.json \u5728 Speech \u63D0\u4EA4\u524D\u53D8\u5F97\u4E0D\u53EF\u5B89\u5168\u8BFB\u53D6\u3002"
              ) !== baselineRevision) {
                throw new ProjectLifecycleError(
                  "PROJECT_SAVE_CONFLICT",
                  projectFile,
                  "project.json \u5728 Speech \u63D0\u4EA4\u524D\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u62D2\u7EDD\u8986\u76D6\u3002"
                );
              }
            });
            currentInspection = {
              ...currentInspection,
              project: validated.project,
              projectRevision: revisionOf(validated.bytes),
              tts,
              assetStates,
              speechStates,
              timeline,
              warnings
            };
            await rm3(backupFile, { force: true }).catch(() => void 0);
            return {
              status: "applied",
              code: "SPEECH_APPLIED",
              message: "Speech \u5DF2\u6821\u9A8C\u5E76\u539F\u5B50\u5E94\u7528\u5230\u5F53\u524D Scene\u3002",
              inspection: currentInspection
            };
          } catch (cause) {
            let rollbackFailure;
            if (published) {
              try {
                if (previousFile) {
                  if (process.platform === "win32") await rm3(finalFile, { force: true });
                  await rename3(backupFile, finalFile);
                } else await rm3(finalFile, { force: true });
              } catch (rollbackCause) {
                rollbackFailure = rollbackCause;
              }
            }
            await rm3(temporaryFile, { force: true }).catch(() => void 0);
            if (rollbackFailure === void 0) await rm3(backupFile, { force: true }).catch(() => void 0);
            if (rollbackFailure !== void 0) {
              throw new ProjectLifecycleError(
                "PROJECT_SAVE_FAILED",
                backupFile,
                `Speech \u56DE\u6EDA\u5931\u8D25\uFF1B\u65E7\u97F3\u9891\u5907\u4EFD\u5DF2\u4FDD\u7559\u5728 ${backupFile}\uFF0CNarracut \u4E0D\u4F1A\u58F0\u79F0\u65E7 Speech \u672A\u53D8\u3002`,
                { cause: rollbackFailure }
              );
            }
            if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) throw cause;
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_FAILED",
              finalFile,
              "\u65E0\u6CD5\u539F\u5B50\u5E94\u7528 Speech\uFF1B\u65E7 Speech \u4E0E Scene \u5185\u5BB9\u4FDD\u6301\u4E0D\u53D8\u3002",
              { cause }
            );
          }
        });
        saveQueue = operation.then(() => void 0, () => void 0);
        return operation;
      };
      const release = async () => {
        closing = true;
        releasePromise ??= saveQueue.then(async () => {
          try {
            await lease.release();
          } finally {
            await assetsDirectoryHandle?.close();
            assetsDirectoryHandle = null;
            await speechDirectoryHandle?.close();
            speechDirectoryHandle = null;
          }
        });
        await releasePromise;
      };
      return {
        candidate,
        inspection,
        saveProject,
        saveVideoBrief,
        exportVideoBriefLocal,
        importAsset,
        saveTtsSettings,
        probeSpeechAudio,
        commitSpeech,
        release
      };
    } catch (error) {
      try {
        await lease.release();
      } finally {
        await assetsDirectoryHandle?.close();
        await speechDirectoryHandle?.close();
      }
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

// src/server/project-asset-preview.ts
import { constants as fsConstants3 } from "node:fs";
import { lstat as lstat5, open as openFile2 } from "node:fs/promises";
import { basename as basename2, join as join5 } from "node:path";
var MAX_INLINE_PREVIEW_BYTES = 32 * 1024 * 1024;
function startsWith(bytes, signature) {
  return signature.every((byte, index) => bytes[index] === byte);
}
function ascii(bytes, start, end) {
  return bytes.subarray(start, end).toString("ascii");
}
function detectPreview(bytes) {
  if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
    return { kind: "image", mediaType: "image/png" };
  }
  if (startsWith(bytes, [255, 216, 255])) return { kind: "image", mediaType: "image/jpeg" };
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return { kind: "image", mediaType: "image/gif" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return { kind: "image", mediaType: "image/webp" };
  }
  if (startsWith(bytes, [26, 69, 223, 163])) return { kind: "video", mediaType: "video/webm" };
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    return /^M4A/u.test(brand) ? { kind: "audio", mediaType: "audio/mp4" } : { kind: "video", mediaType: brand === "qt  " ? "video/quicktime" : "video/mp4" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") {
    return { kind: "audio", mediaType: "audio/wav" };
  }
  if (ascii(bytes, 0, 4) === "OggS") return { kind: "audio", mediaType: "audio/ogg" };
  if (ascii(bytes, 0, 3) === "ID3" || bytes[0] === 255 && (bytes[1] ?? 0) >= 224) {
    return { kind: "audio", mediaType: "audio/mpeg" };
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return { kind: "document", mediaType: "application/pdf" };
  return { kind: "unsupported" };
}
async function readProjectAssetPreview(inspection, assetId) {
  const asset = inspection.project.assets.find((item) => item.id === assetId);
  if (asset === void 0) {
    return { status: "dangling", id: assetId, reason: "\u672A\u627E\u5230\u767B\u8BB0\u7684 Asset\u3002" };
  }
  const absolutePath = join5(inspection.projectDirectory, asset.path);
  try {
    const { assetStates: [runtime] } = await validateProjectVNextResources(
      inspection.projectDirectory,
      { assets: [asset], scenes: [] }
    );
    if (runtime?.status !== "available") {
      return {
        status: "unavailable",
        id: asset.id,
        path: asset.path,
        reason: runtime?.reason ?? "Asset \u6587\u4EF6\u4E0D\u53EF\u7528\u3002"
      };
    }
    const before = await lstat5(absolutePath);
    const handle = await openFile2(absolutePath, fsConstants3.O_RDONLY | (fsConstants3.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) {
        return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset \u6587\u4EF6\u8EAB\u4EFD\u5DF2\u53D8\u5316\u3002" };
      }
      const header = Buffer.alloc(Math.min(32, opened.size));
      if (header.length > 0) await handle.read(header, 0, header.length, 0);
      const detected = detectPreview(header);
      const common = {
        status: "available",
        id: asset.id,
        path: asset.path,
        filename: basename2(asset.path),
        size: opened.size,
        ...detected
      };
      if (detected.kind === "unsupported") {
        return { ...common, reason: "\u5F53\u524D\u683C\u5F0F\u4E0D\u652F\u6301\u5185\u5BB9\u9884\u89C8\u3002" };
      }
      if (opened.size > MAX_INLINE_PREVIEW_BYTES) {
        return { ...common, reason: "\u5F53\u524D\u5BBF\u4E3B\u65E0\u6CD5\u5B89\u5168\u52A0\u8F7D\u6B64\u5185\u5BB9\u9884\u89C8\u3002" };
      }
      const bytes = Buffer.alloc(opened.size);
      let position = 0;
      while (position < bytes.length) {
        const { bytesRead } = await handle.read(bytes, position, bytes.length - position, position);
        if (bytesRead === 0) break;
        position += bytesRead;
      }
      if (position !== opened.size) {
        return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset \u5728\u8BFB\u53D6\u671F\u95F4\u53D1\u751F\u53D8\u5316\u3002" };
      }
      const after = await handle.stat();
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
        return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset \u5728\u8BFB\u53D6\u671F\u95F4\u53D1\u751F\u53D8\u5316\u3002" };
      }
      return {
        ...common,
        dataUrl: `data:${detected.mediaType};base64,${bytes.toString("base64")}`
      };
    } finally {
      await handle.close();
    }
  } catch {
    return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset \u6587\u4EF6\u7F3A\u5931\u3001\u65E0\u6CD5\u8BFB\u53D6\u6216\u8EAB\u4EFD\u65E0\u6548\u3002" };
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
var WORKBENCH_SCRIPT_PATH = fileURLToPath(new URL(
  import.meta.url.endsWith("/server.mjs") ? "./workbench.js" : "../workbench.js",
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
    name: "manage_project_candidate",
    title: "\u7BA1\u7406\u552F\u4E00\u5019\u9009 Render Program",
    description: "\u5728\u5F53\u524D\u9879\u76EE\u79DF\u7EA6\u5185\u8BFB\u53D6\u3001\u663E\u5F0F\u521B\u5EFA\u3001\u539F\u5B50\u4FEE\u6539\u6216\u786E\u8BA4\u653E\u5F03\u552F\u4E00\u5019\u9009\u3002apply \u4F7F\u7528\u8BFB\u53D6\u6240\u5F97 baseline\uFF1Bchanges \u53EA\u4FEE\u6539 program.json\u3001src/ \u548C resources/\uFF0C\u4E0D\u6267\u884C\u4EE3\u7801\u3001\u4E0D\u4FEE\u6539\u4F9D\u8D56\u6216\u5F53\u524D\u4FEE\u8BA2\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "action"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        action: { type: "string", enum: ["read", "create", "apply", "discard"] },
        baseline: { type: "string" },
        confirmed: { type: "boolean" },
        changes: { type: "array", maxItems: 256, items: {
          type: "object",
          required: ["path", "content"],
          additionalProperties: false,
          properties: { path: { type: "string" }, content: { type: ["string", "null"] } }
        } }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: { ...taskToolAnnotations, destructiveHint: true }
  },
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
    name: "save_project_scenes",
    title: "\u4FDD\u5B58\u8868\u683C\u5DE5\u4F5C\u533A Scene",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u6309\u9879\u76EE\u8EAB\u4EFD\u4E0E\u78C1\u76D8\u57FA\u7EBF\u539F\u5B50\u4FDD\u5B58\u4E25\u683C Scene DSL\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baselineRevision", "project"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baselineRevision: { type: "string", minLength: 1 },
        project: { type: "object" }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "save_project_video_brief",
    title: "\u4FDD\u5B58 Video Brief",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u6309\u72EC\u7ACB Brief ETag \u539F\u5B50\u4FDD\u5B58\u5B8C\u6574 video.md\uFF0C\u4E0D\u8986\u76D6\u5916\u90E8\u53D8\u5316\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baselineRevision", "content"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baselineRevision: { type: "string", minLength: 1 },
        content: { type: "string" }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "export_project_video_brief_local",
    title: "\u5BFC\u51FA Video Brief LOCAL",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u628A\u51B2\u7A81\u4E2D\u7684 Brief LOCAL \u5BFC\u51FA\u5230\u9879\u76EE\u5916\u7684\u65B0\u6587\u4EF6\uFF0C\u4E0D\u8986\u76D6\u5DF2\u6709\u6587\u4EF6\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "targetDirectory", "content"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        targetDirectory: { type: "string", minLength: 1 },
        content: { type: "string" }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "import_project_asset",
    title: "\u5BFC\u5165\u4E00\u4E2A\u9879\u76EE Asset",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u9010\u5B57\u8282\u590D\u5236\u4E00\u4E2A\u7CFB\u7EDF\u6587\u4EF6\u9009\u62E9\u5668\u8FD4\u56DE\u7684\u666E\u901A\u6587\u4EF6\uFF0C\u767B\u8BB0\u540E\u53EF\u7ED1\u5B9A\u539F\u76EE\u6807 Scene\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baselineRevision", "sourcePath"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baselineRevision: { type: "string", minLength: 1 },
        sourcePath: { type: "string", minLength: 1 },
        targetSceneId: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "read_project_asset_preview",
    title: "\u8BFB\u53D6\u9879\u76EE Asset \u9884\u89C8",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u6309\u767B\u8BB0 ID \u53EA\u8BFB\u68C0\u67E5 Asset\uFF0C\u5E76\u4E3A\u53EF\u5B89\u5168\u5185\u8054\u7684\u5DF2\u77E5\u683C\u5F0F\u8FD4\u56DE\u9884\u89C8\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "assetId"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        assetId: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "save_project_tts_settings",
    title: "\u4FDD\u5B58\u9879\u76EE TTS \u914D\u7F6E",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u539F\u5B50\u4FDD\u5B58\u9879\u76EE TTS \u914D\u7F6E\uFF0C\u5E76\u5728\u786E\u8BA4\u540E\u79FB\u9664\u4E0D\u518D\u5339\u914D\u7684 Speech \u8BB0\u5F55\u3002API Key \u53EA\u4FDD\u7559\u5728\u5BBF\u4E3B\u4F1A\u8BDD\u5185\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baselineRevision", "config", "credentialAction", "expectedAffectedSpeechCount"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baselineRevision: { type: "string", minLength: 1 },
        config: { type: "object" },
        credentialAction: { type: "string", enum: ["keep", "replace", "clear"] },
        apiKey: { type: "string", minLength: 1 },
        expectedAffectedSpeechCount: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "start_scene_speech",
    title: "\u751F\u6210\u5F53\u524D Scene Speech",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u4E3A\u5F53\u524D Narration \u548C\u9879\u76EE TTS \u914D\u7F6E\u751F\u6210\u3001\u6821\u9A8C\u5E76\u539F\u5B50\u5E94\u7528 Speech\u3002",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "sceneId"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        sceneId: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "get_scene_speech_job",
    title: "\u8BFB\u53D6 Speech \u751F\u6210\u72B6\u6001",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u8BFB\u53D6\u4E00\u6B21 Scene Speech \u751F\u6210\u4EFB\u52A1\u7684\u6709\u754C\u72B6\u6001\u3002",
    inputSchema: {
      type: "object",
      required: ["jobId"],
      properties: { jobId: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "cancel_scene_speech_job",
    title: "\u53D6\u6D88 Speech \u751F\u6210",
    description: "\u4EC5\u4F9B Narracut \u5DE5\u4F5C\u53F0 app \u4F7F\u7528\uFF1A\u53D6\u6D88\u5F53\u524D Scene \u7684 Speech \u751F\u6210\uFF0C\u4E0D\u6539\u53D8\u65E2\u6709 Speech\u3002",
    inputSchema: {
      type: "object",
      required: ["jobId"],
      properties: { jobId: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: { type: "object" },
    annotations: { ...taskToolAnnotations, idempotentHint: true },
    _meta: { ui: { visibility: ["app"] } }
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
function connectedState(readOnly = true) {
  return { status: "connected", readOnly };
}
function launcherConnectionState() {
  return { status: "connected", readOnly: false };
}
function serializeInspection(inspection, writable = false, credential = { status: "missing", storage: "session" }) {
  const assets = new Map(inspection.project.assets.map((asset) => [asset.id, asset]));
  const speechStates = new Map(inspection.speechStates.map((state) => [state.sceneId, state]));
  const timeWindows = new Map(inspection.timeline.scenes.map((time) => [time.sceneId, time]));
  return {
    status: "valid",
    connection: connectedState(!writable),
    writable,
    projectRevision: inspection.projectRevision,
    videoBrief: {
      content: inspection.videoBrief,
      revision: inspection.videoBriefRevision,
      bytes: Buffer.byteLength(inspection.videoBrief, "utf8"),
      state: inspection.videoBrief.length === 0 ? "empty" : "saved"
    },
    ...inspection.currentRenderProgram === void 0 ? {} : { currentRenderProgram: inspection.currentRenderProgram },
    projectDsl: inspection.project,
    tts: {
      ...inspection.tts,
      credential,
      capabilities: TTS_CAPABILITIES
    },
    speechStates: inspection.speechStates,
    timeline: inspection.timeline,
    project: {
      directory: inspection.projectDirectory,
      folderName: basename3(inspection.projectDirectory),
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
      speech: speechStates.get(scene.id) ?? { status: "missing" },
      time: timeWindows.get(scene.id)
    })),
    warnings: inspection.warnings,
    assetStates: inspection.assetStates
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
  const [html, script, paperTexture, filmTexture, displayFont] = await Promise.all([
    readFile4(WORKBENCH_PATH, "utf8"),
    readFile4(WORKBENCH_SCRIPT_PATH, "utf8"),
    readFile4(PAPER_TEXTURE_PATH),
    readFile4(FILM_TEXTURE_PATH),
    readFile4(DISPLAY_FONT_PATH)
  ]);
  const materialVariables = `@font-face{font-family:"Narracut Display";src:url("data:font/woff2;base64,${displayFont.toString("base64")}") format("woff2");font-style:normal;font-weight:100 800;font-stretch:75% 100%;font-display:block}:root{--paper-texture:url("data:image/webp;base64,${paperTexture.toString("base64")}");--film-texture:url("data:image/webp;base64,${filmTexture.toString("base64")}")}`;
  return html.replace("/*__NARRACUT_MATERIALS__*/", materialVariables).replace("/*__NARRACUT_WORKBENCH_JS__*/", script);
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
  if (!isAbsolute3(projectDirectory)) {
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
        text: `${basename3(inspection.projectDirectory)} \u662F\u6709\u6548\u7684 Project VNext\uFF0C\u5171 ${inspection.project.scenes.length} \u4E2A Scene\u3002\u5F53\u524D\u63D2\u4EF6\u53EA\u63D0\u4F9B\u53EA\u8BFB\u68C0\u67E5\u3002`
      }]
    };
  } catch (error) {
    if (error instanceof ProjectInspectionError) {
      return {
        isError: true,
        structuredContent: {
          status: "invalid",
          connection: connectedState(),
          project: { directory: projectDirectory, folderName: basename3(projectDirectory) },
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
var SpeechToolError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "SpeechToolError";
  }
  code;
};
function publicSpeechJob(job) {
  const {
    projectId: _projectId,
    projectDirectory: _projectDirectory,
    narrationText: _narrationText,
    config: _config,
    ttsProfileId: _ttsProfileId,
    credential: _credential,
    controller: _controller,
    inspection: _inspection,
    commitPointReached: _commitPointReached,
    ...value
  } = job;
  return structuredClone(value);
}
function credentialState(value) {
  if (value === void 0) return { status: "missing", storage: "session" };
  return { status: "available", storage: "session", masked: `\u2022\u2022\u2022\u2022${value.slice(-4)}` };
}
var ProjectWorkspaceSession = class {
  #opened = null;
  #credentials = /* @__PURE__ */ new Map();
  #speechJobs = /* @__PURE__ */ new Map();
  #ttsFetch;
  #probeSpeechDurationMs;
  constructor(options = {}) {
    this.#ttsFetch = options.ttsFetch ?? globalThis.fetch;
    this.#probeSpeechDurationMs = options.probeSpeechDurationMs ?? probeSpeechDurationMs;
  }
  credential(projectId) {
    return credentialState(this.#credentials.get(projectId));
  }
  #candidateStatus = null;
  serialize(inspection, writable = true) {
    return { ...serializeInspection(inspection, writable, this.credential(inspection.manifest.projectId)), candidate: this.#candidateStatus };
  }
  async open(projectDirectory) {
    const next = await openProjectVNext(projectDirectory, {
      probeSpeechDurationMs: this.#probeSpeechDurationMs
    });
    const previous = this.#opened;
    try {
      if (previous !== null) await previous.release();
    } catch (error) {
      await next.release();
      throw error;
    }
    this.#opened = next;
    this.#candidateStatus = await next.candidate({ action: "read" });
    return next.inspection;
  }
  async candidate(input) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    this.#candidateStatus = await opened.candidate(input);
    return this.#candidateStatus;
  }
  async save(input) {
    const opened = this.#opened;
    if (opened === null || opened.inspection.projectDirectory !== input.projectDirectory || opened.inspection.manifest.projectId !== input.projectId) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        input.projectDirectory,
        "\u5F53\u524D\u5DE5\u4F5C\u53F0\u6CA1\u6709\u6301\u6709\u8BE5\u9879\u76EE\u7684\u5199\u5165\u79DF\u7EA6\uFF1BNarracut \u62D2\u7EDD\u4FDD\u5B58\u3002"
      );
    }
    const saved = await opened.saveProject(input.project, input.baselineRevision);
    opened.inspection = saved.inspection;
    return saved.inspection;
  }
  async saveVideoBrief(input) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    const saved = await opened.saveVideoBrief(input.content, input.baselineRevision);
    if (saved.status === "saved") opened.inspection = saved.inspection;
    return saved;
  }
  async exportVideoBriefLocal(input) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    return opened.exportVideoBriefLocal(input.content, input.targetDirectory);
  }
  async importAsset(input) {
    const opened = this.#opened;
    if (opened === null || opened.inspection.projectDirectory !== input.projectDirectory || opened.inspection.manifest.projectId !== input.projectId) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        input.projectDirectory,
        "\u5F53\u524D\u5DE5\u4F5C\u53F0\u6CA1\u6709\u6301\u6709\u8BE5\u9879\u76EE\u7684\u5199\u5165\u79DF\u7EA6\uFF1BNarracut \u62D2\u7EDD\u5BFC\u5165\u3002"
      );
    }
    const imported = await opened.importAsset({
      sourcePath: input.sourcePath,
      targetSceneId: input.targetSceneId,
      baselineRevision: input.baselineRevision
    });
    opened.inspection = imported.inspection;
    return imported;
  }
  async readAssetPreview(input) {
    const opened = this.#opened;
    if (opened === null || opened.inspection.projectDirectory !== input.projectDirectory || opened.inspection.manifest.projectId !== input.projectId) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        input.projectDirectory,
        "\u5F53\u524D\u5DE5\u4F5C\u53F0\u672A\u6301\u6709\u8BE5\u9879\u76EE\u8EAB\u4EFD\uFF1BNarracut \u62D2\u7EDD\u8BFB\u53D6\u9884\u89C8\u3002"
      );
    }
    return readProjectAssetPreview(opened.inspection, input.assetId);
  }
  async saveTtsSettings(input) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    if (input.credentialAction === "replace" && (input.apiKey === void 0 || input.apiKey.trim() === "")) {
      throw new SpeechToolError("TTS_CREDENTIAL_INVALID", "\u66FF\u6362 API Key \u65F6\u5FC5\u987B\u63D0\u4F9B\u975E\u7A7A\u503C\u3002");
    }
    const saved = await opened.saveTtsSettings({
      config: input.config,
      baselineRevision: input.baselineRevision,
      expectedAffectedSpeechCount: input.expectedAffectedSpeechCount
    });
    if (input.credentialAction === "replace") this.#credentials.set(input.projectId, input.apiKey);
    if (input.credentialAction === "clear") this.#credentials.delete(input.projectId);
    opened.inspection = saved.inspection;
    for (const job of this.#speechJobs.values()) {
      if (job.projectId === input.projectId && !["succeeded", "cancelled", "failed", "rejected"].includes(job.status) && saved.inspection.tts.status === "configured" && job.ttsProfileId !== saved.inspection.tts.profileId) {
        this.cancelSpeech(job.id, "TTS \u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u65E7\u914D\u7F6E\u751F\u6210\u4EFB\u52A1\u5DF2\u53D6\u6D88\u3002");
      }
    }
    return saved;
  }
  startSpeech(input) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    const tts = opened.inspection.tts;
    if (tts.status !== "configured") {
      throw new SpeechToolError("TTS_CONFIG_MISSING", "\u8BF7\u5148\u4FDD\u5B58\u9879\u76EE TTS \u914D\u7F6E\u3002");
    }
    const key = this.#credentials.get(input.projectId);
    if (key === void 0) {
      throw new SpeechToolError("TTS_CREDENTIAL_MISSING", "\u8BF7\u5148\u5F55\u5165 TokenDance API Key\uFF1B\u51ED\u636E\u53EA\u4FDD\u7559\u5728\u5F53\u524D\u5BBF\u4E3B\u4F1A\u8BDD\u3002");
    }
    const scene = opened.inspection.project.scenes.find((candidate) => candidate.id === input.sceneId);
    if (scene === void 0) throw new SpeechToolError("SPEECH_SCENE_MISSING", "\u76EE\u6807 Scene \u4E0D\u5B58\u5728\u3002");
    if (scene.narration.text.trim() === "") {
      throw new SpeechToolError("SPEECH_NARRATION_EMPTY", "\u7A7A Narration \u4E0D\u80FD\u751F\u6210 Speech\uFF1B\u8BF7\u5148\u8865\u5145\u5185\u5BB9\u3002");
    }
    if ([...this.#speechJobs.values()].some((job2) => job2.projectId === input.projectId && job2.sceneId === input.sceneId && !["succeeded", "cancelled", "failed", "rejected"].includes(job2.status))) {
      throw new SpeechToolError("SPEECH_JOB_ACTIVE", "\u5F53\u524D Scene \u5DF2\u6709 Speech \u6B63\u5728\u751F\u6210\u3002");
    }
    if (this.#speechJobs.size >= 128) {
      const terminal = [...this.#speechJobs.values()].filter((job2) => ["succeeded", "cancelled", "failed", "rejected"].includes(job2.status)).sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
      for (const job2 of terminal.slice(0, Math.max(1, this.#speechJobs.size - 127))) {
        this.#speechJobs.delete(job2.id);
      }
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const job = {
      id: randomUUID5(),
      sceneId: scene.id,
      status: "queued",
      stage: "\u6392\u961F",
      createdAt: now,
      updatedAt: now,
      projectId: input.projectId,
      projectDirectory: input.projectDirectory,
      narrationText: scene.narration.text,
      config: structuredClone(tts.config),
      ttsProfileId: tts.profileId,
      credential: key
    };
    this.#speechJobs.set(job.id, job);
    setImmediate(() => void this.#processSpeech(job));
    return publicSpeechJob(job);
  }
  getSpeech(jobId) {
    const job = this.#speechJobs.get(jobId);
    if (job === void 0) throw new SpeechToolError("SPEECH_JOB_NOT_FOUND", "Speech \u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u5931\u6548\u3002");
    const result = { job: publicSpeechJob(job), ...job.inspection === void 0 ? {} : { inspection: job.inspection } };
    return result;
  }
  cancelSpeech(jobId, message = "Speech \u751F\u6210\u5DF2\u53D6\u6D88\uFF1B\u65E2\u6709 Speech \u4FDD\u6301\u4E0D\u53D8\u3002") {
    const job = this.#speechJobs.get(jobId);
    if (job === void 0) throw new SpeechToolError("SPEECH_JOB_NOT_FOUND", "Speech \u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u5931\u6548\u3002");
    if (!["succeeded", "cancelled", "failed", "rejected"].includes(job.status) && !job.commitPointReached) {
      job.status = "cancelled";
      job.stage = "\u5DF2\u53D6\u6D88";
      job.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      job.error = { code: "SPEECH_CANCELLED", message, retryable: true };
      job.controller?.abort();
    }
    return publicSpeechJob(job);
  }
  #requireOpened(projectDirectory, projectId) {
    const opened = this.#opened;
    if (opened === null || opened.inspection.projectDirectory !== projectDirectory || opened.inspection.manifest.projectId !== projectId) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        projectDirectory,
        "\u5F53\u524D\u5DE5\u4F5C\u53F0\u672A\u6301\u6709\u8BE5\u9879\u76EE\u8EAB\u4EFD\uFF1BNarracut \u62D2\u7EDD\u64CD\u4F5C Speech\u3002"
      );
    }
    return opened;
  }
  #updateSpeech(job, status, stage) {
    if (job.status === "cancelled") return;
    job.status = status;
    job.stage = stage;
    job.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  async #processSpeech(job) {
    try {
      if (job.status === "cancelled") return;
      this.#updateSpeech(job, "generating", "\u6B63\u5728\u751F\u6210");
      const controller = new AbortController();
      job.controller = controller;
      const response = await this.#ttsFetch("https://tokendance.space/gateway/minimax/v1/t2a_v2", {
        method: "POST",
        headers: {
          authorization: `Bearer ${job.credential}`,
          "content-type": "application/json",
          "x-app-url": "app://narracut"
        },
        body: JSON.stringify({
          model: job.config.model,
          text: job.narrationText,
          stream: false,
          voice_setting: {
            voice_id: job.config.voice,
            speed: job.config.speed,
            vol: job.config.volume,
            pitch: job.config.pitch
          },
          audio_setting: {
            sample_rate: TTS_CAPABILITIES.audio.sampleRate,
            bitrate: TTS_CAPABILITIES.audio.bitrate,
            format: TTS_CAPABILITIES.audio.format,
            channel: TTS_CAPABILITIES.audio.channels
          }
        }),
        signal: controller.signal
      });
      if (job.status === "cancelled") return;
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new SpeechToolError("TTS_RESPONSE_INVALID", "Speech \u63D0\u4F9B\u65B9\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94\u7ED3\u6784\u3002");
      }
      if (!response.ok || typeof payload?.base_resp?.status_code === "number" && payload.base_resp.status_code !== 0) {
        const code = response.status === 401 || response.status === 403 ? "TTS_AUTH_FAILED" : response.status === 429 ? "TTS_RATE_LIMITED" : "TTS_PROVIDER_FAILED";
        throw new SpeechToolError(code, code === "TTS_AUTH_FAILED" ? "TokenDance \u9274\u6743\u5931\u8D25\uFF0C\u8BF7\u66FF\u6362 API Key\u3002" : code === "TTS_RATE_LIMITED" ? "TokenDance \u8BF7\u6C42\u8FC7\u591A\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" : "Speech \u63D0\u4F9B\u65B9\u62D2\u7EDD\u4E86\u672C\u6B21\u8BF7\u6C42\u3002");
      }
      const audioHex = payload?.data?.audio;
      const providerDurationMs = payload?.extra_info?.audio_length;
      if (typeof audioHex !== "string" || audioHex.length === 0 || audioHex.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(audioHex) || !Number.isSafeInteger(providerDurationMs) || providerDurationMs <= 0 || payload?.extra_info?.audio_format !== void 0 && payload.extra_info.audio_format !== "mp3") {
        throw new SpeechToolError("TTS_RESPONSE_INVALID", "Speech \u63D0\u4F9B\u65B9\u8FD4\u56DE\u4E86\u4E0D\u5B8C\u6574\u7684 MP3 \u6216\u65F6\u957F\u4FE1\u606F\u3002");
      }
      const audio = Buffer.from(audioHex, "hex");
      this.#updateSpeech(job, "validating", "\u6B63\u5728\u6821\u9A8C");
      let durationMs;
      try {
        const opened2 = this.#requireOpened(job.projectDirectory, job.projectId);
        durationMs = await opened2.probeSpeechAudio({ jobId: job.id, audio });
      } catch (cause) {
        if (cause instanceof ProjectLifecycleError) throw cause;
        throw new SpeechToolError("TTS_AUDIO_INVALID", "\u751F\u6210\u7684 Speech \u65E0\u6CD5\u5728\u672C\u673A\u89E3\u7801\u4E3A MP3\u3002");
      }
      if (Math.abs(durationMs - providerDurationMs) > 34) {
        throw new SpeechToolError("TTS_DURATION_MISMATCH", "Speech \u5B9E\u9645\u65F6\u957F\u4E0E\u63D0\u4F9B\u65B9\u8FD4\u56DE\u65F6\u957F\u4E0D\u4E00\u81F4\u3002");
      }
      if (job.status === "cancelled") return;
      this.#updateSpeech(job, "writing", "\u6B63\u5728\u5199\u5165");
      const opened = this.#requireOpened(job.projectDirectory, job.projectId);
      const committed = await opened.commitSpeech({
        sceneId: job.sceneId,
        narrationText: job.narrationText,
        ttsProfileId: job.ttsProfileId,
        durationMs,
        audio,
        isCancelled: () => job.status === "cancelled",
        onCommitPoint: () => {
          job.commitPointReached = true;
        }
      });
      opened.inspection = committed.inspection;
      job.inspection = committed.inspection;
      if (committed.status === "rejected") {
        this.#updateSpeech(job, "rejected", "\u7ED3\u679C\u672A\u5E94\u7528");
        job.error = { code: committed.code, message: committed.message, retryable: true };
        return;
      }
      this.#updateSpeech(job, "succeeded", "\u751F\u6210\u5B8C\u6210");
      job.result = { durationMs, message: committed.message };
    } catch (cause) {
      if (job.status === "cancelled" || cause instanceof Error && cause.name === "AbortError") return;
      this.#updateSpeech(job, "failed", "\u751F\u6210\u5931\u8D25");
      const code = cause instanceof SpeechToolError || cause instanceof ProjectLifecycleError ? cause.code : "SPEECH_GENERATION_FAILED";
      job.error = {
        code,
        message: cause instanceof Error ? cause.message : "Speech \u751F\u6210\u5931\u8D25\u3002",
        retryable: !["TTS_AUTH_FAILED", "TTS_RESPONSE_INVALID", "TTS_AUDIO_INVALID"].includes(code)
      };
    } finally {
      job.controller = void 0;
      job.credential = "";
      if (["succeeded", "cancelled", "failed", "rejected"].includes(job.status)) {
        const expiration = setTimeout(() => this.#speechJobs.delete(job.id), 5 * 6e4);
        expiration.unref();
      }
    }
  }
  async dispose() {
    for (const job of this.#speechJobs.values()) {
      if (!["succeeded", "cancelled", "failed", "rejected"].includes(job.status)) this.cancelSpeech(job.id);
    }
    this.#credentials.clear();
    this.#speechJobs.clear();
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
      structuredContent: { status: "connected", server: "narracut", readOnly: false },
      content: [{ type: "text", text: "Narracut \u63D2\u4EF6\u5DF2\u8FDE\u63A5\uFF1B\u53EF\u539F\u5B50\u521B\u5EFA\u3001\u4E25\u683C\u6253\u5F00 Project VNext\uFF0C\u5E76\u5728\u8868\u683C\u5DE5\u4F5C\u533A\u7F16\u8F91 Scene\u3002" }]
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
    if (projectDirectory === null || !isAbsolute3(projectDirectory)) {
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
        structuredContent: { ...workspace.serialize(inspection), operation },
        content: [{
          type: "text",
          text: operation === "created" ? `${basename3(inspection.projectDirectory)} \u5DF2\u539F\u5B50\u521B\u5EFA\u5E76\u6253\u5F00\uFF0C\u5171 0 \u4E2A Scene\u3002` : `${basename3(inspection.projectDirectory)} \u5DF2\u4E25\u683C\u6821\u9A8C\u5E76\u6253\u5F00\u3002`
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
            project: { directory: projectDirectory, folderName: basename3(projectDirectory) },
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
  if (name === "manage_project_candidate") {
    const input = argumentsValue;
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.projectDirectory !== "string" || !isAbsolute3(input.projectDirectory) || typeof input.projectId !== "string" || !["read", "create", "apply", "discard"].includes(String(input.action)) || input.baseline !== void 0 && typeof input.baseline !== "string" || input.confirmed !== void 0 && typeof input.confirmed !== "boolean") {
      return { isError: true, structuredContent: { status: "candidate-failed", error: { code: "INVALID_TOOL_INPUT", message: "\u5019\u9009\u64CD\u4F5C\u53C2\u6570\u65E0\u6548\u3002" } }, content: [{ type: "text", text: "\u5019\u9009\u64CD\u4F5C\u53C2\u6570\u65E0\u6548\u3002" }] };
    }
    try {
      const candidate = await workspace.candidate(input);
      return { structuredContent: { status: "candidate-state", candidate }, content: [{ type: "text", text: candidate.error?.message ?? (candidate.status === "absent" ? "\u6CA1\u6709\u5019\u9009\uFF1B\u5F53\u524D\u4FEE\u8BA2\u4FDD\u7559\u3002" : "\u5019\u9009\u5DF2\u4FDD\u5B58\uFF0C\u5C1A\u672A\u68C0\u67E5\u3001\u5C1A\u672A\u63A5\u53D7\u3002") }] };
    } catch (error) {
      if (error instanceof CandidateError || error instanceof ProjectLifecycleError) {
        return { isError: true, structuredContent: { status: error.code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "candidate-failed", error: { code: error.code, message: error.message } }, content: [{ type: "text", text: error.message }] };
      }
      return { isError: true, structuredContent: { status: "candidate-failed", error: { code: "CANDIDATE_SAVE_FAILED", message: "\u5019\u9009\u64CD\u4F5C\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u539F\u5019\u9009\u3002" } }, content: [{ type: "text", text: "\u5019\u9009\u64CD\u4F5C\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u539F\u5019\u9009\u3002" }] };
    }
  }
  if (name === "save_project_scenes") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: {
          status: "save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u4FDD\u5B58\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 Scene\uFF1A\u4FDD\u5B58\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute3(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.baselineRevision !== "string" || !("project" in input)) {
      return {
        isError: true,
        structuredContent: {
          status: "save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u3001\u57FA\u7EBF\u6216 Project DSL \u65E0\u6548\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 Scene\uFF1A\u9879\u76EE\u8EAB\u4EFD\u3001\u57FA\u7EBF\u6216 Project DSL \u65E0\u6548\u3002" }]
      };
    }
    try {
      const inspection = await workspace.save({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        project: input.project
      });
      return {
        structuredContent: { ...workspace.serialize(inspection), status: "saved" },
        content: [{ type: "text", text: `\u5DF2\u539F\u5B50\u4FDD\u5B58 ${inspection.project.scenes.length} \u4E2A Scene\u3002` }]
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const status = error instanceof ProjectLifecycleError && error.code === "PROJECT_SAVE_CONFLICT" ? "save-conflict" : error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "save-failed";
        const failure = lifecycleFailure(error);
        return {
          ...failure,
          structuredContent: {
            ...failure.structuredContent,
            status,
            connection: connectedState(false)
          }
        };
      }
      throw error;
    }
  }
  if (name === "save_project_video_brief") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: {
          status: "brief-save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "Video Brief \u4FDD\u5B58\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 Video Brief\uFF1A\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute3(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.baselineRevision !== "string" || typeof input.content !== "string") {
      return {
        isError: true,
        structuredContent: {
          status: "brief-save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u3001Brief ETag \u6216 Markdown \u5185\u5BB9\u65E0\u6548\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 Video Brief\uFF1A\u9879\u76EE\u8EAB\u4EFD\u3001Brief ETag \u6216\u5185\u5BB9\u65E0\u6548\u3002" }]
      };
    }
    try {
      const saved = await workspace.saveVideoBrief({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        content: input.content
      });
      if (saved.status === "conflict") {
        return {
          structuredContent: { status: "brief-conflict", disk: saved.disk },
          content: [{ type: "text", text: "video.md \u5DF2\u53D1\u751F\u5916\u90E8\u53D8\u5316\uFF1BNarracut \u4FDD\u7559 BASE\u3001LOCAL \u4E0E DISK\uFF0C\u672A\u8986\u76D6\u78C1\u76D8\u5185\u5BB9\u3002" }]
        };
      }
      return {
        structuredContent: { ...workspace.serialize(saved.inspection), status: "brief-saved" },
        content: [{ type: "text", text: "\u5DF2\u6309 Brief ETag \u539F\u5B50\u4FDD\u5B58\u5B8C\u6574 video.md\u3002" }]
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const failure = lifecycleFailure(error);
        return {
          ...failure,
          structuredContent: {
            ...failure.structuredContent,
            status: error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "brief-save-failed"
          }
        };
      }
      throw error;
    }
  }
  if (name === "export_project_video_brief_local") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: {
          status: "brief-export-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "Video Brief LOCAL \u5BFC\u51FA\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5BFC\u51FA Video Brief LOCAL\uFF1A\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute3(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.targetDirectory !== "string" || !isAbsolute3(input.targetDirectory) || typeof input.content !== "string") {
      return {
        isError: true,
        structuredContent: {
          status: "brief-export-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u3001\u5BFC\u51FA\u76EE\u5F55\u6216 LOCAL \u5185\u5BB9\u65E0\u6548\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5BFC\u51FA Video Brief LOCAL\uFF1A\u9879\u76EE\u8EAB\u4EFD\u3001\u76EE\u5F55\u6216\u5185\u5BB9\u65E0\u6548\u3002" }]
      };
    }
    try {
      const exported = await workspace.exportVideoBriefLocal({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        targetDirectory: input.targetDirectory,
        content: input.content
      });
      return {
        structuredContent: { status: "brief-exported", exported },
        content: [{ type: "text", text: `Video Brief LOCAL \u5DF2\u5BFC\u51FA\u5230 ${exported.path}\uFF1B\u672A\u8986\u76D6\u5DF2\u6709\u6587\u4EF6\u3002` }]
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const failure = lifecycleFailure(error);
        return {
          ...failure,
          structuredContent: { ...failure.structuredContent, status: "brief-export-failed" }
        };
      }
      throw error;
    }
  }
  if (name === "import_project_asset") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: {
          status: "asset-import-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u5BFC\u5165\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5BFC\u5165 Asset\uFF1A\u5BFC\u5165\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute3(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.baselineRevision !== "string" || typeof input.sourcePath !== "string" || !isAbsolute3(input.sourcePath) || input.targetSceneId !== void 0 && typeof input.targetSceneId !== "string") {
      return {
        isError: true,
        structuredContent: {
          status: "asset-import-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u3001\u57FA\u7EBF\u6216\u5BFC\u5165\u6E90\u65E0\u6548\u3002" }
        },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5BFC\u5165 Asset\uFF1A\u9879\u76EE\u8EAB\u4EFD\u3001\u57FA\u7EBF\u6216\u5BFC\u5165\u6E90\u65E0\u6548\u3002" }]
      };
    }
    try {
      const imported = await workspace.importAsset({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        sourcePath: input.sourcePath,
        ...typeof input.targetSceneId === "string" ? { targetSceneId: input.targetSceneId } : {}
      });
      const { inspection, ...assetImport } = imported;
      return {
        structuredContent: {
          ...workspace.serialize(inspection),
          status: imported.status.startsWith("imported-") ? "asset-imported" : "asset-import-result",
          assetImport
        },
        content: [{ type: "text", text: imported.message }]
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const failure = lifecycleFailure(error);
        return {
          ...failure,
          structuredContent: {
            ...failure.structuredContent,
            status: error instanceof ProjectLifecycleError && error.code === "PROJECT_SAVE_CONFLICT" ? "save-conflict" : error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "asset-import-failed",
            connection: connectedState(false)
          }
        };
      }
      throw error;
    }
  }
  if (name === "read_project_asset_preview") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: { assetPreview: { status: "dangling", id: "", reason: "\u9884\u89C8\u53C2\u6570\u65E0\u6548\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u8BFB\u53D6 Asset \u9884\u89C8\uFF1A\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute3(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.assetId !== "string") {
      return {
        isError: true,
        structuredContent: { assetPreview: { status: "dangling", id: "", reason: "\u9879\u76EE\u8EAB\u4EFD\u6216 Asset ID \u65E0\u6548\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u8BFB\u53D6 Asset \u9884\u89C8\uFF1A\u9879\u76EE\u8EAB\u4EFD\u6216 Asset ID \u65E0\u6548\u3002" }]
      };
    }
    try {
      const assetPreview = await workspace.readAssetPreview({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        assetId: input.assetId
      });
      return {
        structuredContent: { assetPreview },
        content: [{
          type: "text",
          text: assetPreview.status === "available" ? `${assetPreview.filename} \u5DF2\u5B8C\u6210\u53EA\u8BFB\u68C0\u67E5\u3002` : assetPreview.reason
        }]
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST") {
        return {
          isError: true,
          structuredContent: {
            status: "identity-lost",
            error: { code: error.code, path: error.path, message: error.message }
          },
          content: [{ type: "text", text: `\u65E0\u6CD5\u8BFB\u53D6 Asset \u9884\u89C8\uFF1A${error.message}` }]
        };
      }
      throw error;
    }
  }
  if (name === "save_project_tts_settings") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: { status: "tts-save-failed", error: { code: "INVALID_TOOL_INPUT", message: "TTS \u4FDD\u5B58\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 TTS \u914D\u7F6E\uFF1A\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute3(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.baselineRevision !== "string" || typeof input.config !== "object" || input.config === null || !["keep", "replace", "clear"].includes(String(input.credentialAction)) || !Number.isSafeInteger(input.expectedAffectedSpeechCount) || Number(input.expectedAffectedSpeechCount) < 0 || input.apiKey !== void 0 && typeof input.apiKey !== "string") {
      return {
        isError: true,
        structuredContent: { status: "tts-save-failed", error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u3001\u914D\u7F6E\u6216\u51ED\u636E\u64CD\u4F5C\u65E0\u6548\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u4FDD\u5B58 TTS \u914D\u7F6E\uFF1A\u9879\u76EE\u8EAB\u4EFD\u3001\u914D\u7F6E\u6216\u51ED\u636E\u64CD\u4F5C\u65E0\u6548\u3002" }]
      };
    }
    try {
      const saved = await workspace.saveTtsSettings({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        config: input.config,
        credentialAction: input.credentialAction,
        expectedAffectedSpeechCount: input.expectedAffectedSpeechCount,
        ...typeof input.apiKey === "string" ? { apiKey: input.apiKey } : {}
      });
      return {
        structuredContent: {
          ...workspace.serialize(saved.inspection),
          status: "tts-saved",
          affectedSpeechCount: saved.affectedSpeechCount
        },
        content: [{ type: "text", text: saved.affectedSpeechCount > 0 ? `TTS \u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u5E76\u79FB\u9664 ${saved.affectedSpeechCount} \u6761\u4E0D\u518D\u5339\u914D\u7684 Speech \u8BB0\u5F55\u3002` : "TTS \u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF1B\u73B0\u6709 Speech \u4ECD\u4E0E\u914D\u7F6E\u5339\u914D\u3002" }]
      };
    } catch (error) {
      if (error instanceof ProjectTtsConfirmationError) {
        return {
          isError: true,
          structuredContent: {
            status: "tts-confirmation-required",
            affectedSpeechCount: error.affectedSpeechCount,
            error: { code: error.code, message: error.message }
          },
          content: [{ type: "text", text: error.message }]
        };
      }
      const code = error instanceof SpeechToolError ? error.code : error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError ? error.code : "TTS_SAVE_FAILED";
      return {
        isError: true,
        structuredContent: {
          status: code === "PROJECT_SAVE_CONFLICT" ? "save-conflict" : code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "tts-save-failed",
          error: { code, message: error instanceof Error ? error.message : "\u65E0\u6CD5\u4FDD\u5B58 TTS \u914D\u7F6E\u3002" }
        },
        content: [{ type: "text", text: `\u65E0\u6CD5\u4FDD\u5B58 TTS \u914D\u7F6E\uFF1A${error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF"}` }]
      };
    }
  }
  if (name === "start_scene_speech") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: { status: "speech-start-failed", error: { code: "INVALID_TOOL_INPUT", message: "Speech \u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5F00\u59CB Speech \u751F\u6210\uFF1A\u53C2\u6570\u65E0\u6548\u3002" }]
      };
    }
    const input = argumentsValue;
    if (typeof input.projectDirectory !== "string" || !isAbsolute3(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.sceneId !== "string") {
      return {
        isError: true,
        structuredContent: { status: "speech-start-failed", error: { code: "INVALID_TOOL_INPUT", message: "\u9879\u76EE\u8EAB\u4EFD\u6216 Scene ID \u65E0\u6548\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u5F00\u59CB Speech \u751F\u6210\uFF1A\u9879\u76EE\u8EAB\u4EFD\u6216 Scene ID \u65E0\u6548\u3002" }]
      };
    }
    try {
      const speechJob = workspace.startSpeech({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        sceneId: input.sceneId
      });
      return {
        structuredContent: { status: "speech-started", speechJob },
        content: [{ type: "text", text: "Speech \u751F\u6210\u5DF2\u6392\u961F\u3002" }]
      };
    } catch (error) {
      const code = error instanceof SpeechToolError ? error.code : error instanceof ProjectLifecycleError ? error.code : "SPEECH_START_FAILED";
      return {
        isError: true,
        structuredContent: { status: "speech-start-failed", error: { code, message: error instanceof Error ? error.message : "\u65E0\u6CD5\u5F00\u59CB Speech \u751F\u6210\u3002" } },
        content: [{ type: "text", text: `\u65E0\u6CD5\u5F00\u59CB Speech \u751F\u6210\uFF1A${error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF"}` }]
      };
    }
  }
  if (name === "get_scene_speech_job" || name === "cancel_scene_speech_job") {
    const jobId = stringArgument(argumentsValue, "jobId");
    if (jobId === null) {
      return {
        isError: true,
        structuredContent: { status: "speech-job-failed", error: { code: "INVALID_TOOL_INPUT", message: "jobId \u4E0D\u80FD\u4E3A\u7A7A\u3002" } },
        content: [{ type: "text", text: "\u65E0\u6CD5\u8BFB\u53D6 Speech \u4EFB\u52A1\uFF1AjobId \u4E0D\u80FD\u4E3A\u7A7A\u3002" }]
      };
    }
    try {
      if (name === "cancel_scene_speech_job") {
        const speechJob = workspace.cancelSpeech(jobId);
        const cancelled = speechJob.status === "cancelled";
        return {
          structuredContent: { status: cancelled ? "speech-cancelled" : "speech-commit-in-progress", speechJob },
          content: [{ type: "text", text: cancelled ? "Speech \u751F\u6210\u5DF2\u53D6\u6D88\uFF1B\u65E2\u6709 Speech \u4FDD\u6301\u4E0D\u53D8\u3002" : "Speech \u5DF2\u8D8A\u8FC7\u63D0\u4EA4\u70B9\uFF0C\u65E0\u6CD5\u53D6\u6D88\uFF1BNarracut \u5C06\u5B8C\u6210\u5F53\u524D\u539F\u5B50\u63D0\u4EA4\u3002" }]
        };
      }
      const current = workspace.getSpeech(jobId);
      return {
        structuredContent: {
          status: "speech-job",
          speechJob: current.job,
          ...current.inspection === void 0 ? {} : workspace.serialize(current.inspection)
        },
        content: [{ type: "text", text: `Speech \u4EFB\u52A1\u72B6\u6001\uFF1A${current.job.status}\u3002` }]
      };
    } catch (error) {
      return {
        isError: true,
        structuredContent: { status: "speech-job-failed", error: { code: error instanceof SpeechToolError ? error.code : "SPEECH_JOB_FAILED", message: error instanceof Error ? error.message : "\u65E0\u6CD5\u8BFB\u53D6 Speech \u4EFB\u52A1\u3002" } },
        content: [{ type: "text", text: `\u65E0\u6CD5\u8BFB\u53D6 Speech \u4EFB\u52A1\uFF1A${error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF"}` }]
      };
    }
  }
  if (name === "inspect_project") return inspectProject(argumentsValue);
  if (name === "start_agent_host_validation") {
    const projectDirectory = stringArgument(argumentsValue, "projectDirectory");
    if (projectDirectory === null || !isAbsolute3(projectDirectory)) {
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
  const workspace = new ProjectWorkspaceSession({
    ttsFetch: options.ttsFetch,
    probeSpeechDurationMs: options.probeSpeechDurationMs
  });
  const requestHandler = async (request) => {
    switch (request.method) {
      case "initialize": {
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "narracut", version: SERVER_VERSION },
          instructions: "\u53EA\u63A5\u89E6\u7528\u6237\u901A\u8FC7\u7CFB\u7EDF\u6587\u4EF6\u5939\u9009\u62E9\u7A97\u53E3\u6216\u53C2\u6570\u660E\u786E\u7ED9\u51FA\u7684\u76EE\u5F55\u3002\u53EF\u4EE5\u5728\u4E0D\u5B58\u5728\u7684\u76EE\u6807\u539F\u5B50\u521B\u5EFA Project VNext\uFF0C\u6216\u4E25\u683C\u6253\u5F00\u6709\u6548\u9879\u76EE\uFF1B\u8868\u683C\u5DE5\u4F5C\u533A\u53EA\u4FEE\u6539 Scene \u4E0E Narration\uFF0CAgent \u5DE5\u4F5C\u533A\u53EF\u663E\u5F0F\u521B\u5EFA\u3001\u8BFB\u53D6\u6216\u653E\u5F03\u552F\u4E00\u5019\u9009\uFF0C\u5E76\u53EF\u8FD0\u884C\u56FA\u5B9A\u7684\u53EA\u8BFB Codex \u521B\u4F5C\u7EBF\u7A0B\u5BBF\u4E3B\u9A8C\u8BC1\uFF1B\u53D7\u63A7\u5DE5\u5177\u53EA\u539F\u5B50\u4FEE\u6539\u5019\u9009\uFF0C\u4E0D\u4FEE\u6539\u5F53\u524D\u4FEE\u8BA2\u3002"
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
            description: "Project VNext \u542F\u52A8\u5668\u3001\u53EF\u7F16\u8F91 Scene \u63A5\u89E6\u8868\u4E0E\u53EA\u8BFB Agent \u5DE5\u4F5C\u533A",
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

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { CodexAppServerHost } from "./codex-app-server-host";
import {
  AgentHostValidationService,
  type CodexHostAdapter,
} from "./codex-host";
import {
  inspectProjectVNext,
  ProjectInspectionError,
  type ProjectInspectionDiagnostic,
  type ProjectVNextInspection,
} from "../../../src/server/project-vnext-inspection";
import {
  createProjectVNext,
  openProjectVNext,
  ProjectLifecycleError,
  ProjectTtsConfirmationError,
  type OpenedProjectVNext,
} from "../../../src/server/project-lifecycle";
import { readProjectAssetPreview } from "../../../src/server/project-asset-preview";
import {
  TTS_CAPABILITIES,
  probeSpeechDurationMs,
  type ProjectTtsConfig,
} from "../../../src/server/project-speech-vnext";

const SERVER_VERSION = "0.1.0";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const WORKBENCH_URI = "ui://narracut/workbench-v1.html";
const WORKBENCH_PATH = fileURLToPath(new URL(
  import.meta.url.endsWith("/server.mjs") ? "./workbench.html" : "../workbench.html",
  import.meta.url,
));
const WORKBENCH_SCRIPT_PATH = fileURLToPath(new URL(
  import.meta.url.endsWith("/server.mjs") ? "./workbench.js" : "../workbench.js",
  import.meta.url,
));
const ASSET_BASE = import.meta.url.endsWith("/server.mjs") ? "./assets/" : "../assets/";
const PAPER_TEXTURE_PATH = fileURLToPath(new URL(`${ASSET_BASE}contact-paper-texture.webp`, import.meta.url));
const FILM_TEXTURE_PATH = fileURLToPath(new URL(`${ASSET_BASE}film-edge-texture.webp`, import.meta.url));
const DISPLAY_FONT_PATH = fileURLToPath(new URL(`${ASSET_BASE}fonts/ubuntu-sans-display.woff2`, import.meta.url));

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

const readOnlyToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const taskToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

type TtsCredentialState =
  | { status: "missing"; storage: "session" }
  | { status: "available"; storage: "session"; masked: string };

type SpeechJob = {
  id: string;
  sceneId: string;
  status: "queued" | "generating" | "validating" | "writing" | "succeeded" | "cancelled" | "failed" | "rejected";
  stage: string;
  createdAt: string;
  updatedAt: string;
  result?: { durationMs: number; message: string };
  error?: { code: string; message: string; retryable: boolean };
};

type InternalSpeechJob = SpeechJob & {
  projectId: string;
  projectDirectory: string;
  narrationText: string;
  config: ProjectTtsConfig;
  ttsProfileId: string;
  credential: string;
  controller?: AbortController;
  inspection?: ProjectVNextInspection;
  commitPointReached?: boolean;
};

const tools = [
  {
    name: "health_check",
    title: "检查 Narracut 连接",
    description: "确认 Narracut 本地 MCP 已连接，并返回启动器与项目工作台能力边界。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      required: ["status", "server", "readOnly"],
      properties: {
        status: { type: "string", enum: ["connected"] },
        server: { type: "string" },
        readOnly: { type: "boolean" },
      },
      additionalProperties: false,
    },
    annotations: readOnlyToolAnnotations,
  },
  {
    name: "show_launcher",
    title: "打开 Narracut 项目启动器",
    description: "在没有项目参数时打开 Narracut 启动器，用系统文件夹选择窗口创建或打开 Project VNext。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } },
  },
  {
    name: "create_project",
    title: "原子创建并打开 Narracut 项目",
    description:
      "在用户明确选择的不存在绝对路径同级生成 Project VNext，完整校验后原子发布并取得写入租约。不会联网、安装依赖或覆盖已有目录。",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        confirmTemporaryCleanup: { type: "boolean" },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } },
  },
  {
    name: "open_project",
    title: "打开 Narracut 项目",
    description:
      "严格校验用户明确选择的 Project VNext 绝对目录并取得独占写入租约；不会创建、补全、迁移或改写普通目录与损坏项目。",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: { projectDirectory: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } },
  },
  {
    name: "save_project_scenes",
    title: "保存表格工作区 Scene",
    description: "仅供 Narracut 工作台 app 使用：按项目身份与磁盘基线原子保存严格 Scene DSL。",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baselineRevision", "project"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baselineRevision: { type: "string", minLength: 1 },
        project: { type: "object" },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "import_project_asset",
    title: "导入一个项目 Asset",
    description: "仅供 Narracut 工作台 app 使用：逐字节复制一个系统文件选择器返回的普通文件，登记后可绑定原目标 Scene。",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baselineRevision", "sourcePath"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baselineRevision: { type: "string", minLength: 1 },
        sourcePath: { type: "string", minLength: 1 },
        targetSceneId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "read_project_asset_preview",
    title: "读取项目 Asset 预览",
    description: "仅供 Narracut 工作台 app 使用：按登记 ID 只读检查 Asset，并为可安全内联的已知格式返回预览。",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "assetId"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        assetId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "save_project_tts_settings",
    title: "保存项目 TTS 配置",
    description: "仅供 Narracut 工作台 app 使用：原子保存项目 TTS 配置，并在确认后移除不再匹配的 Speech 记录。API Key 只保留在宿主会话内。",
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
        expectedAffectedSpeechCount: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "start_scene_speech",
    title: "生成当前 Scene Speech",
    description: "仅供 Narracut 工作台 app 使用：为当前 Narration 和项目 TTS 配置生成、校验并原子应用 Speech。",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "sceneId"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        sceneId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "get_scene_speech_job",
    title: "读取 Speech 生成状态",
    description: "仅供 Narracut 工作台 app 使用：读取一次 Scene Speech 生成任务的有界状态。",
    inputSchema: {
      type: "object",
      required: ["jobId"],
      properties: { jobId: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "cancel_scene_speech_job",
    title: "取消 Speech 生成",
    description: "仅供 Narracut 工作台 app 使用：取消当前 Scene 的 Speech 生成，不改变既有 Speech。",
    inputSchema: {
      type: "object",
      required: ["jobId"],
      properties: { jobId: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: { ...taskToolAnnotations, idempotentHint: true },
    _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "inspect_project",
    title: "检查 Narracut 项目",
    description:
      "只读检查用户明确给出的 Project VNext 绝对目录，返回项目身份、Scene 与固定控制文件状态，并打开工作台。不会浏览其他目录、写文件、执行 Shell 或访问网络。",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: {
        projectDirectory: {
          type: "string",
          minLength: 1,
          description: "用户明确指定的 Project VNext 绝对目录。",
        },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } },
  },
  {
    name: "start_agent_host_validation",
    title: "开始 Codex 创作线程验证",
    description:
      "为用户明确给出的 Project VNext 目录创建专用 Codex 创作线程，并运行固定的只读宿主验证任务。不会修改项目内容。",
    inputSchema: {
      type: "object",
      required: ["projectDirectory"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
  },
  {
    name: "get_agent_host_validation",
    title: "读取 Codex 创作线程验证状态",
    description: "只读返回一次临时宿主验证任务的当前稳定状态。",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: readOnlyToolAnnotations,
  },
  {
    name: "stop_agent_host_validation",
    title: "停止 Codex 创作线程验证",
    description: "撤销当前 Codex 创作线程的驱动权并停止验证 Turn，保留最小可继续检查点。",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: { ...taskToolAnnotations, idempotentHint: true },
  },
  {
    name: "continue_agent_host_validation",
    title: "继续 Codex 创作线程验证",
    description: "恢复可用的原 Codex 创作线程；线程已失效时自动创建替代线程并重新验证。",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
  },
] as const;

function connectedState(readOnly = true): { status: "connected"; readOnly: boolean } {
  return { status: "connected", readOnly };
}

function launcherConnectionState(): { status: "connected"; readOnly: false } {
  return { status: "connected", readOnly: false };
}

function serializeInspection(
  inspection: ProjectVNextInspection,
  writable = false,
  credential: TtsCredentialState = { status: "missing", storage: "session" },
): Record<string, unknown> {
  const assets = new Map(inspection.project.assets.map((asset) => [asset.id, asset]));
  const speechStates = new Map(inspection.speechStates.map((state) => [state.sceneId, state]));
  const timeWindows = new Map(inspection.timeline.scenes.map((time) => [time.sceneId, time]));
  return {
    status: "valid",
    connection: connectedState(!writable),
    writable,
    projectRevision: inspection.projectRevision,
    projectDsl: inspection.project,
    tts: {
      ...inspection.tts,
      credential,
      capabilities: TTS_CAPABILITIES,
    },
    speechStates: inspection.speechStates,
    timeline: inspection.timeline,
    project: {
      directory: inspection.projectDirectory,
      folderName: basename(inspection.projectDirectory),
      projectId: inspection.manifest.projectId,
      sceneCount: inspection.project.scenes.length,
      assetCount: inspection.project.assets.length,
    },
    checks: {
      manifest: { status: "valid", label: "项目清单" },
      dsl: { status: "valid", label: "Project DSL" },
      videoBrief: {
        status: "valid",
        label: "video.md",
        bytes: Buffer.byteLength(inspection.videoBrief, "utf8"),
      },
    },
    scenes: inspection.project.scenes.map((scene, index) => ({
      id: scene.id,
      index: index + 1,
      narration: scene.narration.text,
      assets: scene.assetIds.map((assetId) => ({
        id: assetId,
        path: assets.get(assetId)?.path ?? null,
      })),
      speech: speechStates.get(scene.id) ?? { status: "missing" },
      time: timeWindows.get(scene.id),
    })),
    warnings: inspection.warnings,
    assetStates: inspection.assetStates,
  };
}

function diagnosticSummary(diagnostics: readonly ProjectInspectionDiagnostic[]): unknown[] {
  return diagnostics.map(({ code, component, message, metric, actual, limit, jsonPath }) => ({
    code,
    component,
    message,
    ...(metric === undefined ? {} : { metric }),
    ...(actual === undefined ? {} : { actual }),
    ...(limit === undefined ? {} : { limit }),
    ...(jsonPath === undefined ? {} : { jsonPath }),
  }));
}

async function loadWorkbench(): Promise<string> {
  const [html, script, paperTexture, filmTexture, displayFont] = await Promise.all([
    readFile(WORKBENCH_PATH, "utf8"),
    readFile(WORKBENCH_SCRIPT_PATH, "utf8"),
    readFile(PAPER_TEXTURE_PATH),
    readFile(FILM_TEXTURE_PATH),
    readFile(DISPLAY_FONT_PATH),
  ]);
  const materialVariables = `@font-face{font-family:"Narracut Display";src:url("data:font/woff2;base64,${displayFont.toString("base64")}") format("woff2");font-style:normal;font-weight:100 800;font-stretch:75% 100%;font-display:block}:root{--paper-texture:url("data:image/webp;base64,${paperTexture.toString("base64")}");--film-texture:url("data:image/webp;base64,${filmTexture.toString("base64")}")}`;
  return html
    .replace("/*__NARRACUT_MATERIALS__*/", materialVariables)
    .replace("/*__NARRACUT_WORKBENCH_JS__*/", script);
}

async function inspectProject(argumentsValue: unknown): Promise<ToolResult> {
  if (
    typeof argumentsValue !== "object" ||
    argumentsValue === null ||
    Array.isArray(argumentsValue) ||
    typeof (argumentsValue as { projectDirectory?: unknown }).projectDirectory !== "string"
  ) {
    return {
      isError: true,
      structuredContent: {
        status: "invalid",
        connection: connectedState(),
        error: { code: "INVALID_TOOL_INPUT", message: "projectDirectory 必须是绝对目录路径。" },
      },
      content: [{ type: "text", text: "无法检查项目：projectDirectory 必须是绝对目录路径。" }],
    };
  }
  const projectDirectory = (argumentsValue as { projectDirectory: string }).projectDirectory;
  if (!isAbsolute(projectDirectory)) {
    return {
      isError: true,
      structuredContent: {
        status: "invalid",
        connection: connectedState(),
        error: { code: "INVALID_TOOL_INPUT", message: "只接受用户明确给出的绝对项目目录。" },
      },
      content: [{ type: "text", text: "无法检查项目：只接受绝对项目目录。" }],
    };
  }
  try {
    const inspection = await inspectProjectVNext(projectDirectory);
    const structuredContent = serializeInspection(inspection);
    return {
      structuredContent,
      content: [{
        type: "text",
        text: `${basename(inspection.projectDirectory)} 是有效的 Project VNext，共 ${inspection.project.scenes.length} 个 Scene。当前插件只提供只读检查。`,
      }],
    };
  } catch (error) {
    if (error instanceof ProjectInspectionError) {
      return {
        isError: true,
        structuredContent: {
          status: "invalid",
          connection: connectedState(),
          project: { directory: projectDirectory, folderName: basename(projectDirectory) },
          error: {
            code: error.code,
            path: error.path,
            message: error.message,
            diagnostics: diagnosticSummary(error.diagnostics),
          },
        },
        content: [{ type: "text", text: `Narracut 项目检查失败：${error.message}` }],
      };
    }
    throw error;
  }
}

function stringArgument(argumentsValue: unknown, name: string): string | null {
  if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
    return null;
  }
  const value = (argumentsValue as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function hostValidationResult(hostValidation: Record<string, unknown>, text: string): ToolResult {
  return {
    structuredContent: { hostValidation },
    content: [{ type: "text", text }],
  };
}

class SpeechToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SpeechToolError";
  }
}

function publicSpeechJob(job: InternalSpeechJob): SpeechJob {
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

function credentialState(value: string | undefined): TtsCredentialState {
  if (value === undefined) return { status: "missing", storage: "session" };
  return { status: "available", storage: "session", masked: `••••${value.slice(-4)}` };
}

class ProjectWorkspaceSession {
  #opened: OpenedProjectVNext | null = null;

  readonly #credentials = new Map<string, string>();
  readonly #speechJobs = new Map<string, InternalSpeechJob>();
  readonly #ttsFetch: typeof fetch;
  readonly #probeSpeechDurationMs: (path: string) => Promise<number>;

  constructor(options: {
    ttsFetch?: typeof fetch;
    probeSpeechDurationMs?: (path: string) => Promise<number>;
  } = {}) {
    this.#ttsFetch = options.ttsFetch ?? globalThis.fetch;
    this.#probeSpeechDurationMs = options.probeSpeechDurationMs ?? probeSpeechDurationMs;
  }

  credential(projectId: string): TtsCredentialState {
    return credentialState(this.#credentials.get(projectId));
  }

  serialize(inspection: ProjectVNextInspection, writable = true): Record<string, unknown> {
    return serializeInspection(inspection, writable, this.credential(inspection.manifest.projectId));
  }

  async open(projectDirectory: string): Promise<ProjectVNextInspection> {
    const next = await openProjectVNext(projectDirectory, {
      probeSpeechDurationMs: this.#probeSpeechDurationMs,
    });
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

  async save(input: {
    projectDirectory: string;
    projectId: string;
    baselineRevision: string;
    project: unknown;
  }): Promise<ProjectVNextInspection> {
    const opened = this.#opened;
    if (
      opened === null ||
      opened.inspection.projectDirectory !== input.projectDirectory ||
      opened.inspection.manifest.projectId !== input.projectId
    ) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        input.projectDirectory,
        "当前工作台没有持有该项目的写入租约；Narracut 拒绝保存。",
      );
    }
    const saved = await opened.saveProject(input.project, input.baselineRevision);
    opened.inspection = saved.inspection;
    return saved.inspection;
  }

  async importAsset(input: {
    projectDirectory: string;
    projectId: string;
    baselineRevision: string;
    sourcePath: string;
    targetSceneId?: string;
  }): Promise<Awaited<ReturnType<OpenedProjectVNext["importAsset"]>>> {
    const opened = this.#opened;
    if (
      opened === null ||
      opened.inspection.projectDirectory !== input.projectDirectory ||
      opened.inspection.manifest.projectId !== input.projectId
    ) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        input.projectDirectory,
        "当前工作台没有持有该项目的写入租约；Narracut 拒绝导入。",
      );
    }
    const imported = await opened.importAsset({
      sourcePath: input.sourcePath,
      targetSceneId: input.targetSceneId,
      baselineRevision: input.baselineRevision,
    });
    opened.inspection = imported.inspection;
    return imported;
  }

  async readAssetPreview(input: {
    projectDirectory: string;
    projectId: string;
    assetId: string;
  }): Promise<Awaited<ReturnType<typeof readProjectAssetPreview>>> {
    const opened = this.#opened;
    if (
      opened === null ||
      opened.inspection.projectDirectory !== input.projectDirectory ||
      opened.inspection.manifest.projectId !== input.projectId
    ) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        input.projectDirectory,
        "当前工作台未持有该项目身份；Narracut 拒绝读取预览。",
      );
    }
    return readProjectAssetPreview(opened.inspection, input.assetId);
  }

  async saveTtsSettings(input: {
    projectDirectory: string;
    projectId: string;
    baselineRevision: string;
    config: ProjectTtsConfig;
    credentialAction: "keep" | "replace" | "clear";
    apiKey?: string;
    expectedAffectedSpeechCount: number;
  }): Promise<{ affectedSpeechCount: number; inspection: ProjectVNextInspection }> {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    if (input.credentialAction === "replace" && (input.apiKey === undefined || input.apiKey.trim() === "")) {
      throw new SpeechToolError("TTS_CREDENTIAL_INVALID", "替换 API Key 时必须提供非空值。");
    }
    const saved = await opened.saveTtsSettings({
      config: input.config,
      baselineRevision: input.baselineRevision,
      expectedAffectedSpeechCount: input.expectedAffectedSpeechCount,
    });
    if (input.credentialAction === "replace") this.#credentials.set(input.projectId, input.apiKey!);
    if (input.credentialAction === "clear") this.#credentials.delete(input.projectId);
    opened.inspection = saved.inspection;
    for (const job of this.#speechJobs.values()) {
      if (
        job.projectId === input.projectId &&
        !["succeeded", "cancelled", "failed", "rejected"].includes(job.status) &&
        saved.inspection.tts.status === "configured" &&
        job.ttsProfileId !== saved.inspection.tts.profileId
      ) {
        this.cancelSpeech(job.id, "TTS 配置已变化，旧配置生成任务已取消。");
      }
    }
    return saved;
  }

  startSpeech(input: {
    projectDirectory: string;
    projectId: string;
    sceneId: string;
  }): SpeechJob {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    const tts = opened.inspection.tts;
    if (tts.status !== "configured") {
      throw new SpeechToolError("TTS_CONFIG_MISSING", "请先保存项目 TTS 配置。");
    }
    const key = this.#credentials.get(input.projectId);
    if (key === undefined) {
      throw new SpeechToolError("TTS_CREDENTIAL_MISSING", "请先录入 TokenDance API Key；凭据只保留在当前宿主会话。");
    }
    const scene = opened.inspection.project.scenes.find((candidate) => candidate.id === input.sceneId);
    if (scene === undefined) throw new SpeechToolError("SPEECH_SCENE_MISSING", "目标 Scene 不存在。");
    if (scene.narration.text.trim() === "") {
      throw new SpeechToolError("SPEECH_NARRATION_EMPTY", "空 Narration 不能生成 Speech；请先补充内容。");
    }
    if ([...this.#speechJobs.values()].some((job) =>
      job.projectId === input.projectId && job.sceneId === input.sceneId &&
      !["succeeded", "cancelled", "failed", "rejected"].includes(job.status))) {
      throw new SpeechToolError("SPEECH_JOB_ACTIVE", "当前 Scene 已有 Speech 正在生成。");
    }
    if (this.#speechJobs.size >= 128) {
      const terminal = [...this.#speechJobs.values()]
        .filter((job) => ["succeeded", "cancelled", "failed", "rejected"].includes(job.status))
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
      for (const job of terminal.slice(0, Math.max(1, this.#speechJobs.size - 127))) {
        this.#speechJobs.delete(job.id);
      }
    }
    const now = new Date().toISOString();
    const job: InternalSpeechJob = {
      id: randomUUID(),
      sceneId: scene.id,
      status: "queued",
      stage: "排队",
      createdAt: now,
      updatedAt: now,
      projectId: input.projectId,
      projectDirectory: input.projectDirectory,
      narrationText: scene.narration.text,
      config: structuredClone(tts.config),
      ttsProfileId: tts.profileId,
      credential: key,
    };
    this.#speechJobs.set(job.id, job);
    setImmediate(() => void this.#processSpeech(job));
    return publicSpeechJob(job);
  }

  getSpeech(jobId: string): { job: SpeechJob; inspection?: ProjectVNextInspection } {
    const job = this.#speechJobs.get(jobId);
    if (job === undefined) throw new SpeechToolError("SPEECH_JOB_NOT_FOUND", "Speech 任务不存在或已失效。");
    const result = { job: publicSpeechJob(job), ...(job.inspection === undefined ? {} : { inspection: job.inspection }) };
    return result;
  }

  cancelSpeech(jobId: string, message = "Speech 生成已取消；既有 Speech 保持不变。"): SpeechJob {
    const job = this.#speechJobs.get(jobId);
    if (job === undefined) throw new SpeechToolError("SPEECH_JOB_NOT_FOUND", "Speech 任务不存在或已失效。");
    if (!["succeeded", "cancelled", "failed", "rejected"].includes(job.status) && !job.commitPointReached) {
      job.status = "cancelled";
      job.stage = "已取消";
      job.updatedAt = new Date().toISOString();
      job.error = { code: "SPEECH_CANCELLED", message, retryable: true };
      job.controller?.abort();
    }
    return publicSpeechJob(job);
  }

  #requireOpened(projectDirectory: string, projectId: string): OpenedProjectVNext {
    const opened = this.#opened;
    if (
      opened === null || opened.inspection.projectDirectory !== projectDirectory ||
      opened.inspection.manifest.projectId !== projectId
    ) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        projectDirectory,
        "当前工作台未持有该项目身份；Narracut 拒绝操作 Speech。",
      );
    }
    return opened;
  }

  #updateSpeech(job: InternalSpeechJob, status: SpeechJob["status"], stage: string): void {
    if (job.status === "cancelled") return;
    job.status = status;
    job.stage = stage;
    job.updatedAt = new Date().toISOString();
  }

  async #processSpeech(job: InternalSpeechJob): Promise<void> {
    try {
      if ((job as SpeechJob).status === "cancelled") return;
      this.#updateSpeech(job, "generating", "正在生成");
      const controller = new AbortController();
      job.controller = controller;
      const response = await this.#ttsFetch("https://tokendance.space/gateway/minimax/v1/t2a_v2", {
        method: "POST",
        headers: {
          authorization: `Bearer ${job.credential}`,
          "content-type": "application/json",
          "x-app-url": "app://narracut",
        },
        body: JSON.stringify({
          model: job.config.model,
          text: job.narrationText,
          stream: false,
          voice_setting: {
            voice_id: job.config.voice,
            speed: job.config.speed,
            vol: job.config.volume,
            pitch: job.config.pitch,
          },
          audio_setting: {
            sample_rate: TTS_CAPABILITIES.audio.sampleRate,
            bitrate: TTS_CAPABILITIES.audio.bitrate,
            format: TTS_CAPABILITIES.audio.format,
            channel: TTS_CAPABILITIES.audio.channels,
          },
        }),
        signal: controller.signal,
      });
      if ((job as SpeechJob).status === "cancelled") return;
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new SpeechToolError("TTS_RESPONSE_INVALID", "Speech 提供方返回了无法识别的响应结构。");
      }
      if (!response.ok || (typeof payload?.base_resp?.status_code === "number" && payload.base_resp.status_code !== 0)) {
        const code = response.status === 401 || response.status === 403
          ? "TTS_AUTH_FAILED"
          : response.status === 429 ? "TTS_RATE_LIMITED" : "TTS_PROVIDER_FAILED";
        throw new SpeechToolError(code, code === "TTS_AUTH_FAILED"
          ? "TokenDance 鉴权失败，请替换 API Key。"
          : code === "TTS_RATE_LIMITED" ? "TokenDance 请求过多，请稍后重试。" : "Speech 提供方拒绝了本次请求。");
      }
      const audioHex = payload?.data?.audio;
      const providerDurationMs = payload?.extra_info?.audio_length;
      if (
        typeof audioHex !== "string" || audioHex.length === 0 || audioHex.length % 2 !== 0 ||
        !/^[0-9a-f]+$/iu.test(audioHex) || !Number.isSafeInteger(providerDurationMs) ||
        providerDurationMs <= 0 || (payload?.extra_info?.audio_format !== undefined && payload.extra_info.audio_format !== "mp3")
      ) {
        throw new SpeechToolError("TTS_RESPONSE_INVALID", "Speech 提供方返回了不完整的 MP3 或时长信息。");
      }
      const audio = Buffer.from(audioHex, "hex");
      this.#updateSpeech(job, "validating", "正在校验");
      let durationMs: number;
      try {
        const opened = this.#requireOpened(job.projectDirectory, job.projectId);
        durationMs = await opened.probeSpeechAudio({ jobId: job.id, audio });
      } catch (cause) {
        if (cause instanceof ProjectLifecycleError) throw cause;
        throw new SpeechToolError("TTS_AUDIO_INVALID", "生成的 Speech 无法在本机解码为 MP3。");
      }
      if (Math.abs(durationMs - providerDurationMs) > 34) {
        throw new SpeechToolError("TTS_DURATION_MISMATCH", "Speech 实际时长与提供方返回时长不一致。");
      }
      if (job.status === "cancelled") return;
      this.#updateSpeech(job, "writing", "正在写入");
      const opened = this.#requireOpened(job.projectDirectory, job.projectId);
      const committed = await opened.commitSpeech({
        sceneId: job.sceneId,
        narrationText: job.narrationText,
        ttsProfileId: job.ttsProfileId,
        durationMs,
        audio,
        isCancelled: () => job.status === "cancelled",
        onCommitPoint: () => { job.commitPointReached = true; },
      });
      opened.inspection = committed.inspection;
      job.inspection = committed.inspection;
      if (committed.status === "rejected") {
        this.#updateSpeech(job, "rejected", "结果未应用");
        job.error = { code: committed.code, message: committed.message, retryable: true };
        return;
      }
      this.#updateSpeech(job, "succeeded", "生成完成");
      job.result = { durationMs, message: committed.message };
    } catch (cause) {
      if (job.status === "cancelled" || (cause instanceof Error && cause.name === "AbortError")) return;
      this.#updateSpeech(job, "failed", "生成失败");
      const code = cause instanceof SpeechToolError || cause instanceof ProjectLifecycleError
        ? cause.code : "SPEECH_GENERATION_FAILED";
      job.error = {
        code,
        message: cause instanceof Error ? cause.message : "Speech 生成失败。",
        retryable: !["TTS_AUTH_FAILED", "TTS_RESPONSE_INVALID", "TTS_AUDIO_INVALID"].includes(code),
      };
    } finally {
      job.controller = undefined;
      job.credential = "";
      if (["succeeded", "cancelled", "failed", "rejected"].includes(job.status)) {
        const expiration = setTimeout(() => this.#speechJobs.delete(job.id), 5 * 60_000);
        expiration.unref();
      }
    }
  }

  async dispose(): Promise<void> {
    for (const job of this.#speechJobs.values()) {
      if (!["succeeded", "cancelled", "failed", "rejected"].includes(job.status)) this.cancelSpeech(job.id);
    }
    this.#credentials.clear();
    this.#speechJobs.clear();
    const opened = this.#opened;
    this.#opened = null;
    if (opened !== null) await opened.release();
  }
}

function lifecycleFailure(error: ProjectLifecycleError | ProjectInspectionError): ToolResult {
  return {
    isError: true,
    structuredContent: {
      status: "invalid",
      connection: launcherConnectionState(),
      error: {
        code: error.code,
        path: error.path,
        message: error.message,
        ...(error instanceof ProjectInspectionError
          ? { diagnostics: diagnosticSummary(error.diagnostics) }
          : {}),
      },
    },
    content: [{ type: "text", text: `Narracut 项目操作失败：${error.message}` }],
  };
}

async function callTool(
  params: unknown,
  hostValidation: AgentHostValidationService,
  workspace: ProjectWorkspaceSession,
): Promise<ToolResult> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error("tools/call 缺少参数。");
  }
  const { name, arguments: argumentsValue } = params as { name?: unknown; arguments?: unknown };
  if (name === "health_check") {
    return {
      structuredContent: { status: "connected", server: "narracut", readOnly: false },
      content: [{ type: "text", text: "Narracut 插件已连接；可原子创建、严格打开 Project VNext，并在表格工作区编辑 Scene。" }],
    };
  }
  if (name === "show_launcher") {
    return {
      structuredContent: { status: "launcher", connection: launcherConnectionState() },
      content: [{ type: "text", text: "Narracut 项目启动器已打开；请选择父目录创建项目，或选择现有 Project VNext 打开。" }],
    };
  }
  if (name === "create_project" || name === "open_project") {
    const projectDirectory = stringArgument(argumentsValue, "projectDirectory");
    if (projectDirectory === null || !isAbsolute(projectDirectory)) {
      return {
        isError: true,
        structuredContent: {
          status: "invalid",
          connection: launcherConnectionState(),
          error: { code: "INVALID_TOOL_INPUT", message: "projectDirectory 必须是绝对目录路径。" },
        },
        content: [{ type: "text", text: "无法操作项目：projectDirectory 必须是绝对目录路径。" }],
      };
    }
    let createdProject = false;
    try {
      let operation: "created" | "opened";
      if (name === "create_project") {
        const confirmTemporaryCleanup = typeof argumentsValue === "object" &&
          argumentsValue !== null &&
          !Array.isArray(argumentsValue) &&
          (argumentsValue as { confirmTemporaryCleanup?: unknown }).confirmTemporaryCleanup === true;
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
          text: operation === "created"
            ? `${basename(inspection.projectDirectory)} 已原子创建并打开，共 0 个 Scene。`
            : `${basename(inspection.projectDirectory)} 已严格校验并打开。`,
        }],
      };
    } catch (error) {
      if (createdProject) {
        const causeCode = error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError
          ? error.code
          : "PROJECT_OPEN_FAILED";
        return {
          isError: true,
          structuredContent: {
            status: "created-not-opened",
            connection: launcherConnectionState(),
            project: { directory: projectDirectory, folderName: basename(projectDirectory) },
            error: {
              code: "PROJECT_CREATED_NOT_OPENED",
              causeCode,
              path: projectDirectory,
              message: "项目已经完整创建，但暂时无法取得工作区租约。请使用“打开项目”重试；不要再次创建。",
            },
          },
          content: [{
            type: "text",
            text: `项目已经创建在 ${projectDirectory}，但尚未打开（${causeCode}）。`,
          }],
        };
      }
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        return lifecycleFailure(error);
      }
      throw error;
    }
  }
  if (name === "save_project_scenes") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: {
          status: "save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "保存参数必须是对象。" },
        },
        content: [{ type: "text", text: "无法保存 Scene：保存参数无效。" }],
      };
    }
    const input = argumentsValue as Record<string, unknown>;
    if (
      typeof input.projectDirectory !== "string" || !isAbsolute(input.projectDirectory) ||
      typeof input.projectId !== "string" ||
      typeof input.baselineRevision !== "string" ||
      !("project" in input)
    ) {
      return {
        isError: true,
        structuredContent: {
          status: "save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "项目身份、基线或 Project DSL 无效。" },
        },
        content: [{ type: "text", text: "无法保存 Scene：项目身份、基线或 Project DSL 无效。" }],
      };
    }
    try {
      const inspection = await workspace.save({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        project: input.project,
      });
      return {
        structuredContent: { ...workspace.serialize(inspection), status: "saved" },
        content: [{ type: "text", text: `已原子保存 ${inspection.project.scenes.length} 个 Scene。` }],
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const status = error instanceof ProjectLifecycleError && error.code === "PROJECT_SAVE_CONFLICT"
          ? "save-conflict"
          : error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST"
            ? "identity-lost"
            : "save-failed";
        const failure = lifecycleFailure(error);
        return {
          ...failure,
          structuredContent: {
            ...failure.structuredContent,
            status,
            connection: connectedState(false),
          },
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
          error: { code: "INVALID_TOOL_INPUT", message: "导入参数必须是对象。" },
        },
        content: [{ type: "text", text: "无法导入 Asset：导入参数无效。" }],
      };
    }
    const input = argumentsValue as Record<string, unknown>;
    if (
      typeof input.projectDirectory !== "string" || !isAbsolute(input.projectDirectory) ||
      typeof input.projectId !== "string" ||
      typeof input.baselineRevision !== "string" ||
      typeof input.sourcePath !== "string" || !isAbsolute(input.sourcePath) ||
      (input.targetSceneId !== undefined && typeof input.targetSceneId !== "string")
    ) {
      return {
        isError: true,
        structuredContent: {
          status: "asset-import-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "项目身份、基线或导入源无效。" },
        },
        content: [{ type: "text", text: "无法导入 Asset：项目身份、基线或导入源无效。" }],
      };
    }
    try {
      const imported = await workspace.importAsset({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        sourcePath: input.sourcePath,
        ...(typeof input.targetSceneId === "string" ? { targetSceneId: input.targetSceneId } : {}),
      });
      const { inspection, ...assetImport } = imported;
      return {
        structuredContent: {
          ...workspace.serialize(inspection),
          status: imported.status.startsWith("imported-") ? "asset-imported" : "asset-import-result",
          assetImport,
        },
        content: [{ type: "text", text: imported.message }],
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const failure = lifecycleFailure(error);
        return {
          ...failure,
          structuredContent: {
            ...failure.structuredContent,
            status: error instanceof ProjectLifecycleError && error.code === "PROJECT_SAVE_CONFLICT"
              ? "save-conflict"
              : error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST"
                ? "identity-lost"
                : "asset-import-failed",
            connection: connectedState(false),
          },
        };
      }
      throw error;
    }
  }
  if (name === "read_project_asset_preview") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: { assetPreview: { status: "dangling", id: "", reason: "预览参数无效。" } },
        content: [{ type: "text", text: "无法读取 Asset 预览：参数无效。" }],
      };
    }
    const input = argumentsValue as Record<string, unknown>;
    if (
      typeof input.projectDirectory !== "string" || !isAbsolute(input.projectDirectory) ||
      typeof input.projectId !== "string" || typeof input.assetId !== "string"
    ) {
      return {
        isError: true,
        structuredContent: { assetPreview: { status: "dangling", id: "", reason: "项目身份或 Asset ID 无效。" } },
        content: [{ type: "text", text: "无法读取 Asset 预览：项目身份或 Asset ID 无效。" }],
      };
    }
    try {
      const assetPreview = await workspace.readAssetPreview({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        assetId: input.assetId,
      });
      return {
        structuredContent: { assetPreview },
        content: [{
          type: "text",
          text: assetPreview.status === "available"
            ? `${assetPreview.filename} 已完成只读检查。`
            : assetPreview.reason,
        }],
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST") {
        return {
          isError: true,
          structuredContent: {
            status: "identity-lost",
            error: { code: error.code, path: error.path, message: error.message },
          },
          content: [{ type: "text", text: `无法读取 Asset 预览：${error.message}` }],
        };
      }
      throw error;
    }
  }
  if (name === "save_project_tts_settings") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: { status: "tts-save-failed", error: { code: "INVALID_TOOL_INPUT", message: "TTS 保存参数必须是对象。" } },
        content: [{ type: "text", text: "无法保存 TTS 配置：参数无效。" }],
      };
    }
    const input = argumentsValue as Record<string, unknown>;
    if (
      typeof input.projectDirectory !== "string" || !isAbsolute(input.projectDirectory) ||
      typeof input.projectId !== "string" || typeof input.baselineRevision !== "string" ||
      typeof input.config !== "object" || input.config === null ||
      !["keep", "replace", "clear"].includes(String(input.credentialAction)) ||
      !Number.isSafeInteger(input.expectedAffectedSpeechCount) || Number(input.expectedAffectedSpeechCount) < 0 ||
      (input.apiKey !== undefined && typeof input.apiKey !== "string")
    ) {
      return {
        isError: true,
        structuredContent: { status: "tts-save-failed", error: { code: "INVALID_TOOL_INPUT", message: "项目身份、配置或凭据操作无效。" } },
        content: [{ type: "text", text: "无法保存 TTS 配置：项目身份、配置或凭据操作无效。" }],
      };
    }
    try {
      const saved = await workspace.saveTtsSettings({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        config: input.config as ProjectTtsConfig,
        credentialAction: input.credentialAction as "keep" | "replace" | "clear",
        expectedAffectedSpeechCount: input.expectedAffectedSpeechCount as number,
        ...(typeof input.apiKey === "string" ? { apiKey: input.apiKey } : {}),
      });
      return {
        structuredContent: {
          ...workspace.serialize(saved.inspection),
          status: "tts-saved",
          affectedSpeechCount: saved.affectedSpeechCount,
        },
        content: [{ type: "text", text: saved.affectedSpeechCount > 0
          ? `TTS 配置已保存，并移除 ${saved.affectedSpeechCount} 条不再匹配的 Speech 记录。`
          : "TTS 配置已保存；现有 Speech 仍与配置匹配。" }],
      };
    } catch (error) {
      if (error instanceof ProjectTtsConfirmationError) {
        return {
          isError: true,
          structuredContent: {
            status: "tts-confirmation-required",
            affectedSpeechCount: error.affectedSpeechCount,
            error: { code: error.code, message: error.message },
          },
          content: [{ type: "text", text: error.message }],
        };
      }
      const code = error instanceof SpeechToolError
        ? error.code
        : error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError
          ? error.code : "TTS_SAVE_FAILED";
      return {
        isError: true,
        structuredContent: {
          status: code === "PROJECT_SAVE_CONFLICT" ? "save-conflict" : code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "tts-save-failed",
          error: { code, message: error instanceof Error ? error.message : "无法保存 TTS 配置。" },
        },
        content: [{ type: "text", text: `无法保存 TTS 配置：${error instanceof Error ? error.message : "未知错误"}` }],
      };
    }
  }
  if (name === "start_scene_speech") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: { status: "speech-start-failed", error: { code: "INVALID_TOOL_INPUT", message: "Speech 参数必须是对象。" } },
        content: [{ type: "text", text: "无法开始 Speech 生成：参数无效。" }],
      };
    }
    const input = argumentsValue as Record<string, unknown>;
    if (
      typeof input.projectDirectory !== "string" || !isAbsolute(input.projectDirectory) ||
      typeof input.projectId !== "string" || typeof input.sceneId !== "string"
    ) {
      return {
        isError: true,
        structuredContent: { status: "speech-start-failed", error: { code: "INVALID_TOOL_INPUT", message: "项目身份或 Scene ID 无效。" } },
        content: [{ type: "text", text: "无法开始 Speech 生成：项目身份或 Scene ID 无效。" }],
      };
    }
    try {
      const speechJob = workspace.startSpeech({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        sceneId: input.sceneId,
      });
      return {
        structuredContent: { status: "speech-started", speechJob },
        content: [{ type: "text", text: "Speech 生成已排队。" }],
      };
    } catch (error) {
      const code = error instanceof SpeechToolError
        ? error.code
        : error instanceof ProjectLifecycleError ? error.code : "SPEECH_START_FAILED";
      return {
        isError: true,
        structuredContent: { status: "speech-start-failed", error: { code, message: error instanceof Error ? error.message : "无法开始 Speech 生成。" } },
        content: [{ type: "text", text: `无法开始 Speech 生成：${error instanceof Error ? error.message : "未知错误"}` }],
      };
    }
  }
  if (name === "get_scene_speech_job" || name === "cancel_scene_speech_job") {
    const jobId = stringArgument(argumentsValue, "jobId");
    if (jobId === null) {
      return {
        isError: true,
        structuredContent: { status: "speech-job-failed", error: { code: "INVALID_TOOL_INPUT", message: "jobId 不能为空。" } },
        content: [{ type: "text", text: "无法读取 Speech 任务：jobId 不能为空。" }],
      };
    }
    try {
      if (name === "cancel_scene_speech_job") {
        const speechJob = workspace.cancelSpeech(jobId);
        const cancelled = speechJob.status === "cancelled";
        return {
          structuredContent: { status: cancelled ? "speech-cancelled" : "speech-commit-in-progress", speechJob },
          content: [{ type: "text", text: cancelled
            ? "Speech 生成已取消；既有 Speech 保持不变。"
            : "Speech 已越过提交点，无法取消；Narracut 将完成当前原子提交。" }],
        };
      }
      const current = workspace.getSpeech(jobId);
      return {
        structuredContent: {
          status: "speech-job",
          speechJob: current.job,
          ...(current.inspection === undefined ? {} : workspace.serialize(current.inspection)),
        },
        content: [{ type: "text", text: `Speech 任务状态：${current.job.status}。` }],
      };
    } catch (error) {
      return {
        isError: true,
        structuredContent: { status: "speech-job-failed", error: { code: error instanceof SpeechToolError ? error.code : "SPEECH_JOB_FAILED", message: error instanceof Error ? error.message : "无法读取 Speech 任务。" } },
        content: [{ type: "text", text: `无法读取 Speech 任务：${error instanceof Error ? error.message : "未知错误"}` }],
      };
    }
  }
  if (name === "inspect_project") return inspectProject(argumentsValue);
  if (name === "start_agent_host_validation") {
    const projectDirectory = stringArgument(argumentsValue, "projectDirectory");
    if (projectDirectory === null || !isAbsolute(projectDirectory)) {
      return {
        isError: true,
        structuredContent: {
          error: { code: "INVALID_TOOL_INPUT", message: "projectDirectory 必须是绝对目录路径。" },
        },
        content: [{ type: "text", text: "无法开始宿主验证：projectDirectory 必须是绝对目录路径。" }],
      };
    }
    try {
      const inspection = await inspectProjectVNext(projectDirectory);
      const state = await hostValidation.start({
        projectDirectory: inspection.projectDirectory,
        projectId: inspection.manifest.projectId,
        sceneCount: inspection.project.scenes.length,
      });
      return hostValidationResult(
        state as unknown as Record<string, unknown>,
        state.status === "running"
          ? "Codex 创作线程验证已开始；项目保持只读。"
          : "Codex 宿主当前不可用；验证已停止，可稍后继续。",
      );
    } catch (error) {
      if (error instanceof ProjectInspectionError) {
        return {
          isError: true,
          structuredContent: {
            error: { code: error.code, message: error.message },
          },
          content: [{ type: "text", text: `无法开始宿主验证：${error.message}` }],
        };
      }
      throw error;
    }
  }
  if (
    name === "get_agent_host_validation" ||
    name === "stop_agent_host_validation" ||
    name === "continue_agent_host_validation"
  ) {
    const taskId = stringArgument(argumentsValue, "taskId");
    if (taskId === null) {
      return {
        isError: true,
        structuredContent: { error: { code: "INVALID_TOOL_INPUT", message: "taskId 不能为空。" } },
        content: [{ type: "text", text: "无法操作宿主验证：taskId 不能为空。" }],
      };
    }
    const state = name === "get_agent_host_validation"
      ? hostValidation.get(taskId)
      : name === "stop_agent_host_validation"
        ? await hostValidation.stop(taskId)
        : await hostValidation.continue(taskId);
    return hostValidationResult(
      state as unknown as Record<string, unknown>,
      `Codex 创作线程验证状态：${state.status}。`,
    );
  }
  throw new Error(`未知工具：${String(name)}`);
}

export type NarracutRequestHandler = ((request: JsonRpcRequest) => Promise<unknown>) & {
  dispose: () => Promise<void>;
};

export function createNarracutRequestHandler(
  options: {
    codexHost?: CodexHostAdapter;
    ttsFetch?: typeof fetch;
    probeSpeechDurationMs?: (path: string) => Promise<number>;
  } = {},
): NarracutRequestHandler {
  const hostValidation = new AgentHostValidationService(
    options.codexHost ?? new CodexAppServerHost(),
  );
  const workspace = new ProjectWorkspaceSession({
    ttsFetch: options.ttsFetch,
    probeSpeechDurationMs: options.probeSpeechDurationMs,
  });
  const requestHandler = async (request: JsonRpcRequest): Promise<unknown> => {
    switch (request.method) {
    case "initialize": {
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "narracut", version: SERVER_VERSION },
        instructions: "只接触用户通过系统文件夹选择窗口或参数明确给出的目录。可以在不存在的目标原子创建 Project VNext，或严格打开有效项目；表格工作区只修改 Scene 与 Narration，Agent 工作区保持只读并可运行固定的 Codex 创作线程宿主验证。",
      };
    }
    case "ping": return {};
    case "tools/list": return { tools };
    case "tools/call": return callTool(request.params, hostValidation, workspace);
    case "resources/list": return {
      resources: [{
        uri: WORKBENCH_URI,
        name: "Narracut 工作台",
        description: "Project VNext 启动器、可编辑 Scene 接触表与只读 Agent 工作区",
        mimeType: "text/html;profile=mcp-app",
      }],
    };
    case "resources/read": {
      const uri = typeof request.params === "object" && request.params !== null
        ? (request.params as { uri?: unknown }).uri
        : undefined;
      if (uri !== WORKBENCH_URI) throw new Error(`未知资源：${String(uri)}`);
      return {
        contents: [{
          uri: WORKBENCH_URI,
          mimeType: "text/html;profile=mcp-app",
          text: await loadWorkbench(),
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] },
            },
          },
        }],
      };
    }
      default: throw new Error(`不支持的方法：${request.method}`);
    }
  };
  return Object.assign(requestHandler, {
    dispose: async () => {
      await workspace.dispose();
      await hostValidation.dispose();
    },
  });
}

export const handleRequest = createNarracutRequestHandler();

function writeMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleLine(line: string, requestHandler: NarracutRequestHandler): Promise<void> {
  if (line.trim() === "") return;
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    writeMessage({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (request.id === undefined) return;
  try {
    writeMessage({ jsonrpc: "2.0", id: request.id, result: await requestHandler(request) });
  } catch (error) {
    writeMessage({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" },
    });
  }
}

export async function startStdioServer(
  requestHandler: NarracutRequestHandler = handleRequest,
): Promise<void> {
  let inputBuffer = "";
  process.stdin.setEncoding("utf8");
  const keepAlive = setInterval(() => undefined, 60_000);
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

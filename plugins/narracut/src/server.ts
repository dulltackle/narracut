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
  type OpenedProjectVNext,
} from "../../../src/server/project-lifecycle";
import { readProjectAssetPreview } from "../../../src/server/project-asset-preview";

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
): Record<string, unknown> {
  const assets = new Map(inspection.project.assets.map((asset) => [asset.id, asset]));
  return {
    status: "valid",
    connection: connectedState(!writable),
    writable,
    projectRevision: inspection.projectRevision,
    projectDsl: inspection.project,
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
      speech: scene.speech === undefined
        ? { status: "missing" }
        : { status: "available", durationMs: scene.speech.durationMs },
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

class ProjectWorkspaceSession {
  #opened: OpenedProjectVNext | null = null;

  async open(projectDirectory: string): Promise<ProjectVNextInspection> {
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

  async dispose(): Promise<void> {
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
        structuredContent: { ...serializeInspection(inspection, true), operation },
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
        structuredContent: { ...serializeInspection(inspection, true), status: "saved" },
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
          ...serializeInspection(inspection, true),
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
  options: { codexHost?: CodexHostAdapter } = {},
): NarracutRequestHandler {
  const hostValidation = new AgentHostValidationService(
    options.codexHost ?? new CodexAppServerHost(),
  );
  const workspace = new ProjectWorkspaceSession();
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

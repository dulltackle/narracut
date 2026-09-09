import { RecoveryExportUncertain, RecoveryExports, type RecoveryCut, type RecoveryDraft } from '../../../src/server/project-recovery';
import { changeProjectIdentity } from '../../../src/server/project-identity';
import { copyProjectVNext } from '../../../src/server/project-copy';
import { CreationTask } from './creation-task';
import { ProjectAcceptance } from '../../../src/server/project-acceptance';
import { ProjectRender } from '../../../src/server/project-render';
import { ProjectDelivery } from '../../../src/server/project-delivery';
import { ProjectChecks } from '../../../src/server/project-checks';
import { ProjectPreview } from '../../../src/server/project-preview';
import { DependencyError } from '../../../src/server/project-dependencies';
import { CandidateError, type CandidateRequest, type CandidateStatus } from "../../../src/server/project-candidate";
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
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }>;
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
  { name: 'project_recovery', title: '项目恢复快照', description: '核对项目身份、封存未保存编辑并在项目外导出恢复快照。', inputSchema: { type: 'object', required: ['action', 'projectDirectory', 'projectId'], additionalProperties: false, properties: { action: { enum: ['check', 'seal', 'export', 'status', 'leave'] }, projectDirectory: { type: 'string' }, projectId: { type: 'string' }, draft: { type: 'object', additionalProperties: false, properties: { dsl: { type: 'string' }, briefLocal: { type: 'string' }, briefBase: { type: 'string' } } }, target: { type: 'string' }, operationId: { type: 'string' } } }, outputSchema: { type: 'object' }, annotations: taskToolAnnotations, _meta: { ui: { visibility: ['app'] } } },
  { name: 'copy_project', title: '复制项目', description: '安全停止并关闭来源，完整复制后打开独立副本；可查询阶段和在发布前取消。', inputSchema: { type: 'object', required: ['action'], additionalProperties: false, properties: { action: { enum: ['start', 'status', 'cancel'] }, projectDirectory: { type: 'string' }, projectId: { type: 'string' }, targetDirectory: { type: 'string' }, operationId: { type: 'string' }, confirmTemporaryCleanup: { type: 'boolean' } } }, outputSchema: { type: 'object' }, annotations: taskToolAnnotations, _meta: { ui: { visibility: ['app'] } } },
  { name: 'respond_creation_task', description: '用户处理同一任务的消息、Scene 待办与 Brief 审核。', inputSchema: { type: 'object', additionalProperties: false, required: ['projectDirectory', 'projectId', 'action'], properties: { projectDirectory: { type: 'string' }, projectId: { type: 'string' }, action: { enum: ['message','confirm-message','discuss-message','edit-message','accept-brief','ack-brief','reject-brief','regenerate-brief','continue','stop','takeover','approve-tool','reject-tool'] }, id: { type: 'string' }, baseline: { type: 'string' }, parentOrigin: { type: 'string' }, instruction: { type: 'string', maxLength: 4000 } } }, outputSchema: { type: 'object' }, annotations: taskToolAnnotations, _meta: { ui: { visibility: ['app'] } } },
  { name: 'start_creation_task', description: '从 Composer 原文发起专用创作任务；只修改候选，不自动接受。', inputSchema: { type: 'object', additionalProperties: false, required: ['projectDirectory', 'projectId', 'instruction'], properties: { projectDirectory: { type: 'string' }, projectId: { type: 'string' }, instruction: { type: 'string', minLength: 1, maxLength: 4000 }, parentOrigin: { type: 'string' } } }, outputSchema: { type: 'object' }, annotations: taskToolAnnotations, _meta: { ui: { visibility: ['app'] } } },
  { name: 'get_creation_task', description: '读取当前单项创作任务。', inputSchema: { type: 'object', additionalProperties: false, required: ['projectDirectory', 'projectId'], properties: { projectDirectory: { type: 'string' }, projectId: { type: 'string' } } }, outputSchema: { type: 'object' }, annotations: { ...taskToolAnnotations, readOnlyHint: true }, _meta: { ui: { visibility: ['app'] } } },
  { name: 'continue_creation_task', description: '明确基于当前外部候选继续同一任务。', inputSchema: { type: 'object', additionalProperties: false, required: ['projectDirectory', 'projectId', 'baseline'], properties: { projectDirectory: { type: 'string' }, projectId: { type: 'string' }, baseline: { type: 'string' } } }, outputSchema: { type: 'object' }, annotations: { ...taskToolAnnotations, readOnlyHint: false }, _meta: { ui: { visibility: ['app'] } } },
  {
    name: 'project_render', title: '最终 Render',
    description: '仅供用户工作台：从当前已接受完整状态准备、启动、查询或取消最终 Render；复用同一 Bundle，不覆盖输出文件。',
    inputSchema: { type: 'object', required: ['projectDirectory', 'projectId', 'action'], additionalProperties: false, properties: {
      projectDirectory: { type: 'string' }, projectId: { type: 'string' }, action: { enum: ['status', 'start', 'result', 'cancel'] },
      requestId: { type: 'string' }, key: { type: 'string' }, outputPath: { type: 'string' }, jobId: { type: 'string' },
    } }, outputSchema: { type: 'object' }, annotations: taskToolAnnotations, _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: "project_acceptance", title: "接受完整候选与查看修订历史",
    description: "仅供用户工作台：审阅、明确接受完整候选、核对提交结果、重试清理和从有效历史创建候选；不直接回退当前指针。",
    inputSchema: { type: "object", required: ["projectDirectory", "projectId", "action"], additionalProperties: false, properties: { projectDirectory: { type: "string" }, projectId: { type: "string" }, action: { enum: ["review", "accept", "result", "cleanup", "history", "from-history"] }, key: { type: "string" }, baseline: { type: "string" }, currentRevision: { type: "string" }, requestId: { type: "string" }, confirmed: { type: "boolean" }, revisionId: { type: "string" } } },
    outputSchema: { type: "object" }, annotations: taskToolAnnotations, _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "project_delivery_display", title: "确认交付警告已完整展示",
    description: "仅供工作台在完整展开当前报告及检查批次警告后确认展示，不表示用户观看或接受。",
    inputSchema: { type: "object", required: ["projectDirectory","projectId","deliveryId","reportRevision","batchId","warningsKey"], additionalProperties: false, properties: { projectDirectory: { type: "string" }, projectId: { type: "string" }, deliveryId: { type: "string" }, reportRevision: { type: "integer" }, batchId: { type: "string" }, warningsKey: { type: "string" } } },
    outputSchema: { type: "object" }, annotations: taskToolAnnotations, _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "project_delivery", title: "采集代表帧并交付候选",
    description: "基于准确候选 Preview 采集完整计划；image 读取图像，review 单独提交该帧摘要与观察，describe 提交目标、摘要、全部警告与不可执行 Scene 建议。prepare 支持 Transition/运动补点；状态刷新与重试不操作用户播放器。不提供审美评分，不接受候选。",
    inputSchema: { type: "object", required: ["projectDirectory", "projectId", "action"], additionalProperties: false, properties: {
      projectDirectory: { type: "string" }, projectId: { type: "string" }, action: { enum: ["prepare","status","retry","image","review","describe"] },
      instanceId: { type: "string" }, deliveryId: { type: "string" }, frame: { type: "integer", minimum: 0 }, batchId: { type: "string" }, reportRevision: { type: "integer" },
      supplements: { type: "array", maxItems: 1000, items: { type: "object", required: ["frame","source","reason"], properties: { frame: { type: "integer", minimum: 0 }, source: { enum: ["transition","motion"] }, reason: { type: "string" } } } },
      reviews: { type: "array", maxItems: 12, items: { type: "object", required: ["frame","digest","observation"], properties: { frame: { type: "integer" }, digest: { type: "string" }, observation: { type: "string" } } } },
      report: { type: "object", required: ["goal","summary","warnings","suggestions"], properties: { goal: { type: "string" }, summary: { type: "string" }, warnings: { type: "array", items: { type: "string" } }, suggestions: { type: "array", items: { type: "object", required: ["sceneId","observation","action","content","reason"], properties: { sceneId: { type: "string" }, observation: { type: "string" }, action: { type: "string" }, content: { type: "string" }, reason: { type: "string" } } } } } },
    } }, outputSchema: { type: "object" }, annotations: taskToolAnnotations,
  },
  {
    name: "project_checks", title: "检查候选与操作门禁",
    description: "检查当前候选、读取具名批次或取消检查；不接受候选，不替换 Preview。",
    inputSchema: { type: "object", required: ["projectDirectory", "projectId", "action"], additionalProperties: false,
      properties: { projectDirectory: { type: "string" }, projectId: { type: "string" }, action: { enum: ["start", "status", "cancel"] }, batchId: { type: "string" } } },
    outputSchema: { type: "object" }, annotations: readOnlyToolAnnotations, _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "project_preview", title: "构建与检查只读成片 Preview",
    description: "只读构建当前或候选的不可变 Preview，或核对既有实例新鲜度。不接受候选、不写 Scene。",
    inputSchema: { type: "object", required: ["projectDirectory", "projectId", "action"], additionalProperties: false,
      properties: { projectDirectory: { type: "string" }, projectId: { type: "string" }, action: { enum: ["build", "status", "release"] }, target: { enum: ["current", "candidate"] }, parentOrigin: { type: "string" }, instanceId: { type: "string" } } },
    outputSchema: { type: "object" }, annotations: readOnlyToolAnnotations, _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "coordinate_project_dependencies",
    title: "协调候选精确依赖",
    description: "唯一允许修改候选依赖声明、pnpm 锁图与项目离线依赖库的操作。提供精确版本和 SHA-512 摘要，传递依赖也必须由已有锁图或 packages 显式固定。只从固定公共 npm registry 下载并验证，不执行包代码或脚本；失败保留原候选和离线库。",
    inputSchema: {
      type: "object", required: ["projectDirectory", "projectId", "baseline", "dependencies", "packages"], additionalProperties: false,
      properties: {
        projectDirectory: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 }, baseline: { type: "string" },
        dependencies: { type: "object", additionalProperties: { type: "string" } },
        packages: { type: "array", maxItems: 256, items: {
          type: "object", required: ["name", "version", "integrity"], additionalProperties: false,
          properties: { name: { type: "string" }, version: { type: "string" }, integrity: { type: "string" } },
        } },
      },
    },
    outputSchema: { type: "object" },
    annotations: { ...taskToolAnnotations, openWorldHint: true },
  },
  {
    name: "manage_project_candidate",
    title: "管理唯一候选 Render Program",
    description: "在当前项目租约内读取、显式创建、原子修改或确认放弃唯一候选。apply 使用读取所得 baseline；changes 只修改 program.json、src/ 和 resources/，不执行代码、不修改依赖或当前修订。",
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
          type: "object", required: ["path", "content"], additionalProperties: false,
          properties: { path: { type: "string" }, content: { type: ["string", "null"] } },
        } },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: { ...taskToolAnnotations, destructiveHint: true },
  },
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
      properties: { projectDirectory: { type: "string", minLength: 1 }, identityChoice: { enum: ["current", "selected", "convert", "cancel"] } },
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
    name: "save_project_video_brief",
    title: "保存 Video Brief",
    description: "仅供 Narracut 工作台 app 使用：按独立 Brief ETag 原子保存完整 video.md，不覆盖外部变化。",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "baselineRevision", "content"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        baselineRevision: { type: "string", minLength: 1 },
        content: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    annotations: taskToolAnnotations,
    _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "export_project_video_brief_local",
    title: "导出 Video Brief LOCAL",
    description: "仅供 Narracut 工作台 app 使用：把冲突中的 Brief LOCAL 导出到项目外的新文件，不覆盖已有文件。",
    inputSchema: {
      type: "object",
      required: ["projectDirectory", "projectId", "targetDirectory", "content"],
      properties: {
        projectDirectory: { type: "string", minLength: 1 },
        projectId: { type: "string", minLength: 1 },
        targetDirectory: { type: "string", minLength: 1 },
        content: { type: "string" },
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
    videoBrief: {
      content: inspection.videoBrief,
      revision: inspection.videoBriefRevision,
      bytes: Buffer.byteLength(inspection.videoBrief, "utf8"),
      state: inspection.videoBrief.length === 0 ? "empty" : "saved",
    },
    ...(inspection.currentRenderProgram === undefined
      ? {}
      : { currentRenderProgram: inspection.currentRenderProgram }),
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
  const [html, script, paperTexture, filmTexture, displayFont, previewScript, checksScript, deliveryScript, acceptanceScript, renderScript] = await Promise.all([
    readFile(WORKBENCH_PATH, "utf8"),
    readFile(WORKBENCH_SCRIPT_PATH, "utf8"),
    readFile(PAPER_TEXTURE_PATH),
    readFile(FILM_TEXTURE_PATH),
    readFile(DISPLAY_FONT_PATH),
    readFile(new URL(import.meta.url.endsWith("/server.mjs") ? "./workbench-preview.js" : "../workbench-preview.js", import.meta.url), "utf8"),
    readFile(new URL(import.meta.url.endsWith("/server.mjs") ? "./workbench-checks.js" : "../workbench-checks.js", import.meta.url), "utf8"),
    readFile(new URL(import.meta.url.endsWith("/server.mjs") ? "./workbench-delivery.js" : "../workbench-delivery.js", import.meta.url), "utf8"),
    readFile(new URL(import.meta.url.endsWith("/server.mjs") ? "./workbench-acceptance.js" : "../workbench-acceptance.js", import.meta.url), "utf8"),
    readFile(new URL(import.meta.url.endsWith('/server.mjs') ? './workbench-render.js' : '../workbench-render.js', import.meta.url), 'utf8'),
  ]);
  const materialVariables = `@font-face{font-family:"Narracut Display";src:url("data:font/woff2;base64,${displayFont.toString("base64")}") format("woff2");font-style:normal;font-weight:100 800;font-stretch:75% 100%;font-display:block}:root{--paper-texture:url("data:image/webp;base64,${paperTexture.toString("base64")}");--film-texture:url("data:image/webp;base64,${filmTexture.toString("base64")}")}`;
  return html
    .replace("/*__NARRACUT_MATERIALS__*/", materialVariables)
    .replace("/*__NARRACUT_WORKBENCH_JS__*/", previewScript + "\n" + checksScript + "\n" + deliveryScript + "\n" + acceptanceScript + "\n" + renderScript + "\n" + script);
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
  #recoveryCut: RecoveryCut | null = null;
  #recoveryExports = new RecoveryExports();
  async checkIdentity() {
    if (!this.#opened || this.#transferred || this.#handoffPending) return;
    try { await this.#opened.assertWritable(); }
    catch (error) {
      void this.creation?.close().catch(() => undefined); void this.render.close().catch(() => undefined);
      for (const job of this.#speechJobs.values()) if (!['succeeded', 'cancelled', 'failed', 'rejected'].includes(job.status)) this.cancelSpeech(job.id);
      throw error;
    }
  }
  async recoveryOperation(input: any) {
    // 恢复只读取旧会话的内存；正常转移撤销旧租约后也必须能抢救和离开。
    const opened = this.#opened;
    if (!opened || opened.inspection.projectDirectory !== input.projectDirectory || opened.inspection.manifest.projectId !== input.projectId) throw new Error('恢复请求与原项目身份不匹配。');
    if (input.action === 'check') {
      try { await this.checkIdentity(); return { status: 'valid' }; }
      catch (error) { return { status: 'identity-lost', error: { code: 'PROJECT_IDENTITY_LOST', message: (error as Error).message } }; }
    }
    if (input.action === 'seal') {
      // 未发生身份失效时不能借恢复接口撤销一个健康项目的写权。
      try { await opened.assertWritable(); } catch { /* 失效或已转移的旧租约仍允许封存与项目外导出。 */ }
      if (!opened.identityLost) throw new Error('当前项目身份有效。');
      const draft = input.draft as RecoveryDraft;
      if (!draft || Object.entries(draft).some(([key, value]) => !['dsl', 'briefLocal', 'briefBase'].includes(key) || typeof value !== 'string')) throw new Error('恢复编辑内容无效。');
      this.#recoveryCut = await opened.freezeRecovery(draft);
      return { status: 'sealed', cut: this.#recoveryCut };
    }
    if (!opened.identityLost) throw new Error('当前项目没有身份阻断。');
    if (input.action === 'leave') { await this.creation?.close(); await opened.release(); this.#opened = null; return { status: 'launcher', connection: launcherConnectionState() }; }
    if (!this.#recoveryCut) throw new Error('没有已封存的未保存 Scene 或 Brief 改动。');
    if (input.action === 'export') return { status: 'exported', ...await this.#recoveryExports.run(this.#recoveryCut, input.target, input.operationId, opened.recoveryRootIdentity) };
    if (input.action === 'status') return { status: 'exported', ...await this.#recoveryExports.status(input.operationId) };
    throw new Error('未知恢复操作。');
  }

  static identityQueue: Promise<unknown> = Promise.resolve();
  #choosingIdentity = false;
  static readonly sessions = new Set<ProjectWorkspaceSession>();
  #copy: { operationId: string; status: string; phase: string; sourceDirectory: string; targetDirectory: string; sourceClosed: boolean; cleanupWarning?: { message: string; path: string }; workspace?: Record<string, unknown>; error?: { code: string; message: string; path: string } } | null = null;
  #identityConflict: { projectId: string; currentDirectory: string; selectedDirectory: string } | null = null;
  #copyController: AbortController | null = null;
  #copyPromise: Promise<void> | null = null;
  readonly #speechPending = new Set<Promise<void>>();
  get copying() { return this.#copy?.status === 'running'; }
  async copyOperation(input: any) {
    if (!input || !['start', 'status', 'cancel'].includes(input.action)) throw new Error('复制参数无效。');
    if (input.action !== 'start') {
      if (!this.#copy || input.operationId !== this.#copy.operationId) throw new Error('复制操作不存在。');
      if (input.action === 'cancel' && this.#copy.phase !== 'publishing') this.#copyController?.abort();
      return { ...this.#copy };
    }
    if (input.operationId && this.#copy && this.#copy.operationId === input.operationId) {
      if (this.#copy.sourceDirectory !== input.projectDirectory || this.#copy.targetDirectory !== input.targetDirectory) throw new Error('复制操作 ID 与路径不匹配。');
      return { ...this.#copy };
    }
    if (this.copying || this.#opening || this.#choosingIdentity || this.#resolvingCandidate) throw new Error('项目操作尚未结束。');
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    if (typeof input.targetDirectory !== 'string' || !isAbsolute(input.targetDirectory)) throw new Error('目标必须是绝对路径。');
    this.#copy = { operationId: typeof input.operationId === 'string' && /^[0-9a-f-]{36}$/i.test(input.operationId) ? input.operationId : randomUUID(), status: 'running', phase: 'stopping', sourceDirectory: input.projectDirectory, targetDirectory: input.targetDirectory, sourceClosed: false };
    const operation = this.#copy;
    const controller = this.#copyController = new AbortController();
    this.#copyPromise = (async () => {
      let published = false;
      try {
        operation.phase = 'waiting';
        await Promise.all([...this.pendingOperations]);
        if (this.#requireOpened(input.projectDirectory, input.projectId) !== opened) throw new Error('等待期间来源工作区发生变化。');
        operation.phase = 'stopping';
        if (this.creation?.value && this.creation.value.status !== 'terminated') await this.creation.respond({ action: 'stop' });
        controller.signal.throwIfAborted();
        operation.phase = 'waiting';
        await this.render.close();
        for (const job of this.#speechJobs.values()) if (!['succeeded', 'cancelled', 'failed', 'rejected'].includes(job.status)) this.cancelSpeech(job.id);
        await Promise.all([...this.#speechPending]);
        controller.signal.throwIfAborted();
        operation.phase = 'closing';
        await this.creation?.close();
        await opened.release();
        this.#opened = null; this.creation = null;
        operation.sourceClosed = true;
        this.delivery.clear(); this.checks.clear(); this.preview.clear();
        const copied = await copyProjectVNext(input.projectDirectory, input.targetDirectory, { signal: controller.signal, confirmTemporaryCleanup: input.confirmTemporaryCleanup === true, onPhase: phase => { operation.phase = phase; } });
        operation.cleanupWarning = copied.cleanupWarning;
        operation.phase = 'opening';
        published = true;
        const inspection = await this.#open(input.targetDirectory);
        operation.workspace = this.serialize(inspection);
        operation.status = 'opened';
      } catch (error) {
        operation.status = published ? 'created-not-opened' : controller.signal.aborted && !String((error as any).code).includes('CLEANUP_FAILED') ? 'cancelled' : 'failed';
        operation.error = { code: (error as any).code ?? 'PROJECT_COPY_FAILED', message: (error as Error).message, path: (error as any).path ?? input.targetDirectory };
      }
    })();
    return { ...operation };
  }

  readonly pendingOperations = new Set<Promise<unknown>>();
  #transferred = false;
  #handoffPending = false;
  #opening = false;
  creation: CreationTask | null = null;
  #resolvingCandidate = false;
  creationError: string | null = null;
  async creationOperation(input: any, start = false, resume = false, respond = false) {
    if (!input || typeof input.projectDirectory !== 'string' || typeof input.projectId !== 'string' || start && typeof input.instruction !== 'string') throw new Error('创作任务参数无效。');
    if ((this.#transferred || this.#handoffPending) && !start && !resume && !respond && this.#opened?.inspection.projectDirectory === input.projectDirectory && this.#opened?.inspection.manifest.projectId === input.projectId) return { creationTask: this.creation?.value ?? null, candidate: this.#candidateStatus, creationRecovery: this.creation?.recovery ?? null, transferred: this.#transferred };
    this.#requireOpened(input.projectDirectory, input.projectId);
    if (this.creationError) throw new Error(this.creationError);
    if (!this.creation) throw new Error('创作宿主不可用。');
    if (!respond && input.action !== undefined) throw new Error("当前工具不接受任务写操作");
    if (this.#resolvingCandidate) {
      if (respond || resume || start) throw new Error('正在核对操作结果，请稍候。');
      return { creationTask: this.creation.value, candidate: this.#candidateStatus, creationRecovery: this.creation.recovery };
    }
    const creationTask = respond ? input.action === 'takeover' ? await this.creation.takeover(input.instruction, input.baseline, input.parentOrigin, input.id) : await this.creation.respond(input) : resume ? await this.creation.continueExternal(input.baseline) : start ? await this.creation.start(input.instruction, input.parentOrigin ?? 'null') : await this.creation.status();
    const candidate = await this.candidate({ projectDirectory: input.projectDirectory, projectId: input.projectId, action: 'read' });
    return { creationTask, candidate, creationRecovery: this.creation.recovery };
  }
  preview = new ProjectPreview();
  checks = new ProjectChecks(this.preview);
  delivery = new ProjectDelivery(this.preview, this.checks);
  acceptance = new ProjectAcceptance(this.delivery, this.preview);
  render = new ProjectRender(this.preview);
  async renderOperation(input: any) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    if (input.action === 'status') return this.render.status(opened);
    if (input.action === 'start') return this.render.start(opened, input);
    if (input.action === 'result') return this.render.result(input.requestId);
    if (input.action === 'cancel') return this.render.cancel(input.jobId);
    throw new Error('最终 Render 参数无效。');
  }
  async acceptanceOperation(input: any) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    if (this.creation?.blocksCandidateWrites && !['status', 'history', 'result'].includes(input.action)) throw new Error('创作任务正在运行，请等待候选交付。');
    if (this.#resolvingCandidate) throw new Error('正在核对操作结果，请稍候。');
    this.#resolvingCandidate = true;
    try {
      const result = await this.acceptance.operate(opened, input);
      this.#candidateStatus = await opened.candidate({ action: 'read' });
      if (result.status === 'accepted' && result.revision.current !== false && this.#candidateStatus.status === 'absent') {
        try { await this.creation?.terminate('CANDIDATE_ACCEPTED'); }
        catch { result.taskCleanupPending = true; }
      }
      return { ...result, creationTask: this.creation?.value ?? null };
    } finally { this.#resolvingCandidate = false; }
  }

  async deliveryOperation(input: any) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    return this.delivery.operate(opened, input);
  }
  async checksOperation(input: any) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    if (input.action === "start") return this.checks.start(opened);
    if (input.action === "status") return this.checks.status(opened);
    if (input.action === "cancel" && typeof input.batchId === "string") return this.checks.cancel(input.batchId);
    throw new Error("检查参数无效。");
  }
  async previewOperation(input: any) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    if (input.action === "status") return this.preview.status(opened, input.instanceId);
    if (input.action === "release") { this.preview.release(input.instanceId); return {}; }
    if (input.action !== "build" || !["current", "candidate"].includes(input.target) || typeof input.parentOrigin !== "string") throw new Error("Preview 参数无效。");
    const preview = await this.preview.build(opened, input.target, input.parentOrigin);
    if (this.#opened !== opened) { this.preview.release(preview.instanceId); throw new Error("构建所属项目已关闭，结果已丢弃。"); }
    return { preview };
  }
  #opened: OpenedProjectVNext | null = null;
  #codexHost?: CodexHostAdapter;

  readonly #credentials = new Map<string, string>();
  readonly #speechJobs = new Map<string, InternalSpeechJob>();
  readonly #ttsFetch: typeof fetch;
  readonly #probeSpeechDurationMs: (path: string) => Promise<number>;

  constructor(options: {
    ttsFetch?: typeof fetch;
    codexHost?: CodexHostAdapter;
    probeSpeechDurationMs?: (path: string) => Promise<number>;
  } = {}) {
    ProjectWorkspaceSession.sessions.add(this);
    this.#codexHost = options.codexHost;
    this.#ttsFetch = options.ttsFetch ?? globalThis.fetch;
    this.#probeSpeechDurationMs = options.probeSpeechDurationMs ?? probeSpeechDurationMs;
  }

  credential(projectId: string): TtsCredentialState {
    return credentialState(this.#credentials.get(projectId));
  }

  #candidateStatus: CandidateStatus | null = null;

  serialize(inspection: ProjectVNextInspection, writable = true): Record<string, unknown> {
    return { ...serializeInspection(inspection, writable, this.credential(inspection.manifest.projectId)), candidate: this.#candidateStatus, creationTask: this.creation?.value ?? null, creationError: this.creationError, creationRecovery: this.creation?.recovery ?? null };
  }

  async openWithChoice(projectDirectory: string, choice?: string): Promise<Record<string, unknown>> {
    this.#choosingIdentity = true;
    const operation = ProjectWorkspaceSession.identityQueue.then(() => this.#openWithChoice(projectDirectory, choice));
    ProjectWorkspaceSession.identityQueue = operation.catch(() => undefined);
    try { return await operation; } finally { this.#choosingIdentity = false; }
  }
  async #openWithChoice(projectDirectory: string, choice?: string): Promise<Record<string, unknown>> {
    const selected = await inspectProjectVNext(projectDirectory);
    const owner = [...ProjectWorkspaceSession.sessions].find(session => !session.#transferred && session.#opened?.inspection.manifest.projectId === selected.manifest.projectId && session.#opened.inspection.projectDirectory !== selected.projectDirectory);
    const current = owner ? owner.#opened?.inspection : undefined;
    if (current && current.manifest.projectId === selected.manifest.projectId && current.projectDirectory !== selected.projectDirectory) {
      const conflict = { projectId: selected.manifest.projectId, currentDirectory: current.projectDirectory, selectedDirectory: selected.projectDirectory };
      if (!choice || !this.#identityConflict || JSON.stringify(this.#identityConflict) !== JSON.stringify(conflict)) {
        this.#identityConflict = conflict;
        return { status: 'identity-conflict', ...conflict };
      }
      if (choice === 'cancel') { this.#identityConflict = null; return { status: 'open-cancelled' }; }
      if (choice === 'current') { this.#identityConflict = null; return owner === this ? this.serialize(current) : this.serialize(await this.open(current.projectDirectory)); }
      if (!['selected', 'convert'].includes(choice)) throw new Error('请选择明确的项目身份处理方式。');
      if (choice === 'convert') {
        const selectedWorkspace = await openProjectVNext(selected.projectDirectory);
        try { await selectedWorkspace.programTransaction(async () => changeProjectIdentity(selected.projectDirectory, selected.manifest.projectId, async () => {
          const latest = await inspectProjectVNext(selected.projectDirectory);
          if (latest.manifest.projectId !== selected.manifest.projectId) throw new Error('所选项目身份已变化。');
        })); } finally { await selectedWorkspace.release(); }
      }
      if (owner!.creation?.value && owner!.creation.value.status !== 'terminated') await owner!.creation.respond({ action: 'stop' });
      await owner!.creation?.close(); await owner!.render.close();
      for (const job of owner!.#speechJobs.values()) if (!['succeeded', 'cancelled', 'failed', 'rejected'].includes(job.status)) owner!.cancelSpeech(job.id);
      await Promise.all([...owner!.#speechPending]);
      await owner!.#opened?.release(); owner!.#opened = null; owner!.creation = null;
      this.#identityConflict = null;
    }
    return this.serialize(await this.open(selected.projectDirectory));
  }

  async open(projectDirectory: string): Promise<ProjectVNextInspection> {
    if (this.#opening || this.#resolvingCandidate) throw new Error('线程连接或候选操作结果待核对');
    if (!this.#transferred && !this.#handoffPending && this.#opened?.inspection.projectDirectory === projectDirectory) return this.#opened.inspection;
    this.#opening = true;
    try { return await this.#open(projectDirectory); }
    finally { this.#opening = false; }
  }
  async #open(projectDirectory: string): Promise<ProjectVNextInspection> {
    const next = await openProjectVNext(projectDirectory, {
      probeSpeechDurationMs: this.#probeSpeechDurationMs,
      onHandoff: async () => {
        if (this.#opening || this.#resolvingCandidate) throw new Error('线程连接或候选操作结果待核对');
        this.#handoffPending = true;
        await this.creation?.transfer();
        await this.render.close();
        for (const job of this.#speechJobs.values()) if (!['succeeded', 'cancelled', 'failed', 'rejected'].includes(job.status)) this.cancelSpeech(job.id);
        await this.#opened?.release();
        this.#transferred = true;
      },
    });
    const previous = this.#opened;
    try {
      if (previous !== null) { await this.creation?.close(); await this.render.close(); await previous.release(); }
    } catch (error) {
      await next.release();
      throw error;
    }
    this.delivery.clear();
    this.checks.clear();
    this.preview.clear();
    this.#opened = next;
    this.#transferred = false; this.#handoffPending = false;
    this.#candidateStatus = await next.candidate({ action: "read" });
    this.creation = this.#codexHost ? new CreationTask(next, this.#codexHost, this.preview, this.checks, this.delivery) : null;
    this.creationError = null;
    try { await this.creation?.load(next.transferred); } catch (error) { this.creationError = (error as Error).message; }
    return next.inspection;
  }

  async candidate(input: CandidateRequest & { projectDirectory: string; projectId: string }) {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    const { projectDirectory: _directory, projectId: _id, ...request } = input;
    if (this.creation?.blocksCandidateWrites && request.action !== 'read') throw new Error('只有当前创作驱动可以修改候选；接管尚未接入。');
    if (this.#resolvingCandidate && request.action !== 'read') throw new Error('正在核对操作结果，请稍候。');
    if (request.action !== 'discard') {
      this.#candidateStatus = await opened.candidate(request);
      return this.#candidateStatus;
    }
    this.#resolvingCandidate = true;
    try {
      this.#candidateStatus = await opened.candidate(request);
      await this.creation?.terminate('CANDIDATE_ABANDONED').catch(() => undefined);
      this.delivery.clear(); this.checks.invalidate(); this.preview.invalidate();
      return this.#candidateStatus;
    } finally { this.#resolvingCandidate = false; }
  }

  async save(input: {
    projectDirectory: string;
    projectId: string;
    baselineRevision: string;
    project: unknown;
  }): Promise<ProjectVNextInspection> {
    const opened = this.#opened;
    if (this.#transferred || this.#handoffPending) throw new ProjectLifecycleError("PROJECT_IDENTITY_LOST", opened?.inspection.projectDirectory ?? "", this.#transferred ? "任务已转移到另一线程" : "线程连接结果待核对");
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
    this.creation?.projectSaved();
    return saved.inspection;
  }

  async saveVideoBrief(input: {
    projectDirectory: string;
    projectId: string;
    baselineRevision: string;
    content: string;
  }): Promise<Awaited<ReturnType<OpenedProjectVNext["saveVideoBrief"]>>> {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    const saved = await opened.saveVideoBrief(input.content, input.baselineRevision);
    if (saved.status === "saved") opened.inspection = saved.inspection;
    return saved;
  }

  async exportVideoBriefLocal(input: {
    projectDirectory: string;
    projectId: string;
    targetDirectory: string;
    content: string;
  }): Promise<Awaited<ReturnType<OpenedProjectVNext["exportVideoBriefLocal"]>>> {
    const opened = this.#requireOpened(input.projectDirectory, input.projectId);
    return opened.exportVideoBriefLocal(input.content, input.targetDirectory);
  }

  async importAsset(input: {
    projectDirectory: string;
    projectId: string;
    baselineRevision: string;
    sourcePath: string;
    targetSceneId?: string;
  }): Promise<Awaited<ReturnType<OpenedProjectVNext["importAsset"]>>> {
    const opened = this.#opened;
    if (this.#transferred || this.#handoffPending) throw new ProjectLifecycleError("PROJECT_IDENTITY_LOST", opened?.inspection.projectDirectory ?? "", this.#transferred ? "任务已转移到另一线程" : "线程连接结果待核对");
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
    this.creation?.projectSaved();
    return imported;
  }

  async readAssetPreview(input: {
    projectDirectory: string;
    projectId: string;
    assetId: string;
  }): Promise<Awaited<ReturnType<typeof readProjectAssetPreview>>> {
    const opened = this.#opened;
    if (this.#transferred || this.#handoffPending) throw new ProjectLifecycleError("PROJECT_IDENTITY_LOST", opened?.inspection.projectDirectory ?? "", this.#transferred ? "任务已转移到另一线程" : "线程连接结果待核对");
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
    const processing = new Promise<void>(resolve => setImmediate(() => { void this.#processSpeech(job).finally(resolve); }));
    this.#speechPending.add(processing);
    void processing.finally(() => this.#speechPending.delete(processing));
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
    if (this.#transferred || this.#handoffPending) throw new ProjectLifecycleError("PROJECT_IDENTITY_LOST", opened?.inspection.projectDirectory ?? "", this.#transferred ? "任务已转移到另一线程" : "线程连接结果待核对");
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
    await this.#copyPromise;
    ProjectWorkspaceSession.sessions.delete(this);
    await this.creation?.close();
    await this.render.close();
    for (const job of this.#speechJobs.values()) {
      if (!["succeeded", "cancelled", "failed", "rejected"].includes(job.status)) this.cancelSpeech(job.id);
    }
    this.delivery.clear();
    this.checks.clear();
    await this.preview.close();
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
  if (name === 'project_recovery') {
    try { return { structuredContent: await workspace.recoveryOperation(argumentsValue), content: [] }; }
    catch (error) { return { isError: true, structuredContent: { status: error instanceof RecoveryExportUncertain ? 'recovery-uncertain' : 'recovery-failed', error: { message: (error as Error).message } }, content: [] }; }
  }
  if (!['health_check', 'show_launcher', 'open_project', 'create_project', 'cancel_scene_speech_job'].includes(String(name))) {
    try { await workspace.checkIdentity(); }
    catch (error) { return { isError: true, structuredContent: { status: 'identity-lost', error: { code: 'PROJECT_IDENTITY_LOST', message: (error as Error).message } }, content: [] }; }
  }

  if (name === 'copy_project') {
    try { return { structuredContent: await workspace.copyOperation(argumentsValue), content: [] }; }
    catch (error) { return { isError: true, structuredContent: { error: { code: (error as any).code ?? 'PROJECT_COPY_FAILED', message: (error as Error).message } }, content: [] }; }
  }
  if (workspace.copying) return { isError: true, structuredContent: { error: { code: 'PROJECT_COPY_BUSY', message: '正在复制项目，暂不接收新的编辑和写任务。' } }, content: [] };

  if (name === 'respond_creation_task' || name === 'start_creation_task' || name === 'get_creation_task' || name === 'continue_creation_task') {
    try { return { structuredContent: await workspace.creationOperation(argumentsValue, name === 'start_creation_task', name === 'continue_creation_task', name === 'respond_creation_task'), content: [] }; }
    catch (error) { return { isError: true, structuredContent: { error: { code: 'CREATION_TASK_FAILED', message: (error as Error).message } }, content: [] }; }
  }
  if (name === "project_acceptance") {
    try { return { structuredContent: await workspace.acceptanceOperation(argumentsValue), content: [] }; }
    catch (error) { return { isError: true, structuredContent: { error: { code: (error as any).code ?? "ACCEPTANCE_FAILED", message: (error as Error).message } }, content: [] }; }
  }
  if (name === 'project_render') {
    try { return { structuredContent: await workspace.renderOperation(argumentsValue), content: [] }; }
    catch (error) { return { isError: true, structuredContent: { error: { code: (error as any).code ?? 'RENDER_OPERATION_FAILED', message: (error as Error).message } }, content: [] }; }
  }
  if (name === "project_delivery" || name === "project_delivery_display") {
    try {
      if (!argumentsValue || typeof argumentsValue !== 'object') throw new Error('交付参数无效。');
      const args = argumentsValue as Record<string, unknown>;
      if (name === 'project_delivery' && args.action === 'displayed') throw new Error('警告展示确认仅供工作台使用。');
      const result = await workspace.deliveryOperation(name === 'project_delivery_display' ? { ...args, action: 'displayed' } : args);
      if ('image' in result && typeof result.image === 'string') {
        const { image, ...metadata } = result;
        return { structuredContent: metadata, content: [{ type: "image", data: image, mimeType: "image/png" }] };
      }
      return { structuredContent: result, content: [] };
    } catch (error) { return { isError: true, structuredContent: { error: { code: "DELIVERY_FAILED", message: error instanceof Error ? error.message : "交付操作失败，请重试。" } }, content: [] }; }
  }
  if (name === "project_checks") {
    try { return { structuredContent: await workspace.checksOperation(argumentsValue), content: [] }; }
    catch (error) { return { isError: true, structuredContent: { error: { code: "CHECK_OPERATION_FAILED", message: error instanceof Error ? error.message : "检查操作失败，请重试。" } }, content: [] }; }
  }
  if (name === "project_preview") {
    try { return { structuredContent: await workspace.previewOperation(argumentsValue), content: [] }; }
    catch (error) { return { isError: true, structuredContent: { error: { code: (error as any).code ?? "PREVIEW_FAILED", message: error instanceof Error ? error.message : "Preview 失败，请重试。" } }, content: [] }; }
  }
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
      if (name === 'open_project') {
        const content = await workspace.openWithChoice(projectDirectory, stringArgument(argumentsValue, 'identityChoice') ?? undefined);
        return { structuredContent: { ...content, ...(content.status === 'valid' ? { operation: 'opened' } : {}) }, content: [] };
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
  if (name === "coordinate_project_dependencies") {
    const input = argumentsValue as Record<string, unknown> | null;
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some(key => !["projectDirectory", "projectId", "baseline", "dependencies", "packages"].includes(key)) ||
        typeof input.projectDirectory !== "string" || !isAbsolute(input.projectDirectory) || typeof input.projectId !== "string" || typeof input.baseline !== "string") {
      return { isError: true, structuredContent: { status: "dependency-failed", error: { code: "DEPENDENCY_SOURCE_UNSUPPORTED", message: "依赖协调参数无效；不接受自定义来源或凭据。" } }, content: [{ type: "text", text: "依赖协调参数无效；不接受自定义来源或凭据。" }] };
    }
    try {
      const candidate = await workspace.candidate({ ...input, action: "dependencies" } as CandidateRequest & { projectDirectory: string; projectId: string });
      return { structuredContent: { status: "candidate-state", candidate }, content: [{ type: "text", text: "候选精确依赖、锁图与离线依赖库已原子保存，尚未检查或接受。" }] };
    } catch (error) {
      const known = error instanceof DependencyError || error instanceof CandidateError || error instanceof ProjectLifecycleError;
      const code = known ? error.code : "DEPENDENCY_UNAVAILABLE";
      const message = known ? error.message : "依赖协调失败；原候选与离线库已保留，请检查网络后显式重试。";
      return { isError: true, structuredContent: { status: "dependency-failed", error: { code, message } }, content: [{ type: "text", text: message }] };
    }
  }
  if (name === "manage_project_candidate") {
    const input = argumentsValue as Record<string, unknown> | null;
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.projectDirectory !== "string" || !isAbsolute(input.projectDirectory) ||
      typeof input.projectId !== "string" || !["read", "create", "apply", "discard"].includes(String(input.action)) ||
      (input.baseline !== undefined && typeof input.baseline !== "string") ||
      (input.confirmed !== undefined && typeof input.confirmed !== "boolean")) {
      return { isError: true, structuredContent: { status: "candidate-failed", error: { code: "INVALID_TOOL_INPUT", message: "候选操作参数无效。" } }, content: [{ type: "text", text: "候选操作参数无效。" }] };
    }
    try {
      const candidate = await workspace.candidate(input as CandidateRequest & { projectDirectory: string; projectId: string });
      return { structuredContent: { status: "candidate-state", candidate }, content: [{ type: "text", text: candidate.error?.message ?? (candidate.status === "absent" ? "没有候选；当前修订保留。" : "候选已保存，尚未检查、尚未接受。") }] };
    } catch (error) {
      if (error instanceof CandidateError || error instanceof ProjectLifecycleError) {
        return { isError: true, structuredContent: { status: error.code === "PROJECT_IDENTITY_LOST" ? "identity-lost" : "candidate-failed", error: { code: error.code, message: error.message } }, content: [{ type: "text", text: error.message }] };
      }
      return { isError: true, structuredContent: { status: "candidate-failed", error: { code: "CANDIDATE_SAVE_FAILED", message: "候选操作失败，已保留原候选。" } }, content: [{ type: "text", text: "候选操作失败，已保留原候选。" }] };
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
  if (name === "save_project_video_brief") {
    if (typeof argumentsValue !== "object" || argumentsValue === null || Array.isArray(argumentsValue)) {
      return {
        isError: true,
        structuredContent: {
          status: "brief-save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "Video Brief 保存参数必须是对象。" },
        },
        content: [{ type: "text", text: "无法保存 Video Brief：参数无效。" }],
      };
    }
    const input = argumentsValue as Record<string, unknown>;
    if (
      typeof input.projectDirectory !== "string" || !isAbsolute(input.projectDirectory) ||
      typeof input.projectId !== "string" ||
      typeof input.baselineRevision !== "string" ||
      typeof input.content !== "string"
    ) {
      return {
        isError: true,
        structuredContent: {
          status: "brief-save-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "项目身份、Brief ETag 或 Markdown 内容无效。" },
        },
        content: [{ type: "text", text: "无法保存 Video Brief：项目身份、Brief ETag 或内容无效。" }],
      };
    }
    try {
      const saved = await workspace.saveVideoBrief({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        baselineRevision: input.baselineRevision,
        content: input.content,
      });
      if (saved.status === "conflict") {
        return {
          structuredContent: { status: "brief-conflict", disk: saved.disk },
          content: [{ type: "text", text: "video.md 已发生外部变化；Narracut 保留 BASE、LOCAL 与 DISK，未覆盖磁盘内容。" }],
        };
      }
      return {
        structuredContent: { ...workspace.serialize(saved.inspection), status: "brief-saved" },
        content: [{ type: "text", text: "已按 Brief ETag 原子保存完整 video.md。" }],
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const failure = lifecycleFailure(error);
        return {
          ...failure,
          structuredContent: {
            ...failure.structuredContent,
            status: error instanceof ProjectLifecycleError && error.code === "PROJECT_IDENTITY_LOST"
              ? "identity-lost"
              : "brief-save-failed",
          },
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
          error: { code: "INVALID_TOOL_INPUT", message: "Video Brief LOCAL 导出参数必须是对象。" },
        },
        content: [{ type: "text", text: "无法导出 Video Brief LOCAL：参数无效。" }],
      };
    }
    const input = argumentsValue as Record<string, unknown>;
    if (
      typeof input.projectDirectory !== "string" || !isAbsolute(input.projectDirectory) ||
      typeof input.projectId !== "string" ||
      typeof input.targetDirectory !== "string" || !isAbsolute(input.targetDirectory) ||
      typeof input.content !== "string"
    ) {
      return {
        isError: true,
        structuredContent: {
          status: "brief-export-failed",
          error: { code: "INVALID_TOOL_INPUT", message: "项目身份、导出目录或 LOCAL 内容无效。" },
        },
        content: [{ type: "text", text: "无法导出 Video Brief LOCAL：项目身份、目录或内容无效。" }],
      };
    }
    try {
      const exported = await workspace.exportVideoBriefLocal({
        projectDirectory: input.projectDirectory,
        projectId: input.projectId,
        targetDirectory: input.targetDirectory,
        content: input.content,
      });
      return {
        structuredContent: { status: "brief-exported", exported },
        content: [{ type: "text", text: `Video Brief LOCAL 已导出到 ${exported.path}；未覆盖已有文件。` }],
      };
    } catch (error) {
      if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
        const failure = lifecycleFailure(error);
        return {
          ...failure,
          structuredContent: { ...failure.structuredContent, status: "brief-export-failed" },
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
  const codexHost = options.codexHost ?? new CodexAppServerHost();
  const hostValidation = new AgentHostValidationService(codexHost);
  const workspace = new ProjectWorkspaceSession({
    codexHost,
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
        instructions: "只接触用户通过系统文件夹选择窗口或参数明确给出的目录。可以在不存在的目标原子创建 Project VNext，或严格打开有效项目；表格工作区只修改 Scene 与 Narration，Composer 可发起专用 Agent 创作任务，读取最新项目、原子修改唯一候选并检查交付；当前创作指令在表现上优先，但不能改写 Scene、Speech、时间与安全约束。Agent 不自动接受候选或发起最终 Render。",
      };
    }
    case "ping": return {};
    case "tools/list": return { tools };
    case "tools/call": {
      const operation = callTool(request.params, hostValidation, workspace);
      if ((request.params as any)?.name === 'copy_project') return operation;
      workspace.pendingOperations.add(operation);
      try { return await operation; } finally { workspace.pendingOperations.delete(operation); }
    }
    case "resources/list": return {
      resources: [{
        uri: WORKBENCH_URI,
        name: "Narracut 工作台",
        description: "Project VNext 启动器、可编辑 Scene 接触表与 Agent 创作工作区",
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
              csp: { connectDomains: [], resourceDomains: [], frameDomains: [await workspace.preview.source.origin()] },
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

import { readFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectProjectVNext,
  ProjectInspectionError,
  type ProjectInspectionDiagnostic,
  type ProjectVNextInspection,
} from "../../../src/server/project-vnext-inspection";

const SERVER_VERSION = "0.1.0";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const WORKBENCH_URI = "ui://narracut/workbench-v1.html";
const WORKBENCH_PATH = fileURLToPath(new URL(
  import.meta.url.endsWith("/server.mjs") ? "./workbench.html" : "../workbench.html",
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

const toolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const tools = [
  {
    name: "health_check",
    title: "检查 Narracut 连接",
    description: "确认 Narracut 本地 MCP 已连接，并返回当前只读能力边界。",
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
    annotations: toolAnnotations,
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
    annotations: toolAnnotations,
    _meta: { ui: { resourceUri: WORKBENCH_URI } },
  },
] as const;

function connectedState(): { status: "connected"; readOnly: true } {
  return { status: "connected", readOnly: true };
}

function serializeInspection(inspection: ProjectVNextInspection): Record<string, unknown> {
  const assets = new Map(inspection.project.assets.map((asset) => [asset.id, asset]));
  return {
    status: "valid",
    connection: connectedState(),
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
  const [html, paperTexture, filmTexture, displayFont] = await Promise.all([
    readFile(WORKBENCH_PATH, "utf8"),
    readFile(PAPER_TEXTURE_PATH),
    readFile(FILM_TEXTURE_PATH),
    readFile(DISPLAY_FONT_PATH),
  ]);
  const materialVariables = `@font-face{font-family:"Narracut Display";src:url("data:font/woff2;base64,${displayFont.toString("base64")}") format("woff2");font-style:normal;font-weight:100 800;font-stretch:75% 100%;font-display:block}:root{--paper-texture:url("data:image/webp;base64,${paperTexture.toString("base64")}");--film-texture:url("data:image/webp;base64,${filmTexture.toString("base64")}")}`;
  return html.replace("/*__NARRACUT_MATERIALS__*/", materialVariables);
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

async function callTool(params: unknown): Promise<ToolResult> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error("tools/call 缺少参数。");
  }
  const { name, arguments: argumentsValue } = params as { name?: unknown; arguments?: unknown };
  if (name === "health_check") {
    return {
      structuredContent: { status: "connected", server: "narracut", readOnly: true },
      content: [{ type: "text", text: "Narracut 插件已连接；当前只提供只读项目检查。" }],
    };
  }
  if (name === "inspect_project") return inspectProject(argumentsValue);
  throw new Error(`未知工具：${String(name)}`);
}

export async function handleRequest(request: JsonRpcRequest): Promise<unknown> {
  switch (request.method) {
    case "initialize": {
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "narracut", version: SERVER_VERSION },
        instructions: "只检查用户明确给出的 Project VNext 目录。不要把工具用于目录浏览；所有能力均为只读。",
      };
    }
    case "ping": return {};
    case "tools/list": return { tools };
    case "tools/call": return callTool(request.params);
    case "resources/list": return {
      resources: [{
        uri: WORKBENCH_URI,
        name: "Narracut 工作台",
        description: "Project VNext 只读双工作区外壳",
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
}

function writeMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleLine(line: string): Promise<void> {
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
    writeMessage({ jsonrpc: "2.0", id: request.id, result: await handleRequest(request) });
  } catch (error) {
    writeMessage({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" },
    });
  }
}

export async function startStdioServer(): Promise<void> {
  let inputBuffer = "";
  process.stdin.setEncoding("utf8");
  const keepAlive = setInterval(() => undefined, 60_000);
  try {
    for await (const chunk of process.stdin) {
      inputBuffer += chunk;
      const lines = inputBuffer.split("\n");
      inputBuffer = lines.pop() ?? "";
      for (const line of lines) await handleLine(line);
    }
    if (inputBuffer.trim() !== "") await handleLine(inputBuffer);
  } finally {
    clearInterval(keepAlive);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await startStdioServer();

import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { parseStrictJson, StrictJsonFailure, type StrictJsonLimits } from "./strict-json";
import {
  inspectProjectSpeech,
  ProjectTtsConfigError,
  readProjectTtsConfig,
  type ProjectTtsState,
  type SceneTimeWindow,
  type SpeechRuntimeState,
} from "./project-speech-vnext";

export type ProjectManifestVNext = {
  kind: "narracut-project";
  formatVersion: 1;
  projectId: string;
};

export type ProjectVNext = {
  assets: Array<{ id: string; path: string }>;
  scenes: Array<{
    id: string;
    narration: { text: string };
    assetIds: string[];
    speech?: {
      path: string;
      durationMs: number;
      sourceTextHash: string;
      ttsProfileId: string;
      audioContentHash?: string;
    };
  }>;
};

export type ProjectVNextInspection = {
  projectDirectory: string;
  manifest: ProjectManifestVNext;
  project: ProjectVNext;
  projectRevision: string;
  videoBrief: string;
  videoBriefRevision: string;
  currentRenderProgram?: {
    briefRevision: string | null;
    briefReviewPending: boolean;
    previewPreserved: true;
  };
  renderPrograms: { directories: string[] };
  assetStates: readonly AssetRuntimeState[];
  tts: ProjectTtsState;
  speechStates: readonly SpeechRuntimeState[];
  timeline: {
    durationInFrames: number;
    renderReady: boolean;
    scenes: SceneTimeWindow[];
  };
  warnings: readonly ProjectInspectionDiagnostic[];
};

export type AssetRuntimeState = {
  id: string;
  path: string;
  status: "available" | "unavailable";
  size?: number;
  reason?: string;
};

export type ProjectResourceValidation = {
  assetStates: AssetRuntimeState[];
  speechStates: SpeechRuntimeState[];
  timeline: {
    durationInFrames: number;
    renderReady: boolean;
    scenes: SceneTimeWindow[];
  };
  warnings: ProjectInspectionDiagnostic[];
};

export type ProjectInspectionErrorCode =
  | "PROJECT_PATH_UNAVAILABLE"
  | "NOT_A_NARRACUT_PROJECT"
  | "PROJECT_FORMAT_UNSUPPORTED"
  | "PROJECT_CONTENT_INVALID";

export type ProjectInspectionDiagnostic = {
  code: string;
  component: string;
  message: string;
  metric?: string;
  actual?: number;
  limit?: number;
  jsonPath?: string;
};

export class ProjectInspectionError extends Error {
  constructor(
    readonly code: ProjectInspectionErrorCode,
    readonly path: string,
    message: string,
    readonly diagnostics: readonly ProjectInspectionDiagnostic[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectInspectionError";
  }
}

function invalidControlFile(
  path: string,
  diagnostic: ProjectInspectionDiagnostic,
  options?: ErrorOptions,
): ProjectInspectionError {
  return new ProjectInspectionError(
    "PROJECT_CONTENT_INVALID",
    path,
    diagnostic.message,
    [diagnostic],
    options,
  );
}

function invalidContent(
  path: string,
  diagnostics: readonly ProjectInspectionDiagnostic[],
): ProjectInspectionError {
  const first = diagnostics[0];
  return new ProjectInspectionError(
    "PROJECT_CONTENT_INVALID",
    path,
    first?.message ?? "Project VNext 内容无效；请修复报告的问题后重试。",
    diagnostics,
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function compareStableText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function jsonPropertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function validateProjectManifest(
  manifest: Record<string, unknown>,
): ProjectInspectionDiagnostic[] {
  const diagnostics: ProjectInspectionDiagnostic[] = [];
  for (const key of Object.keys(manifest)) {
    if (!["kind", "formatVersion", "projectId"].includes(key)) {
      diagnostics.push({
        code: "PROJECT_MANIFEST_SCHEMA_INVALID",
        component: "narracut.json",
        jsonPath: jsonPropertyPath("$", key),
        message: `narracut.json 包含未知字段 ${key}；请删除该字段。`,
      });
    }
  }
  if (!Number.isInteger(manifest.formatVersion)) {
    diagnostics.push({
      code: "PROJECT_MANIFEST_SCHEMA_INVALID",
      component: "narracut.json",
      jsonPath: "$.formatVersion",
      message: "formatVersion 必须是整数 1；请修正项目清单。",
    });
  }
  if (typeof manifest.projectId !== "string" || !UUID_PATTERN.test(manifest.projectId)) {
    diagnostics.push({
      code: "PROJECT_MANIFEST_SCHEMA_INVALID",
      component: "narracut.json",
      jsonPath: "$.projectId",
      message: "projectId 必须是规范的小写 UUID；请使用有效项目清单。",
    });
  }
  return diagnostics.sort((left, right) => compareStableText(
    `${left.jsonPath}\u001f${left.code}`,
    `${right.jsonPath}\u001f${right.code}`,
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaDiagnostic(
  code: string,
  jsonPath: string,
  message: string,
): ProjectInspectionDiagnostic {
  return { code, component: "project.json", jsonPath, message };
}

function unknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  jsonPath: string,
  diagnostics: ProjectInspectionDiagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      diagnostics.push(schemaDiagnostic(
        "PROJECT_DSL_SCHEMA_INVALID",
        jsonPropertyPath(jsonPath, key),
        `${jsonPath} 包含未知字段 ${key}；请删除该字段。`,
      ));
    }
  }
}

function isCanonicalResourcePath(value: string, root: "assets" | "speech"): boolean {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    [...value].length > 1024 ||
    Buffer.byteLength(value, "utf8") > 1024
  ) return false;
  const parts = value.split("/");
  return parts[0] === root && parts.length > 1 && parts.every((part) =>
    part !== "" && part !== "." && part !== "..");
}

function boundedDiagnostics(
  diagnostics: readonly ProjectInspectionDiagnostic[],
): ProjectInspectionDiagnostic[] {
  const unique = new Map<string, ProjectInspectionDiagnostic>();
  for (const diagnostic of diagnostics) {
    const identity = `${diagnostic.jsonPath ?? ""}\u001f${diagnostic.code}\u001f${diagnostic.message}`;
    if (!unique.has(identity)) unique.set(identity, diagnostic);
  }
  const sorted = [...unique.values()].sort((left, right) => compareStableText(
    `${left.jsonPath ?? ""}\u001f${left.code}`,
    `${right.jsonPath ?? ""}\u001f${right.code}`,
  ));
  if (sorted.length <= 100) return sorted;
  return [
    ...sorted.slice(0, 99),
    {
      code: "DIAGNOSTICS_TRUNCATED",
      component: "project.json",
      message: `项目还有 ${sorted.length - 99} 条问题未展示；请先修复已列问题后重新检查。`,
      metric: "diagnostics",
      actual: sorted.length,
      limit: 100,
    },
  ];
}

function validateProjectDsl(value: unknown): {
  project?: ProjectVNext;
  diagnostics: ProjectInspectionDiagnostic[];
} {
  const diagnostics: ProjectInspectionDiagnostic[] = [];
  if (!isRecord(value)) {
    return {
      diagnostics: [schemaDiagnostic(
        "PROJECT_DSL_SCHEMA_INVALID",
        "$",
        "project.json 根值必须是对象；请提供 assets 与 scenes。",
      )],
    };
  }
  unknownFields(value, ["assets", "scenes"], "$", diagnostics);
  const assets = value.assets;
  const scenes = value.scenes;
  if (!Array.isArray(assets)) {
    diagnostics.push(schemaDiagnostic(
      "PROJECT_DSL_SCHEMA_INVALID",
      "$.assets",
      "assets 必须是数组；请修正 Project DSL。",
    ));
  }
  if (!Array.isArray(scenes)) {
    diagnostics.push(schemaDiagnostic(
      "PROJECT_DSL_SCHEMA_INVALID",
      "$.scenes",
      "scenes 必须是数组；请修正 Project DSL。",
    ));
  }
  if (!Array.isArray(assets) || !Array.isArray(scenes)) {
    return { diagnostics: boundedDiagnostics(diagnostics) };
  }
  if (assets.length > 1000) {
    return { diagnostics: [{
      code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      component: "project.json",
      jsonPath: "$.assets[1000]",
      message: `assets 有 ${assets.length} 项，超过上限 1000；请移除多余 Asset。`,
      metric: "assets",
      actual: assets.length,
      limit: 1000,
    }] };
  }
  if (scenes.length > 1000) {
    return { diagnostics: [{
      code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      component: "project.json",
      jsonPath: "$.scenes[1000]",
      message: `scenes 有 ${scenes.length} 项，超过上限 1000；请移除多余 Scene。`,
      metric: "scenes",
      actual: scenes.length,
      limit: 1000,
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
          message: `Asset path 为 ${bytes} UTF-8 字节，超过上限 1024；请缩短路径。`,
          metric: "pathBytes",
          actual: bytes,
          limit: 1024,
        }] };
      }
      if (scalars > 1024) {
        return { diagnostics: [{
          code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
          component: "project.json",
          jsonPath: `$.assets[${index}].path`,
          message: `Asset path 有 ${scalars} 个 Unicode 标量，超过上限 1024；请缩短路径。`,
          metric: "pathScalars",
          actual: scalars,
          limit: 1024,
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
        message: `Scene 的 assetIds 有 ${scene.assetIds.length} 项，超过上限 256；请移除多余引用。`,
        metric: "sceneAssetIds",
        actual: scene.assetIds.length,
        limit: 256,
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
            message: `Speech path 的 ${metric} 为 ${actual}，超过上限 1024；请缩短路径。`,
            metric,
            actual,
            limit: 1024,
          }] };
        }
      }
      if (
        typeof scene.speech.ttsProfileId === "string" &&
        [...scene.speech.ttsProfileId].length > 256
      ) {
        const actual = [...scene.speech.ttsProfileId].length;
        return { diagnostics: [{
          code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
          component: "project.json",
          jsonPath: `$.scenes[${index}].speech.ttsProfileId`,
          message: `ttsProfileId 有 ${actual} 个 Unicode 标量，超过上限 256；请缩短该标识。`,
          metric: "ttsProfileIdScalars",
          actual,
          limit: 256,
        }] };
      }
    }
  }

  const assetIds = new Set<string>();
  const assetPaths = new Set<string>();
  assets.forEach((asset, index) => {
    const path = `$.assets[${index}]`;
    if (!isRecord(asset)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", path, `${path} 必须是 Asset 对象。`));
      return;
    }
    unknownFields(asset, ["id", "path"], path, diagnostics);
    if (typeof asset.id !== "string" || !UUID_PATTERN.test(asset.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.id`, "Asset id 必须是规范的小写 UUID。"));
    } else if (assetIds.has(asset.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_ID_DUPLICATE", `${path}.id`, `Asset id ${asset.id} 重复；请为每个 Asset 使用唯一 ID。`));
    } else {
      assetIds.add(asset.id);
    }
    if (typeof asset.path !== "string" || !isCanonicalResourcePath(asset.path, "assets")) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_PATH_INVALID", `${path}.path`, "Asset path 必须是 assets/ 下的规范项目相对路径。"));
    } else if (assetPaths.has(asset.path)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_PATH_DUPLICATE", `${path}.path`, `Asset path ${asset.path} 重复；请使用唯一路径。`));
    } else {
      assetPaths.add(asset.path);
    }
  });

  const sceneIds = new Set<string>();
  scenes.forEach((scene, index) => {
    const path = `$.scenes[${index}]`;
    if (!isRecord(scene)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", path, `${path} 必须是 Scene 对象。`));
      return;
    }
    unknownFields(scene, ["id", "narration", "assetIds", "speech"], path, diagnostics);
    if (typeof scene.id !== "string" || !UUID_PATTERN.test(scene.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.id`, "Scene id 必须是规范的小写 UUID。"));
    } else if (sceneIds.has(scene.id)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_ID_DUPLICATE", `${path}.id`, `Scene id ${scene.id} 重复；请为每个 Scene 使用唯一 ID。`));
    } else {
      sceneIds.add(scene.id);
    }
    if (!isRecord(scene.narration)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.narration`, "narration 必须是只含 text 的对象。"));
    } else {
      unknownFields(scene.narration, ["text"], `${path}.narration`, diagnostics);
      if (typeof scene.narration.text !== "string") {
        diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.narration.text`, "Narration text 必须是字符串。"));
      }
    }
    if (!Array.isArray(scene.assetIds)) {
      diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.assetIds`, "assetIds 必须是 UUID 数组。"));
    } else {
      const references = new Set<string>();
      scene.assetIds.forEach((assetId, assetIndex) => {
        const referencePath = `${path}.assetIds[${assetIndex}]`;
        if (typeof assetId !== "string" || !UUID_PATTERN.test(assetId)) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", referencePath, "Asset 引用必须是规范的小写 UUID。"));
        } else if (references.has(assetId)) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_REFERENCE_DUPLICATE", referencePath, `Scene 重复引用 Asset ${assetId}；请移除重复项。`));
        } else {
          references.add(assetId);
          if (!assetIds.has(assetId)) {
            diagnostics.push(schemaDiagnostic("PROJECT_DSL_REFERENCE_INVALID", referencePath, `Asset 引用 ${assetId} 未在 assets 中登记；请登记或移除该引用。`));
          }
        }
      });
    }
    if ("speech" in scene) {
      if (!isRecord(scene.speech)) {
        diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech`, "speech 缺省时必须省略字段，存在时必须是完整对象。"));
      } else {
        unknownFields(scene.speech, ["path", "durationMs", "sourceTextHash", "ttsProfileId", "audioContentHash"], `${path}.speech`, diagnostics);
        const expectedPath = typeof scene.id === "string" ? `speech/${scene.id}.mp3` : undefined;
        if (
          typeof scene.speech.path !== "string" ||
          !isCanonicalResourcePath(scene.speech.path, "speech") ||
          scene.speech.path !== expectedPath
        ) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_PATH_INVALID", `${path}.speech.path`, `Speech path 必须精确为 ${expectedPath ?? "speech/<sceneId>.mp3"}。`));
        }
        if (!Number.isSafeInteger(scene.speech.durationMs) || (scene.speech.durationMs as number) <= 0) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech.durationMs`, "durationMs 必须是正安全整数。"));
        }
        const narrationText = isRecord(scene.narration) && typeof scene.narration.text === "string"
          ? scene.narration.text
          : undefined;
        const expectedHash = narrationText === undefined
          ? undefined
          : `sha256:${createHash("sha256").update(narrationText, "utf8").digest("hex")}`;
        if (
          typeof scene.speech.sourceTextHash !== "string" ||
          !/^sha256:[0-9a-f]{64}$/u.test(scene.speech.sourceTextHash) ||
          (expectedHash !== undefined && scene.speech.sourceTextHash !== expectedHash)
        ) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SPEECH_MISMATCH", `${path}.speech.sourceTextHash`, "sourceTextHash 必须匹配当前 Narration 的原始 UTF-8 字节。"));
        }
        if (
          typeof scene.speech.ttsProfileId !== "string"
        ) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech.ttsProfileId`, "ttsProfileId 必须是不超过 256 个 Unicode 标量的字符串。"));
        }
        if (
          "audioContentHash" in scene.speech &&
          (typeof scene.speech.audioContentHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(scene.speech.audioContentHash))
        ) {
          diagnostics.push(schemaDiagnostic("PROJECT_DSL_SCHEMA_INVALID", `${path}.speech.audioContentHash`, "audioContentHash 必须是规范的 SHA-256 摘要。"));
        }
      }
    }
  });
  return {
    ...(diagnostics.length === 0 ? { project: value as ProjectVNext } : {}),
    diagnostics: boundedDiagnostics(diagnostics),
  };
}

export function validateProjectVNextForSave(
  value: unknown,
  projectPath = "project.json",
): { project: ProjectVNext; bytes: Buffer } {
  let inputBytes: Buffer;
  try {
    inputBytes = Buffer.from(JSON.stringify(value), "utf8");
  } catch (cause) {
    throw invalidControlFile(projectPath, {
      code: "PROJECT_DSL_SCHEMA_INVALID",
      component: "project.json",
      jsonPath: "$",
      message: "Project DSL 必须是可序列化的 JSON 对象。",
    }, { cause });
  }
  if (inputBytes.length > 10 * 1024 * 1024) {
    throw invalidControlFile(projectPath, {
      code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      component: "project.json",
      message: `project.json 为 ${inputBytes.length} 字节，超过上限 ${10 * 1024 * 1024}；请缩减内容后重试。`,
      metric: "bytes",
      actual: inputBytes.length,
      limit: 10 * 1024 * 1024,
    });
  }
  const parsed = parseControlJson(
    inputBytes.toString("utf8"),
    projectPath,
    "project.json",
    PROJECT_JSON_LIMITS,
  );
  const validation = validateProjectDsl(parsed);
  if (validation.project === undefined) {
    throw invalidContent(projectPath, validation.diagnostics);
  }
  const project = validation.project;
  const bytes = Buffer.from(JSON.stringify({
    assets: project.assets.map((asset) => ({ id: asset.id, path: asset.path })),
    scenes: project.scenes.map((scene) => ({
      id: scene.id,
      narration: { text: scene.narration.text },
      assetIds: [...scene.assetIds],
      ...(scene.speech === undefined
        ? {}
        : {
            speech: {
              path: scene.speech.path,
              durationMs: scene.speech.durationMs,
              sourceTextHash: scene.speech.sourceTextHash,
              ttsProfileId: scene.speech.ttsProfileId,
              ...(scene.speech.audioContentHash === undefined ? {} : { audioContentHash: scene.speech.audioContentHash }),
            },
          }),
    })),
  }), "utf8");
  return { project, bytes };
}

function decodeUtf8(bytes: Buffer, path: string, component: string, allowBom: boolean): string {
  if (!allowBom && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw invalidControlFile(path, {
      code: "PROJECT_CONTROL_FILE_INVALID_UTF8",
      component,
      message: `${component} 不得包含 UTF-8 BOM；请移除 BOM 后重试。`,
    });
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: allowBom }).decode(bytes);
  } catch (cause) {
    throw invalidControlFile(path, {
      code: "PROJECT_CONTROL_FILE_INVALID_UTF8",
      component,
      message: `${component} 不是严格 UTF-8；请以 UTF-8 重新保存后重试。`,
    }, { cause });
  }
}

const MANIFEST_JSON_LIMITS: StrictJsonLimits = {
  maxDepth: 4,
  maxArrayItems: 0,
  maxObjectFields: 16,
  maxNodes: 32,
  maxStringScalars: 256,
  maxStringBytes: 1024,
  maxNumberBytes: 64,
  forbidArrays: true,
};

const PROJECT_JSON_LIMITS: StrictJsonLimits = {
  maxDepth: 8,
  maxArrayItems: 100_000,
  maxObjectFields: 32_000,
  maxNodes: 200_000,
  maxStringScalars: 65_536,
  maxStringBytes: 256 * 1024,
  maxNumberBytes: 64,
};

function parseControlJson(
  input: string,
  path: string,
  component: string,
  limits: StrictJsonLimits,
): unknown {
  try {
    return parseStrictJson(input, limits);
  } catch (cause) {
    if (!(cause instanceof StrictJsonFailure)) throw cause;
    throw invalidControlFile(path, {
      code: cause.code,
      component,
      message: cause.message,
      jsonPath: cause.jsonPath,
      ...(cause.metric === undefined ? {} : { metric: cause.metric }),
      ...(cause.actual === undefined ? {} : { actual: cause.actual }),
      ...(cause.limit === undefined ? {} : { limit: cause.limit }),
    }, { cause });
  }
}

async function readBoundedControlFile(
  path: string,
  component: string,
  limit: number,
): Promise<Buffer> {
  const pathFacts = await lstat(path);
  if (!pathFacts.isFile() || pathFacts.isSymbolicLink() || pathFacts.nlink !== 1) {
    throw invalidControlFile(path, {
      code: "PROJECT_REQUIRED_CONTENT_INVALID",
      component,
      message: `${component} 必须是无符号链接、无硬链接的普通文件；请替换该路径后重试。`,
    });
  }
  const handle = await open(path, "r");
  try {
    const facts = await handle.stat();
    if (!facts.isFile() || facts.dev !== pathFacts.dev || facts.ino !== pathFacts.ino) {
      throw invalidControlFile(path, {
        code: "PROJECT_REQUIRED_CONTENT_INVALID",
        component,
        message: `${component} 在检查期间被替换；请停止外部修改后重试。`,
      });
    }
    if (facts.size > limit) {
      throw invalidControlFile(path, {
        code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
        component,
        message: `${component} 为 ${facts.size} 字节，超过上限 ${limit}；请缩减文件后重试。`,
        metric: "bytes",
        actual: facts.size,
        limit,
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
        message: `${component} 在读取期间超过 ${limit} 字节；请停止外部修改并缩减文件后重试。`,
        metric: "bytes",
        actual: total,
        limit,
      });
    }
    return bytes.subarray(0, total);
  } finally {
    await handle.close();
  }
}

export async function readProjectVNextRevision(projectPath: string): Promise<string> {
  const bytes = await readBoundedControlFile(projectPath, "project.json", 10 * 1024 * 1024);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function readVideoBriefVNext(videoBriefPath: string): Promise<{
  content: string;
  revision: string;
  bytes: number;
}> {
  const buffer = await readBoundedControlFile(videoBriefPath, "video.md", 2 * 1024 * 1024);
  return {
    content: decodeUtf8(buffer, videoBriefPath, "video.md", true),
    revision: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
    bytes: buffer.length,
  };
}

async function requireDirectory(path: string): Promise<void> {
  const facts = await lstat(path);
  if (!facts.isDirectory() || facts.isSymbolicLink()) throw new Error(`必需目录无效：${path}`);
}

async function requireFile(path: string): Promise<void> {
  const facts = await lstat(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1) {
    throw new Error(`必需文件无效：${path}`);
  }
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException & { path?: string } {
  return error instanceof Error && "code" in error;
}

function missingContent(path: string, component: string): ProjectInspectionError {
  return invalidContent(path, [{
    code: "PROJECT_REQUIRED_CONTENT_MISSING",
    component,
    message: `缺少必需的 ${component}；请恢复完整 Project VNext 内容后重试。`,
  }]);
}

function invalidResource(path: string, component: string, message: string): ProjectInspectionError {
  return invalidContent(path, [{ code: "PROJECT_RESOURCE_INVALID", component, message }]);
}

async function validateOrdinaryResource(
  projectDirectory: string,
  relativePath: string,
  required: boolean,
): Promise<void> {
  const parts = relativePath.split("/");
  const directoryIdentities: Array<{ path: string; dev: number; ino: number }> = [];
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
        `无法检查资源 ${path}；请检查路径和权限后重试。`,
        [],
        { cause },
      );
    }
    const isLeaf = index === parts.length - 1;
    if (!isLeaf && (!facts.isDirectory() || facts.isSymbolicLink())) {
      throw invalidResource(
        path,
        component,
        `${component} 必须是无符号链接的普通目录；请替换该路径。`,
      );
    }
    if (!isLeaf) directoryIdentities.push({ path, dev: facts.dev, ino: facts.ino });
    if (isLeaf && (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1)) {
      throw invalidResource(
        path,
        relativePath,
        `${relativePath} 必须是无符号链接、无硬链接的普通文件；请替换该资源。`,
      );
    }
  }
  const resourcePath = join(projectDirectory, relativePath);
  const allowedRoot = await realpath(join(projectDirectory, parts[0]!));
  const resolvedResource = await realpath(resourcePath);
  const relation = relative(allowedRoot, resolvedResource);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw invalidResource(
      resourcePath,
      relativePath,
      `${relativePath} 解析到 ${allowedRoot} 之外；请移除路径中的链接。`,
    );
  }
  for (const identity of directoryIdentities) {
    const current = await lstat(identity.path);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino
    ) {
      throw invalidResource(
        identity.path,
        relative(projectDirectory, identity.path),
        `${relative(projectDirectory, identity.path)} 在检查期间被替换；请停止外部修改后重试。`,
      );
    }
  }
}

export async function validateProjectVNextResources(
  projectDirectory: string,
  project: ProjectVNext,
  options: {
    currentTtsProfileId?: string;
    probeSpeechDurationMs?: (path: string) => Promise<number>;
  } = {},
): Promise<ProjectResourceValidation> {
  const assetStates: AssetRuntimeState[] = [];
  for (const asset of project.assets) {
    const path = join(projectDirectory, asset.path);
    await validateOrdinaryResource(projectDirectory, asset.path, false);
    let facts;
    try {
      facts = await lstat(path);
    } catch (cause) {
      assetStates.push({
        id: asset.id,
        path: asset.path,
        status: "unavailable",
        reason: isFileSystemError(cause) && cause.code === "ENOENT"
          ? "文件缺失或已被移动。"
          : "文件无法读取；请检查权限或设备状态。",
      });
      continue;
    }
    try {
      const handle = await open(path, "r");
      await handle.close();
      assetStates.push({
        id: asset.id,
        path: asset.path,
        status: "available",
        size: facts.size,
      });
    } catch {
      assetStates.push({
        id: asset.id,
        path: asset.path,
        status: "unavailable",
        reason: "文件无法读取；请检查权限或设备状态。",
      });
    }
  }
  const speech = await inspectProjectSpeech(
    projectDirectory,
    project.scenes,
    options.currentTtsProfileId,
    { probeDurationMs: options.probeSpeechDurationMs },
  );
  const speechWarnings: ProjectInspectionDiagnostic[] = speech.states
    .filter((state) => state.status !== "available" && state.status !== "missing")
    .map((state, index) => {
      const sceneIndex = project.scenes.findIndex((scene) => scene.id === state.sceneId);
      const code = {
        available: "",
        missing: "PROJECT_SPEECH_MISSING",
        unavailable: "PROJECT_SPEECH_UNAVAILABLE",
        "decode-failed": "PROJECT_SPEECH_DECODE_FAILED",
        changed: "PROJECT_SPEECH_CHANGED",
        "profile-mismatch": "PROJECT_SPEECH_PROFILE_MISMATCH",
      }[state.status];
      return {
        code: code ?? "PROJECT_SPEECH_UNAVAILABLE",
        component: state.path ?? `Scene ${sceneIndex + 1}`,
        jsonPath: `$.scenes[${sceneIndex < 0 ? index : sceneIndex}].speech`,
        message: state.reason ?? "Speech 当前不可用于正式 Render。",
      };
    });
  return {
    assetStates,
    speechStates: speech.states,
    timeline: speech.timeline,
    warnings: boundedDiagnostics([...assetStates
      .filter((asset) => asset.status === "unavailable")
      .map((asset) => ({
        code: "PROJECT_ASSET_UNAVAILABLE",
        component: asset.path,
        message: `${asset.path} 不可用：${asset.reason ?? "无法读取。"}`,
      })), ...speechWarnings]),
  };
}

async function readStableDirectory(directory: string): Promise<Dirent[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareStableText(left.name, right.name));
  return entries;
}

const MAX_DIRECTORY_TREE_DEPTH = 32;
const MAX_DIRECTORY_TREE_DIRECTORIES = 4096;

function directoryTreeLimit(
  projectDirectory: string,
  path: string,
  metric: "directoryDepth" | "directories",
  actual: number,
  limit: number,
): ProjectInspectionError {
  const component = relative(projectDirectory, path) || ".";
  return invalidControlFile(path, {
    code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
    component,
    metric,
    actual,
    limit,
    message: `${component} 的${metric === "directoryDepth" ? "目录深度" : "已检查目录数"}为 ${actual}，超过上限 ${limit}；请精简项目内部树后重试。`,
  });
}

async function discoverRenderProgramDirectories(projectDirectory: string): Promise<string[]> {
  const excludedRoots = new Set(["assets", "speech", "renders"]);
  const stack = [{ directory: projectDirectory, depth: 0 }];
  const programs: string[] = [];
  let directoriesVisited = 0;
  while (stack.length > 0) {
    const { directory, depth } = stack.pop()!;
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
        `无法检查项目内容目录 ${directory}；请检查权限后重试。`,
        [],
        { cause },
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

async function validateRenderProgramDirectory(
  projectDirectory: string,
  programDirectory: string,
): Promise<void> {
  const projectRoot = await realpath(projectDirectory);
  const resolvedProgram = await realpath(programDirectory);
  const programRelation = relative(projectRoot, resolvedProgram);
  if (
    programRelation === ".." ||
    programRelation.startsWith(`..${sep}`) ||
    isAbsolute(programRelation)
  ) {
    throw invalidResource(
      programDirectory,
      relative(projectDirectory, programDirectory),
      "Render Program 解析到项目目录之外；请移除父路径中的链接。",
    );
  }
  const requiredEntries: Array<[string, "directory" | "file"]> = [
    ["program.json", "file"],
    ["package.json", "file"],
    ["pnpm-lock.yaml", "file"],
    ["src", "directory"],
    ["src/RenderProgram.tsx", "file"],
    ["resources", "directory"],
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
        `无法检查 Render Program 路径 ${path}；请检查权限后重试。`,
        [],
        { cause },
      );
    }
    const valid = kind === "directory"
      ? facts.isDirectory() && !facts.isSymbolicLink()
      : facts.isFile() && !facts.isSymbolicLink() && facts.nlink === 1;
    if (!valid) {
      throw invalidResource(
        path,
        relative(projectDirectory, path),
        `${relative(projectDirectory, path)} 必须是无链接的普通${kind === "directory" ? "目录" : "文件"}。`,
      );
    }
  }

  const stack = [{ directory: programDirectory, depth: 0 }];
  let directoriesVisited = 0;
  while (stack.length > 0) {
    const { directory, depth } = stack.pop()!;
    directoriesVisited += 1;
    if (directoriesVisited > MAX_DIRECTORY_TREE_DIRECTORIES) {
      throw directoryTreeLimit(projectDirectory, directory, "directories", directoriesVisited, MAX_DIRECTORY_TREE_DIRECTORIES);
    }
    for (const entry of [...await readStableDirectory(directory)].reverse()) {
      const path = join(directory, entry.name);
      const component = relative(projectDirectory, path);
      if (["node_modules", ".cache", "bundle"].includes(entry.name)) {
        throw invalidResource(path, component, `Render Program 不得携带 ${entry.name} 派生产物；请将其移出项目。`);
      }
      const facts = await lstat(path);
      if (facts.isSymbolicLink()) {
        throw invalidResource(path, component, `${component} 是符号链接；Render Program 树只允许普通文件和目录。`);
      }
      if (facts.isDirectory()) {
        const childDepth = depth + 1;
        if (childDepth > MAX_DIRECTORY_TREE_DEPTH) {
          throw directoryTreeLimit(projectDirectory, path, "directoryDepth", childDepth, MAX_DIRECTORY_TREE_DEPTH);
        }
        stack.push({ directory: path, depth: childDepth });
      }
      else if (!facts.isFile() || facts.nlink !== 1) {
        throw invalidResource(path, component, `${component} 不是无硬链接的普通文件；请替换该资源。`);
      }
    }
  }
  if (await realpath(programDirectory) !== resolvedProgram) {
    throw invalidResource(
      programDirectory,
      relative(projectDirectory, programDirectory),
      "Render Program 在检查期间被替换；请停止外部修改后重试。",
    );
  }
}

export async function inspectProjectVNext(
  inputPath: string,
  options: { probeSpeechDurationMs?: (path: string) => Promise<number> } = {},
): Promise<ProjectVNextInspection> {
  const projectDirectory = resolve(inputPath);
  try {
    await requireDirectory(projectDirectory);
  } catch (cause) {
    throw new ProjectInspectionError(
      "PROJECT_PATH_UNAVAILABLE",
      projectDirectory,
      `无法读取项目目录 ${projectDirectory}；请检查路径和权限后重试。`,
      [],
      { cause },
    );
  }
  const manifestPath = join(projectDirectory, "narracut.json");
  let manifestBuffer: Buffer;
  try {
    manifestBuffer = await readBoundedControlFile(manifestPath, "narracut.json", 4 * 1024);
  } catch (cause) {
    if (cause instanceof ProjectInspectionError) throw cause;
    if (isFileSystemError(cause) && cause.code === "ENOENT") {
      throw new ProjectInspectionError(
        "NOT_A_NARRACUT_PROJECT",
        manifestPath,
        `目录中没有 narracut.json；请选择 Project VNext 项目目录。`,
        [],
        { cause },
      );
    }
    throw new ProjectInspectionError(
      "PROJECT_PATH_UNAVAILABLE",
      manifestPath,
      `无法读取 ${manifestPath}；请检查路径和权限后重试。`,
      [],
      { cause },
    );
  }
  const manifestBytes = decodeUtf8(manifestBuffer, manifestPath, "narracut.json", false);
  const parsedManifest = parseControlJson(
    manifestBytes,
    manifestPath,
    "narracut.json",
    MANIFEST_JSON_LIMITS,
  );
  if (
    typeof parsedManifest !== "object" ||
    parsedManifest === null ||
    Array.isArray(parsedManifest) ||
    !("kind" in parsedManifest) ||
    parsedManifest.kind !== "narracut-project"
  ) {
    throw new ProjectInspectionError(
      "NOT_A_NARRACUT_PROJECT",
      manifestPath,
      `该目录没有有效的 Project VNext 标识；请选择包含 kind=narracut-project 清单的项目目录。`,
    );
  }
  const manifest = parsedManifest as Record<string, unknown>;
  if (Number.isInteger(manifest.formatVersion) && manifest.formatVersion !== 1) {
    throw new ProjectInspectionError(
      "PROJECT_FORMAT_UNSUPPORTED",
      manifestPath,
      `项目格式版本 ${String(manifest.formatVersion)} 不受支持；请使用支持该格式的 Narracut 版本。`,
    );
  }
  const manifestDiagnostics = validateProjectManifest(manifest);
  if (manifestDiagnostics.length > 0) throw invalidContent(manifestPath, manifestDiagnostics);

  const requiredEntries: Array<[string, string, "directory" | "file"]> = [
    [join(projectDirectory, "assets"), "assets/", "directory"],
    [join(projectDirectory, "speech"), "speech/", "directory"],
    [join(projectDirectory, "renders"), "renders/", "directory"],
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
          `无法读取 ${path}；请检查权限后重试。`,
          [],
          { cause },
        );
      }
      throw missingContent(path, component);
    }
  }
  const renderProgramDirectories = await discoverRenderProgramDirectories(projectDirectory);
  if (renderProgramDirectories.length === 0) {
    throw missingContent(
      projectDirectory,
      "至少一份候选或修订内部的 render-program/",
    );
  }
  for (const programDirectory of renderProgramDirectories) {
    await validateRenderProgramDirectory(projectDirectory, programDirectory);
  }

  let projectBuffer: Buffer;
  let videoBuffer: Buffer;
  try {
    [projectBuffer, videoBuffer] = await Promise.all([
      readBoundedControlFile(
        join(projectDirectory, "project.json"),
        "project.json",
        10 * 1024 * 1024,
      ),
      readBoundedControlFile(
        join(projectDirectory, "video.md"),
        "video.md",
        2 * 1024 * 1024,
      ),
    ]);
  } catch (cause) {
    if (cause instanceof ProjectInspectionError) throw cause;
    const path = isFileSystemError(cause) && typeof cause.path === "string"
      ? cause.path
      : projectDirectory;
    const component = path.startsWith(`${projectDirectory}/`)
      ? path.slice(projectDirectory.length + 1)
      : path;
    if (isFileSystemError(cause) && cause.code === "ENOENT") {
      throw missingContent(path, component);
    }
    throw new ProjectInspectionError(
      "PROJECT_PATH_UNAVAILABLE",
      path,
      `无法读取 ${path}；请检查权限后重试。`,
      [],
      { cause },
    );
  }
  const projectBytes = decodeUtf8(
    projectBuffer,
    join(projectDirectory, "project.json"),
    "project.json",
    false,
  );
  const videoBytes = decodeUtf8(
    videoBuffer,
    join(projectDirectory, "video.md"),
    "video.md",
    true,
  );
  const projectPath = join(projectDirectory, "project.json");
  const parsedProject = parseControlJson(
    projectBytes,
    projectPath,
    "project.json",
    PROJECT_JSON_LIMITS,
  );
  const projectValidation = validateProjectDsl(parsedProject);
  if (projectValidation.project === undefined) {
    throw invalidContent(projectPath, projectValidation.diagnostics);
  }
  let tts: ProjectTtsState;
  try {
    tts = await readProjectTtsConfig(projectDirectory);
  } catch (cause) {
    if (cause instanceof ProjectTtsConfigError) {
      throw invalidControlFile(cause.path, {
        code: cause.code,
        component: "tts.json",
        jsonPath: "$",
        message: cause.message,
      }, { cause });
    }
    throw cause;
  }
  const { assetStates, speechStates, timeline, warnings } = await validateProjectVNextResources(
    projectDirectory,
    projectValidation.project,
    {
      ...(tts.status === "configured" ? { currentTtsProfileId: tts.profileId } : {}),
      probeSpeechDurationMs: options.probeSpeechDurationMs,
    },
  );
  return {
    projectDirectory,
    manifest: manifest as ProjectManifestVNext,
    project: projectValidation.project,
    projectRevision: `sha256:${createHash("sha256").update(projectBuffer).digest("hex")}`,
    videoBrief: videoBytes,
    videoBriefRevision: `sha256:${createHash("sha256").update(videoBuffer).digest("hex")}`,
    renderPrograms: { directories: renderProgramDirectories },
    assetStates,
    tts,
    speechStates,
    timeline,
    warnings,
  };
}

import * as z from "zod";

export const CURRENT_SCHEMA_VERSION = 1 as const;
export const CURRENT_TTS_PROFILE_ID = "narracut-mandarin-news-v1" as const;

const PROJECT_RELATIVE_PATH_PATTERN =
  /^(?!\/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\/\/)(?!.*\\)(?!.*\0)(?!.*%[0-9A-Fa-f]{2})(?!.*(?:^|\/)\.{1,2}(?:\/|$)).+$/;
const SOURCE_TEXT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

const projectRelativePathSchema = z
  .string()
  .regex(
    PROJECT_RELATIVE_PATH_PATTERN,
    "必须是 POSIX 项目相对路径，且不得含绝对路径、反斜杠、空段、.、..、NUL 或 URL 编码",
  )
  .describe("相对项目根的 POSIX 路径；不能是绝对路径或 URL。");

const stableIdSchema = z
  .uuid()
  .describe("由应用生成的稳定 UUID；重排、改内容或移动文件都不改变它。");

const nonNormalizedTextSchema = z
  .string()
  .describe("原样持久化的文本；不得 trim 或做 Unicode 归一化。");

const imageAssetSchema = z.strictObject({
  id: stableIdSchema,
  kind: z.literal("image"),
  path: projectRelativePathSchema.describe(
    "规范化 8-bit sRGB PNG 的项目相对路径。",
  ),
});

const videoAssetSchema = z.strictObject({
  id: stableIdSchema,
  kind: z.literal("video"),
  path: projectRelativePathSchema.describe("规范化 H.264 MP4 的项目相对路径。"),
});

export const assetSchema = z
  .discriminatedUnion("kind", [imageAssetSchema, videoAssetSchema])
  .describe("项目内集中登记的规范化 Asset；不记录导入源或媒体探测事实。");

const stepCaptionSchema = z.strictObject({
  kind: z.literal("step"),
  number: nonNormalizedTextSchema.describe(
    "展示用步骤编号，例如 02 或 3a；不参与计算。",
  ),
  name: nonNormalizedTextSchema.describe("步骤名。"),
});

const alertCaptionSchema = z.strictObject({
  kind: z.literal("alert"),
  text: nonNormalizedTextSchema.describe("警示文字。"),
});

export const captionSchema = z
  .discriminatedUnion("kind", [stepCaptionSchema, alertCaptionSchema])
  .describe("叠在 Image 或 Video 上的 Step 或 Alert 信息块；不含坐标。");

const titleVisualSchema = z.strictObject({
  type: z.literal("title"),
  device: nonNormalizedTextSchema.describe("设备名与型号。"),
  headline: nonNormalizedTextSchema.describe("操作主题。"),
  subheadline: nonNormalizedTextSchema
    .optional()
    .describe("可选副标题；清空时删除字段。"),
});

const imageVisualSchema = z.strictObject({
  type: z.literal("image"),
  assetId: stableIdSchema
    .optional()
    .describe("缺省表示尚未绑定 Asset 的可保存草稿。"),
});

const imageCaptionVisualSchema = z.strictObject({
  type: z.literal("image-caption"),
  assetId: stableIdSchema
    .optional()
    .describe("缺省表示尚未绑定 Asset 的可保存草稿。"),
  caption: captionSchema,
});

const videoVisualSchema = z.strictObject({
  type: z.literal("video"),
  assetId: stableIdSchema
    .optional()
    .describe("缺省表示尚未绑定 Asset 的可保存草稿。"),
});

const videoCaptionVisualSchema = z.strictObject({
  type: z.literal("video-caption"),
  assetId: stableIdSchema
    .optional()
    .describe("缺省表示尚未绑定 Asset 的可保存草稿。"),
  caption: captionSchema,
});

const endCardVisualSchema = z.strictObject({
  type: z.literal("end-card"),
  title: nonNormalizedTextSchema.describe("片尾标题。"),
  bullets: z
    .array(nonNormalizedTextSchema)
    .describe("手写的要点列表；Render-ready 时必须有 3–5 条有效要点。"),
});

export const visualSchema = z
  .discriminatedUnion("type", [
    titleVisualSchema,
    imageVisualSchema,
    imageCaptionVisualSchema,
    videoVisualSchema,
    videoCaptionVisualSchema,
    endCardVisualSchema,
  ])
  .describe("六种 V1 Visual Type 的严格判别联合；只保存当前 type 的字段。");

export const speechSchema = z.strictObject({
  path: projectRelativePathSchema.describe("固定为 speech/<sceneId>.mp3。"),
  durationMs: z
    .number()
    .int()
    .positive()
    .describe("TTS 响应给出的完整 Speech 毫秒时长。"),
  sourceTextHash: z
    .string()
    .regex(SOURCE_TEXT_HASH_PATTERN)
    .describe("实际发送给 TTS 的精确 UTF-8 文本之 SHA-256。"),
  ttsProfileId: z
    .string()
    .min(1)
    .describe("应用级、版本化的 TTS 合成配置逻辑名；不暴露供应商路由。"),
});

export const sceneSchema = z.strictObject({
  id: stableIdSchema,
  narration: z.strictObject({
    text: nonNormalizedTextSchema,
  }),
  speech: speechSchema
    .optional()
    .describe("缺 Speech 时省略整个字段，不能写 null。"),
  visual: visualSchema,
  transition: z.literal("cut").describe("V1 唯一转场；仍逐 Scene 显式持久化。"),
});

export const projectV1Schema = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    metadata: z.strictObject({
      name: nonNormalizedTextSchema
        .optional()
        .describe("可选项目名；清空时删除字段。"),
      logoAssetId: stableIdSchema
        .optional()
        .describe("可选项目级 Logo；必须引用 image Asset。"),
    }),
    assets: z.array(assetSchema).describe("Asset 集中登记表；数组可为空。"),
    scenes: z.array(sceneSchema).describe("数组顺序就是播放顺序；数组可为空。"),
  })
  .meta({
    id: "https://narracut.local/schema/project-v1.json",
    title: "Narracut Project DSL v1",
    description:
      "V1 project.json 的结构 Schema。固定的 1920×1080、30fps 与派生时间线不进入 DSL。",
  });

export type Asset = z.infer<typeof assetSchema>;
export type Caption = z.infer<typeof captionSchema>;
export type Visual = z.infer<typeof visualSchema>;
export type Speech = z.infer<typeof speechSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type ProjectV1 = z.infer<typeof projectV1Schema>;

export type Diagnostic = {
  code: string;
  severity: "error" | "warning";
  path: Array<string | number>;
  message: string;
  sceneId?: string;
  assetId?: string;
  relativePath?: string;
  absolutePath?: string;
};

export type StructuralValidationResult =
  | { success: true; project: ProjectV1; diagnostics: [] }
  | { success: false; diagnostics: Diagnostic[] };

export function validateProjectStructure(
  input: unknown,
): StructuralValidationResult {
  const result = projectV1Schema.safeParse(input);

  if (result.success) {
    return { success: true, project: result.data, diagnostics: [] };
  }

  return {
    success: false,
    diagnostics: result.error.issues.map((issue) => ({
      code: "DSL_STRUCTURE_INVALID",
      severity: "error",
      path: issue.path.map((segment) =>
        typeof segment === "string" || typeof segment === "number"
          ? segment
          : String(segment),
      ),
      message: issue.message,
    })),
  };
}

function visualAssetReference(visual: Visual): string | undefined {
  switch (visual.type) {
    case "image":
    case "image-caption":
    case "video":
    case "video-caption":
      return visual.assetId;
    case "title":
    case "end-card":
      return undefined;
  }
}

function expectedAssetKind(visual: Visual): Asset["kind"] | undefined {
  switch (visual.type) {
    case "image":
    case "image-caption":
      return "image";
    case "video":
    case "video-caption":
      return "video";
    case "title":
    case "end-card":
      return undefined;
  }
}

export function validateProjectConsistency(project: ProjectV1): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const assetsById = new Map<string, Asset>();
  const seenSceneIds = new Set<string>();

  project.assets.forEach((asset, index) => {
    if (assetsById.has(asset.id)) {
      diagnostics.push({
        code: "ASSET_ID_DUPLICATE",
        severity: "error",
        path: ["assets", index, "id"],
        message: `Asset ID 重复：${asset.id}`,
        assetId: asset.id,
      });
    } else {
      assetsById.set(asset.id, asset);
    }
  });

  if (project.metadata.logoAssetId !== undefined) {
    const logo = assetsById.get(project.metadata.logoAssetId);
    if (logo === undefined) {
      diagnostics.push({
        code: "LOGO_ASSET_MISSING",
        severity: "error",
        path: ["metadata", "logoAssetId"],
        message: "Logo 引用了不存在的 Asset。",
        assetId: project.metadata.logoAssetId,
      });
    } else if (logo.kind !== "image") {
      diagnostics.push({
        code: "LOGO_ASSET_KIND_MISMATCH",
        severity: "error",
        path: ["metadata", "logoAssetId"],
        message: "Logo 必须引用 image Asset。",
        assetId: logo.id,
        relativePath: logo.path,
      });
    }
  }

  project.scenes.forEach((scene, index) => {
    if (seenSceneIds.has(scene.id)) {
      diagnostics.push({
        code: "SCENE_ID_DUPLICATE",
        severity: "error",
        path: ["scenes", index, "id"],
        message: `Scene ID 重复：${scene.id}`,
        sceneId: scene.id,
      });
    } else {
      seenSceneIds.add(scene.id);
    }

    const assetId = visualAssetReference(scene.visual);
    const kind = expectedAssetKind(scene.visual);
    if (assetId !== undefined) {
      const asset = assetsById.get(assetId);
      if (asset === undefined) {
        diagnostics.push({
          code: "SCENE_ASSET_MISSING",
          severity: "error",
          path: ["scenes", index, "visual", "assetId"],
          message: "Scene 引用了不存在的 Asset。",
          sceneId: scene.id,
          assetId,
        });
      } else if (asset.kind !== kind) {
        diagnostics.push({
          code: "SCENE_ASSET_KIND_MISMATCH",
          severity: "error",
          path: ["scenes", index, "visual", "assetId"],
          message: `${scene.visual.type} 必须引用 ${kind} Asset。`,
          sceneId: scene.id,
          assetId,
          relativePath: asset.path,
        });
      }
    }

    if (scene.speech !== undefined) {
      const expectedPath = `speech/${scene.id}.mp3`;
      if (scene.speech.path !== expectedPath) {
        diagnostics.push({
          code: "SPEECH_PATH_MISMATCH",
          severity: "error",
          path: ["scenes", index, "speech", "path"],
          message: `Speech 路径必须是 ${expectedPath}。`,
          sceneId: scene.id,
          relativePath: scene.speech.path,
        });
      }
    }
  });

  return diagnostics;
}

async function sha256Utf8(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export async function validateSpeechFreshness(
  project: ProjectV1,
  currentTtsProfileId: string,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const [index, scene] of project.scenes.entries()) {
    if (scene.speech === undefined) continue;

    const currentTextHash = await sha256Utf8(scene.narration.text);
    if (scene.speech.sourceTextHash !== currentTextHash) {
      diagnostics.push({
        code: "SPEECH_SOURCE_TEXT_MISMATCH",
        severity: "error",
        path: ["scenes", index, "speech", "sourceTextHash"],
        message: "Speech 与当前 Narration 文本不匹配，应视为缺失。",
        sceneId: scene.id,
        relativePath: scene.speech.path,
      });
    }

    if (scene.speech.ttsProfileId !== currentTtsProfileId) {
      diagnostics.push({
        code: "SPEECH_TTS_PROFILE_MISMATCH",
        severity: "error",
        path: ["scenes", index, "speech", "ttsProfileId"],
        message: "Speech 与当前 TTS profile 不匹配，应视为缺失。",
        sceneId: scene.id,
        relativePath: scene.speech.path,
      });
    }
  }

  return diagnostics;
}

export const projectV1JsonSchema = z.toJSONSchema(projectV1Schema, {
  target: "draft-2020-12",
  reused: "ref",
});

export function readSchemaVersion(input: unknown): number {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("project.json 顶层必须是对象。");
  }

  const schemaVersion = Reflect.get(input, "schemaVersion");
  if (!Number.isInteger(schemaVersion)) {
    throw new Error("project.json 缺少整数 schemaVersion。");
  }

  return schemaVersion as number;
}

export function migrateKnownProjectToCurrent(input: unknown): ProjectV1 {
  const schemaVersion = readSchemaVersion(input);

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `项目 schemaVersion=${schemaVersion} 比当前应用支持的版本新；必须升级应用，且不得写回原文件。`,
    );
  }

  if (schemaVersion < CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `缺少从 schemaVersion=${schemaVersion} 到 ${CURRENT_SCHEMA_VERSION} 的连续迁移函数。`,
    );
  }

  return projectV1Schema.parse(input);
}

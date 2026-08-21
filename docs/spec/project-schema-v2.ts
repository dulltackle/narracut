import * as z from "zod";

import { sha256Utf8 } from "../../src/shared/sha256";

import {
  CURRENT_TTS_PROFILE_ID,
  assetSchema,
  nonNormalizedTextSchema,
  readSchemaVersion,
  speechSchema,
  stableIdSchema,
  validateProjectStructure as validateProjectV1Structure,
  type Asset,
  type Diagnostic,
  type ProjectV1,
} from "./project-schema-v1";

export { CURRENT_TTS_PROFILE_ID, readSchemaVersion };
export type { Asset, Diagnostic };

export const CURRENT_SCHEMA_VERSION = 2 as const;

const nonBlankTextSchema = nonNormalizedTextSchema.refine(
  (text) => text.trim().length > 0,
  "必须包含非空白文字。",
);

export const captionSchema = z
  .strictObject({
    text: nonBlankTextSchema.describe("Caption 正文。"),
  })
  .describe("Image 或 Video 上的可选单段文字信息块；不记录内容用途。");

const cardVisualSchema = z
  .strictObject({
    type: z.literal("card"),
    label: nonBlankTextSchema.optional().describe("可选的小标签。"),
    title: nonBlankTextSchema.optional().describe("可选的主标题。"),
    body: nonBlankTextSchema.optional().describe("可选的正文。"),
    items: z
      .array(nonBlankTextSchema)
      .min(1)
      .optional()
      .describe("可选的非空列表。"),
  })
  .refine(
    (visual) =>
      visual.label !== undefined ||
      visual.title !== undefined ||
      visual.body !== undefined ||
      visual.items !== undefined,
    "Card 的 label、title、body 或 items 至少有一项。",
  );

const imageVisualSchema = z.strictObject({
  type: z.literal("image"),
  assetId: stableIdSchema
    .optional()
    .describe("缺省表示尚未绑定 Asset 的可保存草稿。"),
  caption: captionSchema.optional(),
});

const videoVisualSchema = z.strictObject({
  type: z.literal("video"),
  assetId: stableIdSchema
    .optional()
    .describe("缺省表示尚未绑定 Asset 的可保存草稿。"),
  caption: captionSchema.optional(),
});

export const visualSchema = z
  .union([cardVisualSchema, imageVisualSchema, videoVisualSchema])
  .describe("Card、Image、Video 三种 V2 Visual Type；只保存当前 type 的字段。");

export const sceneSchema = z.strictObject({
  id: stableIdSchema,
  narration: z.strictObject({
    text: nonNormalizedTextSchema,
  }),
  speech: speechSchema
    .optional()
    .describe("缺 Speech 时省略整个字段，不能写 null。"),
  visual: visualSchema,
  transition: z.literal("cut").describe("唯一转场；仍逐 Scene 显式持久化。"),
});

export const projectV2Schema = z
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
    id: "https://narracut.local/schema/project-v2.json",
    title: "Narracut Project DSL v2",
    description:
      "V2 project.json 的结构 Schema。内容中立 Visual 与派生时间线之外的表现参数不进入本版本。",
  });

export type Caption = z.infer<typeof captionSchema>;
export type Visual = z.infer<typeof visualSchema>;
export type Speech = z.infer<typeof speechSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Project = z.infer<typeof projectV2Schema>;
export type ProjectV2 = Project;

export type StructuralValidationResult =
  | { success: true; project: Project; diagnostics: [] }
  | { success: false; diagnostics: Diagnostic[] };

export function validateProjectStructure(
  input: unknown,
): StructuralValidationResult {
  const result = projectV2Schema.safeParse(input);

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
  return visual.type === "card" ? undefined : visual.assetId;
}

function expectedAssetKind(visual: Visual): Asset["kind"] | undefined {
  return visual.type === "card" ? undefined : visual.type;
}

export function validateProjectConsistency(project: Project): Diagnostic[] {
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

export async function validateSpeechFreshness(
  project: Project,
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

function nonBlank(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

function migrateLegacyCaption(
  caption: Extract<ProjectV1["scenes"][number]["visual"], { caption: unknown }>["caption"],
): Caption | undefined {
  const text = caption.kind === "step" ? caption.name : caption.text;
  return text.trim() === "" ? undefined : { text };
}

function migrateLegacyVisual(
  visual: ProjectV1["scenes"][number]["visual"],
): Visual {
  switch (visual.type) {
    case "title": {
      const migrated = {
        type: "card" as const,
        label: nonBlank(visual.device),
        title: nonBlank(visual.headline),
        body: nonBlank(visual.subheadline),
      };
      const card = Object.fromEntries(
        Object.entries(migrated).filter(([, value]) => value !== undefined),
      ) as unknown as Visual;
      return Object.keys(card).length === 1 ? { type: "image" } : card;
    }
    case "end-card": {
      const title = nonBlank(visual.title);
      const items = visual.bullets.filter((item) => item.trim() !== "");
      const card: Visual = {
        type: "card",
        ...(title === undefined ? {} : { title }),
        ...(items.length === 0 ? {} : { items }),
      };
      return Object.keys(card).length === 1 ? { type: "image" } : card;
    }
    case "image":
    case "video":
      return {
        type: visual.type,
        ...(visual.assetId === undefined ? {} : { assetId: visual.assetId }),
      };
    case "image-caption":
    case "video-caption": {
      const caption = migrateLegacyCaption(visual.caption);
      return {
        type: visual.type === "image-caption" ? "image" : "video",
        ...(visual.assetId === undefined ? {} : { assetId: visual.assetId }),
        ...(caption === undefined ? {} : { caption }),
      };
    }
  }
}

export function migrateProjectV1ToV2(project: ProjectV1): Project {
  const migrated = {
    ...project,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      visual: migrateLegacyVisual(scene.visual),
    })),
  };
  const structure = validateProjectStructure(migrated);
  if (!structure.success) throw new ProjectMigrationError(structure.diagnostics);
  return structure.project;
}

export function migrateKnownProjectToCurrent(input: unknown): Project {
  const schemaVersion = readSchemaVersion(input);

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `项目 schemaVersion=${schemaVersion} 比当前应用支持的版本新；必须升级应用，且不得写回原文件。`,
    );
  }

  if (schemaVersion === 1) {
    const legacy = validateProjectV1Structure(input);
    if (!legacy.success) throw new ProjectMigrationError(legacy.diagnostics);
    return migrateProjectV1ToV2(legacy.project);
  }

  const current = validateProjectStructure(input);
  if (!current.success) throw new ProjectMigrationError(current.diagnostics);
  return current.project;
}

export class ProjectMigrationError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics[0]?.message ?? "Project DSL 迁移失败。");
    this.name = "ProjectMigrationError";
  }
}

export const projectV2JsonSchema = z.toJSONSchema(projectV2Schema, {
  target: "draft-2020-12",
  reused: "ref",
});

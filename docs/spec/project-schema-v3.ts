import * as z from "zod";

import {
  assetSchema,
  nonNormalizedTextSchema,
  readSchemaVersion,
  speechSchema,
  stableIdSchema,
  validateProjectStructure as validateProjectV1Structure,
  type Asset,
  type Diagnostic,
} from "./project-schema-v1";
import {
  migrateProjectV1ToV2,
  projectV2Schema,
  validateSpeechFreshness as validateProjectV2SpeechFreshness,
  validateProjectConsistency as validateProjectV2Consistency,
  validateProjectStructure as validateProjectV2Structure,
  type ProjectV2,
} from "./project-schema-v2";
import {
  DEFAULT_PROJECT_THEME,
  contrastRatio,
  evaluateTextLayout,
  findUnsupportedFontCodePoints,
  FONT_PRESETS,
  getTextStylePreset,
  TEXT_MOTION_PRESETS,
  TEXT_STYLE_PRESETS,
} from "../../src/shared/text-presets";

export { CURRENT_TTS_PROFILE_ID } from "./project-schema-v2";
export { DEFAULT_PROJECT_THEME, readSchemaVersion };
export type { Asset, Diagnostic };

export const CURRENT_SCHEMA_VERSION = 3 as const;

const nonBlankTextSchema = nonNormalizedTextSchema.refine(
  (text) => text.trim().length > 0,
  "必须包含非空白文字。",
);
const presetIdSchema = nonBlankTextSchema.describe(
  "带命名空间和版本的 Preset ID；未知 ID 仍须原样保留并由一致性诊断报告。",
);
const colorSchema = z
  .string()
  .regex(/^#[0-9A-F]{6}$/u, "强调色必须是 #RRGGBB 格式的大写十六进制颜色。")
  .describe("受控、不含 alpha 的品牌强调色。");

export const projectThemeSchema = z.strictObject({
  presetId: presetIdSchema,
  defaultTextStyleId: presetIdSchema,
  defaultTextMotionId: presetIdSchema,
  accentColor: colorSchema,
  fontId: presetIdSchema,
  logoAssetId: stableIdSchema.optional(),
});

export const captionSchema = z.strictObject({
  text: nonBlankTextSchema,
  textStyleId: presetIdSchema.optional(),
  textMotionId: presetIdSchema.optional(),
});

const textOverrides = {
  textStyleId: presetIdSchema.optional(),
  textMotionId: presetIdSchema.optional(),
};

const cardVisualSchema = z
  .strictObject({
    type: z.literal("card"),
    label: nonBlankTextSchema.optional(),
    title: nonBlankTextSchema.optional(),
    body: nonBlankTextSchema.optional(),
    items: z.array(nonBlankTextSchema).min(1).optional(),
    ...textOverrides,
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
  assetId: stableIdSchema.optional(),
  caption: captionSchema.optional(),
});

const videoVisualSchema = z.strictObject({
  type: z.literal("video"),
  assetId: stableIdSchema.optional(),
  caption: captionSchema.optional(),
});

export const visualSchema = z.union([
  cardVisualSchema,
  imageVisualSchema,
  videoVisualSchema,
]);

export const sceneSchema = z.strictObject({
  id: stableIdSchema,
  narration: z.strictObject({ text: nonNormalizedTextSchema }),
  speech: speechSchema.optional(),
  visual: visualSchema,
  transition: z.literal("cut"),
});

export const projectV3Schema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  metadata: z.strictObject({ name: nonNormalizedTextSchema.optional() }),
  theme: projectThemeSchema,
  assets: z.array(assetSchema),
  scenes: z.array(sceneSchema),
});

export type Caption = z.infer<typeof captionSchema>;
export type Visual = z.infer<typeof visualSchema>;
export type Speech = z.infer<typeof speechSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Project = z.infer<typeof projectV3Schema>;
export type ProjectV3 = Project;

export type StructuralValidationResult =
  | { success: true; project: Project; diagnostics: [] }
  | { success: false; diagnostics: Diagnostic[] };

export function validateProjectStructure(
  input: unknown,
): StructuralValidationResult {
  const result = projectV3Schema.safeParse(input);
  if (result.success) return { success: true, project: result.data, diagnostics: [] };
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

function asProjectV2(project: Project): ProjectV2 {
  return projectV2Schema.parse({
    schemaVersion: 2,
    metadata: {
      ...project.metadata,
      ...(project.theme.logoAssetId === undefined
        ? {}
        : { logoAssetId: project.theme.logoAssetId }),
    },
    assets: project.assets,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      visual:
        scene.visual.type === "card"
          ? {
              type: "card" as const,
              ...(scene.visual.label === undefined ? {} : { label: scene.visual.label }),
              ...(scene.visual.title === undefined ? {} : { title: scene.visual.title }),
              ...(scene.visual.body === undefined ? {} : { body: scene.visual.body }),
              ...(scene.visual.items === undefined ? {} : { items: scene.visual.items }),
            }
          : {
              type: scene.visual.type,
              ...(scene.visual.assetId === undefined ? {} : { assetId: scene.visual.assetId }),
              ...(scene.visual.caption === undefined
                ? {}
                : { caption: { text: scene.visual.caption.text } }),
            },
    })),
  });
}

export function validateProjectConsistency(project: Project): Diagnostic[] {
  const diagnostics = validateProjectV2Consistency(asProjectV2(project)).map((diagnostic) =>
    diagnostic.path[0] === "metadata" && diagnostic.path[1] === "logoAssetId"
      ? { ...diagnostic, path: ["theme", "logoAssetId"] }
      : diagnostic,
  );
  const styleIds = new Set(TEXT_STYLE_PRESETS.map((preset) => preset.id));
  const motionIds = new Set(TEXT_MOTION_PRESETS.map((preset) => preset.id));
  const fontIds = new Set(FONT_PRESETS.map((preset) => preset.id));
  if (project.theme.presetId !== DEFAULT_PROJECT_THEME.presetId) {
    diagnostics.push({
      code: "PROJECT_THEME_PRESET_MISSING",
      severity: "error",
      path: ["theme", "presetId"],
      message: `缺少 Project Theme Preset：${project.theme.presetId}`,
    });
  }
  if (!styleIds.has(project.theme.defaultTextStyleId)) {
    diagnostics.push({
      code: "TEXT_STYLE_PRESET_MISSING",
      severity: "error",
      path: ["theme", "defaultTextStyleId"],
      message: `缺少 Text Style Preset：${project.theme.defaultTextStyleId}`,
    });
  }
  if (!motionIds.has(project.theme.defaultTextMotionId)) {
    diagnostics.push({
      code: "TEXT_MOTION_PRESET_MISSING",
      severity: "error",
      path: ["theme", "defaultTextMotionId"],
      message: `缺少 Text Motion Preset：${project.theme.defaultTextMotionId}`,
    });
  }
  if (!fontIds.has(project.theme.fontId)) {
    diagnostics.push({
      code: "THEME_FONT_MISSING",
      severity: "error",
      path: ["theme", "fontId"],
      message: `字体无法加载：${project.theme.fontId}`,
    });
  }
  if (contrastRatio(project.theme.accentColor, "#0F172A") < 3) {
    diagnostics.push({
      code: "THEME_ACCENT_CONTRAST_LOW",
      severity: "warning",
      path: ["theme", "accentColor"],
      message: "强调色与文字面板底色的对比度偏低，请在 Player 中判断是否更换。",
    });
  }
  project.scenes.forEach((scene, index) => {
    const visibleTextFields: Array<{ value: string; path: Array<string | number> }> = [
      {
        value: scene.narration.text,
        path: ["scenes", index, "narration", "text"],
      },
    ];
    if (scene.visual.type === "card") {
      if (scene.visual.label !== undefined) {
        visibleTextFields.push({
          value: scene.visual.label,
          path: ["scenes", index, "visual", "label"],
        });
      }
      if (scene.visual.title !== undefined) {
        visibleTextFields.push({
          value: scene.visual.title,
          path: ["scenes", index, "visual", "title"],
        });
      }
      if (scene.visual.body !== undefined) {
        visibleTextFields.push({
          value: scene.visual.body,
          path: ["scenes", index, "visual", "body"],
        });
      }
      scene.visual.items?.forEach((item, itemIndex) => {
        visibleTextFields.push({
          value: item,
          path: ["scenes", index, "visual", "items", itemIndex],
        });
      });
    } else if (scene.visual.caption !== undefined) {
      visibleTextFields.push({
        value: scene.visual.caption.text,
        path: ["scenes", index, "visual", "caption", "text"],
      });
    }
    visibleTextFields.forEach(({ value, path }) => {
      findUnsupportedFontCodePoints(value).forEach(({ character, codePoint }) => {
        diagnostics.push({
          code: "FONT_COVERAGE_UNSUPPORTED",
          severity: "error",
          path,
          message: `项目字体不覆盖字符“${character}”（U+${codePoint.toString(16).toUpperCase()}）；请替换该字符后再渲染。`,
          sceneId: scene.id,
          character,
          codePoint,
          origins: ["font"],
        });
      });
    });
    const overrides =
      scene.visual.type === "card" ? scene.visual : scene.visual.caption;
    if (overrides?.textStyleId !== undefined && !styleIds.has(overrides.textStyleId)) {
      diagnostics.push({
        code: "TEXT_STYLE_PRESET_MISSING",
        severity: "error",
        path: ["scenes", index, "visual", ...(scene.visual.type === "card" ? [] : ["caption"]), "textStyleId"],
        message: `缺少 Text Style Preset：${overrides.textStyleId}`,
        sceneId: scene.id,
      });
    }
    if (overrides?.textMotionId !== undefined && !motionIds.has(overrides.textMotionId)) {
      diagnostics.push({
        code: "TEXT_MOTION_PRESET_MISSING",
        severity: "error",
        path: ["scenes", index, "visual", ...(scene.visual.type === "card" ? [] : ["caption"]), "textMotionId"],
        message: `缺少 Text Motion Preset：${overrides.textMotionId}`,
        sceneId: scene.id,
      });
    }
    const resolvedStyleId = overrides?.textStyleId ?? project.theme.defaultTextStyleId;
    const style = getTextStylePreset(resolvedStyleId);
    if (style !== undefined) {
      const content =
        scene.visual.type === "card"
          ? scene.visual
          : scene.visual.caption === undefined
            ? undefined
            : { body: scene.visual.caption.text };
      if (content !== undefined && evaluateTextLayout(style, content).overflow) {
        diagnostics.push({
          code: "TEXT_SAFE_AREA_OVERFLOW",
          severity: "error",
          path: ["scenes", index, "visual"],
          message: "文字在缩放至安全下限后仍超出 80px 安全区，请更换 Style 或精简内容。",
          sceneId: scene.id,
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
  return validateProjectV2SpeechFreshness(asProjectV2(project), currentTtsProfileId);
}

export function migrateProjectV2ToV3(project: ProjectV2): Project {
  const { logoAssetId, ...metadata } = project.metadata;
  const migrated = {
    ...project,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    metadata,
    theme: {
      ...DEFAULT_PROJECT_THEME,
      ...(logoAssetId === undefined ? {} : { logoAssetId }),
    },
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
    const v1 = validateProjectV1Structure(input);
    if (!v1.success) throw new ProjectMigrationError(v1.diagnostics);
    return migrateProjectV2ToV3(migrateProjectV1ToV2(v1.project));
  }
  if (schemaVersion === 2) {
    const v2 = validateProjectV2Structure(input);
    if (!v2.success) throw new ProjectMigrationError(v2.diagnostics);
    return migrateProjectV2ToV3(v2.project);
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

export const projectV3JsonSchema = z.toJSONSchema(projectV3Schema, {
  target: "draft-2020-12",
  reused: "ref",
});

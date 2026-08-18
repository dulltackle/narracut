import { describe, expect, it } from "vitest";

import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_PROJECT_THEME,
  migrateKnownProjectToCurrent,
  validateProjectConsistency,
  validateProjectStructure,
} from "../src/shared/project";

const sceneId = "60000000-0000-4000-8000-000000000001";

describe("Project DSL V3", () => {
  it("把 V2 连续纯迁移为带版本化 Project Theme 的 V3", () => {
    const v2 = {
      schemaVersion: 2,
      metadata: { name: "文字表现迁移" },
      assets: [],
      scenes: [
        {
          id: sceneId,
          narration: { text: "保持内容中立" },
          visual: { type: "card", title: "章节标题" },
          transition: "cut",
        },
      ],
    };

    const migrated = migrateKnownProjectToCurrent(v2);

    expect(CURRENT_SCHEMA_VERSION).toBe(3);
    expect(migrated).toEqual({
      ...v2,
      schemaVersion: 3,
      theme: DEFAULT_PROJECT_THEME,
    });
    expect(v2).toEqual({
      schemaVersion: 2,
      metadata: { name: "文字表现迁移" },
      assets: [],
      scenes: [
        {
          id: sceneId,
          narration: { text: "保持内容中立" },
          visual: { type: "card", title: "章节标题" },
          transition: "cut",
        },
      ],
    });
    expect(validateProjectStructure(migrated).success).toBe(true);
    expect(validateProjectConsistency(migrated)).toEqual([]);
  });

  it("原样保留未知 Preset ID，并用可定位诊断阻止渲染前通过", () => {
    const project = {
      schemaVersion: 3,
      metadata: {},
      theme: {
        ...DEFAULT_PROJECT_THEME,
        defaultTextStyleId: "vendor/missing-style@7",
      },
      assets: [],
      scenes: [
        {
          id: sceneId,
          narration: { text: "未知版本仍然可恢复" },
          visual: {
            type: "card",
            title: "保持原 ID",
            textMotionId: "vendor/missing-motion@2",
          },
          transition: "cut",
        },
      ],
    };

    const structure = validateProjectStructure(project);
    expect(structure.success).toBe(true);
    if (!structure.success) return;
    expect(structure.project.theme.defaultTextStyleId).toBe(
      "vendor/missing-style@7",
    );
    expect(structure.project.scenes[0].visual).toMatchObject({
      textMotionId: "vendor/missing-motion@2",
    });
    expect(validateProjectConsistency(structure.project)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TEXT_STYLE_PRESET_MISSING",
          path: ["theme", "defaultTextStyleId"],
        }),
        expect.objectContaining({
          code: "TEXT_MOTION_PRESET_MISSING",
          path: ["scenes", 0, "visual", "textMotionId"],
          sceneId,
        }),
      ]),
    );
  });

  it("把低对比强调色作为提醒，并阻断安全缩放后仍溢出的文字", () => {
    const structure = validateProjectStructure({
      schemaVersion: 3,
      metadata: {},
      theme: { ...DEFAULT_PROJECT_THEME, accentColor: "#0F172A" },
      assets: [],
      scenes: [
        {
          id: sceneId,
          narration: { text: "版面诊断" },
          visual: { type: "card", body: "很长的正文".repeat(120) },
          transition: "cut",
        },
      ],
    });
    expect(structure.success).toBe(true);
    if (!structure.success) return;

    expect(validateProjectConsistency(structure.project)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "THEME_ACCENT_CONTRAST_LOW",
          severity: "warning",
          path: ["theme", "accentColor"],
        }),
        expect.objectContaining({
          code: "TEXT_SAFE_AREA_OVERFLOW",
          severity: "error",
          sceneId,
        }),
      ]),
    );
  });

  it("把内置字体未覆盖的字符与码位作为可定位提醒", () => {
    const structure = validateProjectStructure({
      schemaVersion: 3,
      metadata: {},
      theme: DEFAULT_PROJECT_THEME,
      assets: [],
      scenes: [
        {
          id: sceneId,
          narration: { text: "不支持字符：\u{10FFFF}" },
          visual: { type: "card", title: "字体覆盖" },
          transition: "cut",
        },
      ],
    });
    expect(structure.success).toBe(true);
    if (!structure.success) return;

    expect(validateProjectConsistency(structure.project)).toContainEqual(
      expect.objectContaining({
        code: "FONT_COVERAGE_UNSUPPORTED",
        severity: "warning",
        path: ["scenes", 0, "narration", "text"],
        sceneId,
        message: expect.stringContaining("U+10FFFF"),
      }),
    );
  });
});

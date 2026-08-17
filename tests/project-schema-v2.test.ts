import { describe, expect, it } from "vitest";

import {
  CURRENT_SCHEMA_VERSION,
  migrateKnownProjectToCurrent,
  validateProjectConsistency,
  validateProjectStructure,
} from "../src/shared/project";

const ids = {
  image: "10000000-0000-4000-8000-000000000001",
  video: "10000000-0000-4000-8000-000000000002",
  title: "20000000-0000-4000-8000-000000000001",
  step: "20000000-0000-4000-8000-000000000002",
  alert: "20000000-0000-4000-8000-000000000003",
  end: "20000000-0000-4000-8000-000000000004",
} as const;

function legacyProject() {
  return {
    schemaVersion: 1,
    metadata: { name: "迁移夹具" },
    assets: [
      { id: ids.image, kind: "image", path: "assets/cover.png" },
      { id: ids.video, kind: "video", path: "assets/demo.mp4" },
    ],
    scenes: [
      {
        id: ids.title,
        narration: { text: "开始" },
        visual: {
          type: "title",
          device: "Narracut",
          headline: "操作主题",
          subheadline: "副标题",
        },
        transition: "cut",
      },
      {
        id: ids.step,
        narration: { text: "执行动作" },
        visual: {
          type: "image-caption",
          assetId: ids.image,
          caption: { kind: "step", number: "02", name: "准备连接管" },
        },
        transition: "cut",
      },
      {
        id: ids.alert,
        narration: { text: "注意风险" },
        visual: {
          type: "video-caption",
          assetId: ids.video,
          caption: { kind: "alert", text: "连接前关闭阀门" },
        },
        transition: "cut",
      },
      {
        id: ids.end,
        narration: { text: "结束" },
        visual: {
          type: "end-card",
          title: "操作完成",
          bullets: ["复核连接", "整理工具"],
        },
        transition: "cut",
      },
    ],
  };
}

describe("Project DSL V2", () => {
  it("按规则把 V1 六种 Visual 迁移为 Card、Image、Video", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);

    const migrated = migrateKnownProjectToCurrent(legacyProject());

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.scenes.map((scene) => scene.id)).toEqual([
      ids.title,
      ids.step,
      ids.alert,
      ids.end,
    ]);
    expect(migrated.scenes.map((scene) => scene.narration.text)).toEqual([
      "开始",
      "执行动作",
      "注意风险",
      "结束",
    ]);
    expect(migrated.scenes.map((scene) => scene.visual)).toEqual([
      {
        type: "card",
        label: "Narracut",
        title: "操作主题",
        body: "副标题",
      },
      {
        type: "image",
        assetId: ids.image,
        caption: { text: "准备连接管" },
      },
      {
        type: "video",
        assetId: ids.video,
        caption: { text: "连接前关闭阀门" },
      },
      {
        type: "card",
        title: "操作完成",
        items: ["复核连接", "整理工具"],
      },
    ]);
    expect(validateProjectStructure(migrated).success).toBe(true);
    expect(validateProjectConsistency(migrated)).toEqual([]);
  });

  it("移除只有步骤编号而没有正文的旧 Caption", () => {
    const project = legacyProject();
    project.scenes[1].visual = {
      type: "image-caption",
      assetId: ids.image,
      caption: { kind: "step", number: "02", name: "" },
    };

    const migrated = migrateKnownProjectToCurrent(project);

    expect(migrated.scenes[1].visual).toEqual({
      type: "image",
      assetId: ids.image,
    });
  });

  it("把完全空白的历史 Title 与 EndCard 保留为未绑定 Image 草稿", () => {
    const project = legacyProject();
    project.scenes[0].visual = {
      type: "title",
      device: "",
      headline: "",
      subheadline: "",
    };
    project.scenes[3].visual = { type: "end-card", title: "", bullets: [] };

    const migrated = migrateKnownProjectToCurrent(project);

    expect(migrated.scenes[0].visual).toEqual({ type: "image" });
    expect(migrated.scenes[3].visual).toEqual({ type: "image" });
    expect(migrated.scenes.map((scene) => scene.id)).toEqual([
      ids.title,
      ids.step,
      ids.alert,
      ids.end,
    ]);
    expect(validateProjectStructure(migrated).success).toBe(true);
  });

  it("只接受三种 Visual，并拒绝空 Card、空 Caption 与旧分支", () => {
    const base = {
      schemaVersion: 2,
      metadata: {},
      assets: [],
      scenes: [],
    };
    const scene = {
      id: ids.title,
      narration: { text: "测试" },
      transition: "cut",
    };

    expect(
      validateProjectStructure({
        ...base,
        scenes: [{ ...scene, visual: { type: "card", title: "章节" } }],
      }).success,
    ).toBe(true);
    expect(
      validateProjectStructure({
        ...base,
        scenes: [{ ...scene, visual: { type: "card" } }],
      }).success,
    ).toBe(false);
    expect(
      validateProjectStructure({
        ...base,
        scenes: [
          { ...scene, visual: { type: "image", caption: { text: "" } } },
        ],
      }).success,
    ).toBe(false);
    expect(
      validateProjectStructure({
        ...base,
        scenes: [{ ...scene, visual: { type: "title", headline: "旧类型" } }],
      }).success,
    ).toBe(false);
  });
});

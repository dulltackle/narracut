import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROJECT_THEME,
  TEXT_MOTION_PRESETS,
  TEXT_STYLE_PRESETS,
  type Project,
} from "../src/shared/project";
import {
  createPreviewSnapshot,
  createRenderSnapshot,
  findSceneAtFrame,
  frameForSceneOffset,
  projectMediaUrl,
  VIDEO_FPS,
} from "../src/remotion/render-snapshot";

const project: Project = {
  schemaVersion: 3,
  metadata: { name: "快照夹具" },
  theme: DEFAULT_PROJECT_THEME,
  assets: [],
  scenes: [
    {
      id: "70000000-0000-4000-8000-000000000001",
      narration: { text: "Subtitle 不进入文字 Preset" },
      speech: {
        path: "speech/70000000-0000-4000-8000-000000000001.mp3",
        durationMs: 5000,
        sourceTextHash: `sha256:${"0".repeat(64)}`,
        ttsProfileId: "narracut/test@1",
      },
      visual: {
        type: "card",
        title: "显式覆盖",
        textStyleId: "narracut/spotlight@1",
        textMotionId: "narracut/rise@1",
      },
      transition: "cut",
    },
    {
      id: "70000000-0000-4000-8000-000000000002",
      narration: { text: "Caption 继承项目默认" },
      speech: {
        path: "speech/70000000-0000-4000-8000-000000000002.mp3",
        durationMs: 5000,
        sourceTextHash: `sha256:${"1".repeat(64)}`,
        ttsProfileId: "narracut/test@1",
      },
      visual: { type: "image", caption: { text: "继承默认" } },
      transition: "cut",
    },
  ],
};

describe("Remotion 渲染快照", () => {
  it("冻结严格 DSL，并为 Preview 与 Render 解析同一套 Preset", () => {
    const snapshot = createRenderSnapshot(project, "http://127.0.0.1:3579/media/");

    expect(snapshot.fps).toBe(VIDEO_FPS);
    expect(snapshot.fontFamily).toBe('"Noto Sans SC Variable"');
    expect(snapshot.project).not.toBe(project);
    expect(snapshot.scenes).toMatchObject([
      {
        textPresentation: {
          styleId: "narracut/spotlight@1",
          motionId: "narracut/rise@1",
          inheritedStyle: false,
          inheritedMotion: false,
        },
      },
      {
        textPresentation: {
          styleId: "narracut/panel@1",
          motionId: "narracut/fade@1",
          inheritedStyle: true,
          inheritedMotion: true,
        },
      },
    ]);
    expect(snapshot.scenes[0]).not.toHaveProperty("subtitlePresentation");
    expect(snapshot.durationInFrames).toBe(300);
  });

  it("允许三种 Style 与四种 Motion 任意组合", () => {
    const combinations = TEXT_STYLE_PRESETS.flatMap((style) =>
      TEXT_MOTION_PRESETS.map((motion, index) => ({
        style,
        motion,
        scene: {
          id: `70000000-0000-4000-8000-${String(index + TEXT_MOTION_PRESETS.length * TEXT_STYLE_PRESETS.indexOf(style) + 10).padStart(12, "0")}`,
          narration: { text: `${style.name} / ${motion.name}` },
          speech: {
            path: `speech/70000000-0000-4000-8000-${String(index + TEXT_MOTION_PRESETS.length * TEXT_STYLE_PRESETS.indexOf(style) + 10).padStart(12, "0")}.mp3`,
            durationMs: 1000,
            sourceTextHash: `sha256:${"2".repeat(64)}`,
            ttsProfileId: "narracut/test@1",
          },
          visual: {
            type: "card" as const,
            title: style.name,
            textStyleId: style.id,
            textMotionId: motion.id,
          },
          transition: "cut" as const,
        },
      })),
    );
    const matrixProject: Project = {
      schemaVersion: 3,
      metadata: { name: "Preset 组合矩阵" },
      theme: DEFAULT_PROJECT_THEME,
      assets: [],
      scenes: combinations.map(({ scene }) => scene),
    };

    const snapshot = createRenderSnapshot(matrixProject, "http://127.0.0.1:3579/media/");

    expect(snapshot.scenes).toHaveLength(12);
    snapshot.scenes.forEach((resolved, index) => {
      expect(resolved.textPresentation).toMatchObject({
        styleId: combinations[index].style.id,
        motionId: combinations[index].motion.id,
        inheritedStyle: false,
        inheritedMotion: false,
      });
    });
  });

  it("最终渲染拒绝只适合 Preview 的 Draft Duration", () => {
    const draftProject: Project = {
      ...project,
      scenes: project.scenes.map(({ speech: _speech, ...scene }) => scene),
    };

    expect(() => createRenderSnapshot(draftProject, "http://127.0.0.1:3579/media/"))
      .toThrow("Scene 01 缺少 Speech");
  });

  it("Preview 以逐 Scene 半开区间派生 Draft RenderPlan", () => {
    const previewProject: Project = {
      ...project,
      scenes: [
        {
          ...project.scenes[0],
          speech: { ...project.scenes[0].speech!, durationMs: 1001 },
        },
        (({ speech: _speech, ...scene }) => scene)(project.scenes[1]),
      ],
    };

    const snapshot = createPreviewSnapshot(
      previewProject,
      "http://127.0.0.1:3579/media/",
    );

    expect(snapshot.scenes).toMatchObject([
      { startFrame: 0, durationInFrames: 31 },
      { startFrame: 31, durationInFrames: 150 },
    ]);
    expect(snapshot.durationInFrames).toBe(181);
    expect(findSceneAtFrame(snapshot, 30)?.scene.id).toBe(
      previewProject.scenes[0].id,
    );
    expect(findSceneAtFrame(snapshot, 31)?.scene.id).toBe(
      previewProject.scenes[1].id,
    );
  });

  it("RenderPlan 重建后按稳定 Scene ID 与 Scene 内帧恢复", () => {
    const before = createPreviewSnapshot(
      project,
      "http://127.0.0.1:3579/media/",
    );
    const reordered: Project = {
      ...project,
      scenes: [project.scenes[1], project.scenes[0]],
    };
    const after = createPreviewSnapshot(
      reordered,
      "http://127.0.0.1:3579/media/",
    );

    expect(frameForSceneOffset(after, project.scenes[1].id, 45)).toBe(45);
    expect(frameForSceneOffset(after, project.scenes[0].id, 999)).toBe(299);
    expect(frameForSceneOffset(before, "missing-scene", 12)).toBeUndefined();
  });

  it("Preview 保留字体与 Preset 阻断信息，renderer 仍拒绝同一项目", () => {
    const blockedProject: Project = {
      ...project,
      theme: {
        ...project.theme,
        fontId: "vendor/missing-font@1",
        defaultTextStyleId: "vendor/missing-style@1",
      },
    };

    const preview = createPreviewSnapshot(
      blockedProject,
      "http://127.0.0.1:3579/media/",
    );

    expect(preview.previewBlockers.map((diagnostic) => diagnostic.code)).toEqual([
      "TEXT_STYLE_PRESET_MISSING",
      "THEME_FONT_MISSING",
    ]);
    expect(() =>
      createRenderSnapshot(blockedProject, "http://127.0.0.1:3579/media/"),
    ).toThrow("缺少 Text Style Preset");
  });

  it("唯一媒体 URL 纯函数逐段编码项目相对路径", () => {
    const snapshot = createRenderSnapshot(
      project,
      "http://127.0.0.1:3579/media/",
    );

    expect(projectMediaUrl(snapshot, "assets/演示 图.png")).toBe(
      "http://127.0.0.1:3579/media/assets/%E6%BC%94%E7%A4%BA%20%E5%9B%BE.png",
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  diagnosticsFromMediaProbe,
  resolveRenderDiagnosticScene,
  sortAndDedupeDiagnostics,
} from "../src/shared/diagnostics";
import type { Diagnostic } from "../src/shared/project";
import { DEFAULT_PROJECT_THEME, type Project } from "../src/shared/project";

const sceneIds = [
  "71000000-0000-4000-8000-000000000001",
  "71000000-0000-4000-8000-000000000002",
];

function diagnostic(value: Partial<Diagnostic> & Pick<Diagnostic, "code" | "path" | "message">): Diagnostic {
  return {
    severity: "error",
    ...value,
  };
}

describe("统一 Diagnostic", () => {
  it("按严重度、项目/Scene 顺序与字段依赖排序，并合并同一事实的来源", () => {
    const diagnostics = sortAndDedupeDiagnostics([
      diagnostic({
        code: "SPEECH_MISSING",
        path: ["scenes", 0, "speech"],
        sceneId: sceneIds[0],
        message: "缺少 Speech",
        origins: ["open"],
      }),
      diagnostic({
        code: "MEDIA_FILE_MISSING",
        path: ["scenes", 1, "visual", "assetId"],
        sceneId: sceneIds[1],
        assetId: "72000000-0000-4000-8000-000000000001",
        relativePath: "assets/missing.png",
        message: "文件不存在",
        origins: ["media"],
      }),
      diagnostic({
        code: "THEME_ACCENT_CONTRAST_LOW",
        severity: "warning",
        path: ["theme", "accentColor"],
        message: "对比度偏低",
        origins: ["consistency"],
      }),
      diagnostic({
        code: "NARRATION_EMPTY",
        path: ["scenes", 0, "narration", "text"],
        sceneId: sceneIds[0],
        message: "Narration 为空",
        origins: ["consistency"],
      }),
      diagnostic({
        code: "MEDIA_FILE_MISSING",
        path: ["scenes", 1, "visual", "assetId"],
        sceneId: sceneIds[1],
        assetId: "72000000-0000-4000-8000-000000000001",
        relativePath: "assets/missing.png",
        message: "文件不存在",
        origins: ["render"],
      }),
    ], sceneIds);

    expect(diagnostics.map((item) => item.code)).toEqual([
      "NARRATION_EMPTY",
      "SPEECH_MISSING",
      "MEDIA_FILE_MISSING",
      "THEME_ACCENT_CONTRAST_LOW",
    ]);
    expect(diagnostics[2].origins).toEqual(["media", "render"]);
  });

  it("按 Scene ID、Sequence 名称或帧区间反查 renderer 错误", () => {
    const plan = [
      { sceneId: sceneIds[0], startFrame: 0, durationInFrames: 90 },
      { sceneId: sceneIds[1], startFrame: 90, durationInFrames: 120 },
    ];

    expect(resolveRenderDiagnosticScene({ sceneId: sceneIds[1] }, plan)).toEqual({
      sceneId: sceneIds[1],
      frame: 90,
    });
    expect(resolveRenderDiagnosticScene({ sequenceName: `Scene ${sceneIds[0]}` }, plan)).toEqual({
      sceneId: sceneIds[0],
      frame: 0,
    });
    expect(resolveRenderDiagnosticScene({ frameRange: { startFrame: 112, endFrame: 118 } }, plan)).toEqual({
      sceneId: sceneIds[1],
      frame: 112,
    });
  });

  it("把媒体与 Speech 探测事实关联回 Project DSL 身份", () => {
    const assetId = "72000000-0000-4000-8000-000000000001";
    const project: Project = {
      schemaVersion: 3,
      metadata: {},
      theme: DEFAULT_PROJECT_THEME,
      assets: [{ id: assetId, kind: "image", path: "assets/broken.png" }],
      scenes: [{
        id: sceneIds[0],
        narration: { text: "运行时关联" },
        speech: {
          path: `speech/${sceneIds[0]}.mp3`,
          durationMs: 1000,
          sourceTextHash: `sha256:${"0".repeat(64)}`,
          ttsProfileId: "narracut-mandarin-news-v1",
        },
        visual: { type: "image", assetId },
        transition: "cut",
      }],
    };

    expect(diagnosticsFromMediaProbe(project, [
      { path: "assets/broken.png", exists: true, error: "IMAGE_DECODE_FAILED" },
      { path: `speech/${sceneIds[0]}.mp3`, exists: true, error: "SPEECH_DECODE_FAILED" },
    ])).toMatchObject([
      {
        code: "IMAGE_DECODE_FAILED",
        sceneId: sceneIds[0],
        assetId,
        relativePath: "assets/broken.png",
        path: ["scenes", 0, "visual", "assetId"],
      },
      {
        code: "SPEECH_DECODE_FAILED",
        sceneId: sceneIds[0],
        relativePath: `speech/${sceneIds[0]}.mp3`,
        path: ["scenes", 0, "speech", "path"],
      },
    ]);
  });

  it("共享媒体只探测一次，但为每个受影响 Scene 派生定位诊断", () => {
    const assetId = "72000000-0000-4000-8000-000000000001";
    const speechPath = "speech/shared.mp3";
    const project: Project = {
      schemaVersion: 3,
      metadata: {},
      theme: DEFAULT_PROJECT_THEME,
      assets: [{ id: assetId, kind: "image", path: "assets/shared.png" }],
      scenes: sceneIds.map((sceneId) => ({
        id: sceneId,
        narration: { text: "共享运行时事实" },
        speech: {
          path: speechPath,
          durationMs: 1000,
          sourceTextHash: `sha256:${"0".repeat(64)}`,
          ttsProfileId: "narracut-mandarin-news-v1",
        },
        visual: { type: "image" as const, assetId },
        transition: "cut" as const,
      })),
    };

    const diagnostics = diagnosticsFromMediaProbe(project, [
      { path: "assets/shared.png", exists: true, error: "IMAGE_DECODE_FAILED" },
      { path: speechPath, exists: true, error: "SPEECH_DECODE_FAILED" },
    ]);

    expect(diagnostics.filter((item) => item.code === "IMAGE_DECODE_FAILED").map((item) => item.sceneId))
      .toEqual(sceneIds);
    expect(diagnostics.filter((item) => item.code === "SPEECH_DECODE_FAILED").map((item) => item.sceneId))
      .toEqual(sceneIds);
  });
});

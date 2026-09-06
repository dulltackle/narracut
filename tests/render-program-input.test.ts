import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createRenderProgramInput } from "../src/server/render-program-input";
import { inspectProjectVNext, type ProjectVNextInspection } from "../src/server/project-vnext-inspection";
import { createProjectVNext } from "../src/server/project-lifecycle";
import { writeProjectTtsConfig, ttsProfileId, type ProjectTtsConfig } from "../src/server/project-speech-vnext";
import { findSceneAtFrame, getSceneFrame, findAssetById, type RenderProgramInputV1 } from "../src/runtime";

function projectState(): ProjectVNextInspection {
  return {
    projectDirectory: "/private/project",
    manifest: { kind: "narracut-project", formatVersion: 1, projectId: "private-id" },
    projectRevision: "private-project-revision",
    videoBrief: "\uFEFF# 原始 Brief\r\n\n保留空白  \n",
    videoBriefRevision: "private-brief-revision",
    renderPrograms: { directories: [] },
    warnings: [],
    tts: { status: "unconfigured" },
    project: {
      assets: [
        { id: "unused", path: "assets/unused.bin" },
        { id: "a", path: "assets/a.bin" },
        { id: "b", path: "assets/b.bin" },
      ],
      scenes: [
        { id: "first", narration: { text: "第一句" }, assetIds: ["b", "a"],
          speech: { path: "speech/private.mp3", durationMs: 1001, sourceTextHash: "private-hash", ttsProfileId: "private-profile" } },
        { id: "second", narration: { text: "第二句" }, assetIds: ["a"] },
        { id: "draft", narration: { text: "" }, assetIds: [] },
      ],
    },
    assetStates: [
      { id: "unused", path: "assets/unused.bin", status: "available" },
      { id: "a", path: "assets/a.bin", status: "available", size: 123 },
      { id: "b", path: "assets/b.bin", status: "unavailable", reason: "/private/missing" },
    ],
    speechStates: [
      { sceneId: "first", path: "speech/private.mp3", status: "available", durationMs: 1001 },
      { sceneId: "second", status: "available", durationMs: 1001 },
      { sceneId: "draft", status: "missing" },
    ],
    timeline: { durationInFrames: 212, renderReady: false, scenes: [] },
  };
}

const output = { width: 1920, height: 1080, fps: 24 };
const assetSources = new Map([
  ["a", "/media/revision-a"],
  ["b", "/media/must-not-leak"],
  ["unused", "/media/unused"],
]);

describe("Render Program Input V1", () => {
  it("只投影完整 V1 契约，按 Output Format 逐 Scene 量化 Speech 和 Draft", () => {
    const input = createRenderProgramInput(projectState(), output, assetSources);
    expect(input).toEqual({
      apiVersion: 1,
      videoBrief: "\uFEFF# 原始 Brief\r\n\n保留空白  \n",
      output: { width: 1920, height: 1080, fps: 24 },
      durationInFrames: 170,
      scenes: [
        { id: "first", narration: "第一句", assetIds: ["b", "a"], time: { startFrame: 0, durationInFrames: 25, source: "speech" } },
        { id: "second", narration: "第二句", assetIds: ["a"], time: { startFrame: 25, durationInFrames: 25, source: "speech" } },
        { id: "draft", narration: "", assetIds: [], time: { startFrame: 50, durationInFrames: 120, source: "draft" } },
      ],
      assets: [
        { id: "a", path: "assets/a.bin", availability: "available", src: "/media/revision-a" },
        { id: "b", path: "assets/b.bin", availability: "unavailable" },
      ],
    });
  });

  it("深冻结每层对象和数组，拒绝 Program 改写内容或时间", () => {
    const input = createRenderProgramInput(projectState(), output, assetSources);
    function checkFrozen(value: unknown): void {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).forEach(checkFrozen);
    }
    checkFrozen(input);
    expect(Reflect.set(input, "videoBrief", "篡改")).toBe(false);
    expect(Reflect.set(input.output, "fps", 60)).toBe(false);
    expect(Reflect.set(input.scenes[0].time, "startFrame", 8)).toBe(false);
    expect(Reflect.set(input.scenes[0].assetIds, "0", "unused")).toBe(false);
    expect(Reflect.set(input.assets[0], "src", "/private")).toBe(false);
    expect(() => Reflect.apply(Array.prototype.pop, input.scenes, [])).toThrow(TypeError);
  });

  it("用半开时间窗定位全局帧和 Scene 内帧，越界或非整数帧没有结果", () => {
    const input = createRenderProgramInput(projectState(), output, assetSources);
    for (const [frame, id, local] of [[0, "first", 0], [24, "first", 24], [25, "second", 0], [49, "second", 24], [50, "draft", 0], [169, "draft", 119]] as const) {
      const scene = findSceneAtFrame(input, frame)!;
      expect(scene.id).toBe(id);
      expect(getSceneFrame(scene, frame)).toBe(local);
    }
    for (const frame of [-1, 170, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(findSceneAtFrame(input, frame)).toBeUndefined();
      expect(getSceneFrame(input.scenes[0], frame)).toBeUndefined();
    }
    expect(getSceneFrame(input.scenes[1], 24)).toBeUndefined();
    expect(getSceneFrame(input.scenes[0], 25)).toBeUndefined();
  });

  it("按 ID 查找已引用 Asset，包括 unavailable；未引用或未知 ID 不可见", () => {
    const input = createRenderProgramInput(projectState(), output, assetSources);
    expect(findAssetById(input, "a")).toEqual({ id: "a", path: "assets/a.bin", availability: "available", src: "/media/revision-a" });
    expect(findAssetById(input, "b")).toEqual({ id: "b", path: "assets/b.bin", availability: "unavailable" });
    expect(findAssetById(input, "unused")).toBeUndefined();
    expect(findAssetById(input, "unknown")).toBeUndefined();
  });

  it("零 Scene 保持零帧且不暴露任何 Asset", () => {
    const state = projectState();
    state.project.scenes = [];
    const input = createRenderProgramInput(state, output, assetSources);
    expect(input.durationInFrames).toBe(0);
    expect(input.scenes).toEqual([]);
    expect(input.assets).toEqual([]);
    expect(findSceneAtFrame(input, 0)).toBeUndefined();
  });

  it("项目内容、媒体地址和 Output Format 换代生成新输入，旧执行保持初始值", () => {
    const state = projectState();
    const format = { ...output };
    const sources = new Map(assetSources);
    const first = createRenderProgramInput(state, format, sources);
    const original = JSON.stringify(first);
    state.videoBrief = "新的 Brief";
    state.project.scenes[0].narration.text = "修改后的句子";
    state.project.scenes[0].assetIds.reverse();
    state.project.scenes.reverse();
    state.speechStates = [{ sceneId: "first", status: "changed", durationMs: 2000 }];
    state.project.assets[1].path = "assets/renamed.bin";
    state.assetStates = [{ id: "a", path: "assets/renamed.bin", status: "available" }];
    sources.set("a", "/media/revision-next");
    format.fps = 60;
    const next = createRenderProgramInput(state, format, sources);
    expect(next).not.toBe(first);
    expect(JSON.stringify(first)).toBe(original);
    expect(next.videoBrief).toBe("新的 Brief");
    expect(next.durationInFrames).toBe(900);
    expect(next.scenes.map((scene) => scene.id)).toEqual(["draft", "second", "first"]);
    expect(next.scenes[2]).toEqual({ id: "first", narration: "修改后的句子", assetIds: ["a", "b"], time: { startFrame: 600, durationInFrames: 300, source: "draft" } });
    expect(findAssetById(next, "a")).toEqual({ id: "a", path: "assets/renamed.bin", availability: "available", src: "/media/revision-next" });
    expect(Object.isFrozen(state.project.scenes)).toBe(false);
    expect(Object.isFrozen(format)).toBe(false);
  });

  it("拒绝无效 Output Format 和不能精确表示的帧数", () => {
    for (const field of ["width", "height", "fps"] as const) {
      for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => createRenderProgramInput(projectState(), { ...output, [field]: value }, assetSources)).toThrow();
      }
    }
    expect(() => createRenderProgramInput(projectState(), { ...output, fps: Number.MAX_SAFE_INTEGER }, assetSources)).toThrow();
  });

  it("可用 Speech 必须有有效实际时长，Asset 必须有当次读取地址", () => {
    for (const durationMs of [undefined, 0, -1, NaN, Infinity]) {
      const state = projectState();
      state.speechStates = [{ sceneId: "first", status: "available", durationMs }];
      expect(() => createRenderProgramInput(state, output, assetSources)).toThrow();
    }
    expect(() => createRenderProgramInput(projectState(), output, new Map())).toThrow(/读取地址/);
  });

  it("从最新项目检查结果投影，文件变化使后续输入回退 Draft 和 unavailable", async () => {
    const parent = await mkdtemp(join(tmpdir(), "narracut-input-"));
    try {
      const directory = join(parent, "project");
      await createProjectVNext(directory);
      const config: ProjectTtsConfig = {
        provider: "tokendance", model: "minimax-speech-2.8-turbo",
        voice: "Chinese (Mandarin)_News_Anchor", speed: 1, volume: 1, pitch: 0,
      };
      await writeProjectTtsConfig(directory, config);
      const sceneId = "30000000-0000-4000-8000-000000000001";
      const assetId = "40000000-0000-4000-8000-000000000001";
      const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
      await writeFile(join(directory, "assets/example.bin"), "任意 Asset");
      await writeFile(join(directory, `speech/${sceneId}.mp3`), "speech-bytes");
      await writeFile(join(directory, "video.md"), "# 最新 Brief\n");
      await writeFile(join(directory, "project.json"), JSON.stringify({
        assets: [{ id: assetId, path: "assets/example.bin" }],
        scenes: [{ id: sceneId, narration: { text: "旁白" }, assetIds: [assetId], speech: {
          path: `speech/${sceneId}.mp3`, durationMs: 1001, sourceTextHash: hash("旁白"),
          ttsProfileId: ttsProfileId(config), audioContentHash: hash("speech-bytes"),
        } }],
      }));
      // 音频解码是系统边界，文件身份、哈希、项目读取与投影均走真实实现。
      const inspection = await inspectProjectVNext(directory, { probeSpeechDurationMs: async () => 1001 });
      const first = createRenderProgramInput(inspection, output, new Map([[assetId, "/media/example-v1"]]));
      expect(first.videoBrief).toBe("# 最新 Brief\n");
      expect(first.durationInFrames).toBe(25);
      expect(first.scenes[0].time.source).toBe("speech");
      expect(first.assets[0].availability).toBe("available");

      await rm(join(directory, "assets/example.bin"));
      await writeFile(join(directory, `speech/${sceneId}.mp3`), "replaced-speech");
      await writeFile(join(directory, "video.md"), "# 修改后的 Brief\n");
      const latest = await inspectProjectVNext(directory, { probeSpeechDurationMs: async () => 1001 });
      const next = createRenderProgramInput(latest, output, new Map());
      expect(next.videoBrief).toBe("# 修改后的 Brief\n");
      expect(next.durationInFrames).toBe(120);
      expect(next.scenes[0].time.source).toBe("draft");
      expect(next.assets).toEqual([{ id: assetId, path: "assets/example.bin", availability: "unavailable" }]);
      expect(first.durationInFrames).toBe(25);
      expect(first.assets[0].availability).toBe("available");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

// 由 pnpm typecheck 执行的负向类型契约；不在运行时改写冻结值。
function readonlyContract(input: RenderProgramInputV1): void {
  // @ts-expect-error 顶层字段只读。
  input.videoBrief = "修改";
  // @ts-expect-error Output Format 深只读。
  input.output.fps = 60;
  // @ts-expect-error Scene 数组只读。
  input.scenes.push(input.scenes[0]);
  // @ts-expect-error Scene 内容只读。
  input.scenes[0].narration = "修改";
  // @ts-expect-error Asset ID 数组只读。
  input.scenes[0].assetIds.push("unused");
  // @ts-expect-error 时间窗深只读。
  input.scenes[0].time.startFrame = 1;
  // @ts-expect-error Asset 数组只读。
  input.assets.pop();
  // @ts-expect-error Asset 属性只读。
  input.assets[0].path = "修改";
  const asset = findAssetById(input, "a");
  if (asset?.availability === "available") {
    // @ts-expect-error 查询结果仍为只读。
    asset.src = "修改";
  }
  if (asset?.availability === "unavailable") {
    // @ts-expect-error 不可用 Asset 没有读取地址。
    asset.src;
  }
}

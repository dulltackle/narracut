import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createProjectVNext } from "../src/server/project-lifecycle";
import { inspectProjectVNext } from "../src/server/project-vnext-inspection";
import {
  deriveSceneTimeWindows,
  inspectProjectSpeech,
  readProjectTtsConfig,
  ttsProfileId,
  writeProjectTtsConfig,
  type ProjectTtsConfig,
} from "../src/server/project-speech-vnext";

const config: ProjectTtsConfig = {
  provider: "tokendance",
  model: "minimax-speech-2.8-turbo",
  voice: "Chinese (Mandarin)_News_Anchor",
  speed: 1,
  volume: 1,
  pitch: 0,
};

describe("Project VNext Speech 与时间", () => {
  it("按每个 Scene 的实际 Speech 时长分别向上量化，再累计半开时间窗", () => {
    expect(deriveSceneTimeWindows([
      { sceneId: "scene-a", durationMs: 1_001, source: "speech" },
      { sceneId: "scene-b", durationMs: 1_001, source: "speech" },
      { sceneId: "scene-c", durationMs: 5_000, source: "draft" },
    ], 30)).toEqual({
      durationInFrames: 212,
      renderReady: false,
      scenes: [
        { sceneId: "scene-a", startFrame: 0, durationInFrames: 31, source: "speech" },
        { sceneId: "scene-b", startFrame: 31, durationInFrames: 31, source: "speech" },
        { sceneId: "scene-c", startFrame: 62, durationInFrames: 150, source: "draft" },
      ],
    });
  });

  it("严格持久化不含凭据的 tts.json，并稳定派生只受输出配置影响的 profile ID", async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-vnext-tts-"));
    const first = ttsProfileId(config);
    const second = ttsProfileId({ ...config });
    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/u);

    await writeProjectTtsConfig(projectDirectory, config);
    expect(await readProjectTtsConfig(projectDirectory)).toEqual({
      status: "configured",
      config,
      profileId: first,
    });
    expect(await readFile(join(projectDirectory, "tts.json"), "utf8"))
      .not.toContain("apiKey");

    await writeFile(join(projectDirectory, "tts.json"), JSON.stringify({ ...config, extra: true }));
    await expect(readProjectTtsConfig(projectDirectory)).rejects.toMatchObject({
      code: "TTS_CONFIG_INVALID",
    });
  });

  it("把 Speech 文件缺失、解码失败和原位时长变化呈现为可定位状态并回退 Draft Duration", async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-vnext-speech-state-"));
    await mkdir(join(projectDirectory, "speech"));
    const scenes = ["available", "missing", "decode", "changed", "stale", "swapped"].map((name, index) => ({
      id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      narration: { text: name },
      assetIds: [],
      speech: {
        path: `speech/30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}.mp3`,
        durationMs: 1_000,
        sourceTextHash: `sha256:${createHash("sha256").update(name === "stale" ? "旧 Narration" : name).digest("hex")}`,
        ttsProfileId: ttsProfileId(config),
        audioContentHash: `sha256:${createHash("sha256").update(name === "available" ? "valid" : name === "decode" ? "broken" : name === "swapped" ? "old-audio" : name).digest("hex")}`,
      },
    }));
    await Promise.all([
      writeFile(join(projectDirectory, scenes[0]!.speech.path), "valid"),
      writeFile(join(projectDirectory, scenes[2]!.speech.path), "broken"),
      writeFile(join(projectDirectory, scenes[3]!.speech.path), "changed"),
      writeFile(join(projectDirectory, scenes[4]!.speech.path), "stale"),
      writeFile(join(projectDirectory, scenes[5]!.speech.path), "swapped"),
    ]);

    const result = await inspectProjectSpeech(projectDirectory, scenes, ttsProfileId(config), {
      probeDurationMs: async (path) => {
        if (path.endsWith(scenes[2]!.speech.path)) throw new Error("decode failed");
        return path.endsWith(scenes[3]!.speech.path) ? 1_240 : 1_000;
      },
    });

    expect(result.states.map((state) => ({ sceneId: state.sceneId, status: state.status }))).toEqual([
      { sceneId: scenes[0]!.id, status: "available" },
      { sceneId: scenes[1]!.id, status: "unavailable" },
      { sceneId: scenes[2]!.id, status: "decode-failed" },
      { sceneId: scenes[3]!.id, status: "changed" },
      { sceneId: scenes[4]!.id, status: "changed" },
      { sceneId: scenes[5]!.id, status: "changed" },
    ]);
    expect(result.timeline.scenes.map((scene) => scene.source)).toEqual([
      "speech", "draft", "draft", "draft", "draft", "draft",
    ]);
    expect(result.timeline.renderReady).toBe(false);
  });

  it("项目检查返回 TTS、Speech 运行时状态和稳定 Scene Time Window", async () => {
    const parent = await mkdtemp(join(tmpdir(), "narracut-vnext-speech-inspection-"));
    const projectDirectory = join(parent, "project");
    await createProjectVNext(projectDirectory);
    await writeProjectTtsConfig(projectDirectory, config);
    const profileId = ttsProfileId(config);
    const sceneIds = [
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ];
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [],
      scenes: sceneIds.map((id, index) => ({
        id,
        narration: { text: `Scene ${index + 1}` },
        assetIds: [],
        ...(index === 0 ? {
          speech: {
            path: `speech/${id}.mp3`,
            durationMs: 1_001,
            sourceTextHash: `sha256:${createHash("sha256").update("Scene 1").digest("hex")}`,
            ttsProfileId: profileId,
            audioContentHash: `sha256:${createHash("sha256").update("mp3").digest("hex")}`,
          },
        } : {}),
      })),
    }));
    await writeFile(join(projectDirectory, "speech", `${sceneIds[0]}.mp3`), "mp3");

    const inspection = await inspectProjectVNext(projectDirectory, {
      probeSpeechDurationMs: async () => 1_001,
    });

    expect(inspection.tts).toEqual({ status: "configured", config, profileId });
    expect(inspection.speechStates).toMatchObject([
      { sceneId: sceneIds[0], status: "available", durationMs: 1_001 },
      { sceneId: sceneIds[1], status: "missing" },
    ]);
    expect(inspection.timeline).toEqual({
      durationInFrames: 181,
      renderReady: false,
      scenes: [
        { sceneId: sceneIds[0], startFrame: 0, durationInFrames: 31, source: "speech" },
        { sceneId: sceneIds[1], startFrame: 31, durationInFrames: 150, source: "draft" },
      ],
    });
    expect(inspection.warnings).toEqual([]);
  });
});

import type { OutputFormat, RenderProgramInputV1 } from "../runtime";
import { deriveSceneTimeWindows, DRAFT_DURATION_MS } from "./project-speech-vnext";
import type { ProjectVNextInspection } from "./project-vnext-inspection";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * 将本次已检查的项目状态投影为独立输入。调用方在项目变化后重新检查并创建输入，
 * assetSources 由 Runtime 的媒体层提供当次读取地址，不向 Program 暴露解析能力。
 */
export function createRenderProgramInput(
  state: Pick<ProjectVNextInspection, "project" | "videoBrief" | "assetStates" | "speechStates">,
  output: OutputFormat,
  assetSources: ReadonlyMap<string, string>,
): RenderProgramInputV1 {
  if (![output.width, output.height, output.fps].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Output Format 的 width、height 与 fps 必须是正安全整数。");
  }
  const speechStates = new Map(state.speechStates.map((speech) => [speech.sceneId, speech]));
  const timeline = deriveSceneTimeWindows(state.project.scenes.map((scene) => {
    const speech = speechStates.get(scene.id);
    if (speech?.status === "available") {
      const durationMs = speech.durationMs;
      if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) {
        throw new Error(`Scene ${scene.id} 的可用 Speech 缺少有效实际时长。`);
      }
      return { sceneId: scene.id, durationMs, source: "speech" as const };
    }
    return { sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" as const };
  }), output.fps);
  if (!Number.isSafeInteger(timeline.durationInFrames)) {
    throw new Error("项目总帧数超过可精确表示的整数范围。");
  }
  const referenced = new Set(state.project.scenes.flatMap((scene) => scene.assetIds));
  const assetStates = new Map(state.assetStates.map((asset) => [asset.id, asset]));

  return deepFreeze<RenderProgramInputV1>({
    apiVersion: 1,
    videoBrief: state.videoBrief,
    output: { width: output.width, height: output.height, fps: output.fps },
    durationInFrames: timeline.durationInFrames,
    scenes: state.project.scenes.map((scene, index) => {
      const time = timeline.scenes[index];
      return {
        id: scene.id,
        narration: scene.narration.text,
        assetIds: [...scene.assetIds],
        time: { startFrame: time.startFrame, durationInFrames: time.durationInFrames, source: time.source },
      };
    }),
    assets: state.project.assets.filter((asset) => referenced.has(asset.id)).map((asset) => {
      if (assetStates.get(asset.id)?.status !== "available") {
        return { id: asset.id, path: asset.path, availability: "unavailable" };
      }
      const src = assetSources.get(asset.id);
      if (!src) throw new Error(`可用 Asset ${asset.id} 缺少 Runtime 读取地址。`);
      return { id: asset.id, path: asset.path, availability: "available", src };
    }),
  });
}

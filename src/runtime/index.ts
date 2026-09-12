/** Render Program 可见的 V1 契约；此入口不得引入宿主依赖。 */
export type OutputFormat = Readonly<{
  width: number;
  height: number;
  fps: number;
}>;

export type RenderProgramSceneV1 = Readonly<{
  id: string;
  narration: string;
  assetIds: readonly string[];
  time: Readonly<{
    startFrame: number;
    durationInFrames: number;
    source: "speech" | "draft";
  }>;
}>;

export type RenderProgramAssetV1 =
  | Readonly<{ id: string; path: string; availability: "available"; src: string }>
  | Readonly<{ id: string; path: string; availability: "unavailable" }>;

export type RenderProgramInputV1 = Readonly<{
  apiVersion: 1;
  videoBrief: string;
  output: OutputFormat;
  durationInFrames: number;
  scenes: readonly RenderProgramSceneV1[];
  assets: readonly RenderProgramAssetV1[];
}>;

/** 仅接受 Scene 半开时间窗内的整数全局帧；越界时返回 undefined。 */
export function getSceneFrame(scene: RenderProgramSceneV1, frame: number): number | undefined {
  if (!Number.isSafeInteger(frame)) return undefined;
  const localFrame = frame - scene.time.startFrame;
  return localFrame >= 0 && localFrame < scene.time.durationInFrames ? localFrame : undefined;
}

/** 返回包含该全局帧的 Scene；空时间线和越界帧均无结果。 */
export function findSceneAtFrame(input: RenderProgramInputV1, frame: number): RenderProgramSceneV1 | undefined {
  return input.scenes.find((scene) => getSceneFrame(scene, frame) !== undefined);
}

export function findAssetById(input: RenderProgramInputV1, id: string): RenderProgramAssetV1 | undefined {
  return input.assets.find((asset) => asset.id === id);
}

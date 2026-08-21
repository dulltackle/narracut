import type { Diagnostic, Project } from "./project";

export type MediaProbeFact = {
  path: string;
  exists: boolean;
  error?: string;
};

export type RenderDiagnosticLocation = Pick<
  Diagnostic,
  "sceneId" | "frame" | "frameRange" | "sequenceName"
>;

export type RenderScenePlanEntry = {
  sceneId: string;
  startFrame: number;
  durationInFrames: number;
  sequenceName?: string;
};

function pathKey(path: Diagnostic["path"]): string {
  return path.map(String).join(".");
}

export function diagnosticIdentity(diagnostic: Diagnostic): string {
  return [
    diagnostic.code,
    diagnostic.sceneId ?? "project",
    diagnostic.assetId ?? "",
    diagnostic.relativePath ?? "",
    pathKey(diagnostic.path),
    diagnostic.character ?? "",
    diagnostic.codePoint ?? "",
  ].join("\u001f");
}

function fieldRank(diagnostic: Diagnostic): number {
  const path = diagnostic.path.map(String);
  if (path.includes("narration")) return 0;
  if (path.includes("visual") || path.includes("caption") || path.includes("assetId")) return 1;
  if (path.includes("speech")) return 2;
  return 3;
}

function mergeDiagnostic(current: Diagnostic, incoming: Diagnostic): Diagnostic {
  const origins = [...new Set([...(current.origins ?? []), ...(incoming.origins ?? [])])];
  return {
    ...current,
    ...(current.frame === undefined && incoming.frame !== undefined ? { frame: incoming.frame } : {}),
    ...(current.frameRange === undefined && incoming.frameRange !== undefined
      ? { frameRange: incoming.frameRange }
      : {}),
    ...(current.sequenceName === undefined && incoming.sequenceName !== undefined
      ? { sequenceName: incoming.sequenceName }
      : {}),
    ...(origins.length === 0 ? {} : { origins }),
  };
}

export function sortAndDedupeDiagnostics(
  diagnostics: readonly Diagnostic[],
  sceneOrder: readonly string[],
): Diagnostic[] {
  const byIdentity = new Map<string, Diagnostic>();
  diagnostics.forEach((diagnostic) => {
    const identity = diagnosticIdentity(diagnostic);
    const current = byIdentity.get(identity);
    byIdentity.set(
      identity,
      current === undefined ? { ...diagnostic } : mergeDiagnostic(current, diagnostic),
    );
  });
  const sceneIndices = new Map(sceneOrder.map((sceneId, index) => [sceneId, index]));
  return [...byIdentity.values()].sort((left, right) => {
    const severity = Number(left.severity === "warning") - Number(right.severity === "warning");
    if (severity !== 0) return severity;
    const leftProject = left.sceneId === undefined ? 0 : 1;
    const rightProject = right.sceneId === undefined ? 0 : 1;
    if (leftProject !== rightProject) return leftProject - rightProject;
    const scene = (sceneIndices.get(left.sceneId ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (sceneIndices.get(right.sceneId ?? "") ?? Number.MAX_SAFE_INTEGER);
    if (scene !== 0) return scene;
    const field = fieldRank(left) - fieldRank(right);
    if (field !== 0) return field;
    return `${pathKey(left.path)}\u001f${left.code}`.localeCompare(
      `${pathKey(right.path)}\u001f${right.code}`,
    );
  });
}

function mediaErrorMessage(code: string, path: string): string {
  if (code === "IMAGE_ASSET_NOT_NORMALIZED") return `Image Asset 不符合 1920×1080、8-bit sRGB 单帧 PNG 规范：${path}`;
  if (code === "VIDEO_ASSET_NOT_NORMALIZED") return `Video Asset 不符合 1080p、30fps、H.264 渲染规范：${path}`;
  if (code === "IMAGE_DECODE_FAILED") return `Image Asset 已损坏或无法解码：${path}`;
  if (code === "VIDEO_DECODE_FAILED" || code.startsWith("VIDEO_")) return `Video Asset 已损坏或媒体复检未通过：${path}`;
  if (code === "SPEECH_DECODE_FAILED") return `Speech 文件已损坏或无法解码：${path}`;
  return `媒体复检失败：${path}`;
}

export function diagnosticsFromMediaProbe(
  project: Project,
  facts: readonly MediaProbeFact[],
): Diagnostic[] {
  return facts.flatMap<Diagnostic>((fact) => {
    const errorCode = fact.error;
    if (errorCode === undefined || !fact.exists) return [];
    const speechDiagnostics = project.scenes.flatMap<Diagnostic>((scene, sceneIndex) =>
      scene.speech?.path !== fact.path ? [] : [{
        code: errorCode,
        severity: "error" as const,
        path: ["scenes", sceneIndex, "speech", "path"],
        message: mediaErrorMessage(errorCode, fact.path),
        sceneId: scene.id,
        relativePath: fact.path,
        origins: ["speech" as const],
      }],
    );
    if (speechDiagnostics.length > 0) return speechDiagnostics;
    const asset = project.assets.find((candidate) => candidate.path === fact.path);
    if (asset === undefined) return [];
    const sceneDiagnostics = project.scenes.flatMap<Diagnostic>((scene, sceneIndex) =>
      scene.visual.type === "card" || scene.visual.assetId !== asset.id ? [] : [{
        code: errorCode,
        severity: "error" as const,
        path: ["scenes", sceneIndex, "visual", "assetId"],
        message: mediaErrorMessage(errorCode, fact.path),
        sceneId: scene.id,
        assetId: asset.id,
        relativePath: fact.path,
        origins: ["media" as const],
      }],
    );
    const isLogo = project.theme.logoAssetId === asset.id;
    const catalogDiagnostic: Diagnostic[] = sceneDiagnostics.length > 0 && !isLogo ? [] : [{
        code: errorCode,
        severity: "error" as const,
        path: isLogo ? ["theme", "logoAssetId"] : ["assets", project.assets.indexOf(asset), "path"],
        message: mediaErrorMessage(errorCode, fact.path),
        assetId: asset.id,
        relativePath: fact.path,
        origins: ["media" as const],
      }];
    return [...sceneDiagnostics, ...catalogDiagnostic];
  });
}

function frameScene(
  frame: number | undefined,
  plan: readonly RenderScenePlanEntry[],
): RenderScenePlanEntry | undefined {
  if (frame === undefined || !Number.isFinite(frame)) return undefined;
  return plan.find(
    (entry) => frame >= entry.startFrame && frame < entry.startFrame + entry.durationInFrames,
  );
}

export function resolveRenderDiagnosticScene(
  location: RenderDiagnosticLocation,
  plan: readonly RenderScenePlanEntry[],
): { sceneId: string; frame: number } | undefined {
  if (location.sceneId !== undefined) {
    const entry = plan.find((candidate) => candidate.sceneId === location.sceneId);
    if (entry !== undefined) return { sceneId: entry.sceneId, frame: location.frame ?? entry.startFrame };
  }
  if (location.sequenceName !== undefined) {
    const sequenceSceneId = location.sequenceName.startsWith("Scene ")
      ? location.sequenceName.slice("Scene ".length)
      : undefined;
    const entry = plan.find(
      (candidate) => candidate.sequenceName === location.sequenceName || candidate.sceneId === sequenceSceneId,
    );
    if (entry !== undefined) return { sceneId: entry.sceneId, frame: location.frame ?? entry.startFrame };
  }
  const frame = location.frameRange?.startFrame ?? location.frame;
  const entry = frameScene(frame, plan);
  return entry === undefined || frame === undefined ? undefined : { sceneId: entry.sceneId, frame };
}

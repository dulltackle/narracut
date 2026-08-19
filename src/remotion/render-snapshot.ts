import {
  evaluateTextLayout,
  getFontPreset,
  resolveTextPresentation,
  validateProjectConsistency,
  validateProjectStructure,
  type Project,
  type Scene,
  type Diagnostic,
  type TextBlockContent,
} from "../shared/project";

export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const VIDEO_FPS = 30;
export const VIDEO_SAFE_INSET = 80;
export const DRAFT_SCENE_DURATION_MS = 5000;

export type ResolvedScene = {
  scene: Scene;
  durationInFrames: number;
  startFrame: number;
  textPresentation?: ReturnType<typeof resolveTextPresentation> & {
    scale: number;
  };
};

export type RenderPlan = {
  width: number;
  height: number;
  fps: number;
  safeInset: number;
  fontFamily?: string;
  durationInFrames: number;
  scenes: ResolvedScene[];
};

export type RenderSnapshot = RenderPlan & {
  snapshotVersion: 1;
  mode: "preview" | "render";
  project: Project;
  mediaBaseUrl: string;
  mediaAvailability: Record<string, boolean>;
  mediaRevisions: Record<string, string>;
  previewBlockers: Diagnostic[];
};

const PREVIEW_BLOCKING_CODES = new Set([
  "PROJECT_THEME_PRESET_MISSING",
  "TEXT_STYLE_PRESET_MISSING",
  "TEXT_MOTION_PRESET_MISSING",
  "THEME_FONT_MISSING",
]);

function sceneDurationInFrames(
  scene: Scene,
  mediaAvailability: Record<string, boolean>,
): number {
  const durationMs =
    scene.speech === undefined || mediaAvailability[scene.speech.path] === false
      ? DRAFT_SCENE_DURATION_MS
      : scene.speech.durationMs;
  return Math.max(1, Math.ceil((durationMs / 1000) * VIDEO_FPS));
}

function textBlock(scene: Scene): {
  content: TextBlockContent;
  overrides: { textStyleId?: string; textMotionId?: string };
} | undefined {
  if (scene.visual.type === "card") {
    return { content: scene.visual, overrides: scene.visual };
  }
  if (scene.visual.caption !== undefined) {
    return {
      content: { body: scene.visual.caption.text },
      overrides: scene.visual.caption,
    };
  }
  return undefined;
}

export function createRenderSnapshot(
  projectInput: Project,
  mediaBaseUrl: string,
  mediaAvailability?: Record<string, boolean>,
  mediaRevisions: Record<string, string> = {},
): RenderSnapshot {
  const assumedAvailability =
    mediaAvailability ??
    Object.fromEntries([
      ...projectInput.assets.map((asset) => [asset.path, true] as const),
      ...projectInput.scenes.flatMap((scene) =>
        scene.speech === undefined ? [] : [[scene.speech.path, true] as const],
      ),
    ]);
  return createSnapshot(
    projectInput,
    mediaBaseUrl,
    "render",
    assumedAvailability,
    mediaRevisions,
  );
}

export function createPreviewSnapshot(
  projectInput: Project,
  mediaBaseUrl: string,
  mediaAvailability: Record<string, boolean> = {},
  mediaRevisions: Record<string, string> = {},
): RenderSnapshot {
  return createSnapshot(
    projectInput,
    mediaBaseUrl,
    "preview",
    mediaAvailability,
    mediaRevisions,
  );
}

function createSnapshot(
  projectInput: Project,
  mediaBaseUrl: string,
  mode: "preview" | "render",
  mediaAvailability: Record<string, boolean>,
  mediaRevisions: Record<string, string>,
): RenderSnapshot {
  const allowRenderBlockingDiagnostics = mode === "preview";
  const projectCopy = structuredClone(projectInput);
  const structure = validateProjectStructure(projectCopy);
  if (!structure.success) {
    throw new Error(structure.diagnostics[0]?.message ?? "渲染快照结构无效。 ");
  }
  const consistencyDiagnostics = validateProjectConsistency(structure.project);
  const errors = consistencyDiagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (!allowRenderBlockingDiagnostics) {
    errors.push(...validateRenderReadiness(structure.project, mediaAvailability));
  }
  if (!allowRenderBlockingDiagnostics && errors.length > 0) {
    throw new Error(errors[0].message);
  }

  let startFrame = 0;
  const scenes = structure.project.scenes.map((scene): ResolvedScene => {
    const durationInFrames = sceneDurationInFrames(scene, mediaAvailability);
    const block = textBlock(scene);
    const resolved =
      block === undefined
        ? undefined
        : resolveTextPresentation(structure.project.theme, block.overrides);
    if (
      !allowRenderBlockingDiagnostics &&
      resolved !== undefined &&
      (resolved.style === undefined || resolved.motion === undefined)
    ) {
      throw new Error("渲染快照包含无法解析的文字 Preset。");
    }
    const result: ResolvedScene = {
      scene,
      durationInFrames,
      startFrame,
      ...(block === undefined || resolved === undefined || resolved.style === undefined
        ? {}
        : {
            textPresentation: {
              ...resolved,
              scale: evaluateTextLayout(resolved.style, block.content).scale,
            },
          }),
    };
    startFrame += durationInFrames;
    return result;
  });

  return {
    snapshotVersion: 1,
    mode,
    project: structure.project,
    mediaBaseUrl,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    fps: VIDEO_FPS,
    safeInset: VIDEO_SAFE_INSET,
    fontFamily: getFontPreset(structure.project.theme.fontId)?.family,
    mediaAvailability: { ...mediaAvailability },
    mediaRevisions: { ...mediaRevisions },
    previewBlockers:
      mode === "preview"
        ? consistencyDiagnostics.filter(
            (diagnostic) =>
              diagnostic.severity === "error" &&
              PREVIEW_BLOCKING_CODES.has(diagnostic.code),
          )
        : [],
    durationInFrames: Math.max(1, startFrame),
    scenes,
  };
}

export function findSceneAtFrame(
  plan: Pick<RenderPlan, "durationInFrames" | "scenes">,
  frame: number,
): ResolvedScene | undefined {
  if (plan.scenes.length === 0) return undefined;
  const normalizedFrame = Math.min(
    plan.durationInFrames - 1,
    Math.max(0, Math.floor(frame)),
  );
  return plan.scenes.find(
    (resolved) =>
      normalizedFrame >= resolved.startFrame &&
      normalizedFrame < resolved.startFrame + resolved.durationInFrames,
  );
}

export function frameForSceneOffset(
  plan: Pick<RenderPlan, "scenes">,
  sceneId: string,
  offsetInFrames: number,
): number | undefined {
  const resolved = plan.scenes.find((candidate) => candidate.scene.id === sceneId);
  if (resolved === undefined) return undefined;
  const offset = Math.min(
    resolved.durationInFrames - 1,
    Math.max(0, Math.floor(offsetInFrames)),
  );
  return resolved.startFrame + offset;
}

export function validateRenderReadiness(
  project: Project,
  mediaAvailability: Record<string, boolean> = {},
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  project.scenes.forEach((scene, index) => {
    if (scene.speech === undefined) {
      diagnostics.push({
        code: "SPEECH_MISSING",
        severity: "error",
        path: ["scenes", index, "speech"],
        message: `Scene ${String(index + 1).padStart(2, "0")} 缺少 Speech；Draft Duration 仅用于 Preview。`,
        sceneId: scene.id,
      });
    } else if (mediaAvailability[scene.speech.path] === false) {
      diagnostics.push({
        code: "SPEECH_FILE_MISSING",
        severity: "error",
        path: ["scenes", index, "speech", "path"],
        message: `Speech 文件不存在：${scene.speech.path}`,
        sceneId: scene.id,
      });
    }
    if (scene.visual.type !== "card" && scene.visual.assetId !== undefined) {
      const assetId = scene.visual.assetId;
      const asset = project.assets.find((candidate) => candidate.id === assetId);
      if (asset !== undefined && mediaAvailability[asset.path] === false) {
        diagnostics.push({
          code: "MEDIA_FILE_MISSING",
          severity: "error",
          path: ["scenes", index, "visual", "assetId"],
          message: `Visual 文件不存在：${asset.path}`,
          sceneId: scene.id,
        });
      }
    }
  });
  const logo = project.assets.find((asset) => asset.id === project.theme.logoAssetId);
  if (logo !== undefined && mediaAvailability[logo.path] === false) {
    diagnostics.push({
      code: "LOGO_FILE_MISSING",
      severity: "error",
      path: ["theme", "logoAssetId"],
      message: `Logo 文件不存在：${logo.path}`,
    });
  }
  return diagnostics;
}

export function projectMediaUrl(snapshot: RenderSnapshot, path: string): string {
  const base = `${snapshot.mediaBaseUrl}${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  const revision = snapshot.mediaRevisions[path];
  return revision === undefined
    ? base
    : `${base}?revision=${encodeURIComponent(revision)}`;
}

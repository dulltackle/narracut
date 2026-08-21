import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import sharp from "sharp";

import type { Diagnostic, Project } from "../shared/project";
import {
  assertNormalizedVideoProbe,
  probeVideoFile,
  runRemotionCli,
  VideoMediaError,
} from "./video-media";

export class RenderPreflightError extends Error {
  readonly statusCode = 422;

  constructor(
    readonly code: string,
    message: string,
    readonly sceneId?: string,
    readonly path?: string,
  ) {
    super(message);
  }
}

type MediaEntry = {
  path: string;
  kind: "image" | "video" | "speech";
  targets: Array<{
    sceneId?: string;
    assetId?: string;
    diagnosticPath: Array<string | number>;
  }>;
};

function addMediaEntry(
  entries: Map<string, MediaEntry>,
  path: string,
  kind: MediaEntry["kind"],
  target: MediaEntry["targets"][number],
): void {
  const existing = entries.get(path);
  if (existing !== undefined) {
    existing.targets.push(target);
    return;
  }
  entries.set(path, { path, kind, targets: [target] });
}

export function referencedRenderMedia(project: Project): MediaEntry[] {
  const entries = new Map<string, MediaEntry>();
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    if (scene.speech !== undefined) {
      addMediaEntry(entries, scene.speech.path, "speech", {
        sceneId: scene.id,
        diagnosticPath: ["scenes", sceneIndex, "speech", "path"],
      });
    }
    if (!("assetId" in scene.visual) || scene.visual.assetId === undefined) continue;
    const assetId = scene.visual.assetId;
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (asset !== undefined) {
      addMediaEntry(entries, asset.path, asset.kind, {
        sceneId: scene.id,
        assetId: asset.id,
        diagnosticPath: ["scenes", sceneIndex, "visual", "assetId"],
      });
    }
  }
  const logo = project.assets.find((asset) => asset.id === project.theme.logoAssetId);
  if (logo !== undefined) {
    addMediaEntry(entries, logo.path, logo.kind, {
      assetId: logo.id,
      diagnosticPath: ["theme", "logoAssetId"],
    });
  }
  return [...entries.values()];
}

function safeProjectPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

async function containedFile(
  projectRealRoot: string,
  projectRoot: string,
  path: string,
): Promise<string | undefined> {
  if (!safeProjectPath(path)) return undefined;
  try {
    const file = await realpath(join(projectRoot, ...path.split("/")));
    const contained = relative(projectRealRoot, file);
    if (
      contained === "" ||
      contained === ".." ||
      contained.startsWith(`..${sep}`) ||
      isAbsolute(contained) ||
      !(await stat(file)).isFile()
    ) {
      return undefined;
    }
    return file;
  } catch {
    return undefined;
  }
}

async function assertAudioStream(file: string): Promise<void> {
  const { stdout } = await runRemotionCli("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-of",
    "json",
    file,
  ]);
  const result = JSON.parse(stdout.toString("utf8")) as {
    streams?: Array<{ codec_type?: string }>;
    format?: { duration?: string };
  };
  if (
    !result.streams?.some((stream) => stream.codec_type === "audio") ||
    !Number.isFinite(Number(result.format?.duration))
  ) {
    throw new Error("缺少可解码的 audio stream。");
  }
}

async function normalizedVideoDurationInFrames(file: string): Promise<number> {
  const probe = await probeVideoFile(file);
  assertNormalizedVideoProbe(probe);
  const video = probe.streams?.find(
    (stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  return Number(video?.nb_frames);
}

async function assertNormalizedImageAsset(file: string): Promise<void> {
  const metadata = await sharp(file, { animated: true }).metadata();
  if (metadata.width === undefined || metadata.height === undefined) {
    throw new Error("图片没有有效尺寸。");
  }
  if (
    metadata.format !== "png" ||
    metadata.width !== 1920 ||
    metadata.height !== 1080 ||
    metadata.depth !== "uchar" ||
    metadata.space !== "srgb" ||
    (metadata.pages ?? 1) !== 1
  ) {
    const error = new Error("Image Asset 不是 1920×1080、8-bit sRGB 的单帧 PNG。");
    error.name = "ImageAssetNotNormalizedError";
    throw error;
  }
}

export async function inspectMediaFile(
  kind: MediaEntry["kind"],
  file: string,
): Promise<{ error?: string; videoDurationInFrames?: number }> {
  try {
    if (kind === "image") await assertNormalizedImageAsset(file);
    else if (kind === "video") {
      return { videoDurationInFrames: await normalizedVideoDurationInFrames(file) };
    }
    else await assertAudioStream(file);
    return {};
  } catch (error) {
    if (kind === "video" && error instanceof VideoMediaError) return { error: error.code };
    if (error instanceof Error && error.name === "ImageAssetNotNormalizedError") {
      return { error: "IMAGE_ASSET_NOT_NORMALIZED" };
    }
    return {
      error: kind === "speech"
        ? "SPEECH_DECODE_FAILED"
        : kind === "image"
          ? "IMAGE_DECODE_FAILED"
          : "VIDEO_DECODE_FAILED",
    };
  }
}

export async function mediaValidationError(
  kind: MediaEntry["kind"],
  file: string,
): Promise<string | undefined> {
  return (await inspectMediaFile(kind, file)).error;
}

export type RenderMediaInspection = {
  availability: Record<string, boolean>;
  videoDurationInFrames: Record<string, number>;
  diagnostics: Diagnostic[];
};

export async function inspectRenderMedia(
  project: Project,
  projectRoot: string,
): Promise<RenderMediaInspection> {
  const projectRealRoot = await realpath(projectRoot);
  const availability: Record<string, boolean> = {};
  const videoDurationInFrames: Record<string, number> = {};
  const diagnostics: Diagnostic[] = [];
  for (const entry of referencedRenderMedia(project)) {
    const file = await containedFile(projectRealRoot, projectRoot, entry.path);
    availability[entry.path] = file !== undefined;
    if (file === undefined) continue;
    const facts = await inspectMediaFile(entry.kind, file);
    const code = facts.error;
    if (facts.videoDurationInFrames !== undefined) {
      videoDurationInFrames[entry.path] = facts.videoDurationInFrames;
    }
    if (code !== undefined) {
      const subject = entry.kind === "speech"
        ? "Speech"
        : entry.kind === "image"
          ? "Image Asset"
          : "Video Asset";
      entry.targets.forEach((target) => diagnostics.push({
          code,
          severity: "error",
          path: target.diagnosticPath,
          message: code.endsWith("NOT_NORMALIZED")
            ? `${subject} 不符合渲染规范：${entry.path}`
            : `${subject} 无法解码：${entry.path}`,
          sceneId: target.sceneId,
          assetId: target.assetId,
          relativePath: entry.path,
          origins: [entry.kind === "speech" ? "speech" : "media"],
      }));
    }
  }
  return { availability, videoDurationInFrames, diagnostics };
}

export async function preflightRenderMedia(
  project: Project,
  projectRoot: string,
): Promise<Record<string, boolean>> {
  const inspection = await inspectRenderMedia(project, projectRoot);
  const blocker = inspection.diagnostics[0];
  if (blocker !== undefined) {
    throw new RenderPreflightError(
      blocker.code,
      blocker.message,
      blocker.sceneId,
      blocker.relativePath,
    );
  }
  return inspection.availability;
}

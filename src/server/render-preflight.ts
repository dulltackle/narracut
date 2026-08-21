import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import sharp from "sharp";

import type { Project } from "../shared/project";
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
  sceneId?: string;
};

export function referencedRenderMedia(project: Project): MediaEntry[] {
  const entries = new Map<string, MediaEntry>();
  for (const scene of project.scenes) {
    if (scene.speech !== undefined && !entries.has(scene.speech.path)) {
      entries.set(scene.speech.path, {
        path: scene.speech.path,
        kind: "speech",
        sceneId: scene.id,
      });
    }
    if (!("assetId" in scene.visual) || scene.visual.assetId === undefined) continue;
    const assetId = scene.visual.assetId;
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (asset !== undefined && !entries.has(asset.path)) {
      entries.set(asset.path, {
        path: asset.path,
        kind: asset.kind,
        sceneId: scene.id,
      });
    }
  }
  const logo = project.assets.find((asset) => asset.id === project.theme.logoAssetId);
  if (logo !== undefined && !entries.has(logo.path)) {
    entries.set(logo.path, { path: logo.path, kind: logo.kind });
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

async function assertNormalizedVideoAsset(file: string): Promise<void> {
  assertNormalizedVideoProbe(await probeVideoFile(file));
}

export async function preflightRenderMedia(
  project: Project,
  projectRoot: string,
): Promise<Record<string, boolean>> {
  const projectRealRoot = await realpath(projectRoot);
  const availability: Record<string, boolean> = {};
  for (const entry of referencedRenderMedia(project)) {
    const file = await containedFile(projectRealRoot, projectRoot, entry.path);
    availability[entry.path] = file !== undefined;
    if (file === undefined) continue;
    try {
      if (entry.kind === "image") {
        const metadata = await sharp(file).metadata();
        if (metadata.width === undefined || metadata.height === undefined) {
          throw new Error("图片没有有效尺寸。");
        }
      } else if (entry.kind === "video") {
        await assertNormalizedVideoAsset(file);
      } else {
        await assertAudioStream(file);
      }
    } catch (error) {
      if (error instanceof VideoMediaError && error.code === "VIDEO_ASSET_NOT_NORMALIZED") {
        throw new RenderPreflightError(
          "VIDEO_ASSET_NOT_NORMALIZED",
          `Video Asset 不符合渲染规范：${entry.path}（${error.message}）`,
          entry.sceneId,
          entry.path,
        );
      }
      throw new RenderPreflightError(
        entry.kind === "speech"
          ? "SPEECH_DECODE_FAILED"
          : entry.kind === "image"
            ? "IMAGE_DECODE_FAILED"
            : "VIDEO_DECODE_FAILED",
        `${entry.kind === "speech" ? "Speech" : entry.kind === "image" ? "Image Asset" : "Video Asset"} 无法解码：${entry.path}`,
        entry.sceneId,
        entry.path,
      );
    }
  }
  return availability;
}

import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

import type { Project } from "../shared/project";

const execFileAsync = promisify(execFile);

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

type VideoStream = {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  level?: number;
  pix_fmt?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_aspect_ratio?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  field_order?: string;
};

class VideoAssetSpecificationError extends Error {}

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
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-of",
    "json",
    file,
  ]);
  const result = JSON.parse(stdout) as {
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
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=format_name,duration:stream=codec_type,codec_name,profile,level,pix_fmt,width,height,r_frame_rate,avg_frame_rate,sample_aspect_ratio,color_range,color_space,color_transfer,color_primaries,field_order",
    "-of",
    "json",
    file,
  ]);
  const result = JSON.parse(stdout) as {
    streams?: VideoStream[];
    format?: { format_name?: string; duration?: string };
  };
  const streams = result.streams ?? [];
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const video = videoStreams[0];
  const issues: string[] = [];

  if (!result.format?.format_name?.split(",").includes("mp4")) {
    issues.push("容器必须为 MP4");
  }
  if (
    !Number.isFinite(Number(result.format?.duration)) ||
    Number(result.format?.duration) <= 0
  ) {
    issues.push("必须包含有效时长");
  }
  if (streams.length !== 1 || videoStreams.length !== 1) {
    issues.push("必须仅含单路视频且不含音轨或其他轨道");
  }
  if (video !== undefined) {
    if (video.codec_name !== "h264") {
      issues.push(`编码必须为 H.264，实际为 ${video.codec_name ?? "未知"}`);
    }
    if (
      video.codec_name === "h264" &&
      (video.profile !== "High" || video.level !== 41)
    ) {
      issues.push(
        `编码级别必须为 High@4.1，实际为 ${video.profile ?? "未知"}@${
          video.level === undefined ? "未知" : (video.level / 10).toFixed(1)
        }`,
      );
    }
    if (video.pix_fmt !== "yuv420p") {
      issues.push(`像素格式必须为 8-bit yuv420p，实际为 ${video.pix_fmt ?? "未知"}`);
    }
    if (video.width !== 1920 || video.height !== 1080) {
      issues.push(
        `尺寸必须为 1920×1080，实际为 ${video.width ?? "?"}×${video.height ?? "?"}`,
      );
    }
    if (video.r_frame_rate !== "30/1" || video.avg_frame_rate !== "30/1") {
      issues.push(
        `帧率必须为 30fps CFR，实际为 ${video.r_frame_rate ?? "未知"}/${video.avg_frame_rate ?? "未知"}`,
      );
    }
    if (video.sample_aspect_ratio !== "1:1") {
      issues.push(
        `像素宽高比必须为 1:1，实际为 ${video.sample_aspect_ratio ?? "未知"}`,
      );
    }
    if (video.field_order !== "progressive") {
      issues.push(`扫描方式必须为逐行，实际为 ${video.field_order ?? "未知"}`);
    }
    if (
      video.color_range !== "tv" ||
      video.color_space !== "bt709" ||
      video.color_transfer !== "bt709" ||
      video.color_primaries !== "bt709"
    ) {
      issues.push("色彩必须为 BT.709 limited-range SDR");
    }
  }

  if (issues.length > 0) {
    throw new VideoAssetSpecificationError(issues.join("；"));
  }
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
      if (error instanceof VideoAssetSpecificationError) {
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

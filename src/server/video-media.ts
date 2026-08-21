import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const CLI_PACKAGE = require("@remotion/cli/package.json") as {
  bin: { remotion: string };
};
const CLI_ENTRY = resolve(
  dirname(require.resolve("@remotion/cli/package.json")),
  CLI_PACKAGE.bin.remotion,
);

const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const CLI_OUTPUT_LIMIT = 8 * 1024 * 1024;
const ACCEPTED_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p", "yuv420p10le"]);
const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);
const MP4_MOV_MAJOR_BRANDS = new Set([
  "isom", "iso2", "iso3", "iso4", "iso5", "iso6",
  "mp41", "mp42", "avc1", "hvc1", "hev1", "m4v", "qt",
]);

export type VideoProbeStream = {
  index?: number;
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
  nb_frames?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
  side_data_list?: Array<{ rotation?: number }>;
  tags?: Record<string, string>;
};

export type VideoProbeResult = {
  streams?: VideoProbeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    tags?: Record<string, string>;
  };
};

export type InspectedVideoSource = {
  streamIndex: number;
  codec: "h264" | "hevc";
  sourceWidth: number;
  sourceHeight: number;
  durationSeconds: number;
  rotation: 0 | 90 | 180 | 270;
  enlarged: boolean;
  remuxEligible: boolean;
};

export class VideoMediaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function spawnRemotionCli(
  command: "ffmpeg" | "ffprobe",
  args: string[],
): ChildProcess {
  return spawn(process.execPath, [CLI_ENTRY, command, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function runRemotionCli(
  command: "ffmpeg" | "ffprobe",
  args: string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnRemotionCli(command, args);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let overflow = false;
    let timedOut = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (error !== undefined) rejectPromise(error);
      else {
        resolvePromise({
          stdout: Buffer.concat(stdout, stdoutBytes),
          stderr: Buffer.concat(stderr, stderrBytes).toString("utf8"),
        });
      }
    };
    const terminate = () => child.kill("SIGKILL");
    const abort = () => terminate();
    const timeout = options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          terminate();
        }, options.timeoutMs);

    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > CLI_OUTPUT_LIMIT) {
        overflow = true;
        terminate();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > CLI_OUTPUT_LIMIT) {
        overflow = true;
        terminate();
        return;
      }
      stderr.push(chunk);
    });
    child.once("error", () => finish(new VideoMediaError("REMOTION_CLI_UNAVAILABLE", "Remotion 媒体工具无法启动")));
    child.once("close", (code, signal) => {
      if (options.signal?.aborted) {
        finish(new VideoMediaError("VIDEO_OPERATION_CANCELLED", "视频处理已取消"));
        return;
      }
      if (timedOut) {
        finish(new VideoMediaError("VIDEO_OPERATION_TIMEOUT", "视频处理超时"));
        return;
      }
      if (overflow) {
        finish(new VideoMediaError("VIDEO_TOOL_OUTPUT_LIMIT", "视频工具输出超过安全上限"));
        return;
      }
      if (code !== 0 || signal !== null) {
        finish(new VideoMediaError("VIDEO_TOOL_FAILED", "视频无法解码或处理失败"));
        return;
      }
      finish();
    });
  });
}

export async function probeVideoFile(
  file: string,
  signal?: AbortSignal,
): Promise<VideoProbeResult> {
  const { stdout } = await runRemotionCli(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries",
      "format=format_name,duration:format_tags=major_brand,compatible_brands:stream=index,codec_type,codec_name,profile,level,pix_fmt,width,height,duration,r_frame_rate,avg_frame_rate,sample_aspect_ratio,color_range,color_space,color_transfer,color_primaries,field_order,nb_frames:stream_disposition=attached_pic:stream_tags=alpha_mode,rotate:stream_side_data=rotation",
      "-of", "json",
      file,
    ],
    { signal, timeoutMs: 30_000 },
  );
  try {
    return JSON.parse(stdout.toString("utf8")) as VideoProbeResult;
  } catch {
    throw new VideoMediaError("VIDEO_DECODE_FAILED", "视频内容损坏或无法读取");
  }
}

function normalizedRotation(stream: VideoProbeStream): 0 | 90 | 180 | 270 {
  const sideDataRotation = stream.side_data_list
    ?.find((entry) => Number.isFinite(entry.rotation))
    ?.rotation;
  const taggedRotation = Number(stream.tags?.rotate);
  const value = sideDataRotation ?? (Number.isFinite(taggedRotation) ? taggedRotation : undefined);
  if (value === undefined) return 0;
  const normalized = ((value % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  if (normalized === 0) return 0;
  throw new VideoMediaError(
    "VIDEO_ROTATION_UNSUPPORTED",
    "视频旋转角度必须是 90° 的整数倍",
  );
}

export function requiresVideoEnlargement(width: number, height: number): boolean {
  return Math.min(OUTPUT_WIDTH / width, OUTPUT_HEIGHT / height) > 1 + Number.EPSILON;
}

function isHdr(stream: VideoProbeStream): boolean {
  return (
    HDR_TRANSFERS.has(stream.color_transfer ?? "") ||
    stream.color_primaries === "bt2020" ||
    stream.color_space === "bt2020nc" ||
    stream.color_space === "bt2020ncl" ||
    stream.color_space === "bt2020c"
  );
}

function hasAlpha(stream: VideoProbeStream): boolean {
  const pixelFormat = stream.pix_fmt ?? "";
  return /(^|p)a(?:\d|$)|yuva|gbrap|rgba|argb|bgra|abgr/iu.test(pixelFormat) ||
    stream.tags?.alpha_mode === "1";
}

export function inspectVideoSource(probe: VideoProbeResult): InspectedVideoSource {
  const formatNames = probe.format?.format_name?.split(",") ?? [];
  const majorBrand = probe.format?.tags?.major_brand?.trim().toLowerCase();
  if (
    !formatNames.some((name) => name === "mov" || name === "mp4") ||
    majorBrand === undefined ||
    !MP4_MOV_MAJOR_BRANDS.has(majorBrand)
  ) {
    throw new VideoMediaError("UNSUPPORTED_VIDEO_CONTAINER", "只支持 MP4 或 MOV 视频");
  }
  const streams = probe.streams ?? [];
  const videoStreams = streams.filter(
    (stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  if (videoStreams.length !== 1) {
    throw new VideoMediaError(
      "VIDEO_TRACK_COUNT_INVALID",
      videoStreams.length > 1 ? "检测到多路视频轨" : "没有检测到可用视频轨",
    );
  }
  const stream = videoStreams[0];
  if (stream.codec_name !== "h264" && stream.codec_name !== "hevc") {
    throw new VideoMediaError("VIDEO_CODEC_UNSUPPORTED", "视频编码不受支持");
  }
  if (isHdr(stream)) {
    throw new VideoMediaError("VIDEO_HDR_UNSUPPORTED", "不支持 HDR 视频");
  }
  if (hasAlpha(stream)) {
    throw new VideoMediaError("VIDEO_ALPHA_UNSUPPORTED", "不支持带 Alpha 的视频");
  }
  if (!ACCEPTED_PIXEL_FORMATS.has(stream.pix_fmt ?? "")) {
    throw new VideoMediaError("VIDEO_CHROMA_UNSUPPORTED", "只支持 8/10-bit 4:2:0 视频");
  }
  if (stream.field_order !== "progressive") {
    throw new VideoMediaError("VIDEO_INTERLACED_UNSUPPORTED", "不支持隔行视频");
  }
  const streamDuration = Number(stream.duration);
  const formatDuration = Number(probe.format?.duration);
  const durationSeconds = Number.isFinite(streamDuration) && streamDuration > 0
    ? streamDuration
    : formatDuration;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new VideoMediaError("VIDEO_DURATION_INVALID", "视频没有有效时长");
  }
  if (
    !Number.isInteger(stream.index) ||
    !Number.isFinite(stream.width) ||
    !Number.isFinite(stream.height) ||
    stream.width! <= 0 ||
    stream.height! <= 0
  ) {
    throw new VideoMediaError("VIDEO_DECODE_FAILED", "视频内容损坏或无法读取");
  }
  const rotation = normalizedRotation(stream);
  const rotated = rotation === 90 || rotation === 270;
  const sourceWidth = rotated ? stream.height! : stream.width!;
  const sourceHeight = rotated ? stream.width! : stream.height!;
  const remuxEligible =
    stream.codec_name === "h264" &&
    (stream.profile === "High" || stream.profile === "100") &&
    stream.level === 41 &&
    stream.pix_fmt === "yuv420p" &&
    sourceWidth === OUTPUT_WIDTH &&
    sourceHeight === OUTPUT_HEIGHT &&
    rotation === 0 &&
    stream.r_frame_rate === "30/1" &&
    stream.avg_frame_rate === "30/1" &&
    stream.sample_aspect_ratio === "1:1" &&
    stream.color_range === "tv" &&
    stream.color_space === "bt709" &&
    stream.color_transfer === "bt709" &&
    stream.color_primaries === "bt709";

  return {
    streamIndex: stream.index!,
    codec: stream.codec_name,
    sourceWidth,
    sourceHeight,
    durationSeconds,
    rotation,
    enlarged: requiresVideoEnlargement(sourceWidth, sourceHeight),
    remuxEligible,
  };
}

export function assertNormalizedVideoProbe(probe: VideoProbeResult): void {
  const inspected = inspectVideoSource(probe);
  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.index === inspected.streamIndex)!;
  const duration = Number(probe.format?.duration);
  const frameCount = Number(video.nb_frames);
  if (
    streams.length !== 1 ||
    !inspected.remuxEligible ||
    !Number.isInteger(frameCount) ||
    frameCount <= 0 ||
    Math.abs(frameCount / 30 - duration) > 1 / 15
  ) {
    throw new VideoMediaError("VIDEO_ASSET_NOT_NORMALIZED", "Video Asset 不符合渲染规范");
  }
}

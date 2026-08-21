import { bundle } from "@remotion/bundler";
import {
  makeCancelSignal,
  renderMedia,
  renderStill,
  selectComposition,
  type CancelSignal,
} from "@remotion/renderer";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateProjectConsistency } from "../shared/project";
import { validateRenderReadiness, type RenderSnapshot } from "./render-snapshot";

let bundlePromise: Promise<string> | undefined;

function remotionBundle(): Promise<string> {
  bundlePromise ??= bundle({
    entryPoint: resolve(dirname(fileURLToPath(import.meta.url)), "index.tsx"),
  });
  return bundlePromise;
}

function assertRenderReady(snapshot: RenderSnapshot): void {
  const blocker = [
    ...validateProjectConsistency(snapshot.project),
    ...validateRenderReadiness(snapshot.project, snapshot.mediaAvailability),
  ].find((diagnostic) => diagnostic.severity === "error");
  if (blocker !== undefined) throw new Error(blocker.message);
}

async function selectProjectComposition(snapshot: RenderSnapshot) {
  assertRenderReady(snapshot);
  const serveUrl = await remotionBundle();
  const inputProps = { snapshot };
  const composition = await selectComposition({
    serveUrl,
    id: "NarracutProject",
    inputProps,
  });
  return { serveUrl, inputProps, composition };
}

export async function renderProjectSnapshot(
  snapshot: RenderSnapshot,
  outputLocation: string,
  onProgress?: (progress: number) => void,
  cancelSignal?: CancelSignal,
): Promise<void> {
  const { serveUrl, inputProps, composition } = await selectProjectComposition(snapshot);
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    outputLocation,
    inputProps,
    onProgress: ({ progress }) => onProgress?.(progress),
    cancelSignal,
  });
}

export async function renderProjectStill(
  snapshot: RenderSnapshot,
  output: string,
  frame = 0,
): Promise<void> {
  const { serveUrl, inputProps, composition } = await selectProjectComposition(snapshot);
  await renderStill({
    serveUrl,
    composition,
    output,
    frame,
    inputProps,
  });
}

export async function normalizeVideoWithRemotion(
  input: {
    src: string;
    durationInFrames: number;
    outputLocation: string;
  },
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
): Promise<void> {
  const serveUrl = await remotionBundle();
  const inputProps = {
    src: input.src,
    durationInFrames: input.durationInFrames,
  };
  const composition = await selectComposition({
    serveUrl,
    id: "NarracutNormalizeVideo",
    inputProps,
  });
  const cancellation = makeCancelSignal();
  const abort = () => cancellation.cancel();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  try {
    await renderMedia({
      serveUrl,
      composition,
      codec: "h264",
      outputLocation: input.outputLocation,
      inputProps,
      muted: true,
      enforceAudioTrack: false,
      pixelFormat: "yuv420p",
      colorSpace: "bt709",
      x264Preset: "medium",
      crf: 18,
      metadata: {},
      cancelSignal: cancellation.cancelSignal,
      onProgress: ({ progress }) => options.onProgress?.(progress),
      ffmpegOverride: ({ type, args }) => {
        const output = args.at(-1);
        if (output === undefined) return args;
        if (type === "pre-stitcher") {
          return [
            ...args.slice(0, -1),
            "-profile:v", "high",
            "-level:v", "4.1",
            "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off",
            "-color_range", "tv",
            "-colorspace", "bt709",
            "-color_primaries", "bt709",
            "-color_trc", "bt709",
            output,
          ];
        }
        return [
          ...args.slice(0, -1),
          "-movflags", "+faststart",
          "-color_range", "tv",
          "-colorspace", "bt709",
          "-color_primaries", "bt709",
          "-color_trc", "bt709",
          "-map_metadata", "-1",
          "-map_chapters", "-1",
          output,
        ];
      },
    });
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

import { bundle } from "@remotion/bundler";
import {
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

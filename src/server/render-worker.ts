import { makeCancelSignal, type CancelSignal } from "@remotion/renderer";

import { createRenderSnapshot, validateRenderReadiness } from "../remotion/render-snapshot";
import { renderProjectSnapshot } from "../remotion/renderer";
import { sortAndDedupeDiagnostics } from "../shared/diagnostics";
import {
  validateProjectConsistency,
  validateProjectStructure,
} from "../shared/project";
import { inspectRenderMedia, RenderPreflightError } from "./render-preflight";

type WorkerMessage =
  | { type: "progress"; stage: "preflight" | "loading-media" | "encoding" | "finalizing"; progress?: number }
  | { type: "completed"; durationInFrames: number }
  | {
      type: "failed";
      code: string;
      message: string;
      sceneId?: string;
      frame?: number;
      sequenceName?: string;
      frameRange?: { startFrame: number; endFrame: number };
    };

type WorkerFailureMessage = Extract<WorkerMessage, { type: "failed" }>;

type WorkerInput = {
  snapshotFile: string;
  projectRoot: string;
  mediaBaseUrl: string;
  outputFile: string;
};

function send(message: WorkerMessage): void {
  process.send?.(message);
}

function failureEvidence(error: unknown): Omit<WorkerFailureMessage, "type" | "code" | "message"> {
  const evidence: Omit<WorkerFailureMessage, "type" | "code" | "message"> = {};
  const visited = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    const value = current as Record<string, unknown>;
    if (evidence.sceneId === undefined && typeof value.sceneId === "string") {
      evidence.sceneId = value.sceneId;
    }
    if (evidence.frame === undefined && typeof value.frame === "number" && Number.isFinite(value.frame)) {
      evidence.frame = value.frame;
    }
    if (evidence.sequenceName === undefined && typeof value.sequenceName === "string") {
      evidence.sequenceName = value.sequenceName;
    }
    const frameRange = value.frameRange;
    if (
      evidence.frameRange === undefined &&
      typeof frameRange === "object" &&
      frameRange !== null &&
      typeof Reflect.get(frameRange, "startFrame") === "number" &&
      Number.isFinite(Reflect.get(frameRange, "startFrame")) &&
      typeof Reflect.get(frameRange, "endFrame") === "number" &&
      Number.isFinite(Reflect.get(frameRange, "endFrame"))
    ) {
      evidence.frameRange = {
        startFrame: Reflect.get(frameRange, "startFrame") as number,
        endFrame: Reflect.get(frameRange, "endFrame") as number,
      };
    }
    current = value.cause;
  }
  return evidence;
}

export function renderWorkerFailureMessage(error: unknown): WorkerFailureMessage {
  return {
    type: "failed",
    code: error instanceof RenderPreflightError ? error.code : "RENDER_FAILED",
    message: error instanceof Error ? error.message : "渲染 worker 未能完成任务。",
    ...failureEvidence(error),
  };
}

export async function runRenderWorker(
  input: WorkerInput,
  cancelSignal?: CancelSignal,
): Promise<void> {
  send({ type: "progress", stage: "preflight" });
  const snapshotText = await import("node:fs/promises").then(({ readFile }) =>
    readFile(input.snapshotFile, "utf8"),
  );
  let raw: unknown;
  try {
    raw = JSON.parse(snapshotText);
  } catch {
    throw new Error("project.snapshot.json 不是合法 JSON。");
  }
  const structure = validateProjectStructure(raw);
  if (!structure.success) {
    throw new Error(structure.diagnostics[0]?.message ?? "渲染快照结构无效。");
  }
  send({ type: "progress", stage: "loading-media" });
  const inspection = await inspectRenderMedia(structure.project, input.projectRoot);
  const diagnostics = sortAndDedupeDiagnostics([
    ...validateProjectConsistency(structure.project),
    ...validateRenderReadiness(structure.project, inspection.availability),
    ...inspection.diagnostics,
  ], structure.project.scenes.map((scene) => scene.id));
  const blocker = diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (blocker !== undefined) {
    throw new RenderPreflightError(
      blocker.code,
      blocker.message,
      blocker.sceneId,
      blocker.relativePath,
    );
  }
  const snapshot = createRenderSnapshot(
    structure.project,
    input.mediaBaseUrl,
    inspection.availability,
    {},
    inspection.videoDurationInFrames,
  );
  send({ type: "progress", stage: "encoding", progress: 0 });
  await renderProjectSnapshot(
    snapshot,
    input.outputFile,
    (progress) => {
      send({ type: "progress", stage: "encoding", progress });
    },
    cancelSignal,
  );
  send({ type: "progress", stage: "finalizing", progress: 1 });
  send({ type: "completed", durationInFrames: snapshot.durationInFrames });
}

async function main(): Promise<void> {
  const [snapshotFile, projectRoot, mediaBaseUrl, outputFile] = process.argv.slice(2);
  if ([snapshotFile, projectRoot, mediaBaseUrl, outputFile].some((value) => !value)) {
    throw new Error("渲染 worker 缺少启动参数。");
  }
  const { cancelSignal, cancel } = makeCancelSignal();
  process.once("SIGTERM", cancel);
  process.once("SIGINT", cancel);
  await runRenderWorker(
    { snapshotFile, projectRoot, mediaBaseUrl, outputFile },
    cancelSignal,
  );
}

if (process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error: unknown) => {
    const failure = renderWorkerFailureMessage(error);
    const { message } = failure;
    console.error(`[${new Date().toISOString()}] ${message}`);
    send(failure);
    process.exitCode = 1;
  });
}

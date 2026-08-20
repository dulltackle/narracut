import { makeCancelSignal, type CancelSignal } from "@remotion/renderer";

import { createRenderSnapshot } from "../remotion/render-snapshot";
import { renderProjectSnapshot } from "../remotion/renderer";
import {
  validateProjectConsistency,
  validateProjectStructure,
} from "../shared/project";
import { preflightRenderMedia, RenderPreflightError } from "./render-preflight";

type WorkerMessage =
  | { type: "progress"; stage: "preflight" | "loading-media" | "encoding" | "finalizing"; progress?: number }
  | { type: "completed"; durationInFrames: number }
  | { type: "failed"; code: string; message: string; sceneId?: string; frame?: number };

type WorkerInput = {
  snapshotFile: string;
  projectRoot: string;
  mediaBaseUrl: string;
  outputFile: string;
};

function send(message: WorkerMessage): void {
  process.send?.(message);
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
  const consistencyBlocker = validateProjectConsistency(structure.project).find(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (consistencyBlocker !== undefined) throw new Error(consistencyBlocker.message);

  send({ type: "progress", stage: "loading-media" });
  const availability = await preflightRenderMedia(structure.project, input.projectRoot);
  const snapshot = createRenderSnapshot(
    structure.project,
    input.mediaBaseUrl,
    availability,
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
    const message = error instanceof Error ? error.message : "渲染 worker 未能完成任务。";
    console.error(`[${new Date().toISOString()}] ${message}`);
    send({
      type: "failed",
      code: error instanceof RenderPreflightError ? error.code : "RENDER_FAILED",
      message,
      ...(error instanceof RenderPreflightError && error.sceneId !== undefined
        ? { sceneId: error.sceneId }
        : {}),
    });
    process.exitCode = 1;
  });
}

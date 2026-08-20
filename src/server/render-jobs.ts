import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, chmod, copyFile, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createRenderSnapshot } from "../remotion/render-snapshot";
import type { Project } from "../shared/project";
import type { RenderJob, RenderJobStage } from "../shared/jobs";
import { referencedRenderMedia } from "./render-preflight";

const ACTIVE_STATUSES = new Set<RenderJob["status"]>([
  "queued",
  "processing",
  "cancelling",
]);

export type RenderWorkerInput = {
  snapshotFile: string;
  projectRoot: string;
  mediaBaseUrl: string;
  outputFile: string;
  logFile: string;
};

export type RenderWorkerHandle = {
  on(event: "message", listener: (message: unknown) => void): RenderWorkerHandle;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): RenderWorkerHandle;
  on(event: "error", listener: (error: Error) => void): RenderWorkerHandle;
  kill(signal?: NodeJS.Signals): boolean;
};

type RenderWorkerFactory = (input: RenderWorkerInput) => RenderWorkerHandle;
type CreateRenderJobInput = {
  project: Project;
  mediaBaseUrl: string;
  snapshotSource: RenderJob["snapshotSource"];
  mediaAvailability?: Record<string, boolean>;
};

type InternalRenderJob = RenderJob & { worker?: RenderWorkerHandle };

export class RenderJobError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function publicJob(job: InternalRenderJob): RenderJob {
  const { worker: _worker, ...value } = job;
  return structuredClone(value);
}

function isWorkerMessage(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function defaultWorkerFactory(input: RenderWorkerInput): RenderWorkerHandle {
  const workerFile = fileURLToPath(new URL("./render-worker.ts", import.meta.url));
  const logDescriptor = openSync(input.logFile, "a");
  try {
    return fork(
      workerFile,
      [input.snapshotFile, input.projectRoot, input.mediaBaseUrl, input.outputFile],
      {
        cwd: dirname(workerFile),
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", logDescriptor, logDescriptor, "ipc"],
      },
    );
  } finally {
    closeSync(logDescriptor);
  }
}

async function freezeRenderMedia(
  project: Project,
  projectRoot: string,
  destinationRoot: string,
): Promise<void> {
  const projectRealRoot = await realpath(projectRoot);
  for (const entry of referencedRenderMedia(project)) {
    const source = await realpath(join(projectRoot, ...entry.path.split("/")));
    const contained = relative(projectRealRoot, source);
    if (
      contained === "" ||
      contained === ".." ||
      contained.startsWith(`..${sep}`) ||
      isAbsolute(contained) ||
      !(await stat(source)).isFile()
    ) {
      throw new RenderJobError(422, `渲染媒体不在项目目录内：${entry.path}`);
    }
    const destination = join(destinationRoot, ...entry.path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, 0o444);
  }
}

export class RenderJobs {
  readonly #jobs = new Map<string, InternalRenderJob>();
  readonly #listeners = new Set<(job: RenderJob) => void>();
  readonly #workerFactory: RenderWorkerFactory;
  #creating = false;

  constructor(
    private readonly projectRoot: string,
    options: { workerFactory?: RenderWorkerFactory } = {},
  ) {
    this.#workerFactory = options.workerFactory ?? defaultWorkerFactory;
  }

  list(): RenderJob[] {
    return [...this.#jobs.values()].map(publicJob);
  }

  get(jobId: string): RenderJob | undefined {
    const job = this.#jobs.get(jobId);
    return job === undefined ? undefined : publicJob(job);
  }

  subscribe(listener: (job: RenderJob) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  hasActiveJob(): boolean {
    return [...this.#jobs.values()].some((job) => ACTIVE_STATUSES.has(job.status));
  }

  async create(input: CreateRenderJobInput): Promise<RenderJob> {
    if (this.#creating || this.hasActiveJob()) {
      throw new RenderJobError(409, "当前项目已有活跃的 Render Job。");
    }
    this.#creating = true;
    try {
      return await this.#create(input);
    } finally {
      this.#creating = false;
    }
  }

  async #create(input: CreateRenderJobInput): Promise<RenderJob> {
    const plan = createRenderSnapshot(
      input.project,
      input.mediaBaseUrl,
      input.mediaAvailability,
    );
    const id = randomUUID();
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const directory = join(this.projectRoot, "renders", `${timestamp}-${id}`);
    const snapshot = join(directory, "project.snapshot.json");
    const output = join(directory, "out.mp4");
    const log = join(directory, "render.log");
    const frozenMediaRoot = join(directory, ".media");
    await mkdir(join(this.projectRoot, "renders"), { recursive: true });
    await mkdir(directory, { recursive: false });
    await writeFile(snapshot, `${JSON.stringify(input.project, null, 2)}\n`, {
      mode: 0o444,
      flag: "wx",
    });
    await chmod(snapshot, 0o444);
    await mkdir(frozenMediaRoot, { recursive: false });
    await freezeRenderMedia(input.project, this.projectRoot, frozenMediaRoot);
    await writeFile(
      log,
      `[${new Date().toISOString()}] Render Job ${id} 已从${input.snapshotSource === "saved" ? "已保存" : "未保存"}版本创建。\n`,
      { flag: "wx" },
    );

    const now = new Date().toISOString();
    const job: InternalRenderJob = {
      id,
      type: "render",
      status: "queued",
      stage: "waiting",
      createdAt: now,
      updatedAt: now,
      snapshotSource: input.snapshotSource,
      artifacts: { directory, snapshot, output, log },
      snapshotPlan: plan.scenes.map((scene) => ({
        sceneId: scene.scene.id,
        startFrame: scene.startFrame,
        durationInFrames: scene.durationInFrames,
      })),
    };
    this.#jobs.set(id, job);

    try {
      const worker = this.#workerFactory({
        snapshotFile: snapshot,
        projectRoot: frozenMediaRoot,
        mediaBaseUrl: new URL(
          `renders/${basename(directory)}/.media/`,
          input.mediaBaseUrl,
        ).href,
        outputFile: output,
        logFile: log,
      });
      job.worker = worker;
      this.#update(job, { status: "processing", stage: "starting" });
      worker.on("message", (message) => this.#handleMessage(job, message));
      worker.on("exit", (code, signal) => this.#handleExit(job, code, signal));
      worker.on("error", (error) => this.#handleWorkerError(job, error));
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法启动渲染 worker。";
      this.#update(job, {
        status: "failed",
        stage: "failed",
        error: { code: "RENDER_WORKER_START_FAILED", message },
      });
      await appendFile(log, `[${new Date().toISOString()}] ${message}\n`).catch(() => undefined);
    }

    return publicJob(job);
  }

  cancel(jobId: string): RenderJob | undefined {
    const job = this.#jobs.get(jobId);
    if (job === undefined) return undefined;
    if (!ACTIVE_STATUSES.has(job.status)) return publicJob(job);
    this.#update(job, { status: "cancelling", stage: "cancelling" });
    job.worker?.kill("SIGTERM");
    return publicJob(job);
  }

  close(): void {
    for (const job of this.#jobs.values()) {
      if (ACTIVE_STATUSES.has(job.status)) this.cancel(job.id);
    }
  }

  #handleMessage(job: InternalRenderJob, message: unknown): void {
    if (!isWorkerMessage(message) || typeof message.type !== "string") return;
    if (job.status !== "queued" && job.status !== "processing") return;
    if (message.type === "progress" && typeof message.stage === "string") {
      const progress =
        typeof message.progress === "number" && Number.isFinite(message.progress)
          ? Math.min(1, Math.max(0, message.progress))
          : undefined;
      this.#update(job, {
        status: "processing",
        stage: message.stage as RenderJobStage,
        ...(progress === undefined ? {} : { progress }),
      });
      return;
    }
    if (message.type === "completed") {
      this.#update(job, {
        status: "succeeded",
        stage: "completed",
        progress: 1,
        ...(typeof message.durationInFrames === "number"
          ? { durationInFrames: message.durationInFrames }
          : {}),
      });
      return;
    }
    if (message.type === "failed") {
      this.#update(job, {
        status: "failed",
        stage: "failed",
        error: {
          code: typeof message.code === "string" ? message.code : "RENDER_FAILED",
          message:
            typeof message.message === "string"
              ? message.message
              : "渲染 worker 未能完成任务。",
          ...(typeof message.sceneId === "string" ? { sceneId: message.sceneId } : {}),
          ...(typeof message.frame === "number" ? { frame: message.frame } : {}),
        },
      });
    }
  }

  #handleWorkerError(job: InternalRenderJob, error: Error): void {
    if (job.status === "cancelling") {
      this.#update(job, { status: "cancelled", stage: "cancelled" });
      return;
    }
    if (
      job.status === "succeeded" ||
      job.status === "failed" ||
      job.status === "cancelled"
    ) {
      return;
    }
    this.#update(job, {
      status: "failed",
      stage: "failed",
      error: { code: "RENDER_WORKER_ERROR", message: error.message },
    });
    void appendFile(
      job.artifacts.log,
      `[${new Date().toISOString()}] 渲染 worker 错误：${error.message}\n`,
    ).catch(() => undefined);
  }

  #handleExit(
    job: InternalRenderJob,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    job.worker = undefined;
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return;
    }
    if (job.status === "cancelling") {
      this.#update(job, { status: "cancelled", stage: "cancelled" });
      return;
    }
    const detail = signal === null ? `退出码 ${code ?? "未知"}` : `信号 ${signal}`;
    this.#update(job, {
      status: "failed",
      stage: "failed",
      error: {
        code: "RENDER_WORKER_CRASHED",
        message: `渲染 worker 异常退出（${detail}）；编辑器仍可继续使用。`,
      },
    });
    void appendFile(
      job.artifacts.log,
      `[${new Date().toISOString()}] 渲染 worker 异常退出（${detail}）。\n`,
    ).catch(() => undefined);
  }

  #update(job: InternalRenderJob, patch: Partial<RenderJob>): void {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    const value = publicJob(job);
    for (const listener of this.#listeners) listener(value);
  }
}

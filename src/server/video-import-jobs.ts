import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { normalizeVideoWithRemotion } from "../remotion/renderer";
import type { VideoImportJob } from "../shared/jobs";
import {
  assertNormalizedVideoProbe,
  inspectVideoSource,
  probeVideoFile,
  runRemotionCli,
  VideoMediaError,
  type InspectedVideoSource,
} from "./video-media";

const ACTIVE_STATUSES = new Set(["queued", "processing", "cancelling"]);
const MAX_ACTIVE_JOBS = 8;
const MAX_ACTIVE_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;

type VerificationFacts = { durationSeconds: number; frameCount: number };

type VideoImportPipeline = {
  inspect: (file: string, signal: AbortSignal) => Promise<InspectedVideoSource>;
  remux: (
    source: string,
    output: string,
    streamIndex: number,
    signal: AbortSignal,
  ) => Promise<void>;
  transcode: (
    source: string,
    bridge: string,
    bridgeUrl: string,
    output: string,
    durationInFrames: number,
    streamIndex: number,
    rotation: 0 | 90 | 180 | 270,
    signal: AbortSignal,
    onProgress: (progress: number) => void,
  ) => Promise<void>;
  verify: (file: string, signal: AbortSignal) => Promise<VerificationFacts | void>;
};

type InternalJob = VideoImportJob & {
  sourceFile: string;
  sourceBytes: number;
  controller?: AbortController;
};

export class VideoImportJobError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function publicJob(job: InternalJob): VideoImportJob {
  const {
    sourceFile: _sourceFile,
    sourceBytes: _sourceBytes,
    controller: _controller,
    ...value
  } = job;
  return structuredClone(value);
}

function mediaUrl(base: string, path: string): string {
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return `${normalized}${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function defaultRemux(
  source: string,
  output: string,
  streamIndex: number,
  signal: AbortSignal,
): Promise<void> {
  await runRemotionCli(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-i", source,
      "-map", `0:${streamIndex}`,
      "-c:v", "copy",
      "-an", "-sn", "-dn",
      "-map_metadata", "-1",
      "-map_chapters", "-1",
      "-metadata:s:v:0", "rotate=0",
      "-movflags", "+faststart",
      output,
    ],
    { signal, timeoutMs: 10 * 60_000 },
  );
}

async function defaultVerify(
  file: string,
  signal: AbortSignal,
): Promise<VerificationFacts> {
  const probe = await probeVideoFile(file, signal);
  assertNormalizedVideoProbe(probe);
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  return {
    durationSeconds: Number(probe.format?.duration),
    frameCount: Number(video?.nb_frames),
  };
}

function defaultPipeline(): VideoImportPipeline {
  return {
    inspect: async (file, signal) => inspectVideoSource(await probeVideoFile(file, signal)),
    remux: defaultRemux,
    transcode: async (
      source,
      bridge,
      bridgeUrl,
      output,
      durationInFrames,
      streamIndex,
      rotation,
      signal,
      onProgress,
    ) => {
      await runRemotionCli(
        "ffmpeg",
        [
          "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
          "-noautorotate", "-display_rotation", String(rotation), "-i", source,
          "-map", `0:${streamIndex}`,
          "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1",
          "-pix_fmt", "yuv420p",
          "-an", "-sn", "-dn",
          "-map_metadata", "-1", "-map_chapters", "-1",
          "-movflags", "+faststart",
          bridge,
        ],
        { signal, timeoutMs: 10 * 60_000 },
      );
      await normalizeVideoWithRemotion(
        { src: bridgeUrl, outputLocation: output, durationInFrames },
        { signal, onProgress },
      );
    },
    verify: defaultVerify,
  };
}

function failureFor(error: unknown): { code: string; message: string } {
  if (error instanceof VideoMediaError) {
    if (error.code === "VIDEO_OPERATION_CANCELLED") {
      return { code: error.code, message: "视频导入已取消" };
    }
    return { code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (/permission denied|EACCES|EROFS|ENOSPC/iu.test(message)) {
    return { code: "PROJECT_WRITE_FAILED", message: "无法写入项目文件夹" };
  }
  if (/cancel|abort/iu.test(message)) {
    return { code: "VIDEO_OPERATION_CANCELLED", message: "视频导入已取消" };
  }
  return { code: "VIDEO_TRANSCODE_FAILED", message: "视频规范化失败——请重试" };
}

export class VideoImportJobs {
  readonly #jobs = new Map<string, InternalJob>();
  readonly #listeners = new Set<(job: VideoImportJob) => void>();
  readonly #queue: string[] = [];
  readonly #pipeline: VideoImportPipeline;
  readonly #cleanupPromises = new Set<Promise<void>>();
  #activeJobId: string | undefined;
  #activePromise: Promise<void> | undefined;

  constructor(
    private readonly projectRoot: string,
    private readonly options: {
      mediaBaseUrl: () => string;
      pipeline?: VideoImportPipeline;
    },
  ) {
    this.#pipeline = options.pipeline ?? defaultPipeline();
  }

  list(): VideoImportJob[] {
    return [...this.#jobs.values()].map(publicJob);
  }

  get(jobId: string): VideoImportJob | undefined {
    const job = this.#jobs.get(jobId);
    return job === undefined ? undefined : publicJob(job);
  }

  subscribe(listener: (job: VideoImportJob) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async close(): Promise<void> {
    for (const job of this.#jobs.values()) {
      if (ACTIVE_STATUSES.has(job.status)) this.cancel(job.id);
    }
    await Promise.allSettled([
      ...(this.#activePromise === undefined ? [] : [this.#activePromise]),
      ...this.#cleanupPromises,
    ]);
  }

  assertCanCreate(sceneId: string, sourceBytes = 0): void {
    if ([...this.#jobs.values()].some(
      (job) => job.sceneId === sceneId && ACTIVE_STATUSES.has(job.status),
    )) {
      throw new VideoImportJobError(409, "这个 Scene 已有视频正在导入。");
    }
    if ([...this.#jobs.values()].filter((job) => ACTIVE_STATUSES.has(job.status)).length >= MAX_ACTIVE_JOBS) {
      throw new VideoImportJobError(429, "视频导入队列已满，请等待当前任务完成。");
    }
    const activeSourceBytes = [...this.#jobs.values()]
      .filter((job) => ACTIVE_STATUSES.has(job.status))
      .reduce((sum, job) => sum + job.sourceBytes, 0);
    if (activeSourceBytes + sourceBytes > MAX_ACTIVE_SOURCE_BYTES) {
      throw new VideoImportJobError(429, "视频导入队列的源文件总量已达上限。");
    }
  }

  create(input: {
    sceneId: string;
    fileName: string;
    sourceFile: string;
    sourceBytes: number;
  }): VideoImportJob {
    this.assertCanCreate(input.sceneId, input.sourceBytes);
    const now = new Date().toISOString();
    const job: InternalJob = {
      id: randomUUID(),
      type: "video-import",
      sceneId: input.sceneId,
      fileName: input.fileName,
      status: "queued",
      stage: "waiting",
      createdAt: now,
      updatedAt: now,
      sourceFile: input.sourceFile,
      sourceBytes: input.sourceBytes,
    };
    this.#jobs.set(job.id, job);
    this.#queue.push(job.id);
    setImmediate(() => this.#drain());
    return publicJob(job);
  }

  cancel(jobId: string): VideoImportJob | undefined {
    const job = this.#jobs.get(jobId);
    if (job === undefined) return undefined;
    if (!ACTIVE_STATUSES.has(job.status)) return publicJob(job);
    if (job.status === "queued") {
      const index = this.#queue.indexOf(jobId);
      if (index >= 0) {
        this.#queue.splice(index, 1);
        const sourceFile = job.sourceFile;
        job.sourceFile = "";
        job.sourceBytes = 0;
        this.#update(job, { status: "cancelled", stage: "cancelled" });
        const cleanup = unlink(sourceFile)
          .catch(() => {
            this.#update(job, {
              error: {
                code: "TEMP_CLEANUP_FAILED",
                message: "临时文件清理失败——查看任务详情",
                cleanupFailed: true,
              },
            });
          })
          .finally(() => {
            this.#cleanupPromises.delete(cleanup);
          });
        this.#cleanupPromises.add(cleanup);
        this.#drain();
        return publicJob(job);
      }
    }
    this.#update(job, { status: "cancelling", stage: "cancelling" });
    job.controller?.abort();
    return publicJob(job);
  }

  #update(job: InternalJob, patch: Partial<VideoImportJob>): void {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    const value = publicJob(job);
    for (const listener of this.#listeners) listener(value);
  }

  #drain(): void {
    if (this.#activeJobId !== undefined) return;
    while (this.#queue.length > 0) {
      const id = this.#queue.shift()!;
      const job = this.#jobs.get(id);
      if (job === undefined || job.status !== "queued") continue;
      this.#activeJobId = id;
      const processing = this.#process(job).finally(() => {
        this.#activeJobId = undefined;
        if (this.#activePromise === processing) this.#activePromise = undefined;
        this.#drain();
      });
      this.#activePromise = processing;
      void processing;
      return;
    }
  }

  async #process(job: InternalJob): Promise<void> {
    const assetId = randomUUID();
    const assetsDirectory = join(this.projectRoot, "assets");
    const finalPath = `assets/${assetId}.mp4`;
    let sourceFile = "";
    let outputFile = "";
    let bridgeFile = "";
    let finalFile = "";
    let published = false;
    let succeeded = false;
    let cleanupFailed = false;
    const controller = new AbortController();
    job.controller = controller;
    this.#update(job, { status: "processing", stage: "waiting" });

    try {
      await mkdir(assetsDirectory, { recursive: true });
      const [projectRealRoot, assetsRealDirectory] = await Promise.all([
        realpath(this.projectRoot),
        realpath(assetsDirectory),
      ]);
      const contained = relative(projectRealRoot, assetsRealDirectory);
      if (
        contained === "" || contained === ".." ||
        contained.startsWith(`..${sep}`) || isAbsolute(contained)
      ) {
        throw new VideoMediaError("PROJECT_WRITE_FAILED", "无法写入项目文件夹");
      }
      sourceFile = job.sourceFile;
      job.sourceFile = "";
      outputFile = join(assetsRealDirectory, `.${job.id}.output.tmp.mp4`);
      bridgeFile = join(assetsRealDirectory, `.${job.id}.bridge.tmp.mp4`);
      finalFile = join(assetsRealDirectory, `${assetId}.mp4`);
      if (controller.signal.aborted) throw new VideoMediaError("VIDEO_OPERATION_CANCELLED", "视频导入已取消");

      this.#update(job, { stage: "probing" });
      const sourceFacts = await this.#pipeline.inspect(sourceFile, controller.signal);
      if (controller.signal.aborted) throw new VideoMediaError("VIDEO_OPERATION_CANCELLED", "视频导入已取消");

      this.#update(job, { stage: "normalizing", progress: sourceFacts.remuxEligible ? undefined : 0 });
      if (sourceFacts.remuxEligible) {
        await this.#pipeline.remux(
          sourceFile,
          outputFile,
          sourceFacts.streamIndex,
          controller.signal,
        );
      } else {
        await this.#pipeline.transcode(
          sourceFile,
          bridgeFile,
          mediaUrl(this.options.mediaBaseUrl(), `assets/.${job.id}.bridge.tmp.mp4`),
          outputFile,
          Math.max(1, Math.ceil(sourceFacts.durationSeconds * 30)),
          sourceFacts.streamIndex,
          sourceFacts.rotation,
          controller.signal,
          (progress) => this.#update(job, {
            progress: Math.max(0, Math.min(1, progress)),
          }),
        );
      }
      if (controller.signal.aborted) throw new VideoMediaError("VIDEO_OPERATION_CANCELLED", "视频导入已取消");

      this.#update(job, { stage: "verifying", progress: undefined });
      const verified = await this.#pipeline.verify(outputFile, controller.signal);
      if (controller.signal.aborted) throw new VideoMediaError("VIDEO_OPERATION_CANCELLED", "视频导入已取消");

      this.#update(job, { stage: "finalizing" });
      await rename(outputFile, finalFile);
      published = true;
      if (controller.signal.aborted) throw new VideoMediaError("VIDEO_OPERATION_CANCELLED", "视频导入已取消");
      succeeded = true;
      this.#update(job, {
        status: "succeeded",
        stage: "completed",
        result: {
          asset: { id: assetId, kind: "video", path: finalPath },
          facts: {
            sourceWidth: sourceFacts.sourceWidth,
            sourceHeight: sourceFacts.sourceHeight,
            width: 1920,
            height: 1080,
            durationSeconds: verified?.durationSeconds ?? sourceFacts.durationSeconds,
            frameCount: verified?.frameCount ?? Math.max(1, Math.ceil(sourceFacts.durationSeconds * 30)),
            enlarged: sourceFacts.enlarged,
            mode: sourceFacts.remuxEligible ? "remux" : "transcode",
          },
        },
      });
    } catch (error) {
      if (published && !succeeded) {
        try {
          await unlink(finalFile);
          published = false;
        } catch {
          this.#update(job, {
            status: "failed",
            stage: "failed",
            error: { code: "PROJECT_WRITE_FAILED", message: "取消导入后无法移除未发布的 Asset" },
          });
          return;
        }
      }
      const failure = failureFor(error);
      if (controller.signal.aborted || failure.code === "VIDEO_OPERATION_CANCELLED") {
        this.#update(job, { status: "cancelled", stage: "cancelled", progress: undefined });
      } else {
        this.#update(job, {
          status: "failed",
          stage: "failed",
          progress: undefined,
          error: failure,
        });
      }
    } finally {
      job.controller = undefined;
      job.sourceFile = "";
      job.sourceBytes = 0;
      for (const file of succeeded
        ? [sourceFile, bridgeFile]
        : [sourceFile, bridgeFile, outputFile]) {
        if (file === "") continue;
        try {
          await unlink(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupFailed = true;
        }
      }
      if (cleanupFailed) {
        this.#update(job, {
          error: {
            code: job.error?.code ?? "TEMP_CLEANUP_FAILED",
            message: "临时文件清理失败——查看任务详情",
            cleanupFailed: true,
          },
        });
      }
    }
  }
}

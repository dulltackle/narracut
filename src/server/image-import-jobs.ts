import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import sharp, { type Sharp } from "sharp";

import type { ImageImportJob } from "../shared/jobs";

const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const WARM_BLACK = { r: 42, g: 34, b: 38, alpha: 1 } as const;
const ACCEPTED_FORMATS = new Set(["png", "jpeg", "webp"]);
const ACTIVE_STATUSES = new Set(["queued", "processing", "cancelling"]);

type InternalJob = ImageImportJob & {
  source: Buffer;
  cancelRequested: boolean;
  pipeline?: Sharp;
};

export class ImageImportJobError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

class ImportFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class ImportCancelled extends Error {}

function publicJob(job: InternalJob): ImageImportJob {
  const { source: _source, cancelRequested: _cancelRequested, pipeline: _pipeline, ...value } =
    job;
  return structuredClone(value);
}

function orientedDimensions(
  width: number,
  height: number,
  orientation: number | undefined,
): { width: number; height: number } {
  return orientation !== undefined && orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

function requiresEnlargement(width: number, height: number): boolean {
  return Math.min(OUTPUT_WIDTH / width, OUTPUT_HEIGHT / height) > 1;
}

function mapProcessingError(error: unknown): ImportFailure {
  if (error instanceof ImportFailure) return error;
  const message = error instanceof Error ? error.message : "";
  if (/permission denied|EACCES|EROFS|ENOSPC/iu.test(message)) {
    return new ImportFailure("PROJECT_WRITE_FAILED", "无法写入项目文件夹");
  }
  return new ImportFailure("IMAGE_DECODE_FAILED", "图片内容损坏或无法读取");
}

export class ImageImportJobs {
  readonly #jobs = new Map<string, InternalJob>();
  readonly #listeners = new Set<(job: ImageImportJob) => void>();

  constructor(private readonly projectRoot: string) {}

  list(): ImageImportJob[] {
    return [...this.#jobs.values()].map(publicJob);
  }

  get(jobId: string): ImageImportJob | undefined {
    const job = this.#jobs.get(jobId);
    return job === undefined ? undefined : publicJob(job);
  }

  subscribe(listener: (job: ImageImportJob) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  create(input: { sceneId: string; fileName: string; source: Buffer }): ImageImportJob {
    if (
      [...this.#jobs.values()].some(
        (job) => job.sceneId === input.sceneId && ACTIVE_STATUSES.has(job.status),
      )
    ) {
      throw new ImageImportJobError(409, "这个 Scene 已有图片正在导入。");
    }
    const now = new Date().toISOString();
    const job: InternalJob = {
      id: randomUUID(),
      type: "image-import",
      sceneId: input.sceneId,
      fileName: input.fileName,
      status: "queued",
      stage: "waiting",
      createdAt: now,
      updatedAt: now,
      source: input.source,
      cancelRequested: false,
    };
    this.#jobs.set(job.id, job);
    setImmediate(() => void this.#process(job));
    return publicJob(job);
  }

  cancel(jobId: string): ImageImportJob | undefined {
    const job = this.#jobs.get(jobId);
    if (job === undefined) return undefined;
    if (!ACTIVE_STATUSES.has(job.status)) return publicJob(job);
    job.cancelRequested = true;
    this.#update(job, { status: "cancelling", stage: "cancelling" });
    job.pipeline?.destroy();
    return publicJob(job);
  }

  #update(job: InternalJob, patch: Partial<ImageImportJob>): void {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    const value = publicJob(job);
    for (const listener of this.#listeners) listener(value);
  }

  #throwIfCancelled(job: InternalJob): void {
    if (job.cancelRequested) throw new ImportCancelled();
  }

  async #process(job: InternalJob): Promise<void> {
    const assetId = randomUUID();
    const assetsDirectory = join(this.projectRoot, "assets");
    let sourceFile = "";
    let outputFile = "";
    const finalPath = `assets/${assetId}.png`;
    let finalFile = "";
    let completed = false;
    let finalWritten = false;
    let cleanupFailed = false;

    try {
      await mkdir(assetsDirectory, { recursive: true });
      const [projectRealRoot, assetsRealDirectory] = await Promise.all([
        realpath(this.projectRoot),
        realpath(assetsDirectory),
      ]);
      const relativeAssets = relative(projectRealRoot, assetsRealDirectory);
      if (
        relativeAssets === "" ||
        relativeAssets === ".." ||
        relativeAssets.startsWith(`..${sep}`) ||
        isAbsolute(relativeAssets)
      ) {
        throw new ImportFailure("PROJECT_WRITE_FAILED", "无法写入项目文件夹");
      }
      sourceFile = join(assetsRealDirectory, `.${job.id}.source.tmp`);
      outputFile = join(assetsRealDirectory, `.${job.id}.output.tmp.png`);
      finalFile = join(assetsRealDirectory, `${assetId}.png`);
      this.#throwIfCancelled(job);
      await writeFile(sourceFile, job.source, { flag: "wx" });
      job.source = Buffer.alloc(0);

      this.#update(job, { status: "processing", stage: "validating" });
      const metadata = await sharp(sourceFile, { animated: true }).metadata();
      this.#throwIfCancelled(job);
      if (metadata.format !== undefined && !ACCEPTED_FORMATS.has(metadata.format)) {
        throw new ImportFailure("UNSUPPORTED_IMAGE_FORMAT", "不支持这种图片格式");
      }
      if ((metadata.pages ?? 1) > 1) {
        throw new ImportFailure(
          "ANIMATED_IMAGE_UNSUPPORTED",
          "动画图片不能作为 Image Asset",
        );
      }
      if (
        metadata.format === undefined ||
        metadata.width === undefined ||
        metadata.height === undefined
      ) {
        throw new ImportFailure("IMAGE_DECODE_FAILED", "图片内容损坏或无法读取");
      }
      const sourceDimensions = orientedDimensions(
        metadata.width,
        metadata.height,
        metadata.orientation,
      );

      this.#update(job, { stage: "normalizing" });
      const pipeline = sharp(sourceFile, { animated: false })
        .autoOrient()
        .resize({
          width: OUTPUT_WIDTH,
          height: OUTPUT_HEIGHT,
          fit: "contain",
          background: WARM_BLACK,
        })
        .toColourspace("srgb")
        .png({ compressionLevel: 9, palette: false, progressive: false });
      job.pipeline = pipeline;
      await pipeline.toFile(outputFile);
      job.pipeline = undefined;
      this.#throwIfCancelled(job);

      this.#update(job, { stage: "verifying" });
      const normalized = await sharp(outputFile, { animated: true }).metadata();
      if (
        normalized.format !== "png" ||
        normalized.width !== OUTPUT_WIDTH ||
        normalized.height !== OUTPUT_HEIGHT ||
        normalized.depth !== "uchar" ||
        normalized.space !== "srgb" ||
        (normalized.pages ?? 1) !== 1
      ) {
        throw new ImportFailure("IMAGE_VERIFY_FAILED", "图片内容损坏或无法读取");
      }
      this.#throwIfCancelled(job);

      this.#update(job, { stage: "finalizing" });
      await rename(outputFile, finalFile);
      finalWritten = true;
      this.#throwIfCancelled(job);
      completed = true;
      this.#update(job, {
        status: "succeeded",
        stage: "completed",
        result: {
          asset: { id: assetId, kind: "image", path: finalPath },
          facts: {
            sourceWidth: sourceDimensions.width,
            sourceHeight: sourceDimensions.height,
            width: OUTPUT_WIDTH,
            height: OUTPUT_HEIGHT,
            enlarged: requiresEnlargement(
              sourceDimensions.width,
              sourceDimensions.height,
            ),
          },
        },
      });
    } catch (error) {
      job.pipeline = undefined;
      if (finalWritten && !completed) {
        try {
          await unlink(finalFile);
          finalWritten = false;
        } catch {
          const failure = new ImportFailure(
            "PROJECT_WRITE_FAILED",
            "取消导入后无法移除未发布的 Asset",
          );
          this.#update(job, {
            status: "failed",
            stage: "failed",
            error: { code: failure.code, message: failure.message },
          });
          return;
        }
      }
      if (error instanceof ImportCancelled || job.cancelRequested) {
        this.#update(job, { status: "cancelled", stage: "cancelled" });
      } else {
        const failure = mapProcessingError(error);
        this.#update(job, {
          status: "failed",
          stage: "failed",
          error: { code: failure.code, message: failure.message },
        });
      }
    } finally {
      job.source = Buffer.alloc(0);
      for (const file of completed ? [sourceFile] : [sourceFile, outputFile]) {
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

import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

import sharp from "sharp";

import { spawnRemotionCli } from "./video-media";

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_CACHE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 512;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const EXTRACTION_TIMEOUT_MS = 10_000;

type FileSignature = {
  value: string;
  etag: string;
};

type Thumbnail = {
  bytes: Buffer;
  etag: string;
};

type CacheEntry = Thumbnail & {
  path: string;
  size: number;
};

type QueueEntry<T> = {
  operation: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export class VideoThumbnailError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

class SourceChangedError extends Error {}

export type VideoThumbnailServiceOptions = {
  extractFrame?: (file: string, signal: AbortSignal) => Promise<Buffer>;
  maxConcurrent?: number;
  maxCacheBytes?: number;
  maxCacheEntries?: number;
};

async function fileSignature(file: string, relativePath: string): Promise<FileSignature> {
  let value: string;
  try {
    const facts = await stat(file, { bigint: true });
    if (!facts.isFile()) throw new VideoThumbnailError(404, "视频文件不存在。");
    value = [
      relativePath,
      facts.dev,
      facts.ino,
      facts.size,
      facts.mtimeNs,
      facts.ctimeNs,
    ].join(":");
  } catch (error) {
    if (error instanceof VideoThumbnailError) throw error;
    if (
      error instanceof Error && "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      throw new VideoThumbnailError(404, "视频文件不存在。");
    }
    throw new VideoThumbnailError(503, "暂时无法读取视频文件。");
  }
  return {
    value,
    etag: `"thumbnail-${createHash("sha256").update(value).digest("hex")}"`,
  };
}

async function extractFrameWithFfmpeg(file: string, signal: AbortSignal): Promise<Buffer> {
  const sourceFrame = await new Promise<Buffer>((resolvePromise, rejectPromise) => {
    const child = spawnRemotionCli(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-ss",
        "0",
        "-i",
        file,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
      ],
    );

    const output: Buffer[] = [];
    let outputBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let failure: VideoThumbnailError | undefined;

    const finish = (error?: VideoThumbnailError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      if (error !== undefined) rejectPromise(error);
      else resolvePromise(Buffer.concat(output, outputBytes));
    };
    const terminate = (error: VideoThumbnailError) => {
      failure = error;
      child.kill("SIGKILL");
    };
    const abort = () => terminate(new VideoThumbnailError(503, "首帧服务正在关闭。"));
    const timeout = setTimeout(
      () => terminate(new VideoThumbnailError(503, "生成视频首帧超时。")),
      EXTRACTION_TIMEOUT_MS,
    );

    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });

    child.once("error", (error) => {
      const unavailable = "code" in error && error.code === "ENOENT";
      finish(new VideoThumbnailError(503, unavailable ? "FFmpeg 不可用。" : "无法启动 FFmpeg。"));
    });
    child.stdout!.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        terminate(new VideoThumbnailError(422, "生成的首帧超过大小上限。"));
        return;
      }
      output.push(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_STDERR_BYTES) {
        terminate(new VideoThumbnailError(422, "视频解码错误输出超过大小上限。"));
      }
    });
    child.once("close", (code) => {
      if (failure !== undefined) {
        finish(failure);
        return;
      }
      if (code !== 0 || outputBytes === 0) {
        finish(new VideoThumbnailError(422, "视频无法解码或没有可用画面。"));
        return;
      }
      finish();
    });
  });
  return sharp(sourceFrame)
    .resize(320, 180, { fit: "contain", background: "#2A2226" })
    .jpeg({ quality: 75 })
    .toBuffer();
}

export class VideoThumbnailService {
  readonly #extractFrame: (file: string, signal: AbortSignal) => Promise<Buffer>;
  readonly #maxConcurrent: number;
  readonly #maxCacheBytes: number;
  readonly #maxCacheEntries: number;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #pathKeys = new Map<string, string>();
  readonly #inFlight = new Map<string, Promise<Thumbnail>>();
  readonly #queue: Array<QueueEntry<Thumbnail>> = [];
  readonly #activeControllers = new Set<AbortController>();
  readonly #activePromises = new Set<Promise<unknown>>();
  #cacheBytes = 0;
  #active = 0;
  #closing = false;

  constructor({
    extractFrame = extractFrameWithFfmpeg,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    maxCacheBytes = DEFAULT_MAX_CACHE_BYTES,
    maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
  }: VideoThumbnailServiceOptions = {}) {
    this.#extractFrame = extractFrame;
    this.#maxConcurrent = maxConcurrent;
    this.#maxCacheBytes = maxCacheBytes;
    this.#maxCacheEntries = maxCacheEntries;
  }

  async get(relativePath: string, file: string): Promise<Thumbnail> {
    if (this.#closing) throw new VideoThumbnailError(503, "首帧服务正在关闭。");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const signature = await fileSignature(file, relativePath);
      try {
        return await this.#getBySignature(relativePath, file, signature);
      } catch (error) {
        if (error instanceof SourceChangedError && attempt === 0) continue;
        if (error instanceof SourceChangedError) {
          throw new VideoThumbnailError(409, "视频文件在生成首帧期间持续变化。");
        }
        throw error;
      }
    }
    throw new VideoThumbnailError(409, "视频文件在生成首帧期间持续变化。");
  }

  async close(): Promise<void> {
    this.#closing = true;
    const error = new VideoThumbnailError(503, "首帧服务正在关闭。");
    for (const queued of this.#queue.splice(0)) queued.reject(error);
    for (const controller of this.#activeControllers) controller.abort();
    await Promise.allSettled([...this.#activePromises]);
    this.#cache.clear();
    this.#pathKeys.clear();
    this.#cacheBytes = 0;
  }

  async #getBySignature(
    relativePath: string,
    file: string,
    signature: FileSignature,
  ): Promise<Thumbnail> {
    const cached = this.#cache.get(signature.value);
    if (cached !== undefined) {
      this.#cache.delete(signature.value);
      this.#cache.set(signature.value, cached);
      return { bytes: cached.bytes, etag: cached.etag };
    }
    const pending = this.#inFlight.get(signature.value);
    if (pending !== undefined) return pending;

    const operation = this.#schedule(async (signal) => {
      const bytes = await this.#extractFrame(file, signal);
      const after = await fileSignature(file, relativePath);
      if (after.value !== signature.value) throw new SourceChangedError();
      const result = { bytes, etag: signature.etag };
      this.#insert(relativePath, signature.value, result);
      return result;
    });
    this.#inFlight.set(signature.value, operation);
    void operation.finally(() => this.#inFlight.delete(signature.value)).catch(() => undefined);
    return operation;
  }

  #schedule(operation: QueueEntry<Thumbnail>["operation"]): Promise<Thumbnail> {
    if (this.#closing) return Promise.reject(new VideoThumbnailError(503, "首帧服务正在关闭。"));
    return new Promise<Thumbnail>((resolvePromise, rejectPromise) => {
      this.#queue.push({ operation, resolve: resolvePromise, reject: rejectPromise });
      this.#drain();
    });
  }

  #drain(): void {
    while (!this.#closing && this.#active < this.#maxConcurrent) {
      const queued = this.#queue.shift();
      if (queued === undefined) return;
      const controller = new AbortController();
      this.#active += 1;
      this.#activeControllers.add(controller);
      const running = queued.operation(controller.signal);
      this.#activePromises.add(running);
      void running.then(queued.resolve, queued.reject).finally(() => {
        this.#active -= 1;
        this.#activeControllers.delete(controller);
        this.#activePromises.delete(running);
        this.#drain();
      });
    }
  }

  #insert(relativePath: string, key: string, thumbnail: Thumbnail): void {
    const previousKey = this.#pathKeys.get(relativePath);
    if (previousKey !== undefined && previousKey !== key) this.#delete(previousKey);
    const previous = this.#cache.get(key);
    if (previous !== undefined) this.#cacheBytes -= previous.size;
    const entry = { ...thumbnail, path: relativePath, size: thumbnail.bytes.byteLength };
    this.#cache.delete(key);
    this.#cache.set(key, entry);
    this.#pathKeys.set(relativePath, key);
    this.#cacheBytes += entry.size;
    while (
      this.#cache.size > this.#maxCacheEntries ||
      this.#cacheBytes > this.#maxCacheBytes
    ) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#delete(oldest);
    }
  }

  #delete(key: string): void {
    const entry = this.#cache.get(key);
    if (entry === undefined) return;
    this.#cache.delete(key);
    this.#cacheBytes -= entry.size;
    if (this.#pathKeys.get(entry.path) === key) this.#pathKeys.delete(entry.path);
  }
}

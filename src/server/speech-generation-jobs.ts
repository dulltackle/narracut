import { execFile, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { CURRENT_TTS_PROFILE_ID } from "../shared/project";
import type { SpeechGenerationJob } from "../shared/jobs";

const execFileAsync = promisify(execFile);
const TOKEN_DANCE_T2A_URL =
  "https://tokendance.space/gateway/minimax/v1/t2a_v2";
const TOKEN_DANCE_MODEL = "minimax-speech-2.8-turbo";
const TOKEN_DANCE_VOICE = "Chinese (Mandarin)_News_Anchor";
const ACTIVE_STATUSES = new Set(["queued", "processing", "cancelling"]);
const DEFAULT_RETRY_DELAYS_MS = [500, 1_500] as const;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DURATION_TOLERANCE_MS = 34;

type InternalJob = SpeechGenerationJob & {
  cancelRequested: boolean;
  controller?: AbortController;
  temporaryFile?: string;
  finalFile?: string;
  backupFile?: string;
  hadPreviousFile?: boolean;
  committed?: boolean;
  worker?: SpeechWorkerHandle;
};

type ProviderPayload = {
  data?: { audio?: unknown };
  extra_info?: { audio_length?: unknown; audio_format?: unknown };
  base_resp?: { status_code?: unknown; status_msg?: unknown };
};

type SpeechGenerationJobsOptions = {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  retryDelaysMs?: readonly number[];
  requestTimeoutMs?: number;
  workerFactory?: SpeechWorkerFactory;
  runInline?: boolean;
};

export type SpeechWorkerInput = {
  jobId: string;
  projectRoot: string;
  sceneId: string;
  narrationText: string;
  apiKey?: string;
  retryDelaysMs: readonly number[];
  requestTimeoutMs: number;
};

export type SpeechWorkerState = {
  job: SpeechGenerationJob;
  temporaryFile?: string;
  finalFile?: string;
};

export type SpeechWorkerHandle = {
  on(event: "message", listener: (message: unknown) => void): SpeechWorkerHandle;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): SpeechWorkerHandle;
  on(event: "error", listener: (error: Error) => void): SpeechWorkerHandle;
  kill(signal?: NodeJS.Signals): boolean;
};

type SpeechWorkerFactory = (input: SpeechWorkerInput) => SpeechWorkerHandle;

export class SpeechGenerationJobError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

class SpeechFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

class SpeechCancelled extends Error {}

function publicJob(job: InternalJob): SpeechGenerationJob {
  const {
    cancelRequested: _cancelRequested,
    controller: _controller,
    temporaryFile: _temporaryFile,
    finalFile: _finalFile,
    backupFile: _backupFile,
    hadPreviousFile: _hadPreviousFile,
    committed: _committed,
    worker: _worker,
    ...value
  } = job;
  return structuredClone(value);
}

function defaultWorkerFactory(input: SpeechWorkerInput): SpeechWorkerHandle {
  const workerFile = fileURLToPath(new URL("./speech-generation-worker.ts", import.meta.url));
  const worker = fork(workerFile, [], {
    cwd: dirname(workerFile),
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  worker.send(input);
  return worker;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safeProviderMessage(payload: ProviderPayload | undefined): string {
  const message = payload?.base_resp?.status_msg;
  return typeof message === "string" ? message.slice(0, 240) : "";
}

function providerFailure(status: number, payload?: ProviderPayload): SpeechFailure {
  const providerMessage = safeProviderMessage(payload);
  if (status === 401 || status === 403 || /auth|key|余额|鉴权|认证/iu.test(providerMessage)) {
    return new SpeechFailure(
      "TTS_AUTH_FAILED",
      "TokenDance 鉴权失败，请检查应用安装环境中的 API key。",
      false,
    );
  }
  if (status === 429 || /rate|limit|限流|频率/iu.test(providerMessage)) {
    return new SpeechFailure(
      "TTS_RATE_LIMITED",
      "TokenDance 当前请求过多，请稍后重试。",
      true,
    );
  }
  if (/model|模型/iu.test(providerMessage)) {
    return new SpeechFailure(
      "TTS_MODEL_ERROR",
      "固定 Speech 模型当前不可用，请检查应用版本或稍后重试。",
      false,
    );
  }
  if (status >= 500) {
    return new SpeechFailure(
      "TTS_PROVIDER_UNAVAILABLE",
      "Speech 提供方暂时不可用，请稍后重试。",
      true,
    );
  }
  return new SpeechFailure(
    "TTS_PROTOCOL_ERROR",
    "Speech 提供方拒绝了固定 TTS 请求。",
    false,
  );
}

function parseProviderPayload(input: unknown): ProviderPayload {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SpeechFailure(
      "TTS_RESPONSE_INVALID",
      "Speech 提供方返回了无法识别的响应结构。",
      false,
    );
  }
  return input as ProviderPayload;
}

function decodeProviderAudio(payload: ProviderPayload): {
  audio: Buffer;
  durationMs: number;
} {
  const statusCode = payload.base_resp?.status_code;
  if (typeof statusCode === "number" && statusCode !== 0) {
    throw providerFailure(400, payload);
  }
  const audioHex = payload.data?.audio;
  const durationMs = payload.extra_info?.audio_length;
  if (
    typeof audioHex !== "string" ||
    audioHex.length === 0 ||
    audioHex.length % 2 !== 0 ||
    !/^[0-9a-f]+$/iu.test(audioHex) ||
    typeof durationMs !== "number" ||
    !Number.isInteger(durationMs) ||
    durationMs <= 0 ||
    (payload.extra_info?.audio_format !== undefined &&
      payload.extra_info.audio_format !== "mp3")
  ) {
    throw new SpeechFailure(
      "TTS_RESPONSE_INVALID",
      "Speech 提供方返回了不完整的 MP3 或时长信息。",
      false,
    );
  }
  return { audio: Buffer.from(audioHex, "hex"), durationMs };
}

async function validateMp3(
  file: string,
  expectedDurationMs: number,
  signal?: AbortSignal,
): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_name",
      "-of",
      "json",
      file,
    ], {
      encoding: "utf8",
      signal,
      timeout: 30_000,
    }));
  } catch {
    throw new SpeechFailure(
      "TTS_AUDIO_INVALID",
      "生成的 Speech 无法在本机解码。",
      false,
    );
  }
  let probe: unknown;
  try {
    probe = JSON.parse(stdout);
  } catch {
    throw new SpeechFailure(
      "TTS_AUDIO_INVALID",
      "生成的 Speech 无法在本机解码。",
      false,
    );
  }
  const streams =
    typeof probe === "object" && probe !== null && Array.isArray(Reflect.get(probe, "streams"))
      ? Reflect.get(probe, "streams") as Array<Record<string, unknown>>
      : [];
  const duration =
    typeof probe === "object" && probe !== null &&
    typeof Reflect.get(Reflect.get(probe, "format") ?? {}, "duration") === "string"
      ? Number(Reflect.get(Reflect.get(probe, "format") ?? {}, "duration"))
      : Number.NaN;
  if (!streams.some((stream) => stream.codec_name === "mp3") || !Number.isFinite(duration)) {
    throw new SpeechFailure(
      "TTS_AUDIO_INVALID",
      "生成的 Speech 不是可解码的 MP3。",
      false,
    );
  }
  const containerDurationMs = Math.round(duration * 1_000);
  if (Math.abs(containerDurationMs - expectedDurationMs) > DURATION_TOLERANCE_MS) {
    throw new SpeechFailure(
      "TTS_DURATION_MISMATCH",
      "Speech 容器时长与提供方返回时长不一致。",
      false,
    );
  }
  return containerDurationMs;
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export class SpeechGenerationJobs {
  readonly #jobs = new Map<string, InternalJob>();
  readonly #listeners = new Set<(job: SpeechGenerationJob) => void>();
  readonly #fetch: typeof fetch;
  readonly #apiKey: string | undefined;
  readonly #retryDelaysMs: readonly number[];
  readonly #requestTimeoutMs: number;
  readonly #workerFactory: SpeechWorkerFactory | undefined;
  readonly #processing = new Map<string, Promise<void>>();
  readonly #cleanupPromises = new Set<Promise<void>>();

  constructor(
    private readonly projectRoot: string,
    options: SpeechGenerationJobsOptions = {},
  ) {
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#apiKey = options.apiKey;
    this.#retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#workerFactory = options.fetchImpl !== undefined || options.runInline === true
      ? undefined
      : options.workerFactory ?? defaultWorkerFactory;
  }

  list(): SpeechGenerationJob[] {
    return [...this.#jobs.values()].map(publicJob);
  }

  get(jobId: string): SpeechGenerationJob | undefined {
    const job = this.#jobs.get(jobId);
    return job === undefined ? undefined : publicJob(job);
  }

  subscribe(listener: (job: SpeechGenerationJob) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  create(input: { sceneId: string; narrationText: string; id?: string }): SpeechGenerationJob {
    if (
      input.narrationText.trim().length === 0 ||
      input.narrationText.length >= 10_000
    ) {
      throw new SpeechGenerationJobError(
        400,
        "Narration 必须包含文字且少于 10000 个字符。",
      );
    }
    if (
      [...this.#jobs.values()].some(
        (job) =>
          job.sceneId === input.sceneId &&
          (ACTIVE_STATUSES.has(job.status) ||
            (job.status === "succeeded" &&
              (job.stage === "prepared" || job.stage === "finalizing"))),
      )
    ) {
      throw new SpeechGenerationJobError(409, "这个 Scene 已有 Speech 正在生成。");
    }
    const now = new Date().toISOString();
    const job: InternalJob = {
      id: input.id ?? randomUUID(),
      kind: "speech",
      type: "speech-generation",
      sceneId: input.sceneId,
      narrationText: input.narrationText,
      status: "queued",
      stage: "waiting",
      createdAt: now,
      updatedAt: now,
      cancelRequested: false,
    };
    this.#jobs.set(job.id, job);
    setImmediate(() => {
      const processing = this.#process(job).finally(() => this.#processing.delete(job.id));
      this.#processing.set(job.id, processing);
      void processing;
    });
    return publicJob(job);
  }

  cancel(jobId: string): SpeechGenerationJob | undefined {
    const job = this.#jobs.get(jobId);
    if (job === undefined) return undefined;
    if (!ACTIVE_STATUSES.has(job.status)) return publicJob(job);
    job.cancelRequested = true;
    this.#update(job, { status: "cancelling", stage: "cancelling" });
    if (job.worker !== undefined) job.worker.kill("SIGTERM");
    else job.controller?.abort();
    return publicJob(job);
  }

  async commit(jobId: string): Promise<SpeechGenerationJob | undefined> {
    const job = this.#jobs.get(jobId);
    if (job === undefined) return undefined;
    if (
      job.status !== "succeeded" ||
      job.stage !== "prepared" ||
      job.temporaryFile === undefined ||
      job.finalFile === undefined
    ) {
      throw new SpeechGenerationJobError(409, "Speech 任务尚未准备好应用。");
    }
    const backupFile = `${job.temporaryFile}.previous`;
    job.backupFile = backupFile;
    job.hadPreviousFile = false;
    this.#update(job, { stage: "finalizing" });
    try {
      try {
        await copyFile(job.finalFile, backupFile);
        job.hadPreviousFile = true;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      }
      await rename(job.temporaryFile, job.finalFile);
      job.temporaryFile = undefined;
      job.committed = true;
      await syncDirectory(dirname(job.finalFile)).catch(() => undefined);
      this.#update(job, { stage: "completed" });
      return publicJob(job);
    } catch {
      await unlink(backupFile).catch(() => undefined);
      job.backupFile = undefined;
      job.hadPreviousFile = undefined;
      this.#update(job, { stage: "prepared" });
      throw new SpeechGenerationJobError(500, "无法原子应用生成的 Speech。");
    }
  }

  async rollback(jobId: string): Promise<SpeechGenerationJob | undefined> {
    const job = this.#jobs.get(jobId);
    if (job === undefined) return undefined;
    if (job.committed && job.finalFile !== undefined) {
      if (job.hadPreviousFile && job.backupFile !== undefined) {
        await rename(job.backupFile, job.finalFile);
      } else {
        await unlink(job.finalFile).catch(() => undefined);
      }
    } else if (job.temporaryFile !== undefined) {
      await unlink(job.temporaryFile).catch(() => undefined);
      job.temporaryFile = undefined;
    }
    job.committed = false;
    job.backupFile = undefined;
    job.hadPreviousFile = undefined;
    return publicJob(job);
  }

  async acknowledge(jobId: string): Promise<SpeechGenerationJob | undefined> {
    const job = this.#jobs.get(jobId);
    if (job === undefined) return undefined;
    if (!job.committed) {
      throw new SpeechGenerationJobError(409, "Speech 任务尚未完成应用。");
    }
    if (job.backupFile !== undefined) {
      await unlink(job.backupFile).catch(() => undefined);
    }
    job.backupFile = undefined;
    job.hadPreviousFile = undefined;
    job.committed = false;
    return publicJob(job);
  }

  async discard(jobId: string): Promise<SpeechGenerationJob | undefined> {
    const job = this.#jobs.get(jobId);
    if (job === undefined) return undefined;
    if (job.status === "succeeded" && job.stage === "prepared") {
      await this.rollback(jobId);
      this.#update(job, { status: "cancelled", stage: "cancelled" });
    }
    return publicJob(job);
  }

  async recoverOrphans(): Promise<SpeechGenerationJob[]> {
    const recovered: SpeechGenerationJob[] = [];
    for (const job of this.#jobs.values()) {
      if (
        job.status === "succeeded" &&
        (job.stage === "prepared" || job.stage === "finalizing")
      ) {
        await this.discard(job.id);
        recovered.push(publicJob(job));
      }
    }
    return recovered;
  }

  async close(): Promise<void> {
    for (const job of this.#jobs.values()) {
      if (ACTIVE_STATUSES.has(job.status)) this.cancel(job.id);
    }
    await Promise.allSettled(this.#processing.values());
    await Promise.allSettled(this.#cleanupPromises);
  }

  async waitForSettlement(jobId: string): Promise<void> {
    const processing = this.#processing.get(jobId);
    if (processing !== undefined) await processing;
  }

  workerState(jobId: string): SpeechWorkerState | undefined {
    const job = this.#jobs.get(jobId);
    return job === undefined ? undefined : {
      job: publicJob(job),
      temporaryFile: job.temporaryFile,
      finalFile: job.finalFile,
    };
  }

  #update(job: InternalJob, patch: Partial<SpeechGenerationJob>): void {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    const value = publicJob(job);
    for (const listener of this.#listeners) {
      try {
        listener(value);
      } catch {
        // 已断开的 SSE 消费者不能改变任务的落盘结果。
      }
    }
  }

  #throwIfCancelled(job: InternalJob): void {
    if (job.cancelRequested) throw new SpeechCancelled();
  }

  async #waitForRetry(job: InternalJob, delayMs: number): Promise<void> {
    if (delayMs <= 0) return;
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        clearInterval(interval);
        resolvePromise();
      }, delayMs);
      const interval = setInterval(() => {
        if (!job.cancelRequested) return;
        clearTimeout(timer);
        clearInterval(interval);
        rejectPromise(new SpeechCancelled());
      }, Math.min(50, delayMs));
      timer.unref?.();
      interval.unref?.();
    });
  }

  async #request(job: InternalJob): Promise<{ audio: Buffer; durationMs: number }> {
    if (this.#apiKey === undefined || this.#apiKey.length === 0) {
      throw new SpeechFailure(
        "TTS_AUTH_MISSING",
        "应用安装环境未配置 TokenDance API key。",
        false,
      );
    }
    for (let attempt = 0; ; attempt += 1) {
      this.#throwIfCancelled(job);
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.#requestTimeoutMs);
      timeout.unref?.();
      job.controller = controller;
      try {
        const response = await this.#fetch(TOKEN_DANCE_T2A_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.#apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: TOKEN_DANCE_MODEL,
            text: job.narrationText,
            stream: false,
            voice_setting: {
              voice_id: TOKEN_DANCE_VOICE,
              speed: 1,
              vol: 1,
              pitch: 0,
            },
            audio_setting: {
              sample_rate: 32000,
              bitrate: 128000,
              format: "mp3",
              channel: 1,
            },
          }),
          signal: controller.signal,
        });
        let input: unknown;
        try {
          input = await response.json();
        } catch {
          input = undefined;
        }
        const payload = input === undefined ? undefined : parseProviderPayload(input);
        if (!response.ok) {
          const failure = providerFailure(response.status, payload);
          if (failure.retryable && attempt < this.#retryDelaysMs.length) {
            await this.#waitForRetry(job, this.#retryDelaysMs[attempt]);
            continue;
          }
          throw failure;
        }
        if (payload === undefined) {
          throw new SpeechFailure(
            "TTS_RESPONSE_INVALID",
            "Speech 提供方返回了无法识别的响应结构。",
            false,
          );
        }
        return decodeProviderAudio(payload);
      } catch (error) {
        if (job.cancelRequested) {
          throw new SpeechCancelled();
        }
        if (error instanceof SpeechFailure) {
          if (error.retryable && attempt < this.#retryDelaysMs.length) {
            await this.#waitForRetry(job, this.#retryDelaysMs[attempt]);
            continue;
          }
          throw error;
        }
        if (attempt < this.#retryDelaysMs.length) {
          await this.#waitForRetry(job, this.#retryDelaysMs[attempt]);
          continue;
        }
        throw new SpeechFailure(
          "TTS_NETWORK_ERROR",
          timedOut
            ? "Speech 提供方响应超时，请稍后重试。"
            : "无法连接 Speech 提供方，请检查网络后重试。",
          true,
        );
      } finally {
        clearTimeout(timeout);
        job.controller = undefined;
      }
    }
  }

  async #process(job: InternalJob): Promise<void> {
    if (this.#workerFactory !== undefined) {
      await this.#processInWorker(job);
      return;
    }
    await this.#processInline(job);
  }

  async #processInWorker(job: InternalJob): Promise<void> {
    await new Promise<void>((resolvePromise) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        job.worker = undefined;
        resolvePromise();
      };
      const cleanupPrepared = () => {
        const cleanup = unlink(
          join(this.projectRoot, "speech", `.${job.sceneId}.${job.id}.tmp.mp3`),
        ).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return;
          this.#update(job, {
            error: {
              code: job.error?.code ?? "TEMP_CLEANUP_FAILED",
              message: "Speech 临时文件清理失败——查看任务详情",
              retryable: job.error?.retryable ?? true,
              cleanupFailed: true,
            },
          });
        }).finally(() => this.#cleanupPromises.delete(cleanup));
        this.#cleanupPromises.add(cleanup);
      };
      try {
        const worker = this.#workerFactory!({
          jobId: job.id,
          projectRoot: this.projectRoot,
          sceneId: job.sceneId,
          narrationText: job.narrationText,
          apiKey: this.#apiKey,
          retryDelaysMs: this.#retryDelaysMs,
          requestTimeoutMs: this.#requestTimeoutMs,
        });
        job.worker = worker;
        worker.on("message", (message) => {
          if (typeof message !== "object" || message === null) return;
          const state = Reflect.get(message, "state") as SpeechWorkerState | undefined;
          if (
            state?.job.type !== "speech-generation" ||
            state.job.id !== job.id ||
            (job.status !== "queued" && job.status !== "processing")
          ) return;
          job.temporaryFile = state.temporaryFile;
          job.finalFile = state.finalFile;
          this.#update(job, {
            status: state.job.status,
            stage: state.job.stage,
            result: state.job.result,
            error: state.job.error,
          });
        });
        worker.on("error", () => {
          if (!ACTIVE_STATUSES.has(job.status)) return;
          this.#update(job, job.status === "cancelling"
            ? { status: "cancelled", stage: "cancelled" }
            : {
                status: "failed",
                stage: "failed",
                error: { code: "SPEECH_WORKER_ERROR", message: "Speech worker 无法继续；本地服务仍可使用。", retryable: true },
              });
          worker.kill("SIGTERM");
          cleanupPrepared();
          settle();
        });
        worker.on("exit", (code, signal) => {
          if (job.status === "cancelling") {
            this.#update(job, { status: "cancelled", stage: "cancelled" });
            cleanupPrepared();
          } else if (ACTIVE_STATUSES.has(job.status)) {
            const detail = signal === null ? `退出码 ${code ?? "未知"}` : `信号 ${signal}`;
            this.#update(job, {
              status: "failed",
              stage: "failed",
              error: { code: "SPEECH_WORKER_CRASHED", message: `Speech worker 异常退出（${detail}）；其他任务不受影响。`, retryable: true },
            });
            cleanupPrepared();
          }
          settle();
        });
      } catch {
        this.#update(job, {
          status: "failed",
          stage: "failed",
          error: { code: "SPEECH_WORKER_START_FAILED", message: "无法启动 Speech worker；请重试。", retryable: true },
        });
        cleanupPrepared();
        settle();
      }
    });
  }

  async #processInline(job: InternalJob): Promise<void> {
    const speechDirectory = join(this.projectRoot, "speech");
    const finalPath = `speech/${job.sceneId}.mp3`;
    let temporaryFile = "";
    try {
      this.#update(job, { status: "processing", stage: "requesting" });
      const { audio, durationMs } = await this.#request(job);
      this.#throwIfCancelled(job);

      await mkdir(speechDirectory, { recursive: true });
      const [projectRealRoot, speechRealDirectory] = await Promise.all([
        realpath(this.projectRoot),
        realpath(speechDirectory),
      ]);
      const relativeSpeech = relative(projectRealRoot, speechRealDirectory);
      if (
        relativeSpeech === "" ||
        relativeSpeech === ".." ||
        relativeSpeech.startsWith(`..${sep}`) ||
        isAbsolute(relativeSpeech)
      ) {
        throw new SpeechFailure(
          "PROJECT_WRITE_FAILED",
          "无法写入项目 Speech 文件夹。",
          false,
        );
      }
      temporaryFile = join(
        speechRealDirectory,
        `.${job.sceneId}.${job.id}.tmp.mp3`,
      );
      const finalFile = join(speechRealDirectory, `${job.sceneId}.mp3`);
      const handle = await open(temporaryFile, "wx");
      try {
        await handle.writeFile(audio);
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.#throwIfCancelled(job);

      this.#update(job, { stage: "validating" });
      const validationController = new AbortController();
      job.controller = validationController;
      let containerDurationMs: number;
      try {
        containerDurationMs = await validateMp3(
          temporaryFile,
          durationMs,
          validationController.signal,
        );
      } finally {
        if (job.controller === validationController) job.controller = undefined;
      }
      this.#throwIfCancelled(job);

      const sourceTextHash = sha256(job.narrationText);
      job.temporaryFile = temporaryFile;
      job.finalFile = finalFile;
      temporaryFile = "";
      this.#update(job, {
        status: "succeeded",
        stage: "prepared",
        result: {
          speech: {
            path: finalPath,
            durationMs,
            sourceTextHash,
            ttsProfileId: CURRENT_TTS_PROFILE_ID,
          },
          facts: {
            fileRevision: sha256(audio),
            containerDurationMs,
          },
        },
      });
    } catch (error) {
      if (job.cancelRequested || error instanceof SpeechCancelled) {
        this.#update(job, { status: "cancelled", stage: "cancelled" });
      } else {
        const failure =
          error instanceof SpeechFailure
            ? error
            : new SpeechFailure(
                "PROJECT_WRITE_FAILED",
                "无法写入项目 Speech 文件夹。",
                false,
              );
        this.#update(job, {
          status: "failed",
          stage: "failed",
          error: {
            code: failure.code,
            message: failure.message,
            retryable: failure.retryable,
          },
        });
      }
    } finally {
      job.controller = undefined;
      if (temporaryFile !== "") await unlink(temporaryFile).catch(() => undefined);
    }
  }
}

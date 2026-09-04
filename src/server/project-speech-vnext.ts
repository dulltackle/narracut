import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { parseStrictJson } from "./strict-json";

const execFileAsync = promisify(execFile);

export const DRAFT_DURATION_MS = 5_000;

export const TTS_CAPABILITIES = {
  provider: "tokendance",
  models: [
    { value: "minimax-speech-2.8-turbo", label: "MiniMax Speech 2.8 Turbo" },
  ],
  voices: [
    { value: "Chinese (Mandarin)_News_Anchor", label: "普通话 · 新闻主播" },
    { value: "Chinese (Mandarin)_Reliable_Executive", label: "普通话 · 沉稳主管" },
  ],
  ranges: {
    speed: { min: 0.5, max: 2, step: 0.1 },
    volume: { min: 0.1, max: 10, step: 0.1 },
    pitch: { min: -12, max: 12, step: 1 },
  },
  audio: { format: "mp3", sampleRate: 32_000, bitrate: 128_000, channels: 1 },
} as const;

export type ProjectTtsConfig = {
  provider: "tokendance";
  model: (typeof TTS_CAPABILITIES.models)[number]["value"];
  voice: (typeof TTS_CAPABILITIES.voices)[number]["value"];
  speed: number;
  volume: number;
  pitch: number;
};

export type ProjectTtsState =
  | { status: "unconfigured" }
  | { status: "configured"; config: ProjectTtsConfig; profileId: string };

type SceneSpeechInput = {
  id: string;
  narration: { text: string };
  speech?: {
    path: string;
    durationMs: number;
    sourceTextHash: string;
    ttsProfileId: string;
    audioContentHash?: string;
  };
};

export type SpeechRuntimeState = {
  sceneId: string;
  path?: string;
  status: "missing" | "available" | "unavailable" | "decode-failed" | "changed" | "profile-mismatch";
  durationMs?: number;
  reason?: string;
};

export type SceneTimeWindow = {
  sceneId: string;
  startFrame: number;
  durationInFrames: number;
  source: "speech" | "draft";
};

export class ProjectTtsConfigError extends Error {
  readonly code = "TTS_CONFIG_INVALID";

  constructor(message: string, readonly path: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ProjectTtsConfigError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inRange(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max;
}

export function validateProjectTtsConfig(value: unknown): ProjectTtsConfig {
  if (!isRecord(value)) throw new ProjectTtsConfigError("tts.json 根值必须是对象。", "tts.json");
  const keys = Object.keys(value).sort();
  const expected = ["model", "pitch", "provider", "speed", "voice", "volume"].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new ProjectTtsConfigError("tts.json 只能包含 provider、model、voice、speed、volume 与 pitch。", "tts.json");
  }
  if (value.provider !== TTS_CAPABILITIES.provider) {
    throw new ProjectTtsConfigError("provider 必须是 tokendance。", "tts.json");
  }
  if (!TTS_CAPABILITIES.models.some((model) => model.value === value.model)) {
    throw new ProjectTtsConfigError("model 不在服务端声明的支持范围内。", "tts.json");
  }
  if (!TTS_CAPABILITIES.voices.some((voice) => voice.value === value.voice)) {
    throw new ProjectTtsConfigError("voice 不在服务端声明的支持范围内。", "tts.json");
  }
  if (!inRange(value.speed, TTS_CAPABILITIES.ranges.speed)) {
    throw new ProjectTtsConfigError("speed 必须在 0.5–2.0 之间。", "tts.json");
  }
  if (!inRange(value.volume, TTS_CAPABILITIES.ranges.volume)) {
    throw new ProjectTtsConfigError("volume 必须在 0.1–10.0 之间。", "tts.json");
  }
  if (!inRange(value.pitch, TTS_CAPABILITIES.ranges.pitch) || !Number.isInteger(value.pitch)) {
    throw new ProjectTtsConfigError("pitch 必须是 -12–12 之间的整数。", "tts.json");
  }
  return value as ProjectTtsConfig;
}

export function ttsProfileId(config: ProjectTtsConfig): string {
  const stable = JSON.stringify({
    provider: config.provider,
    model: config.model,
    voice: config.voice,
    speed: config.speed,
    volume: config.volume,
    pitch: config.pitch,
    audio: TTS_CAPABILITIES.audio,
  });
  return `sha256:${createHash("sha256").update(stable, "utf8").digest("hex")}`;
}

export async function readProjectTtsConfig(projectDirectory: string): Promise<ProjectTtsState> {
  const path = join(projectDirectory, "tts.json");
  let bytes: Buffer;
  try {
    const facts = await lstat(path);
    if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > 16 * 1024) {
      throw new ProjectTtsConfigError("tts.json 必须是小于 16 KiB 的无链接普通文件。", path);
    }
    bytes = await readFile(path);
  } catch (cause) {
    if (cause instanceof ProjectTtsConfigError) throw cause;
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return { status: "unconfigured" };
    }
    throw new ProjectTtsConfigError("无法安全读取 tts.json。", path, { cause });
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new ProjectTtsConfigError("tts.json 必须是严格 UTF-8。", path, { cause });
  }
  let parsed: unknown;
  try {
    parsed = parseStrictJson(text, {
      maxDepth: 3,
      maxArrayItems: 0,
      maxObjectFields: 8,
      maxNodes: 16,
      maxStringScalars: 256,
      maxStringBytes: 1_024,
      maxNumberBytes: 32,
      forbidArrays: true,
    });
  } catch (cause) {
    throw new ProjectTtsConfigError("tts.json 不是受支持的严格 JSON。", path, { cause });
  }
  const config = validateProjectTtsConfig(parsed);
  return { status: "configured", config, profileId: ttsProfileId(config) };
}

export async function writeProjectTtsConfig(
  projectDirectory: string,
  input: unknown,
  assertWritable: () => Promise<void> = async () => undefined,
): Promise<ProjectTtsState & { status: "configured" }> {
  const config = validateProjectTtsConfig(input);
  const path = join(projectDirectory, "tts.json");
  const temporaryPath = join(projectDirectory, `.tts.json.${randomUUID()}.tmp`);
  let committed = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(Buffer.from(JSON.stringify(config), "utf8"));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertWritable();
    await rename(temporaryPath, path);
    committed = true;
    try {
      const directory = await open(dirname(path), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch {
      // rename 是提交点；提交后的目录同步失败不能把已生效配置报告成失败。
    }
  } finally {
    if (!committed) await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return { status: "configured", config, profileId: ttsProfileId(config) };
}

export function deriveSceneTimeWindows(
  scenes: ReadonlyArray<{ sceneId: string; durationMs: number; source: "speech" | "draft" }>,
  fps: number,
): { durationInFrames: number; renderReady: boolean; scenes: SceneTimeWindow[] } {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("fps 必须是正数。");
  let startFrame = 0;
  let renderReady = scenes.length > 0;
  const windows = scenes.map((scene) => {
    const durationInFrames = Math.max(1, Math.ceil((scene.durationMs / 1_000) * fps));
    const window: SceneTimeWindow = {
      sceneId: scene.sceneId,
      startFrame,
      durationInFrames,
      source: scene.source,
    };
    startFrame += durationInFrames;
    if (scene.source === "draft") renderReady = false;
    return window;
  });
  return { durationInFrames: startFrame, renderReady, scenes: windows };
}

export async function probeSpeechDurationMs(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_name",
    "-of", "json",
    path,
  ], { encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024 });
  const payload = JSON.parse(stdout) as { streams?: Array<{ codec_name?: unknown }>; format?: { duration?: unknown } };
  const duration = typeof payload.format?.duration === "string" ? Number(payload.format.duration) : Number.NaN;
  if (!payload.streams?.some((stream) => stream.codec_name === "mp3") || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("Speech 不是可解码的 MP3。");
  }
  return Math.round(duration * 1_000);
}

async function speechContentHash(path: string): Promise<string> {
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    await handle.close();
  }
}

export async function inspectProjectSpeech(
  projectDirectory: string,
  scenes: readonly SceneSpeechInput[],
  currentProfileId: string | undefined,
  options: { probeDurationMs?: (path: string) => Promise<number>; fps?: number } = {},
): Promise<{
  states: SpeechRuntimeState[];
  timeline: ReturnType<typeof deriveSceneTimeWindows>;
}> {
  const probe = options.probeDurationMs ?? probeSpeechDurationMs;
  const states: SpeechRuntimeState[] = [];
  const durations: Array<{ sceneId: string; durationMs: number; source: "speech" | "draft" }> = [];
  for (const scene of scenes) {
    const speech = scene.speech;
    if (speech === undefined) {
      states.push({ sceneId: scene.id, status: "missing", reason: "当前 Scene 缺少 Speech。" });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    const currentSourceTextHash = `sha256:${createHash("sha256").update(scene.narration.text, "utf8").digest("hex")}`;
    if (speech.sourceTextHash !== currentSourceTextHash) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "changed",
        reason: "Speech 与当前 Narration 不匹配。",
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    if (currentProfileId === undefined || speech.ttsProfileId !== currentProfileId) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "profile-mismatch",
        reason: "Speech 与当前 TTS 配置不匹配。",
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    const absolutePath = join(projectDirectory, speech.path);
    let before;
    try {
      before = await lstat(absolutePath);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error("not ordinary");
    } catch {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "unavailable",
        reason: "Speech 文件缺失、不可读或不是无链接普通文件。",
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    if (speech.audioContentHash === undefined) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "changed",
        reason: "Speech 缺少音频内容摘要，无法证明仍是已提交的音频。",
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    let actualDurationMs: number;
    let actualContentHash: string;
    try {
      [actualDurationMs, actualContentHash] = await Promise.all([
        probe(absolutePath),
        speechContentHash(absolutePath),
      ]);
    } catch {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "decode-failed",
        reason: "Speech 文件无法解码为 MP3。",
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    let after;
    try {
      after = await lstat(absolutePath);
    } catch {
      after = undefined;
    }
    const changedDuringProbe = after === undefined || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs;
    if (changedDuringProbe || actualDurationMs !== speech.durationMs || actualContentHash !== speech.audioContentHash) {
      states.push({
        sceneId: scene.id,
        path: speech.path,
        status: "changed",
        durationMs: actualDurationMs,
        reason: changedDuringProbe
          ? "Speech 文件在检查期间发生原位变化。"
          : actualContentHash !== speech.audioContentHash
            ? "Speech 音频内容与已提交摘要不一致。"
            : `Speech 实际时长 ${actualDurationMs} ms 与记录的 ${speech.durationMs} ms 不一致。`,
      });
      durations.push({ sceneId: scene.id, durationMs: DRAFT_DURATION_MS, source: "draft" });
      continue;
    }
    states.push({
      sceneId: scene.id,
      path: speech.path,
      status: "available",
      durationMs: actualDurationMs,
    });
    durations.push({ sceneId: scene.id, durationMs: actualDurationMs, source: "speech" });
  }
  const timeline = deriveSceneTimeWindows(durations, options.fps ?? 30);
  return {
    states,
    timeline: {
      ...timeline,
      renderReady: timeline.renderReady && scenes.every((scene) => scene.narration.text.trim() !== ""),
    },
  };
}

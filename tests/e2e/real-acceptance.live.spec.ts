import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { createRenderSnapshot } from "../../src/remotion/render-snapshot";
import { runRemotionCli } from "../../src/server/video-media";
import { DEFAULT_PROJECT_THEME, type Project } from "../../src/shared/project";
import { compareVisualFrames } from "../support/visual-comparison";
import {
  createRealAcceptanceManifest,
  preflightRealAcceptance,
  type RealAcceptanceManifest,
} from "../support/real-acceptance";

const FPS = 30;
const AUDIO_SAMPLE_RATE = 32_000;
const H264_CHANNEL_THRESHOLD = 30;
const H264_MAX_DIFFERENT_PIXEL_RATIO = 0.02;
const ALERT_CAPTION_TEXT = "Alert：请按现场安全要求操作。";
const FIXTURE_FINGERPRINT_FILE = ".fixture-fingerprint";
const FIXTURE_MANIFEST_FILE = ".fixture-manifest.json";

type RunningCli = {
  child: ChildProcessWithoutNullStreams;
  url: string;
  output: () => string;
};

type MediaFacts = {
  durationSeconds: number;
  videoStreams: number;
  audioStreams: number;
  frameCount?: number;
  frameRate?: string;
  codec?: string;
  profile?: string;
  pixelFormat?: string;
  width?: number;
  height?: number;
  colorRange?: string;
  colorSpace?: string;
};

type FrameTarget = {
  frame: number;
  sceneIndex: number;
  reasons: string[];
};

function redactSecret(value: string, secret: string): string {
  return secret === "" ? value : value.split(secret).join("<REDACTED>");
}

async function startCli(projectDirectory: string, apiKey: string): Promise<RunningCli> {
  const child = spawn("pnpm", ["start", projectDirectory], {
    cwd: resolve("."),
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      NARRACUT_HOST: "127.0.0.1",
      TOKENDANCE_API_KEY: apiKey,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  let output = "";
  const url = await new Promise<string>((resolveUrl, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void stopCli({ child, url: "", output: () => output })
        .catch(() => undefined)
        .finally(() => reject(new Error(
          `真实启动命令超时：${redactSecret(output, apiKey)}`,
        )));
    }, 90_000);
    const receive = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (settled) return;
      const match = output.match(/本地工作台：(http:\/\/127\.0\.0\.1:\d+)/u);
      if (match === null) return;
      settled = true;
      clearTimeout(timeout);
      resolveUrl(match[1]);
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(
        `真实启动命令提前退出（${code ?? signal}）：${redactSecret(output, apiKey)}`,
      ));
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
  });
  return { child, url, output: () => output };
}

async function stopCli(cli: RunningCli | undefined): Promise<void> {
  if (
    cli === undefined ||
    cli.child.exitCode !== null ||
    cli.child.signalCode !== null
  ) return;
  const waitForExit = async (timeoutMs: number): Promise<boolean> => {
    if (cli.child.exitCode !== null || cli.child.signalCode !== null) return true;
    return new Promise<boolean>((resolveExit) => {
      const timeout = setTimeout(() => {
        cli.child.off("exit", onExit);
        resolveExit(false);
      }, timeoutMs);
      const onExit = () => {
        clearTimeout(timeout);
        resolveExit(true);
      };
      cli.child.once("exit", onExit);
    });
  };
  const signal = (name: NodeJS.Signals): boolean => {
    try {
      if (process.platform === "win32" || cli.child.pid === undefined) {
        return cli.child.kill(name);
      }
      process.kill(-cli.child.pid, name);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
      throw error;
    }
  };
  if (!signal("SIGTERM")) return;
  if (
    !(await waitForExit(10_000)) &&
    cli.child.exitCode === null &&
    cli.child.signalCode === null
  ) {
    if (!signal("SIGKILL")) return;
    await waitForExit(2_000);
  }
}

async function probeMedia(path: string): Promise<MediaFacts> {
  const { stdout } = await runRemotionCli("ffprobe", [
    "-v", "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,profile,pix_fmt,width,height,avg_frame_rate,nb_frames,color_range,color_space",
    "-of", "json",
    path,
  ], { timeoutMs: 60_000 });
  const result = JSON.parse(stdout.toString("utf8")) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      profile?: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      nb_frames?: string;
      color_range?: string;
      color_space?: string;
    }>;
  };
  const video = result.streams?.find((stream) => stream.codec_type === "video");
  return {
    durationSeconds: Number(result.format?.duration),
    videoStreams: result.streams?.filter((stream) => stream.codec_type === "video").length ?? 0,
    audioStreams: result.streams?.filter((stream) => stream.codec_type === "audio").length ?? 0,
    ...(video?.nb_frames === undefined ? {} : { frameCount: Number(video.nb_frames) }),
    ...(video?.avg_frame_rate === undefined ? {} : { frameRate: video.avg_frame_rate }),
    ...(video?.codec_name === undefined ? {} : { codec: video.codec_name }),
    ...(video?.profile === undefined ? {} : { profile: video.profile }),
    ...(video?.pix_fmt === undefined ? {} : { pixelFormat: video.pix_fmt }),
    ...(video?.width === undefined ? {} : { width: video.width }),
    ...(video?.height === undefined ? {} : { height: video.height }),
    ...(video?.color_range === undefined ? {} : { colorRange: video.color_range }),
    ...(video?.color_space === undefined ? {} : { colorSpace: video.color_space }),
  };
}

async function probeSpeechCodecDelayMs(path: string): Promise<number> {
  const { stdout } = await runRemotionCli("ffprobe", [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_packets", "-read_intervals", "%+#1",
    "-show_entries", "stream=start_time:packet=duration_time",
    "-of", "json",
    path,
  ]);
  const result = JSON.parse(stdout.toString("utf8")) as {
    streams?: Array<{ start_time?: string }>;
    packets?: Array<{ duration_time?: string }>;
  };
  const streamStart = Number(result.streams?.[0]?.start_time);
  const firstPacketDuration = Number(result.packets?.[0]?.duration_time);
  if (!Number.isFinite(streamStart) || !Number.isFinite(firstPacketDuration)) {
    throw new Error(`Speech 缺少可校准的 MP3 起点事实：${path}`);
  }
  return (streamStart + firstPacketDuration) * 1000;
}

async function decodeAudio(input: string, output: string): Promise<Float32Array> {
  await runRemotionCli("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-ac", "1", "-ar", String(AUDIO_SAMPLE_RATE),
    "-c:a", "pcm_s16le", "-f", "wav", output,
  ], { timeoutMs: 120_000 });
  const bytes = await readFile(output);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`音频解码结果不是 RIFF/WAVE：${output}`);
  }
  let offset = 12;
  let formatVerified = false;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    if (chunkId === "fmt ") {
      const audioFormat = bytes.readUInt16LE(payloadOffset);
      const channels = bytes.readUInt16LE(payloadOffset + 2);
      const sampleRate = bytes.readUInt32LE(payloadOffset + 4);
      const bitsPerSample = bytes.readUInt16LE(payloadOffset + 14);
      formatVerified =
        audioFormat === 1 &&
        channels === 1 &&
        sampleRate === AUDIO_SAMPLE_RATE &&
        bitsPerSample === 16;
    }
    if (chunkId === "data") {
      dataOffset = payloadOffset;
      dataSize = Math.min(chunkSize, bytes.length - payloadOffset);
      break;
    }
    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }
  if (!formatVerified || dataOffset < 0) {
    throw new Error(`音频解码结果缺少单声道 32kHz PCM 数据：${output}`);
  }
  const samples = new Float32Array(Math.floor(dataSize / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readInt16LE(dataOffset + index * 2) / 32_768;
  }
  return samples;
}

function rmsEnvelope(
  samples: Float32Array,
  startSample: number,
  sampleCount: number,
  windowSamples = 160,
): number[] {
  const envelope: number[] = [];
  const endSample = Math.min(samples.length, startSample + sampleCount);
  for (let start = startSample; start + windowSamples <= endSample; start += windowSamples) {
    let energy = 0;
    for (let offset = 0; offset < windowSamples; offset += 1) {
      energy += samples[start + offset] ** 2;
    }
    envelope.push(Math.sqrt(energy / windowSamples));
  }
  return envelope;
}

function correlationAtShift(expected: number[], actual: number[], shift: number): number {
  let count = 0;
  let expectedSum = 0;
  let actualSum = 0;
  let expectedSquares = 0;
  let actualSquares = 0;
  let products = 0;
  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
    const actualIndex = expectedIndex + shift;
    if (actualIndex < 0 || actualIndex >= actual.length) continue;
    const expectedValue = expected[expectedIndex];
    const actualValue = actual[actualIndex];
    count += 1;
    expectedSum += expectedValue;
    actualSum += actualValue;
    expectedSquares += expectedValue ** 2;
    actualSquares += actualValue ** 2;
    products += expectedValue * actualValue;
  }
  const covariance = products - (expectedSum * actualSum) / count;
  const expectedVariance = expectedSquares - (expectedSum ** 2) / count;
  const actualVariance = actualSquares - (actualSum ** 2) / count;
  return covariance / Math.sqrt(expectedVariance * actualVariance);
}

function bestAudioAlignment(expected: number[], actual: number[]) {
  let best = { correlation: Number.NEGATIVE_INFINITY, shift: 0 };
  for (let shift = -50; shift <= 50; shift += 1) {
    const correlation = correlationAtShift(expected, actual, shift);
    if (correlation > best.correlation) best = { correlation, shift };
  }
  return best;
}

async function extractFrame(video: string, frame: number, output: string): Promise<void> {
  await runRemotionCli("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", video,
    "-ss", (frame / FPS).toFixed(6),
    "-frames:v", "1", output,
  ], { timeoutMs: 60_000 });
}

async function filesContaining(root: string, secret: string): Promise<string[]> {
  const matches: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if ((await stat(path)).size <= 100 * 1024 * 1024) {
        if ((await readFile(path)).includes(Buffer.from(secret))) matches.push(path);
      }
    }
  };
  await visit(root);
  return matches;
}

async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("save-status")).toContainText("已保存", { timeout: 30_000 });
}

function rowById(page: Page, sceneId: string) {
  return page.locator(`[data-scene-id="${sceneId}"]`);
}

async function waitForSceneAsset(
  projectFile: string,
  sceneId: string,
): Promise<string> {
  let assetId = "";
  await expect.poll(async () => {
    const project = JSON.parse(await readFile(projectFile, "utf8")) as Project;
    const scene = project.scenes.find((candidate) => candidate.id === sceneId);
    assetId = scene !== undefined && scene.visual.type !== "card"
      ? scene.visual.assetId ?? ""
      : "";
    return assetId;
  }, { timeout: 180_000 }).not.toBe("");
  return assetId;
}

async function seekToFrame(page: Page, frame: number): Promise<void> {
  const slider = page.getByRole("slider", { name: "项目播放进度" });
  await slider.fill(String(frame), { force: true });
  await expect(slider).toHaveValue(String(frame));
  await page.evaluate(() => new Promise<void>((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  }));
}

function addFrameTarget(
  targets: Map<number, FrameTarget>,
  frame: number,
  sceneIndex: number,
  reason: string,
): void {
  const current = targets.get(frame);
  if (current === undefined) {
    targets.set(frame, { frame, sceneIndex, reasons: [reason] });
    return;
  }
  current.reasons.push(reason);
}

async function writeContactSheet(framePaths: string[], output: string): Promise<void> {
  const tileWidth = 360;
  const tileHeight = 203;
  const columns = 3;
  const rows = Math.ceil(framePaths.length / columns);
  const tiles = await Promise.all(framePaths.map((path) =>
    sharp(path).resize(tileWidth, tileHeight, { fit: "fill" }).png().toBuffer()
  ));
  await sharp({
    create: {
      width: tileWidth * columns,
      height: tileHeight * rows,
      channels: 3,
      background: "#2A2226",
    },
  }).composite(tiles.map((input, index) => ({
    input,
    left: (index % columns) * tileWidth,
    top: Math.floor(index / columns) * tileHeight,
  }))).png().toFile(output);
}

let cli: RunningCli | undefined;
let runDirectory = "";

test.afterEach(async () => {
  await stopCli(cli);
  cli = undefined;
  if (runDirectory !== "") {
    process.stdout.write(`\n真实验收材料已保留：${runDirectory}\n`);
  }
});

test("真实 13 Scene 夹具完成导入、Speech、诊断、Preview = Render 与成片验收", async ({ page }) => {
  const requestedFixtureRoot = resolve(process.env.NARRACUT_REAL_FIXTURE_ROOT ?? "fixtures");
  const requestedEvidenceRoot = resolve(
    process.env.NARRACUT_REAL_ACCEPTANCE_OUTPUT ?? join(requestedFixtureRoot, "acceptance"),
  );
  const requestedResumeDirectory = process.env.NARRACUT_REAL_ACCEPTANCE_RESUME;
  const {
    apiKey,
    narrations,
    sources,
    sourceFingerprints,
    fixtureFingerprint,
    evidenceRoot,
    resumeDirectory,
  } = await preflightRealAcceptance({
    fixtureRoot: requestedFixtureRoot,
    evidenceRoot: requestedEvidenceRoot,
    ...(requestedResumeDirectory === undefined
      ? {}
      : { resumeDirectory: requestedResumeDirectory }),
    envFile: resolve(".env"),
  });

  const sourceImage = await sharp(sources[0].path).metadata();
  expect(sourceImage).toMatchObject({ format: "png", width: 1920, height: 1080 });
  const sourceVideoFacts = await Promise.all(sources.slice(1).map((source) =>
    probeMedia(source.path)
  ));
  sourceVideoFacts.forEach((facts, index) => {
    expect(facts, `源视频 ${index + 2} 必须是单路 HEVC Main 10`).toMatchObject({
      videoStreams: 1,
      codec: "hevc",
      profile: "Main 10",
      pixelFormat: "yuv420p10le",
    });
  });

  await mkdir(evidenceRoot, { recursive: true });
  runDirectory = resumeDirectory === undefined
    ? await mkdtemp(join(evidenceRoot, "run-"))
    : resumeDirectory;
  const projectDirectory = join(runDirectory, "project");
  const evidenceDirectory = join(runDirectory, "evidence");
  const projectFile = join(projectDirectory, "project.json");
  const fingerprintFile = join(runDirectory, FIXTURE_FINGERPRINT_FILE);
  const manifestFile = join(runDirectory, FIXTURE_MANIFEST_FILE);
  if (resumeDirectory === undefined) {
    await Promise.all([
      mkdir(projectDirectory),
      mkdir(evidenceDirectory),
    ]);
    await writeFile(projectFile, `${JSON.stringify({
      schemaVersion: 3,
      metadata: { name: "真实 13 Scene 本机验收" },
      theme: { ...DEFAULT_PROJECT_THEME, accentColor: "#0F172A" },
      assets: [],
      scenes: [],
    })}\n`);
    await writeFile(fingerprintFile, `${fixtureFingerprint}\n`);
  } else {
    await expect(readFile(fingerprintFile, "utf8"))
      .resolves.toBe(`${fixtureFingerprint}\n`);
    const resumedProject = JSON.parse(await readFile(projectFile, "utf8")) as Project;
    const currentManifest = await createRealAcceptanceManifest({
      fixtureFingerprint,
      sourceFingerprints,
      narrations,
      project: resumedProject,
      projectRoot: projectDirectory,
    });
    const savedManifest = JSON.parse(
      await readFile(manifestFile, "utf8"),
    ) as RealAcceptanceManifest;
    expect(savedManifest).toEqual(currentManifest);
    await mkdir(evidenceDirectory, { recursive: true });
  }

  cli = await startCli(projectDirectory, apiKey);
  await page.goto(cli.url);
  if (resumeDirectory === undefined) {
    await expect(page.getByRole("heading", { name: "从第一句讲解开始" })).toBeVisible();

    await page.getByRole("button", { name: "粘贴多行 Narration" }).click();
    let dialog = page.getByRole("dialog", { name: "粘贴多行 Narration" });
    await dialog.getByRole("textbox", { name: "原文" }).fill(narrations.join("\n"));
    await dialog.getByRole("button", { name: "整理拆分" }).click();
    dialog = page.getByRole("dialog", { name: "确认拆分结果" });
    await dialog.getByRole("button", { name: "创建 Scene", exact: true }).click();
    await expect(page.getByTestId("scene-row")).toHaveCount(13);
    await waitForSaved(page);

    let preparedProject = JSON.parse(await readFile(projectFile, "utf8")) as Project;
    const preparedSceneIds = preparedProject.scenes.map((scene) => scene.id);
    expect(new Set(preparedSceneIds).size).toBe(13);
    await rowById(page, preparedSceneIds[0]).getByRole("combobox").selectOption("image");
    await waitForSaved(page);

    await rowById(page, preparedSceneIds[1]).getByRole("button", { name: /选择并预览 Scene/u }).click();
    await page.getByRole("button", { name: "添加画面说明" }).click();
    dialog = page.getByRole("dialog", { name: "添加画面说明" });
    await dialog.getByRole("textbox", { name: "说明文字" }).fill(ALERT_CAPTION_TEXT);
    await dialog.getByRole("button", { name: "添加画面说明" }).click();
    await page.getByRole("button", { name: "场景文字样式：聚焦" }).click();
    await page.getByRole("button", { name: "场景入场动画：向上进入" }).click();
    await waitForSaved(page);

    await page.getByRole("button", { name: /检查并渲染 · \d+/u }).click();
    await expect(page.locator(".diagnostic-queue-summary")).toContainText(/\d+ 个阻断/u);
    const firstDiagnostic = page.locator(".diagnostic-queue button.error").first();
    const diagnosticMeta = await firstDiagnostic.locator(".diagnostic-meta").innerText();
    const diagnosticSceneMatch = diagnosticMeta.match(/Scene (\d+)/u);
    expect(diagnosticSceneMatch, "诊断必须标明目标 Scene").not.toBeNull();
    const diagnosticSceneIndex = Number(diagnosticSceneMatch![1]) - 1;
    const diagnosticSceneId = preparedSceneIds[diagnosticSceneIndex];
    expect(diagnosticSceneId).toBeDefined();
    await page.getByRole("button", { name: "关闭任务抽屉" }).click();
    const otherSceneId = preparedSceneIds[diagnosticSceneIndex === 12 ? 11 : 12];
    await rowById(page, otherSceneId).getByRole("button", { name: /选择并预览 Scene/u }).click();
    await expect(rowById(page, diagnosticSceneId)).not.toHaveClass(/selected/u);
    await page.getByRole("button", { name: /检查并渲染 · \d+/u }).click();
    await page.locator(".diagnostic-queue button.error").first().click();
    await expect(page.locator(".task-drawer")).toHaveAttribute("aria-hidden", "true");
    await expect(rowById(page, diagnosticSceneId)).toHaveClass(/selected/u);
    await expect(rowById(page, diagnosticSceneId).locator(":focus")).toHaveCount(1);

    for (let index = 0; index < sources.length; index += 1) {
      const row = rowById(page, preparedSceneIds[index]);
      const kind = index === 0 ? "图片" : "视频";
      await row.getByLabel(new RegExp(`为 Scene \\d+ 选择${kind}`, "u"))
        .setInputFiles(sources[index].path);
      await expect(row.getByText(basename(sources[index].path))).toBeVisible({
        timeout: index === 0 ? 60_000 : 240_000,
      });
      await waitForSceneAsset(projectFile, preparedSceneIds[index]);
    }
    await waitForSaved(page);

    for (const sceneId of preparedSceneIds) {
      const row = rowById(page, sceneId);
      await row.getByRole("button", { name: "生成 Speech", exact: true }).click();
      await expect(row.getByText("已生成 · 可撤销")).toBeVisible({ timeout: 120_000 });
      await waitForSaved(page);
    }
    preparedProject = JSON.parse(await readFile(projectFile, "utf8")) as Project;
    const manifest = await createRealAcceptanceManifest({
      fixtureFingerprint,
      sourceFingerprints,
      narrations,
      project: preparedProject,
      projectRoot: projectDirectory,
    });
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  let project = JSON.parse(await readFile(projectFile, "utf8")) as Project;
  const sceneIds = project.scenes.map((scene) => scene.id);
  await expect(page.getByTestId("scene-row")).toHaveCount(13);
  expect(new Set(sceneIds).size).toBe(13);
  if (
    resumeDirectory !== undefined &&
    project.scenes[1]?.visual.type !== "card" &&
    project.scenes[1]?.visual.caption?.text !== ALERT_CAPTION_TEXT
  ) {
    await rowById(page, sceneIds[1]).getByRole("button", { name: /选择并预览 Scene/u }).click();
    await page.getByRole("textbox", { name: "说明文字" }).fill(ALERT_CAPTION_TEXT);
    await page.getByRole("textbox", { name: "说明文字" }).blur();
    await waitForSaved(page);
    project = JSON.parse(await readFile(projectFile, "utf8")) as Project;
  }
  expect(project.scenes).toHaveLength(13);
  expect(project.scenes.map((scene) => scene.narration.text)).toEqual(narrations);
  expect(project.assets.filter((asset) => asset.kind === "image")).toHaveLength(1);
  expect(project.assets.filter((asset) => asset.kind === "video")).toHaveLength(12);
  expect(project.scenes.every((scene) => scene.speech !== undefined)).toBe(true);
  expect(project.scenes.every((scene) => scene.transition === "cut")).toBe(true);
  expect(project.scenes[1].visual).toMatchObject({
    type: "video",
    caption: {
      text: ALERT_CAPTION_TEXT,
      textStyleId: "narracut/spotlight@1",
      textMotionId: "narracut/rise@1",
    },
  });

  const normalizedVideoFacts = new Map<string, MediaFacts>();
  for (const asset of project.assets) {
    const path = join(projectDirectory, asset.path);
    if (asset.kind === "image") {
      await expect(sharp(path).metadata()).resolves.toMatchObject({
        format: "png",
        width: 1920,
        height: 1080,
      });
      continue;
    }
    const facts = await probeMedia(path);
    normalizedVideoFacts.set(asset.path, facts);
    expect(facts).toMatchObject({
      videoStreams: 1,
      audioStreams: 0,
      codec: "h264",
      width: 1920,
      height: 1080,
      pixelFormat: "yuv420p",
      frameRate: "30/1",
      colorRange: "tv",
      colorSpace: "bt709",
    });
    expect(["High", "100"]).toContain(facts.profile);
  }

  for (const scene of project.scenes) {
    const speech = scene.speech!;
    expect(speech.path).toBe(`speech/${scene.id}.mp3`);
    expect(speech.ttsProfileId).toBe("narracut-mandarin-news-v1");
    expect(speech.sourceTextHash).toBe(
      `sha256:${createHash("sha256").update(scene.narration.text).digest("hex")}`,
    );
    const facts = await probeMedia(join(projectDirectory, speech.path));
    expect(facts.audioStreams).toBe(1);
    expect(facts.videoStreams).toBe(0);
    expect(Math.abs(facts.durationSeconds * 1000 - speech.durationMs)).toBeLessThanOrEqual(80);
  }

  await expect(page.getByRole("button", { name: "渲染 MP4" })).toBeVisible();
  await page.locator("[data-task-trigger]").click();
  await expect(page.locator(".diagnostic-queue-summary")).toContainText("0 个阻断 · 1 个提醒");
  await expect(page.locator(".diagnostic-queue")).toContainText("检查品牌强调色");
  await page.getByRole("button", { name: "关闭任务抽屉" }).click();

  const availability = Object.fromEntries([
    ...project.assets.map((asset) => [asset.path, true] as const),
    ...project.scenes.map((scene) => [scene.speech!.path, true] as const),
  ]);
  const videoDurationInFrames = Object.fromEntries(
    [...normalizedVideoFacts].map(([path, facts]) => [path, facts.frameCount!]),
  );
  const renderPlan = createRenderSnapshot(
    project,
    `${cli.url}/media/`,
    availability,
    {},
    videoDurationInFrames,
  );
  expect(renderPlan.durationInFrames).toBeLessThanOrEqual(60 * FPS);
  renderPlan.scenes.slice(0, -1).forEach((scene, index) => {
    expect(scene.startFrame + scene.durationInFrames).toBe(
      renderPlan.scenes[index + 1].startFrame,
    );
  });
  const videoWindows = renderPlan.scenes.flatMap((scene, index) =>
    scene.videoPlaybackWindow === undefined ? [] : [{ index, ...scene.videoPlaybackWindow }]
  );
  const truncated = videoWindows.filter((window) =>
    window.sourceDurationInFrames > window.durationInFrames
  );
  const frozen = videoWindows.filter((window) => window.freezeFrame !== undefined);
  expect(truncated.length, "真实夹具必须覆盖视频截断").toBeGreaterThan(0);
  expect(frozen.length, "真实夹具必须覆盖视频冻帧").toBeGreaterThan(0);

  const previewStyle = await page.addStyleTag({ content: `
    html, body, #root { min-width: 2000px !important; min-height: 1200px !important; }
    .preview-frame.remotion-preview {
      position: fixed !important;
      z-index: 2147483647 !important;
      inset: 0 auto auto 0 !important;
      width: 1920px !important;
      height: 1080px !important;
      max-height: none !important;
      border-radius: 0 !important;
    }
  ` });
  const targets = new Map<number, FrameTarget>();
  renderPlan.scenes.forEach((scene, index) => {
    addFrameTarget(
      targets,
      scene.startFrame + Math.min(10, scene.durationInFrames - 1),
      index,
      "representative",
    );
    if (index < renderPlan.scenes.length - 1) {
      addFrameTarget(targets, scene.startFrame + scene.durationInFrames - 1, index, "cut-before");
      addFrameTarget(targets, renderPlan.scenes[index + 1].startFrame, index + 1, "cut-after");
    }
  });
  const previewPaths = new Map<number, string>();
  for (const target of targets.values()) {
    await seekToFrame(page, target.frame);
    await expect(page.getByTestId("player-visual")).toHaveAttribute(
      "data-scene-id",
      sceneIds[target.sceneIndex],
    );
    const resolvedScene = renderPlan.scenes[target.sceneIndex];
    if (resolvedScene.videoPlaybackWindow !== undefined) {
      const localFrame = target.frame - resolvedScene.startFrame;
      await expect.poll(async () => Number(
        await page.getByTestId("media-asset").getAttribute("data-video-rendered-at-frame"),
      )).toBe(localFrame);
      const expectedLayer = localFrame >= resolvedScene.videoPlaybackWindow.durationInFrames
        ? "freeze"
        : "live";
      await expect(page.getByTestId("media-asset")).toHaveAttribute(
        "data-video-rendered-layer",
        expectedLayer,
      );
      if (expectedLayer === "freeze") {
        await expect(page.getByTestId("media-asset")).toHaveAttribute(
          "data-video-freeze-frame",
          String(resolvedScene.videoPlaybackWindow.freezeFrame),
        );
      }
      await page.evaluate(() => new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }));
    }
    const path = join(evidenceDirectory, `preview-frame-${target.frame}.png`);
    await page.getByTestId("player-visual").screenshot({ path, animations: "allow" });
    previewPaths.set(target.frame, path);
  }

  const frozenEvidence = frozen.find((window) =>
    window.sourceDurationInFrames < window.durationInFrames - 1
  ) ?? frozen[0];
  const frozenScene = renderPlan.scenes[frozenEvidence.index];
  await seekToFrame(page, frozenScene.startFrame + frozenScene.durationInFrames - 1);
  await expect(page.getByTestId("media-asset")).toHaveAttribute(
    "data-video-freeze-frame",
    String(frozenEvidence.freezeFrame),
  );
  await previewStyle.evaluate((element) => element.parentNode?.removeChild(element));

  const projectAtRender = JSON.parse(await readFile(projectFile, "utf8")) as Project;
  let renderDirectories: string[] = [];
  try {
    renderDirectories = await readdir(join(projectDirectory, "renders"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const matchingRenderDirectory = async (): Promise<string | undefined> => {
    for (const directory of [...renderDirectories].sort().reverse()) {
      try {
        const candidate = JSON.parse(await readFile(
          join(projectDirectory, "renders", directory, "project.snapshot.json"),
          "utf8",
        )) as Project;
        const files = await readdir(join(projectDirectory, "renders", directory));
        if (
          JSON.stringify(candidate) === JSON.stringify(projectAtRender) &&
          files.includes("out.mp4") &&
          files.includes("render.log")
        ) return directory;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    return undefined;
  };
  let renderDirectoryName = await matchingRenderDirectory();
  if (renderDirectoryName === undefined) {
    await page.getByRole("button", { name: "渲染 MP4" }).click();
    await expect(page.getByRole("button", { name: "渲染完成" })).toBeVisible({
      timeout: 15 * 60_000,
    });
    renderDirectories = await readdir(join(projectDirectory, "renders"));
    renderDirectoryName = await matchingRenderDirectory();
  }
  expect(renderDirectoryName).toBeDefined();
  const renderDirectory = join(projectDirectory, "renders", renderDirectoryName!);
  const snapshotPath = join(renderDirectory, "project.snapshot.json");
  const outputPath = join(renderDirectory, "out.mp4");
  const logPath = join(renderDirectory, "render.log");
  expect((await readdir(renderDirectory)).sort()).toEqual([
    ".media",
    "out.mp4",
    "project.snapshot.json",
    "render.log",
  ]);
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as Project;
  expect(snapshot).toEqual(projectAtRender);
  expect((await readFile(logPath, "utf8")).length).toBeGreaterThan(0);

  const outputFacts = await probeMedia(outputPath);
  expect(outputFacts).toMatchObject({
    videoStreams: 1,
    audioStreams: 1,
    codec: "h264",
    width: 1920,
    height: 1080,
    frameRate: "30/1",
    frameCount: renderPlan.durationInFrames,
  });

  const renderPaths = new Map<number, string>();
  for (const target of targets.values()) {
    const path = join(evidenceDirectory, `render-frame-${target.frame}.png`);
    await extractFrame(outputPath, target.frame, path);
    renderPaths.set(target.frame, path);
    const comparison = await compareVisualFrames(
      previewPaths.get(target.frame)!,
      path,
      {
        sceneId: sceneIds[target.sceneIndex],
        frame: target.frame,
        channelThreshold: H264_CHANNEL_THRESHOLD,
        maxDifferentPixelRatio: H264_MAX_DIFFERENT_PIXEL_RATIO,
        artifactDirectory: join(evidenceDirectory, "visual-diffs"),
      },
    );
    expect(comparison.differentPixelRatio).toBeLessThanOrEqual(
      H264_MAX_DIFFERENT_PIXEL_RATIO,
    );
  }

  const freezeSourceFrame = frozenScene.startFrame + frozenEvidence.sourceDurationInFrames - 1;
  const freezeEndFrame = frozenScene.startFrame + frozenScene.durationInFrames - 1;
  const freezeSourcePath = join(evidenceDirectory, `freeze-source-frame-${freezeSourceFrame}.png`);
  const freezeEndPath = join(evidenceDirectory, `freeze-end-frame-${freezeEndFrame}.png`);
  await Promise.all([
    extractFrame(outputPath, freezeSourceFrame, freezeSourcePath),
    extractFrame(outputPath, freezeEndFrame, freezeEndPath),
  ]);
  const freezeComparison = await compareVisualFrames(
    freezeSourcePath,
    freezeEndPath,
    {
      sceneId: sceneIds[frozenEvidence.index],
      frame: freezeEndFrame,
      channelThreshold: H264_CHANNEL_THRESHOLD,
      maxDifferentPixelRatio: H264_MAX_DIFFERENT_PIXEL_RATIO,
      artifactDirectory: join(evidenceDirectory, "visual-diffs"),
    },
  );
  expect(freezeComparison.differentPixelRatio).toBeLessThanOrEqual(
    H264_MAX_DIFFERENT_PIXEL_RATIO,
  );

  const outputAudio = await decodeAudio(outputPath, join(evidenceDirectory, "render-audio.wav"));
  const alignments = [];
  for (let index = 0; index < project.scenes.length; index += 1) {
    const speechPath = join(projectDirectory, project.scenes[index].speech!.path);
    const sourceAudio = await decodeAudio(
      speechPath,
      join(evidenceDirectory, `speech-${String(index + 1).padStart(2, "0")}.wav`),
    );
    const expectedEnvelope = rmsEnvelope(sourceAudio, 0, sourceAudio.length);
    const sceneStartSample = Math.round(
      (renderPlan.scenes[index].startFrame / FPS) * AUDIO_SAMPLE_RATE,
    );
    const actualEnvelope = rmsEnvelope(
      outputAudio,
      sceneStartSample,
      sourceAudio.length + 8_000,
    );
    const alignment = bestAudioAlignment(expectedEnvelope, actualEnvelope);
    const codecDelayMs = await probeSpeechCodecDelayMs(speechPath);
    const actualDelayMs = (alignment.shift * 160 * 1000) / AUDIO_SAMPLE_RATE;
    const alignedFrame = renderPlan.scenes[index].startFrame +
      ((actualDelayMs - codecDelayMs) / 1000) * FPS;
    expect(alignment.correlation, `Scene ${index + 1} Speech 音频包络相关性`)
      .toBeGreaterThan(0.9);
    expect(
      Math.abs(alignedFrame - renderPlan.scenes[index].startFrame),
      `Scene ${index + 1} Speech 起点应与 Scene 对齐`,
    ).toBeLessThanOrEqual(2);
    alignments.push({
      scene: index + 1,
      correlation: alignment.correlation,
      startFrameDelta: alignedFrame - renderPlan.scenes[index].startFrame,
    });
  }

  const representativeRenderPaths = renderPlan.scenes.map((scene) => {
    const frame = scene.startFrame + Math.min(10, scene.durationInFrames - 1);
    return renderPaths.get(frame)!;
  });
  await writeContactSheet(
    representativeRenderPaths,
    join(evidenceDirectory, "scene-contact-sheet.png"),
  );

  expect(cli.output()).not.toContain(apiKey);
  expect(await filesContaining(runDirectory, apiKey)).toEqual([]);

  const automaticEvidence = {
    sceneCount: project.scenes.length,
    imageAssetCount: project.assets.filter((asset) => asset.kind === "image").length,
    videoAssetCount: project.assets.filter((asset) => asset.kind === "video").length,
    sourceHevcMain10Count: sourceVideoFacts.length,
    durationInFrames: renderPlan.durationInFrames,
    durationSeconds: renderPlan.durationInFrames / FPS,
    outputFrameCount: outputFacts.frameCount,
    outputAudioTracks: outputFacts.audioStreams,
    normalizedAssetAudioTracks: [...normalizedVideoFacts.values()]
      .reduce((total, facts) => total + facts.audioStreams, 0),
    previewRenderComparedFrames: targets.size,
    cutCount: project.scenes.length - 1,
    truncatedVideoScenes: truncated.map((entry) => entry.index + 1),
    frozenVideoScenes: frozen.map((entry) => entry.index + 1),
    speechAlignments: alignments,
    artifacts: {
      snapshot: relative(runDirectory, snapshotPath),
      output: relative(runDirectory, outputPath),
      renderLog: relative(runDirectory, logPath),
      contactSheet: "evidence/scene-contact-sheet.png",
    },
  };
  await writeFile(
    join(evidenceDirectory, "automatic-evidence.json"),
    `${JSON.stringify(automaticEvidence, null, 2)}\n`,
  );
  await writeFile(join(runDirectory, "CHECKLIST.md"), `# 真实 13 Scene 本机验收\n\n` +
    `自动检查已通过：\n\n` +
    `- [x] 13 个稳定 Scene、1 张 Image Asset、12 段 Video Asset\n` +
    `- [x] 12 段 HEVC Main 10 源视频全部规范化为静音 H.264 1080p30\n` +
    `- [x] 13 份真实 Speech 可解码，hash、profile、路径、Duration 与 Narration 一致\n` +
    `- [x] 低对比强调色 warning 被记录但未阻止渲染\n` +
    `- [x] project.snapshot.json、out.mp4 与 render.log 完整\n` +
    `- [x] MP4 共 ${renderPlan.durationInFrames} 帧（${(renderPlan.durationInFrames / FPS).toFixed(2)} 秒），与 RenderPlan 一致且不超过一分钟\n` +
    `- [x] ${targets.size} 个代表帧与 Cut 边界通过 Preview = Render 对比\n` +
    `- [x] Speech 起点逐 Scene 对齐，视频截断与冻帧均有覆盖，成片只有唯一 Speech 音轨\n\n` +
    `维护者人工观感复核：\n\n` +
    `- [ ] 在手机宽度播放 \`project/renders/${renderDirectoryName}/out.mp4\`，逐 Scene Subtitle 无截断且可读。\n` +
    `- [ ] Scene 02 的 Alert 风格 Caption 清晰可辨，不与 Subtitle 混淆。\n` +
    `- [ ] 对照 \`evidence/scene-contact-sheet.png\`，片头、片尾与临床正片的整体节奏和画面观感可接受。\n` +
    `- [ ] 完整播放成片，确认声音自然、Cut 无异常黑帧、冻帧无跳动。\n\n` +
    `本目录位于 Git 忽略路径；不要把成片、帧图、Speech、快照或凭据上传到 Git、Issue 附件或公开测试产物。\n`);
});

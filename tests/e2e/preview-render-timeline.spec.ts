import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

import { renderProjectSnapshot } from "../../src/remotion/renderer";
import { createRenderSnapshot } from "../../src/remotion/render-snapshot";
import { startNarracutServer, type RunningServer } from "../../src/server/server";
import type { Project, Scene } from "../../src/shared/project";
import { compareVisualFrames } from "../support/visual-comparison";

const execFileAsync = promisify(execFile);
const FPS = 30;
const AUDIO_SAMPLE_RATE = 32_000;
const ASSET_AUDIO_MARKER_HZ = 14_000;
const SOURCE_SPEECH = [
  "fixtures/demo/speech/20000000-0000-4000-8000-000000000002.mp3",
  "fixtures/demo/speech/20000000-0000-4000-8000-000000000001.mp3",
  "fixtures/demo/speech/20000000-0000-4000-8000-000000000004.mp3",
] as const;
const SOURCE_ASSETS = {
  shortVideo: "fixtures/demo/assets/10000000-0000-4000-8000-000000000013.mp4",
  longVideo: "fixtures/demo/assets/10000000-0000-4000-8000-000000000002.mp4",
  image: "fixtures/demo/assets/c1c078d7-7c62-44da-ad4f-2951d5a5dddc.png",
} as const;
const sceneIds = [
  "93000000-0000-4000-8000-000000000001",
  "93000000-0000-4000-8000-000000000002",
  "93000000-0000-4000-8000-000000000003",
] as const;
const assetIds = [
  "94000000-0000-4000-8000-000000000001",
  "94000000-0000-4000-8000-000000000002",
  "94000000-0000-4000-8000-000000000003",
] as const;

type MediaFacts = {
  durationSeconds: number;
  videoStreams: number;
  audioStreams: number;
  streamTypes: string[];
  audioStartSeconds?: number;
  frameCount?: number;
  frameRate?: string;
};

type TimelineFacts = {
  speechDurationMs: number[];
  speechCodecDelayMs: number[];
  sceneFrameCounts: number[];
  sceneStartFrames: number[];
  totalFrames: number;
  shortVideo: MediaFacts;
  longVideo: MediaFacts;
};

let server: RunningServer | undefined;
let projectDirectory = "";
let project: Project;
let timeline: TimelineFacts;

async function probeMedia(path: string): Promise<MediaFacts> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,avg_frame_rate,nb_frames,start_time",
    "-of", "json",
    path,
  ]);
  const result = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      avg_frame_rate?: string;
      nb_frames?: string;
      start_time?: string;
    }>;
  };
  const video = result.streams?.find((stream) => stream.codec_type === "video");
  const audio = result.streams?.find((stream) => stream.codec_type === "audio");
  return {
    durationSeconds: Number(result.format?.duration),
    videoStreams: result.streams?.filter((stream) => stream.codec_type === "video").length ?? 0,
    audioStreams: result.streams?.filter((stream) => stream.codec_type === "audio").length ?? 0,
    streamTypes: (result.streams ?? [])
      .flatMap((stream) => stream.codec_type === undefined ? [] : [stream.codec_type])
      .sort(),
    ...(audio?.start_time === undefined ? {} : { audioStartSeconds: Number(audio.start_time) }),
    ...(video?.nb_frames === undefined ? {} : { frameCount: Number(video.nb_frames) }),
    ...(video?.avg_frame_rate === undefined ? {} : { frameRate: video.avg_frame_rate }),
  };
}

async function probeSpeechCodecDelayMs(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_packets",
    "-read_intervals", "%+#1",
    "-show_entries", "stream=start_time:packet=duration_time",
    "-of", "json",
    path,
  ]);
  const result = JSON.parse(stdout) as {
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

function speech(sceneId: string, narrationText: string, durationMs: number) {
  return {
    path: `speech/${sceneId}.mp3`,
    durationMs,
    sourceTextHash: `sha256:${createHash("sha256").update(narrationText).digest("hex")}`,
    ttsProfileId: "narracut-mandarin-news-v1",
  };
}

function scene(
  index: number,
  narrationText: string,
  visual: Scene["visual"],
): Scene {
  return {
    id: sceneIds[index],
    narration: { text: narrationText },
    speech: speech(sceneIds[index], narrationText, timeline.speechDurationMs[index]),
    visual,
    transition: "cut",
  };
}

function timelineProject(): Project {
  return {
    schemaVersion: 3,
    metadata: { name: "Speech 与时间线音画一致证据" },
    theme: {
      presetId: "narracut/default@1",
      defaultTextStyleId: "narracut/panel@1",
      defaultTextMotionId: "narracut/none@1",
      accentColor: "#00A3A6",
      fontId: "narracut/noto-sans-cjk-sc@1",
    },
    assets: [
      { id: assetIds[0], kind: "video", path: "assets/short.mp4" },
      { id: assetIds[1], kind: "video", path: "assets/long.mp4" },
      { id: assetIds[2], kind: "image", path: "assets/still.png" },
    ],
    scenes: [
      scene(0, "从球囊连接管套装中取出连接管", {
        type: "video",
        assetId: assetIds[0],
      }),
      scene(1, "取 100 毫升生理盐水注射液", {
        type: "video",
        assetId: assetIds[1],
      }),
      scene(2, "将连接管与生理盐水瓶连接", {
        type: "image",
        assetId: assetIds[2],
      }),
    ],
  };
}

function evidence(sceneIndex: number, expectedFrame: number, actualFrame: number): string {
  const media = sceneIndex === 0
    ? `Video ${timeline.shortVideo.frameCount} 帧/${timeline.shortVideo.durationSeconds}s`
    : sceneIndex === 1
      ? `Video ${timeline.longVideo.frameCount} 帧/${timeline.longVideo.durationSeconds}s`
      : "Image 1920×1080";
  return `Scene ${sceneIds[sceneIndex]} · 预期/实际帧 ${expectedFrame}/${actualFrame} · ` +
    `Speech ${timeline.speechDurationMs[sceneIndex]}ms · ${media}`;
}

function sceneIndexAtFrame(frame: number): number {
  return timeline.sceneStartFrames.reduce(
    (matched, start, index) => (frame >= start ? index : matched),
    0,
  );
}

async function seekToFrame(page: Page, frame: number): Promise<void> {
  const slider = page.getByRole("slider", { name: "项目播放进度" });
  await slider.fill(String(frame), { force: true });
  await expect(
    slider,
    evidence(sceneIndexAtFrame(frame), frame, Number(await slider.inputValue())),
  ).toHaveValue(String(frame));
  await page.evaluate(() => new Promise<void>((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  }));
}

async function capturePlayerFrame(
  page: Page,
  frame: number,
  path: string,
  expectedLocalVideoFrame?: number,
  expectedVideoLayer?: "live" | "freeze",
): Promise<string> {
  await seekToFrame(page, frame);
  if (expectedLocalVideoFrame !== undefined) {
    const sceneIndex = sceneIndexAtFrame(frame);
    await expect.poll(
      async () => Number(
        await page.getByTestId("media-asset").getAttribute("data-video-rendered-at-frame"),
      ),
      { message: evidence(sceneIndex, expectedLocalVideoFrame, frame) },
    ).toBe(expectedLocalVideoFrame);
    await expect(
      page.getByTestId("media-asset"),
      evidence(sceneIndex, expectedLocalVideoFrame, frame),
    ).toHaveAttribute(
      "data-video-rendered-layer",
      expectedVideoLayer ?? "live",
    );
    await page.evaluate(() => new Promise<void>((done) => {
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
    }));
  }
  await page.getByTestId("player-visual").screenshot({ path, animations: "allow" });
  return path;
}

async function decodeFrame(video: string, frame: number, output: string): Promise<string> {
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", video,
    "-vf", `select=eq(n\\,${frame})`,
    "-vsync", "0",
    "-frames:v", "1",
    output,
  ]);
  return output;
}

async function decodeAudio(input: string, output: string): Promise<Float32Array> {
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", input,
    "-ac", "1",
    "-ar", String(AUDIO_SAMPLE_RATE),
    "-f", "f32le",
    "-y", output,
  ]);
  const bytes = await readFile(output);
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
}

function toneAmplitude(
  samples: Float32Array,
  startSample: number,
  sampleCount: number,
  frequency: number,
): number {
  const count = Math.min(sampleCount, samples.length - startSample);
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < count; index += 1) {
    const angle = (2 * Math.PI * frequency * index) / AUDIO_SAMPLE_RATE;
    const sample = samples[startSample + index];
    real += sample * Math.cos(angle);
    imaginary -= sample * Math.sin(angle);
  }
  return (2 * Math.hypot(real, imaginary)) / count;
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
  for (let shift = -30; shift <= 30; shift += 1) {
    const correlation = correlationAtShift(expected, actual, shift);
    if (correlation > best.correlation) best = { correlation, shift };
  }
  return best;
}

test.use({ viewport: { width: 2000, height: 1200 } });

test.beforeAll(async () => {
  projectDirectory = await mkdtemp(join(tmpdir(), "narracut-timeline-evidence-"));
  await Promise.all([
    mkdir(join(projectDirectory, "assets"), { recursive: true }),
    mkdir(join(projectDirectory, "speech"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(resolve(SOURCE_ASSETS.shortVideo), join(projectDirectory, "assets", "short.mp4")),
    copyFile(resolve(SOURCE_ASSETS.image), join(projectDirectory, "assets", "still.png")),
    ...SOURCE_SPEECH.map((source, index) =>
      copyFile(resolve(source), join(projectDirectory, "speech", `${sceneIds[index]}.mp3`)),
    ),
  ]);
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", resolve(SOURCE_ASSETS.longVideo),
    "-f", "lavfi",
    "-i", `sine=frequency=${ASSET_AUDIO_MARKER_HZ}:sample_rate=${AUDIO_SAMPLE_RATE}`,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-map_metadata", "-1",
    "-movflags", "+faststart",
    join(projectDirectory, "assets", "long.mp4"),
  ]);
  const [speechFacts, speechCodecDelayMs, shortVideo, longVideo] = await Promise.all([
    Promise.all(SOURCE_SPEECH.map((path) => probeMedia(resolve(path)))),
    Promise.all(SOURCE_SPEECH.map((path) => probeSpeechCodecDelayMs(resolve(path)))),
    probeMedia(join(projectDirectory, "assets", "short.mp4")),
    probeMedia(join(projectDirectory, "assets", "long.mp4")),
  ]);
  const speechDurationMs = speechFacts.map((facts) => Math.round(facts.durationSeconds * 1000));
  const sceneFrameCounts = speechDurationMs.map((durationMs) =>
    Math.ceil((durationMs / 1000) * FPS),
  );
  const sceneStartFrames = sceneFrameCounts.map((_, index) =>
    sceneFrameCounts.slice(0, index).reduce((total, frames) => total + frames, 0),
  );
  timeline = {
    speechDurationMs,
    speechCodecDelayMs,
    sceneFrameCounts,
    sceneStartFrames,
    totalFrames: sceneFrameCounts.reduce((total, frames) => total + frames, 0),
    shortVideo,
    longVideo,
  };
  expect(
    shortVideo.frameCount,
    evidence(0, sceneFrameCounts[0] - 1, shortVideo.frameCount ?? -1),
  ).toBeLessThan(sceneFrameCounts[0]);
  expect(
    longVideo.frameCount,
    evidence(1, sceneFrameCounts[1] + 1, longVideo.frameCount ?? -1),
  ).toBeGreaterThan(sceneFrameCounts[1]);
  expect(shortVideo.audioStreams, evidence(0, 0, shortVideo.audioStreams)).toBe(0);
  expect(longVideo.audioStreams, evidence(1, 1, longVideo.audioStreams)).toBe(1);
  speechFacts.forEach((facts, index) => {
    expect(facts.audioStreams, evidence(index, 1, facts.audioStreams)).toBe(1);
  });
  project = timelineProject();
  await writeFile(join(projectDirectory, "project.json"), `${JSON.stringify(project)}\n`);
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    host: "127.0.0.1",
    initialPort: 0,
  });
});

test.afterAll(async () => {
  try {
    await server?.close();
  } finally {
    if (projectDirectory !== "") await rm(projectDirectory, { recursive: true, force: true });
  }
});

test("真实 Speech、Player 与最终 MP4 共享逐帧 Scene 时间线", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  let failureMessage = "";
  try {
    expect(0, evidence(0, 1, 0)).toBe(1);
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error);
  }
  [sceneIds[0], "预期/实际帧 1/0", `Speech ${timeline.speechDurationMs[0]}ms`, "Video"]
    .forEach((fact) => expect(failureMessage).toContain(fact));

  await page.goto(server!.url);
  await expect(page.getByTestId("player-visual")).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "项目播放进度" }),
    evidence(2, timeline.totalFrames - 1, -1),
  )
    .toHaveAttribute(
      "max",
      String(timeline.totalFrames - 1),
      { timeout: 10_000 },
    );
  await page.addStyleTag({ content: `
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

  for (let index = 0; index < project.scenes.length; index += 1) {
    const start = timeline.sceneStartFrames[index];
    const end = start + timeline.sceneFrameCounts[index] - 1;
    await seekToFrame(page, start);
    await expect(
      page.getByTestId("player-visual"),
      evidence(index, start, Number(await page.getByRole("slider", { name: "项目播放进度" }).inputValue())),
    ).toHaveAttribute("data-scene-id", sceneIds[index]);
    await seekToFrame(page, end);
    await expect(
      page.getByTestId("player-visual"),
      evidence(index, end, Number(await page.getByRole("slider", { name: "项目播放进度" }).inputValue())),
    ).toHaveAttribute("data-scene-id", sceneIds[index]);
  }

  const shortLastSourceFrame = timeline.sceneStartFrames[0] + timeline.shortVideo.frameCount! - 1;
  const shortSceneLastFrame = timeline.sceneFrameCounts[0] - 1;
  const imageStartFrame = timeline.sceneStartFrames[2];
  const imageLastFrame = timeline.totalFrames - 1;
  const targetFrames = [...new Set([
    0,
    shortLastSourceFrame,
    shortSceneLastFrame,
    timeline.sceneStartFrames[1],
    timeline.sceneStartFrames[2] - 1,
    imageStartFrame,
    imageLastFrame,
  ])];
  const playerFrames = new Map<number, string>();
  await seekToFrame(page, shortSceneLastFrame);
  await expect(page.getByTestId("media-asset"), evidence(0, timeline.shortVideo.frameCount!, -1)).toHaveAttribute(
    "data-video-source-frames",
    String(timeline.shortVideo.frameCount),
  );
  await expect(page.getByTestId("media-asset"), evidence(0, timeline.shortVideo.frameCount! - 1, -1)).toHaveAttribute(
    "data-video-freeze-frame",
    String(timeline.shortVideo.frameCount! - 1),
  );
  for (const frame of targetFrames) {
    const sceneIndex = sceneIndexAtFrame(frame);
    const localFrame = frame - timeline.sceneStartFrames[sceneIndex];
    const renderedVideoFrame = sceneIndex === 0
      ? Math.min(localFrame, timeline.shortVideo.frameCount! - 1)
      : localFrame;
    playerFrames.set(
      frame,
      await capturePlayerFrame(
        page,
        frame,
        testInfo.outputPath(`player-frame-${frame}.png`),
        sceneIndex < 2 ? renderedVideoFrame : undefined,
        sceneIndex === 0 && localFrame >= timeline.shortVideo.frameCount!
          ? "freeze"
          : sceneIndex < 2
            ? "live"
            : undefined,
      ),
    );
  }

  const playerFreeze = await compareVisualFrames(
    playerFrames.get(shortLastSourceFrame)!,
    playerFrames.get(shortSceneLastFrame)!,
    {
      sceneId: sceneIds[0],
      frame: shortSceneLastFrame,
      channelThreshold: 0,
      maxDifferentPixelRatio: 0,
      artifactDirectory: testInfo.outputPath("timeline-diffs"),
    },
  );
  expect(playerFreeze.differentPixels, evidence(0, shortSceneLastFrame, shortSceneLastFrame)).toBe(0);
  const playerImage = await compareVisualFrames(
    playerFrames.get(imageStartFrame)!,
    playerFrames.get(imageLastFrame)!,
    {
      sceneId: sceneIds[2],
      frame: imageLastFrame,
      channelThreshold: 0,
      maxDifferentPixelRatio: 0,
      artifactDirectory: testInfo.outputPath("timeline-diffs"),
    },
  );
  expect(playerImage.differentPixels, evidence(2, imageLastFrame, imageLastFrame)).toBe(0);

  const output = testInfo.outputPath("timeline-render.mp4");
  const availability = Object.fromEntries([
    ["assets/short.mp4", true],
    ["assets/long.mp4", true],
    ["assets/still.png", true],
    ...sceneIds.map((sceneId) => [`speech/${sceneId}.mp3`, true] as const),
  ]);
  const snapshot = createRenderSnapshot(
    project,
    `${server!.url}/media/`,
    availability,
    {},
    {
      "assets/short.mp4": timeline.shortVideo.frameCount!,
      "assets/long.mp4": timeline.longVideo.frameCount!,
    },
  );
  snapshot.scenes.forEach((resolved, index) => {
    expect(resolved.startFrame, evidence(index, timeline.sceneStartFrames[index], resolved.startFrame))
      .toBe(timeline.sceneStartFrames[index]);
    expect(
      resolved.durationInFrames,
      evidence(index, timeline.sceneFrameCounts[index], resolved.durationInFrames),
    ).toBe(timeline.sceneFrameCounts[index]);
  });
  await renderProjectSnapshot(
    snapshot,
    output,
    undefined,
    undefined,
    { concurrency: 1 },
  );

  const outputFacts = await probeMedia(output);
  expect(outputFacts.frameRate, `项目总帧 ${timeline.totalFrames} · 输出媒体事实 ${JSON.stringify(outputFacts)}`)
    .toBe("30/1");
  expect(outputFacts.frameCount, `项目总帧预期/实际 ${timeline.totalFrames}/${outputFacts.frameCount}`)
    .toBe(timeline.totalFrames);
  expect(outputFacts.videoStreams, evidence(0, 1, outputFacts.videoStreams)).toBe(1);
  expect(outputFacts.audioStreams, evidence(0, 1, outputFacts.audioStreams)).toBe(1);
  expect(
    outputFacts.streamTypes,
    `${evidence(0, 2, outputFacts.streamTypes.length)} · 输出轨道 ${outputFacts.streamTypes.join("/")}`,
  ).toEqual(["audio", "video"]);
  expect(outputFacts.audioStartSeconds, evidence(0, 0, outputFacts.audioStartSeconds ?? -1)).toBe(0);

  const outputAudio = await decodeAudio(output, testInfo.outputPath("render-audio.f32"));
  const audioAlignments = [];
  for (let index = 0; index < SOURCE_SPEECH.length; index += 1) {
    const sourceAudio = await decodeAudio(
      resolve(SOURCE_SPEECH[index]),
      testInfo.outputPath(`source-audio-${index}.f32`),
    );
    const expectedEnvelope = rmsEnvelope(sourceAudio, 0, sourceAudio.length);
    const sceneStartSample = Math.round(
      (timeline.sceneStartFrames[index] / FPS) * AUDIO_SAMPLE_RATE,
    );
    const actualEnvelope = rmsEnvelope(
      outputAudio,
      sceneStartSample,
      sourceAudio.length + 4_800,
    );
    const alignment = bestAudioAlignment(expectedEnvelope, actualEnvelope);
    audioAlignments.push(alignment);
    const actualDelayMs = (alignment.shift * 160 * 1000) / AUDIO_SAMPLE_RATE;
    const actualSpeechFrame = timeline.sceneStartFrames[index] +
      ((actualDelayMs - timeline.speechCodecDelayMs[index]) / 1000) * FPS;
    expect(
      alignment.correlation,
      `${evidence(index, timeline.sceneStartFrames[index], actualSpeechFrame)} · ` +
        `音频包络相关性 ${alignment.correlation}`,
    ).toBeGreaterThan(0.95);
    expect(
      Math.abs(actualSpeechFrame - timeline.sceneStartFrames[index]),
      `${evidence(index, timeline.sceneStartFrames[index], actualSpeechFrame)} · ` +
        `MP3 固有延迟预期/实际 ${timeline.speechCodecDelayMs[index]}ms/${actualDelayMs}ms`,
    ).toBeLessThanOrEqual(1);
  }
  const audioShifts = audioAlignments.map(({ shift }) => shift);
  expect(
    Math.max(...audioShifts) - Math.min(...audioShifts),
    `${evidence(0, audioShifts[0], Math.max(...audioShifts))} · ` +
      `各 Scene 的编码延迟窗 ${audioShifts.join("/")}，应共享同一起点偏移`,
  ).toBeLessThanOrEqual(1);

  const markedAssetAudio = await decodeAudio(
    join(projectDirectory, "assets", "long.mp4"),
    testInfo.outputPath("marked-asset-audio.f32"),
  );
  const markerSamples = Math.min(
    markedAssetAudio.length,
    timeline.sceneFrameCounts[1] * AUDIO_SAMPLE_RATE / FPS,
  );
  const sourceMarkerAmplitude = toneAmplitude(
    markedAssetAudio,
    0,
    markerSamples,
    ASSET_AUDIO_MARKER_HZ,
  );
  const outputMarkerAmplitude = toneAmplitude(
    outputAudio,
    Math.round((timeline.sceneStartFrames[1] / FPS) * AUDIO_SAMPLE_RATE),
    markerSamples,
    ASSET_AUDIO_MARKER_HZ,
  );
  expect(
    outputMarkerAmplitude,
    `${evidence(1, 0, outputMarkerAmplitude)} · Video Asset ${ASSET_AUDIO_MARKER_HZ}Hz ` +
      `原声幅度 ${sourceMarkerAmplitude}`,
  ).toBeLessThan(sourceMarkerAmplitude * 0.1);

  for (const frame of targetFrames) {
    const decoded = await decodeFrame(
      output,
      frame,
      testInfo.outputPath(`render-frame-${frame}.png`),
    );
    const sceneIndex = sceneIndexAtFrame(frame);
    const result = await compareVisualFrames(playerFrames.get(frame)!, decoded, {
      sceneId: sceneIds[sceneIndex],
      frame,
      channelThreshold: 30,
      maxDifferentPixelRatio: 0.012,
      artifactDirectory: testInfo.outputPath("timeline-diffs"),
    });
    expect(result.differentPixelRatio, evidence(sceneIndex, frame, frame)).toBeLessThanOrEqual(0.012);
  }

  expect(
    (await readFile(output)).length,
    `${evidence(0, timeline.totalFrames, outputFacts.frameCount ?? -1)} · 输出文件不能为空`,
  ).toBeGreaterThan(0);
});

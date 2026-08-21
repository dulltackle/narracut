import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { renderProjectSnapshot } from "../../src/remotion/renderer";
import { createRenderSnapshot } from "../../src/remotion/render-snapshot";
import { startNarracutServer, type RunningServer } from "../../src/server/server";
import type { Project, Scene } from "../../src/shared/project";
import {
  compareVisualFrames,
  type VisualComparisonRegion,
} from "../support/visual-comparison";

const execFileAsync = promisify(execFile);
const SCENE_DURATIONS_MS = [400, 400, 400, 400, 400, 1000, 400] as const;
const SCENE_FRAME_COUNTS = SCENE_DURATIONS_MS.map((durationMs) =>
  Math.ceil((durationMs / 1000) * 30),
);
const SCENE_START_FRAMES = SCENE_FRAME_COUNTS.map((_, index) =>
  SCENE_FRAME_COUNTS.slice(0, index).reduce((total, frames) => total + frames, 0),
);
const TOTAL_FRAMES = SCENE_FRAME_COUNTS.reduce((total, frames) => total + frames, 0);
const H264_CHANNEL_THRESHOLD = 30;
const H264_MAX_DIFFERENT_PIXEL_RATIO = 0.012;
const H264_MAX_TEXT_BLOCK_DIFFERENT_PIXEL_RATIO = 0.032;
const H264_MAX_SUBTITLE_DIFFERENT_PIXEL_RATIO = 0.05;
const sceneIds = Array.from({ length: 7 }, (_, index) =>
  `91000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
const imageAssetId = "92000000-0000-4000-8000-000000000001";
const videoAssetId = "92000000-0000-4000-8000-000000000002";

type VisualTarget = {
  label: string;
  sceneIndex: number;
  localFrame: number;
};

const targets: VisualTarget[] = [
  { label: "title-start", sceneIndex: 0, localFrame: 0 },
  { label: "title", sceneIndex: 0, localFrame: 6 },
  { label: "cut-before", sceneIndex: 0, localFrame: 11 },
  { label: "cut-boundary", sceneIndex: 1, localFrame: 0 },
  { label: "image-caption-start", sceneIndex: 2, localFrame: 0 },
  { label: "image-caption", sceneIndex: 2, localFrame: 6 },
  { label: "video", sceneIndex: 3, localFrame: 6 },
  { label: "step-caption", sceneIndex: 4, localFrame: 6 },
  { label: "alert-start", sceneIndex: 5, localFrame: 0 },
  { label: "alert-entering", sceneIndex: 5, localFrame: 3 },
  { label: "alert-late", sceneIndex: 5, localFrame: 6 },
  { label: "alert-settled", sceneIndex: 5, localFrame: 10 },
  { label: "end-card", sceneIndex: 6, localFrame: 6 },
];

let server: RunningServer | undefined;
let projectDirectory = "";
let project: Project;

type VisualBox = { x: number; y: number; width: number; height: number };

function speech(sceneId: string, narrationText: string, durationMs: number) {
  return {
    path: `speech/${sceneId}.mp3`,
    durationMs,
    sourceTextHash: `sha256:${createHash("sha256").update(narrationText).digest("hex")}`,
    ttsProfileId: "narracut-mandarin-news-v1",
  };
}

function scene(index: number, narrationText: string, visual: Scene["visual"]): Scene {
  return {
    id: sceneIds[index],
    narration: { text: narrationText },
    speech: speech(sceneIds[index], narrationText, SCENE_DURATIONS_MS[index]),
    visual,
    transition: "cut",
  };
}

function visualProject(): Project {
  return {
    schemaVersion: 3,
    metadata: { name: "Preview Render 逐帧视觉证据" },
    theme: {
      presetId: "narracut/default@1",
      defaultTextStyleId: "narracut/panel@1",
      defaultTextMotionId: "narracut/none@1",
      accentColor: "#00A3A6",
      fontId: "narracut/noto-sans-cjk-sc@1",
    },
    assets: [
      { id: imageAssetId, kind: "image", path: "assets/visual-evidence.png" },
      { id: videoAssetId, kind: "video", path: "assets/visual-evidence.mp4" },
    ],
    scenes: [
      scene(0, "常规中文 Subtitle 描边", {
        type: "card",
        label: "TITLE · 字重 700",
        title: "密笔画中文 鬱鬚龘 · 字重 900",
        body: "正文使用 400 字重，并验证同一字体文件下的稳定换行。",
        textStyleId: "narracut/spotlight@1",
        textMotionId: "narracut/none@1",
      }),
      scene(1, "Image Scene 的 Subtitle", {
        type: "image",
        assetId: imageAssetId,
      }),
      scene(2, "这是一段必须在固定安全区内稳定换行的长 Subtitle，包含常规中文和密笔画中文鬱鬚龘；Player 与最终 MP4 必须使用同一字体、描边、阴影、行高与断行位置，不能因为编码或渲染路径不同而分叉。", {
        type: "image",
        assetId: imageAssetId,
        caption: {
          text: "Image + Caption：密笔画中文鬱鬚龘与常规中文在固定宽度内换行一致。",
          textStyleId: "narracut/lower-third@1",
          textMotionId: "narracut/none@1",
        },
      }),
      scene(3, "Video Scene 的 Subtitle", {
        type: "video",
        assetId: videoAssetId,
      }),
      scene(4, "Step Caption 的 Subtitle", {
        type: "video",
        assetId: videoAssetId,
        caption: {
          text: "Step Caption：先关闭阀门，再连接管路。",
          textStyleId: "narracut/panel@1",
          textMotionId: "narracut/none@1",
        },
      }),
      scene(5, "Alert Caption 的 Subtitle", {
        type: "video",
        assetId: videoAssetId,
        caption: {
          text: "Alert Caption：高温区域，请勿触碰。",
          textStyleId: "narracut/lower-third@1",
          textMotionId: "narracut/rise@1",
        },
      }),
      scene(6, "End Card 的 Subtitle", {
        type: "card",
        label: "END CARD · 字重 700",
        title: "检查完成 · 字重 900",
        body: "正文 400：逐帧证据已覆盖字体、换行、描边与 Cut。",
        items: ["Player 使用共享 Composition", "最终 MP4 使用真实 renderer"],
        textStyleId: "narracut/spotlight@1",
        textMotionId: "narracut/none@1",
      }),
    ],
  };
}

async function createFixtureFiles(): Promise<void> {
  await mkdir(join(projectDirectory, "assets"), { recursive: true });
  await mkdir(join(projectDirectory, "speech"), { recursive: true });
  await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 3,
      background: "#1f6f78",
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="1920" height="1080"><rect x="160" y="140" width="560" height="340" rx="36" fill="#f59e0b"/><circle cx="1450" cy="360" r="220" fill="#db2777"/><path d="M160 820 L960 540 L1760 820 Z" fill="#172554"/></svg>',
        ),
      },
    ])
    .png()
    .toFile(join(projectDirectory, "assets", "visual-evidence.png"));
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x164e63:size=1920x1080:rate=30:duration=1.2",
    "-vf", "drawbox=x=mod(t*300\\,1600):y=220:w=320:h=320:color=0xf59e0b:t=fill,drawbox=x=1180:y=560:w=560:h=260:color=0xdb2777:t=fill",
    "-an", "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1",
    "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart",
    join(projectDirectory, "assets", "visual-evidence.mp4"),
  ]);
  const speechFixtures = new Map<number, string>();
  await Promise.all([...new Set(SCENE_DURATIONS_MS)].map(async (durationMs) => {
    const speechFixture = join(projectDirectory, "speech", `fixture-${durationMs}.mp3`);
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "anullsrc=r=32000:cl=mono",
      "-t", String(durationMs / 1000), "-b:a", "64k", speechFixture,
    ]);
    speechFixtures.set(durationMs, speechFixture);
  }));
  await Promise.all(sceneIds.map((id, index) =>
    copyFile(
      speechFixtures.get(SCENE_DURATIONS_MS[index])!,
      join(projectDirectory, "speech", `${id}.mp3`),
    ),
  ));
  await writeFile(join(projectDirectory, "project.json"), `${JSON.stringify(project)}\n`);
}

async function seekToFrame(page: Page, frame: number) {
  const slider = page.getByRole("slider", { name: "项目播放进度" });
  await slider.fill(String(frame), { force: true });
  await expect(slider).toHaveValue(String(frame));
  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
  }));
}

function comparisonRegion(
  name: string,
  box: VisualBox,
  maxDifferentPixelRatio: number,
): VisualComparisonRegion {
  return {
    name,
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    maxDifferentPixelRatio,
  };
}

function targetFrame(target: VisualTarget): number {
  return SCENE_START_FRAMES[target.sceneIndex] + target.localFrame;
}

test.use({ viewport: { width: 2000, height: 1200 } });

test.beforeAll(async () => {
  projectDirectory = await mkdtemp(join(tmpdir(), "narracut-preview-render-"));
  project = visualProject();
  await createFixtureFiles();
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
    if (projectDirectory !== "") {
      await rm(projectDirectory, { recursive: true, force: true });
    }
  }
});

test("真实 Player 与最终 H.264 MP4 在指定 Scene 和帧保持视觉一致", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto(server!.url);
  await expect(page.getByTestId("player-visual")).toBeVisible();
  await expect(page.getByTestId("player-scene-state")).toContainText("Speech · 0.4s");
  await expect(page.getByRole("slider", { name: "项目播放进度" }))
    .toHaveAttribute("max", String(TOTAL_FRAMES - 1));
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

  const previewPaths = new Map<string, string>();
  const comparisonRegions = new Map<string, VisualComparisonRegion[]>();
  const alertBoxes = new Map<string, VisualBox>();
  const alertBlockPaths = new Map<string, string>();
  for (const target of targets) {
    const frame = targetFrame(target);
    await seekToFrame(page, frame);
    const visual = page.getByTestId("player-visual");
    await expect(visual).toHaveAttribute("data-scene-id", sceneIds[target.sceneIndex]);
    if (target.sceneIndex >= 3 && target.sceneIndex <= 5) {
      await expect(page.getByTestId("media-asset")).toHaveAttribute("data-media-status", "ready");
    }
    await expect.poll(async () => visual.boundingBox()).toMatchObject({
      width: 1920,
      height: 1080,
    });
    const regions: VisualComparisonRegion[] = [];
    const subtitleBox = await page.getByTestId("player-subtitle").boundingBox();
    expect(subtitleBox).not.toBeNull();
    regions.push(comparisonRegion(
      "Subtitle",
      subtitleBox!,
      H264_MAX_SUBTITLE_DIFFERENT_PIXEL_RATIO,
    ));
    const textBlock = page.getByTestId("composition-text-block");
    if (await textBlock.count() === 1) {
      const textBlockBox = await textBlock.boundingBox();
      expect(textBlockBox).not.toBeNull();
      regions.push(comparisonRegion(
        "Text Block",
        textBlockBox!,
        H264_MAX_TEXT_BLOCK_DIFFERENT_PIXEL_RATIO,
      ));
      if (target.sceneIndex === 5) {
        alertBoxes.set(target.label, textBlockBox!);
        const alertBlockPath = testInfo.outputPath(`alert-block-${target.label}.png`);
        await page.screenshot({ path: alertBlockPath, clip: textBlockBox! });
        alertBlockPaths.set(target.label, alertBlockPath);
      }
    }
    if (target.label === "image-caption") {
      expect(subtitleBox!.height, "长 Subtitle 必须形成至少两行").toBeGreaterThan(100);
    }
    comparisonRegions.set(target.label, regions);
    const previewPath = testInfo.outputPath(`preview-${target.label}-frame-${frame}.png`);
    await visual.screenshot({ path: previewPath, animations: "allow" });
    previewPaths.set(target.label, previewPath);
  }

  for (const [startLabel, settledLabel, sceneIndex] of [
    ["title-start", "title", 0],
    ["image-caption-start", "image-caption", 2],
  ] as const) {
    const staticResult = await compareVisualFrames(
      previewPaths.get(startLabel)!,
      previewPaths.get(settledLabel)!,
      {
        sceneId: sceneIds[sceneIndex],
        frame: SCENE_START_FRAMES[sceneIndex],
        channelThreshold: 0,
        maxDifferentPixelRatio: 0,
        artifactDirectory: testInfo.outputPath("visual-diffs"),
      },
    );
    expect(staticResult.differentPixels).toBe(0);
  }

  const alertStart = alertBoxes.get("alert-start")!;
  const alertEntering = alertBoxes.get("alert-entering")!;
  const alertLate = alertBoxes.get("alert-late")!;
  const alertSettled = alertBoxes.get("alert-settled")!;
  expect(alertStart.y - alertSettled.y).toBeCloseTo(16, 0);
  expect(alertEntering.y).toBeGreaterThan(alertLate.y);
  expect(alertLate.y).toBeGreaterThan(alertSettled.y + 0.001);
  expect(alertSettled.y).toBeCloseTo(560, 0);
  const alertFade = await compareVisualFrames(
    alertBlockPaths.get("alert-start")!,
    alertBlockPaths.get("alert-settled")!,
    {
      sceneId: sceneIds[5],
      frame: SCENE_START_FRAMES[5],
      channelThreshold: 0,
      maxDifferentPixelRatio: 1,
      artifactDirectory: testInfo.outputPath("visual-diffs"),
    },
  );
  expect(alertFade.differentPixelRatio, "Alert 必须从透明状态淡入").toBeGreaterThan(0.1);

  const output = testInfo.outputPath("final-render.mp4");
  const availability = Object.fromEntries([
    ["assets/visual-evidence.png", true],
    ["assets/visual-evidence.mp4", true],
    ...sceneIds.map((id) => [`speech/${id}.mp3`, true] as const),
  ]);
  const snapshot = createRenderSnapshot(
    project,
    `${server!.url}/media/`,
    availability,
  );
  await renderProjectSnapshot(snapshot, output);

  for (const target of targets) {
    const frame = targetFrame(target);
    const decodedPath = testInfo.outputPath(`render-${target.label}-frame-${frame}.png`);
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-i", output,
      "-vf", `select=eq(n\\,${frame})`,
      "-vsync", "0", "-frames:v", "1", decodedPath,
    ]);
    const result = await compareVisualFrames(
      previewPaths.get(target.label)!,
      decodedPath,
      {
        sceneId: sceneIds[target.sceneIndex],
        frame,
        channelThreshold: H264_CHANNEL_THRESHOLD,
        maxDifferentPixelRatio: H264_MAX_DIFFERENT_PIXEL_RATIO,
        artifactDirectory: testInfo.outputPath("visual-diffs"),
        regions: comparisonRegions.get(target.label),
      },
    );
    expect(
      result.differentPixelRatio,
      `Scene ${sceneIds[target.sceneIndex]} · 帧 ${frame}`,
    ).toBeLessThanOrEqual(H264_MAX_DIFFERENT_PIXEL_RATIO);
  }
});

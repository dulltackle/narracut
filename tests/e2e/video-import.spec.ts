import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { startNarracutServer, type RunningServer } from "../../src/server/server";

const execFileAsync = promisify(execFile);
const sceneId = "80000000-0000-4000-8000-000000000001";
let server: RunningServer;
let projectDirectory: string;
let source: string;

test.beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "narracut-video-e2e-"));
  projectDirectory = join(root, "project");
  const sourceDirectory = join(root, "sources");
  await mkdir(join(projectDirectory, "assets"), { recursive: true });
  await mkdir(join(projectDirectory, "speech"), { recursive: true });
  await mkdir(sourceDirectory);
  source = join(sourceDirectory, "scene-red.mp4");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=1920x1080:r=30:d=0.2",
    "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1",
    "-pix_fmt", "yuv420p", "-r", "30", "-fps_mode", "cfr",
    "-color_range", "tv", "-colorspace", "bt709", "-color_trc", "bt709", "-color_primaries", "bt709",
    "-an", "-movflags", "+faststart", source,
  ]);
  const narration = "视频画面应冻结到旁白结束";
  const speechPath = `speech/${sceneId}.mp3`;
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=32000",
    "-t", "0.8", "-ac", "1", "-b:a", "64k",
    join(projectDirectory, speechPath),
  ]);
  const project = {
    schemaVersion: 3,
    metadata: { name: "视频导入闭环" },
    theme: {
      presetId: "narracut/default@1",
      defaultTextStyleId: "narracut/panel@1",
      defaultTextMotionId: "narracut/fade@1",
      accentColor: "#00A3A6",
      fontId: "narracut/noto-sans-cjk-sc@1",
    },
    assets: [],
    scenes: [{
      id: sceneId,
      narration: { text: narration },
      speech: {
        path: speechPath,
        durationMs: 800,
        sourceTextHash: `sha256:${createHash("sha256").update(narration).digest("hex")}`,
        ttsProfileId: "narracut-mandarin-news-v1",
      },
      visual: { type: "video" },
      transition: "cut",
    }],
  };
  await writeFile(join(projectDirectory, "project.json"), `${JSON.stringify(project)}\n`);
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    host: "127.0.0.1",
    initialPort: 0,
    openDirectory: async () => undefined,
  });
});

test.afterEach(async () => server.close());

test("从 Scene 行导入视频后，Player 与最终 MP4 使用同一规范化 Asset 并冻结末帧", async ({ page }) => {
  await page.goto(server.url);
  await page.getByLabel("为 Scene 1 选择视频").setInputFiles(source);

  const row = page.getByTestId("scene-row");
  await expect(row.getByText("scene-red.mp4")).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText("Video · 1920×1080")).toBeVisible();
  await expect(page.locator('[data-testid="media-asset"][data-media-kind="video"]')).toBeVisible({ timeout: 30_000 });
  const saved = JSON.parse(await readFile(join(projectDirectory, "project.json"), "utf8"));
  expect(saved.assets).toEqual([expect.objectContaining({ kind: "video", path: expect.stringMatching(/^assets\/.+\.mp4$/) })]);
  expect(saved.scenes[0].visual.assetId).toBe(saved.assets[0].id);

  await page.getByRole("button", { name: "渲染 MP4" }).click();
  await expect(page.getByRole("button", { name: "渲染完成" })).toBeVisible({ timeout: 120_000 });

  const renderDirectory = join(projectDirectory, "renders", (await readdir(join(projectDirectory, "renders")))[0]);
  const snapshot = JSON.parse(await readFile(join(renderDirectory, "project.snapshot.json"), "utf8"));
  expect(snapshot.scenes[0].visual.assetId).toBe(saved.assets[0].id);
  expect(snapshot.assets[0].path).toBe(saved.assets[0].path);

  const { stdout: pixel } = await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-ss", "0.7",
    "-i", join(renderDirectory, "out.mp4"),
    "-vf", "crop=2:2:960:300", "-frames:v", "1",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ], { encoding: "buffer", maxBuffer: 1024 * 1024 });
  expect(pixel[0]).toBeGreaterThan(180);
  expect(pixel[1]).toBeLessThan(80);
  expect(pixel[2]).toBeLessThan(80);
});

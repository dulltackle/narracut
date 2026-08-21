import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { runRemotionCli } from "../../src/server/video-media";
import { DEFAULT_PROJECT_THEME, type Project } from "../../src/shared/project";
import { compareVisualFrames } from "../support/visual-comparison";
import { preflightPublicE2E } from "../support/public-e2e";

const narration = "Narracut 公开浏览器验收。";

type RunningCli = {
  child: ChildProcessWithoutNullStreams;
  url: string;
  output: () => string;
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
      const error = new Error(`真实启动命令超时：${redactSecret(output, apiKey)}`);
      void stopCli({ child, url: "", output: () => output })
        .catch(() => undefined)
        .finally(() => reject(error));
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

async function generateVideo(
  sourceFrame: string,
  output: string,
  options: { codec: "h264" | "hevc" | "vp9"; duration: number },
): Promise<void> {
  const codecArgs = options.codec === "h264"
    ? ["-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1", "-pix_fmt", "yuv420p"]
    : options.codec === "hevc"
      ? ["-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error:pools=1:frame-threads=1", "-tag:v", "hvc1", "-pix_fmt", "yuv420p"]
      : ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-pix_fmt", "yuv420p"];
  await runRemotionCli("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-loop", "1", "-framerate", "30", "-i", sourceFrame,
    "-t", String(options.duration),
    ...codecArgs,
    "-an", output,
  ], { timeoutMs: 120_000 });
}

async function createPublicSources(directory: string): Promise<Record<string, string>> {
  await mkdir(directory, { recursive: true });
  const smallVideoFrame = join(directory, "公开视频帧-640x360.png");
  const largeVideoFrame = join(directory, "公开视频帧-1280x720.png");
  const sources = {
    png: join(directory, "公开低分辨率.png"),
    jpeg: join(directory, "公开照片.jpg"),
    webp: join(directory, "公开插图.webp"),
    h264: join(directory, "公开-H264.mp4"),
    hevc: join(directory, "公开-HEVC.mov"),
    cancellable: join(directory, "公开-取消-HEVC.mov"),
    invalid: join(directory, "公开-不合规.mp4"),
  };
  await sharp({
    create: { width: 320, height: 180, channels: 4, background: { r: 22, g: 148, b: 132, alpha: 0.7 } },
  }).png().toFile(sources.png);
  await sharp({
    create: { width: 1920, height: 1080, channels: 3, background: { r: 190, g: 80, b: 40 } },
  }).jpeg().toFile(sources.jpeg);
  await sharp({
    create: { width: 1920, height: 1080, channels: 3, background: { r: 47, g: 73, b: 110 } },
  }).webp().toFile(sources.webp);
  await sharp({
    create: { width: 640, height: 360, channels: 3, background: { r: 32, g: 96, b: 160 } },
  }).png().toFile(smallVideoFrame);
  await sharp({
    create: { width: 1280, height: 720, channels: 3, background: { r: 28, g: 118, b: 96 } },
  }).png().toFile(largeVideoFrame);
  await generateVideo(smallVideoFrame, sources.h264, { codec: "h264", duration: 0.4 });
  await generateVideo(largeVideoFrame, sources.hevc, { codec: "hevc", duration: 0.4 });
  await generateVideo(largeVideoFrame, sources.cancellable, { codec: "hevc", duration: 4 });
  await generateVideo(smallVideoFrame, sources.invalid, { codec: "vp9", duration: 0.4 });
  return sources;
}

async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("save-status")).toContainText("已保存", { timeout: 15_000 });
}

function rowById(page: Page, sceneId: string) {
  return page.locator(`[data-scene-id="${sceneId}"]`);
}

async function selectRow(page: Page, sceneId: string): Promise<void> {
  await rowById(page, sceneId).getByRole("button", { name: /选择并预览 Scene/u }).click();
}

async function waitForSceneAsset(
  projectFile: string,
  sceneId: string,
  previousAssetId?: string,
): Promise<string> {
  let assetId = "";
  await expect.poll(async () => {
    const project = JSON.parse(await readFile(projectFile, "utf8")) as Project;
    const scene = project.scenes.find((candidate) => candidate.id === sceneId);
    assetId = scene !== undefined && "assetId" in scene.visual
      ? scene.visual.assetId ?? ""
      : "";
    return assetId;
  }).not.toBe(previousAssetId ?? "");
  return assetId;
}

async function switchToCard(page: Page, sceneId: string, title: string): Promise<void> {
  await rowById(page, sceneId).getByRole("combobox").selectOption("card");
  const dialog = page.getByRole("dialog", { name: "填写文字卡片内容" });
  await dialog.getByRole("textbox", { name: "卡片标题" }).fill(title);
  await dialog.getByRole("button", { name: "创建文字卡片" }).click();
}

async function addCaption(
  page: Page,
  sceneId: string,
  text: string,
  styleName: string,
  motionName: string,
): Promise<void> {
  await selectRow(page, sceneId);
  await page.getByRole("button", { name: "添加画面说明" }).click();
  const dialog = page.getByRole("dialog", { name: "添加画面说明" });
  await dialog.getByRole("textbox", { name: "说明文字" }).fill(text);
  await dialog.getByRole("button", { name: "添加画面说明" }).click();
  await page.getByRole("button", { name: `场景文字样式：${styleName}` }).click();
  await page.getByRole("button", { name: `场景入场动画：${motionName}` }).click();
}

async function extractFrame(video: string, frame: number, output: string): Promise<void> {
  await runRemotionCli("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", video,
    "-ss", (frame / 30).toFixed(6), "-frames:v", "1", output,
  ], { timeoutMs: 60_000 });
}

async function assertNormalizedAssets(projectDirectory: string, project: Project): Promise<void> {
  const imageAssets = project.assets.filter((asset) => asset.kind === "image");
  const videoAssets = project.assets.filter((asset) => asset.kind === "video");
  expect(imageAssets.length).toBeGreaterThanOrEqual(3);
  expect(videoAssets).toHaveLength(2);
  for (const asset of imageAssets) {
    await expect(sharp(join(projectDirectory, asset.path)).metadata()).resolves.toMatchObject({
      width: 1920,
      height: 1080,
      format: "png",
    });
  }
  for (const asset of videoAssets) {
    const { stdout } = await runRemotionCli("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,color_range,color_space",
      "-of", "json", join(projectDirectory, asset.path),
    ]);
    const stream = JSON.parse(stdout.toString("utf8")).streams[0] as Record<string, unknown>;
    expect(stream).toMatchObject({
      codec_name: "h264",
      width: 1920,
      height: 1080,
      pix_fmt: "yuv420p",
      r_frame_rate: "30/1",
      color_range: "tv",
      color_space: "bt709",
    });
    expect(["High", "100"]).toContain(String(stream.profile));
  }
}

async function filesContaining(root: string, secret: string): Promise<string[]> {
  const matches: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
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

let cli: RunningCli | undefined;
let temporaryRoot = "";

test.afterEach(async () => {
  await stopCli(cli);
  cli = undefined;
  if (temporaryRoot !== "") await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = "";
});

test("从空项目跑通公开合成素材、真实 Speech、诊断修复与两次渲染", async ({ page }, testInfo) => {
  const { apiKey } = await preflightPublicE2E({ envFile: resolve(".env") });
  temporaryRoot = await mkdtemp(join(tmpdir(), "narracut-public-journey-"));
  const projectDirectory = join(temporaryRoot, "project");
  const projectFile = join(projectDirectory, "project.json");
  const sources = await createPublicSources(join(temporaryRoot, "sources"));
  await mkdir(projectDirectory);
  await writeFile(
    projectFile,
    `${JSON.stringify({ schemaVersion: 3, metadata: { name: "公开 E2E" }, theme: DEFAULT_PROJECT_THEME, assets: [], scenes: [] })}\n`,
  );

  const cliOutputs: string[] = [];
  cli = await startCli(projectDirectory, apiKey);
  cliOutputs.push(cli.output());
  await page.goto(cli.url);
  await expect(page.getByRole("heading", { name: "从第一句讲解开始" })).toBeVisible();

  await page.getByRole("button", { name: "粘贴多行 Narration" }).click();
  let dialog = page.getByRole("dialog", { name: "粘贴多行 Narration" });
  await dialog.getByRole("textbox", { name: "原文" }).fill(Array(6).fill(narration).join("\n"));
  await dialog.getByRole("button", { name: "整理拆分" }).click();
  dialog = page.getByRole("dialog", { name: "确认拆分结果" });
  await dialog.getByRole("button", { name: "创建 Scene", exact: true }).click();
  await expect(page.getByTestId("scene-row")).toHaveCount(6);

  await page.getByRole("button", { name: "新增一条", exact: true }).click();
  await page.getByRole("textbox", { name: "Scene 7 Narration" }).fill(narration);
  await page.getByRole("textbox", { name: "Scene 7 Narration" }).blur();
  await page.getByRole("button", { name: "删除 Scene 7" }).click();
  await page.getByRole("button", { name: "撤销：删除 Scene 07" }).click();
  await expect(page.getByTestId("scene-row")).toHaveCount(7);
  await page.getByRole("button", { name: "重做：删除 Scene 07" }).click();
  await expect(page.getByTestId("scene-row")).toHaveCount(6);
  await waitForSaved(page);

  let project = JSON.parse(await readFile(projectFile, "utf8")) as Project;
  const sceneIds = project.scenes.map((scene) => scene.id);
  await switchToCard(page, sceneIds[0], "公开旅程标题");
  await rowById(page, sceneIds[1]).getByRole("combobox").selectOption("image");
  await rowById(page, sceneIds[2]).getByRole("combobox").selectOption("image");
  await switchToCard(page, sceneIds[5], "公开旅程结束");
  await addCaption(page, sceneIds[2], "Step：先检查连接。", "下部标题", "无进场");
  await addCaption(page, sceneIds[4], "Alert：高温区域，请勿触碰。", "聚焦", "向上进入");
  await selectRow(page, sceneIds[5]);
  await page.getByRole("button", { name: "添加列表项" }).click();
  await page.getByRole("textbox", { name: "列表项 1" }).fill("验收完成");
  await page.getByRole("textbox", { name: "列表项 1" }).blur();

  const reorder = rowById(page, sceneIds[0]).getByRole("button", { name: /重排 Scene/u });
  await reorder.focus();
  await reorder.press("Space");
  await reorder.press("ArrowDown");
  await reorder.press("Enter");
  await waitForSaved(page);
  project = JSON.parse(await readFile(projectFile, "utf8")) as Project;
  expect(project.scenes[1].id).toBe(sceneIds[0]);

  await page.goto("about:blank");
  cliOutputs[0] = cli.output();
  await stopCli(cli);
  cli = await startCli(projectDirectory, apiKey);
  cliOutputs.push(cli.output());
  await page.goto(cli.url);
  await expect(page.getByTestId("scene-row")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeDisabled();

  const firstSceneId = (JSON.parse(await readFile(projectFile, "utf8")) as Project).scenes[0].id;
  const firstRow = rowById(page, firstSceneId);
  await firstRow.getByRole("button", { name: "生成 Speech", exact: true }).click();
  await expect(firstRow.getByText("已生成 · 可撤销")).toBeVisible({ timeout: 90_000 });
  await waitForSaved(page);

  await page.goto("about:blank");
  cliOutputs[1] = cli.output();
  await stopCli(cli);
  project = JSON.parse(await readFile(projectFile, "utf8")) as Project;
  const generated = project.scenes.find((scene) => scene.id === firstSceneId)!;
  expect(generated.speech).toBeDefined();
  for (const scene of project.scenes) {
    if (scene.id === firstSceneId) continue;
    const path = `speech/${scene.id}.mp3`;
    await copyFile(
      join(projectDirectory, generated.speech!.path),
      join(projectDirectory, path),
    );
    scene.speech = { ...generated.speech!, path };
  }
  await writeFile(projectFile, `${JSON.stringify(project)}\n`);

  cli = await startCli(projectDirectory, apiKey);
  cliOutputs.push(cli.output());
  await page.goto(cli.url);
  await expect(page.getByRole("button", { name: /^检查并渲染/u })).toBeVisible();

  const imageRow = rowById(page, sceneIds[1]);
  let failFirstImageRequest = true;
  await page.route("**/api/jobs/image-import", async (route) => {
    if (failFirstImageRequest) {
      failFirstImageRequest = false;
      await route.fulfill({ status: 503, body: "公开入口模拟失败" });
      return;
    }
    await route.continue();
  });
  await imageRow.getByLabel(/为 Scene \d+ 选择图片/u).setInputFiles(sources.jpeg);
  await expect(imageRow.getByText("公开入口模拟失败")).toBeVisible();
  await imageRow.getByRole("button", { name: "重试导入 公开照片.jpg" }).click();
  await expect(imageRow.getByText("公开照片.jpg")).toBeVisible({ timeout: 30_000 });
  const jpegAssetId = await waitForSceneAsset(projectFile, sceneIds[1]);
  await page.unroute("**/api/jobs/image-import");
  await imageRow.getByLabel(/为 Scene \d+ 选择图片/u).setInputFiles(sources.png);
  await expect(imageRow.getByText("公开低分辨率.png")).toBeVisible({ timeout: 30_000 });
  await waitForSceneAsset(projectFile, sceneIds[1], jpegAssetId);
  await expect(imageRow.getByRole("button", { name: "提醒：已放大到 1080p" })).toBeVisible();

  await page.getByRole("button", { name: /^检查并渲染/u }).click();
  await expect(page.locator(".diagnostic-queue-summary")).toContainText("阻断");
  await expect(page.locator(".diagnostic-queue-summary")).toContainText("提醒");
  await page.getByRole("button", { name: "关闭任务抽屉" }).click();

  const secondImageRow = rowById(page, sceneIds[2]);
  await secondImageRow.getByLabel(/为 Scene \d+ 选择图片/u).setInputFiles(sources.webp);
  await expect(secondImageRow.getByText("公开插图.webp")).toBeVisible({ timeout: 30_000 });
  await waitForSceneAsset(projectFile, sceneIds[2]);

  const firstVideoRow = rowById(page, sceneIds[3]);
  let invalidVideoRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/jobs/video-import") && request.method() === "POST") {
      invalidVideoRequests += 1;
    }
  });
  await firstVideoRow.getByLabel(/为 Scene \d+ 选择视频/u).setInputFiles(sources.invalid);
  await expect(firstVideoRow.getByText("视频编码不受支持")).toBeVisible({ timeout: 30_000 });
  await firstVideoRow.getByRole("button", { name: "重试导入 公开-不合规.mp4" }).click();
  await expect.poll(() => invalidVideoRequests).toBeGreaterThanOrEqual(2);
  await expect(firstVideoRow.getByText("视频编码不受支持")).toBeVisible({ timeout: 30_000 });
  await firstVideoRow.getByLabel(/为 Scene \d+ 选择视频/u).setInputFiles(sources.h264);
  await expect(firstVideoRow.getByText("公开-H264.mp4")).toBeVisible({ timeout: 120_000 });
  await waitForSceneAsset(projectFile, sceneIds[3]);
  await expect(firstVideoRow.getByRole("button", { name: "提醒：已放大到 1080p" })).toBeVisible();

  const secondVideoRow = rowById(page, sceneIds[4]);
  await secondVideoRow.getByLabel(/为 Scene \d+ 选择视频/u).setInputFiles(sources.cancellable);
  await secondVideoRow.getByRole("button", { name: "取消导入 公开-取消-HEVC.mov" }).click();
  await expect(secondVideoRow.getByText("已取消 · MP4 或 MOV")).toBeVisible({ timeout: 30_000 });
  await secondVideoRow.getByLabel(/为 Scene \d+ 选择视频/u).setInputFiles(sources.hevc);
  await expect(secondVideoRow.getByText("公开-HEVC.mov")).toBeVisible({ timeout: 120_000 });
  await waitForSceneAsset(projectFile, sceneIds[4]);
  await expect(secondVideoRow.getByRole("button", { name: "提醒：已放大到 1080p" })).toBeVisible();

  await expect(page.getByRole("button", { name: "渲染 MP4" })).toBeVisible({ timeout: 30_000 });
  await selectRow(page, sceneIds[1]);
  await expect(page.locator(".player-media-warning")).toContainText("已放大到 1080p");
  const warningScreenshot = testInfo.outputPath("warning-only-render-ready.png");
  await page.screenshot({ path: warningScreenshot, fullPage: true });

  project = JSON.parse(await readFile(projectFile, "utf8")) as Project;
  expect(project.scenes.map((scene) => scene.visual)).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "card", title: "公开旅程标题" }),
    expect.objectContaining({ type: "image", assetId: expect.any(String) }),
    expect.objectContaining({ type: "image", assetId: expect.any(String), caption: { text: "Step：先检查连接。", textStyleId: "narracut/lower-third@1", textMotionId: "narracut/none@1" } }),
    expect.objectContaining({ type: "video", assetId: expect.any(String) }),
    expect.objectContaining({ type: "video", assetId: expect.any(String), caption: { text: "Alert：高温区域，请勿触碰。", textStyleId: "narracut/spotlight@1", textMotionId: "narracut/rise@1" } }),
    expect.objectContaining({ type: "card", title: "公开旅程结束", items: ["验收完成"] }),
  ]));
  await assertNormalizedAssets(projectDirectory, project);

  const cardSceneIndex = project.scenes.findIndex((scene) => scene.id === sceneIds[0]);
  expect(cardSceneIndex).toBeGreaterThan(0);
  const sceneFrames = (scene: Project["scenes"][number]) =>
    Math.max(1, Math.ceil(((scene.speech?.durationMs ?? 5_000) / 1_000) * 30));
  const cardStartFrame = project.scenes
    .slice(0, cardSceneIndex)
    .reduce((total, scene) => total + sceneFrames(scene), 0);
  const comparisonFrame = cardStartFrame + Math.min(10, sceneFrames(project.scenes[cardSceneIndex]) - 1);
  await selectRow(page, sceneIds[0]);
  const slider = page.getByRole("slider", { name: "项目播放进度" });
  await slider.fill(String(comparisonFrame), { force: true });
  const previewStyle = await page.addStyleTag({ content: `
    html, body, #root { min-width: 2000px !important; min-height: 1200px !important; }
    .preview-frame.remotion-preview { position: fixed !important; z-index: 2147483647 !important; inset: 0 auto auto 0 !important; width: 1920px !important; height: 1080px !important; max-height: none !important; border-radius: 0 !important; }
  ` });
  const firstPreview = testInfo.outputPath(`render-1-memory-preview-frame-${comparisonFrame}.png`);
  await page.getByTestId("player-visual").screenshot({ path: firstPreview });
  await previewStyle.evaluate((element) => element.parentNode?.removeChild(element));

  await page.getByRole("button", { name: "渲染 MP4" }).click();
  await expect(page.getByRole("button", { name: /正在启动|正在复核|正在加载|正在渲染/u })).toBeDisabled();
  await page.getByRole("button", { name: "关闭任务抽屉" }).click();
  await selectRow(page, sceneIds[0]);
  await page.getByRole("textbox", { name: "卡片标题" }).fill("渲染期间编辑的新标题");
  await page.getByRole("textbox", { name: "卡片标题" }).blur();
  await expect(page.getByRole("button", { name: "渲染完成" })).toBeVisible({ timeout: 180_000 });
  await waitForSaved(page);

  let renderDirectories = (await readdir(join(projectDirectory, "renders"))).sort();
  expect(renderDirectories).toHaveLength(1);
  const firstRenderDirectory = join(projectDirectory, "renders", renderDirectories[0]);
  const firstSnapshot = JSON.parse(await readFile(join(firstRenderDirectory, "project.snapshot.json"), "utf8")) as Project;
  expect(firstSnapshot.scenes.find((scene) => scene.id === sceneIds[0])?.visual)
    .toMatchObject({ type: "card", title: "公开旅程标题" });
  const firstFrame = testInfo.outputPath(`render-1-frame-${comparisonFrame}.png`);
  await extractFrame(join(firstRenderDirectory, "out.mp4"), comparisonFrame, firstFrame);
  const previewComparison = await compareVisualFrames(firstPreview, firstFrame, {
    sceneId: sceneIds[0],
    frame: comparisonFrame,
    channelThreshold: 30,
    maxDifferentPixelRatio: 0.02,
    artifactDirectory: testInfo.outputPath("visual-diffs"),
  });
  expect(previewComparison.differentPixelRatio).toBeLessThanOrEqual(0.02);

  await page.reload();
  await expect(page.getByRole("button", { name: "渲染 MP4" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "渲染 MP4" }).click();
  await expect(page.getByRole("button", { name: "渲染完成" })).toBeVisible({ timeout: 180_000 });
  renderDirectories = (await readdir(join(projectDirectory, "renders"))).sort();
  expect(renderDirectories).toHaveLength(2);
  const secondRenderDirectory = join(projectDirectory, "renders", renderDirectories[1]);
  const secondSnapshot = JSON.parse(await readFile(join(secondRenderDirectory, "project.snapshot.json"), "utf8")) as Project;
  expect(secondSnapshot.scenes.find((scene) => scene.id === sceneIds[0])?.visual)
    .toMatchObject({ type: "card", title: "渲染期间编辑的新标题" });
  const secondFrame = testInfo.outputPath(`render-2-frame-${comparisonFrame}.png`);
  await extractFrame(join(secondRenderDirectory, "out.mp4"), comparisonFrame, secondFrame);
  const [firstPixels, secondPixels] = await Promise.all([
    sharp(firstFrame).removeAlpha().raw().toBuffer(),
    sharp(secondFrame).removeAlpha().raw().toBuffer(),
  ]);
  expect(firstPixels.equals(secondPixels)).toBe(false);

  for (const directory of [firstRenderDirectory, secondRenderDirectory]) {
    expect((await readdir(directory)).sort()).toEqual([".media", "out.mp4", "project.snapshot.json", "render.log"]);
    const { stdout } = await runRemotionCli("ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate",
      "-of", "json", join(directory, "out.mp4"),
    ]);
    const streams = JSON.parse(stdout.toString("utf8")).streams as Array<Record<string, unknown>>;
    expect(streams).toEqual(expect.arrayContaining([
      expect.objectContaining({ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "30/1" }),
      expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
    ]));
    expect(streams.filter((stream) => stream.codec_type === "audio")).toHaveLength(1);
  }
  const speechProbe = await runRemotionCli("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_name:format=duration",
    "-of", "json", join(projectDirectory, project.scenes[0].speech!.path),
  ]);
  expect(JSON.parse(speechProbe.stdout.toString("utf8")).streams).toEqual([
    expect.objectContaining({ codec_name: "mp3" }),
  ]);

  cliOutputs[2] = cli.output();
  const visibleText = await page.locator("body").innerText();
  expect(
    visibleText.includes(apiKey),
    "页面可见文本不得包含 TokenDance key",
  ).toBe(false);
  expect(
    cliOutputs.some((output) => output.includes(apiKey)),
    "CLI 输出不得包含 TokenDance key",
  ).toBe(false);
  expect(await filesContaining(projectDirectory, apiKey)).toEqual([]);
  expect(await filesContaining(testInfo.outputDir, apiKey)).toEqual([]);
});

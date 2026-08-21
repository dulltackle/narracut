import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { startNarracutServer, type RunningServer } from "../../src/server/server";
import type { Project } from "../../src/shared/project";

let server: RunningServer;
let projectDirectory: string;
let projectFile: string;

const sceneIds = [
  "40000000-0000-4000-8000-000000000001",
  "40000000-0000-4000-8000-000000000002",
];
const imageAssetId = "41000000-0000-4000-8000-000000000001";
const videoAssetId = "41000000-0000-4000-8000-000000000002";

const theme = {
  presetId: "narracut/default@1",
  defaultTextStyleId: "narracut/panel@1",
  defaultTextMotionId: "narracut/fade@1",
  accentColor: "#00A3A6",
  fontId: "narracut/noto-sans-cjk-sc@1",
};

function projectWithAssets(): Project {
  return {
    schemaVersion: 3,
    metadata: { name: "Asset 预览验收" },
    theme,
    assets: [
      { id: imageAssetId, kind: "image", path: "assets/still.png" },
      { id: videoAssetId, kind: "video", path: "assets/short.mp4" },
    ],
    scenes: [
      {
        id: sceneIds[0],
        narration: { text: "保持当前编辑上下文" },
        visual: { type: "card", title: "当前 Scene" },
        transition: "cut",
      },
      {
        id: sceneIds[1],
        narration: { text: "检查绑定图片" },
        visual: {
          type: "image",
          assetId: imageAssetId,
          caption: { text: "不应出现在 Asset 预览中" },
        },
        transition: "cut",
      },
    ],
  };
}

async function writeProject(project: Project) {
  await writeFile(projectFile, `${JSON.stringify(project)}\n`);
}

test.beforeAll(async () => {
  projectDirectory = await mkdtemp(join(tmpdir(), "narracut-asset-preview-e2e-"));
  projectFile = join(projectDirectory, "project.json");
  await mkdir(join(projectDirectory, "assets"));
  await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 3,
      background: { r: 22, g: 148, b: 132 },
    },
  })
    .png()
    .toFile(join(projectDirectory, "assets", "still.png"));
  const shortVideoBase64 = await readFile(
    resolve("tests/fixtures/short-video.mp4.b64"),
    "utf8",
  );
  await writeFile(
    join(projectDirectory, "assets", "short.mp4"),
    Buffer.from(shortVideoBase64.trim(), "base64"),
  );
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      writeFile(
        join(projectDirectory, "assets", `short-${String(index + 1).padStart(2, "0")}.mp4`),
        Buffer.from(shortVideoBase64.trim(), "base64"),
      )
    ),
  );
  await writeFile(join(projectDirectory, "assets", "corrupt.mp4"), "not a video");
  await writeProject(projectWithAssets());
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    host: "127.0.0.1",
    initialPort: 0,
  });
});

test.afterAll(async () => {
  await server.close();
});

test.afterEach(async () => {
  await server.releaseProjectLease();
});

test("从完整摘要打开 Image Asset，关闭后恢复焦点且不改变 Scene 与 Player", async ({
  page,
}) => {
  await writeProject(projectWithAssets());
  await page.goto(server.url);

  const trigger = page.getByRole("button", {
    name: "预览 Scene 2 Image Asset still.png",
  });
  await expect(trigger).toContainText("still.png");
  await expect(trigger).toContainText("Image · 1920×1080");
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 01");
  await expect(page.getByRole("slider", { name: "项目播放进度" })).toHaveValue("0");

  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "still.png" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Image");
  await expect(dialog).toContainText("assets/still.png");
  await expect(dialog).not.toContainText("不应出现在 Asset 预览中");
  await expect(dialog.getByRole("img", { name: "still.png" })).toBeVisible();
  await expect(dialog.getByTestId("asset-preview-canvas")).toHaveCSS(
    "aspect-ratio",
    "16 / 9",
  );
  const desktopCanvas = await dialog.getByTestId("asset-preview-canvas").boundingBox();
  expect(desktopCanvas).not.toBeNull();
  expect(desktopCanvas!.width / desktopCanvas!.height).toBeCloseTo(16 / 9, 2);
  await expect(dialog.getByRole("img", { name: "still.png" })).toHaveCSS(
    "object-fit",
    "contain",
  );
  await expect(dialog.getByRole("button", { name: "关闭" })).toBeFocused();
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 01");
  await expect(page.getByTestId("player-playback-state")).toHaveText("已暂停");
  await expect(page.getByRole("slider", { name: "项目播放进度" })).toHaveValue("0");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.getByRole("button", { name: "播放" }).click();
  await expect(page.getByTestId("player-playback-state")).toHaveText("播放中");
  await trigger.press("Space");
  await expect(page.getByRole("dialog", { name: "still.png" })).toBeVisible();
  await expect(page.getByTestId("player-playback-state")).toHaveText("播放中");
  await page.getByRole("dialog", { name: "still.png" }).getByRole("button", { name: "关闭" }).click();
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId("player-playback-state")).toHaveText("播放中");
  await page.getByRole("button", { name: "暂停" }).click();
});

test("已绑定 Video 使用原生控件从首帧预览，关闭后立即停止", async ({ page }) => {
  const project = projectWithAssets();
  project.scenes[1] = {
    id: sceneIds[1],
    narration: { text: "检查绑定视频" },
    visual: {
      type: "video",
      assetId: videoAssetId,
      caption: { text: "视频 Caption 不属于 Asset 本体" },
    },
    transition: "cut",
  };
  await writeProject(project);
  await page.goto(server.url);

  const trigger = page.getByRole("button", {
    name: "预览 Scene 2 Video Asset short.mp4",
  });
  await expect(trigger).toContainText("Video · 1920×1080");
  await expect(page.getByText("本票不提供导入")).toHaveCount(0);
  await trigger.press("Enter");

  const dialog = page.getByRole("dialog", { name: "short.mp4" });
  const video = dialog.locator('video[aria-label="short.mp4"]');
  await expect(video).toBeVisible();
  await expect(video).toHaveJSProperty("controls", true);
  await expect(video).toHaveJSProperty("autoplay", false);
  await expect(video).toHaveJSProperty("loop", false);
  await expect(video).toHaveJSProperty("paused", true);
  await expect(video).toHaveJSProperty("currentTime", 0);
  await expect(dialog).not.toContainText("视频 Caption 不属于 Asset 本体");
  await expect(dialog.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(video).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "关闭" })).toBeFocused();

  await video.evaluate(async (element: HTMLVideoElement) => element.play());
  await expect(video).toHaveJSProperty("paused", false);
  const videoHandle = await video.elementHandle();
  await page.locator(".modal-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  expect(await videoHandle!.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 01");
});

test("视频缩略图按视口和双并发加载首帧，打开预览前不请求原 MP4", async ({ page }) => {
  const assets = Array.from({ length: 12 }, (_, index) => ({
    id: `41000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    kind: "video" as const,
    path: `assets/short-${String(index + 1).padStart(2, "0")}.mp4`,
  }));
  const project: Project = {
    ...projectWithAssets(),
    assets,
    scenes: [
      {
        id: sceneIds[0],
        narration: { text: "首屏保持 Card，不应预加载视频" },
        visual: { type: "card", title: "当前 Scene" },
        transition: "cut",
      },
      ...assets.map((asset, index) => ({
        id: `40000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
        narration: { text: `检查视频 ${index + 1}` },
        visual: { type: "video" as const, assetId: asset.id },
        transition: "cut" as const,
      })),
    ],
  };
  await writeProject(project);
  let activeThumbnails = 0;
  let maxActiveThumbnails = 0;
  let thumbnailRequests = 0;
  const mp4Requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith(".mp4")) mp4Requests.push(request.url());
  });
  await page.route((url) => url.pathname === "/api/assets/thumbnail", async (route) => {
    thumbnailRequests += 1;
    activeThumbnails += 1;
    maxActiveThumbnails = Math.max(maxActiveThumbnails, activeThumbnails);
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50));
    await route.continue();
    activeThumbnails -= 1;
  });

  await page.goto(server.url);
  await expect(page.getByTestId("global-workbench")).toBeVisible();
  await expect.poll(() => thumbnailRequests).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(thumbnailRequests).toBeLessThan(assets.length);
  expect(mp4Requests).toEqual([]);

  const rows = page.getByTestId("scene-row");
  for (let index = 1; index < await rows.count(); index += 1) {
    await rows.nth(index).scrollIntoViewIfNeeded();
  }
  await expect.poll(() => thumbnailRequests).toBe(assets.length);
  await expect(page.locator(".asset-thumbnail-video > img")).toHaveCount(assets.length);
  expect(maxActiveThumbnails).toBeLessThanOrEqual(2);
  expect(mp4Requests).toEqual([]);

  await page.getByRole("button", {
    name: "预览 Scene 2 Video Asset short-01.mp4",
  }).click();
  await expect(page.getByRole("dialog", { name: "short-01.mp4" })).toBeVisible();
  await expect.poll(() => mp4Requests.length).toBeGreaterThan(0);
});

test("文件缺失与媒体解码失败都在同一预览浮窗中明确反馈", async ({ page }) => {
  const missingImageId = "41000000-0000-4000-8000-000000000003";
  const corruptVideoId = "41000000-0000-4000-8000-000000000004";
  const project = projectWithAssets();
  project.assets = [
    { id: missingImageId, kind: "image", path: "assets/missing.png" },
    { id: corruptVideoId, kind: "video", path: "assets/corrupt.mp4" },
  ];
  project.scenes = [
    {
      id: sceneIds[0],
      narration: { text: "缺失图片" },
      visual: { type: "image", assetId: missingImageId },
      transition: "cut",
    },
    {
      id: sceneIds[1],
      narration: { text: "损坏视频" },
      visual: { type: "video", assetId: corruptVideoId },
      transition: "cut",
    },
  ];
  await writeProject(project);
  await page.goto(server.url);

  await page.getByRole("button", { name: /预览 Scene 1 Image Asset missing\.png/ }).click();
  let dialog = page.getByRole("dialog", { name: "missing.png" });
  await expect(dialog.getByRole("alert")).toContainText("Asset 文件不可用");
  await expect(dialog.getByRole("alert")).toContainText("assets/missing.png");
  await dialog.getByRole("button", { name: "关闭" }).click();

  const corruptTrigger = page.getByRole("button", {
    name: /预览 Scene 2 Video Asset corrupt\.mp4/,
  });
  await expect(corruptTrigger.locator('[data-thumbnail-status="error"]')).toBeVisible();
  await corruptTrigger.click();
  dialog = page.getByRole("dialog", { name: "corrupt.mp4" });
  await expect(dialog.getByRole("alert")).toContainText("Asset 文件不可用");
  await expect(dialog.getByRole("alert")).toContainText("assets/corrupt.mp4");
});

test("悬空 Asset ID 只显示诊断，kind 不匹配时按 Asset 真实 kind 预览", async ({ page }) => {
  const danglingId = "41000000-0000-4000-8000-000000000099";
  const project = projectWithAssets();
  project.assets = [{ id: videoAssetId, kind: "video", path: "assets/short.mp4" }];
  project.scenes = [
    {
      id: sceneIds[0],
      narration: { text: "悬空引用" },
      visual: { type: "image", assetId: danglingId },
      transition: "cut",
    },
    {
      id: sceneIds[1],
      narration: { text: "真实 kind 是 Video" },
      visual: { type: "image", assetId: videoAssetId },
      transition: "cut",
    },
  ];
  await writeProject(project);
  await page.goto(server.url);

  await expect(page.getByTestId("global-workbench")).toBeVisible();
  await expect(page.getByTestId("scene-row").nth(0)).toContainText("重新绑定 Asset");
  await expect(page.getByRole("button", { name: /^预览 Scene 1 / })).toHaveCount(0);
  const realKindTrigger = page.getByRole("button", {
    name: "预览 Scene 2 Video Asset short.mp4",
  });
  await expect(realKindTrigger).toBeVisible();
  await realKindTrigger.click();
  const dialog = page.getByRole("dialog", { name: "short.mp4" });
  await expect(dialog).toContainText("Video");
  await expect(dialog.locator("video")).toBeVisible();
});

test("编辑权被占用时预览入口仍可用，编辑动作保持禁用", async ({ browser }) => {
  await writeProject(projectWithAssets());
  const editingContext = await browser.newContext();
  const readonlyContext = await browser.newContext();
  const editingPage = await editingContext.newPage();
  const readonlyPage = await readonlyContext.newPage();
  try {
    await editingPage.goto(server.url);
    await readonlyPage.goto(server.url);
    await expect(readonlyPage.getByTestId("lease-banner")).toBeVisible();
    await expect(readonlyPage.getByRole("textbox", { name: "Scene 2 Narration" })).toBeDisabled();

    const trigger = readonlyPage.getByRole("button", {
      name: "预览 Scene 2 Image Asset still.png",
    });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await expect(readonlyPage.getByRole("dialog", { name: "still.png" })).toBeVisible();
    await readonlyPage.getByRole("button", { name: "关闭" }).click();
    const taskButton = readonlyPage.getByRole("button", { name: /任务/ });
    await expect(taskButton).toBeEnabled();
    await taskButton.click();
    await expect(readonlyPage.getByRole("complementary", { name: "任务与渲染" })).toBeVisible();
  } finally {
    await editingContext.close();
    await readonlyContext.close();
  }
});

test("未来 schema 的只读工作台仍可按安全解析的登记信息预览 Asset", async ({ page }) => {
  const futureProject = {
    ...projectWithAssets(),
    schemaVersion: 4,
    futureField: { preserved: true },
  };
  await writeFile(projectFile, `${JSON.stringify(futureProject)}\n`);
  await page.goto(server.url);

  await expect(page.getByText("需要升级 Narracut 才能编辑")).toBeVisible();
  const trigger = page.getByRole("button", {
    name: "预览 Scene 2 Image Asset still.png",
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "still.png" });
  await expect(dialog.getByRole("img", { name: "still.png" })).toBeVisible();
  await expect(dialog).toContainText("assets/still.png");
});

test("窄视口中浮窗、媒体信息与关闭入口均保持在可用范围内", async ({ page }) => {
  await writeProject(projectWithAssets());
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(server.url);
  await page.getByRole("button", { name: "预览 Scene 2 Image Asset still.png" }).click();

  const dialog = page.getByRole("dialog", { name: "still.png" });
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(700);
  const canvasBox = await dialog.getByTestId("asset-preview-canvas").boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox!.width / canvasBox!.height).toBeCloseTo(16 / 9, 2);
  await expect(dialog.getByText("项目相对路径")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭" })).toBeVisible();
});

test("媒体请求较慢时先显示非阻塞载入进度，再呈现 Asset", async ({ page }) => {
  await writeProject(projectWithAssets());
  let releaseMedia!: () => void;
  const mediaReleased = new Promise<void>((resolvePromise) => {
    releaseMedia = resolvePromise;
  });
  await page.route("**/media/assets/still.png", async (route) => {
    await mediaReleased;
    await route.continue();
  });
  await page.goto(server.url, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "预览 Scene 2 Image Asset still.png" }).click();

  const dialog = page.getByRole("dialog", { name: "still.png" });
  await expect(dialog.getByRole("status")).toContainText("正在载入 Asset");
  releaseMedia();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await expect(dialog.getByRole("img", { name: "still.png" })).toBeVisible();
});

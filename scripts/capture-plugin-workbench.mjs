import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const { handleRequest } = await import("../plugins/narracut/server.mjs");
const resource = await handleRequest({
  jsonrpc: "2.0",
  id: 1,
  method: "resources/read",
  params: { uri: "ui://narracut/workbench-v1.html" },
});
const html = resource.contents[0].text;
const scenes = Array.from({ length: 8 }, (_, offset) => {
  const index = offset + 1;
  return {
    id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    index,
    narration: [
      "在每一个认真生活的日常里，总有一些被忽略的细节。",
      "我们从一只产品开始，重新思考「好用」的定义。",
      "它不张扬，却恰到好处；它懂你所需，更懂你未说出口的期待。",
      "从设计到选材，从体验到细节，我们坚持长期主义的产品信念。",
      "让品质成为习惯，让信任成为日常。",
      "每一次触碰，都回应真实生活里的需要。",
      "没有多余装饰，只留下清楚、可靠的使用体验。",
      "这就是我们想交付的产品，也是一份长期承诺。",
    ][offset],
    assets: index % 3 === 0 ? [] : [{
      id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      path: `assets/scene-${index}.png`,
    }],
    speech: index === 6 ? { status: "missing" } : { status: "available", durationMs: 1800 + index * 120 },
  };
});
const allAssets = scenes.flatMap((scene) => scene.assets);
const workbenchResult = {
  status: "valid",
  connection: { status: "connected", readOnly: false },
  writable: true,
  projectRevision: `sha256:${"1".repeat(64)}`,
  projectDsl: {
    assets: allAssets,
    scenes: scenes.map((scene, index) => ({
      id: scene.id,
      narration: { text: scene.narration },
      assetIds: index === 0 ? allAssets.slice(0, 3).map((asset) => asset.id) : scene.assets.map((asset) => asset.id),
      ...(scene.speech.status === "available" ? {
        speech: {
          path: `speech/${scene.id}.mp3`,
          durationMs: scene.speech.durationMs,
          sourceTextHash: `sha256:${createHash("sha256").update(scene.narration, "utf8").digest("hex")}`,
          ttsProfileId: "narracut/default",
        },
      } : {}),
    })),
  },
  project: {
    directory: "/work/projects/product-demo",
    folderName: "product-demo",
    projectId: "10000000-0000-4000-8000-000000000001",
    sceneCount: scenes.length,
    assetCount: 6,
  },
  checks: {
    manifest: { status: "valid", label: "项目清单" },
    dsl: { status: "valid", label: "Project DSL" },
    videoBrief: { status: "valid", label: "video.md", bytes: 486 },
  },
  scenes,
  assetStates: allAssets.map((asset, index) => ({
    ...asset,
    status: index === 2 ? "unavailable" : "available",
    ...(index === 2 ? { reason: "文件缺失或已被移动。" } : { size: 2_048_000 + index * 64_000 }),
  })),
  warnings: [],
};
const launcherResult = {
  status: "launcher",
  connection: { status: "connected", readOnly: false },
};
const launcher = process.argv.includes("--launcher");
const assetPanel = process.argv.includes("--asset-panel");
const assetPreview = process.argv.includes("--asset-preview");
const result = launcher ? launcherResult : workbenchResult;

await mkdir(resolve(".impeccable/review"), { recursive: true });
const browser = await chromium.launch({ headless: true });
const captures = launcher
  ? [
      { name: "launcher-desktop", width: 1440, height: 900 },
      { name: "launcher-mobile", width: 430, height: 860 },
    ]
  : [
      { name: "hero-repro", width: 1586, height: 992 },
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 430, height: 860 },
      { name: "mobile-menu", width: 430, height: 860, openSceneMenu: true },
    ];
if (assetPanel) captures.splice(0, captures.length,
  { name: "asset-panel-desktop", width: 1440, height: 900, openAssetPanel: true },
  { name: "asset-panel-mobile", width: 430, height: 860, openAssetPanel: true },
);
if (assetPreview) captures.splice(0, captures.length,
  { name: "asset-preview-desktop", width: 1440, height: 900, openAssetPanel: true, openAssetPreview: true },
  { name: "asset-preview-mobile", width: 430, height: 860, openAssetPanel: true, openAssetPreview: true },
);
for (const capture of captures) {
  const page = await browser.newPage({ viewport: { width: capture.width, height: capture.height } });
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  if (capture.openAssetPreview) {
    await page.evaluate(() => {
      window.openai = {
        callTool: (_name, args) => Promise.resolve({ structuredContent: { assetPreview: {
          status: "available",
          id: args.assetId,
          path: "assets/scene-1.png",
          filename: "scene-1.png",
          size: 2048000,
          kind: "image",
          mediaType: "image/png",
          dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        } } }),
      };
    });
  }
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((structuredContent) => window.postMessage({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: { structuredContent },
  }, "*"), result);
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (capture.openSceneMenu) await page.locator(".scene-menu summary").click();
  if (capture.openAssetPanel) await page.locator("[data-open-scene-assets]").first().click();
  if (capture.openAssetPreview) await page.locator("[data-preview-asset]").first().click();
  await page.screenshot({
    path: resolve(`.impeccable/review/${capture.name}.png`),
    animations: "disabled",
  });
  await page.close();
}
await browser.close();

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { startNarracutServer, type RunningServer } from "../../src/server/server";

const sceneId = "80000000-0000-4000-8000-000000000001";
const originalAssetId = "90000000-0000-4000-8000-000000000001";

let server: RunningServer;
let projectDirectory: string;
let projectFile: string;
let sourceDirectory: string;

function projectWithImage(assetId?: string) {
  return {
    schemaVersion: 3,
    metadata: { name: "图片导入验收" },
    theme: {
      presetId: "narracut/default@1",
      defaultTextStyleId: "narracut/panel@1",
      defaultTextMotionId: "narracut/fade@1",
      accentColor: "#00A3A6",
      fontId: "narracut/noto-sans-cjk-sc@1",
    },
    assets:
      assetId === undefined
        ? []
        : [{ id: assetId, kind: "image", path: `assets/${assetId}.png` }],
    scenes: [
      {
        id: sceneId,
        narration: { text: "演示图片导入" },
        visual: {
          type: "image",
          ...(assetId === undefined ? {} : { assetId }),
        },
        transition: "cut",
      },
    ],
  };
}

test.beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "narracut-image-e2e-"));
  projectDirectory = join(root, "project");
  sourceDirectory = join(root, "sources");
  projectFile = join(projectDirectory, "project.json");
  await mkdir(join(projectDirectory, "assets"), { recursive: true });
  await mkdir(sourceDirectory);
  await writeFile(projectFile, `${JSON.stringify(projectWithImage())}\n`);
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    initialPort: 0,
  });
});

test.afterEach(async () => {
  await server.close();
});

test("逐 Scene 导入图片、显示放大提醒，并可清除与撤销绑定", async ({ page }) => {
  const source = join(sourceDirectory, "透明产品图.png");
  await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 4,
      background: { r: 12, g: 150, b: 120, alpha: 0.4 },
    },
  })
    .png()
    .toFile(source);

  await page.goto(server.url);
  await expect(page.getByRole("button", { name: "导入图片" })).toBeVisible();
  await page.getByLabel("为 Scene 1 选择图片").setInputFiles(source);

  const row = page.getByTestId("scene-row");
  await expect(row.getByText("透明产品图.png")).toBeVisible();
  await expect(row.getByText("已放大到 1080p")).toBeVisible();
  await expect(row.getByRole("img", { name: "Scene 1 已绑定图片" })).toBeVisible();
  const preview = row.getByRole("button", {
    name: "预览 Scene 1 Image Asset 透明产品图.png",
  });
  await preview.click();
  await expect(page.getByRole("dialog", { name: "透明产品图.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeFocused();
  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8"))).toMatchObject({
    assets: [{ kind: "image" }],
    scenes: [{ visual: { type: "image", assetId: expect.any(String) } }],
  });

  await row.getByRole("button", { name: "清除 Scene 1 图片绑定" }).click();
  await expect(row.getByRole("button", { name: "导入图片" })).toBeVisible();
  const afterClear = JSON.parse(await readFile(projectFile, "utf8"));
  expect(afterClear.assets).toHaveLength(1);
  expect(afterClear.scenes[0].visual).toEqual({ type: "image" });

  await page.getByRole("button", { name: /撤销：清除 Scene 01 Asset 绑定/ }).click();
  await expect(row.getByRole("img", { name: "Scene 1 已绑定图片" })).toBeVisible();
  expect(JSON.parse(await readFile(projectFile, "utf8")).assets).toHaveLength(1);
});

test("替换失败保留旧绑定，重新选择成功后才切换", async ({ page }) => {
  await writeFile(projectFile, `${JSON.stringify(projectWithImage(originalAssetId))}\n`);
  await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 3,
      background: { r: 42, g: 34, b: 38 },
    },
  })
    .png()
    .toFile(join(projectDirectory, "assets", `${originalAssetId}.png`));
  const broken = join(sourceDirectory, "损坏.png");
  const replacement = join(sourceDirectory, "替换照片.jpg");
  await writeFile(broken, "not an image");
  await sharp({
    create: {
      width: 2200,
      height: 1200,
      channels: 3,
      background: { r: 190, g: 80, b: 40 },
    },
  })
    .jpeg()
    .toFile(replacement);

  await page.goto(server.url);
  const row = page.getByTestId("scene-row");
  await page.getByLabel("为 Scene 1 选择图片").setInputFiles(broken);
  await expect(row.getByText("图片内容损坏或无法读取")).toBeVisible({
    timeout: 15_000,
  });
  await expect(row.getByText("旧绑定保持不变")).toBeVisible();
  const preview = row.getByRole("button", { name: /预览 Scene 1 Image Asset/ });
  await expect(preview).toBeVisible();
  await preview.click();
  await expect(page.getByRole("dialog", { name: `${originalAssetId}.png` })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual.assetId).toBe(
    originalAssetId,
  );

  await page.getByLabel("为 Scene 1 选择图片").setInputFiles(replacement);
  await expect(row.getByText("替换照片.jpg")).toBeVisible();
  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual.assetId).not.toBe(originalAssetId);
});

test("替换任务处理中及待确认时始终预览当前绑定", async ({ page }) => {
  await writeFile(projectFile, `${JSON.stringify(projectWithImage(originalAssetId))}\n`);
  await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 3,
      background: { r: 42, g: 34, b: 38 },
    },
  })
    .png()
    .toFile(join(projectDirectory, "assets", `${originalAssetId}.png`));

  const pendingAssetId = "90000000-0000-4000-8000-000000000002";
  const pendingAssetPath = `assets/${pendingAssetId}.png`;
  await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 3,
      background: { r: 190, g: 80, b: 40 },
    },
  })
    .png()
    .toFile(join(projectDirectory, pendingAssetPath));
  const source = join(sourceDirectory, "待确认替换.png");
  await writeFile(source, "intercepted by the test");

  await page.goto(server.url);
  const row = page.getByTestId("scene-row");
  await row.getByRole("button", { name: "清除 Scene 1 图片绑定" }).click();
  await expect(row.getByRole("button", { name: "导入图片" })).toBeVisible();

  const now = new Date().toISOString();
  const queuedJob = {
    id: "pending-preview-job",
    type: "image-import" as const,
    sceneId,
    fileName: "待确认替换.png",
    status: "queued" as const,
    stage: "waiting" as const,
    createdAt: now,
    updatedAt: now,
  };
  let notifyLatestRequested!: () => void;
  let releaseLatestResponse!: () => void;
  const latestRequested = new Promise<void>((resolvePromise) => {
    notifyLatestRequested = resolvePromise;
  });
  const latestResponseReleased = new Promise<void>((resolvePromise) => {
    releaseLatestResponse = resolvePromise;
  });
  await page.route("**/api/jobs/image-import", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ job: queuedJob }),
    });
  });
  await page.route("**/api/jobs/pending-preview-job", async (route) => {
    notifyLatestRequested();
    await latestResponseReleased;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...queuedJob,
        status: "succeeded",
        stage: "completed",
        result: {
          asset: { id: pendingAssetId, kind: "image", path: pendingAssetPath },
          facts: {
            sourceWidth: 1920,
            sourceHeight: 1080,
            width: 1920,
            height: 1080,
            enlarged: false,
          },
        },
      }),
    });
  });

  await page.getByLabel("为 Scene 1 选择图片").setInputFiles(source);
  await latestRequested;
  await page.getByRole("button", { name: /撤销：清除 Scene 01 Asset 绑定/ }).click();

  const currentPreview = row.getByRole("button", {
    name: new RegExp(`预览 Scene 1 Image Asset ${originalAssetId}\\.png`),
  });
  await expect(currentPreview).toBeVisible();
  await expect(row.getByText("等待处理")).toBeVisible();
  await currentPreview.click();
  await expect(page.getByRole("dialog", { name: `${originalAssetId}.png` })).toBeVisible();
  await page.keyboard.press("Escape");

  releaseLatestResponse();
  const proposal = page.getByRole("dialog", {
    name: "图片已导入，Scene 已发生变化",
  });
  await expect(proposal).toBeVisible();
  await proposal.getByRole("button", { name: "关闭" }).click();
  await expect(row.getByText("导入结果待确认")).toBeVisible();
  await expect(row.getByText("当前绑定保持不变")).toBeVisible();
  await expect(currentPreview).toBeVisible();
  await currentPreview.click();
  await expect(page.getByRole("dialog", { name: `${originalAssetId}.png` })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row.getByRole("button", { name: "查看并确认图片导入结果" })).toBeVisible();
});

test("Visual 在导入期间改变时保留未绑定 Asset，并可从任务抽屉返回确认", async ({ page }) => {
  const source = join(sourceDirectory, "延迟规范化.png");
  await sharp({
    create: {
      width: 3500,
      height: 3500,
      channels: 4,
      background: { r: 30, g: 110, b: 180, alpha: 0.6 },
    },
  })
    .png({ compressionLevel: 0 })
    .toFile(source);

  await page.goto(server.url);
  await page.getByLabel("为 Scene 1 选择图片").setInputFiles(source);
  await page.getByLabel("Scene 1 Visual Type").selectOption("video");

  const dialog = page.getByRole("dialog", {
    name: "图片已导入，但 Visual 已不兼容",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: /任务/ }).click();
  await expect(page.getByTestId("image-import-task")).toContainText("导入结果待确认");
  await page.getByTestId("image-import-task").getByRole("button", { name: "查看并确认" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "保留为未绑定 Asset" }).click();

  const saved = JSON.parse(await readFile(projectFile, "utf8"));
  expect(saved.assets).toHaveLength(1);
  expect(saved.scenes[0].visual).toEqual({ type: "video" });
});

test("删除导入中的 Scene 后保留迟到 Asset，并在空态任务抽屉说明未绑定结果", async ({ page }) => {
  const importedAssetId = "90000000-0000-4000-8000-000000000099";
  const importedAssetPath = `assets/${importedAssetId}.png`;
  await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 3,
      background: { r: 24, g: 142, b: 138 },
    },
  })
    .png()
    .toFile(join(projectDirectory, importedAssetPath));
  const source = join(sourceDirectory, "删除后完成.png");
  await writeFile(source, "intercepted by the test");
  const now = new Date().toISOString();
  const queuedJob = {
    id: "scene-delete-image-job",
    type: "image-import" as const,
    sceneId,
    fileName: "删除后完成.png",
    status: "queued" as const,
    stage: "waiting" as const,
    createdAt: now,
    updatedAt: now,
  };
  let notifyLatestRequested!: () => void;
  let releaseLatestResponse!: () => void;
  const latestRequested = new Promise<void>((resolvePromise) => {
    notifyLatestRequested = resolvePromise;
  });
  const latestResponseReleased = new Promise<void>((resolvePromise) => {
    releaseLatestResponse = resolvePromise;
  });
  await page.route("**/api/jobs/image-import", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ job: queuedJob }),
    });
  });
  await page.route("**/api/jobs/scene-delete-image-job", async (route) => {
    notifyLatestRequested();
    await latestResponseReleased;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...queuedJob,
        status: "succeeded",
        stage: "completed",
        result: {
          asset: { id: importedAssetId, kind: "image", path: importedAssetPath },
          facts: {
            sourceWidth: 1920,
            sourceHeight: 1080,
            width: 1920,
            height: 1080,
            enlarged: false,
          },
        },
      }),
    });
  });

  await page.goto(server.url);
  await page.getByLabel("为 Scene 1 选择图片").setInputFiles(source);
  await latestRequested;
  await page.getByRole("button", { name: "删除 Scene 1" }).click();
  releaseLatestResponse();

  await expect(page.getByRole("complementary", { name: "任务与渲染" })).toBeVisible();
  await expect(page.getByTestId("image-import-task")).toContainText(
    "图片已导入，但目标 Scene 已删除",
  );
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")))
    .toMatchObject({
      assets: [{ id: importedAssetId, path: importedAssetPath }],
      scenes: [],
    });

  await page.getByRole("button", { name: "撤销：删除 Scene 01" }).click();
  await expect(page.getByTestId("scene-row")).toHaveCount(1);
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")))
    .toMatchObject({
      assets: [{ id: importedAssetId, path: importedAssetPath }],
      scenes: [{ id: sceneId, visual: { type: "image" } }],
    });

  await page.getByRole("button", { name: "重做：删除 Scene 01" }).click();
  await expect(page.getByTestId("scene-row")).toHaveCount(0);
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")))
    .toMatchObject({
      assets: [{ id: importedAssetId, path: importedAssetPath }],
      scenes: [],
    });
});

test("行内取消会保留原项目并清理未完成导入", async ({ page }) => {
  const source = join(sourceDirectory, "取消中的图片.png");
  await sharp({
    create: {
      width: 3500,
      height: 3500,
      channels: 4,
      background: { r: 90, g: 130, b: 180, alpha: 0.5 },
    },
  })
    .png({ compressionLevel: 0 })
    .toFile(source);

  await page.goto(server.url);
  const input = page.getByLabel("为 Scene 1 选择图片");
  await expect(input).toHaveAttribute(
    "accept",
    "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
  );
  await input.setInputFiles(source);
  let rejectFirstCancel = true;
  await page.route("**/api/jobs/*", async (route) => {
    if (route.request().method() === "DELETE" && rejectFirstCancel) {
      rejectFirstCancel = false;
      await route.fulfill({ status: 503, body: "取消服务暂时不可用" });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "取消导入 取消中的图片.png" }).click();
  await expect(page.getByRole("alert", { name: "取消服务暂时不可用" })).toBeVisible();
  await page.getByRole("button", { name: "取消导入 取消中的图片.png" }).click();
  await expect(page.getByText("已取消 · PNG、JPEG 或 WebP")).toBeVisible();

  const saved = JSON.parse(await readFile(projectFile, "utf8"));
  expect(saved.assets).toEqual([]);
  expect(saved.scenes[0].visual).toEqual({ type: "image" });
  await expect.poll(async () => page.getByTestId("image-import-task").textContent()).toContain("图片导入已取消");
});

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { startNarracutServer, type RunningServer } from "../../src/server/server";

let server: RunningServer;
let projectFile: string;

test.beforeAll(async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-v2-e2e-"));
  projectFile = join(projectDirectory, "project.json");
  await writeFile(projectFile, '{"schemaVersion":2,"metadata":{},"assets":[],"scenes":[]}\n');
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    initialPort: 0,
  });
});

test.afterAll(async () => {
  await server.close();
});

test("V1 打开时只在内存连续迁移，首次正常保存后写为当前 V3", async ({ page }) => {
  const sceneIds = [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
    "20000000-0000-4000-8000-000000000003",
  ];
  const originalBytes = `${JSON.stringify({
    schemaVersion: 1,
    metadata: { name: "旧项目" },
    assets: [],
    scenes: [
      {
        id: sceneIds[0],
        narration: { text: "开始" },
        visual: { type: "title", device: "NC", headline: "操作主题" },
        transition: "cut",
      },
      {
        id: sceneIds[1],
        narration: { text: "连接" },
        visual: {
          type: "video-caption",
          caption: { kind: "step", number: "02", name: "准备连接管" },
        },
        transition: "cut",
      },
      {
        id: sceneIds[2],
        narration: { text: "结束" },
        visual: { type: "end-card", title: "完成", bullets: ["复核连接"] },
        transition: "cut",
      },
    ],
  })}\n`;
  await writeFile(projectFile, originalBytes);

  await page.goto(server.url);

  await expect(page.getByTestId("scene-row")).toHaveCount(3);
  expect(await readFile(projectFile, "utf8")).toBe(originalBytes);
  await expect(page.getByRole("combobox", { name: "Scene 1 Visual Type" })).toHaveValue("card");
  await page.getByTestId("scene-row").nth(1).click();
  await expect(page.getByRole("textbox", { name: "说明文字" })).toHaveValue("准备连接管");
  await expect(page.getByText("步骤编号", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "编辑项目名" }).click();
  await page.getByRole("textbox", { name: "项目名" }).fill("V2 项目");
  await page.getByRole("textbox", { name: "项目名" }).press("Enter");

  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).schemaVersion)
    .toBe(3);
  const saved = JSON.parse(await readFile(projectFile, "utf8"));
  expect(saved.theme).toMatchObject({
    presetId: "narracut/default@1",
    defaultTextStyleId: "narracut/panel@1",
    defaultTextMotionId: "narracut/fade@1",
  });
  expect(saved.scenes.map((scene: { id: string }) => scene.id)).toEqual(sceneIds);
  expect(saved.scenes.map((scene: { visual: unknown }) => scene.visual)).toEqual([
    { type: "card", label: "NC", title: "操作主题" },
    { type: "video", caption: { text: "准备连接管" } },
    { type: "card", title: "完成", items: ["复核连接"] },
  ]);
});

test("Image 与 Video 直接添加、编辑和移除通用 Caption", async ({ page }) => {
  await writeFile(
    projectFile,
    `${JSON.stringify({
      schemaVersion: 2,
      metadata: {},
      assets: [],
      scenes: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          narration: { text: "Caption 编辑" },
          visual: { type: "image" },
          transition: "cut",
        },
      ],
    })}\n`,
  );
  await page.goto(server.url);

  const visualType = page.getByRole("combobox", { name: "Scene 1 Visual Type" });
  await expect(visualType.locator("option")).toHaveText(["Card", "Image", "Video"]);
  await page.getByRole("button", { name: "添加画面说明" }).click();
  const dialog = page.getByRole("dialog", { name: "添加画面说明" });
  await expect(dialog.getByRole("button", { name: "添加画面说明" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "说明文字" }).fill("准备连接管");
  await dialog.getByRole("button", { name: "添加画面说明" }).click();

  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual)
    .toEqual({ type: "image", caption: { text: "准备连接管" } });
  await expect(page.getByTestId("player-visual")).toContainText("准备连接管");

  const caption = page.getByRole("textbox", { name: "说明文字" });
  await caption.fill("更新后的 Caption");
  await caption.blur();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual.caption.text)
    .toBe("更新后的 Caption");

  await caption.fill("");
  await caption.blur();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual.caption)
    .toBeUndefined();
  await expect(page.getByRole("button", { name: "添加画面说明" })).toBeVisible();
});

test("Card 原子创建并在切换媒体时逐项确认结构化文字损失", async ({ page }) => {
  const videoAssetId = "40000000-0000-4000-8000-000000000002";
  await writeFile(
    projectFile,
    `${JSON.stringify({
      schemaVersion: 2,
      metadata: {},
      assets: [{ id: videoAssetId, kind: "video", path: "assets/demo.mp4" }],
      scenes: [
        {
          id: "40000000-0000-4000-8000-000000000001",
          narration: { text: "Card 编辑" },
          visual: { type: "video", assetId: videoAssetId },
          transition: "cut",
        },
      ],
    })}\n`,
  );
  await page.goto(server.url);
  const visualType = page.getByRole("combobox", { name: "Scene 1 Visual Type" });

  await visualType.selectOption("card");
  const cardDialog = page.getByRole("dialog", { name: "填写文字卡片内容" });
  expect(JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual).toEqual({ type: "video", assetId: videoAssetId });
  await expect(cardDialog.getByRole("button", { name: "创建文字卡片" })).toBeDisabled();
  await cardDialog.getByRole("textbox", { name: "卡片标题" }).fill("章节标题");
  await cardDialog.getByRole("button", { name: "创建文字卡片" }).click();
  const assetConfirm = page.getByRole("dialog", { name: "确认 Visual 切换" });
  await expect(assetConfirm).toContainText("当前 Scene 的 Asset 绑定“demo.mp4”");
  await expect(assetConfirm).toContainText("项目中的文件不会删除");
  await expect(assetConfirm.getByRole("button", { name: "取消" })).toBeFocused();
  await assetConfirm.getByRole("button", { name: "确认切换" }).click();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual)
    .toEqual({ type: "card", title: "章节标题" });

  await page.getByRole("textbox", { name: "卡片标签" }).fill("第一章");
  await page.getByRole("textbox", { name: "卡片标签" }).blur();
  await page.getByRole("textbox", { name: "卡片正文" }).fill("准备工作");
  await page.getByRole("textbox", { name: "卡片正文" }).blur();
  await page.getByRole("button", { name: "添加列表项" }).click();
  await page.getByRole("textbox", { name: "列表项 1" }).fill("移除我");
  await page.getByRole("textbox", { name: "列表项 1" }).blur();
  await page.getByRole("button", { name: "添加列表项" }).click();
  await page.getByRole("textbox", { name: "列表项 2" }).fill("复核连接");
  await page.getByRole("textbox", { name: "列表项 2" }).blur();
  await page.getByRole("button", { name: "删除列表项 1" }).click();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual.items)
    .toEqual(["复核连接"]);

  await visualType.selectOption("image");
  const confirm = page.getByRole("dialog", { name: "确认 Visual 切换" });
  await expect(confirm).toContainText("标签“第一章”");
  await expect(confirm).toContainText("标题“章节标题”");
  await expect(confirm).toContainText("正文“准备工作”");
  await expect(confirm).toContainText("列表项“复核连接”");
  await expect(confirm.getByRole("button", { name: "取消" })).toBeFocused();
  await confirm.getByRole("button", { name: "确认切换" }).click();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual)
    .toEqual({ type: "image" });
});

test("Card 没有首尾锚点限制，鼠标与键盘重排保持 Scene ID", async ({ page }) => {
  const ids = [
    "50000000-0000-4000-8000-000000000001",
    "50000000-0000-4000-8000-000000000002",
    "50000000-0000-4000-8000-000000000003",
  ];
  await writeFile(
    projectFile,
    `${JSON.stringify({
      schemaVersion: 2,
      metadata: {},
      assets: [],
      scenes: [
        { id: ids[0], narration: { text: "Card" }, visual: { type: "card", title: "章节" }, transition: "cut" },
        { id: ids[1], narration: { text: "Image" }, visual: { type: "image" }, transition: "cut" },
        { id: ids[2], narration: { text: "Video" }, visual: { type: "video" }, transition: "cut" },
      ],
    })}\n`,
  );
  await page.goto(server.url);
  const row = (id: string) => page.locator(`[data-scene-id="${id}"]`);
  const order = () =>
    page.getByTestId("scene-row").evaluateAll((rows) =>
      rows.map((item) => item.getAttribute("data-scene-id")),
    );

  await row(ids[0]).getByRole("button", { name: /重排 Scene/ }).dragTo(row(ids[2]));
  await expect.poll(order).toEqual([ids[1], ids[2], ids[0]]);

  const handle = row(ids[0]).getByRole("button", { name: /重排 Scene/ });
  await handle.focus();
  await handle.press("Space");
  await handle.press("ArrowUp");
  await handle.press("Enter");
  await expect.poll(order).toEqual([ids[1], ids[0], ids[2]]);
  await expect(row(ids[0]).getByRole("button", { name: /重排 Scene/ })).toBeFocused();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes.map((scene: { id: string }) => scene.id))
    .toEqual([ids[1], ids[0], ids[2]]);
});

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { startNarracutServer, type RunningServer } from "../../src/server/server";

let server: RunningServer;
let projectFile: string;

const sceneId = "80000000-0000-4000-8000-000000000001";

test.beforeAll(async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-v3-e2e-"));
  projectFile = join(projectDirectory, "project.json");
  await writeFile(projectFile, '{"schemaVersion":2,"metadata":{},"assets":[],"scenes":[]}\n');
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

test("V2 只在内存迁移，Project Theme 与 Scene 覆盖保存为严格 V3", async ({ page }) => {
  const original = `${JSON.stringify({
    schemaVersion: 2,
    metadata: { name: "Preset 工作台" },
    assets: [],
    scenes: [
      {
        id: sceneId,
        narration: { text: "Subtitle 保持独立" },
        visual: { type: "card", label: "中立标签", title: "文字表现" },
        transition: "cut",
      },
    ],
  })}\n`;
  await writeFile(projectFile, original);
  await page.goto(server.url);

  await expect(page.getByTestId("global-workbench")).toBeVisible();
  expect(await readFile(projectFile, "utf8")).toBe(original);
  await page.getByRole("tab", { name: "项目" }).click();
  await expect(page.getByTestId("inspector-project")).toContainText("narracut/default@1");
  await page.getByRole("button", { name: "项目默认文字样式：聚焦" }).click();

  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8"))).toMatchObject({
    schemaVersion: 3,
    theme: {
      presetId: "narracut/default@1",
      defaultTextStyleId: "narracut/spotlight@1",
      defaultTextMotionId: "narracut/fade@1",
      accentColor: "#00A3A6",
      fontId: "narracut/noto-sans-cjk-sc@1",
    },
  });

  await page.getByRole("tab", { name: "场景" }).click();
  await expect(page.getByText("继承项目默认", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "场景文字样式：下部标题" }).click();
  await page.getByRole("button", { name: "场景入场动画：横向进入" }).click();

  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual).toMatchObject({
    textStyleId: "narracut/lower-third@1",
    textMotionId: "narracut/slide@1",
  });
  await expect(page.locator('[data-text-style="narracut/lower-third@1"]')).toBeVisible();
  await expect(page.locator('[data-text-motion="narracut/slide@1"]')).toBeVisible();
  await expect(page.getByTestId("player-subtitle")).toContainText("Subtitle 保持独立");

  await page.getByRole("button", { name: "安全区" }).click();
  await expect(page.getByTestId("safe-area-overlay")).toBeVisible();
  await page.getByRole("button", { name: "恢复项目默认" }).first().click();
  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual).not.toHaveProperty("textStyleId");
});

test("Caption 创建后才显示文字表现，并独立于 Card 与 Subtitle", async ({ page }) => {
  await writeFile(
    projectFile,
    `${JSON.stringify({
      schemaVersion: 3,
      metadata: {},
      theme: {
        presetId: "narracut/default@1",
        defaultTextStyleId: "narracut/panel@1",
        defaultTextMotionId: "narracut/fade@1",
        accentColor: "#00A3A6",
        fontId: "narracut/noto-sans-cjk-sc@1",
      },
      assets: [],
      scenes: [
        {
          id: sceneId,
          narration: { text: "Narration 字幕" },
          visual: { type: "image" },
          transition: "cut",
        },
      ],
    })}\n`,
  );
  await page.goto(server.url);

  await expect(page.getByRole("heading", { name: "文字表现" })).toHaveCount(0);
  await page.getByRole("button", { name: "添加画面说明" }).click();
  await page.getByRole("dialog", { name: "添加画面说明" }).getByRole("textbox", { name: "说明文字" }).fill("独立 Caption");
  await page.getByRole("dialog", { name: "添加画面说明" }).getByRole("button", { name: "添加画面说明" }).click();

  await expect(page.getByRole("heading", { name: "文字表现" })).toBeVisible();
  await page.getByRole("button", { name: "场景文字样式：聚焦" }).click();
  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual.caption).toEqual({
    text: "独立 Caption",
    textStyleId: "narracut/spotlight@1",
  });
  await expect(page.getByTestId("player-subtitle")).toContainText("Narration 字幕");
});

test("未知 Preset ID 原样可见，并可从相关字段恢复", async ({ page }) => {
  await writeFile(
    projectFile,
    `${JSON.stringify({
      schemaVersion: 3,
      metadata: {},
      theme: {
        presetId: "vendor/missing-theme@4",
        defaultTextStyleId: "vendor/missing-style@7",
        defaultTextMotionId: "narracut/fade@1",
        accentColor: "#00A3A6",
        fontId: "narracut/noto-sans-cjk-sc@1",
      },
      assets: [],
      scenes: [
        {
          id: sceneId,
          narration: { text: "恢复 Preset" },
          visual: { type: "card", title: "保留未知 ID", textMotionId: "vendor/missing-motion@2" },
          transition: "cut",
        },
      ],
    })}\n`,
  );
  await page.goto(server.url);

  await expect(page.getByTestId("global-workbench")).toBeVisible();
  await expect(
    page.getByTestId("scene-row").first().getByRole("button", {
      name: "阻断：恢复内置文字设置，另有 1 项",
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "项目" }).click();
  await expect(page.getByText("vendor/missing-theme@4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "恢复内置主题" }).click();
  await expect(page.getByText("vendor/missing-style@7", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "更换为首个内置预设" }).click();
  await page.getByRole("tab", { name: "场景" }).click();
  await expect(page.getByText("vendor/missing-motion@2", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "场景入场动画：无进场" }).click();

  await page.getByRole("button", { name: /^检查并渲染/ }).click();
  await expect(page.getByRole("heading", { name: "任务与渲染" })).toBeVisible();

  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8"))).toMatchObject({
    theme: { presetId: "narracut/default@1", defaultTextStyleId: "narracut/panel@1" },
    scenes: [{ visual: { textMotionId: "narracut/none@1" } }],
  });
});

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { startNarracutServer, type RunningServer } from "../../src/server/server";

let server: RunningServer;
let projectFile: string;

const sceneIds = [
  "41000000-0000-4000-8000-000000000001",
  "41000000-0000-4000-8000-000000000002",
  "41000000-0000-4000-8000-000000000003",
];
const assetId = "41000000-0000-4000-8000-000000000010";

function projectFixture() {
  return {
    schemaVersion: 3,
    metadata: { name: "Scene 删除测试" },
    theme: {
      presetId: "narracut/default@1",
      defaultTextStyleId: "narracut/panel@1",
      defaultTextMotionId: "narracut/fade@1",
      accentColor: "#00A3A6",
      fontId: "narracut/noto-sans-cjk-sc@1",
    },
    assets: [{ id: assetId, kind: "image", path: `assets/${assetId}.png` }],
    scenes: [
      {
        id: sceneIds[0],
        narration: { text: "第一条旁白" },
        visual: { type: "card", title: "第一条" },
        transition: "cut",
      },
      {
        id: sceneIds[1],
        narration: { text: "第二条旁白" },
        visual: { type: "image", assetId },
        transition: "cut",
      },
      {
        id: sceneIds[2],
        narration: { text: "第三条旁白" },
        visual: { type: "video" },
        transition: "cut",
      },
    ],
  };
}

test.beforeAll(async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-delete-e2e-"));
  projectFile = join(projectDirectory, "project.json");
  await writeFile(projectFile, `${JSON.stringify(projectFixture())}\n`);
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

test.beforeEach(async ({ page }) => {
  await writeFile(projectFile, `${JSON.stringify(projectFixture())}\n`);
  await page.goto(server.url);
  await expect(page.getByTestId("global-workbench")).toBeVisible();
});

test("删除入口可发现且不触发行选择，随后可撤销并重做完整 Scene", async ({
  page,
}) => {
  const targetRow = page.locator(`[data-scene-id="${sceneIds[1]}"]`);
  const deleteButton = targetRow.getByRole("button", { name: "删除 Scene 2" });
  await expect(deleteButton).toBeVisible();

  await deleteButton.focus();
  await deleteButton.press("Enter");

  await expect(page.getByTestId("scene-row")).toHaveCount(2);
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 01");
  await expect(page.getByTestId("history-announcement")).toHaveText(
    "已删除 Scene 2，可撤销",
  );
  await expect(page.locator(".history-feedback")).toHaveCount(0);
  await expect(
    page.locator(`[data-scene-id="${sceneIds[2]}"] [data-scene-select]`),
  ).toBeFocused();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")))
    .toMatchObject({
      assets: projectFixture().assets,
      scenes: [{ id: sceneIds[0] }, { id: sceneIds[2] }],
    });

  await page.getByRole("button", { name: "撤销：删除 Scene 02" }).click();
  await expect(page.getByTestId("scene-row")).toHaveCount(3);
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 02");
  await expect(targetRow.getByRole("button", { name: "选择并预览 Scene 2" })).toBeFocused();
  await expect(targetRow.getByRole("textbox", { name: "Scene 2 Narration" })).toHaveValue(
    "第二条旁白",
  );

  await page.getByRole("button", { name: "重做：删除 Scene 02" }).click();
  await expect(page.getByTestId("scene-row")).toHaveCount(2);
  await expect(
    page.locator(`[data-scene-id="${sceneIds[2]}"] [data-scene-select]`),
  ).toBeFocused();
});

test("删除选中的中间和末尾 Scene 时按原位置确定相邻选择与焦点", async ({ page }) => {
  await page.getByRole("button", { name: "选择并预览 Scene 2" }).click();
  await page.getByRole("button", { name: "删除 Scene 2" }).click();

  const originalThirdRow = page.locator(`[data-scene-id="${sceneIds[2]}"]`);
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 02");
  await expect(originalThirdRow.getByRole("button", { name: "选择并预览 Scene 2" })).toBeFocused();

  await originalThirdRow.getByRole("button", { name: "删除 Scene 2" }).click();
  const originalFirstRow = page.locator(`[data-scene-id="${sceneIds[0]}"]`);
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 01");
  await expect(originalFirstRow.getByRole("button", { name: "选择并预览 Scene 1" })).toBeFocused();
});

test("删除播放点外的 Scene 保持播放上下文，删除正在播放的 Scene 则暂停并跳到相邻开头", async ({
  page,
}) => {
  const progress = page.getByRole("slider", { name: "项目播放进度" });
  await progress.fill("180");
  await expect(page.getByTestId("player-playing-scene")).toHaveText("播放 02");
  await page.getByRole("button", { name: "播放" }).click();
  await expect(page.getByTestId("player-playback-state")).toHaveText("播放中");

  await page.getByRole("button", { name: "删除 Scene 1" }).click();
  await expect(page.getByTestId("player-playing-scene")).toHaveText("播放 01");
  await expect(page.getByTestId("player-playback-state")).toHaveText("播放中");
  await expect.poll(async () => Number(await progress.inputValue())).toBeLessThan(70);

  await page.getByRole("button", { name: "删除 Scene 1" }).click();
  await expect(page.getByTestId("player-playing-scene")).toHaveText("播放 01");
  await expect(page.getByTestId("player-playback-state")).toHaveText("已暂停");
  await expect(progress).toHaveValue("0");
});

test("删除最后一个 Scene 进入空态并保留任务抽屉，Space 操作后聚焦新增入口", async ({
  page,
}) => {
  const project = projectFixture();
  project.scenes = [project.scenes[0]];
  await writeFile(projectFile, `${JSON.stringify(project)}\n`);
  await page.reload();

  const deleteButton = page.getByRole("button", { name: "删除 Scene 1" });
  await deleteButton.focus();
  await deleteButton.press("Space");

  await expect(page.getByRole("heading", { name: "从第一句讲解开始" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增一条" })).toBeFocused();
  await expect(page.getByRole("button", { name: /任务/ })).toBeVisible();
  await page.getByRole("button", { name: /任务/ }).click();
  await expect(page.getByRole("complementary", { name: "任务与渲染" })).toBeVisible();
  await expect(page.getByText("Render-ready 问题")).toBeVisible();
});

test("删除切断文本事务并清理目标 Scene 的展开编辑与重排状态", async ({ page }) => {
  const narration = page.getByRole("textbox", { name: "Scene 2 Narration", exact: true });
  await narration.fill("删除前的最新旁白");
  await narration.hover();
  await page.getByRole("button", { name: "扩大编辑 Scene 2 Narration" }).click();
  const expanded = page.getByRole("dialog", { name: "扩大编辑 Scene 2 Narration" });
  await expect(expanded).toBeVisible();
  await page
    .locator(`[data-scene-id="${sceneIds[1]}"]`)
    .getByRole("button", { name: "删除 Scene 2" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(expanded).toBeHidden();

  await page.getByRole("button", { name: "撤销：删除 Scene 02" }).click();
  await expect(page.getByRole("textbox", { name: "Scene 2 Narration", exact: true })).toHaveValue(
    "删除前的最新旁白",
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("textbox", { name: "Scene 2 Narration", exact: true })).toHaveValue(
    "第二条旁白",
  );

  const handle = page.getByRole("button", { name: "重排 Scene 2" });
  await handle.focus();
  await handle.press("Enter");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "删除 Scene 2" }).click();
  await page.getByRole("button", { name: "撤销：删除 Scene 02" }).click();
  await expect(page.getByRole("button", { name: "重排 Scene 2" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

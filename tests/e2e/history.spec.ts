import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { startNarracutServer, type RunningServer } from "../../src/server/server";

let server: RunningServer;
let projectFile: string;

const sceneIds = [
  "90000000-0000-4000-8000-000000000001",
  "90000000-0000-4000-8000-000000000002",
];

function projectFixture() {
  return {
    schemaVersion: 3,
    metadata: { name: "事务历史测试" },
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
        id: sceneIds[0],
        narration: { text: "原始旁白" },
        speech: {
          path: `speech/${sceneIds[0]}.mp3`,
          durationMs: 1200,
          sourceTextHash: `sha256:${createHash("sha256").update("原始旁白").digest("hex")}`,
          ttsProfileId: "narracut-mandarin-news-v1",
        },
        visual: { type: "card", title: "原始卡片" },
        transition: "cut",
      },
      {
        id: sceneIds[1],
        narration: { text: "第二段旁白" },
        visual: { type: "image" },
        transition: "cut",
      },
    ],
  };
}

test.beforeAll(async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-history-e2e-"));
  projectFile = join(projectDirectory, "project.json");
  await mkdir(join(projectDirectory, "speech"));
  await writeFile(join(projectDirectory, "speech", `${sceneIds[0]}.mp3`), "history-speech-revision");
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
  await writeFile(join(resolve(projectFile, ".."), "speech", `${sceneIds[0]}.mp3`), "history-speech-revision");
  await writeFile(projectFile, `${JSON.stringify(projectFixture())}\n`);
  await page.goto(server.url);
  await expect(page.getByTestId("global-workbench")).toBeVisible();
});

test("同一 Narration 在 750ms 内合并，空闲后形成新事务，并与 Speech 失效共同撤销", async ({
  page,
}) => {
  const narration = page.getByRole("textbox", { name: "Scene 1 Narration" });

  await narration.fill("第一轮 A");
  await page.waitForTimeout(200);
  await narration.fill("第一轮 B");
  await page.waitForTimeout(800);
  await narration.fill("第二轮");

  const undo = page.getByRole("button", { name: "撤销：编辑 Scene 01 旁白" });
  await expect(undo).toBeEnabled();
  await expect(undo).toHaveAttribute("title", "撤销：编辑 Scene 01 旁白");
  await undo.click();
  await expect(narration).toHaveValue("第一轮 B");
  await expect(
    page.getByTestId("scene-row").first().getByRole("button", { name: "生成 Speech" }),
  ).toBeVisible();
  await expect(page.getByTestId("scene-row").first()).toContainText(
    "Draft Duration",
  );
  await expect(
    page.getByRole("button", { name: "重做：编辑 Scene 01 旁白" }),
  ).toBeEnabled();

  await undo.click();
  await expect(narration).toHaveValue("原始旁白");
  await expect(page.getByTestId("scene-row").first()).toContainText("已生成");
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "重做：编辑 Scene 01 旁白" }),
  ).toBeEnabled();

  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0])
    .toMatchObject({ narration: { text: "原始旁白" }, speech: { durationMs: 1200 } });
});

test("失焦、切换文本字段与非文本操作都会结束当前文本事务", async ({ page }) => {
  const first = page.getByRole("textbox", { name: "Scene 1 Narration" });
  const second = page.getByRole("textbox", { name: "Scene 2 Narration" });

  await first.fill("第一段 A");
  await first.blur();
  await first.fill("第一段 B");
  await second.fill("第二段 C");

  const handle = page
    .getByTestId("scene-row")
    .first()
    .getByRole("button", { name: "重排 Scene 1" });
  await handle.focus();
  await handle.press("Space");
  await handle.press("ArrowDown");
  await handle.press("Enter");

  await page.keyboard.press("Control+z");
  await expect(page.getByRole("textbox", { name: "Scene 1 Narration" })).toHaveValue(
    "第一段 B",
  );
  await expect(page.getByRole("textbox", { name: "Scene 2 Narration" })).toHaveValue(
    "第二段 C",
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("textbox", { name: "Scene 2 Narration" })).toHaveValue(
    "第二段旁白",
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("textbox", { name: "Scene 1 Narration" })).toHaveValue(
    "第一段 A",
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("textbox", { name: "Scene 1 Narration" })).toHaveValue(
    "原始旁白",
  );
});

test("Scene 重排作为独立事务按稳定 ID 撤销和重做", async ({ page }) => {
  const rows = page.getByTestId("scene-row");
  const order = () =>
    rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-scene-id")),
    );
  const handle = rows.first().getByRole("button", { name: "重排 Scene 1" });

  await handle.focus();
  await handle.press("Space");
  await handle.press("ArrowDown");
  await handle.press("Enter");
  await expect.poll(order).toEqual([sceneIds[1], sceneIds[0]]);

  await page.getByRole("button", { name: "撤销：移动 Scene 01 到第 2 项" }).click();
  await expect.poll(order).toEqual(sceneIds);
  await page.getByRole("button", { name: "重做：移动 Scene 01 到第 2 项" }).click();
  await expect.poll(order).toEqual([sceneIds[1], sceneIds[0]]);
});

test("Visual 分支完整恢复，Undo 后的新编辑清空 Redo，重新加载清空历史", async ({
  page,
}) => {
  const visualType = page.getByRole("combobox", { name: "Scene 1 Visual Type" });

  await visualType.selectOption("image");
  await page
    .getByRole("dialog", { name: "确认 Visual 切换" })
    .getByRole("button", { name: "确认切换" })
    .click();
  await expect(visualType).toHaveValue("image");

  await page.getByRole("button", { name: "撤销：切换 Scene 01 画面类型" }).click();
  await expect(visualType).toHaveValue("card");
  const cardTitle = page.getByRole("textbox", { name: "卡片标题" });
  await expect(cardTitle).toHaveValue("原始卡片");

  await cardTitle.focus();
  await cardTitle.press("Control+Shift+z");
  await expect(visualType).toHaveValue("image");
  await expect(visualType).toBeFocused();

  await page.keyboard.press("Control+z");
  await expect(visualType).toHaveValue("card");
  await page.getByRole("textbox", { name: "Scene 1 Narration" }).fill("新分支旁白");
  await expect(page.getByRole("button", { name: "重做", exact: true })).toBeDisabled();

  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].narration.text)
    .toBe("新分支旁白");
  await page.reload();
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "重做", exact: true })).toBeDisabled();
});

test("快捷键提供事务反馈，并在中文输入法组合期间让出全局 Undo", async ({ page }) => {
  await page.keyboard.press("Control+z");
  await expect(page.locator(".history-feedback")).toHaveText("没有可撤销的编辑");

  const narration = page.getByRole("textbox", { name: "Scene 1 Narration" });
  await narration.fill("组合输入后的旁白");
  await narration.evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
      }),
    );
  });
  await expect(narration).toHaveValue("组合输入后的旁白");

  await narration.press("Control+z");
  await expect(narration).toHaveValue("原始旁白");
  await expect(page.locator(".history-feedback")).toHaveText("已撤销：编辑 Scene 01 旁白");
  await page.keyboard.press("Control+y");
  await expect(narration).toHaveValue("组合输入后的旁白");
});

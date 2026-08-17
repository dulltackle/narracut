import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { startNarracutServer, type RunningServer } from "../../src/server/server";

let server: RunningServer;
let projectFile: string;
const CURRENT_FUTURE_VERSION = 99;
let consoleProblems: string[] = [];

test.beforeAll(async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-e2e-"));
  projectFile = join(projectDirectory, "project.json");
  await writeFile(
    projectFile,
    await readFile(resolve("docs/spec/project.example.json")),
  );
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    initialPort: 0,
  });
});

test.afterAll(async () => {
  await server.close();
});

test.beforeEach(async ({ page }) => {
  consoleProblems = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
});

test.afterEach(async () => {
  expect(consoleProblems).toEqual([]);
});

test("现有 13 Scene 示例进入完整三栏工作台并显示当前 Scene 列表", async ({
  page,
}) => {
  await page.goto(server.url);

  await expect(page.getByRole("heading", { name: "脚本表" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Player" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inspector" })).toBeVisible();
  await expect(page.locator(".scene-table thead th")).toHaveText([
    "顺序",
    "Narration",
    "Visual Type",
    "Asset",
    "Speech",
    "状态",
  ]);
  await expect(page.getByTestId("scene-row")).toHaveCount(13);
  await expect(page.getByText("宫腔通液治疗仪操作演示")).toBeVisible();

  await page.getByTestId("scene-row").nth(1).click();
  await expect(page.getByTestId("inspector-scene")).toContainText("Scene 02");
  await expect(page.getByTestId("player-subtitle")).toHaveText(
    "从球囊连接管套装中取出连接管",
  );
});

test("Narration 默认容纳更多文字并可悬浮扩大编辑", async ({ page }) => {
  const project = JSON.parse(
    await readFile(resolve("docs/spec/project.example.json"), "utf8"),
  );
  const longNarration = "这是一段需要在脚本表中完整查看和编辑的较长 Narration。".repeat(8);
  project.scenes[0].narration.text = longNarration;
  await writeFile(projectFile, `${JSON.stringify(project)}\n`);
  await page.goto(server.url);

  const compactNarration = page.getByRole("textbox", {
    name: "Scene 1 Narration",
    exact: true,
  });
  await expect(compactNarration).toHaveValue(longNarration);
  const compactMetrics = await compactNarration.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(compactMetrics.clientHeight).toBeGreaterThanOrEqual(60);
  expect(compactMetrics.scrollHeight).toBeGreaterThan(compactMetrics.clientHeight);
  expect(compactMetrics.overflowY).toBe("hidden");

  await compactNarration.hover();
  await page.getByRole("button", { name: "扩大编辑 Scene 1 Narration" }).click();
  const expandedEditor = page.getByRole("dialog", {
    name: "扩大编辑 Scene 1 Narration",
  });
  await expect(expandedEditor).toBeVisible();
  const expandedNarration = expandedEditor.getByRole("textbox", {
    name: "Scene 1 Narration 扩大编辑",
  });
  await expect(expandedNarration).toBeFocused();
  await expandedNarration.fill("从悬浮编辑器写回 Narration");
  await expect(compactNarration).toHaveValue("从悬浮编辑器写回 Narration");
  await expandedEditor.getByRole("button", { name: "关闭扩大编辑" }).click();
  await expect(expandedEditor).toBeHidden();
});

test("项目名可原位编辑、取消、清空并在重新打开后恢复", async ({ page }) => {
  await writeFile(
    projectFile,
    '{"schemaVersion":1,"metadata":{"name":"原项目名"},"assets":[],"scenes":[{"id":"3d594650-3436-4f0e-9696-2a9a28d7717f","narration":{"text":"测试 Narration"},"visual":{"type":"video"},"transition":"cut"}]}\n',
  );
  await page.goto(server.url);

  await page.getByRole("button", { name: "编辑项目名" }).click();
  const editor = page.getByRole("textbox", { name: "项目名" });
  await expect(editor).toBeFocused();
  await editor.fill("不应保存");
  await editor.press("Escape");
  await expect(page.getByRole("button", { name: "编辑项目名" })).toHaveText(
    "原项目名",
  );

  await page.getByRole("button", { name: "编辑项目名" }).click();
  await editor.fill("新项目名");
  await editor.press("Enter");
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).metadata.name)
    .toBe("新项目名");

  await page.getByRole("button", { name: "编辑项目名" }).click();
  await editor.fill("");
  await editor.blur();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).metadata.name)
    .toBeUndefined();
  const fallbackName = resolve(projectFile, "..").split("/").at(-1)!;
  await expect(page.getByRole("button", { name: "编辑项目名" })).toHaveText(
    fallbackName,
  );

  await page.reload();
  await expect(page.getByRole("button", { name: "编辑项目名" })).toHaveText(
    fallbackName,
  );
  expect(JSON.parse(await readFile(projectFile, "utf8")).metadata).toEqual({});
});

test("六种 Visual 以原子事务切换并只确认真实数据丢失", async ({ page }) => {
  const imageAssetId = "5b3a52e2-5b55-4dad-a7d1-79358ae18956";
  await writeFile(
    projectFile,
    `${JSON.stringify({
      schemaVersion: 1,
      metadata: { name: "Visual 事务测试" },
      assets: [
        { id: imageAssetId, kind: "image", path: "assets/device.png" },
        {
          id: "74420ec4-2a98-442f-969a-bd0e2db36baf",
          kind: "video",
          path: "assets/demo.mp4",
        },
      ],
      scenes: [
        {
          id: "1cf54ba2-bb03-4621-b6b9-7fdf46066043",
          narration: { text: "切换 Visual" },
          visual: { type: "image", assetId: imageAssetId },
          transition: "cut",
        },
      ],
    })}\n`,
  );
  const savedBodies: Array<{ scenes: Array<{ visual: Record<string, unknown> }> }> = [];
  await page.route("**/api/project", async (route) => {
    if (route.request().method() === "PUT") savedBodies.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.goto(server.url);
  const visualType = page.getByRole("combobox", { name: "Scene 1 Visual Type" });

  await visualType.selectOption("image-caption");
  const captionDialog = page.getByRole("dialog", { name: "选择 Caption 类型" });
  await expect(captionDialog).toBeVisible();
  expect(savedBodies).toHaveLength(0);
  expect(JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual).toEqual({
    type: "image",
    assetId: imageAssetId,
  });
  await captionDialog.getByRole("button", { name: "Step" }).click();
  await expect.poll(() => savedBodies.length).toBe(1);
  expect(savedBodies.at(-1)!.scenes[0].visual).toEqual({
    type: "image-caption",
    assetId: imageAssetId,
    caption: { kind: "step", number: "", name: "" },
  });

  await page.getByRole("textbox", { name: "步骤编号" }).fill("02");
  await page.getByRole("textbox", { name: "步骤名" }).fill("连接设备");
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual.caption)
    .toEqual({ kind: "step", number: "02", name: "连接设备" });

  await visualType.selectOption("video-caption");
  let confirmDialog = page.getByRole("dialog", { name: "确认 Visual 切换" });
  await expect(confirmDialog).toContainText("device.png");
  expect(JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual.type).toBe(
    "image-caption",
  );
  await page.keyboard.press("Escape");
  await expect(visualType).toHaveValue("image-caption");
  await expect(visualType).toBeFocused();

  await visualType.selectOption("video-caption");
  confirmDialog = page.getByRole("dialog", { name: "确认 Visual 切换" });
  await confirmDialog.getByRole("button", { name: "确认切换" }).click();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual)
    .toEqual({
      type: "video-caption",
      caption: { kind: "step", number: "02", name: "连接设备" },
    });

  await visualType.selectOption("video");
  confirmDialog = page.getByRole("dialog", { name: "确认 Visual 切换" });
  await expect(confirmDialog).toContainText("步骤编号 02");
  await confirmDialog.getByRole("button", { name: "确认切换" }).click();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual)
    .toEqual({ type: "video" });

  await visualType.selectOption("title");
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual)
    .toEqual({ type: "title", device: "", headline: "" });
  await page.getByRole("textbox", { name: "设备名与型号" }).fill("NC-01");
  await page.getByRole("textbox", { name: "操作主题" }).fill("标题场景");
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual.headline)
    .toBe("标题场景");
  await expect(page.getByTestId("player-visual")).toContainText("NC-01");
  await expect(page.getByTestId("player-visual")).toContainText("标题场景");

  await visualType.selectOption("end-card");
  confirmDialog = page.getByRole("dialog", { name: "确认 Visual 切换" });
  await expect(confirmDialog).toContainText("设备名与型号“NC-01”");
  await expect(confirmDialog).toContainText("操作主题“标题场景”");
  await confirmDialog.getByRole("button", { name: "确认切换" }).click();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual)
    .toEqual({ type: "end-card", title: "", bullets: [] });

  await visualType.selectOption("image");
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual)
    .toEqual({ type: "image" });
});

test("Inspector 编辑 Caption kind、Title 与可重排的 EndCard 要点", async ({ page }) => {
  await writeFile(
    projectFile,
    `${JSON.stringify({
      schemaVersion: 1,
      metadata: {},
      assets: [],
      scenes: [
        {
          id: "29620c28-1d95-497c-8ff0-a701a889910d",
          narration: { text: "Inspector 字段" },
          visual: {
            type: "video-caption",
            caption: { kind: "alert", text: "请勿断开电源" },
          },
          transition: "cut",
        },
      ],
    })}\n`,
  );
  await page.goto(server.url);
  const captionKind = page.getByRole("combobox", { name: "Caption 类型" });

  await captionKind.selectOption("step");
  let confirmDialog = page.getByRole("dialog", { name: "确认 Visual 切换" });
  await expect(confirmDialog).toContainText("警示文字“请勿断开电源”");
  await confirmDialog.getByRole("button", { name: "取消" }).click();
  await expect(captionKind).toHaveValue("alert");

  await captionKind.selectOption("step");
  confirmDialog = page.getByRole("dialog", { name: "确认 Visual 切换" });
  await confirmDialog.getByRole("button", { name: "确认切换" }).click();
  await page.getByRole("textbox", { name: "步骤编号" }).fill("03");
  await page.getByRole("textbox", { name: "步骤名" }).fill("完成设置");

  const visualType = page.getByRole("combobox", { name: "Scene 1 Visual Type" });
  await visualType.selectOption("title");
  confirmDialog = page.getByRole("dialog", { name: "确认 Visual 切换" });
  await confirmDialog.getByRole("button", { name: "确认切换" }).click();
  await page.getByRole("textbox", { name: "设备名与型号" }).fill("NC-02");
  await page.getByRole("textbox", { name: "操作主题" }).fill("安全操作");
  const subheadline = page.getByRole("textbox", { name: "副标题" });
  await subheadline.fill("工作台演示");
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual.subheadline)
    .toBe("工作台演示");
  await subheadline.fill("");
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual.subheadline)
    .toBeUndefined();

  await visualType.selectOption("end-card");
  confirmDialog = page.getByRole("dialog", { name: "确认 Visual 切换" });
  await confirmDialog.getByRole("button", { name: "确认切换" }).click();
  await page.getByRole("textbox", { name: "片尾标题" }).fill("操作完成");
  const addBullet = page.getByRole("button", { name: "添加片尾要点" });
  await addBullet.click();
  await addBullet.click();
  await addBullet.click();
  await addBullet.click();
  await page.getByRole("textbox", { name: "片尾要点 1" }).fill("关闭设备");
  await page.getByRole("textbox", { name: "片尾要点 2" }).fill("整理耗材");
  await page.getByRole("textbox", { name: "片尾要点 3" }).fill("记录结果");
  await page.getByRole("textbox", { name: "片尾要点 4" }).fill("签字确认");
  await page.getByRole("button", { name: "上移片尾要点 4" }).click();
  await page.getByRole("button", { name: "删除片尾要点 2" }).click();
  await expect(page.getByRole("status")).toContainText("3 条有效要点");
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].visual)
    .toEqual({
      type: "end-card",
      title: "操作完成",
      bullets: ["关闭设备", "签字确认", "记录结果"],
    });

  await page.reload();
  await expect(page.getByRole("textbox", { name: "片尾标题" })).toHaveValue(
    "操作完成",
  );
  await expect(page.getByRole("textbox", { name: /片尾要点 \d/ })).toHaveCount(3);
});

test("鼠标与键盘重排保持 Scene ID 并拒绝越过 Title 与 EndCard 锚点", async ({ page }) => {
  const ids = {
    title: "25429f3f-0ae8-43de-af21-e308b47f7c64",
    first: "f644507c-c988-42a1-aa3d-293e4044a98e",
    second: "6fed7ce7-d6fb-475a-b56a-9e24d7ac7f1c",
    end: "59a165fe-50a1-4a4a-b7c1-9e8bbce18220",
  };
  await writeFile(
    projectFile,
    `${JSON.stringify({
      schemaVersion: 1,
      metadata: {},
      assets: [],
      scenes: [
        { id: ids.title, narration: { text: "Title" }, visual: { type: "title", device: "NC", headline: "开始" }, transition: "cut" },
        { id: ids.first, narration: { text: "Scene A" }, visual: { type: "image" }, transition: "cut" },
        { id: ids.second, narration: { text: "Scene B" }, visual: { type: "video" }, transition: "cut" },
        { id: ids.end, narration: { text: "End" }, visual: { type: "end-card", title: "结束", bullets: [] }, transition: "cut" },
      ],
    })}\n`,
  );
  await page.goto(server.url);
  const order = () =>
    page.getByTestId("scene-row").evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-scene-id")),
    );
  const row = (sceneId: string) => page.locator(`[data-scene-id="${sceneId}"]`);

  await row(ids.second).click();
  await row(ids.second).getByRole("button", { name: /重排 Scene/ }).dragTo(row(ids.first));
  await expect.poll(order).toEqual([ids.title, ids.second, ids.first, ids.end]);
  await expect(page.getByTestId("inspector-scene")).toContainText("Scene 02");
  await expect(page.getByTestId("player-subtitle")).toHaveText("Scene B");

  const keyboardHandle = row(ids.second).getByRole("button", { name: /重排 Scene/ });
  await keyboardHandle.focus();
  await keyboardHandle.press("Space");
  await expect(keyboardHandle).toHaveAttribute("aria-pressed", "true");
  await keyboardHandle.press("ArrowDown");
  await keyboardHandle.press("Enter");
  await expect.poll(order).toEqual([ids.title, ids.first, ids.second, ids.end]);
  await expect(row(ids.second).getByRole("button", { name: /重排 Scene/ })).toBeFocused();
  await expect(page.getByTestId("inspector-scene")).toContainText("Scene 03");

  await row(ids.title).getByRole("button", { name: /重排 Scene/ }).dragTo(row(ids.second));
  await expect(page.getByRole("status", { name: "重排提示" })).toHaveText(
    "Title 只能位于开头",
  );
  await expect.poll(order).toEqual([ids.title, ids.first, ids.second, ids.end]);

  const endHandle = row(ids.end).getByRole("button", { name: /重排 Scene/ });
  await endHandle.focus();
  await endHandle.press("Space");
  await endHandle.press("ArrowUp");
  await expect(page.getByRole("status", { name: "重排提示" })).toHaveText(
    "End Card 只能位于结尾",
  );
  await endHandle.press("Escape");

  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes.map((scene: { id: string }) => scene.id))
    .toEqual([ids.title, ids.first, ids.second, ids.end]);
  await page.reload();
  await expect.poll(order).toEqual([ids.title, ids.first, ids.second, ids.end]);

  await page.getByRole("button", { name: "新增一条", exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes.length)
    .toBe(5);
  const orderAfterInsert = JSON.parse(await readFile(projectFile, "utf8")).scenes.map(
    (scene: { id: string }) => scene.id,
  );
  expect(orderAfterInsert.slice(0, 3)).toEqual([ids.title, ids.first, ids.second]);
  expect(orderAfterInsert.at(-1)).toBe(ids.end);

  const invalidProject = JSON.parse(await readFile(projectFile, "utf8"));
  invalidProject.scenes = [invalidProject.scenes[1], invalidProject.scenes[0], ...invalidProject.scenes.slice(2)];
  await writeFile(projectFile, `${JSON.stringify(invalidProject)}\n`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Project DSL 校验失败" })).toBeVisible();
  await page.getByRole("button", { name: "查看技术详情" }).click();
  await expect(page.getByTestId("error-details")).toContainText(
    "TITLE_SCENE_POSITION_INVALID",
  );
});

test("批量草稿可整理和取消且确认前不会写入 Project DSL", async ({
  page,
}) => {
  await writeFile(
    projectFile,
    '{"schemaVersion":1,"metadata":{"name":"空项目"},"assets":[],"scenes":[]}\n',
  );
  await page.goto(server.url);

  await expect(page.getByRole("heading", { name: "从第一句讲解开始" })).toBeVisible();
  await page.getByRole("button", { name: "粘贴多行 Narration" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName("粘贴多行 Narration");
  const original = "  第一句 Narration  \n \t\nCafe\u0301\n第三句 Narration  ";
  await dialog.getByRole("textbox", { name: "原文" }).fill(original);
  await dialog.getByRole("button", { name: "整理拆分" }).click();

  await expect(dialog.getByText("3 条将创建为 Scene")).toBeVisible();
  await expect(dialog.getByText("1 个空白行已忽略")).toBeVisible();
  const drafts = dialog.getByRole("textbox", { name: /拆分结果/ });
  await expect(drafts).toHaveCount(3);
  await expect(drafts.nth(0)).toHaveValue("  第一句 Narration  ");
  await expect(drafts.nth(1)).toHaveValue("Cafe\u0301");
  await expect(drafts.nth(2)).toHaveValue("第三句 Narration  ");
  expect(JSON.parse(await readFile(projectFile, "utf8")).scenes).toEqual([]);

  await drafts.nth(1).fill("已编辑");
  await dialog.getByRole("button", { name: "删除第 3 行" }).click();
  await dialog.getByRole("button", { name: "将第 2 行并入上一行" }).click();
  await expect(dialog.getByRole("textbox", { name: "拆分结果 1" })).toHaveValue(
    "  第一句 Narration  \n已编辑",
  );

  await dialog.getByRole("button", { name: "返回原文" }).click();
  await expect(dialog.getByRole("textbox", { name: "原文" })).toHaveValue(original);
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "从第一句讲解开始" })).toBeVisible();
  expect(JSON.parse(await readFile(projectFile, "utf8")).scenes).toEqual([]);
});

test("批量确认默认创建 Video Scene 并在重新打开后完整恢复", async ({ page }) => {
  await writeFile(
    projectFile,
    '{"schemaVersion":1,"metadata":{"name":"空项目"},"assets":[],"scenes":[]}\n',
  );
  await page.goto(server.url);

  await page.getByRole("button", { name: "粘贴多行 Narration" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "原文" }).fill(
    "  第一句保留空格  \n第二句\nCafe\u0301",
  );
  await dialog.getByRole("button", { name: "整理拆分" }).click();
  await dialog.getByRole("button", { name: "创建 Scene", exact: true }).click();

  await expect(page.getByTestId("scene-row")).toHaveCount(3);
  await expect(page.getByTestId("player-subtitle")).toHaveText(
    "  第一句保留空格  ",
  );
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes.length)
    .toBe(3);
  const savedProject = JSON.parse(await readFile(projectFile, "utf8"));
  expect(savedProject).toMatchObject({
      scenes: [
        { narration: { text: "  第一句保留空格  " }, visual: { type: "video" } },
        { narration: { text: "第二句" }, visual: { type: "video" } },
        { narration: { text: "Cafe\u0301" }, visual: { type: "video" } },
      ],
    });
  const sceneIds = savedProject.scenes.map((scene: { id: string }) => scene.id);

  await server.close();
  server = await startNarracutServer({
    projectDirectory: resolve(projectFile, ".."),
    staticDirectory: resolve("dist/client"),
    initialPort: 0,
  });
  await page.goto(server.url);
  await expect(page.getByTestId("scene-row")).toHaveCount(3);
  await expect(page.getByTestId("player-subtitle")).toHaveText(
    "  第一句保留空格  ",
  );
  const reopenedProject = JSON.parse(await readFile(projectFile, "utf8"));
  expect(reopenedProject.scenes.map((scene: { id: string }) => scene.id)).toEqual(
    sceneIds,
  );
  expect(reopenedProject.scenes.map((scene: { narration: { text: string } }) => scene.narration.text)).toEqual([
    "  第一句保留空格  ",
    "第二句",
    "Cafe\u0301",
  ]);
});

test("已有 Scene 后可整批选择 Image 且不会截断大量 Narration", async ({ page }) => {
  await writeFile(
    projectFile,
    '{"schemaVersion":1,"metadata":{"name":"空项目"},"assets":[],"scenes":[]}\n',
  );
  await page.goto(server.url);

  await page.getByRole("button", { name: "粘贴多行 Narration" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "原文" }).fill("首条 Video");
  await dialog.getByRole("button", { name: "整理拆分" }).click();
  await dialog.getByRole("button", { name: "创建 Scene", exact: true }).click();
  await expect(page.getByTestId("scene-row")).toHaveCount(1);

  await page.getByRole("button", { name: "批量添加" }).click();
  dialog = page.getByRole("dialog");
  const imageNarrations = Array.from(
    { length: 120 },
    (_, index) => `Image Scene ${index + 1}`,
  );
  await dialog.getByRole("textbox", { name: "原文" }).fill(imageNarrations.join("\n"));
  await dialog.getByRole("button", { name: "整理拆分" }).click();
  await expect(dialog.getByText("120 条将创建为 Scene")).toBeVisible();
  await dialog.getByRole("radio", { name: "Image" }).check();
  await dialog.getByRole("button", { name: "创建 Scene", exact: true }).click();

  await expect(page.getByTestId("scene-row")).toHaveCount(121);
  await expect(page.getByTestId("player-subtitle")).toHaveText("Image Scene 1");
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes.length)
    .toBe(121);
  const savedProject = JSON.parse(await readFile(projectFile, "utf8"));
  expect(savedProject.scenes[0].visual).toEqual({ type: "video" });
  expect(savedProject.scenes.slice(1).every(
    (scene: { visual: { type: string } }) => scene.visual.type === "image",
  )).toBe(true);
  expect(savedProject.scenes.slice(1).map(
    (scene: { narration: { text: string } }) => scene.narration.text,
  )).toEqual(imageNarrations);
});

test("点击新增一条直接创建空 Narration 的 Video Scene", async ({ page }) => {
  await writeFile(
    projectFile,
    '{"schemaVersion":1,"metadata":{"name":"空项目"},"assets":[],"scenes":[]}\n',
  );
  const savedBodies: Array<{ scenes: Array<{ narration: { text: string }; visual: { type: string } }> }> = [];
  await page.route("**/api/project", async (route) => {
    if (route.request().method() === "PUT") {
      savedBodies.push(route.request().postDataJSON());
    }
    await route.continue();
  });
  await page.goto(server.url);

  await page.getByRole("button", { name: "新增一条", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("scene-row")).toHaveCount(1);
  await expect(page.getByTestId("player-subtitle")).toHaveText("请输入 Narration");
  await expect(page.getByTestId("inspector-scene")).toContainText("Scene 01");
  await expect(page.getByRole("textbox", { name: "Scene 1 Narration" })).toBeFocused();

  await page.getByRole("button", { name: "新增一条", exact: true }).click();
  await expect(page.getByTestId("scene-row")).toHaveCount(2);
  await expect(page.getByTestId("inspector-scene")).toContainText("Scene 02");
  await expect(page.getByRole("textbox", { name: "Scene 2 Narration" })).toBeFocused();
  await expect.poll(() => savedBodies.length).toBe(2);
  expect(savedBodies[0].scenes).toMatchObject([
    { narration: { text: "" }, visual: { type: "video" } },
  ]);
  expect(savedBodies[1].scenes).toMatchObject([
    { narration: { text: "" }, visual: { type: "video" } },
    { narration: { text: "" }, visual: { type: "video" } },
  ]);
});

test("新增一条后自动滚动到新增 Scene 并聚焦其 Narration", async ({ page }) => {
  await writeFile(
    projectFile,
    await readFile(resolve("docs/spec/project.example.json")),
  );
  await page.goto(server.url);

  const sceneRows = page.getByTestId("scene-row");
  const tableScroll = page.locator(".table-wrap");
  await expect(sceneRows).toHaveCount(13);
  await tableScroll.evaluate((element) => {
    element.setAttribute("data-scroll-samples", "");
    element.addEventListener("scroll", () => {
      const samples = element.getAttribute("data-scroll-samples") ?? "";
      element.setAttribute("data-scroll-samples", `${samples}${element.scrollTop},`);
    });
  });
  await page.getByRole("button", { name: "新增一条", exact: true }).click();

  await expect(sceneRows).toHaveCount(14);
  await expect(page.getByTestId("inspector-scene")).toContainText("Scene 14");
  await expect(page.getByRole("textbox", { name: "Scene 14 Narration" })).toBeFocused();
  await expect(sceneRows.last()).toBeInViewport();
  await expect(sceneRows.first()).not.toBeInViewport();
  await expect.poll(() => tableScroll.evaluate(
    (element) => element.scrollTop === element.scrollHeight - element.clientHeight,
  )).toBe(true);
  const scrollState = await tableScroll.evaluate((element) => ({
    current: element.scrollTop,
    maximum: element.scrollHeight - element.clientHeight,
    samples: (element.getAttribute("data-scroll-samples") ?? "")
      .split(",")
      .filter(Boolean)
      .map(Number),
  }));
  expect(scrollState.current).toBe(scrollState.maximum);
  expect(scrollState.samples.some(
    (position) => position > 0 && position < scrollState.maximum,
  )).toBe(true);
});

test("加载过程中显示既定工作台骨架与明确步骤", async ({ page }) => {
  await writeFile(
    projectFile,
    '{"schemaVersion":1,"metadata":{},"assets":[],"scenes":[]}\n',
  );
  await page.route("**/api/project", async (route) => {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    await route.continue();
  });

  const navigation = page.goto(server.url);
  await expect(page.getByRole("heading", { name: "正在打开项目" })).toBeVisible();
  await expect(page.getByText("校验 Scene 与持久引用")).toBeVisible();
  await navigation;
  await expect(page.getByRole("heading", { name: "从第一句讲解开始" })).toBeVisible();
});

test("无效 DSL 显示诊断且重新加载前后原始字节不变", async ({ page }) => {
  const originalBytes = '{"schemaVersion":1,"assets":[],"scenes":[]}\n';
  await writeFile(projectFile, originalBytes);
  await page.goto(server.url);

  await expect(page.getByRole("heading", { name: "Project DSL 校验失败" })).toBeVisible();
  await page.getByRole("button", { name: "查看技术详情" }).click();
  await expect(page.getByTestId("error-details")).toContainText("DSL_STRUCTURE_INVALID");
  expect(await readFile(projectFile, "utf8")).toBe(originalBytes);
});

test("未知新 schemaVersion 进入只读阻断并保持原始字节不变", async ({
  page,
}) => {
  const project = JSON.parse(
    await readFile(resolve("docs/spec/project.example.json"), "utf8"),
  );
  project.schemaVersion = CURRENT_FUTURE_VERSION;
  project.futureRuntime = { jobs: true };
  const originalBytes = `${JSON.stringify(project)}\n`;
  await writeFile(projectFile, originalBytes);

  await page.goto(server.url);
  await expect(page.getByText("需要升级 Narracut 才能编辑")).toBeVisible();
  await expect(page.getByText(`只读模式`)).toBeVisible();
  await expect(page.getByRole("button", { name: /任务/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /检查并渲染/ })).toBeDisabled();
  await expect(page.locator("tbody tr")).toHaveCount(13);
  expect(await readFile(projectFile, "utf8")).toBe(originalBytes);
});

test("连续编辑按顺序保存，较旧请求不会覆盖最新 Narration", async ({ page }) => {
  await writeFile(
    projectFile,
    await readFile(resolve("docs/spec/project.example.json")),
  );
  let putCount = 0;
  await page.route("**/api/project", async (route) => {
    if (route.request().method() === "PUT") {
      putCount += 1;
      if (putCount === 1) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 900));
      }
    }
    await route.continue();
  });
  await page.goto(server.url);
  const narration = page.getByRole("textbox", { name: "Scene 1 Narration" });

  await narration.fill("较旧的 Narration");
  await page.waitForTimeout(600);
  await narration.fill("最新的 Narration");

  await expect
    .poll(async () => {
      const project = JSON.parse(await readFile(projectFile, "utf8"));
      return project.scenes[0].narration.text;
    })
    .toBe("最新的 Narration");
  expect(putCount).toBe(2);
});

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
  await server.releaseProjectLease();
});

test("现有 13 Scene 示例进入完整三栏工作台并显示当前 Scene 列表", async ({
  page,
}) => {
  await page.goto(server.url);

  await expect(page.getByRole("heading", { name: "脚本表" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Player" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "属性" })).toBeVisible();
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
  const inspector = page.getByTestId("inspector-scene");
  await expect(inspector).toContainText("场景 02");
  await expect(inspector.getByRole("textbox", { name: "旁白文稿（同时作为底部字幕）" })).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "画面说明" })).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "画面素材" })).toBeVisible();
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
  await expect(page.getByTestId("inspector-scene")).toContainText("场景 01");
  await expect(page.getByRole("textbox", { name: "Scene 1 Narration" })).toBeFocused();

  await page.getByRole("button", { name: "新增一条", exact: true }).click();
  await expect(page.getByTestId("scene-row")).toHaveCount(2);
  await expect(page.getByTestId("inspector-scene")).toContainText("场景 02");
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
  await expect(page.getByTestId("inspector-scene")).toContainText("场景 14");
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

test("800ms 防抖窗口内只写最新 Narration", async ({ page }) => {
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
  expect(putCount).toBe(1);
});

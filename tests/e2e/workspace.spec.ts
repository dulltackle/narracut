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
  await expect(page.getByTestId("scene-row")).toHaveCount(13);
  await expect(page.getByText("宫腔通液治疗仪操作演示")).toBeVisible();

  await page.getByTestId("scene-row").nth(1).click();
  await expect(page.getByTestId("inspector-scene")).toContainText("Scene 02");
  await expect(page.getByTestId("player-subtitle")).toHaveText(
    "从球囊连接管套装中取出连接管",
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

test("逐条新增以完整的 Image 或 Video 分支一次性创建 Scene", async ({ page }) => {
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
  let dialog = page.getByRole("dialog", { name: "新增一条 Scene" });
  await dialog.getByRole("radio", { name: "Image" }).check();
  await dialog.getByRole("button", { name: "创建 Scene", exact: true }).click();

  await expect(page.getByTestId("scene-row")).toHaveCount(1);
  await expect(page.getByTestId("player-subtitle")).toHaveText("请输入 Narration");
  await page.getByRole("button", { name: "新增一条", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "新增一条 Scene" });
  await dialog.getByRole("textbox", { name: "Narration（可暂时为空）" }).fill(
    "第二条 Narration",
  );
  await dialog.getByRole("button", { name: "创建 Scene", exact: true }).click();

  await expect(page.getByTestId("scene-row")).toHaveCount(2);
  await expect(page.getByTestId("player-subtitle")).toHaveText("第二条 Narration");
  await expect.poll(() => savedBodies.length).toBe(2);
  expect(savedBodies[0].scenes).toMatchObject([
    { narration: { text: "" }, visual: { type: "image" } },
  ]);
  expect(savedBodies[1].scenes).toMatchObject([
    { narration: { text: "" }, visual: { type: "image" } },
    { narration: { text: "第二条 Narration" }, visual: { type: "video" } },
  ]);
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

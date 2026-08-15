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

test("空 Project DSL 在脚本表原位粘贴多行 Narration 并创建 Scene", async ({
  page,
}) => {
  await writeFile(
    projectFile,
    '{"schemaVersion":1,"metadata":{"name":"空项目"},"assets":[],"scenes":[]}\n',
  );
  await page.goto(server.url);

  await expect(page.getByRole("heading", { name: "从第一句讲解开始" })).toBeVisible();
  await page.getByRole("button", { name: "粘贴多行文案" }).click();
  const dialog = page.getByRole("dialog", { name: "从多行文案创建 Scene" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill("第一句 Narration\n\n第二句 Narration\n第三句 Narration");
  await expect(dialog.getByText("将创建 3 个 Scene")).toBeVisible();
  await dialog.getByRole("button", { name: "创建 3 个 Scene" }).click();

  await expect(page.getByTestId("scene-row")).toHaveCount(3);
  await expect(page.getByTestId("player-subtitle")).toHaveText("第一句 Narration");
  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes.length).toBe(3);
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

import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { startNarracutServer, type RunningServer } from "../../src/server/server";

let server: RunningServer;
let projectDirectory: string;
let projectFile: string;

const sceneId = "27000000-0000-4000-8000-000000000001";

function projectFixture(name = "可靠保存测试") {
  return {
    schemaVersion: 3,
    metadata: { name },
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
        narration: { text: "原始旁白" },
        visual: { type: "card", title: "可靠保存" },
        transition: "cut",
      },
    ],
  };
}

async function writeProject(project: unknown) {
  await writeFile(projectFile, `${JSON.stringify(project)}\n`);
}

test.beforeEach(async () => {
  projectDirectory = await mkdtemp(join(tmpdir(), "narracut-persistence-e2e-"));
  projectFile = join(projectDirectory, "project.json");
  await writeProject(projectFixture());
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    initialPort: 0,
  });
});

test.afterEach(async () => {
  await server.close();
});

test("文本保存使用 800ms 尾随、1000ms max-wait，并在页面隐藏时 flush", async ({ page }) => {
  const putTimes: number[] = [];
  await page.route("**/api/project", async (route) => {
    if (route.request().method() === "PUT") putTimes.push(Date.now());
    await route.continue();
  });
  await page.goto(server.url);
  await expect(page.getByTestId("global-workbench")).toBeVisible();
  const narration = page.getByRole("textbox", { name: "Scene 1 Narration" });

  await narration.fill("尾随保存");
  await expect(page.getByTestId("save-status")).toContainText("待保存");
  await page.waitForTimeout(650);
  expect(putTimes).toHaveLength(0);
  await expect.poll(() => putTimes.length).toBe(1);

  putTimes.length = 0;
  for (let index = 0; index < 5; index += 1) {
    await narration.fill(`持续输入 ${index}`);
    await page.waitForTimeout(250);
  }
  expect(putTimes.length).toBeGreaterThanOrEqual(1);

  putTimes.length = 0;
  await narration.fill("页面隐藏立即保存");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => putTimes.length).toBe(1);
  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].narration.text).toBe("页面隐藏立即保存");
});

test("写入期间只保留最新 DSL，最多一个 PUT，Undo 回到已保存内容会清除 dirty", async ({ page }) => {
  let inFlight = 0;
  let maxInFlight = 0;
  let putCount = 0;
  const parseFailures: string[] = [];
  const atomicityCheck = (async () => {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      try {
        JSON.parse(await readFile(projectFile, "utf8"));
      } catch (error) {
        parseFailures.push(error instanceof Error ? error.message : "项目文件不完整");
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2));
    }
  })();
  await page.route("**/api/project", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    putCount += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    await route.continue();
    inFlight -= 1;
  });
  await page.goto(server.url);
  const projectName = page.getByRole("button", { name: "编辑项目名" });

  await projectName.click();
  await page.getByRole("textbox", { name: "项目名" }).fill("保存 A");
  await page.getByRole("textbox", { name: "项目名" }).press("Enter");
  await expect.poll(() => inFlight).toBe(1);
  for (const name of ["保存 B", "保存 C"]) {
    await page.getByRole("button", { name: "编辑项目名" }).click();
    await page.getByRole("textbox", { name: "项目名" }).fill(name);
    await page.getByRole("textbox", { name: "项目名" }).press("Enter");
  }

  await expect(page.getByTestId("save-status")).toContainText("已保存", { timeout: 5_000 });
  await atomicityCheck;
  expect(maxInFlight).toBe(1);
  expect(putCount).toBe(2);
  expect(parseFailures).toEqual([]);
  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8")).metadata.name).toBe("保存 C");

  await page.getByRole("textbox", { name: "Scene 1 Narration" }).fill("尚未写盘");
  await page.getByRole("button", { name: "撤销：编辑 Scene 01 旁白" }).click();
  await expect(page.getByTestId("save-status")).toContainText("已保存");
});

test("I/O 失败按 1s、2s、4s 重试，永久失败可就地立即重试", async ({ page }) => {
  const attempts: number[] = [];
  let allowSuccess = false;
  await page.route("**/api/project", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    attempts.push(Date.now());
    if (allowSuccess) await route.continue();
    else await route.fulfill({ status: 500, body: "模拟磁盘故障" });
  });
  await page.goto(server.url);
  await page.getByRole("button", { name: "编辑项目名" }).click();
  await page.getByRole("textbox", { name: "项目名" }).fill("等待重试");
  await page.getByRole("textbox", { name: "项目名" }).press("Enter");

  await expect(page.getByTestId("save-status")).toContainText("保存重试 1/3");
  await expect(page.getByTestId("save-status")).toContainText("保存失败", { timeout: 9_000 });
  expect(attempts).toHaveLength(4);
  expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(900);
  expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(1_900);
  expect(attempts[3] - attempts[2]).toBeGreaterThanOrEqual(3_900);

  await page.getByTestId("save-status").click();
  await expect(page.getByText("当前修改仍安全保留在内存中")).toBeVisible();
  allowSuccess = true;
  await page.getByRole("button", { name: "立即重试" }).click();
  await expect(page.getByTestId("save-status")).toContainText("已保存");
});

test("外部修订必须显式选择，并分别备份被覆盖的内存或磁盘版本", async ({ page }) => {
  await page.goto(server.url);
  const narration = page.getByRole("textbox", { name: "Scene 1 Narration" });
  await expect(narration).toHaveValue("原始旁白");
  await expect(page.getByTestId("save-status")).toContainText("已保存");

  await writeProject({
    ...projectFixture("clean 外部版本"),
    scenes: [{ ...projectFixture().scenes[0], narration: { text: "clean 外部旁白" } }],
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(narration).toHaveValue("clean 外部旁白");
  let backups = await readdir(projectDirectory);
  const cleanBackup = backups.find((file) => file.includes("external-conflict"));
  expect(cleanBackup).toBeDefined();
  expect(JSON.parse(await readFile(join(projectDirectory, cleanBackup!), "utf8")).scenes[0].narration.text).toBe("原始旁白");

  await narration.fill("需要备份的内存版本");
  await writeProject({
    ...projectFixture("外部版本一"),
    scenes: [{ ...projectFixture().scenes[0], narration: { text: "外部旁白一" } }],
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  const conflict = page.getByRole("alertdialog", { name: "项目文件已在外部更改" });
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "载入磁盘版本" }).click();
  await expect(narration).toHaveValue("外部旁白一");
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeDisabled();
  backups = await readdir(projectDirectory);
  const backupNarrations = await Promise.all(
    backups
      .filter((file) => file.includes("external-conflict"))
      .map(async (file) => ({
        file,
        narration: JSON.parse(await readFile(join(projectDirectory, file), "utf8"))
          .scenes[0].narration.text,
      })),
  );
  const memoryBackup = backupNarrations.find(
    ({ narration: text }) => text === "需要备份的内存版本",
  )?.file;
  expect(memoryBackup).toBeDefined();
  expect(JSON.parse(await readFile(join(projectDirectory, memoryBackup!), "utf8")).scenes[0].narration.text).toBe("需要备份的内存版本");

  await narration.fill("最终保留的内存版本");
  await writeProject({
    ...projectFixture("外部版本二"),
    scenes: [{ ...projectFixture().scenes[0], narration: { text: "需要备份的磁盘版本" } }],
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "保留当前版本" }).click();
  await expect(page.getByTestId("save-status")).toContainText("已保存");
  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes[0].narration.text).toBe("最终保留的内存版本");
  backups = await readdir(projectDirectory);
  const diskBackups = backups.filter((file) => file.includes("external-conflict"));
  expect(diskBackups).toHaveLength(3);
  const backedUpNarrations = await Promise.all(diskBackups.map(async (file) => JSON.parse(await readFile(join(projectDirectory, file), "utf8")).scenes[0].narration.text));
  expect(backedUpNarrations).toContain("需要备份的磁盘版本");
});

test("旧 DSL 首次写回前备份原始字节，第二个标签页保持只读直到取得租约", async ({ browser }) => {
  const original = `${JSON.stringify({
    schemaVersion: 2,
    metadata: { name: "待迁移项目" },
    assets: [],
    scenes: [
      {
        id: sceneId,
        narration: { text: "旧版本旁白" },
        visual: { type: "card", title: "旧版本" },
        transition: "cut",
      },
    ],
  })}\n`;
  await writeFile(projectFile, original);
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await first.goto(server.url);
    await expect(first.getByTestId("migration-banner")).toBeVisible();
    expect(await readFile(projectFile, "utf8")).toBe(original);

    await second.goto(server.url);
    await expect(second.getByTestId("lease-banner")).toContainText("此项目正在另一个标签页中编辑");
    await expect(second.getByRole("textbox", { name: "Scene 1 Narration" })).toBeDisabled();

    await first.getByRole("button", { name: "编辑项目名" }).click();
    await first.getByRole("textbox", { name: "项目名" }).fill("迁移后项目");
    await first.getByRole("textbox", { name: "项目名" }).press("Enter");
    await expect(first.getByTestId("save-status")).toContainText("已保存");
    const backups = await readdir(projectDirectory);
    const migrationBackup = backups.find((file) => file.includes("pre-migration"));
    expect(migrationBackup).toBeDefined();
    expect(await readFile(join(projectDirectory, migrationBackup!), "utf8")).toBe(original);

    await firstContext.close();
    await second.getByRole("button", { name: "重新检查编辑权" }).click();
    await expect(second.getByRole("textbox", { name: "Scene 1 Narration" })).toBeEnabled({ timeout: 10_000 });
    await expect(second.getByTestId("lease-banner")).toHaveCount(0);
    await expect(second.getByRole("textbox", { name: "Scene 1 Narration" })).toHaveValue("旧版本旁白");
  } finally {
    await firstContext.close().catch(() => undefined);
    await secondContext.close();
  }
});

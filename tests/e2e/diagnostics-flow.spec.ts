import { EventEmitter } from "node:events";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import type { RenderWorkerHandle, RenderWorkerInput } from "../../src/server/render-jobs";
import { startNarracutServer, type RunningServer } from "../../src/server/server";
import { DEFAULT_PROJECT_THEME, type Project } from "../../src/shared/project";

const sceneIds = [
  "73000000-0000-4000-8000-000000000001",
  "73000000-0000-4000-8000-000000000002",
];

class FakeWorker extends EventEmitter implements RenderWorkerHandle {
  kill(): boolean {
    this.emit("exit", null, "SIGTERM");
    return true;
  }
}

let server: RunningServer | undefined;

test.afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(project: Project, workerFactory?: (input: RenderWorkerInput) => RenderWorkerHandle) {
  const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-diagnostics-ui-"));
  await writeFile(join(projectDirectory, "project.json"), `${JSON.stringify(project)}\n`);
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    host: "127.0.0.1",
    initialPort: 0,
    renderWorkerFactory: workerFactory,
  });
  return { projectDirectory, url: server.url };
}

function draftProject(): Project {
  return {
    schemaVersion: 3,
    metadata: { name: "诊断闭环" },
    theme: { ...DEFAULT_PROJECT_THEME, accentColor: "#0F172A" },
    assets: [],
    scenes: [
      {
        id: sceneIds[0],
        narration: { text: "" },
        visual: { type: "card", title: "第一幕" },
        transition: "cut",
      },
      {
        id: sceneIds[1],
        narration: { text: "第二幕旁白" },
        visual: { type: "card", title: "第二幕" },
        transition: "cut",
      },
    ],
  };
}

test("混合 error/warning 在表格、Inspector 与全局队列中排序、过滤并准确定位", async ({ page }) => {
  const running = await start(draftProject());
  await page.goto(running.url);

  await expect(page.getByRole("button", { name: "检查并渲染 · 3" })).toBeVisible();
  const rows = page.getByTestId("scene-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByRole("button", { name: "阻断：补充 Narration，另有 1 项" })).toBeVisible();

  await rows.first().getByRole("button", { name: "阻断：补充 Narration，另有 1 项" }).click();
  await expect(page.getByRole("heading", { name: "问题 · 2" })).toBeVisible();
  await expect(page.locator(".scene-problem").first()).toBeFocused();
  await expect(page.locator(".scene-problem").first()).toContainText("NARRATION_EMPTY");

  await page.getByRole("button", { name: "待修复" }).click();
  await expect(page.getByText("2 / 2 个 Scene", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "检查并渲染 · 3" }).click();
  await expect(page.getByText("3 个阻断 · 1 个提醒", { exact: true })).toBeVisible();
  await expect(page.getByText("涉及 2 个 Scene", { exact: true })).toBeVisible();
  const queue = page.locator(".diagnostic-queue > button");
  await expect(queue).toHaveCount(4);
  await expect(queue.nth(0)).toContainText("Scene 01 · Narration");
  await expect(queue.nth(1)).toContainText("Scene 01 · Speech");
  await expect(queue.nth(2)).toContainText("Scene 02 · Speech");
  await expect(queue.nth(3)).toContainText("项目 · 品牌强调色");

  await queue.nth(2).click();
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 02");
    await expect(
      rows.nth(1).getByRole("button", { name: "生成 Speech", exact: true }),
    ).toBeFocused();
});

test("Asset 错误只降级画面层，Caption、Subtitle 与 Draft Duration 仍可信可见", async ({ page }) => {
  const project = draftProject();
  project.theme.accentColor = DEFAULT_PROJECT_THEME.accentColor;
  project.scenes = [{
    id: sceneIds[0],
    narration: { text: "可信 Subtitle" },
    visual: { type: "image", caption: { text: "可信 Caption" } },
    transition: "cut",
  }];
  const running = await start(project);
  await page.goto(running.url);

  await expect(page.getByText("尚未绑定 Asset", { exact: true })).toBeVisible();
  await expect(page.getByTestId("composition-text-block")).toContainText("可信 Caption");
  await expect(page.getByTestId("player-subtitle")).toContainText("可信 Subtitle");
  await expect(page.getByTestId("player-draft-state")).toContainText("仅供预览");
  await expect(page.getByRole("button", { name: /当前 Asset 不可用/ })).toBeVisible();
});

test("待修复中的最后一行完成修复后把焦点送回过滤器", async ({ page }) => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-diagnostics-focus-"));
  const project = await renderReadyProject(projectDirectory);
  project.theme.accentColor = DEFAULT_PROJECT_THEME.accentColor;
  project.scenes = [{
    ...project.scenes[0],
    visual: { type: "image" },
  }];
  await writeFile(join(projectDirectory, "project.json"), `${JSON.stringify(project)}\n`);
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    host: "127.0.0.1",
    initialPort: 0,
  });
  await page.goto(server.url);

  await page.getByRole("button", { name: "待修复" }).click();
  await page.getByRole("button", { name: "导入图片" }).focus();
  await page.getByLabel("为 Scene 1 选择图片").setInputFiles(
    resolve("fixtures/demo/assets/10000000-0000-4000-8000-000000000001.png"),
  );

  await expect(page.getByRole("button", { name: "待修复" })).toBeFocused({ timeout: 30_000 });
  await expect(page.locator(".filtered-empty")).toContainText("全部问题已处理");
});

test("字体缺字项目仍可打开并从 Inspector 定位修复", async ({ page }) => {
  const project = draftProject();
  project.theme.accentColor = DEFAULT_PROJECT_THEME.accentColor;
  project.scenes = [{
    ...project.scenes[1],
    narration: { text: "待替换字符：\u{10FFFF}" },
  }];
  const running = await start(project);
  await page.goto(running.url);

  await expect(page.getByTestId("global-workbench")).toBeVisible();
  await expect(page.getByRole("heading", { name: /问题/ })).toBeVisible();
  await expect(page.getByText("U+10FFFF", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "前往 Narration" }).first().click();
  await expect(page.getByRole("textbox", { name: "Scene 1 Narration" })).toBeFocused();
});

async function renderReadyProject(projectDirectory: string): Promise<Project> {
  await mkdir(join(projectDirectory, "speech"), { recursive: true });
  const fixture = resolve("fixtures/demo/speech/20000000-0000-4000-8000-000000000001.mp3");
  const scenes = [];
  for (const [index, sceneId] of sceneIds.entries()) {
    await copyFile(fixture, join(projectDirectory, "speech", `${sceneId}.mp3`));
    const narration = `可渲染 Scene ${index + 1}`;
    const { createHash } = await import("node:crypto");
    scenes.push({
      id: sceneId,
      narration: { text: narration },
      speech: {
        path: `speech/${sceneId}.mp3`,
        durationMs: 100,
        sourceTextHash: `sha256:${createHash("sha256").update(narration).digest("hex")}`,
        ttsProfileId: "narracut-mandarin-news-v1",
      },
      visual: { type: "card" as const, title: `Scene ${index + 1}` },
      transition: "cut" as const,
    });
  }
  return {
    schemaVersion: 3,
    metadata: { name: "warning-only" },
    theme: { ...DEFAULT_PROJECT_THEME, accentColor: "#0F172A" },
    assets: [],
    scenes,
  };
}

test("warning-only 直接渲染，renderer Sequence 错误可返回对应 Scene", async ({ page }) => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-diagnostics-render-"));
  const project = await renderReadyProject(projectDirectory);
  await writeFile(join(projectDirectory, "project.json"), `${JSON.stringify(project)}\n`);
  const worker = new FakeWorker();
  let workerInput: RenderWorkerInput | undefined;
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    host: "127.0.0.1",
    initialPort: 0,
    renderWorkerFactory: (input) => {
      workerInput = input;
      return worker;
    },
  });
  await page.goto(server.url);

  await page.getByRole("button", { name: "渲染 MP4" }).click();
  await expect(page.getByText("当前渲染", { exact: true })).toBeVisible();
  expect(workerInput).toBeDefined();

  worker.emit("message", {
    type: "failed",
    code: "RENDER_SEQUENCE_FAILED",
    message: "第二幕渲染失败",
    sequenceName: `Scene ${sceneIds[1]}`,
    frameRange: { startFrame: 3, endFrame: 5 },
  });
  await page.getByRole("button", { name: /第二幕渲染失败，返回 Scene/ }).click();

  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 02");
  await expect(page.getByTestId("player-playback-state")).toHaveText("已暂停");
});

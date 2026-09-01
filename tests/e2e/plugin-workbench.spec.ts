import { expect, test, type Page } from "@playwright/test";

import { handleRequest } from "../../plugins/narracut/src/server";

type Scene = {
  id: string;
  index: number;
  narration: string;
  assets: Array<{ id: string; path: string }>;
  speech: { status: "available"; durationMs: number } | { status: "missing" };
};

function scene(index: number): Scene {
  return {
    id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    index,
    narration: index === 1
      ? "在每一个认真生活的日常里，总有一些被忽略的细节。"
      : `第 ${index} 个 Scene 的完整 Narration，用于验证可扫描的只读行。`,
    assets: index % 2 === 0
      ? [{ id: `asset-${index}`, path: `assets/scene-${index}.png` }]
      : [],
    speech: index % 3 === 0
      ? { status: "missing" }
      : { status: "available", durationMs: 1600 + index * 100 },
  };
}

function validResult(sceneCount = 5) {
  return {
    status: "valid",
    connection: { status: "connected", readOnly: true },
    project: {
      directory: "/work/projects/product-demo",
      folderName: "product-demo",
      projectId: "10000000-0000-4000-8000-000000000001",
      sceneCount,
      assetCount: Math.floor(sceneCount / 2),
    },
    checks: {
      manifest: { status: "valid", label: "项目清单" },
      dsl: { status: "valid", label: "Project DSL" },
      videoBrief: { status: "valid", label: "video.md", bytes: 28 },
    },
    scenes: Array.from({ length: sceneCount }, (_, index) => scene(index + 1)),
    warnings: [],
  };
}

async function loadWorkbench(page: Page): Promise<void> {
  const resource = await handleRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "resources/read",
    params: { uri: "ui://narracut/workbench-v1.html" },
  }) as { contents: Array<{ text: string }> };
  const html = resource.contents[0]!.text;
  await page.setContent(html, { waitUntil: "domcontentloaded" });
}

async function sendResult(page: Page, structuredContent: unknown): Promise<void> {
  await page.evaluate((result) => {
    window.postMessage({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { structuredContent: result },
    }, "*");
  }, structuredContent);
}

test("初始加载态不会提前宣称连接正常", async ({ page }) => {
  await loadWorkbench(page);

  await expect(page.getByText("连接中", { exact: true })).toBeVisible();
  await expect(page.getByText("连接正常", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("正在连接 Narracut")).toBeVisible();
});

test("有效项目首屏显示连接、身份、双工作区、Scene 与检查结果", async ({ page }) => {
  await loadWorkbench(page);
  await sendResult(page, validResult());

  await expect(page.getByText("连接正常", { exact: true })).toBeVisible();
  await expect(page.getByText("product-demo", { exact: true })).toBeVisible();
  await expect(page.getByText("10000000-0000-4000-8000-000000000001", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "表格工作区" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Agent 工作区" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Scene 01/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("项目清单", { exact: true })).toBeVisible();
  await expect(page.getByText("Project DSL", { exact: true })).toBeVisible();
  await expect(page.getByText("video.md", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Composer" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Composer" })).toHaveAttribute(
    "aria-describedby",
    "composer-disabled-reason",
  );
  await expect(page.getByText("Composer 将在后续功能中启用", { exact: true })).toBeVisible();
});

test("键盘焦点不改变 Scene，显式激活后切换工作区仍保留选择", async ({ page }) => {
  await loadWorkbench(page);
  await sendResult(page, validResult());
  const secondScene = page.getByRole("button", { name: /Scene 02/ });

  await secondScene.focus();
  await expect(page.getByRole("button", { name: /Scene 01/ })).toHaveAttribute("aria-pressed", "true");
  await secondScene.press("Enter");
  await expect(secondScene).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Scene 02" })).toBeVisible();

  await page.getByRole("tab", { name: "Agent 工作区" }).click();
  await expect(page.getByRole("tab", { name: "Agent 工作区" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Scene 02 保持选中", { exact: true })).toBeVisible();
  await expect(page.getByText("Composer 将在后续功能中启用", { exact: true })).toBeVisible();
});

test("零 Scene 与无效项目都有明确、非纯颜色状态", async ({ page }) => {
  await loadWorkbench(page);
  await sendResult(page, validResult(0));
  await expect(page.getByRole("heading", { name: "项目中还没有 Scene" })).toBeVisible();
  await expect(page.getByText("项目有效，可继续只读检查。", { exact: true })).toBeVisible();

  await sendResult(page, {
    status: "invalid",
    connection: { status: "connected", readOnly: true },
    project: { directory: "/work/projects/broken", folderName: "broken" },
    error: {
      code: "PROJECT_CONTENT_INVALID",
      message: "project.json 包含无效字段。",
      diagnostics: [{ code: "PROJECT_DSL_SCHEMA_INVALID", component: "project.json", message: "未知字段 visual。" }],
    },
  });
  await expect(page.getByRole("heading", { name: "项目无法打开" })).toBeVisible();
  await expect(page.getByText("PROJECT_CONTENT_INVALID", { exact: true })).toBeVisible();
  await expect(page.getByText("未知字段 visual。", { exact: true })).toBeVisible();
});

test("一千个 Scene 只渲染可视窗口，长 Narration 可在详情完整读取", async ({ page }) => {
  await loadWorkbench(page);
  const result = validResult(1000);
  result.scenes[0]!.narration = "这是一段很长的 Narration。".repeat(80);
  await sendResult(page, result);

  await expect(page.getByText("1,000 SCENES", { exact: true }).first()).toBeVisible();
  expect(await page.locator("[data-scene-row]").count()).toBeLessThanOrEqual(30);
  await page.getByRole("button", { name: /Scene 01/ }).click();
  await expect(page.getByTestId("scene-narration-detail")).toHaveText(result.scenes[0]!.narration);
});

test("窄面板把项目检查收进可操作抽屉，Composer 仍可见", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 860 });
  await loadWorkbench(page);
  await sendResult(page, validResult());

  await expect(page.getByText("连接正常", { exact: true })).toBeVisible();
  await expect(page.getByText("10000000-0000-4000-8000-000000000001", { exact: true })).toBeVisible();
  const inspectionToggle = page.getByRole("button", { name: "打开项目检查" });
  await expect(inspectionToggle).toBeVisible();
  await inspectionToggle.click();
  await expect(page.getByRole("complementary", { name: "项目检查" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Composer" })).toBeInViewport();
});

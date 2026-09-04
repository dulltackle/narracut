import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

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
      ? [{ id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`, path: `assets/scene-${index}.png` }]
      : [],
    speech: index % 3 === 0
      ? { status: "missing" }
      : { status: "available", durationMs: 1600 + index * 100 },
  };
}

function validResult(sceneCount = 5) {
  const scenes = Array.from({ length: sceneCount }, (_, index) => scene(index + 1));
  const assets = scenes.flatMap((item) => item.assets);
  return {
    status: "valid",
    connection: { status: "connected", readOnly: false },
    writable: true,
    projectRevision: `sha256:${"1".repeat(64)}`,
    projectDsl: {
      assets,
      scenes: scenes.map((item) => ({
        id: item.id,
        narration: { text: item.narration },
        assetIds: item.assets.map((asset) => asset.id),
        ...(item.speech.status === "missing" ? {} : {
          speech: {
            path: `speech/${item.id}.mp3`,
            durationMs: item.speech.durationMs,
            sourceTextHash: `sha256:${createHash("sha256").update(item.narration, "utf8").digest("hex")}`,
            ttsProfileId: "narracut/default",
          },
        }),
      })),
    },
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
    scenes,
    warnings: [],
  };
}

async function installAppToolBridge(
  page: Page,
  handler: (name: string, args: Record<string, any>) => unknown,
): Promise<void> {
  await page.exposeFunction("handleNarracutAppTool", handler);
  await page.evaluate(() => {
    (window as unknown as { openai: unknown }).openai = {
      callTool: (name: string, args: Record<string, unknown>) =>
        (window as unknown as {
          handleNarracutAppTool: (name: string, args: Record<string, unknown>) => unknown;
        }).handleNarracutAppTool(name, args),
    };
  });
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

async function installHostToolBridge(
  page: Page,
  handler: (name: string, args: Record<string, unknown>) => unknown,
): Promise<void> {
  await page.exposeFunction("handleNarracutHostTool", handler);
  await page.evaluate(() => {
    window.addEventListener("message", async (event) => {
      const message = event.data;
      if (message?.jsonrpc !== "2.0" || message.method !== "tools/call") return;
      try {
        const result = await (window as unknown as {
          handleNarracutHostTool: (name: string, args: Record<string, unknown>) => unknown;
        }).handleNarracutHostTool(message.params.name, message.params.arguments ?? {});
        window.postMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: { structuredContent: { hostValidation: result } },
        }, "*");
      } catch (error) {
        window.postMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: error instanceof Error ? error.message : "宿主请求失败" },
        }, "*");
      }
    });
  });
}

test("初始加载态不会提前宣称连接正常", async ({ page }) => {
  await loadWorkbench(page);

  await expect(page.getByText("连接中", { exact: true })).toBeVisible();
  await expect(page.getByText("连接正常", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("正在连接 Narracut")).toBeVisible();
});

test("启动器通过系统文件夹选择完成原子创建并把焦点交给零 Scene 空状态", async ({ page }) => {
  await loadWorkbench(page);
  await page.exposeFunction("pickNarracutDirectory", async (purpose: string) => {
    expect(purpose).toBe("create-parent");
    return { path: "/work/projects" };
  });
  await page.exposeFunction("callNarracutTool", async (name: string, args: Record<string, unknown>) => {
    expect(name).toBe("create_project");
    expect(args).toEqual({
      projectDirectory: "/work/projects/海边采访",
      confirmTemporaryCleanup: false,
    });
    return { structuredContent: { ...validResult(0), operation: "created" } };
  });
  await page.evaluate(() => {
    (window as unknown as { openai: unknown }).openai = {
      selectDirectory: (options: { purpose: string }) =>
        (window as unknown as { pickNarracutDirectory: (purpose: string) => unknown })
          .pickNarracutDirectory(options.purpose),
      callTool: (name: string, args: Record<string, unknown>) =>
        (window as unknown as {
          callNarracutTool: (name: string, args: Record<string, unknown>) => unknown;
        }).callNarracutTool(name, args),
    };
  });
  await sendResult(page, {
    status: "launcher",
    connection: { status: "connected", readOnly: false },
  });

  await expect(page.getByRole("heading", { name: "选择父目录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "原子创建并打开" })).toBeDisabled();
  await page.getByRole("button", { name: "选择父文件夹" }).click();
  await page.getByRole("textbox", { name: "项目文件夹名" }).fill("海边采访");
  await expect(page.getByText("/work/projects/海边采访", { exact: true })).toBeVisible();
  await expect(page.getByLabel("原子发布检查台").getByText(
    "路径可用 · 目标文件夹必须不存在",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText("零字节 video.md", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "原子创建并打开" }).click();

  const emptyTitle = page.getByRole("heading", { name: "项目中还没有 Scene" });
  await expect(emptyTitle).toBeVisible();
  await expect(emptyTitle).toBeFocused();
});

test("启动器在窄面板纵向排列，并在宿主没有目录选择能力时明确失败", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 860 });
  await loadWorkbench(page);
  await sendResult(page, {
    status: "launcher",
    connection: { status: "connected", readOnly: false },
  });

  await page.getByRole("button", { name: "选择父文件夹" }).click();
  await expect(page.getByText("HOST_DIRECTORY_PICKER_UNAVAILABLE", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "选择父文件夹" })).toBeFocused();
  const positions = await page.locator(".launcher-main").evaluate((main) => {
    const ticket = main.querySelector<HTMLElement>(".launch-ticket")!.getBoundingClientRect();
    const bench = main.querySelector<HTMLElement>(".launch-side")!.getBoundingClientRect();
    return { ticketBottom: ticket.bottom, benchTop: bench.top };
  });
  expect(positions.benchTop).toBeGreaterThanOrEqual(positions.ticketBottom - 1);
  await expect(page.getByRole("button", { name: "从恢复快照创建" })).toBeDisabled();
});

test("启动器创建失败后保留输入并把焦点交还主操作", async ({ page }) => {
  await loadWorkbench(page);
  await page.evaluate(() => {
    (window as unknown as { openai: unknown }).openai = {
      selectDirectory: () => "/tmp/projects",
      callTool: () => ({
        isError: true,
        structuredContent: {
          status: "invalid",
          error: {
            code: "PROJECT_CREATE_TARGET_EXISTS",
            path: "/tmp/projects/existing",
            message: "创建目标已存在。",
          },
        },
      }),
    };
  });
  await sendResult(page, { status: "launcher", connection: { status: "connected" } });
  await page.getByRole("button", { name: "选择父文件夹" }).click();
  await page.getByRole("textbox", { name: "项目文件夹名" }).fill("existing");
  const createButton = page.getByRole("button", { name: "原子创建并打开" });
  await createButton.click();

  await expect(page.getByText("PROJECT_CREATE_TARGET_EXISTS", { exact: true })).toBeVisible();
  await expect(createButton).toBeFocused();
  await page.getByRole("textbox", { name: "项目文件夹名" }).fill("bad\tname");
  await expect(createButton).toBeDisabled();
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
  await expect(page.locator("[data-scene-row]").first()).toHaveAttribute("role", "group");
  await expect(page.locator("[data-scene-row]").first()).toHaveAttribute("data-selected", "true");
  expect(await page.locator("[data-scene-row]").first().evaluate((element) => element.getBoundingClientRect().height)).toBe(112);
  expect(await page.locator("[data-scene-row]").first().locator('[role="button"] button, [role="button"] textarea, [role="button"] input').count()).toBe(0);
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

test("只读检查的非空项目不显示无响应的 Scene 写控件", async ({ page }) => {
  await loadWorkbench(page);
  const result: any = validResult(2);
  result.writable = false;
  result.connection = { status: "connected", readOnly: true };
  await sendResult(page, result);

  await expect(page.getByRole("button", { name: /Scene 01/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增 Scene" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑 Narration" })).toHaveCount(0);
  await expect(page.getByText("READ ONLY", { exact: true })).toBeVisible();
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
  await expect(page.getByText("从第一句 Narration 开始搭建脚本。Scene 会在合法校验后自动保存。", { exact: true })).toBeVisible();

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
  result.projectDsl.scenes[0]!.narration.text = result.scenes[0]!.narration;
  await sendResult(page, result);

  await expect(page.getByText("1,000 SCENES", { exact: true }).first()).toBeVisible();
  expect(await page.locator("[data-scene-row]").count()).toBeLessThanOrEqual(30);
  await expect(page.locator("[data-copy]").first()).toBeDisabled();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Scene 01/ }).click();
  await expect(page.getByTestId("scene-narration-detail")).toHaveText(result.scenes[0]!.narration);
});

test("客户端在调用保存工具前拒绝 Speech 与 Narration 摘要不一致", async ({ page }) => {
  await loadWorkbench(page);
  const result = validResult(2);
  result.projectDsl.scenes[1]!.speech!.sourceTextHash = `sha256:${"f".repeat(64)}`;
  let calls = 0;
  await installAppToolBridge(page, () => { calls += 1; });
  await sendResult(page, result);

  await page.getByRole("button", { name: /Scene 01/ }).click();
  await page.getByRole("button", { name: "下移", exact: true }).click();
  await expect(page.getByText("保存失败", { exact: true })).toBeVisible();
  await expect.poll(() => calls).toBe(0);
});

test("窄面板把项目检查收进可操作抽屉，Composer 仍可见", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 860 });
  await loadWorkbench(page);
  await sendResult(page, validResult());

  await expect(page.getByText("连接正常", { exact: true })).toBeVisible();
  await expect(page.getByText("10000000-0000-4000-8000-000000000001", { exact: true })).toBeVisible();
  const sceneMenu = page.getByText("Scene 操作", { exact: true });
  await expect(sceneMenu).toBeVisible();
  expect(await sceneMenu.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await sceneMenu.click();
  await expect(page.getByRole("button", { name: "复制", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "删除", exact: true })).toBeVisible();
  const inspectionToggle = page.getByRole("button", { name: "打开项目检查" });
  await expect(inspectionToggle).toBeVisible();
  await inspectionToggle.click();
  await expect(page.getByRole("complementary", { name: "项目检查" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Composer" })).toBeInViewport();
});

test("零 Scene 可新增并在 Narration 停顿后通过 app 专用工具自动保存", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(0);
  const saves: Array<Record<string, any>> = [];
  await installAppToolBridge(page, (name, args) => {
    expect(name).toBe("save_project_scenes");
    saves.push(args);
    const scenes = args.project.scenes.map((item: any, index: number) => ({
      id: item.id,
      index: index + 1,
      narration: item.narration.text,
      assets: [],
      speech: { status: "missing" },
    }));
    return {
      structuredContent: {
        ...initial,
        status: "saved",
        projectRevision: `sha256:${"2".repeat(64)}`,
        projectDsl: args.project,
        project: { ...initial.project, sceneCount: scenes.length },
        scenes,
      },
    };
  });
  await sendResult(page, initial);

  await page.getByRole("button", { name: "新增第一个 Scene" }).click();
  const editor = page.getByRole("textbox", { name: "Scene 01 Narration" });
  await expect(editor).toBeFocused();
  await editor.fill("从一束清晨的光开始。 ");
  await expect(page.getByText("待保存", { exact: true })).toBeVisible();
  await expect.poll(() => saves.at(-1)?.project.scenes[0]?.narration.text).toBe("从一束清晨的光开始。 ");
  expect(saves.at(-1)).toMatchObject({
    projectDirectory: "/work/projects/product-demo",
    projectId: "10000000-0000-4000-8000-000000000001",
    baselineRevision: `sha256:${"2".repeat(64)}`,
    project: { assets: [], scenes: [{ narration: { text: "从一束清晨的光开始。 " }, assetIds: [] }] },
  });
  expect(saves.at(-1)!.project.scenes[0].id).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
});

test("编辑、复制、移动、删除与 Undo/Redo 保持 Scene 身份和保存历史", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(3);
  let revision = 1;
  const saves: Array<Record<string, any>> = [];
  await installAppToolBridge(page, (name, args) => {
    expect(name).toBe("save_project_scenes");
    saves.push(structuredClone(args));
    revision += 1;
    const assetMap = new Map(initial.projectDsl.assets.map((asset) => [asset.id, asset.path]));
    const scenes = args.project.scenes.map((item: any, index: number) => ({
      id: item.id,
      index: index + 1,
      narration: item.narration.text,
      assets: item.assetIds.map((id: string) => ({ id, path: assetMap.get(id) ?? null })),
      speech: item.speech
        ? { status: "available", durationMs: item.speech.durationMs }
        : { status: "missing" },
    }));
    return {
      structuredContent: {
        ...initial,
        status: "saved",
        projectRevision: `sha256:${String(revision).repeat(64).slice(0, 64)}`,
        projectDsl: args.project,
        project: { ...initial.project, sceneCount: scenes.length },
        scenes,
      },
    };
  });
  await sendResult(page, initial);
  const secondId = initial.projectDsl.scenes[1]!.id;
  const secondScene = page.getByRole("button", { name: /Scene 02/ });
  await secondScene.click();
  const secondRow = page.locator(`[data-scene-id="${scene(2).id}"]`);
  await secondRow.getByRole("button", { name: "编辑 Narration" }).click();
  const editor = page.getByRole("textbox", { name: "Scene 02 Narration" });
  await editor.fill("改写一");
  await editor.fill("改写完成");
  await editor.blur();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]!.project.scenes[1]).toEqual({
    id: secondId,
    narration: { text: "改写完成" },
    assetIds: initial.projectDsl.scenes[1]!.assetIds,
  });

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(`[data-scene-id="${secondId}"] .narration-view`)).toHaveText(initial.scenes[1]!.narration);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(`[data-scene-id="${secondId}"] .narration-view`)).toHaveText("改写完成");

  await page.getByRole("button", { name: "复制" }).click();
  const selected = page.locator('[data-scene-row][data-selected="true"]');
  await expect(selected).toContainText("改写完成");
  const copiedId = await selected.getAttribute("data-scene-id");
  expect(copiedId).not.toBe(secondId);
  await expect(selected.getByText("缺失", { exact: true })).toBeVisible();

  await page.getByRole("spinbutton", { name: "移动到位置" }).fill("1");
  await page.getByRole("button", { name: "移动" }).click();
  await expect(page.locator("[data-scene-row]").first()).toHaveAttribute("data-scene-id", copiedId!);
  await expect(page.locator("#launcher-status-announcer")).toContainText("从位置 3 移动到位置 1");

  await page.getByRole("button", { name: "删除" }).click();
  await expect(page.locator(`[data-scene-id="${copiedId}"]`)).toHaveCount(0);
  await page.getByRole("button", { name: "撤销删除" }).click();
  await expect(page.locator(`[data-scene-id="${copiedId}"]`)).toHaveCount(1);
});

test("保存失败可显式重试，工作区切换保留编辑与历史；冲突停止自动覆盖", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(1);
  let mode: "fail" | "success" | "conflict" = "fail";
  let calls = 0;
  await installAppToolBridge(page, (_name, args) => {
    calls += 1;
    if (mode === "fail") {
      return {
        isError: true,
        structuredContent: {
          status: "save-failed",
          error: { code: "PROJECT_SAVE_FAILED", message: "临时写入失败；磁盘内容未改变。" },
        },
      };
    }
    if (mode === "conflict") {
      return {
        isError: true,
        structuredContent: {
          status: "save-conflict",
          error: { code: "PROJECT_SAVE_CONFLICT", message: "磁盘内容发生外部变化。" },
        },
      };
    }
    const item = args.project.scenes[0];
    return {
      structuredContent: {
        ...initial,
        status: "saved",
        projectRevision: `sha256:${"9".repeat(64)}`,
        projectDsl: args.project,
        scenes: [{
          id: item.id,
          index: 1,
          narration: item.narration.text,
          assets: [],
          speech: { status: "missing" },
        }],
      },
    };
  });
  await sendResult(page, initial);
  const row = page.locator(`[data-scene-id="${scene(1).id}"]`);
  await row.getByRole("button", { name: "编辑 Narration" }).click();
  await page.getByRole("textbox", { name: "Scene 01 Narration" }).fill("保留在内存中的合法修改");
  await page.getByRole("textbox", { name: "Scene 01 Narration" }).blur();
  await expect(page.getByText("保存失败", { exact: true })).toBeVisible();
  await expect.poll(() => calls).toBe(1);

  await page.getByRole("tab", { name: "Agent 工作区" }).click();
  await page.getByRole("tab", { name: "表格工作区" }).click();
  await expect(page.getByRole("textbox", { name: "Scene 01 Narration" })).toHaveValue("保留在内存中的合法修改");
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  mode = "success";
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();

  mode = "conflict";
  await page.getByRole("textbox", { name: "Scene 01 Narration" }).fill("冲突时仍保留的修改");
  await page.getByRole("textbox", { name: "Scene 01 Narration" }).blur();
  await expect(page.getByText("保存冲突", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Scene 01 Narration" })).toHaveValue("冲突时仍保留的修改");
  await expect(page.getByRole("button", { name: "新增 Scene" })).toBeDisabled();
  const callsAfterConflict = calls;
  await page.waitForTimeout(700);
  expect(calls).toBe(callsAfterConflict);
});

test("Agent 工作区运行固定宿主验证并展示经过身份校验的有界结果", async ({ page }) => {
  await loadWorkbench(page);
  await sendResult(page, validResult());
  let statusReads = 0;
  await installHostToolBridge(page, (name, args) => {
    if (name === "start_agent_host_validation") {
      expect(args).toEqual({ projectDirectory: "/work/projects/product-demo" });
      return {
        taskId: "task-64",
        status: "running",
        reason: null,
        connection: { status: "connected", threadId: "thread-specialized", replaced: false },
        result: null,
        diagnostic: null,
        availableActions: ["stop"],
        projectModified: false,
      };
    }
    if (name === "get_agent_host_validation") {
      statusReads += 1;
      if (statusReads === 1) throw new Error("临时状态读取失败");
      return {
        taskId: "task-64",
        status: "succeeded",
        reason: null,
        connection: { status: "connected", threadId: "thread-specialized", replaced: false },
        result: {
          projectId: "10000000-0000-4000-8000-000000000001",
          sceneCount: 5,
          summary: "Codex 已在只读边界内核对 Project VNext 身份。",
          verification: { taskId: "task-64", driverId: "driver-current" },
        },
        diagnostic: null,
        availableActions: [],
        projectModified: false,
      };
    }
    throw new Error(`意外工具：${name}`);
  });

  await page.getByRole("tab", { name: "Agent 工作区" }).click();
  await expect(page.getByRole("heading", { name: "Codex 创作线程验证" })).toBeVisible();
  await expect(page.getByText("未开始", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始验证" }).click();

  await expect(page.getByRole("heading", { name: "验证成功", exact: true })).toBeVisible();
  expect(statusReads).toBeGreaterThan(0);
  await expect(page.getByText("task-64", { exact: true })).toBeVisible();
  await expect(page.getByText("Codex 创作线程已连接", { exact: true })).toBeVisible();
  await expect(page.getByText("Codex 已在只读边界内核对 Project VNext 身份。", { exact: true })).toBeVisible();
  await expect(page.getByText("任务与当前驱动身份已校验", { exact: true })).toBeVisible();
  await expect(page.getByText("项目内容未修改", { exact: true })).toBeVisible();
  await expect(page.locator("[data-chat-message]")).toHaveCount(0);
  await expect(page.getByText("不保存对话副本、推理、工具日志或未提交修改", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Composer" })).toBeDisabled();
  await expect(page.getByText("完整创作指令将在后续功能中启用", { exact: true })).toBeVisible();
});

test("Agent 验证可停止、继续，并在窄面板纵向排列状态与操作", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 860 });
  await loadWorkbench(page);
  await sendResult(page, validResult());
  await installHostToolBridge(page, (name) => {
    if (name === "start_agent_host_validation") {
      return {
        taskId: "task-mobile",
        status: "running",
        reason: null,
        connection: { status: "connected", threadId: "thread-1", replaced: false },
        result: null,
        diagnostic: null,
        availableActions: ["stop"],
        projectModified: false,
      };
    }
    if (name === "stop_agent_host_validation") {
      return {
        taskId: "task-mobile",
        status: "stopped",
        reason: "USER_STOPPED",
        connection: { status: "connected", threadId: "thread-1", replaced: false },
        result: null,
        diagnostic: null,
        availableActions: ["continue"],
        projectModified: false,
      };
    }
    if (name === "continue_agent_host_validation") {
      return {
        taskId: "task-mobile",
        status: "running",
        reason: null,
        connection: { status: "connected", threadId: "thread-2", replaced: true },
        result: null,
        diagnostic: null,
        availableActions: ["stop"],
        projectModified: false,
      };
    }
    if (name === "get_agent_host_validation") {
      return {
        taskId: "task-mobile",
        status: "running",
        reason: null,
        connection: { status: "connected", threadId: "thread-2", replaced: true },
        result: null,
        diagnostic: null,
        availableActions: ["stop"],
        projectModified: false,
      };
    }
    throw new Error(`意外工具：${name}`);
  });

  await page.getByRole("tab", { name: "Agent 工作区" }).click();
  await page.getByRole("button", { name: "开始验证" }).click();
  await page.getByRole("button", { name: "停止" }).click();
  await expect(page.getByText("已停止", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "继续" })).toBeEnabled();
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByText("替代线程已接管", { exact: true })).toBeVisible();

  const agentColumns = await page.locator(".agent-main").evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns
  );
  expect(agentColumns.split(" ")).toHaveLength(1);
  await expect(page.locator(".task-board")).toHaveCSS("border-right-width", "0px");
  const verticalOrder = await page.locator(".agent-panel").evaluate((panel) => {
    const task = panel.querySelector<HTMLElement>(".task-board")!;
    const result = panel.querySelector<HTMLElement>(".result-board")!;
    const actions = panel.querySelector<HTMLElement>(".agent-actions")!;
    return [task, result, actions].map((element) => {
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom };
    });
  });
  expect(verticalOrder[1]!.top).toBeGreaterThanOrEqual(verticalOrder[0]!.bottom - 1);
  expect(verticalOrder[2]!.top).toBeGreaterThanOrEqual(verticalOrder[1]!.bottom - 1);
  const actionDirection = await page.locator(".agent-actions").evaluate((element) =>
    getComputedStyle(element).flexDirection
  );
  expect(actionDirection).toBe("column");
  const stopButton = page.getByRole("button", { name: "停止" });
  await stopButton.scrollIntoViewIfNeeded();
  await expect(stopButton).toBeInViewport();
  await stopButton.focus();
  const scrollTop = await page.locator(".stage").evaluate((element) => element.scrollTop);
  await page.waitForTimeout(650);
  await expect(stopButton).toBeFocused();
  await expect.poll(() => page.locator(".stage").evaluate((element) => element.scrollTop)).toBe(scrollTop);
});

test("线程丢失态保留恢复指针但显示不可用语义", async ({ page }) => {
  await loadWorkbench(page);
  await sendResult(page, validResult());
  await page.getByRole("tab", { name: "Agent 工作区" }).click();
  await sendResult(page, {
    hostValidation: {
      taskId: "task-lost",
      status: "stopped",
      reason: "CODEX_THREAD_UNAVAILABLE",
      connection: { status: "unavailable", threadId: "thread-lost", replaced: false },
      result: null,
      diagnostic: {
        code: "CODEX_THREAD_UNAVAILABLE",
        message: "Codex 创作线程不可用；继续时将自动创建替代线程。",
      },
      availableActions: ["continue"],
      projectModified: false,
    },
  });

  await expect(page.getByText("Codex 创作线程不可用", { exact: true })).toBeVisible();
  await expect(page.locator('.status-mark[data-status="unavailable"]')).toHaveCSS("border-radius", "2px");
  await expect(page.getByText("thread-lost", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "继续" })).toBeEnabled();
});

test("Agent 标题在支持的窄屏与桌面宽度不产生孤字换行或溢出", async ({ page }) => {
  await loadWorkbench(page);
  await sendResult(page, validResult());
  await page.getByRole("tab", { name: "Agent 工作区" }).click();

  for (const width of [320, 430, 1440]) {
    await page.setViewportSize({ width, height: 860 });
    const titleFits = await page.getByRole("heading", { name: "Codex 创作线程验证" }).evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    );
    expect(titleFits).toBe(true);
  }
});

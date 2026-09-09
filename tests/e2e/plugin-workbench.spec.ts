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
  const videoBriefContent = "# 产品演示\n\n保留纸张与胶片的触感。\n";
  const videoBriefRevision = `sha256:${createHash("sha256").update(videoBriefContent).digest("hex")}`;
  return {
    status: "valid",
    connection: { status: "connected", readOnly: false },
    writable: true,
    projectRevision: `sha256:${"1".repeat(64)}`,
    videoBrief: {
      content: videoBriefContent,
      revision: videoBriefRevision,
      bytes: Buffer.byteLength(videoBriefContent),
      state: "saved",
    },
    currentRenderProgram: {
      briefRevision: videoBriefRevision,
      briefReviewPending: false,
      previewPreserved: true,
    },
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
    assetStates: assets.map((asset) => ({ ...asset, status: "available" as const, size: 1024 })),
    warnings: [],
  };
}

async function installAppToolBridge(
  page: Page,
  handler: (name: string, args: Record<string, any>) => unknown,
): Promise<void> {
  await page.exposeFunction("handleNarracutAppTool", (name: string, args: Record<string, any>) => {
    // 只读后台查询不计入本文件被测的编辑操作。
    if (name === 'project_acceptance' && args.action === 'history') return { structuredContent: { revisions: [] } };
    if (name === 'project_render' && args.action === 'status') return { structuredContent: { source: { revisionId: 'current', summary: '当前修订', accepted: false, ready: false, issues: [] }, jobs: [] } };
    return handler(name, args);
  });
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

test("Video Brief 使用独立历史与串行 ETag 保存，关闭后恢复入口焦点", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(1);
  const calls: Array<Record<string, any>> = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await installAppToolBridge(page, async (name, args) => {
    expect(name).toBe("save_project_video_brief");
    calls.push(structuredClone(args));
    if (calls.length === 1) await firstGate;
    const revision = `sha256:${String(calls.length + 1).repeat(64).slice(0, 64)}`;
    return {
      structuredContent: {
        ...initial,
        status: "brief-saved",
        videoBrief: {
          content: args.content,
          revision,
          bytes: new TextEncoder().encode(args.content).length,
          state: args.content === "" ? "empty" : "saved",
        },
        currentRenderProgram: {
          briefRevision: initial.videoBrief.revision,
          briefReviewPending: true,
          previewPreserved: true,
        },
      },
    };
  });
  await sendResult(page, initial);

  const entry = page.getByRole("button", { name: /Video Brief.*已保存/ });
  await entry.click();
  const editor = page.getByRole("textbox", { name: "Video Brief 原始 Markdown" });
  await expect(page.getByRole("dialog", { name: "编辑 Video Brief" })).toBeVisible();
  await expect(editor).toBeFocused();
  await editor.fill("# 第一版\n");
  await expect.poll(() => calls.length).toBe(1);
  await editor.fill("# 第二版\n");
  await page.waitForTimeout(550);
  expect(calls).toHaveLength(1);

  releaseFirst();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[0]).toMatchObject({
    baselineRevision: initial.videoBrief.revision,
    content: "# 第一版\n",
  });
  expect(calls[1]).toMatchObject({
    baselineRevision: `sha256:${"2".repeat(64)}`,
    content: "# 第二版\n",
  });
  await expect(page.getByRole("dialog", { name: "编辑 Video Brief" }).getByRole("status"))
    .toHaveText("已保存");

  await page.getByRole("button", { name: "Video Brief Undo" }).click();
  await expect(editor).toHaveValue("# 第一版\n");
  await page.getByRole("button", { name: "关闭 Video Brief 编辑器" }).click();
  await expect(entry).toBeFocused();
  await expect(page.locator("[data-scene-row]").first()).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await page.getByRole("tab", { name: "Agent 工作区" }).click();
  await expect(page.getByText("Brief 待复核", { exact: true })).toBeVisible();
  await expect(page.getByText("当前 Render Program 与既有 Preview 保持不变", { exact: true })).toBeVisible();
});

test("Video Brief 保留混合原始换行，且编辑后可立即 Undo", async ({ page }) => {
  await loadWorkbench(page);
  const initial: any = validResult(1);
  const original = "# BASE\r\n第一行\r第二行\n";
  initial.videoBrief = {
    content: original,
    revision: `sha256:${createHash("sha256").update(original).digest("hex")}`,
    bytes: Buffer.byteLength(original),
    state: "saved",
  };
  initial.currentRenderProgram = {
    briefRevision: initial.videoBrief.revision,
    briefReviewPending: false,
    previewPreserved: true,
  };
  const calls: Array<Record<string, any>> = [];
  await installAppToolBridge(page, (_name, args) => {
    calls.push(structuredClone(args));
    return {
      structuredContent: {
        ...initial,
        status: "brief-saved",
        videoBrief: {
          content: args.content,
          revision: `sha256:${createHash("sha256").update(args.content).digest("hex")}`,
          bytes: Buffer.byteLength(args.content),
          state: "saved",
        },
      },
    };
  });
  await sendResult(page, initial);
  const entry = page.getByRole("button", { name: /Video Brief.*已保存/ });
  await entry.click();
  const editor = page.getByRole("textbox", { name: "Video Brief 原始 Markdown" });

  await editor.fill("# BASE\n第一行\n第二行\n补充");
  await editor.blur();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]?.content).toBe(`${original}补充`);
  await expect(page.getByRole("dialog", { name: "编辑 Video Brief" }).getByRole("status"))
    .toHaveText("已保存");

  await editor.fill("# BASE\n第一行\n第二行\n临时改动");
  await page.getByRole("button", { name: "Video Brief Undo" }).click();
  await expect(editor).toHaveValue("# BASE\n第一行\n第二行\n补充");
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]?.content).toBe(`${original}补充`);
  await page.getByRole("button", { name: "关闭 Video Brief 编辑器" }).click();
  await expect(entry).toHaveAccessibleName("Video Brief 已保存");
});

test("Video Brief 外部冲突展示 BASE、LOCAL、DISK 与显式出口", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 860 });
  await loadWorkbench(page);
  const initial = validResult(1);
  await installAppToolBridge(page, (name) => {
    expect(name).toBe("save_project_video_brief");
    return {
      structuredContent: {
        status: "brief-conflict",
        disk: {
          content: "# DISK\n\n外部工具的版本。\n",
          revision: `sha256:${"d".repeat(64)}`,
          bytes: 32,
        },
      },
    };
  });
  await sendResult(page, initial);
  await page.getByRole("button", { name: "打开项目检查" }).click();
  await page.getByRole("button", { name: /Video Brief.*已保存/ }).click();
  await page.getByRole("textbox", { name: "Video Brief 原始 Markdown" }).fill("# LOCAL\n\n我的版本。\n");

  await expect(page.getByRole("heading", { name: "外部冲突" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "BASE 只读证据" })).toHaveValue(initial.videoBrief.content);
  await page.getByRole("tab", { name: "查看 LOCAL" }).click();
  await expect(page.getByRole("textbox", { name: "LOCAL 只读证据" })).toHaveValue("# LOCAL\n\n我的版本。\n");
  await page.getByRole("tab", { name: "查看 DISK" }).click();
  await expect(page.getByRole("textbox", { name: "DISK 只读证据" })).toHaveValue("# DISK\n\n外部工具的版本。\n");
  await expect(page.getByRole("textbox", { name: "合并结果" })).toHaveValue("# LOCAL\n\n我的版本。\n");
  await expect(page.getByRole("button", { name: "提交合并结果" })).toBeVisible();
  await expect(page.getByRole("button", { name: "放弃 LOCAL 并载入 DISK" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 LOCAL" })).toBeVisible();
  await expect(page.getByText(/强制覆盖/u)).toHaveCount(0);

  await page.getByRole("button", { name: "放弃 LOCAL 并载入 DISK" }).click();
  await expect(page.getByRole("textbox", { name: "Video Brief 原始 Markdown" }))
    .toHaveValue("# DISK\n\n外部工具的版本。\n");
  await expect(page.getByRole("dialog", { name: "编辑 Video Brief" }).getByRole("status"))
    .toHaveText("已保存");
  await expect(page.getByRole("button", { name: "Video Brief Undo" })).toBeDisabled();
});

test("只读检查不会把未知的 Brief 指纹关系宣称为已绑定", async ({ page }) => {
  await loadWorkbench(page);
  const inspected: any = validResult(1);
  inspected.writable = false;
  inspected.connection = { status: "connected", readOnly: true };
  delete inspected.currentRenderProgram;
  await sendResult(page, inspected);

  await page.getByRole("tab", { name: "Agent 工作区" }).click();
  await expect(page.getByText("Brief 关系未检查", { exact: true })).toBeVisible();
  await expect(page.getByText("已对应当前 Brief", { exact: true })).toHaveCount(0);
});

test("Video Brief 冲突中的 LOCAL 可经系统目录选择导出后载入 DISK", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(1);
  const calls: Array<{ name: string; args: Record<string, any> }> = [];
  await page.exposeFunction("handleNarracutBriefTool", (name: string, args: Record<string, any>) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === "save_project_video_brief") {
      return {
        structuredContent: {
          status: "brief-conflict",
          disk: {
            content: "# DISK\n",
            revision: `sha256:${"d".repeat(64)}`,
            bytes: 7,
          },
        },
      };
    }
    expect(name).toBe("export_project_video_brief_local");
    return {
      structuredContent: {
        status: "brief-exported",
        exported: { path: "/work/exports/video-brief-local.md", bytes: 8 },
      },
    };
  });
  await page.evaluate(() => {
    (window as any).openai = {
      selectDirectory: () => ({ path: "/work/exports" }),
      callTool: (name: string, args: Record<string, unknown>) =>
        (window as any).handleNarracutBriefTool(name, args),
    };
  });
  await sendResult(page, initial);
  await page.getByRole("button", { name: /Video Brief.*已保存/ }).click();
  await page.getByRole("textbox", { name: "Video Brief 原始 Markdown" }).fill("# LOCAL\n");
  await expect(page.getByRole("heading", { name: "外部冲突" })).toBeVisible();

  await page.getByRole("button", { name: "导出 LOCAL" }).click();

  await expect(page.getByRole("dialog", { name: "编辑 Video Brief" }).getByRole("status")
    .filter({ hasText: "LOCAL 已导出到 /work/exports/video-brief-local.md；编辑器已载入 DISK。" }))
    .toBeVisible();
  await expect(page.getByRole("textbox", { name: "Video Brief 原始 Markdown" })).toHaveValue("# DISK\n");
  expect(calls.at(-1)).toEqual({
    name: "export_project_video_brief_local",
    args: {
      projectDirectory: initial.project.directory,
      projectId: initial.project.projectId,
      targetDirectory: "/work/exports",
      content: "# LOCAL\n",
    },
  });
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
  await expect(page.getByRole("textbox", { name: "Composer" })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Composer" })).toHaveAttribute(
    "aria-describedby",
    "composer-draft-reason composer-scope",
  );
  await expect(page.getByText("输入明确目标后开始创作；草稿仅保留在本次会话", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "当前创作指令" })).toBeVisible();
  await expect(page.getByText("输入明确目标后开始创作；草稿仅保留在本次会话", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "关闭项目检查" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Composer" })).toBeInViewport();
  await page.getByRole("button", { name: "关闭项目检查" }).click();
  await expect(inspectionToggle).toBeFocused();
});

test("Scene Speech 单元格引导项目 TTS 配置、生成状态与半开时间窗", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(1);
  delete initial.projectDsl.scenes[0]!.speech;
  initial.scenes[0]!.speech = { status: "missing" };
  const config = {
    provider: "tokendance",
    model: "minimax-speech-2.8-turbo",
    voice: "Chinese (Mandarin)_News_Anchor",
    speed: 1,
    volume: 1,
    pitch: 0,
  };
  const capabilities = {
    provider: "tokendance",
    models: [{ value: config.model, label: "MiniMax Speech 2.8 Turbo" }],
    voices: [{ value: config.voice, label: "普通话 · 新闻主播" }],
    ranges: {
      speed: { min: 0.5, max: 2, step: 0.1 },
      volume: { min: 0.1, max: 10, step: 0.1 },
      pitch: { min: -12, max: 12, step: 1 },
    },
    audio: { format: "mp3", sampleRate: 32000, bitrate: 128000, channels: 1 },
  };
  Object.assign(initial, {
    tts: { status: "unconfigured", credential: { status: "missing", storage: "session" }, capabilities },
    speechStates: [{ sceneId: initial.scenes[0]!.id, status: "missing", reason: "当前 Scene 缺少 Speech。" }],
    timeline: {
      durationInFrames: 150,
      renderReady: false,
      scenes: [{ sceneId: initial.scenes[0]!.id, startFrame: 0, durationInFrames: 150, source: "draft" }],
    },
  });
  const calls: Array<{ name: string; args: Record<string, any> }> = [];
  let reads = 0;
  await installAppToolBridge(page, (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === "save_project_tts_settings") {
      return {
        structuredContent: {
          ...initial,
          status: "tts-saved",
          projectRevision: `sha256:${"2".repeat(64)}`,
          affectedSpeechCount: 0,
          tts: {
            status: "configured",
            config,
            profileId: `sha256:${"a".repeat(64)}`,
            credential: { status: "available", storage: "session", masked: "••••-key" },
            capabilities,
          },
        },
      };
    }
    if (name === "start_scene_speech") {
      return { structuredContent: { speechJob: { id: "speech-job-1", sceneId: initial.scenes[0]!.id, status: "queued", stage: "排队" } } };
    }
    if (name === "get_scene_speech_job") {
      reads += 1;
      if (reads < 2) {
        return { structuredContent: { speechJob: { id: "speech-job-1", sceneId: initial.scenes[0]!.id, status: "validating", stage: "正在校验" } } };
      }
      const projectDsl = structuredClone(initial.projectDsl);
      projectDsl.scenes[0].speech = {
        path: `speech/${initial.scenes[0]!.id}.mp3`,
        durationMs: 1_001,
        sourceTextHash: `sha256:${createHash("sha256").update(initial.scenes[0]!.narration).digest("hex")}`,
        ttsProfileId: `sha256:${"a".repeat(64)}`,
      };
      return {
        structuredContent: {
          ...initial,
          status: "speech-job",
          projectRevision: `sha256:${"3".repeat(64)}`,
          projectDsl,
          speechJob: { id: "speech-job-1", sceneId: initial.scenes[0]!.id, status: "succeeded", stage: "生成完成", result: { durationMs: 1_001 } },
          tts: {
            status: "configured",
            config,
            profileId: `sha256:${"a".repeat(64)}`,
            credential: { status: "available", storage: "session", masked: "••••-key" },
            capabilities,
          },
          speechStates: [{ sceneId: initial.scenes[0]!.id, status: "available", durationMs: 1_001 }],
          timeline: {
            durationInFrames: 31,
            renderReady: true,
            scenes: [{ sceneId: initial.scenes[0]!.id, startFrame: 0, durationInFrames: 31, source: "speech" }],
          },
        },
      };
    }
    throw new Error(`意外工具：${name}`);
  });
  await sendResult(page, initial);

  await page.getByRole("button", { name: "生成 Speech" }).click();
  await expect(page.getByRole("heading", { name: "项目 TTS 配置" })).toBeVisible();
  await expect(page.getByText("需要先保存 TTS 配置与 API Key", { exact: true })).toBeVisible();
  await expect(page.getByText("MP3 · 32 kHz · 单声道", { exact: true })).toBeVisible();
  await page.getByLabel("TokenDance API Key").fill("test-secret-key");
  await page.getByRole("button", { name: "保存 TTS 配置" }).click();
  await expect(page.getByText("API Key 已就绪 · ••••-key", { exact: true })).toBeVisible();
  expect(calls.find((call) => call.name === "save_project_tts_settings")?.args).toMatchObject({
    config,
    credentialAction: "replace",
    apiKey: "test-secret-key",
    expectedAffectedSpeechCount: 0,
  });

  await page.getByRole("button", { name: "返回项目检查" }).click();
  await page.getByRole("button", { name: "生成 Speech" }).click();
  await expect(page.getByText("正在校验", { exact: true })).toBeVisible();
  await expect(page.getByText("1.001 秒", { exact: true })).toBeVisible();
  await expect(page.getByText("帧 0–31（不含 31）", { exact: true })).toBeVisible();
  await expect(page.getByText("可用于最终 Render", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新生成 Speech" })).toBeFocused();

  await page.setViewportSize({ width: 430, height: 860 });
  await page.getByRole("button", { name: "关闭项目检查" }).click();
  await expect(page.getByRole("button", { name: "重新生成 Speech" })).toBeVisible();
  expect(await page.getByRole("button", { name: "重新生成 Speech" }).evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(44);
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
  await page.getByRole("textbox", { name: "Composer" }).fill("保存失败时保留创作草稿");

  await page.getByRole("tab", { name: "Agent 工作区" }).click();
  await page.getByRole("tab", { name: "表格工作区" }).click();
  await expect(page.getByRole("textbox", { name: "Composer" })).toHaveValue("保存失败时保留创作草稿");
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

test("从 Scene Asset 面板逐项导入并绑定，失败项不回滚且 Undo 只解除引用", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(1);
  const sceneId = initial.projectDsl.scenes[0]!.id;
  const importedAsset = {
    id: "20000000-0000-4000-8000-000000000071",
    path: "assets/mountain.png",
  };
  const calls: Array<{ name: string; args: Record<string, any> }> = [];
  await page.exposeFunction("pickNarracutFiles", () => [
    { path: "/outside/mountain.png" },
    { path: "/outside/folder" },
  ]);
  await page.exposeFunction("callNarracutAssetTool", (name: string, args: Record<string, any>) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === "import_project_asset" && args.sourcePath.endsWith("mountain.png")) {
      const projectDsl = {
        assets: [importedAsset],
        scenes: [{ ...initial.projectDsl.scenes[0], assetIds: [importedAsset.id] }],
      };
      return {
        structuredContent: {
          ...initial,
          status: "asset-imported",
          projectRevision: `sha256:${"7".repeat(64)}`,
          projectDsl,
          project: { ...initial.project, assetCount: 1 },
          assetStates: [{ ...importedAsset, status: "available", size: 2048 }],
          assetImport: {
            status: "imported-and-bound",
            code: "ASSET_IMPORTED_AND_BOUND",
            message: "Asset 已导入并绑定到原目标 Scene。",
            asset: importedAsset,
          },
        },
      };
    }
    if (name === "import_project_asset") {
      return {
        structuredContent: {
          status: "asset-import-result",
          assetImport: {
            status: "rejected",
            code: "ASSET_SOURCE_NOT_FILE",
            message: "导入源是目录；请选择一个或多个普通文件。",
            asset: null,
          },
        },
      };
    }
    if (name === "save_project_scenes") {
      return {
        structuredContent: {
          ...initial,
          status: "saved",
          projectRevision: `sha256:${"8".repeat(64)}`,
          projectDsl: args.project,
          project: { ...initial.project, assetCount: 1 },
          assetStates: [{ ...importedAsset, status: "available", size: 2048 }],
        },
      };
    }
    throw new Error(`意外工具：${name}`);
  });
  await page.evaluate(() => {
    (window as unknown as { openai: unknown }).openai = {
      selectFiles: () => (window as any).pickNarracutFiles(),
      callTool: (name: string, args: Record<string, unknown>) =>
        (window as any).callNarracutAssetTool(name, args),
    };
  });
  await sendResult(page, initial);

  await page.getByRole("button", { name: "第 01 个 Scene 的 Asset：未绑定 · 添加" }).click();
  await expect(page.getByRole("heading", { name: "Scene 01 · Asset" })).toBeVisible();
  await page.getByRole("button", { name: "导入并绑定" }).click();
  await expect(page.getByText("mountain.png", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("已导入并绑定", { exact: true })).toBeVisible();
  await expect(page.getByText("已拒绝", { exact: true })).toBeVisible();
  expect(calls.filter((call) => call.name === "import_project_asset").map((call) => call.args)).toEqual([
    expect.objectContaining({ sourcePath: "/outside/mountain.png", targetSceneId: sceneId }),
    expect.objectContaining({ sourcePath: "/outside/folder", targetSceneId: sceneId }),
  ]);
  await expect(page.getByRole("button", { name: "第 01 个 Scene 的 Asset：mountain.png" })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => calls.filter((call) => call.name === "save_project_scenes").at(-1)?.args.project)
    .toMatchObject({ assets: [importedAsset], scenes: [{ assetIds: [] }] });
  await expect(page.getByRole("button", { name: "第 01 个 Scene 的 Asset：未绑定 · 添加" })).toBeVisible();
});

test("Asset 导入前等待未保存 Scene，且导入期间锁住项目写操作", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(1);
  const sceneId = initial.projectDsl.scenes[0]!.id;
  const importedAsset = {
    id: "20000000-0000-4000-8000-000000000079",
    path: "assets/waited.png",
  };
  let resolveSave!: () => void;
  let resolveImport!: () => void;
  const saveGate = new Promise<void>((resolve) => { resolveSave = resolve; });
  const importGate = new Promise<void>((resolve) => { resolveImport = resolve; });
  let pickerCalls = 0;
  let savedProject: Record<string, any> | null = null;
  const calls: Array<{ name: string; args: Record<string, any> }> = [];
  await page.exposeFunction("pickNarracutPendingFile", () => {
    pickerCalls += 1;
    return [{ path: "/outside/waited.png" }];
  });
  await page.exposeFunction("callNarracutPendingImportTool", async (name: string, args: Record<string, any>) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === "save_project_scenes") {
      await saveGate;
      savedProject = structuredClone(args.project);
      return {
        structuredContent: {
          ...initial,
          status: "saved",
          projectRevision: `sha256:${"8".repeat(64)}`,
          projectDsl: args.project,
          scenes: [{
            ...initial.scenes[0],
            narration: args.project.scenes[0].narration.text,
          }],
        },
      };
    }
    if (name === "import_project_asset") {
      await importGate;
      if (!savedProject) {
        throw new Error("Asset 导入不应早于待保存的 Scene 写入");
      }
      const projectDsl = structuredClone(savedProject);
      projectDsl.assets.push(importedAsset);
      projectDsl.scenes[0].assetIds.push(importedAsset.id);
      return {
        structuredContent: {
          ...initial,
          status: "asset-imported",
          projectRevision: `sha256:${"9".repeat(64)}`,
          projectDsl,
          project: { ...initial.project, assetCount: 1 },
          assetStates: [{ ...importedAsset, status: "available", size: 1024 }],
          assetImport: {
            status: "imported-and-bound",
            code: "ASSET_IMPORTED_AND_BOUND",
            message: "Asset 已导入并绑定到原目标 Scene。",
            asset: importedAsset,
          },
        },
      };
    }
    throw new Error(`意外工具：${name}`);
  });
  await page.evaluate(() => {
    (window as unknown as { openai: unknown }).openai = {
      selectFiles: () => (window as any).pickNarracutPendingFile(),
      callTool: (name: string, args: Record<string, unknown>) =>
        (window as any).callNarracutPendingImportTool(name, args),
    };
  });
  await sendResult(page, initial);

  await page.getByRole("button", { name: "编辑 Narration" }).click();
  await page.getByRole("textbox", { name: "Scene 01 Narration" }).fill("导入前必须保存的 Narration");
  await page.getByRole("button", { name: /Scene 的 Asset/ }).click();
  await expect.poll(() => calls.filter((call) => call.name === "save_project_scenes").length).toBe(1);
  await page.getByRole("button", { name: "导入并绑定" }).click();
  expect(pickerCalls).toBe(0);
  await expect(page.getByRole("button", { name: "新增 Scene" })).toBeDisabled();

  resolveSave();
  await expect.poll(() => pickerCalls).toBe(1);
  await expect.poll(() => calls.filter((call) => call.name === "import_project_asset").length).toBe(1);
  await expect(page.getByRole("button", { name: "新增 Scene" })).toBeDisabled();
  expect(calls.find((call) => call.name === "import_project_asset")?.args).toMatchObject({
    baselineRevision: `sha256:${"8".repeat(64)}`,
    targetSceneId: sceneId,
  });

  resolveImport();
  await expect(page.getByText("已导入并绑定", { exact: true })).toBeVisible();
  await expect(page.getByText("导入前必须保存的 Narration", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增 Scene" })).toBeEnabled();
});

test("Asset 面板可搜索添加已有登记、键盘排序、解除引用并只读预览", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(1);
  const assets = [
    { id: "20000000-0000-4000-8000-000000000081", path: "assets/a.png" },
    { id: "20000000-0000-4000-8000-000000000082", path: "assets/b.mp3" },
    { id: "20000000-0000-4000-8000-000000000083", path: "assets/mountain.bin" },
  ];
  initial.projectDsl.assets = assets;
  initial.projectDsl.scenes[0]!.assetIds = [assets[0]!.id, assets[1]!.id];
  initial.project.assetCount = assets.length;
  initial.assetStates = assets.map((asset) => ({ ...asset, status: "available", size: 512 }));
  const saves: Array<Record<string, any>> = [];
  await installAppToolBridge(page, (name, args) => {
    if (name === "read_project_asset_preview") {
      return {
        structuredContent: {
          assetPreview: {
            status: "available",
            id: assets[0]!.id,
            path: assets[0]!.path,
            filename: "a.png",
            size: 9,
            kind: "image",
            mediaType: "image/png",
            dataUrl: "data:image/png;base64,iVBORw0KGgoA",
          },
        },
      };
    }
    expect(name).toBe("save_project_scenes");
    saves.push(structuredClone(args));
    return {
      structuredContent: {
        ...initial,
        status: "saved",
        projectRevision: `sha256:${String(saves.length + 2).repeat(64).slice(0, 64)}`,
        projectDsl: args.project,
      },
    };
  });
  await sendResult(page, initial);

  await page.getByRole("button", { name: /第 01 个 Scene 的 Asset：2 个 Asset · a\.png \+1/ }).click();
  await page.getByRole("button", { name: "添加已有 Asset" }).click();
  await page.getByRole("searchbox", { name: "搜索项目 Asset" }).fill("mountain");
  await page.getByRole("button", { name: "添加 mountain.bin" }).click();
  await expect.poll(() => saves.at(-1)?.project.scenes[0].assetIds).toEqual([
    assets[0]!.id,
    assets[1]!.id,
    assets[2]!.id,
  ]);

  await page.getByRole("button", { name: "返回 Scene Asset" }).click();
  await page.getByRole("button", { name: "将 mountain.bin 上移" }).click();
  await expect.poll(() => saves.at(-1)?.project.scenes[0].assetIds).toEqual([
    assets[0]!.id,
    assets[2]!.id,
    assets[1]!.id,
  ]);
  const previewButton = page.getByRole("button", { name: "预览 a.png" });
  await previewButton.click();
  await expect(page.getByRole("dialog", { name: "Asset 只读预览" })).toBeVisible();
  await expect(page.getByRole("img", { name: "a.png 只读预览" })).toHaveAttribute("src", /data:image\/png/);
  const closePreview = page.getByRole("button", { name: "关闭预览" });
  await expect(closePreview).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closePreview).toBeFocused();
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(previewButton).toBeFocused();

  await page.getByRole("button", { name: "解除 b.mp3 引用" }).click();
  await expect.poll(() => saves.at(-1)?.project.scenes[0].assetIds).toEqual([
    assets[0]!.id,
    assets[2]!.id,
  ]);
});

test("关闭加载中的 Asset 预览后忽略迟到响应", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(1);
  const asset = { id: "20000000-0000-4000-8000-000000000089", path: "assets/slow.png" };
  initial.projectDsl.assets = [asset];
  initial.projectDsl.scenes[0]!.assetIds = [asset.id];
  initial.project.assetCount = 1;
  initial.assetStates = [{ ...asset, status: "available", size: 9 }] as any;
  let resolvePreview!: () => void;
  const previewGate = new Promise<void>((resolve) => { resolvePreview = resolve; });
  await page.exposeFunction("readSlowNarracutPreview", async () => {
    await previewGate;
    return {
      structuredContent: {
        assetPreview: {
          status: "available",
          ...asset,
          filename: "slow.png",
          size: 9,
          kind: "image",
          mediaType: "image/png",
          dataUrl: "data:image/png;base64,iVBORw0KGgoA",
        },
      },
    };
  });
  await page.evaluate(() => {
    (window as unknown as { openai: unknown }).openai = {
      callTool: () => (window as any).readSlowNarracutPreview(),
    };
  });
  await sendResult(page, initial);

  await page.getByRole("button", { name: /Scene 的 Asset/ }).click();
  await page.getByRole("button", { name: "预览 slow.png" }).click();
  await expect(page.getByRole("dialog", { name: "Asset 只读预览" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Asset 只读预览" })).toHaveCount(0);
  resolvePreview();
  await page.waitForTimeout(100);
  await expect(page.getByRole("dialog", { name: "Asset 只读预览" })).toHaveCount(0);
});

test("Asset 容量、有界列表、文件不可用与悬空 ID 都有明确非纯颜色状态", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(1);
  const assets = Array.from({ length: 255 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    path: `assets/asset-${index + 1}.bin`,
  }));
  const danglingId = "20000000-0000-4000-8000-999999999999";
  initial.projectDsl.assets = assets;
  initial.projectDsl.scenes[0]!.assetIds = [...assets.map((asset) => asset.id), danglingId];
  initial.project.assetCount = assets.length;
  initial.assetStates = assets.map((asset, index) => index === 0
    ? { ...asset, status: "unavailable" as const, reason: "文件缺失或已被移动。" }
    : { ...asset, status: "available" as const, size: 10 }) as any;
  await sendResult(page, initial);

  await page.getByRole("button", { name: /第 01 个 Scene 的 Asset：256 个 Asset/ }).click();
  await expect(page.getByText("当前 Scene 已达到 256 个 Asset 引用上限。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "导入并绑定" })).toBeDisabled();
  await expect(page.getByText("文件不可用", { exact: true })).toBeVisible();
  await expect(page.getByText("悬空 Asset ID", { exact: true })).toBeVisible();
  await expect(page.getByText("未找到登记的 Asset", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /预览 asset-1\.bin/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "解除悬空 Asset ID 引用" })).toBeEnabled();

  const full = validResult(1);
  full.projectDsl.assets = Array.from({ length: 1000 }, (_, index) => ({
    id: `20000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`,
    path: `assets/library-${index + 1}.bin`,
  }));
  full.project.assetCount = 1000;
  full.assetStates = full.projectDsl.assets.map((asset) => ({ ...asset, status: "available" as const, size: 10 }));
  await sendResult(page, full);
  await page.getByRole("button", { name: "管理项目 Asset" }).click();
  await expect(page.getByRole("button", { name: "导入暂未绑定 Asset" })).toBeDisabled();
  await expect(page.getByText("项目已达到 1,000 个 Asset 上限，不能继续导入。", { exact: true })).toBeVisible();
  await expect(page.locator(".project-asset-list li")).toHaveCount(100);
  await expect(page.getByText("仅显示前 100 项，请缩小搜索范围。", { exact: true })).toBeVisible();
});

test("Composer 创建任务保留精确原文及新草稿，重复点击只创建一次并聚焦目标", async ({ page }) => {
  await loadWorkbench(page); await sendResult(page, validResult());
  let finish: ((value: unknown) => void) | undefined, starts = 0;
  const task = { taskId: 'task-82', status: 'waiting', reason: 'CANDIDATE_READY', stage: 'deliver', instruction: '  让开场更安静\n保留空格  ', threadPointer: 'dedicated-82', lastSafeStage: 'deliver', candidateBaseline: 'saved', pending: '候选已就绪，由你决定是否接受。' };
  await installAppToolBridge(page, (name) => {
    if (name === 'start_creation_task') { starts++; return new Promise(resolve => { finish = resolve; }); }
    return { structuredContent: {} };
  });
  await page.getByRole('button', { name: /Scene 02/ }).click();
  const draft = page.getByRole('textbox', { name: 'Composer' });
  await draft.fill(task.instruction); const node = await draft.elementHandle();
  await page.getByRole('button', { name: '开始创作', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在创建创作任务' })).toBeDisabled();
  await draft.fill('等待回执时的新草稿');
  finish!({ structuredContent: { creationTask: task } });
  await expect(page.getByRole('heading', { name: '当前创作指令' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Agent 工作区' })).toBeVisible();
  await expect(page.locator('.creation-instruction')).toHaveText(task.instruction);
  await expect(draft).toHaveValue('等待回执时的新草稿');
  expect(starts).toBe(1); expect(await node!.evaluate(node => node === document.getElementById('composer-draft'))).toBe(true);
  await expect(page.getByRole('heading', { name: '等待用户 · 候选已就绪' })).toBeVisible();
  await page.getByRole('tab', { name: '表格工作区' }).click();
  await expect(page.locator('[data-scene-row]').nth(1)).toHaveAttribute('data-selected', 'true');
});

test("Composer 失败保留原文可重试；任务刷新不中断输入，窄屏与桌面状态可读", async ({ page }) => {
  await loadWorkbench(page); await sendResult(page, validResult());
  let starts = 0;
  const task = { taskId: 'task-82', status: 'running', reason: null, instruction: '让开场更安静', stage: 'modify', threadPointer: 'dedicated-82', lastSafeStage: 'read', pending: null };
  await installAppToolBridge(page, name => {
    if (name === 'start_creation_task') { if (++starts === 1) return { isError: true, structuredContent: { error: { message: '宿主连接失败' } } }; return { structuredContent: { creationTask: task } }; }
    if (name === 'get_creation_task') return { structuredContent: { creationTask: task } };
    return { structuredContent: {} };
  });
  const draft = page.getByRole('textbox', { name: 'Composer' });
  await expect(page.getByRole('button', { name: '开始创作', exact: true })).toBeDisabled();
  await draft.fill(task.instruction); await draft.press('Enter');
  expect(starts).toBe(0);
  await draft.fill(task.instruction);
  await page.getByRole('button', { name: '开始创作', exact: true }).click();
  await expect(draft).toHaveValue(task.instruction);
  await page.getByRole('button', { name: '开始创作', exact: true }).click();
  await expect(draft).toHaveValue('');
  await draft.fill('继续输入'); await draft.focus();
  await draft.dispatchEvent('compositionstart');
  await draft.evaluate((node: HTMLTextAreaElement) => { node.setSelectionRange(1, 3); });
  await sendResult(page, { creationTask: { ...task, stage: 'check' } });
  await expect(draft).toBeFocused();
  expect(await draft.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 3]);
  await draft.dispatchEvent('compositionend');
  const { mkdir } = await import('node:fs/promises'); await mkdir('.impeccable/review', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('#workspace-agent').evaluate(node => { node.scrollTop = 0; });
    await expect(page.getByRole('heading', { name: '当前创作指令' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/creation-${width === 1440 ? 'desktop' : 'mobile'}.png`, fullPage: true });
  }
});

test("Agent 标题在支持的窄屏与桌面宽度不产生孤字换行或溢出", async ({ page }) => {
  await loadWorkbench(page);
  await sendResult(page, validResult());
  await page.getByRole("tab", { name: "Agent 工作区" }).click();

  for (const width of [320, 430, 1440]) {
    await page.setViewportSize({ width, height: 860 });
    const titleFits = await page.getByRole("heading", { name: "当前创作指令" }).evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    );
    expect(titleFits).toBe(true);
  }
});

test("双工作区共享多行草稿、Scene 历史与活动任务，刷新不中断中文输入", async ({ page }) => {
  await loadWorkbench(page);
  const initial = validResult(2);
  const calls: string[] = [];
  await installAppToolBridge(page, (name) => {
    calls.push(name);
    return { structuredContent: { status: "saved", projectRevision: `sha256:${"2".repeat(64)}` } };
  });
  const taskCalls: string[] = [];
  await installHostToolBridge(page, (name) => {
    taskCalls.push(name);
    return { taskId: "task-shared", status: "running", reason: null,
      connection: { status: "connected", threadId: "thread-shared", replaced: false } };
  });
  await sendResult(page, initial);
  await page.getByRole("button", { name: /Scene 02/ }).click();
  await page.locator('[data-scene-row]').nth(1).getByRole("button", { name: "编辑 Narration" }).click();
  await page.getByRole("textbox", { name: "Scene 02 Narration" }).fill("保留第二幕的修改");
  const draft = page.getByRole("textbox", { name: "Composer" });
  await draft.fill("第一行创作要求\n第二行待补充");
  const draftNode = await draft.elementHandle();
  const tableNode = await page.getByRole("tabpanel", { name: "表格工作区" }).elementHandle();
  await page.getByRole("tab", { name: "Agent 工作区" }).click();
  await expect(page.getByRole("heading", { name: "当前创作指令" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始创作", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "管理项目 Asset" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /Narration/ })).toHaveCount(0);
  await draft.focus();
  await draft.dispatchEvent("compositionstart", { data: "创" });
  await sendResult(page, { creationTask: { taskId: "task-shared", status: "waiting", instruction: "原始目标", stage: "deliver", reason: "CANDIDATE_READY" } });
  await draft.evaluate((node: HTMLTextAreaElement) => {
    node.value += "\n创作中";
    node.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
  });
  await draft.dispatchEvent("compositionend", { data: "创作中" });
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue("第一行创作要求\n第二行待补充\n创作中");
  expect(await draftNode!.evaluate((node) => node === document.getElementById("composer-draft"))).toBe(true);
  await page.getByRole("button", { name: "前往表格工作区修改 Scene" }).click();
  expect(await tableNode!.evaluate((node) => node === document.getElementById("workspace-table"))).toBe(true);
  await expect(page.getByRole("textbox", { name: "Scene 02 Narration" })).toHaveValue("保留第二幕的修改");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-scene-row]').nth(1)).toContainText(initial.scenes[1]!.narration);
  expect(calls.every((name) => name === "save_project_scenes")).toBe(true);
  expect(taskCalls).toHaveLength(0);
  await page.getByRole("tab", { name: "Agent 工作区" }).click();
  await page.getByText("任务详情", { exact: true }).click();
  await expect(page.getByText("task-shared", { exact: true })).toBeVisible();
});

test("工作区标签支持手动键盘激活，零 Scene 与长草稿在窄屏可用", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWorkbench(page);
  await sendResult(page, validResult(0));
  const table = page.getByRole("tab", { name: "表格工作区" });
  const agent = page.getByRole("tab", { name: "Agent 工作区" });
  await table.focus();
  await table.press("ArrowRight");
  await expect(agent).toBeFocused();
  await expect(table).toHaveAttribute("aria-selected", "true");
  await agent.press("Enter");
  await expect(page.getByRole("tabpanel", { name: "Agent 工作区" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "尚无任务" })).toBeVisible();
  await expect(page.getByText("尚无预览 · 构建当前版本或候选后检查成片", { exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "当前创作指令" }).scrollIntoViewIfNeeded();
  expect(await page.locator("#workspace-agent .stage").evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
  const draft = page.getByRole("textbox", { name: "Composer" });
  await draft.fill("长草稿保留\n".repeat(100));
  await expect(draft).toBeInViewport();
  await table.click();
  await expect(draft).toHaveValue("长草稿保留\n".repeat(100));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1440, 390]) {
  test(`候选真实持久化、工作区连续性与安全放弃 ${width}`, async ({ page }) => {
    const { mkdtemp, mkdir, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createNarracutRequestHandler } = await import('../../plugins/narracut/src/server');
    const handler = createNarracutRequestHandler();
    let id = 500;
    const tool = (name: string, args: Record<string, any>) => handler({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }) as Promise<any>;
    const directory = join(await mkdtemp(join(tmpdir(), 'candidate-ui-')), 'project');
    const created = await tool('create_project', { projectDirectory: directory });
    await page.setViewportSize({ width, height: 1000 });
    await loadWorkbench(page);
    await installAppToolBridge(page, tool);
    await sendResult(page, created.structuredContent);
    const composer = page.locator('#composer-draft');
    await composer.fill('保留这份创作草稿');
    await page.locator('[data-workspace="agent"]').click();
    await page.getByRole('button', { name: '从当前修订创建候选' }).click();
    await expect(page.locator('.candidate-save')).toContainText('已保存');
    const args = { projectDirectory: directory, projectId: created.structuredContent.project.projectId };
    const first = (await tool('manage_project_candidate', { ...args, action: 'read' })).structuredContent.candidate;
    const saved = await tool('manage_project_candidate', { ...args, action: 'apply', baseline: first.baseline, changes: [{ path: 'resources/说明.txt', content: '第二批原子保存' }] });
    expect(saved.isError).not.toBe(true);
    await page.getByRole('button', { name: '重新检查完整性' }).click();
    await expect(page.locator('.candidate-panel')).toContainText('上一份完整候选已保留');
    await page.locator('[data-workspace="table"]').click();
    await expect(composer).toHaveValue('保留这份创作草稿');
    await page.locator('[data-workspace="agent"]').click();
    await expect(page.locator('.candidate-save')).toContainText('已保存');
    await mkdir('.impeccable/review', { recursive: true });
    await page.screenshot({ path: `.impeccable/review/candidate-${width === 390 ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await page.getByRole('button', { name: '放弃候选', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '放弃候选', exact: true })).toBeFocused();
    expect(await readFile(join(directory, saved.structuredContent.candidate.candidate.path, 'resources/说明.txt'), 'utf8')).toBe('第二批原子保存');
    await page.getByRole('button', { name: '放弃候选', exact: true }).click();
    await page.getByRole('button', { name: '放弃候选并终结任务' }).click();
    await expect(page.getByRole('button', { name: '从当前修订创建候选' })).toBeVisible();
    await expect(composer).toHaveValue('保留这份创作草稿');
    await handler.dispose();
  });
}

test('候选失败和外部变化通知保留草稿、所选 Scene 与详情焦点，检查状态不冒充保存', async ({ page }) => {
  await loadWorkbench(page);
  const candidate = { status: 'saved', baseline: 'one', sourceRevision: 'revision-one', candidate: { path: '.narracut/candidate-one/candidate', identity: 'sha256:one' }, checkpoint: null };
  await installAppToolBridge(page, async () => {
    await new Promise(resolve => setTimeout(resolve, 350));
    return { structuredContent: { status: 'candidate-state', candidate } };
  });
  await sendResult(page, { ...validResult(), candidate });
  await page.locator('#composer-draft').fill('不要清空这份草稿');
  await page.locator('[data-workspace="agent"]').click();
  await page.getByRole('button', { name: '重新检查完整性' }).click();
  await expect(page.locator('.candidate-save')).toContainText('正在检查完整性');
  await expect(page.locator('.candidate-save')).toContainText('已保存');
  const summary = page.locator('[data-candidate-details] summary');
  await summary.click();
  await page.waitForTimeout(4500);
  await expect(summary).toBeFocused();
  await sendResult(page, { status: 'candidate-state', candidate: { ...candidate, status: 'external-change', baseline: 'two', error: { code: 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', message: '候选发生外部变化' } } });
  await expect(summary).toBeFocused();
  await sendResult(page, { status: 'candidate-failed', error: { code: 'CANDIDATE_SAVE_FAILED', message: '本批未保存，上一份候选已保留' } });
  await expect(page.locator('.candidate-error')).toContainText('本批未保存');
  await expect(page.locator('#composer-draft')).toHaveValue('不要清空这份草稿');
  await page.locator('[data-workspace="table"]').click();
  await expect(page.locator('.scene-row')).toHaveCount(5);
});

test('等待用户期间仍刷新任务终结，连接恢复清除错误且任务详情保持焦点', async ({ page }) => {
  await loadWorkbench(page); await sendResult(page, validResult());
  let reads = 0;
  const task = { taskId: 'task-refresh', status: 'running', reason: null, instruction: '明确目标', stage: 'read', threadPointer: 'thread-refresh' };
  await installAppToolBridge(page, name => {
    if (name === 'start_creation_task') return { structuredContent: { creationTask: task } };
    if (name === 'get_creation_task') {
      reads++;
      if (reads === 1) throw new Error('临时网络失败');
      return { structuredContent: { creationTask: { ...task, status: reads === 2 ? 'waiting' : 'terminated', reason: reads === 2 ? 'CANDIDATE_READY' : 'CANDIDATE_ACCEPTED' } } };
    }
    return { structuredContent: {} };
  });
  await page.getByRole('textbox', { name: 'Composer' }).fill(task.instruction);
  await page.getByRole('button', { name: '开始创作', exact: true }).click();
  const details = page.getByText('任务详情', { exact: true });
  await details.click();
  await expect(page.locator('#composer-draft-reason')).toContainText('临时网络失败');
  await expect(page.getByRole('heading', { name: '已终结 · 候选已接受' })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#composer-draft-reason')).not.toContainText('临时网络失败');
  await expect(details).toBeFocused();
  await expect(page.getByText('task-refresh', { exact: true })).toBeVisible();
});

test('自动跟进保留 Composer 与 Scene，外部候选直接继续且防止重复提交', async ({ page }) => {
  await loadWorkbench(page); await sendResult(page, validResult());
  const task = { taskId: 'task-83', status: 'running', reason: null, instruction: '跟随最新内容', stage: 'check', pending: 'Scene、Speech 已更新，正在重新检查' };
  let calls = 0, finish: ((value: unknown) => void) | undefined;
  await installAppToolBridge(page, name => {
    if (name === 'continue_creation_task') { calls++; return new Promise(resolve => { finish = resolve; }); }
    if (name === 'get_creation_task') return { structuredContent: { creationTask: task } };
    return { structuredContent: {} };
  });
  const draft = page.getByRole('textbox', { name: 'Composer' });
  await draft.fill('保留正在输入的文字'); await draft.focus();
  await sendResult(page, { creationTask: task });
  await expect(draft).toBeFocused(); await expect(draft).toHaveValue('保留正在输入的文字');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.locator('.contact-sheet').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(200);
    await page.screenshot({ path: `/tmp/narracut-83-table-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '查看任务', exact: true }).click();
  await expect(page.getByRole('heading', { name: '运行中 · 正在跟进最新项目内容' })).toBeVisible();
  const waiting = { ...task, status: 'waiting', reason: 'EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED', pending: '已保留外部修改，已丢弃 Agent 未提交修改。继续后，Agent 将基于外部候选和最新项目内容重新检查并创作。' };
  await sendResult(page, { creationTask: waiting });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole('button', { name: '基于外部候选继续' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/narracut-83-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '基于外部候选继续' }).click();
  await expect(page.getByRole('button', { name: '正在核对候选' })).toBeDisabled();
  expect(calls).toBe(1);
  finish!({ structuredContent: { creationTask: task } });
  await expect(page.getByRole('heading', { name: '运行中 · 正在跟进最新项目内容' })).toBeVisible();
  await expect(draft).toHaveValue('保留正在输入的文字');
});

test('Scene 待办按稳定 ID 定位并保留 Composer；Brief 提案提供只读 diff 和完整结果', async ({ page }) => {
  await loadWorkbench(page); const result = validResult(3); await sendResult(page, result);
  const task = { taskId: 'task-84', status: 'waiting', reason: 'SCENE_CHANGE_REQUIRED', instruction: '开场更简洁', pending: '请缩短旁白', stage: 'read', suggestions: [{ sceneId: result.scenes[1]!.id, observation: '旁白偏长', action: '缩短 Narration', content: '欢迎', reason: '让开场紧凑', required: true, satisfied: false, condition: { field: 'narration', description: '两字以内' } }] };
  await installAppToolBridge(page, () => ({ structuredContent: { creationTask: task } }));
  await sendResult(page, { creationTask: task });
  const draft = page.getByRole('textbox', { name: 'Composer' }); await draft.fill('中文草稿'); const node = await draft.elementHandle();
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await expect(page.getByText('完成目标所必需', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '定位 Scene', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Scene 02 Narration', exact: true })).toBeFocused();
  expect(await node!.evaluate(el => el.isConnected)).toBe(true); await expect(draft).toHaveValue('中文草稿');
  await sendResult(page, { creationTask: { ...task, suggestions: task.suggestions.map(item => ({ ...item, condition: { field: 'asset', description: '绑定可用素材' } })) } });
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await page.getByRole('button', { name: '定位 Scene', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Scene 02 · Asset' })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入并绑定' })).toBeFocused();
  const proposal = { id: 'proposal-84', base: '旧方向\n', content: '新方向\n', baseline: result.videoBrief.revision, purpose: '明确创作方向', status: 'review' };
  await sendResult(page, { creationTask: { ...task, reason: 'BRIEF_REVIEW_REQUIRED', suggestions: [], briefProposal: proposal } });
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  await page.getByRole('button', { name: '审核 Brief 提案' }).click();
  await expect(page.getByRole('textbox', { name: '统一 diff' })).toHaveValue(/-旧方向[\s\S]*\+新方向/);
  await page.getByRole('button', { name: '完整结果', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '完整结果' })).toHaveValue('新方向\n');
  await expect(page.getByRole('textbox', { name: '完整结果' })).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: '接受并保存 Brief' })).toBeVisible();
});

for (const width of [1440, 390]) test(`任务待办与 Brief 审核在 ${width}px 可用，独立 Brief 撤销与中文输入连续`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await loadWorkbench(page); const result = validResult(3); await sendResult(page, result);
  let task: any = { taskId: 'task-84-visual', status: 'waiting', reason: 'SCENE_CHANGE_REQUIRED', instruction: '让开场简洁、安静，保留纸张与胶片的触感。', pending: '请完成下方必要修改；保存并满足条件后会继续同一任务。', stage: 'read', suggestions: [{ sceneId: result.scenes[1]!.id, observation: '开场旁白偏长，会分散对画面的注意。', action: '缩短 Narration', content: '欢迎来到日常。', reason: '给开场画面留下阅读空间。', required: true, satisfied: false, condition: { field: 'narration', description: '旁白非空且不超过十字；可以使用其他措辞。' } }] };
  await installAppToolBridge(page, (name, args) => {
    if (name === 'save_project_video_brief') return { structuredContent: { videoBrief: { content: args.content, revision: result.videoBrief.revision }, status: 'brief-saved' } };
    if (name === 'respond_creation_task' && args.action === 'ack-brief') task = { ...task, status: 'running', reason: null };
    return { structuredContent: { creationTask: task } };
  });
  await sendResult(page, { creationTask: task });
  await page.getByRole('tab', { name: 'Agent 工作区' }).click();
  const draft = page.getByRole('textbox', { name: 'Composer' }); await draft.fill('保留输入中的中文草稿'); const node = await draft.elementHandle();
  await draft.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(2, 5); });
  await draft.dispatchEvent('compositionstart');
  task = { ...task, pending: '还有 1 项必要修改未满足。' }; await sendResult(page, { creationTask: task });
  expect(await node!.evaluate(el => el.isConnected)).toBe(true);
  expect(await draft.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([2,5]);
  await draft.dispatchEvent('compositionend');
  await page.screenshot({ path: `.impeccable/review/issue84-todos-${width}.png`, fullPage: true });
  task = { ...task, reason: 'BRIEF_REVIEW_REQUIRED', briefProposal: { id: 'brief-84', base: result.videoBrief.content, content: '# 产品演示\n\n开场安静、简洁，保留纸张与胶片的触感。\n', purpose: '把本次创作方向整理为共享 Brief', status: 'review' } };
  await sendResult(page, { creationTask: task });
  await page.getByRole('button', { name: '审核 Brief 提案' }).click();
  await expect(page.getByRole('textbox', { name: '统一 diff' })).toBeVisible();
  await page.screenshot({ path: `.impeccable/review/issue84-brief-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  task = { ...task, reason: 'BRIEF_SAVED', briefProposal: { ...task.briefProposal, status: 'saved' }, briefChange: { id: 'brief-84', base: result.videoBrief.content, content: task.briefProposal.content, revision: `sha256:${'2'.repeat(64)}` } };
  await sendResult(page, { creationTask: task });
  if (await page.locator('[data-open-inspection]').isVisible()) await page.locator('[data-open-inspection]').click();
  await page.locator('[data-open-brief]').click();
  await page.getByRole('button', { name: 'Video Brief Undo' }).click();
  await expect(page.getByRole('textbox', { name: 'Video Brief 原始 Markdown' })).toHaveValue(result.videoBrief.content);
  await expect(draft).toHaveValue('保留输入中的中文草稿');
});

test('Composer 同任务混合消息确认精确片段、展示 Brief 分歧，同 Scene 建议复制各自值', async ({ page }) => {
  await loadWorkbench(page); const result = validResult(2); await sendResult(page, result);
  const fragment = '把开场改成明亮色彩。';
  let task: any = { taskId: 'task-message', status: 'waiting', reason: 'USER_DECISION_REQUIRED', instruction: '原始目标', stage: 'read', pending: '等待要求' };
  const calls: any[] = [];
  await installAppToolBridge(page, (name, args) => {
    if (name === 'respond_creation_task') {
      calls.push(args);
      if (args.action === 'message') task = { ...task, reason: 'INSTRUCTION_CONFIRMATION_REQUIRED', pendingMessage: { id: 'message-84', original: args.instruction, fragments: [fragment], reply: '仅保存创作要求，状态问题不追加。' }, divergence: 'Brief 希望保留胶片触感；本次要求明亮色彩，成片表现采用本次要求。' };
      if (args.action === 'confirm-message') task = { ...task, instruction: task.instruction + '\n\n' + fragment, pendingMessage: null, status: 'running', reason: null };
    }
    return { structuredContent: { creationTask: task } };
  });
  await sendResult(page, { creationTask: task });
  const draft = page.getByRole('textbox', { name: 'Composer' }); await draft.fill('现在进展怎样？' + fragment);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认保存的创作意图' })).toBeVisible();
  await expect(page.locator('blockquote')).toHaveText(fragment);
  await expect(page.getByRole('heading', { name: '与 Video Brief 的分歧' })).toBeVisible();
  await expect(page.locator('.brief-divergence')).toContainText('保留纸张与胶片的触感');
  await page.getByRole('button', { name: '确认追加' }).click();
  await expect(page.locator('.creation-instruction').first()).toHaveText('原始目标\n\n' + fragment);
  expect(calls[0].instruction).toBe('现在进展怎样？' + fragment);
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).copiedSuggestion = text; } } }); });
  task = { ...task, status: 'waiting', suggestions: ['第一条完整建议值', '第二条完整建议值'].map(content => ({ sceneId: result.scenes[0]!.id, observation: '观察', action: '编辑', reason: '理由', content, required: true, condition: { description: '完成修改' } })) };
  await sendResult(page, { creationTask: task });
  await page.getByRole('button', { name: '复制建议值', exact: true }).nth(1).click();
  expect(await page.evaluate(() => (window as any).copiedSuggestion)).toBe('第二条完整建议值');
});

for (const width of [1440, 390]) test(`停止与恢复在两个工作区可操作且保留草稿与焦点 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await loadWorkbench(page);
  let task: any = { taskId: 'task-85', status: 'running', reason: null, instruction: '调整开场的节奏，保留现有旁白与素材', stage: 'modify', lastSafeStage: 'modify', candidateBaseline: 'safe', threadPointer: 'thread-original', pending: null };
  let finish: (value: unknown) => void = () => {};
  let stops = 0;
  await installAppToolBridge(page, (name, args) => {
    if (name === 'respond_creation_task' && args.action === 'stop') { stops++; return new Promise(resolve => { finish = resolve; }); }
    if (name === 'respond_creation_task' && args.action === 'continue') task = { ...task, status: 'running', reason: null, replacementThread: true };
    return { structuredContent: { creationTask: task } };
  });
  await sendResult(page, { ...validResult(), creationTask: task });
  const draft = page.locator('#composer-draft');
  await draft.fill('正在输入的中文草稿');
  await page.locator('[data-task-notice] [data-task-action="stop"]').click();
  await expect(page.locator('[data-task-notice]')).toContainText('正在停止…');
  await expect(page.locator('[data-task-notice] [data-task-action="stop"]')).toBeDisabled();
  expect(stops).toBe(1);
  task = { ...task, status: 'stopped', reason: 'USER_STOPPED' };
  finish({ structuredContent: { creationTask: task } });
  await page.locator('[data-workspace="agent"]').click();
  await expect(page.locator('.creation-state')).toContainText('已停止 · 你已停止任务');
  await expect(page.locator('.creation-saved')).toContainText('已保存至：候选修改');
  await expect(draft).toHaveValue('正在输入的中文草稿');
  await page.locator('[data-agent-content]').screenshot({ path: `/tmp/issue85-stopped-${width}.png` });
  await page.getByRole('button', { name: '继续任务', exact: true }).click();
  await expect(page.locator('.creation-state')).toContainText('运行中');
  await expect(page.locator('.creation-saved')).toContainText('仍是同一任务');
  task = { ...task, status: 'waiting', reason: 'USER_DECISION_REQUIRED', pending: '请确认当前候选的开场效果' };
  await sendResult(page, { creationTask: task });
  await page.locator('[data-agent-content] [data-task-action="stop"]').click();
  expect(stops).toBe(2);
  task = { ...task, status: 'stopped', reason: 'USER_STOPPED' };
  finish({ structuredContent: { creationTask: task } });
  await expect(page.locator('.creation-state')).toContainText('已停止');
  await expect(page.getByRole('button', { name: '继续任务', exact: true })).toBeFocused();
  await expect(draft).toHaveValue('正在输入的中文草稿');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1440, 390]) test(`检查点失效内联接管保留目标，候选变化须再次提交 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await loadWorkbench(page);
  let recovery: any = { code: 'TASK_CHECKPOINT_INVALID', candidateBaseline: 'first', candidatePath: '.narracut/candidates/保留的候选/render-program' };
  let task: any = null;
  const submits: any[] = [];
  await installAppToolBridge(page, (name, args) => {
    if (name === 'respond_creation_task' && args.action === 'takeover') {
      submits.push(args);
      if (submits.length === 1) { recovery = { ...recovery, candidateBaseline: 'second', candidatePath: '.narracut/candidates/最新候选/render-program' }; return { isError: true, structuredContent: { error: { message: '候选再次变化，请核对后再次明确提交。' } } }; }
      task = { taskId: args.id, status: 'running', instruction: args.instruction, reason: null, stage: 'read' }; recovery = null;
    }
    return { structuredContent: { creationTask: task, creationRecovery: recovery } };
  });
  await sendResult(page, { ...validResult(), creationTask: null, creationRecovery: recovery });
  await page.locator('#composer-draft').fill('另一份 Composer 草稿');
  await page.locator('[data-workspace="agent"]').click();
  await expect(page.locator('[data-task-recovery]')).toContainText('这不代表候选损坏');
  await page.getByRole('button', { name: '用新目标接管…' }).click();
  const goal = page.getByLabel('新任务目标');
  await goal.fill('  新目标\n保留完整中文  ');
  await goal.dispatchEvent('compositionstart');
  await page.waitForTimeout(2200);
  await expect(goal).toBeFocused(); await expect(goal).toHaveValue('  新目标\n保留完整中文  ');
  await goal.dispatchEvent('compositionend');
  await page.getByRole('button', { name: '开始新任务并接管候选' }).click();
  await expect(page.locator('[data-takeover-error]')).toContainText('候选再次变化');
  await expect(page.locator('[data-takeover-path]')).toContainText('最新候选');
  await expect(goal).toHaveValue('  新目标\n保留完整中文  ');
  await page.locator('[data-task-recovery]').screenshot({ path: `/tmp/issue85-takeover-${width}.png` });
  expect(submits).toHaveLength(1);
  await page.getByRole('button', { name: '开始新任务并接管候选' }).press('Enter');
  await expect(page.locator('[data-task-recovery]')).toBeHidden();
  expect(submits[1].baseline).toBe('second'); expect(submits[1].instruction).toBe('  新目标\n保留完整中文  ');
  await expect(page.locator('#composer-draft')).toHaveValue('另一份 Composer 草稿');
});

for (const width of [1440, 390]) test(`外部停止指引与线程转移保留中文草稿和工作区 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await loadWorkbench(page);
  let task: any = { taskId: 'task-86', status: 'stopped', reason: 'CODEX_USAGE_LIMIT', instruction: '调整开场节奏，保留旁白与已有素材', stage: 'read', lastSafeStage: 'modify', candidateBaseline: 'safe', threadPointer: 'thread-original', pending: null };
  await installAppToolBridge(page, () => ({ structuredContent: { creationTask: task } }));
  await sendResult(page, { ...validResult(), creationTask: task });
  const draft = page.locator('#composer-draft');
  await draft.fill('尚未发送的中文草稿');
  for (const [reason, label, guidance] of [
    ['CODEX_USAGE_LIMIT', 'Codex 额度受限', '额度恢复后点击“继续任务”'],
    ['CODEX_AUTH_REQUIRED', 'Codex 需要认证', '完成 Codex 认证后点击“继续任务”'],
    ['CODEX_UNAVAILABLE', 'Codex 服务不可用', '服务恢复后点击“继续任务”'],
    ['CODEX_THREAD_UNAVAILABLE', '原线程不可用', '点击“继续任务”，自动尝试替代线程'],
    ['CODEX_INTERRUPTED', 'Codex 已中断', '点击“继续任务”'],
    ['NO_PROGRESS', '连续多轮没有新的持久成果', '查看当前指令与已有成果'],
  ]) {
    task = { ...task, reason }; await sendResult(page, { creationTask: task });
    await expect(page.locator('[data-task-notice]')).toContainText(label);
    await page.locator('[data-workspace="agent"]').click();
    await expect(page.locator('.creation-state')).toContainText(label);
    await expect(page.locator('[data-agent-content]')).toContainText(guidance);
    await expect(page.getByRole('button', { name: '继续任务', exact: true })).toBeEnabled();
    await page.locator('[data-workspace="table"]').click();
  }
  await page.locator('[data-workspace="agent"]').click();
  await page.locator('[data-agent-content]').screenshot({ path: `/tmp/issue86-stopped-${width}.png` });
  await draft.focus();
  await draft.dispatchEvent('compositionstart');
  task = { ...task, status: 'running', reason: null, transferred: true }; await sendResult(page, { creationTask: task });
  await draft.dispatchEvent('compositionend');
  await expect(draft).toBeFocused(); await expect(draft).toHaveValue('尚未发送的中文草稿');
  await expect(page.locator('[data-agent-content]')).toContainText('任务已转移到另一线程');
  await expect(page.locator('.composer-send')).toBeDisabled();
  expect(await page.locator('[data-agent-content] [data-task-action]:enabled').count()).toBe(0);
  await page.locator('[data-agent-content]').screenshot({ path: `/tmp/issue86-transferred-${width}.png` });
  await page.locator('[data-workspace="table"]').click();
  await expect(page.locator('[data-task-notice]')).toContainText('任务已转移到另一线程');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1440, 390]) test(`正常任务显式接管，失败保留目标和焦点 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await loadWorkbench(page);
  const candidate = { status: 'saved', baseline: 'first', candidate: { path: '.narracut/candidate-123/candidate', identity: 'tree' }, checkpoint: null };
  let task: any = { taskId: 'old-task', status: 'stopped', instruction: '旧目标', reason: 'USER_STOPPED', stage: 'read' };
  const submissions: any[] = [];
  await installAppToolBridge(page, (name, args) => {
    if (name === 'respond_creation_task' && args.action === 'takeover') {
      submissions.push(args);
      if (submissions.length === 1) return { isError: true, structuredContent: { error: { message: '提交失败，请重试' } } };
      task = { ...task, taskId: args.id, instruction: args.instruction, reason: 'CODEX_UNAVAILABLE' };
    }
    return { structuredContent: { creationTask: task, candidate } };
  });
  await sendResult(page, { ...validResult(), creationTask: task, candidate });
  await page.locator('#composer-draft').fill('保留 Composer');
  await page.locator('[data-workspace="agent"]').click();
  await page.getByRole('button', { name: '用新目标接管…' }).click();
  const goal = page.getByLabel('新任务目标'); await goal.fill('  新目标\n保留中文全文  ');
  await sendResult(page, { creationTask: task, candidate });
  await expect(goal).toBeFocused(); await expect(goal).toHaveValue('  新目标\n保留中文全文  ');
  await page.locator('[data-task-recovery]').screenshot({ path: `/tmp/issue87-takeover-${width}.png` });
  await page.getByRole('button', { name: '开始新任务并接管候选' }).click();
  await expect(page.locator('[data-takeover-error]')).toContainText('提交失败');
  await expect(goal).toHaveValue('  新目标\n保留中文全文  ');
  await page.getByRole('button', { name: '开始新任务并接管候选' }).click();
  await expect(page.locator('.creation-instruction').first()).toContainText('新目标');
  expect(submissions).toHaveLength(2); expect(submissions[1].baseline).toBe('first');
  await expect(page.locator('#composer-draft')).toHaveValue('保留 Composer');
});

test('接管回执丢失时锁住重复提交，核对后显示新任务停止', async ({ page }) => {
  await loadWorkbench(page);
  const candidate = { status: 'saved', baseline: 'first', candidate: { path: '.narracut/candidate-123/candidate', identity: 'tree' }, checkpoint: null };
  let task: any = { taskId: 'old-task', status: 'stopped', instruction: '旧目标', reason: 'USER_STOPPED' };
  let offline = false, submits = 0;
  await installAppToolBridge(page, (name, args) => {
    if (name === 'respond_creation_task' && args.action === 'takeover') {
      submits++; task = { ...task, taskId: args.id, instruction: args.instruction, reason: 'CODEX_UNAVAILABLE' }; offline = true;
      throw new Error('回执丢失');
    }
    if (name === 'get_creation_task' && offline) throw new Error('连接中断');
    return { structuredContent: { creationTask: task, candidate } };
  });
  await sendResult(page, { ...validResult(), creationTask: task, candidate });
  await page.locator('[data-workspace="agent"]').click();
  await page.getByRole('button', { name: '用新目标接管…' }).click();
  await page.getByLabel('新任务目标').fill('新目标全文');
  await page.getByRole('button', { name: '开始新任务并接管候选' }).click();
  await expect(page.getByRole('button', { name: '开始新任务并接管候选' })).toBeDisabled();
  await expect(page.locator('[data-takeover-error]')).toContainText('连接中断');
  await expect(page.getByRole('button', { name: '审阅并接受' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '放弃候选', exact: true })).toBeDisabled();
  expect(submits).toBe(1); offline = false;
  await page.locator('[data-takeover-reconcile]').click();
  await expect(page.locator('.creation-state')).toContainText('已停止');
  await expect(page.locator('.creation-instruction').first()).toContainText('新目标全文');
  expect(submits).toBe(1);
});

test('放弃确认默认取消，回执不明先核对且不重复删除', async ({ page }) => {
  await loadWorkbench(page);
  let candidate: any = { status: 'saved', baseline: 'first', candidate: { path: '.narracut/candidate-123/candidate', identity: 'tree' }, checkpoint: { path: '.narracut/candidate-123/checkpoint', identity: 'previous' } };
  let task: any = { taskId: 'old-task', status: 'stopped', instruction: '旧目标', reason: 'USER_STOPPED' };
  let submits = 0;
  await installAppToolBridge(page, (name, args) => {
    if (name === 'manage_project_candidate' && args.action === 'discard') {
      submits++; candidate = { ...candidate, status: 'absent', baseline: 'absent', candidate: null, checkpoint: null };
      task = { ...task, status: 'terminated', reason: 'CANDIDATE_ABANDONED' };
      throw new Error('删除回执丢失');
    }
    return { structuredContent: { creationTask: task, candidate } };
  });
  await sendResult(page, { ...validResult(), creationTask: task, candidate });
  await page.locator('[data-workspace="agent"]').click();
  await page.getByRole('button', { name: '放弃候选', exact: true }).click();
  await expect(page.locator('[data-candidate-cancel]')).toBeFocused();
  await expect(page.getByRole('alertdialog')).toContainText('Agent 任务检查点');
  await page.getByRole('button', { name: '放弃候选并终结任务', exact: true }).click();
  await expect(page.getByRole('button', { name: '审阅并接受' })).toBeDisabled();
  await page.locator('[data-candidate-region]').getByRole('button', { name: '核对操作结果' }).click();
  await expect(page.locator('.creation-state')).toContainText('已终结');
  await expect(page.locator('[data-candidate-region]')).toContainText('尚无候选');
  expect(submits).toBe(1);
});

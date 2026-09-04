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

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  CodexHostAdapter,
  CodexHostEvent,
  StartCodexTurnInput,
} from "../plugins/narracut/src/codex-host";
import { createNarracutRequestHandler, handleRequest } from "../plugins/narracut/src/server";
import { createProjectVNext } from "../src/server/project-lifecycle";

class PluginTestHost implements CodexHostAdapter {
  turn: (StartCodexTurnInput & { turnId: string }) | null = null;
  #listener: ((event: CodexHostEvent) => void) | undefined;

  subscribe(listener: (event: CodexHostEvent) => void): () => void {
    this.#listener = listener;
    return () => undefined;
  }

  async createThread(): Promise<{ threadId: string }> {
    return { threadId: "thread-plugin-test" };
  }

  async resumeThread(input: { threadId: string }): Promise<{ threadId: string }> {
    return { threadId: input.threadId };
  }

  async startTurn(input: StartCodexTurnInput): Promise<{ turnId: string }> {
    this.turn = { ...input, turnId: "turn-plugin-test" };
    return { turnId: "turn-plugin-test" };
  }

  async interruptTurn(): Promise<void> {}
  async dispose(): Promise<void> {}

  complete(projectId: string, sceneCount: number): void {
    if (this.turn === null) throw new Error("验证 Turn 尚未开始。");
    this.#listener?.({
      type: "turn-completed",
      threadId: this.turn.threadId,
      turnId: this.turn.turnId,
      status: "completed",
      output: JSON.stringify({
        verificationToken: this.turn.verificationToken,
        projectId,
        sceneCount,
        summary: "已通过插件工具完成只读宿主验证。",
      }),
    });
  }
}

async function createProject(sceneCount = 1): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "narracut-plugin-"));
  const projectDirectory = join(parent, "product-demo");
  await Promise.all([
    mkdir(join(projectDirectory, "assets"), { recursive: true }),
    mkdir(join(projectDirectory, "speech"), { recursive: true }),
    mkdir(join(projectDirectory, "renders"), { recursive: true }),
    mkdir(join(projectDirectory, ".opaque", "revision-1", "render-program", "src"), {
      recursive: true,
    }),
    mkdir(join(projectDirectory, ".opaque", "revision-1", "render-program", "resources"), {
      recursive: true,
    }),
  ]);
  await Promise.all([
    writeFile(join(projectDirectory, "narracut.json"), JSON.stringify({
      kind: "narracut-project",
      formatVersion: 1,
      projectId: "10000000-0000-4000-8000-000000000001",
    })),
    writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [],
      scenes: Array.from({ length: sceneCount }, (_, index) => ({
        id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        narration: { text: `第 ${index + 1} 个 Scene 的 Narration` },
        assetIds: [],
      })),
    })),
    writeFile(join(projectDirectory, "video.md"), "# 产品演示\n"),
    writeFile(
      join(projectDirectory, ".opaque", "revision-1", "render-program", "program.json"),
      JSON.stringify({ apiVersion: 1, output: { width: 1920, height: 1080, fps: 30 } }),
    ),
    writeFile(
      join(projectDirectory, ".opaque", "revision-1", "render-program", "package.json"),
      '{"private":true}',
    ),
    writeFile(
      join(projectDirectory, ".opaque", "revision-1", "render-program", "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    ),
    writeFile(
      join(projectDirectory, ".opaque", "revision-1", "render-program", "src", "RenderProgram.tsx"),
      "export const RenderProgram = () => null;\n",
    ),
  ]);
  return projectDirectory;
}

async function request(method: string, params?: unknown): Promise<unknown> {
  return handleRequest({ jsonrpc: "2.0", id: 1, method, params });
}

describe("Narracut Codex 插件", () => {
  it("插件包声明本地 MCP 且不申请网络、Shell 或任意文件系统能力", async () => {
    const manifest = JSON.parse(await readFile(
      resolve("plugins/narracut/.codex-plugin/plugin.json"),
      "utf8",
    )) as Record<string, unknown>;
    const mcp = JSON.parse(await readFile(resolve("plugins/narracut/.mcp.json"), "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };

    expect(manifest).toMatchObject({
      name: "narracut",
      mcpServers: "./.mcp.json",
    });
    expect(mcp.mcpServers.narracut).toEqual({
      command: "node",
      args: ["${PLUGIN_ROOT}/server.mjs"],
    });
    expect(JSON.stringify(mcp.mcpServers.narracut)).not.toMatch(
      /shell|network|http|https|allowedDirectories/i,
    );
  });

  it("通过 MCP 握手、健康检查，并以结构化结果只读检查项目", async () => {
    const projectDirectory = await createProject();
    const initialized = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "narracut-test", version: "1.0.0" },
    });
    expect(initialized).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "narracut", version: "0.1.0" },
      capabilities: { tools: {}, resources: {} },
    });
    const futureVersion = await request("initialize", {
      protocolVersion: "2099-01-01",
      capabilities: {},
      clientInfo: { name: "future-client", version: "1.0.0" },
    });
    expect(futureVersion).toMatchObject({ protocolVersion: "2025-06-18" });

    const tools = await request("tools/list") as { tools: Array<Record<string, unknown>> };
    expect(tools.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "health_check",
        annotations: expect.objectContaining({ readOnlyHint: true, openWorldHint: false }),
      }),
      expect.objectContaining({
        name: "inspect_project",
        annotations: expect.objectContaining({ readOnlyHint: true, openWorldHint: false }),
        _meta: { ui: { resourceUri: "ui://narracut/workbench-v1.html" } },
      }),
    ]));

    const result = await request("tools/call", {
      name: "inspect_project",
      arguments: { projectDirectory },
    }) as {
      structuredContent: Record<string, unknown>;
      content: Array<{ text: string }>;
    };
    expect(result.structuredContent).toMatchObject({
      status: "valid",
      connection: { status: "connected", readOnly: true },
      project: {
        directory: projectDirectory,
        folderName: "product-demo",
        projectId: "10000000-0000-4000-8000-000000000001",
        sceneCount: 1,
      },
      checks: {
        manifest: { status: "valid" },
        dsl: { status: "valid" },
        videoBrief: { status: "valid" },
      },
    });
    expect(result.content[0]?.text).toContain("product-demo");
  });

  it("提供无项目启动器，并让 create/open 复用严格创建与独占租约语义", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-plugin-launcher-"));
    const projectDirectory = join(parentDirectory, "new-project");
    const pluginRequest = createNarracutRequestHandler({ codexHost: new PluginTestHost() });
    const competingRequest = createNarracutRequestHandler({ codexHost: new PluginTestHost() });

    const listed = await pluginRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as {
      tools: Array<{ name: string; annotations: { readOnlyHint: boolean }; _meta?: unknown }>;
    };
    expect(listed.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "show_launcher",
        annotations: expect.objectContaining({ readOnlyHint: true }),
        _meta: { ui: { resourceUri: "ui://narracut/workbench-v1.html" } },
      }),
      expect.objectContaining({
        name: "create_project",
        annotations: expect.objectContaining({ readOnlyHint: false, openWorldHint: false }),
      }),
      expect.objectContaining({
        name: "open_project",
        annotations: expect.objectContaining({ readOnlyHint: false, openWorldHint: false }),
      }),
    ]));

    const launcher = await pluginRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "show_launcher", arguments: {} },
    }) as { structuredContent: Record<string, unknown> };
    expect(launcher.structuredContent).toEqual({
      status: "launcher",
      connection: { status: "connected", readOnly: false },
    });

    const created = await pluginRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "create_project", arguments: { projectDirectory } },
    }) as { structuredContent: Record<string, unknown> };
    expect(created.structuredContent).toMatchObject({
      status: "valid",
      operation: "created",
      project: { directory: projectDirectory, sceneCount: 0 },
    });

    const occupied = await competingRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "open_project", arguments: { projectDirectory } },
    }) as { isError: boolean; structuredContent: Record<string, unknown> };
    expect(occupied).toMatchObject({
      isError: true,
      structuredContent: {
        status: "invalid",
        error: { code: "PROJECT_IN_USE", path: projectDirectory },
      },
    });

    await pluginRequest.dispose();
    const opened = await competingRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "open_project", arguments: { projectDirectory } },
    }) as { structuredContent: Record<string, unknown> };
    expect(opened.structuredContent).toMatchObject({
      status: "valid",
      operation: "opened",
      project: { directory: projectDirectory, sceneCount: 0 },
    });
    await competingRequest.dispose();
  });

  it("只允许已打开工作台按基线保存 Scene，并把写入工具限制为 app 可见", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-plugin-save-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [],
      scenes: [{
        id: "30000000-0000-4000-8000-000000000001",
        narration: { text: "原 Narration" },
        assetIds: [],
      }],
    }));
    const pluginRequest = createNarracutRequestHandler({ codexHost: new PluginTestHost() });
    const listed = await pluginRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as {
      tools: Array<{ name: string; _meta?: unknown }>;
    };
    expect(listed.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "save_project_scenes",
        _meta: { ui: { visibility: ["app"] } },
      }),
    ]));

    const opened = await pluginRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "open_project", arguments: { projectDirectory } },
    }) as { structuredContent: any };
    expect(opened.structuredContent).toMatchObject({
      connection: { readOnly: false },
      writable: true,
      projectDsl: { assets: [], scenes: [expect.objectContaining({ id: expect.any(String) })] },
      projectRevision: expect.stringMatching(/^sha256:/u),
    });
    const originalId = opened.structuredContent.projectDsl.scenes[0].id;
    const nextId = "30000000-0000-4000-8000-000000000099";

    const saved = await pluginRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "save_project_scenes",
        arguments: {
          projectDirectory,
          projectId: opened.structuredContent.project.projectId,
          baselineRevision: opened.structuredContent.projectRevision,
          project: {
            assets: [],
            scenes: [
              { id: originalId, narration: { text: "改写后的 Narration" }, assetIds: [] },
              { id: nextId, narration: { text: "" }, assetIds: [] },
            ],
          },
        },
      },
    }) as { structuredContent: any };
    expect(saved.structuredContent).toMatchObject({
      status: "saved",
      projectRevision: expect.stringMatching(/^sha256:/u),
      project: { sceneCount: 2 },
      scenes: [
        expect.objectContaining({ id: originalId, narration: "改写后的 Narration" }),
        expect.objectContaining({ id: nextId, narration: "" }),
      ],
    });
    expect(JSON.parse(await readFile(join(projectDirectory, "project.json"), "utf8"))).toEqual({
      assets: [],
      scenes: [
        { id: originalId, narration: { text: "改写后的 Narration" }, assetIds: [] },
        { id: nextId, narration: { text: "" }, assetIds: [] },
      ],
    });
    await pluginRequest.dispose();
  });

  it("无效目录把同一错误写入结构化结果，且 UI 资源可独立读取", async () => {
    const result = await request("tools/call", {
      name: "inspect_project",
      arguments: { projectDirectory: "/definitely/missing/narracut-project" },
    }) as {
      isError: boolean;
      structuredContent: Record<string, unknown>;
    };
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        status: "invalid",
        connection: { status: "connected", readOnly: true },
        error: { code: "PROJECT_PATH_UNAVAILABLE" },
      },
    });

    const resource = await request("resources/read", {
      uri: "ui://narracut/workbench-v1.html",
    }) as {
      contents: Array<{ mimeType: string; text: string; _meta: unknown }>;
    };
    expect(resource.contents[0]).toMatchObject({
      mimeType: "text/html;profile=mcp-app",
      _meta: {
        ui: {
          prefersBorder: false,
          csp: { connectDomains: [], resourceDomains: [] },
        },
      },
    });
    expect(resource.contents[0]?.text).toContain("narracut-vnext-contact-sheet");
    expect(resource.contents[0]?.text).toContain("data:image/webp;base64,");
    expect(resource.contents[0]?.text).toContain("data:font/woff2;base64,");
    expect(resource.contents[0]?.text).toContain('font-family:"Narracut Display"');
    expect(resource.contents[0]?.text).not.toContain("/*__NARRACUT_MATERIALS__*/");
    expect(Buffer.byteLength(resource.contents[0]!.text, "utf8")).toBeLessThan(1_000_000);
  });

  it("工作台工具可启动并查询专用 Codex 创作线程验证，且不修改项目内容", async () => {
    const projectDirectory = await createProject(2);
    const host = new PluginTestHost();
    const pluginRequest = createNarracutRequestHandler({ codexHost: host });
    const before = await Promise.all([
      readFile(join(projectDirectory, "narracut.json"), "utf8"),
      readFile(join(projectDirectory, "project.json"), "utf8"),
      readFile(join(projectDirectory, "video.md"), "utf8"),
    ]);

    const listed = await pluginRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as {
      tools: Array<{ name: string }>;
    };
    expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "start_agent_host_validation",
      "get_agent_host_validation",
      "stop_agent_host_validation",
      "continue_agent_host_validation",
    ]));

    const started = await pluginRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "start_agent_host_validation",
        arguments: { projectDirectory },
      },
    }) as { structuredContent: { hostValidation: { taskId: string; status: string } } };
    expect(started.structuredContent.hostValidation).toMatchObject({
      status: "running",
      connection: { status: "connected", threadId: "thread-plugin-test" },
      projectModified: false,
    });

    host.complete("10000000-0000-4000-8000-000000000001", 2);
    const status = await pluginRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_agent_host_validation",
        arguments: { taskId: started.structuredContent.hostValidation.taskId },
      },
    }) as { structuredContent: { hostValidation: { status: string } } };
    expect(status.structuredContent.hostValidation).toMatchObject({
      status: "succeeded",
      projectModified: false,
      result: { projectId: "10000000-0000-4000-8000-000000000001", sceneCount: 2 },
    });

    const after = await Promise.all([
      readFile(join(projectDirectory, "narracut.json"), "utf8"),
      readFile(join(projectDirectory, "project.json"), "utf8"),
      readFile(join(projectDirectory, "video.md"), "utf8"),
    ]);
    expect(after).toEqual(before);
  });
});

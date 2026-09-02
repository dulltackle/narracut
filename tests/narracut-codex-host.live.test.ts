import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createNarracutRequestHandler } from "../plugins/narracut/src/server";

const describeLive = process.env.NARRACUT_REAL_CODEX_HOST === "1"
  ? describe.sequential
  : describe.skip;

async function createProject(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "narracut-codex-host-live-"));
  const projectDirectory = join(parent, "host-validation-project");
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
      projectId: "10000000-0000-4000-8000-000000000064",
    })),
    writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [],
      scenes: [{
        id: "30000000-0000-4000-8000-000000000064",
        narration: { text: "验证真实 Codex App Server 宿主边界。" },
        assetIds: [],
      }],
    })),
    writeFile(join(projectDirectory, "video.md"), "# 宿主验证\n"),
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

describeLive("真实 Codex App Server 宿主验收", () => {
  it("创建专用只读线程并回传通过身份校验的结构化结果", async () => {
    const projectDirectory = await createProject();
    const request = createNarracutRequestHandler();
    try {
      const started = await request({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "start_agent_host_validation",
          arguments: { projectDirectory },
        },
      }) as { structuredContent: { hostValidation: { taskId: string; status: string } } };
      expect(started.structuredContent.hostValidation.status).toBe("running");
      const taskId = started.structuredContent.hostValidation.taskId;

      await expect.poll(async () => {
        const result = await request({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_agent_host_validation", arguments: { taskId } },
        }) as { structuredContent: { hostValidation: { status: string } } };
        return result.structuredContent.hostValidation.status;
      }, { timeout: 180_000, interval: 1_000 }).toBe("succeeded");
    } finally {
      await request.dispose();
    }
  }, 200_000);
});

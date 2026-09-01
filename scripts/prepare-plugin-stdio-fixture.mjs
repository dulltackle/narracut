import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const fixtureRoot = process.argv[2];
if (!fixtureRoot?.startsWith("/tmp/")) throw new Error("fixture root 必须位于 /tmp。");
const projectDirectory = join(fixtureRoot, "product-demo");
const programDirectory = join(projectDirectory, ".opaque", "revision-1", "render-program");
await Promise.all([
  mkdir(join(projectDirectory, "assets"), { recursive: true }),
  mkdir(join(projectDirectory, "speech"), { recursive: true }),
  mkdir(join(projectDirectory, "renders"), { recursive: true }),
  mkdir(join(programDirectory, "src"), { recursive: true }),
  mkdir(join(programDirectory, "resources"), { recursive: true }),
]);
await Promise.all([
  writeFile(join(projectDirectory, "narracut.json"), JSON.stringify({
    kind: "narracut-project",
    formatVersion: 1,
    projectId: "10000000-0000-4000-8000-000000000001",
  })),
  writeFile(join(projectDirectory, "project.json"), JSON.stringify({
    assets: [],
    scenes: [{
      id: "30000000-0000-4000-8000-000000000001",
      narration: { text: "真实 stdio 检查" },
      assetIds: [],
    }],
  })),
  writeFile(join(projectDirectory, "video.md"), "# stdio fixture\n"),
  writeFile(join(programDirectory, "program.json"), JSON.stringify({
    apiVersion: 1,
    output: { width: 1920, height: 1080, fps: 30 },
  })),
  writeFile(join(programDirectory, "package.json"), '{"private":true}'),
  writeFile(join(programDirectory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
  writeFile(join(programDirectory, "src", "RenderProgram.tsx"), "export const RenderProgram = () => null;\n"),
]);

for (const request of [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "narracut-test", version: "1.0.0" } } },
  { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "health_check", arguments: {} } },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "inspect_project", arguments: { projectDirectory } } },
  { jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "ui://narracut/workbench-v1.html" } },
]) process.stdout.write(`${JSON.stringify(request)}\n`);

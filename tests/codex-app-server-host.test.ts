import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CodexAppServerHost } from "../plugins/narracut/src/codex-app-server-host";

function fakeServerSource(marker: string, mode: "reject" | "timeout"): string {
  return `
import { writeFileSync } from "node:fs";
const marker = ${JSON.stringify(marker)};
const mode = ${JSON.stringify(mode)};
process.on("SIGTERM", () => {
  writeFileSync(marker, "terminated");
  process.exit(0);
});
if (mode === "reject") {
  process.stdout.write(JSON.stringify({ id: 1, error: { code: -32000, message: "rejected" } }) + "\\n");
  process.stdin.resume();
} else {
  process.stdin.resume();
}
setInterval(() => {}, 1_000);
`;
}

async function waitForFile(path: string): Promise<void> {
  await expect.poll(async () => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }, { timeout: 2_000 }).toBe(true);
}

async function fakeServer(mode: "reject" | "timeout") {
  const directory = await mkdtemp(join(tmpdir(), "narracut-codex-host-"));
  const script = join(directory, "server.mjs");
  const marker = join(directory, "terminated.txt");
  await writeFile(script, fakeServerSource(marker, mode), "utf8");
  return { script, marker };
}

describe("Codex App Server 宿主适配器", () => {
  it("initialize 被拒绝时终止对应子进程并允许安全释放", async () => {
    const fake = await fakeServer("reject");
    const host = new CodexAppServerHost({
      command: process.execPath,
      commandArgs: [fake.script],
      requestTimeoutMs: 2_000,
    });

    await expect(host.createThread({ projectDirectory: "/work/project" })).rejects.toThrow(
      "initialize 失败：rejected",
    );
    await waitForFile(fake.marker);
    await host.dispose();
  });

  it("请求无响应时在有界时间内失败并终止挂起子进程", async () => {
    const fake = await fakeServer("timeout");
    const host = new CodexAppServerHost({
      command: process.execPath,
      commandArgs: [fake.script],
      requestTimeoutMs: 50,
    });

    await expect(host.createThread({ projectDirectory: "/work/project" })).rejects.toThrow(
      "initialize 超过 50ms 未响应",
    );
    await waitForFile(fake.marker);
    await host.dispose();
  });
});

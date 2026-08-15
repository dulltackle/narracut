import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../src/server/cli";
import type { RunningServer } from "../src/server/server";

const runningServers: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
});

describe("pnpm start <项目路径>", () => {
  it("启动回环服务后用默认浏览器打开同一个 URL", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-cli-"));
    const projectDirectory = join(root, "demo");
    const staticDirectory = join(root, "client");
    await mkdir(projectDirectory);
    await mkdir(staticDirectory);
    await writeFile(
      join(projectDirectory, "project.json"),
      '{"schemaVersion":1,"metadata":{},"assets":[],"scenes":[]}',
    );
    await writeFile(join(staticDirectory, "index.html"), "<main>Narracut</main>");

    const openUrl = vi.fn(async () => undefined);
    const log = vi.fn();
    const server = await runCli({
      args: [projectDirectory],
      staticDirectory,
      initialPort: 0,
      openUrl,
      log,
    });
    runningServers.push(server);

    expect(openUrl).toHaveBeenCalledOnce();
    expect(openUrl).toHaveBeenCalledWith(server.url);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(server.url));
    expect((await fetch(server.url)).status).toBe(200);
  });

  it("缺少项目路径时给出稳定的命令用法", async () => {
    await expect(
      runCli({
        args: [],
        staticDirectory: "/not-used",
        openUrl: async () => undefined,
        log: () => undefined,
      }),
    ).rejects.toThrow("用法：pnpm start <项目路径>");
  });
});

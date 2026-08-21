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
  it("使用 NARRACUT_HOST 启动指定地址的服务但不自动打开浏览器", async () => {
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

    const log = vi.fn();
    const server = await runCli({
      args: [projectDirectory],
      staticDirectory,
      initialPort: 0,
      log,
      envFile: join(root, "missing.env"),
      environment: { NARRACUT_HOST: "127.0.0.1" },
    });
    runningServers.push(server);

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(server.url));
    expect((await fetch(server.url)).status).toBe(200);
  });

  it("缺少项目路径时给出稳定的命令用法", async () => {
    await expect(
      runCli({
        args: [],
        staticDirectory: "/not-used",
        log: () => undefined,
      }),
    ).rejects.toThrow("用法：pnpm start <项目路径>");
  });

  it("监听地址不存在时给出覆盖方式并保留底层原因", async () => {
    const unavailable = Object.assign(new Error("bind EADDRNOTAVAIL"), {
      code: "EADDRNOTAVAIL",
    });

    await expect(
      runCli({
        args: ["/not-used"],
        staticDirectory: "/not-used",
        envFile: "/not-used/.env",
        environment: { NARRACUT_HOST: "10.8.0.5" },
        startServer: async () => {
          throw unavailable;
        },
      }),
    ).rejects.toThrow(
      "无法监听 10.8.0.5：该地址在当前机器上不可用（EADDRNOTAVAIL：bind EADDRNOTAVAIL）。" +
        "请启动对应网络接口，或设置 NARRACUT_HOST=127.0.0.1 覆盖。",
    );
  });

  it("从应用根 .env 向 Speech Job 注入 TokenDance API key", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-cli-env-"));
    const projectDirectory = join(root, "demo");
    const staticDirectory = join(root, "client");
    const envFile = join(root, ".env");
    await mkdir(projectDirectory);
    await mkdir(staticDirectory);
    await writeFile(
      join(projectDirectory, "project.json"),
      '{"schemaVersion":1,"metadata":{},"assets":[],"scenes":[]}',
    );
    await writeFile(join(staticDirectory, "index.html"), "<main>Narracut</main>");
    await writeFile(
      envFile,
      "TOKENDANCE_API_KEY=fake-cli-key\nNARRACUT_HOST=127.0.0.1\n",
    );

    const originalApiKey = process.env.TOKENDANCE_API_KEY;
    const originalHost = process.env.NARRACUT_HOST;
    const originalFetch = globalThis.fetch;
    const providerRequest = vi.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) =>
      new Response(JSON.stringify({
        base_resp: { status_code: 1004, status_msg: "invalid api key" },
      }), { status: 401, headers: { "content-type": "application/json" } })
    );
    const providerFetch = providerRequest as unknown as typeof fetch;
    delete process.env.TOKENDANCE_API_KEY;
    delete process.env.NARRACUT_HOST;
    globalThis.fetch = providerFetch;

    let server: RunningServer | undefined;
    try {
      server = await runCli({
        args: [projectDirectory],
        staticDirectory,
        initialPort: 0,
        log: () => undefined,
        envFile,
      });
      runningServers.push(server);
      globalThis.fetch = originalFetch;

      const sessionId = "cli-env-test";
      await originalFetch(`${server.url}/api/project/lease`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const created = await originalFetch(`${server.url}/api/jobs/speech`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-narracut-session-id": sessionId,
        },
        body: JSON.stringify({
          sceneId: "8b000000-0000-4000-8000-000000000001",
          narrationText: "验证启动环境。",
        }),
      });
      expect(created.status).toBe(202);
      const { job } = await created.json() as { job: { id: string } };

      await expect.poll(async () => {
        const response = await originalFetch(`${server!.url}/api/jobs/${job.id}`);
        return (await response.json() as { status: string }).status;
      }).toBe("failed");
      expect(providerRequest).toHaveBeenCalledTimes(1);
      expect(providerRequest.mock.calls[0]?.[1]).toMatchObject({
        headers: { authorization: "Bearer fake-cli-key" },
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.TOKENDANCE_API_KEY;
      else process.env.TOKENDANCE_API_KEY = originalApiKey;
      if (originalHost === undefined) delete process.env.NARRACUT_HOST;
      else process.env.NARRACUT_HOST = originalHost;
    }
  });
});

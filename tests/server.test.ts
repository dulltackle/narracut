import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startNarracutServer, type RunningServer } from "../src/server/server";

const runningServers: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
});

describe("Narracut 本地服务", () => {
  it("同一回环服务提供 SPA、原始 Project DSL 与项目媒体", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-server-"));
    const projectDirectory = join(root, "project");
    const staticDirectory = join(root, "client");
    await mkdir(join(projectDirectory, "assets"), { recursive: true });
    await mkdir(staticDirectory, { recursive: true });

    const projectBytes = '{"schemaVersion":1,"metadata":{},"assets":[],"scenes":[]}\n';
    await writeFile(join(projectDirectory, "project.json"), projectBytes);
    await writeFile(join(projectDirectory, "assets", "sample.txt"), "asset bytes");
    await writeFile(join(staticDirectory, "index.html"), "<main>Narracut SPA</main>");

    const server = await startNarracutServer({
      projectDirectory,
      staticDirectory,
      initialPort: 0,
    });
    runningServers.push(server);

    const [spa, project, media] = await Promise.all([
      fetch(server.url),
      fetch(`${server.url}/api/project`),
      fetch(`${server.url}/media/assets/sample.txt`),
    ]);

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await spa.text()).toContain("Narracut SPA");
    expect(await project.text()).toBe(projectBytes);
    expect(await media.text()).toBe("asset bytes");
    expect(media.headers.get("access-control-allow-origin")).toBe("*");
    expect(await readFile(join(projectDirectory, "project.json"), "utf8")).toBe(
      projectBytes,
    );

    const oversizedWrite = await fetch(`${server.url}/api/project`, {
      method: "PUT",
      body: new Uint8Array(10 * 1024 * 1024 + 1),
    });
    expect(oversizedWrite.status).toBe(413);
    expect(await readFile(join(projectDirectory, "project.json"), "utf8")).toBe(
      projectBytes,
    );
  });

  it("默认端口不可用时自动使用下一个端口", async () => {
    const blocker = createHttpServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const address = blocker.address();
    if (address === null || typeof address === "string") {
      throw new Error("无法获取占用端口");
    }

    const root = await mkdtemp(join(tmpdir(), "narracut-port-"));
    await writeFile(join(root, "project.json"), "{}");
    await writeFile(join(root, "index.html"), "<main>Narracut</main>");

    try {
      const server = await startNarracutServer({
        projectDirectory: root,
        staticDirectory: root,
        initialPort: address.port,
      });
      runningServers.push(server);
      expect(server.port).toBe(address.port + 1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        blocker.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("媒体探测只接受 POSIX 项目相对路径且不会越出项目根", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-probe-"));
    const projectDirectory = join(root, "project");
    const staticDirectory = join(root, "client");
    await mkdir(join(projectDirectory, "assets"), { recursive: true });
    await mkdir(staticDirectory);
    await writeFile(join(projectDirectory, "project.json"), "{}");
    await writeFile(join(projectDirectory, "assets", "present.png"), "image");
    const outsideFile = join(root, "outside.txt");
    await writeFile(outsideFile, "outside project");
    await symlink(outsideFile, join(projectDirectory, "assets", "escape.txt"));
    await writeFile(join(staticDirectory, "index.html"), "<main>Narracut</main>");
    const server = await startNarracutServer({
      projectDirectory,
      staticDirectory,
      initialPort: 0,
    });
    runningServers.push(server);

    const response = await fetch(`${server.url}/api/assets/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paths: [
          "assets/present.png",
          "assets/missing.mp4",
          "assets/escape.txt",
          "../outside.txt",
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        { path: "assets/present.png", exists: true },
        { path: "assets/missing.mp4", exists: false },
        { path: "assets/escape.txt", exists: false },
        { path: "../outside.txt", exists: false, error: "INVALID_PROJECT_PATH" },
      ],
    });

    const malformedResponse = await fetch(`${server.url}/api/assets/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    expect(malformedResponse.status).toBe(400);

    const traversalResponse = await fetch(
      `${server.url}/media/${encodeURIComponent("../project.json")}`,
    );
    expect(traversalResponse.status).toBe(404);

    const symlinkResponse = await fetch(`${server.url}/media/assets/escape.txt`);
    expect(symlinkResponse.status).toBe(404);
  });
});

import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  DEFAULT_SERVER_HOST,
  startNarracutServer,
  type RunningServer,
} from "../src/server/server";

const runningServers: RunningServer[] = [];

function etagFor(bytes: string): string {
  return `"sha256-${createHash("sha256").update(bytes).digest("hex")}"`;
}

async function acquireLease(server: RunningServer, sessionId: string) {
  return fetch(`${server.url}/api/project/lease`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
});

describe("Narracut 本地服务", () => {
  it("默认监听 WireGuard 地址并拒绝不可访问的通配地址", async () => {
    expect(DEFAULT_SERVER_HOST).toBe("10.8.0.5");
    for (const host of ["0.0.0.0", "0.0.0.0.", "0", "::", "0:0:0:0:0:0:0:0"]) {
      await expect(
        startNarracutServer({
          projectDirectory: "/not-used",
          staticDirectory: "/not-used",
          host,
        }),
      ).rejects.toThrow("通配地址");
    }
  });

  it("同一服务提供 SPA、原始 Project DSL 与项目媒体", async () => {
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
      host: "127.0.0.1",
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
    expect(project.headers.get("etag")).toBe(etagFor(projectBytes));
    expect(await media.text()).toBe("asset bytes");
    expect(media.headers.get("access-control-allow-origin")).toBe("*");
    expect(await readFile(join(projectDirectory, "project.json"), "utf8")).toBe(
      projectBytes,
    );

    const lease = await acquireLease(server, "oversized-session");
    expect(lease.status).toBe(200);
    const oversizedWrite = await fetch(`${server.url}/api/project`, {
      method: "PUT",
      headers: {
        "if-match": etagFor(projectBytes),
        "x-narracut-session-id": "oversized-session",
      },
      body: new Uint8Array(10 * 1024 * 1024 + 1),
    });
    expect(oversizedWrite.status).toBe(413);
    expect(await readFile(join(projectDirectory, "project.json"), "utf8")).toBe(
      projectBytes,
    );
  });

  it("按需生成可缓存的视频首帧且拒绝无效项目路径", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-thumbnail-http-"));
    const projectDirectory = join(root, "project");
    const staticDirectory = join(root, "client");
    await mkdir(join(projectDirectory, "assets"), { recursive: true });
    await mkdir(staticDirectory, { recursive: true });
    await writeFile(
      join(projectDirectory, "project.json"),
      '{"schemaVersion":3,"metadata":{},"assets":[],"scenes":[]}\n',
    );
    await writeFile(join(staticDirectory, "index.html"), "<main>Narracut</main>");
    const encodedVideo = await readFile(
      resolve("tests/fixtures/short-video.mp4.b64"),
      "utf8",
    );
    await writeFile(
      join(projectDirectory, "assets", "short.mp4"),
      Buffer.from(encodedVideo.trim(), "base64"),
    );
    const outsideVideo = join(root, "outside.mp4");
    await writeFile(outsideVideo, Buffer.from(encodedVideo.trim(), "base64"));
    await symlink(outsideVideo, join(projectDirectory, "assets", "escape.mp4"));
    await writeFile(join(projectDirectory, "assets", "broken.mp4"), "not-video");

    const server = await startNarracutServer({
      projectDirectory,
      staticDirectory,
      host: "127.0.0.1",
      initialPort: 0,
    });
    runningServers.push(server);
    const thumbnailUrl = `${server.url}/api/assets/thumbnail?${new URLSearchParams({
      path: "assets/short.mp4",
    })}`;

    const thumbnail = await fetch(thumbnailUrl);
    const bytes = Buffer.from(await thumbnail.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    const etag = thumbnail.headers.get("etag");

    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get("content-type")).toBe("image/jpeg");
    expect(thumbnail.headers.get("cache-control")).toBe("private, no-cache");
    expect(etag).toMatch(/^"thumbnail-[a-f0-9]{64}"$/);
    expect(metadata).toMatchObject({ format: "jpeg", width: 320, height: 180 });

    const unchanged = await fetch(thumbnailUrl, {
      headers: { "if-none-match": etag! },
    });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");

    const traversal = await fetch(
      `${server.url}/api/assets/thumbnail?${new URLSearchParams({ path: "../outside.mp4" })}`,
    );
    const missingPath = await fetch(`${server.url}/api/assets/thumbnail`);
    const missing = await fetch(
      `${server.url}/api/assets/thumbnail?${new URLSearchParams({ path: "assets/missing.mp4" })}`,
    );
    const escapingSymlink = await fetch(
      `${server.url}/api/assets/thumbnail?${new URLSearchParams({ path: "assets/escape.mp4" })}`,
    );
    const broken = await fetch(
      `${server.url}/api/assets/thumbnail?${new URLSearchParams({ path: "assets/broken.mp4" })}`,
    );
    expect(traversal.status).toBe(400);
    expect(missingPath.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(escapingSymlink.status).toBe(404);
    expect(broken.status).toBe(422);
  });

  it("租约与 If-Match 在项目互斥锁内阻止并发静默覆盖", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-etag-"));
    const projectDirectory = join(root, "project");
    const staticDirectory = join(root, "client");
    await mkdir(projectDirectory);
    await mkdir(staticDirectory);
    const original = '{"schemaVersion":3,"metadata":{"name":"原始"},"assets":[],"scenes":[]}\n';
    await writeFile(join(projectDirectory, "project.json"), original);
    await writeFile(join(staticDirectory, "index.html"), "<main>Narracut</main>");
    const server = await startNarracutServer({
      projectDirectory,
      staticDirectory,
      host: "127.0.0.1",
      initialPort: 0,
    });
    runningServers.push(server);

    const initial = await fetch(`${server.url}/api/project`);
    const initialEtag = initial.headers.get("etag");
    expect(initialEtag).toBe(etagFor(original));
    expect((await acquireLease(server, "session-a")).status).toBe(200);
    const occupiedLease = await acquireLease(server, "session-b");
    expect(occupiedLease.status).toBe(200);
    await expect(occupiedLease.json()).resolves.toMatchObject({ status: "occupied" });

    const missingPrecondition = await fetch(`${server.url}/api/project`, {
      method: "PUT",
      headers: { "x-narracut-session-id": "session-a" },
      body: original,
    });
    expect(missingPrecondition.status).toBe(428);

    const occupiedWrite = await fetch(`${server.url}/api/project`, {
      method: "PUT",
      headers: {
        "if-match": initialEtag!,
        "x-narracut-session-id": "session-b",
      },
      body: original,
    });
    expect(occupiedWrite.status).toBe(423);

    const first = '{"schemaVersion":3,"metadata":{"name":"第一份"},"assets":[],"scenes":[]}\n';
    const second = '{"schemaVersion":3,"metadata":{"name":"第二份"},"assets":[],"scenes":[]}\n';
    const responses = await Promise.all([
      fetch(`${server.url}/api/project`, {
        method: "PUT",
        headers: {
          "if-match": initialEtag!,
          "x-narracut-session-id": "session-a",
        },
        body: first,
      }),
      fetch(`${server.url}/api/project`, {
        method: "PUT",
        headers: {
          "if-match": initialEtag!,
          "x-narracut-session-id": "session-a",
        },
        body: second,
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([204, 412]);
    const persisted = await readFile(join(projectDirectory, "project.json"), "utf8");
    expect([first, second]).toContain(persisted);
    expect(JSON.parse(persisted)).toBeTypeOf("object");
    const successful = responses.find((response) => response.status === 204)!;
    expect(successful.headers.get("etag")).toBe(etagFor(persisted));

    const idempotentRetry = await fetch(`${server.url}/api/project`, {
      method: "PUT",
      headers: {
        "if-match": initialEtag!,
        "x-narracut-session-id": "session-a",
      },
      body: persisted,
    });
    expect(idempotentRetry.status).toBe(204);
    expect(idempotentRetry.headers.get("etag")).toBe(etagFor(persisted));

    const differentBytes = persisted === first ? second : first;
    const staleDifferentWrite = await fetch(`${server.url}/api/project`, {
      method: "PUT",
      headers: {
        "if-match": initialEtag!,
        "x-narracut-session-id": "session-a",
      },
      body: differentBytes,
    });
    expect(staleDifferentWrite.status).toBe(412);
    expect(await readFile(join(projectDirectory, "project.json"), "utf8")).toBe(
      persisted,
    );
  });

  it("保存前与冲突处理都会生成不可覆盖的原始字节备份", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-backup-"));
    const projectDirectory = join(root, "project");
    const staticDirectory = join(root, "client");
    await mkdir(projectDirectory);
    await mkdir(staticDirectory);
    const original = '{"schemaVersion":2,"metadata":{},"assets":[],"scenes":[]}\n';
    const migrated = '{"schemaVersion":3,"metadata":{},"assets":[],"scenes":[]}\n';
    const memory = '{"schemaVersion":3,"metadata":{"name":"内存版本"},"assets":[],"scenes":[]}\n';
    await writeFile(join(projectDirectory, "project.json"), original);
    await writeFile(join(staticDirectory, "index.html"), "<main>Narracut</main>");
    const server = await startNarracutServer({
      projectDirectory,
      staticDirectory,
      host: "127.0.0.1",
      initialPort: 0,
    });
    runningServers.push(server);
    await acquireLease(server, "backup-session");

    const write = await fetch(`${server.url}/api/project`, {
      method: "PUT",
      headers: {
        "if-match": etagFor(original),
        "x-narracut-session-id": "backup-session",
        "x-narracut-backup-kind": "pre-migration",
      },
      body: migrated,
    });
    expect(write.status).toBe(204);

    const staleBackup = await fetch(`${server.url}/api/project/backups`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "if-match": etagFor(original),
        "x-narracut-session-id": "backup-session",
        "x-narracut-backup-kind": "external-conflict",
      },
      body: memory,
    });
    expect(staleBackup.status).toBe(412);

    const backup = await fetch(`${server.url}/api/project/backups`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "if-match": etagFor(migrated),
        "x-narracut-session-id": "backup-session",
        "x-narracut-backup-kind": "external-conflict",
      },
      body: memory,
    });
    expect(backup.status).toBe(201);

    const files = await readdir(projectDirectory);
    const migrationBackup = files.find((file) => file.includes("pre-migration"));
    const conflictBackup = files.find((file) => file.includes("external-conflict"));
    expect(migrationBackup).toBeDefined();
    expect(conflictBackup).toBeDefined();
    expect(await readFile(join(projectDirectory, migrationBackup!), "utf8")).toBe(original);
    expect(await readFile(join(projectDirectory, conflictBackup!), "utf8")).toBe(memory);
    expect(await readFile(join(projectDirectory, "project.json"), "utf8")).toBe(migrated);
    expect(files.filter((file) => file.includes("external-conflict"))).toHaveLength(1);
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
        host: "127.0.0.1",
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
      host: "127.0.0.1",
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

import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { startNarracutServer, type RunningServer } from "../src/server/server";
import { ImageImportJobs } from "../src/server/image-import-jobs";

const runningServers: RunningServer[] = [];

async function startServer() {
  const root = await mkdtemp(join(tmpdir(), "narracut-image-import-"));
  const projectDirectory = join(root, "project");
  const staticDirectory = join(root, "client");
  await mkdir(projectDirectory);
  await mkdir(staticDirectory);
  const projectBytes = '{"schemaVersion":3,"metadata":{},"assets":[],"scenes":[]}\n';
  await writeFile(join(projectDirectory, "project.json"), projectBytes);
  await writeFile(join(staticDirectory, "index.html"), "<main>Narracut</main>");
  const server = await startNarracutServer({
    projectDirectory,
    staticDirectory,
    host: "127.0.0.1",
    initialPort: 0,
  });
  runningServers.push(server);
  const sessionId = "image-import-session";
  const lease = await fetch(`${server.url}/api/project/lease`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  expect(lease.status).toBe(200);
  return { projectDirectory, projectBytes, server, sessionId };
}

async function waitForJobStatus(
  server: RunningServer,
  jobId: string,
  status: "succeeded" | "failed" | "cancelled",
) {
  let job: Record<string, unknown> | undefined;
  await expect
    .poll(async () => {
      const response = await fetch(`${server.url}/api/jobs/${jobId}`);
      if (!response.ok) return response.status;
      job = (await response.json()) as Record<string, unknown>;
      return job.status;
    })
    .toBe(status);
  return job!;
}

const waitForJob = (server: RunningServer, jobId: string) =>
  waitForJobStatus(server, jobId, "succeeded");

async function collectJobEvents(response: Response, jobId: string) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const jobs: Array<{ id: string; status: string; stage: string }> = [];
  let buffered = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const blocks = buffered.split("\n\n");
    buffered = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);
      if (data === undefined) continue;
      const job = JSON.parse(data) as { id: string; status: string; stage: string };
      if (job.id !== jobId) continue;
      jobs.push(job);
      if (["succeeded", "failed", "cancelled"].includes(job.status)) {
        await reader.cancel();
        return jobs;
      }
    }
  }
  return jobs;
}

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
});

describe("图片导入 Job", () => {
  it("通过 SSE 报告实际阶段，把 PNG 规范化并在成功前不改 Project DSL", async () => {
    const { projectDirectory, projectBytes, server, sessionId } = await startServer();
    const source = await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 4,
        background: { r: 12, g: 160, b: 120, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();

    const eventsResponse = await fetch(`${server.url}/api/jobs/events`);
    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.headers.get("content-type")).toContain("text/event-stream");

    const createResponse = await fetch(`${server.url}/api/jobs/image-import`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-narracut-file-name": encodeURIComponent("透明示例.png"),
        "x-narracut-scene-id": "80000000-0000-4000-8000-000000000001",
        "x-narracut-session-id": sessionId,
      },
      body: source,
    });
    expect(createResponse.status).toBe(202);
    const created = (await createResponse.json()) as {
      job: { id: string; status: string; fileName: string };
    };
    expect(created.job).toMatchObject({
      status: "queued",
      fileName: "透明示例.png",
    });
    expect(await readFile(join(projectDirectory, "project.json"), "utf8")).toBe(
      projectBytes,
    );

    const eventJobsPromise = collectJobEvents(eventsResponse, created.job.id);
    const job = await waitForJob(server, created.job.id);
    expect(job).toMatchObject({
      type: "image-import",
      status: "succeeded",
      sceneId: "80000000-0000-4000-8000-000000000001",
      result: {
        asset: {
          kind: "image",
        },
        facts: {
          sourceWidth: 320,
          sourceHeight: 180,
          width: 1920,
          height: 1080,
          enlarged: true,
        },
      },
    });
    const asset = (job.result as { asset: { path: string } }).asset;
    const output = join(projectDirectory, ...asset.path.split("/"));
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({
      format: "png",
      width: 1920,
      height: 1080,
      space: "srgb",
      depth: "uchar",
      hasAlpha: true,
    });
    expect(await readFile(join(projectDirectory, "project.json"), "utf8")).toBe(
      projectBytes,
    );
    expect((await readdir(join(projectDirectory, "assets"))).sort()).toEqual([
      `${(job.result as { asset: { id: string } }).asset.id}.png`,
    ]);
    const eventJobs = await eventJobsPromise;
    expect(eventJobs.at(-1)).toMatchObject({ status: "succeeded", stage: "completed" });
    expect(eventJobs.map((eventJob) => eventJob.stage)).toEqual(
      expect.arrayContaining(["validating", "normalizing", "verifying", "finalizing"]),
    );
  });

  it("接受 JPEG 与 WebP，应用方向并移除来源元数据", async () => {
    const { projectDirectory, server, sessionId } = await startServer();
    const orientedJpeg = await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 3,
        background: { r: 210, g: 40, b: 70 },
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const transparentWebp = await sharp({
      create: {
        width: 80,
        height: 120,
        channels: 4,
        background: { r: 40, g: 90, b: 210, alpha: 0.3 },
      },
    })
      .webp()
      .toBuffer();

    const imported: Array<Record<string, unknown>> = [];
    for (const [fileName, source] of [
      ["方向.jpg", orientedJpeg],
      ["透明.webp", transparentWebp],
    ] as const) {
      const response = await fetch(`${server.url}/api/jobs/image-import`, {
        method: "POST",
        headers: {
          "x-narracut-file-name": encodeURIComponent(fileName),
          "x-narracut-scene-id": "80000000-0000-4000-8000-000000000001",
          "x-narracut-session-id": sessionId,
        },
        body: source,
      });
      expect(response.status).toBe(202);
      const { job } = (await response.json()) as { job: { id: string } };
      imported.push(await waitForJob(server, job.id));
    }

    expect(imported[0]).toMatchObject({
      result: {
        facts: { sourceWidth: 1000, sourceHeight: 2000, enlarged: false },
      },
    });
    expect(imported[1]).toMatchObject({
      result: {
        facts: { sourceWidth: 80, sourceHeight: 120, enlarged: true },
      },
    });
    for (const job of imported) {
      const path = (job.result as { asset: { path: string } }).asset.path;
      const metadata = await sharp(join(projectDirectory, ...path.split("/"))).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.orientation).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }
    const webpPath = (
      imported[1].result as { asset: { path: string } }
    ).asset.path;
    expect(
      (await sharp(join(projectDirectory, ...webpPath.split("/"))).metadata()).hasAlpha,
    ).toBe(true);
  });

  it("按实际内容拒绝动画图片、SVG、AVIF 与损坏输入且不留下临时文件", async () => {
    const { projectDirectory, server, sessionId } = await startServer();
    const animatedWebp = Buffer.from(
      "UklGRsIAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAD/////AABBTk1GSAAAAAAAAAAAAAEAAAEAAFAAAAJWUDggMAAAANABAJ0BKgIAAgABQCYloAJ0ugH4AAOwAP7y63/82BXNc+/3/9Lg/S4P0uD/0pAAAEFOTUZGAAAAAAAAAAAAAQAAAQAAUAAAAFZQOCAuAAAAlAEAnQEqAgACAAAAJiWgAnS6AAOYAP77VeP/pcH/0uD/6XB/6XB/G7LOG6QAAA==",
      "base64",
    );
    expect((await sharp(animatedWebp, { animated: true }).metadata()).pages).toBe(2);
    const avif = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 20, g: 40, b: 60 },
      },
    })
      .avif()
      .toBuffer();
    const sources = [
      { fileName: "动画.webp", bytes: animatedWebp, code: "ANIMATED_IMAGE_UNSUPPORTED" },
      {
        fileName: "矢量.png",
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'),
        code: "UNSUPPORTED_IMAGE_FORMAT",
      },
      { fileName: "未来格式.png", bytes: avif, code: "UNSUPPORTED_IMAGE_FORMAT" },
      { fileName: "损坏.png", bytes: Buffer.from("not an image"), code: "IMAGE_DECODE_FAILED" },
    ];

    for (const source of sources) {
      const response = await fetch(`${server.url}/api/jobs/image-import`, {
        method: "POST",
        headers: {
          "x-narracut-file-name": encodeURIComponent(source.fileName),
          "x-narracut-scene-id": "80000000-0000-4000-8000-000000000001",
          "x-narracut-session-id": sessionId,
        },
        body: source.bytes,
      });
      expect(response.status).toBe(202);
      const { job } = (await response.json()) as { job: { id: string } };
      const failed = await waitForJobStatus(server, job.id, "failed");
      expect(failed).toMatchObject({
        status: "failed",
        error: { code: source.code },
      });
    }

    expect(await readdir(join(projectDirectory, "assets"))).toEqual([]);
  });

  it("同一 Scene 拒绝并发导入，取消会终止 Job 并清理临时文件", async () => {
    const { projectDirectory, server, sessionId } = await startServer();
    const source = await sharp({
      create: {
        width: 5000,
        height: 5000,
        channels: 4,
        background: { r: 40, g: 120, b: 200, alpha: 0.5 },
      },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const headers = {
      "x-narracut-file-name": encodeURIComponent("取消.png"),
      "x-narracut-scene-id": "80000000-0000-4000-8000-000000000001",
      "x-narracut-session-id": sessionId,
    };
    const firstResponse = await fetch(`${server.url}/api/jobs/image-import`, {
      method: "POST",
      headers,
      body: source,
    });
    expect(firstResponse.status).toBe(202);
    const { job } = (await firstResponse.json()) as { job: { id: string } };

    const concurrent = await fetch(`${server.url}/api/jobs/image-import`, {
      method: "POST",
      headers,
      body: source,
    });
    expect(concurrent.status).toBe(409);

    const cancel = await fetch(`${server.url}/api/jobs/${job.id}`, {
      method: "DELETE",
      headers: { "x-narracut-session-id": sessionId },
    });
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toMatchObject({ status: "cancelling" });
    await waitForJobStatus(server, job.id, "cancelled");
    expect(await readdir(join(projectDirectory, "assets"))).toEqual([]);
  });

  it("finalizing 阶段取消不会发布 Asset", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-finalize-cancel-"));
    await mkdir(join(root, "assets"));
    const source = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 30, g: 90, b: 160 },
      },
    })
      .png()
      .toBuffer();
    const jobs = new ImageImportJobs(root);
    let jobId = "";
    jobs.subscribe((job) => {
      if (job.id === jobId && job.stage === "finalizing") jobs.cancel(job.id);
    });
    const created = jobs.create({
      sceneId: "80000000-0000-4000-8000-000000000001",
      fileName: "最后阶段取消.png",
      source,
    });
    jobId = created.id;

    await expect.poll(() => jobs.get(jobId)?.status).toBe("cancelled");
    expect(await readdir(join(root, "assets"))).toEqual([]);
  });

  it("拒绝通过 assets 符号链接写到项目目录外", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-assets-link-"));
    const projectRoot = join(root, "project");
    const outside = join(root, "outside");
    await mkdir(projectRoot);
    await mkdir(outside);
    await symlink(outside, join(projectRoot, "assets"));
    const jobs = new ImageImportJobs(projectRoot);
    const source = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .png()
      .toBuffer();
    const created = jobs.create({
      sceneId: "80000000-0000-4000-8000-000000000001",
      fileName: "越界.png",
      source,
    });

    await expect.poll(() => jobs.get(created.id)?.status).toBe("failed");
    expect(jobs.get(created.id)).toMatchObject({
      error: { code: "PROJECT_WRITE_FAILED" },
    });
    expect(await readdir(outside)).toEqual([]);
  });
});

import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RenderJobs, RenderJobError, type RenderWorkerHandle } from "../src/server/render-jobs";
import type { Project } from "../src/shared/project";

const sceneId = "31000000-0000-4000-8000-000000000001";

function renderReadyProject(name: string): Project {
  return {
    schemaVersion: 3,
    metadata: { name },
    theme: {
      presetId: "narracut/default@1",
      defaultTextStyleId: "narracut/panel@1",
      defaultTextMotionId: "narracut/fade@1",
      accentColor: "#00A3A6",
      fontId: "narracut/noto-sans-cjk-sc@1",
    },
    assets: [],
    scenes: [{
      id: sceneId,
      narration: { text: "点击时的内存版本" },
      speech: {
        path: `speech/${sceneId}.mp3`,
        durationMs: 100,
        sourceTextHash: "sha256:18e7e163ad57ac86c4af6228e0d881974cd9d67ec000c6bf30299dedd666fe37",
        ttsProfileId: "narracut-mandarin-news-v1",
      },
      visual: { type: "card", title: "不可变快照" },
      transition: "cut",
    }],
  };
}

class FakeWorker extends EventEmitter implements RenderWorkerHandle {
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit("exit", null, "SIGTERM");
    return true;
  }
}

async function createProjectRoot(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(projectRoot, "speech"), { recursive: true });
  await writeFile(join(projectRoot, "speech", `${sceneId}.mp3`), "original speech");
  return projectRoot;
}

describe("Render Job", () => {
  it("返回 Job 前写入只读快照，并让后续 project.json 变化不影响它", async () => {
    const projectRoot = await createProjectRoot("narracut-render-job-");
    const worker = new FakeWorker();
    let snapshotVisibleWhenForked = false;
    let workerInputRoot: string | undefined;
    const jobs = new RenderJobs(projectRoot, {
      workerFactory: (input) => {
        snapshotVisibleWhenForked = input.snapshotFile.endsWith("project.snapshot.json");
        workerInputRoot = input.projectRoot;
        return worker;
      },
    });
    const memoryProject = renderReadyProject("内存版本");

    const job = await jobs.create({
      project: memoryProject,
      mediaBaseUrl: "http://127.0.0.1:3579/media/",
      snapshotSource: "unsaved",
    });
    await writeFile(join(projectRoot, "project.json"), JSON.stringify(renderReadyProject("磁盘新版本")));
    await writeFile(join(projectRoot, "speech", `${sceneId}.mp3`), "replacement speech");

    expect(snapshotVisibleWhenForked).toBe(true);
    expect(workerInputRoot).toBe(join(job.artifacts.directory, ".media"));
    expect(job.type).toBe("render");
    expect(job.snapshotSource).toBe("unsaved");
    expect(JSON.parse(await readFile(job.artifacts.snapshot, "utf8"))).toEqual(memoryProject);
    expect((await stat(job.artifacts.snapshot)).mode & 0o222).toBe(0);
    await expect(
      readFile(join(job.artifacts.directory, ".media", "speech", `${sceneId}.mp3`), "utf8"),
    ).resolves.toBe("original speech");
    expect(job.artifacts.directory).toContain(join(projectRoot, "renders"));
  });

  it("同一项目只允许一个活跃 Job，worker 崩溃只会令 Job 失败", async () => {
    const projectRoot = await createProjectRoot("narracut-render-crash-");
    const worker = new FakeWorker();
    const jobs = new RenderJobs(projectRoot, { workerFactory: () => worker });
    const results = await Promise.allSettled([
      jobs.create({
        project: renderReadyProject("第一次"),
        mediaBaseUrl: "http://127.0.0.1:3579/media/",
        snapshotSource: "saved",
      }),
      jobs.create({
        project: renderReadyProject("第二次"),
        mediaBaseUrl: "http://127.0.0.1:3579/media/",
        snapshotSource: "saved",
      }),
    ]);
    const fulfilled = results.find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof jobs.create>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({
      statusCode: 409,
    } satisfies Partial<RenderJobError>);
    const first = fulfilled!.value;

    worker.emit("exit", 137, null);

    expect(jobs.get(first.id)).toMatchObject({
      status: "failed",
      stage: "failed",
      error: { code: "RENDER_WORKER_CRASHED" },
    });

    worker.emit("message", { type: "completed", durationInFrames: 3 });
    expect(jobs.get(first.id)?.status).toBe("failed");
  });

  it("转发可信阶段与百分比，并在成功后保留三件关联产物", async () => {
    const projectRoot = await createProjectRoot("narracut-render-success-");
    const worker = new FakeWorker();
    const jobs = new RenderJobs(projectRoot, { workerFactory: () => worker });
    const job = await jobs.create({
      project: renderReadyProject("完成"),
      mediaBaseUrl: "http://127.0.0.1:3579/media/",
      snapshotSource: "saved",
    });

    worker.emit("message", { type: "progress", stage: "encoding", progress: 0.42 });
    expect(jobs.get(job.id)).toMatchObject({
      status: "processing",
      stage: "encoding",
      progress: 0.42,
    });

    await writeFile(job.artifacts.output, "mp4");
    await writeFile(job.artifacts.log, "render log");
    worker.emit("message", { type: "completed", durationInFrames: 3 });

    expect(jobs.get(job.id)).toMatchObject({
      status: "succeeded",
      stage: "completed",
      progress: 1,
      durationInFrames: 3,
    });
    await expect(readFile(job.artifacts.output, "utf8")).resolves.toBe("mp4");
    await expect(readFile(job.artifacts.log, "utf8")).resolves.toBe("render log");
  });

  it("worker error 事件只会令任务失败，后续消息不能反转终态", async () => {
    const projectRoot = await createProjectRoot("narracut-render-error-");
    const worker = new FakeWorker();
    const jobs = new RenderJobs(projectRoot, { workerFactory: () => worker });
    const job = await jobs.create({
      project: renderReadyProject("worker error"),
      mediaBaseUrl: "http://127.0.0.1:3579/media/",
      snapshotSource: "saved",
    });

    worker.emit("error", new Error("fork channel unavailable"));
    worker.emit("message", { type: "completed", durationInFrames: 3 });

    expect(jobs.get(job.id)).toMatchObject({
      status: "failed",
      error: { code: "RENDER_WORKER_ERROR", message: "fork channel unavailable" },
    });
  });
});

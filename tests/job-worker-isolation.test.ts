import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  SpeechGenerationJobs,
  type SpeechWorkerHandle,
} from "../src/server/speech-generation-jobs";
import {
  VideoImportJobs,
  type VideoImportWorkerInput,
  type VideoImportWorkerHandle,
} from "../src/server/video-import-jobs";

class FakeWorker extends EventEmitter implements SpeechWorkerHandle, VideoImportWorkerHandle {
  constructor(private readonly exitOnKill = true) {
    super();
  }

  kill(): boolean {
    if (this.exitOnKill) this.emit("exit", null, "SIGTERM");
    return true;
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

describe("Job worker 隔离", () => {
  it("Speech worker 崩溃只终结自己的 Job，其他 Job 继续运行", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "narracut-speech-workers-"));
    const workers: FakeWorker[] = [];
    const jobs = new SpeechGenerationJobs(projectRoot, {
      apiKey: "test-key",
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = jobs.create({
      sceneId: "81000000-0000-4000-8000-000000000001",
      narrationText: "第一个任务",
    });
    const second = jobs.create({
      sceneId: "81000000-0000-4000-8000-000000000002",
      narrationText: "第二个任务",
    });
    await vi.waitFor(() => expect(workers).toHaveLength(2));

    workers[0].emit("exit", 137, null);

    await vi.waitFor(() => expect(jobs.get(first.id)?.status).toBe("failed"));
    expect(jobs.get(first.id)?.error?.code).toBe("SPEECH_WORKER_CRASHED");
    expect(jobs.get(second.id)?.status).toBe("queued");
    workers[1].kill();
    await jobs.close();
  });

  it("Speech 取消后的延迟 IPC 不能撤销 cancelled 终态", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "narracut-speech-cancel-race-"));
    const worker = new FakeWorker();
    const jobs = new SpeechGenerationJobs(projectRoot, {
      apiKey: "test-key",
      workerFactory: () => worker,
    });
    const created = jobs.create({
      sceneId: "81000000-0000-4000-8000-000000000003",
      narrationText: "取消竞态",
    });
    await vi.waitFor(() => expect(worker.listenerCount("message")).toBeGreaterThan(0));

    jobs.cancel(created.id);
    worker.emit("message", {
      state: {
        job: { ...created, status: "processing", stage: "requesting" },
      },
    });

    expect(jobs.get(created.id)?.status).toBe("cancelled");
    await jobs.close();
  });

  it("Transcode worker 崩溃后 FIFO 会继续启动下一项", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "narracut-transcode-workers-"));
    await mkdir(join(projectRoot, "assets"));
    const workers: FakeWorker[] = [];
    const jobs = new VideoImportJobs(projectRoot, {
      mediaBaseUrl: () => "http://127.0.0.1/media/",
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const source = async (name: string) => {
      const file = join(projectRoot, "assets", `.${name}.upload.tmp.mp4`);
      await writeFile(file, name);
      return file;
    };
    const first = jobs.create({ sceneId: "82000000-0000-4000-8000-000000000001", fileName: "one.mp4", sourceFile: await source("one"), sourceBytes: 3 });
    const second = jobs.create({ sceneId: "82000000-0000-4000-8000-000000000002", fileName: "two.mp4", sourceFile: await source("two"), sourceBytes: 3 });
    await vi.waitFor(() => expect(workers).toHaveLength(1));

    workers[0].emit("exit", 137, null);

    await vi.waitFor(() => expect(jobs.get(first.id)?.status).toBe("failed"));
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    expect(jobs.get(second.id)?.status).toBe("queued");
    workers[1].kill();
    await jobs.close();
  });

  it("Transcode 复用父 Job ID，并在 worker 崩溃后清理可确定的临时文件", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "narracut-transcode-cleanup-"));
    const assets = join(projectRoot, "assets");
    await mkdir(assets);
    const worker = new FakeWorker();
    let input: VideoImportWorkerInput | undefined;
    const sourceFile = join(assets, ".source.upload.tmp.mp4");
    await writeFile(sourceFile, "source");
    const jobs = new VideoImportJobs(projectRoot, {
      mediaBaseUrl: () => "http://127.0.0.1/media/",
      workerFactory: (value) => {
        input = value;
        return worker;
      },
    });
    const created = jobs.create({
      sceneId: "82000000-0000-4000-8000-000000000003",
      fileName: "crash.mp4",
      sourceFile,
      sourceBytes: 6,
    });
    await vi.waitFor(() => expect(input?.jobId).toBe(created.id));
    const temporaryFiles = [
      join(assets, `.${created.id}.output.tmp.mp4`),
      join(assets, `.${created.id}.bridge.tmp.mp4`),
      join(assets, `${created.id}.mp4`),
    ];
    await Promise.all(temporaryFiles.map((file) => writeFile(file, "partial")));

    worker.emit("exit", 137, null);
    await jobs.close();

    await expect(exists(sourceFile)).resolves.toBe(false);
    for (const file of temporaryFiles) await expect(exists(file)).resolves.toBe(false);
  });

  it("Transcode worker error 即使没有 exit 也会释放 FIFO", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "narracut-transcode-error-"));
    await mkdir(join(projectRoot, "assets"));
    const workers: FakeWorker[] = [];
    const jobs = new VideoImportJobs(projectRoot, {
      mediaBaseUrl: () => "http://127.0.0.1/media/",
      workerFactory: () => {
        const worker = new FakeWorker(false);
        workers.push(worker);
        return worker;
      },
    });
    const source = async (name: string) => {
      const file = join(projectRoot, "assets", `.${name}.upload.tmp.mp4`);
      await writeFile(file, name);
      return file;
    };
    const first = jobs.create({ sceneId: "82000000-0000-4000-8000-000000000004", fileName: "one.mp4", sourceFile: await source("error-one"), sourceBytes: 3 });
    const second = jobs.create({ sceneId: "82000000-0000-4000-8000-000000000005", fileName: "two.mp4", sourceFile: await source("error-two"), sourceBytes: 3 });
    await vi.waitFor(() => expect(workers).toHaveLength(1));

    workers[0].emit("error", new Error("ipc closed"));

    await vi.waitFor(() => expect(jobs.get(first.id)?.status).toBe("failed"));
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    expect(jobs.get(second.id)?.status).toBe("queued");
    workers[1].emit("error", new Error("ipc closed"));
    await jobs.close();
  });
});

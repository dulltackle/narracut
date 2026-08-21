import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { VideoImportJobs } from "../src/server/video-import-jobs";

const facts = {
  streamIndex: 0,
  codec: "h264" as const,
  sourceWidth: 1920,
  sourceHeight: 1080,
  durationSeconds: 1,
  rotation: 0 as const,
  enlarged: false,
  remuxEligible: true,
};

async function root(): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), "narracut-video-queue-"));
  await mkdir(join(project, "assets"));
  return project;
}

async function source(project: string, name: string): Promise<string> {
  const file = join(project, "assets", `.${name}.upload.tmp.mp4`);
  await writeFile(file, name);
  return file;
}

describe("视频导入 FIFO", () => {
  it("服务端最多运行一个任务，排队中可取消且不留下临时文件", async () => {
    const project = await root();
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const remux = vi.fn(async (_source: string, output: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolvePromise) => releases.push(resolvePromise));
      await import("node:fs/promises").then(({ writeFile }) => writeFile(output, "mp4"));
      active -= 1;
    });
    const jobs = new VideoImportJobs(project, {
      mediaBaseUrl: () => "http://127.0.0.1/media/",
      pipeline: {
        inspect: vi.fn(async () => facts),
        remux,
        transcode: vi.fn(),
        verify: vi.fn(async () => undefined),
      },
    });

    const first = jobs.create({ sceneId: "80000000-0000-4000-8000-000000000001", fileName: "one.mp4", sourceFile: await source(project, "one"), sourceBytes: 3 });
    const second = jobs.create({ sceneId: "80000000-0000-4000-8000-000000000002", fileName: "two.mov", sourceFile: await source(project, "two"), sourceBytes: 3 });
    const third = jobs.create({ sceneId: "80000000-0000-4000-8000-000000000003", fileName: "three.mp4", sourceFile: await source(project, "three"), sourceBytes: 5 });

    await vi.waitFor(() => expect(jobs.get(first.id)?.stage).toBe("normalizing"));
    expect(jobs.get(second.id)?.status).toBe("queued");
    expect(jobs.cancel(second.id)).toMatchObject({ status: "cancelled" });
    releases.shift()?.();
    await vi.waitFor(() => expect(jobs.get(first.id)?.status).toBe("succeeded"));
    await vi.waitFor(() => expect(jobs.get(third.id)?.stage).toBe("normalizing"));
    releases.shift()?.();
    await vi.waitFor(() => expect(jobs.get(third.id)?.status).toBe("succeeded"));

    expect(maxActive).toBe(1);
    expect(remux).toHaveBeenCalledTimes(2);
    expect((await readdir(join(project, "assets"))).filter((name) => name.startsWith("."))).toEqual([]);
  });

  it("取消运行中任务会中止执行并继续下一项", async () => {
    const project = await root();
    const remux = vi.fn((_source: string, _output: string, _stream: number, signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    );
    const jobs = new VideoImportJobs(project, {
      mediaBaseUrl: () => "http://127.0.0.1/media/",
      pipeline: {
        inspect: vi.fn(async () => facts),
        remux,
        transcode: vi.fn(),
        verify: vi.fn(async () => undefined),
      },
    });
    const first = jobs.create({ sceneId: "80000000-0000-4000-8000-000000000001", fileName: "one.mp4", sourceFile: await source(project, "one"), sourceBytes: 3 });
    const second = jobs.create({ sceneId: "80000000-0000-4000-8000-000000000002", fileName: "two.mp4", sourceFile: await source(project, "two"), sourceBytes: 3 });

    await vi.waitFor(() => expect(jobs.get(first.id)?.stage).toBe("normalizing"));
    jobs.cancel(first.id);
    await vi.waitFor(() => expect(jobs.get(first.id)?.status).toBe("cancelled"));
    await vi.waitFor(() => expect(jobs.get(second.id)?.stage).toBe("normalizing"));
    jobs.cancel(second.id);
    await vi.waitFor(() => expect(jobs.get(second.id)?.status).toBe("cancelled"));
  });
});

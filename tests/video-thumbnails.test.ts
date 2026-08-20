import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  VideoThumbnailError,
  VideoThumbnailService,
} from "../src/server/video-thumbnails";

async function temporaryVideo(name = "sample.mp4"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "narracut-thumbnail-service-"));
  const file = join(directory, name);
  await writeFile(file, "video-source");
  return file;
}

describe("VideoThumbnailService", () => {
  it("去重相同源文件的并发抽帧并复用缓存", async () => {
    const file = await temporaryVideo();
    const extractFrame = vi.fn(async () => Buffer.from("jpeg"));
    const service = new VideoThumbnailService({ extractFrame });

    const [first, second] = await Promise.all([
      service.get("assets/sample.mp4", file),
      service.get("assets/sample.mp4", file),
    ]);
    const cached = await service.get("assets/sample.mp4", file);

    expect(extractFrame).toHaveBeenCalledTimes(1);
    expect(first.etag).toBe(second.etag);
    expect(cached.bytes.toString()).toBe("jpeg");
    await service.close();
  });

  it("同时运行的抽帧任务不超过配置上限", async () => {
    const files = await Promise.all([
      temporaryVideo("one.mp4"),
      temporaryVideo("two.mp4"),
      temporaryVideo("three.mp4"),
    ]);
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const extractFrame = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolvePromise) => releases.push(resolvePromise));
      active -= 1;
      return Buffer.from("jpeg");
    });
    const service = new VideoThumbnailService({ extractFrame, maxConcurrent: 2 });
    const pending = files.map((file, index) =>
      service.get(`assets/${index}.mp4`, file)
    );

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(maxActive).toBe(2);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.splice(0).forEach((release) => release());
    await Promise.all(pending);

    expect(maxActive).toBe(2);
    await service.close();
  });

  it("源文件变化时丢弃旧结果并重试一次", async () => {
    const file = await temporaryVideo();
    let calls = 0;
    const service = new VideoThumbnailService({
      extractFrame: async () => {
        calls += 1;
        if (calls === 1) await writeFile(file, "changed-video-source");
        return Buffer.from(`jpeg-${calls}`);
      },
    });

    const result = await service.get("assets/sample.mp4", file);

    expect(calls).toBe(2);
    expect(result.bytes.toString()).toBe("jpeg-2");
    await service.close();
  });

  it("同一路径换成新签名后立即淘汰旧图并更新 ETag", async () => {
    const file = await temporaryVideo();
    let calls = 0;
    const service = new VideoThumbnailService({
      extractFrame: async () => Buffer.from(`jpeg-${++calls}`),
    });

    const first = await service.get("assets/sample.mp4", file);
    await writeFile(file, "replacement-video-source");
    const replacement = await service.get("assets/sample.mp4", file);
    const cachedReplacement = await service.get("assets/sample.mp4", file);

    expect(replacement.etag).not.toBe(first.etag);
    expect(replacement.bytes.toString()).toBe("jpeg-2");
    expect(cachedReplacement.bytes.toString()).toBe("jpeg-2");
    expect(calls).toBe(2);
    await service.close();
  });

  it("按条目上限淘汰最旧缓存", async () => {
    const firstFile = await temporaryVideo("first.mp4");
    const secondFile = await temporaryVideo("second.mp4");
    const extractFrame = vi.fn(async (file: string) => Buffer.from(file));
    const service = new VideoThumbnailService({
      extractFrame,
      maxCacheEntries: 1,
    });

    await service.get("assets/first.mp4", firstFile);
    await service.get("assets/second.mp4", secondFile);
    await service.get("assets/first.mp4", firstFile);

    expect(extractFrame).toHaveBeenCalledTimes(3);
    await service.close();
  });

  it("按字节上限淘汰最旧缓存", async () => {
    const firstFile = await temporaryVideo("first.mp4");
    const secondFile = await temporaryVideo("second.mp4");
    const extractFrame = vi.fn(async () => Buffer.from("four"));
    const service = new VideoThumbnailService({
      extractFrame,
      maxCacheBytes: 4,
    });

    await service.get("assets/first.mp4", firstFile);
    await service.get("assets/second.mp4", secondFile);
    await service.get("assets/first.mp4", firstFile);

    expect(extractFrame).toHaveBeenCalledTimes(3);
    await service.close();
  });

  it("源文件连续变化两次时返回冲突", async () => {
    const file = await temporaryVideo();
    let calls = 0;
    const service = new VideoThumbnailService({
      extractFrame: async () => {
        calls += 1;
        await writeFile(file, `changed-video-source-${calls}`);
        return Buffer.from(`jpeg-${calls}`);
      },
    });

    await expect(service.get("assets/sample.mp4", file)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(calls).toBe(2);
    await service.close();
  });

  it("关闭时取消活动任务并拒绝新请求", async () => {
    const file = await temporaryVideo();
    const queuedFile = await temporaryVideo("queued.mp4");
    let started!: () => void;
    const didStart = new Promise<void>((resolvePromise) => {
      started = resolvePromise;
    });
    const extractFrame = vi.fn(
      (_file: string, signal: AbortSignal) => new Promise<Buffer>((_resolve, reject) => {
        started();
        signal.addEventListener(
          "abort",
          () => reject(new VideoThumbnailError(503, "aborted")),
          { once: true },
        );
      }),
    );
    const service = new VideoThumbnailService({ extractFrame, maxConcurrent: 1 });
    const pending = service.get("assets/sample.mp4", file);
    const queued = service.get("assets/queued.mp4", queuedFile);
    await didStart;
    const pendingAssertion = expect(pending).rejects.toMatchObject({ statusCode: 503 });
    const queuedAssertion = expect(queued).rejects.toMatchObject({ statusCode: 503 });

    await service.close();

    await Promise.all([pendingAssertion, queuedAssertion]);
    expect(extractFrame).toHaveBeenCalledTimes(1);
    await expect(service.get("assets/sample.mp4", file)).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});

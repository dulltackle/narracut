import { describe, expect, it, vi } from "vitest";

import { VideoThumbnailLoader } from "../src/client/video-thumbnail-store";

function jpegResponse(value: string): Response {
  return new Response(new Blob([value], { type: "image/jpeg" }), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
}

describe("VideoThumbnailLoader", () => {
  it("每个标签页最多同时请求两张首帧图并去重路径", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolvePromise) => releases.push(resolvePromise));
      active -= 1;
      return jpegResponse(String(input));
    }) as unknown as typeof fetch;
    const loader = new VideoThumbnailLoader({
      fetchImpl,
      createObjectUrl: (blob) => `blob:${blob.size}:${Math.random()}`,
      revokeObjectUrl: () => undefined,
      maxConcurrent: 2,
    });

    loader.load("assets/one.mp4");
    loader.load("assets/one.mp4");
    loader.load("assets/two.mp4");
    loader.load("assets/three.mp4");

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(maxActive).toBe(2);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));

    expect(maxActive).toBe(2);
    loader.dispose();
  });

  it("缓存超限时撤销最旧且无人订阅的 Object URL", async () => {
    const revoked: string[] = [];
    let objectUrl = 0;
    const loader = new VideoThumbnailLoader({
      fetchImpl: vi.fn(async () => jpegResponse("jpeg")) as unknown as typeof fetch,
      createObjectUrl: () => `blob:${++objectUrl}`,
      revokeObjectUrl: (url) => revoked.push(url),
      maxCacheEntries: 1,
    });
    const unsubscribe = loader.subscribe("assets/one.mp4", () => undefined);
    loader.load("assets/one.mp4");
    await vi.waitFor(() => expect(objectUrl).toBe(1));
    unsubscribe();
    loader.load("assets/two.mp4");
    await vi.waitFor(() => expect(objectUrl).toBe(2));

    expect(revoked).toContain("blob:1");
    loader.dispose();
  });

  it("缓存字节超限时撤销最旧 Object URL", async () => {
    const revoked: string[] = [];
    let objectUrl = 0;
    const loader = new VideoThumbnailLoader({
      fetchImpl: vi.fn(async () => jpegResponse("four")) as unknown as typeof fetch,
      createObjectUrl: () => `blob:${++objectUrl}`,
      revokeObjectUrl: (url) => revoked.push(url),
      maxCacheBytes: 4,
    });

    loader.load("assets/one.mp4");
    await vi.waitFor(() => expect(objectUrl).toBe(1));
    loader.load("assets/two.mp4");
    await vi.waitFor(() => expect(objectUrl).toBe(2));

    expect(revoked).toContain("blob:1");
    loader.dispose();
  });

  it("错误响应降级为 error 状态而不重试风暴", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 422 })) as unknown as typeof fetch;
    const loader = new VideoThumbnailLoader({ fetchImpl });
    const states: string[] = [];
    loader.subscribe("assets/broken.mp4", (state) => states.push(state.status));

    loader.load("assets/broken.mp4");
    await vi.waitFor(() => expect(states.at(-1)).toBe("error"));
    loader.load("assets/broken.mp4");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    loader.dispose();
  });
});

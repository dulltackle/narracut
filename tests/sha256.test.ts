import { describe, expect, it, vi } from "vitest";

import { sha256Utf8 } from "../src/shared/sha256";

describe("SHA-256", () => {
  it("Web Crypto 可用时优先调用原生 digest", async () => {
    const digest = vi.fn(async () => new Uint8Array(32).buffer);

    await expect(sha256Utf8("原生路径", { subtle: { digest } })).resolves.toBe(
      `sha256:${"0".repeat(64)}`,
    );
    expect(digest).toHaveBeenCalledWith("SHA-256", new TextEncoder().encode("原生路径"));
  });

  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "a".repeat(56),
      "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
    ],
    ["旁白文本", "f895365f4e0e21afc48d7a1e8b4c0e1a5688f3eb7b9d50887a10e16aec184192"],
  ])("Web Crypto 不可用时仍生成标准摘要：%j", async (text, expected) => {
    await expect(sha256Utf8(text, {})).resolves.toBe(`sha256:${expected}`);
  });
});

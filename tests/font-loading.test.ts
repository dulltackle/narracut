import { afterEach, describe, expect, it, vi } from "vitest";

import { loadNarracutFont } from "../src/remotion/font-loading";

const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
});

describe("Remotion 内置字体加载", () => {
  it("Player 与 renderer 调用复用同一个本地字体 Promise", async () => {
    const load = vi.fn(async (_descriptor: string): Promise<FontFace[]> => [
      {} as FontFace,
    ]);
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { fonts: { load } },
    });

    const first = loadNarracutFont('"Noto Sans SC Variable"');
    const second = loadNarracutFont('"Noto Sans SC Variable"');

    expect(second).toBe(first);
    await expect(first).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls.map(([descriptor]) => descriptor)).toEqual([
      '400 1em "Noto Sans SC Variable"',
      '700 1em "Noto Sans SC Variable"',
      '900 1em "Noto Sans SC Variable"',
    ]);
  });
});

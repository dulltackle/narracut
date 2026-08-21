import { describe, expect, it, vi } from "vitest";

import { createClientUuid } from "../src/client/client-uuid";

describe("客户端 UUID", () => {
  it("优先使用浏览器提供的 randomUUID", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array<ArrayBuffer>) => bytes);

    expect(
      createClientUuid({
        randomUUID: () => "native-uuid",
        getRandomValues,
      }),
    ).toBe("native-uuid");
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("非安全上下文缺少 randomUUID 时生成 RFC 4122 v4 UUID", () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);

    expect(
      createClientUuid({
        getRandomValues: (target) => {
          target.set(bytes);
          return target;
        },
      }),
    ).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { preflightPublicE2E } from "./support/public-e2e";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("公开浏览器 E2E 前置检查", () => {
  it("缺少 TokenDance key 时明确失败", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-public-e2e-preflight-"));
    temporaryRoots.push(root);

    await expect(preflightPublicE2E({ environment: {}, envFile: join(root, ".env") }))
      .rejects.toThrow("缺少 TOKENDANCE_API_KEY");
  });

  it("TokenDance 网络不可达时明确失败且不泄露 key", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-public-e2e-preflight-"));
    temporaryRoots.push(root);
    const envFile = join(root, ".env");
    const secret = "super-secret-live-key";
    await writeFile(envFile, `TOKENDANCE_API_KEY=${secret}\n`);
    const probe = vi.fn(async () => {
      throw new Error(`socket failed with ${secret}`);
    });

    let failure: unknown;
    try {
      await preflightPublicE2E({ environment: {}, envFile, probe });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("TokenDance 网络前置检查失败，未启动浏览器旅程。");
    expect((failure as Error).message).not.toContain(secret);
  });
});

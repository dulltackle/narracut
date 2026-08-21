import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createRealAcceptanceManifest,
  preflightRealAcceptance,
  resolveCanonicalPath,
} from "./support/real-acceptance";

async function createFixture(sceneCount = 13): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "narracut-real-acceptance-preflight-"));
  await mkdir(join(root, "clips"));
  await writeFile(
    join(root, "script.md"),
    `${Array.from({ length: sceneCount }, (_, index) => `Narration ${index + 1}`).join("\n")}\n`,
  );
  await writeFile(join(root, "clips", "1.png"), "private image");
  await Promise.all(Array.from({ length: 12 }, (_, index) =>
    writeFile(join(root, "clips", `${index + 2}.mp4`), "private video")
  ));
  return root;
}

describe("真实 13 Scene 验收前置检查", () => {
  it("返回严格编号的 13 条 Narration、1 张图片和 12 段视频", async () => {
    const fixtureRoot = await createFixture();
    const evidenceRoot = join(fixtureRoot, "acceptance");
    const result = await preflightRealAcceptance({
      fixtureRoot,
      evidenceRoot,
      envFile: join(fixtureRoot, ".env"),
      environment: { TOKENDANCE_API_KEY: "private-key" },
      probe: vi.fn(async () => new Response(null, { status: 204 })),
      isPrivatePath: vi.fn(async () => true),
    });

    expect(result.narrations).toHaveLength(13);
    expect(result.sources.map((source) => source.kind)).toEqual([
      "image",
      ...Array<string>(12).fill("video"),
    ]);
    expect(result.sources.map((source) => source.path)).toEqual([
      join(fixtureRoot, "clips", "1.png"),
      ...Array.from({ length: 12 }, (_, index) =>
        join(fixtureRoot, "clips", `${index + 2}.mp4`)
      ),
    ]);
    expect(result.fixtureFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.sourceFingerprints).toHaveLength(13);
    expect(result.sourceFingerprints.every((fingerprint) =>
      /^sha256:[0-9a-f]{64}$/u.test(fingerprint)
    )).toBe(true);
  });

  it("运行清单逐 Scene 绑定 Narration、源素材与规范化 Asset", async () => {
    const root = await createFixture();
    const assetPath = "assets/scene-1.png";
    await mkdir(join(root, "assets"));
    await writeFile(join(root, assetPath), "normalized image");

    const project = {
      schemaVersion: 3 as const,
      metadata: {},
      theme: {
        presetId: "narracut/default@1",
        defaultTextStyleId: "narracut/default@1",
        defaultTextMotionId: "narracut/none@1",
        accentColor: "#000000",
        fontId: "narracut/inter@1",
      },
      assets: [{ id: "00000000-0000-4000-8000-000000000001", kind: "image" as const, path: assetPath }],
      scenes: [{
        id: "00000000-0000-4000-8000-000000000002",
        narration: { text: "Narration 1" },
        visual: { type: "image" as const, assetId: "00000000-0000-4000-8000-000000000001" },
        transition: "cut" as const,
      }],
    };
    const manifest = await createRealAcceptanceManifest({
      fixtureFingerprint: "sha256:fixture",
      sourceFingerprints: ["sha256:source"],
      narrations: ["Narration 1"],
      project,
      projectRoot: root,
    });

    expect(manifest.scenes[0]).toMatchObject({
      index: 1,
      sceneId: project.scenes[0].id,
      narrationFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      sourceFingerprint: "sha256:source",
      assetId: project.assets[0].id,
      assetPath,
      normalizedAssetFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    await expect(createRealAcceptanceManifest({
      fixtureFingerprint: "sha256:fixture",
      sourceFingerprints: ["sha256:source"],
      narrations: ["另一条 Narration"],
      project,
      projectRoot: root,
    })).rejects.toThrow("Narration 与当前夹具不一致");
  });

  it("Narration 不是 13 条时在启动浏览器前失败", async () => {
    const fixtureRoot = await createFixture(12);

    await expect(preflightRealAcceptance({
      fixtureRoot,
      evidenceRoot: join(fixtureRoot, "acceptance"),
      envFile: join(fixtureRoot, ".env"),
      environment: { TOKENDANCE_API_KEY: "private-key" },
      probe: vi.fn(async () => new Response(null, { status: 204 })),
      isPrivatePath: vi.fn(async () => true),
    })).rejects.toThrow("必须恰好包含 13 条非空 Narration");
  });

  it("夹具或证据目录未被隔离时拒绝运行", async () => {
    const fixtureRoot = await createFixture();

    await expect(preflightRealAcceptance({
      fixtureRoot,
      evidenceRoot: join(fixtureRoot, "acceptance"),
      envFile: join(fixtureRoot, ".env"),
      environment: { TOKENDANCE_API_KEY: "private-key" },
      probe: vi.fn(async () => new Response(null, { status: 204 })),
      isPrivatePath: vi.fn(async (path: string) => !path.endsWith("acceptance")),
    })).rejects.toThrow("证据目录必须位于仓库外或被 Git 忽略");
  });

  it("续跑目录必须位于已验证的证据目录内", async () => {
    const fixtureRoot = await createFixture();

    await expect(preflightRealAcceptance({
      fixtureRoot,
      evidenceRoot: join(fixtureRoot, "acceptance"),
      resumeDirectory: join(fixtureRoot, "unrelated-private-run"),
      envFile: join(fixtureRoot, ".env"),
      environment: { TOKENDANCE_API_KEY: "private-key" },
      probe: vi.fn(async () => new Response(null, { status: 204 })),
      isPrivatePath: vi.fn(async () => true),
    })).rejects.toThrow("续跑目录必须位于已验证的证据目录内");
  });

  it("规范化既存符号链接和待创建子路径", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-real-path-"));
    const target = join(root, "target");
    const link = join(root, "link");
    await mkdir(target);
    await symlink(target, link, "dir");

    await expect(resolveCanonicalPath(join(link, "future", "run")))
      .resolves.toBe(join(await realpath(target), "future", "run"));
  });
});

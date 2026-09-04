import { createHash } from "node:crypto";
import { access, link, mkdir, mkdtemp, readFile, readdir, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createProjectVNext, openProjectVNext } from "../src/server/project-lifecycle";
import { inspectProjectVNext } from "../src/server/project-vnext-inspection";
import { ttsProfileId, writeProjectTtsConfig, type ProjectTtsConfig } from "../src/server/project-speech-vnext";

const ttsConfig: ProjectTtsConfig = {
  provider: "tokendance",
  model: "minimax-speech-2.8-turbo",
  voice: "Chinese (Mandarin)_News_Anchor",
  speed: 1,
  volume: 1,
  pitch: 0,
};

describe("Project VNext 生命周期", () => {
  it("项目打开后 Speech 目录被替换时拒绝通过符号链接写到项目外", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-speech-anchor-"));
    const projectDirectory = join(parentDirectory, "project");
    const outsideDirectory = join(parentDirectory, "outside");
    await createProjectVNext(projectDirectory);
    await mkdir(outsideDirectory);
    const opened = await openProjectVNext(projectDirectory, { probeSpeechDurationMs: async () => 1_000 });
    await rename(join(projectDirectory, "speech"), join(projectDirectory, "speech-original"));
    await symlink(outsideDirectory, join(projectDirectory, "speech"), "dir");

    await expect(opened.probeSpeechAudio({ jobId: "directory-swap", audio: Buffer.from("mp3") }))
      .rejects.toMatchObject({ code: "PROJECT_IDENTITY_LOST" });
    expect(await readdir(outsideDirectory)).toEqual([]);
    await opened.release();
  });

  it("writing 阶段取消时回滚新音频且不写入 Speech 记录", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-speech-cancel-"));
    const projectDirectory = join(parentDirectory, "project");
    const sceneId = "30000000-0000-4000-8000-000000000001";
    await createProjectVNext(projectDirectory);
    await writeProjectTtsConfig(projectDirectory, ttsConfig);
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [],
      scenes: [{ id: sceneId, narration: { text: "取消测试" }, assetIds: [] }],
    }));
    let cancelled = false;
    const opened = await openProjectVNext(projectDirectory, {
      probeSpeechDurationMs: async () => {
        cancelled = true;
        return 1_000;
      },
    });

    await expect(opened.commitSpeech({
      sceneId,
      narrationText: "取消测试",
      ttsProfileId: ttsProfileId(ttsConfig),
      durationMs: 1_000,
      audio: Buffer.from("new mp3"),
      isCancelled: () => cancelled,
    })).rejects.toMatchObject({ code: "PROJECT_SAVE_FAILED" });
    expect(JSON.parse(await readFile(join(projectDirectory, "project.json"), "utf8")).scenes[0].speech)
      .toBeUndefined();
    await expect(access(join(projectDirectory, "speech", `${sceneId}.mp3`))).rejects.toMatchObject({ code: "ENOENT" });
    await opened.release();
  });

  it("越过 Speech 提交点后忽略迟到取消并完成一致提交", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-speech-late-cancel-"));
    const projectDirectory = join(parentDirectory, "project");
    const sceneId = "30000000-0000-4000-8000-000000000001";
    await createProjectVNext(projectDirectory);
    await writeProjectTtsConfig(projectDirectory, ttsConfig);
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [],
      scenes: [{ id: sceneId, narration: { text: "迟到取消" }, assetIds: [] }],
    }));
    let cancelled = false;
    const opened = await openProjectVNext(projectDirectory, { probeSpeechDurationMs: async () => 1_000 });
    const result = await opened.commitSpeech({
      sceneId,
      narrationText: "迟到取消",
      ttsProfileId: ttsProfileId(ttsConfig),
      durationMs: 1_000,
      audio: Buffer.from("committed mp3"),
      isCancelled: () => cancelled,
      onCommitPoint: () => { cancelled = true; },
    });

    expect(result.status).toBe("applied");
    expect(JSON.parse(await readFile(join(projectDirectory, "project.json"), "utf8")).scenes[0].speech)
      .toMatchObject({ durationMs: 1_000, audioContentHash: expect.stringMatching(/^sha256:/u) });
    expect(await readFile(join(projectDirectory, "speech", `${sceneId}.mp3`), "utf8")).toBe("committed mp3");
    await opened.release();
  });

  it("TTS 配置提交失败时恢复已移除的 Speech 引用", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-tts-rollback-"));
    const projectDirectory = join(parentDirectory, "project");
    const sceneId = "30000000-0000-4000-8000-000000000001";
    const narration = "保留旧 Speech";
    const audio = Buffer.from("old mp3");
    await createProjectVNext(projectDirectory);
    await writeProjectTtsConfig(projectDirectory, ttsConfig);
    await writeFile(join(projectDirectory, "speech", `${sceneId}.mp3`), audio);
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [],
      scenes: [{
        id: sceneId,
        narration: { text: narration },
        assetIds: [],
        speech: {
          path: `speech/${sceneId}.mp3`,
          durationMs: 1_000,
          sourceTextHash: `sha256:${createHash("sha256").update(narration).digest("hex")}`,
          ttsProfileId: ttsProfileId(ttsConfig),
          audioContentHash: `sha256:${createHash("sha256").update(audio).digest("hex")}`,
        },
      }],
    }));
    const opened = await openProjectVNext(projectDirectory, { probeSpeechDurationMs: async () => 1_000 });
    await rename(join(projectDirectory, "tts.json"), join(projectDirectory, "tts.previous.json"));
    await mkdir(join(projectDirectory, "tts.json"));

    await expect(opened.saveTtsSettings({
      config: { ...ttsConfig, speed: 1.2 },
      baselineRevision: opened.inspection.projectRevision,
      expectedAffectedSpeechCount: 1,
    })).rejects.toMatchObject({ code: "PROJECT_SAVE_FAILED" });
    expect(JSON.parse(await readFile(join(projectDirectory, "project.json"), "utf8")).scenes[0].speech)
      .toBeDefined();
    await opened.release();
  });

  it("在不存在的目标原子创建可严格检查的零 Scene 项目", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-create-"));
    const projectDirectory = join(parentDirectory, "海边采访");
    const projectId = "10000000-0000-4000-8000-000000000001";
    const revisionId = "20000000-0000-4000-8000-000000000001";

    const created = await createProjectVNext(projectDirectory, {
      createId: (() => {
        const ids = [projectId, revisionId];
        return () => ids.shift()!;
      })(),
    });

    expect(created).toEqual({ projectDirectory, projectId, revisionId });
    const inspection = await inspectProjectVNext(projectDirectory);
    expect(inspection.project).toEqual({ assets: [], scenes: [] });
    expect(inspection.videoBrief).toBe("");
    expect((await stat(join(projectDirectory, "video.md"))).size).toBe(0);
    expect(inspection.renderPrograms.directories).toEqual([
      join(projectDirectory, ".narracut", "revisions", revisionId, "render-program"),
    ]);

    const packageJson = JSON.parse(await readFile(
      join(projectDirectory, ".narracut", "revisions", revisionId, "render-program", "package.json"),
      "utf8",
    )) as { dependencies: Record<string, string> };
    expect(packageJson.dependencies).toEqual({
      react: "19.2.8",
      "react-dom": "19.2.8",
      remotion: "4.0.512",
    });
    expect(Object.values(packageJson.dependencies).every((version) => /^\d+\.\d+\.\d+$/u.test(version))).toBe(true);
    expect(await readFile(
      join(projectDirectory, ".narracut", "current.json"),
      "utf8",
    )).toBe(`{"revisionId":"${revisionId}"}`);
    expect(await readFile(
      join(projectDirectory, ".narracut", "revisions", revisionId, "render-program", "src", "RenderProgram.tsx"),
      "utf8",
    )).toContain("export function RenderProgram(input: RenderProgramInputV1)");
  });

  it("完整校验失败时清理本次创建拥有的临时目录且不发布目标", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-create-failure-"));
    const projectDirectory = join(parentDirectory, "invalid-starter");
    const temporaryDirectory = join(parentDirectory, ".invalid-starter.narracut-tmp");

    await expect(createProjectVNext(projectDirectory, {
      createId: () => "not-a-uuid",
    })).rejects.toMatchObject({
      code: "PROJECT_CREATE_FAILED",
      path: projectDirectory,
    });
    await expect(access(projectDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("只在用户确认后清理与目标匹配的创建残留并从头创建", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-create-residue-"));
    const projectDirectory = join(parentDirectory, "fresh-project");
    const temporaryDirectory = join(parentDirectory, ".fresh-project.narracut-tmp");
    await mkdir(temporaryDirectory);
    await writeFile(join(temporaryDirectory, ".narracut-operation.json"), JSON.stringify({
      targetDirectory: projectDirectory,
      operation: "create",
      version: 1,
      kind: "narracut-operation",
      operationToken: "confirmed-residue",
    }));

    await expect(createProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_TEMPORARY_RESIDUE",
      path: temporaryDirectory,
    });
    await expect(access(temporaryDirectory)).resolves.toBeUndefined();

    await createProjectVNext(projectDirectory, { confirmTemporaryCleanup: true });
    await expect(access(temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(inspectProjectVNext(projectDirectory)).resolves.toMatchObject({
      project: { assets: [], scenes: [] },
    });
  });

  it("拒绝删除无法证明归属的固定临时目录", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-create-unowned-"));
    const projectDirectory = join(parentDirectory, "fresh-project");
    const temporaryDirectory = join(parentDirectory, ".fresh-project.narracut-tmp");
    await mkdir(temporaryDirectory);
    await writeFile(join(temporaryDirectory, "keep.txt"), "不是 Narracut 创建残留");

    await expect(createProjectVNext(projectDirectory, {
      confirmTemporaryCleanup: true,
    })).rejects.toMatchObject({
      code: "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      path: temporaryDirectory,
    });
    await expect(readFile(join(temporaryDirectory, "keep.txt"), "utf8"))
      .resolves.toBe("不是 Narracut 创建残留");
  });

  it("open 对同一物理项目取得独占租约并在释放后允许重新打开", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-open-"));
    const projectDirectory = join(parentDirectory, "project");
    const aliasDirectory = join(parentDirectory, "project-alias");
    await createProjectVNext(projectDirectory);
    await symlink(projectDirectory, aliasDirectory, "dir");

    const opened = await openProjectVNext(projectDirectory);
    expect(opened.inspection.projectDirectory).toBe(projectDirectory);
    await expect(openProjectVNext(aliasDirectory)).rejects.toMatchObject({
      code: "PROJECT_IN_USE",
      path: projectDirectory,
    });

    await opened.release();
    const reopened = await openProjectVNext(aliasDirectory);
    expect(reopened.inspection.projectDirectory).toBe(projectDirectory);
    await reopened.release();
  });

  it("已打开工作区按基线原子保存严格 Project DSL，并保留 Scene 身份与顺序", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-save-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    const opened = await openProjectVNext(projectDirectory);
    const firstSceneId = "30000000-0000-4000-8000-000000000001";
    const secondSceneId = "30000000-0000-4000-8000-000000000002";

    const saved = await opened.saveProject({
      assets: [],
      scenes: [
        { id: secondSceneId, narration: { text: "第二幕" }, assetIds: [] },
        { id: firstSceneId, narration: { text: "第一幕" }, assetIds: [] },
      ],
    }, opened.inspection.projectRevision);

    expect(saved.inspection.project.scenes.map((scene) => scene.id)).toEqual([
      secondSceneId,
      firstSceneId,
    ]);
    expect(saved.inspection.projectRevision).not.toBe(opened.inspection.projectRevision);
    expect(await readFile(join(projectDirectory, "project.json"), "utf8")).toBe(
      `{"assets":[],"scenes":[{"id":"${secondSceneId}","narration":{"text":"第二幕"},"assetIds":[]},{"id":"${firstSceneId}","narration":{"text":"第一幕"},"assetIds":[]}]}`,
    );
    await opened.release();
  });

  it("逐字节复制普通文件后只登记 ID 与唯一相对路径，并绑定原目标 Scene", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-asset-import-"));
    const projectDirectory = join(parentDirectory, "project");
    const sourcePath = join(parentDirectory, "camera-original.bin");
    const sourceBytes = Buffer.from([0x00, 0xff, 0x31, 0x00, 0x7f]);
    const sceneId = "30000000-0000-4000-8000-000000000001";
    await createProjectVNext(projectDirectory);
    await writeFile(sourcePath, sourceBytes);
    const opened = await openProjectVNext(projectDirectory);
    const sceneSaved = await opened.saveProject({
      assets: [],
      scenes: [{ id: sceneId, narration: { text: "镜头一" }, assetIds: [] }],
    }, opened.inspection.projectRevision);

    const imported = await opened.importAsset({
      sourcePath,
      targetSceneId: sceneId,
      baselineRevision: sceneSaved.inspection.projectRevision,
    });

    expect(imported.status).toBe("imported-and-bound");
    expect(imported.asset).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      path: "assets/camera-original.bin",
    });
    expect(await readFile(sourcePath)).toEqual(sourceBytes);
    expect(await readFile(join(projectDirectory, imported.asset!.path))).toEqual(sourceBytes);
    expect(imported.inspection.project).toEqual({
      assets: [imported.asset],
      scenes: [{ id: sceneId, narration: { text: "镜头一" }, assetIds: [imported.asset!.id] }],
    });
    expect(JSON.parse(await readFile(join(projectDirectory, "project.json"), "utf8")))
      .toEqual(imported.inspection.project);
    await opened.release();
  });

  it("导入逐项拒绝目录、符号链接与项目控制文件且不产生登记或半成品", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-asset-reject-"));
    const projectDirectory = join(parentDirectory, "project");
    const sourceDirectory = join(parentDirectory, "folder");
    const sourceFile = join(parentDirectory, "outside.bin");
    const sourceLink = join(parentDirectory, "outside-link.bin");
    await createProjectVNext(projectDirectory);
    await mkdir(sourceDirectory);
    await writeFile(sourceFile, "outside");
    await symlink(sourceFile, sourceLink);
    const opened = await openProjectVNext(projectDirectory);
    const controlHardlink = join(parentDirectory, "video-control-hardlink.md");
    await link(join(projectDirectory, "video.md"), controlHardlink);

    for (const [sourcePath, code] of [
      [sourceDirectory, "ASSET_SOURCE_NOT_FILE"],
      [sourceLink, "ASSET_SOURCE_SYMBOLIC_LINK"],
      [join(projectDirectory, "project.json"), "ASSET_SOURCE_PROJECT_CONTROL_FILE"],
      [controlHardlink, "ASSET_SOURCE_PROJECT_CONTROL_FILE"],
    ] as const) {
      const rejected = await opened.importAsset({
        sourcePath,
        baselineRevision: opened.inspection.projectRevision,
      });
      expect(rejected).toMatchObject({ status: "rejected", code, asset: null });
    }
    expect((await readdir(join(projectDirectory, "assets"))).filter((name) => !name.startsWith(".")))
      .toEqual([]);
    expect(JSON.parse(await readFile(join(projectDirectory, "project.json"), "utf8")))
      .toEqual({ assets: [], scenes: [] });
    await opened.release();
  });

  it("导入期间 assets 目录身份变化时停止写入且不触碰项目外目录", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-asset-directory-identity-"));
    const projectDirectory = join(parentDirectory, "project");
    const sourcePath = join(parentDirectory, "source.bin");
    const externalDirectory = join(parentDirectory, "external-assets");
    await createProjectVNext(projectDirectory);
    await writeFile(sourcePath, "source");
    await mkdir(externalDirectory);
    const opened = await openProjectVNext(projectDirectory);
    const originalAssetsDirectory = join(projectDirectory, "assets-original");
    await rename(join(projectDirectory, "assets"), originalAssetsDirectory);
    await symlink(externalDirectory, join(projectDirectory, "assets"));

    await expect(opened.importAsset({
      sourcePath,
      baselineRevision: opened.inspection.projectRevision,
    })).rejects.toMatchObject({ code: "PROJECT_IDENTITY_LOST" });

    expect(await readdir(externalDirectory)).toEqual([]);
    expect(await readdir(originalAssetsDirectory)).toEqual([]);
    expect(JSON.parse(await readFile(join(projectDirectory, "project.json"), "utf8")))
      .toEqual({ assets: [], scenes: [] });
    await opened.release();
  });

  it("同名导入生成唯一项目路径，目标消失或引用满额时只登记为暂未绑定", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-asset-unbound-"));
    const projectDirectory = join(parentDirectory, "project");
    const sourceDirectory = join(parentDirectory, "sources");
    const firstSource = join(sourceDirectory, "first", "shot.bin");
    const secondSource = join(sourceDirectory, "second", "shot.bin");
    await createProjectVNext(projectDirectory);
    await mkdir(join(sourceDirectory, "first"), { recursive: true });
    await mkdir(join(sourceDirectory, "second"), { recursive: true });
    await writeFile(firstSource, "first");
    await writeFile(secondSource, "second");
    const opened = await openProjectVNext(projectDirectory);

    const first = await opened.importAsset({
      sourcePath: firstSource,
      targetSceneId: "30000000-0000-4000-8000-000000000099",
      baselineRevision: opened.inspection.projectRevision,
    });
    const second = await opened.importAsset({
      sourcePath: secondSource,
      baselineRevision: first.inspection.projectRevision,
    });

    expect(first).toMatchObject({
      status: "imported-unbound",
      code: "ASSET_IMPORTED_UNBOUND",
      asset: { path: "assets/shot.bin" },
    });
    expect(first.message).toContain("原目标 Scene 已不存在");
    expect(second).toMatchObject({
      status: "imported-unbound",
      asset: { path: "assets/shot-2.bin" },
    });
    expect(await readFile(join(projectDirectory, "assets", "shot.bin"), "utf8")).toBe("first");
    expect(await readFile(join(projectDirectory, "assets", "shot-2.bin"), "utf8")).toBe("second");
    await opened.release();
  });

  it("为达到文件系统组件上限的同名文件预留唯一后缀空间", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-asset-long-name-"));
    const projectDirectory = join(parentDirectory, "project");
    const filename = `${"a".repeat(251)}.bin`;
    const firstDirectory = join(parentDirectory, "first");
    const secondDirectory = join(parentDirectory, "second");
    await createProjectVNext(projectDirectory);
    await mkdir(firstDirectory);
    await mkdir(secondDirectory);
    await writeFile(join(firstDirectory, filename), "first");
    await writeFile(join(secondDirectory, filename), "second");
    const opened = await openProjectVNext(projectDirectory);

    const first = await opened.importAsset({
      sourcePath: join(firstDirectory, filename),
      baselineRevision: opened.inspection.projectRevision,
    });
    const second = await opened.importAsset({
      sourcePath: join(secondDirectory, filename),
      baselineRevision: first.inspection.projectRevision,
    });

    expect(first.status).toBe("imported-unbound");
    expect(second.status).toBe("imported-unbound");
    expect(Buffer.byteLength(first.asset!.path.split("/").at(-1)!, "utf8")).toBeLessThanOrEqual(255);
    expect(Buffer.byteLength(second.asset!.path.split("/").at(-1)!, "utf8")).toBeLessThanOrEqual(255);
    expect(second.asset!.path).toMatch(/-2\.bin$/u);
    expect(await readFile(join(projectDirectory, second.asset!.path), "utf8")).toBe("second");
    await opened.release();
  });

  it("Scene Asset 引用可按现有保存语义添加、排序与解除，但登记表不能由客户端改写", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-asset-reference-save-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    const sources = [join(parentDirectory, "a.bin"), join(parentDirectory, "b.bin")];
    await writeFile(sources[0]!, "a");
    await writeFile(sources[1]!, "b");
    const opened = await openProjectVNext(projectDirectory);
    const first = await opened.importAsset({ sourcePath: sources[0]!, baselineRevision: opened.inspection.projectRevision });
    const second = await opened.importAsset({ sourcePath: sources[1]!, baselineRevision: first.inspection.projectRevision });
    const sceneId = "30000000-0000-4000-8000-000000000001";

    const bound = await opened.saveProject({
      assets: second.inspection.project.assets,
      scenes: [{
        id: sceneId,
        narration: { text: "排序" },
        assetIds: [second.asset!.id, first.asset!.id],
      }],
    }, second.inspection.projectRevision);
    expect(bound.inspection.project.scenes[0]?.assetIds).toEqual([second.asset!.id, first.asset!.id]);

    const unlinked = await opened.saveProject({
      assets: bound.inspection.project.assets,
      scenes: [{ id: sceneId, narration: { text: "排序" }, assetIds: [first.asset!.id] }],
    }, bound.inspection.projectRevision);
    expect(unlinked.inspection.project.assets).toHaveLength(2);
    expect(unlinked.inspection.project.scenes[0]?.assetIds).toEqual([first.asset!.id]);

    await expect(opened.saveProject({
      assets: [first.asset!],
      scenes: unlinked.inspection.project.scenes,
    }, unlinked.inspection.projectRevision)).rejects.toMatchObject({ code: "PROJECT_SAVE_FAILED" });
    await opened.release();
  });

  it("项目达到 1,000 个 Asset 时原子拒绝继续导入", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-asset-capacity-"));
    const projectDirectory = join(parentDirectory, "project");
    const sourcePath = join(parentDirectory, "overflow.bin");
    await createProjectVNext(projectDirectory);
    await writeFile(sourcePath, "overflow");
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: Array.from({ length: 1000 }, (_, index) => ({
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        path: `assets/missing-${index + 1}.bin`,
      })),
      scenes: [],
    }));
    const opened = await openProjectVNext(projectDirectory);

    const rejected = await opened.importAsset({
      sourcePath,
      baselineRevision: opened.inspection.projectRevision,
    });

    expect(rejected).toMatchObject({
      status: "rejected",
      code: "PROJECT_ASSET_LIMIT_REACHED",
      asset: null,
    });
    expect((await readdir(join(projectDirectory, "assets"))).filter((name) => !name.startsWith(".")))
      .toEqual([]);
    await opened.release();
  });

  it("保存时磁盘基线变化会保留外部内容并报告冲突", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-save-conflict-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    const opened = await openProjectVNext(projectDirectory);
    const external = '{"assets":[],"scenes":[],"external":true}';
    await writeFile(join(projectDirectory, "project.json"), external);

    await expect(opened.saveProject(
      { assets: [], scenes: [] },
      opened.inspection.projectRevision,
    )).rejects.toMatchObject({ code: "PROJECT_SAVE_CONFLICT" });
    expect(await readFile(join(projectDirectory, "project.json"), "utf8")).toBe(external);
    await opened.release();
  });

  it("按 Video Brief 基线原子保存完整 Markdown 并标记当前 Render Program 待复核", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-brief-save-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    const opened = await openProjectVNext(projectDirectory);

    const saved = await opened.saveVideoBrief(
      "# 产品方向\n\n保留原始 Markdown。\n",
      opened.inspection.videoBriefRevision,
    );

    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") throw new Error("预期 Video Brief 保存成功。");
    expect(saved).toMatchObject({
      status: "saved",
      inspection: {
        videoBrief: "# 产品方向\n\n保留原始 Markdown。\n",
        videoBriefRevision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        currentRenderProgram: {
          briefReviewPending: true,
          previewPreserved: true,
        },
      },
    });
    expect(saved.inspection.videoBriefRevision).not.toBe(opened.inspection.videoBriefRevision);
    expect(await readFile(join(projectDirectory, "video.md"), "utf8"))
      .toBe("# 产品方向\n\n保留原始 Markdown。\n");
    await opened.release();
  });

  it("Video Brief 外部变化时保留 DISK 证据并拒绝覆盖", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-brief-conflict-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    const opened = await openProjectVNext(projectDirectory);
    await writeFile(join(projectDirectory, "video.md"), "# 外部版本\n");

    const conflicted = await opened.saveVideoBrief(
      "# 本地版本\n",
      opened.inspection.videoBriefRevision,
    );

    expect(conflicted).toMatchObject({
      status: "conflict",
      disk: {
        content: "# 外部版本\n",
        revision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        bytes: Buffer.byteLength("# 外部版本\n"),
      },
    });
    expect(await readFile(join(projectDirectory, "video.md"), "utf8")).toBe("# 外部版本\n");
    await opened.release();
  });

  it("把未保存 Video Brief 导出到项目外的新普通文件且不覆盖同名文件", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-brief-export-"));
    const projectDirectory = join(parentDirectory, "project");
    const exportDirectory = join(parentDirectory, "exports");
    await createProjectVNext(projectDirectory);
    await mkdir(exportDirectory);
    await writeFile(join(exportDirectory, "video-brief-local.md"), "保留");
    const opened = await openProjectVNext(projectDirectory);

    const exported = await opened.exportVideoBriefLocal("# 待抢救 LOCAL\n", exportDirectory);

    expect(exported.path).toBe(join(exportDirectory, "video-brief-local-2.md"));
    expect(await readFile(exported.path, "utf8")).toBe("# 待抢救 LOCAL\n");
    expect(await readFile(join(exportDirectory, "video-brief-local.md"), "utf8")).toBe("保留");
    await expect(opened.exportVideoBriefLocal("不能落入项目", projectDirectory))
      .rejects.toMatchObject({ code: "PROJECT_SAVE_FAILED" });
    await opened.release();
  });

  it("Video Brief 保存严格拒绝无效 Unicode 与超过 2 MiB 的内容", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-brief-bounds-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    const opened = await openProjectVNext(projectDirectory);

    await expect(opened.saveVideoBrief("\ud800", opened.inspection.videoBriefRevision))
      .rejects.toMatchObject({ code: "PROJECT_SAVE_FAILED" });
    await expect(opened.saveVideoBrief("a".repeat(2 * 1024 * 1024 + 1), opened.inspection.videoBriefRevision))
      .rejects.toMatchObject({ code: "PROJECT_SAVE_FAILED" });
    expect(await readFile(join(projectDirectory, "video.md"), "utf8")).toBe("");
    await opened.release();
  });

  it("保存时 project.json 被替换为链接会停止写入且不触碰链接目标", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-save-link-conflict-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    const opened = await openProjectVNext(projectDirectory);
    const projectFile = join(projectDirectory, "project.json");
    const externalFile = join(parentDirectory, "external.json");
    const external = await readFile(projectFile, "utf8");
    await writeFile(externalFile, external);
    await rename(projectFile, join(projectDirectory, "project.original.json"));
    await symlink(externalFile, projectFile);

    await expect(opened.saveProject(
      { assets: [], scenes: [] },
      opened.inspection.projectRevision,
    )).rejects.toMatchObject({ code: "PROJECT_SAVE_CONFLICT" });
    expect(await readFile(externalFile, "utf8")).toBe(external);
    await opened.release();
  });

  it("保存前重新拒绝已被替换为链接的 Asset 资源", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-save-resource-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    const assetId = "20000000-0000-4000-8000-000000000001";
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [{ id: assetId, path: "assets/source.png" }],
      scenes: [],
    }));
    const opened = await openProjectVNext(projectDirectory);
    const externalFile = join(parentDirectory, "external.png");
    await writeFile(externalFile, "external");
    await symlink(externalFile, join(projectDirectory, "assets", "source.png"));

    await expect(opened.saveProject({
      assets: [{ id: assetId, path: "assets/source.png" }],
      scenes: [{
        id: "30000000-0000-4000-8000-000000000001",
        narration: { text: "" },
        assetIds: [],
      }],
    }, opened.inspection.projectRevision)).rejects.toMatchObject({ code: "PROJECT_CONTENT_INVALID" });
    await opened.release();
  });

  it("释放开始后拒绝新保存，并等待已有保存队列后再移除租约", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-save-release-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    const opened = await openProjectVNext(projectDirectory);
    const save = opened.saveProject({
      assets: [],
      scenes: [{
        id: "30000000-0000-4000-8000-000000000001",
        narration: { text: "保存后再释放" },
        assetIds: [],
      }],
    }, opened.inspection.projectRevision);
    const release = opened.release();

    await expect(opened.saveProject(
      { assets: [], scenes: [] },
      opened.inspection.projectRevision,
    )).rejects.toMatchObject({ code: "PROJECT_IDENTITY_LOST" });
    await save;
    await release;
    const reopened = await openProjectVNext(projectDirectory);
    expect(reopened.inspection.project.scenes[0]?.narration.text).toBe("保存后再释放");
    await reopened.release();
  });

  it("保存前严格拒绝超出 Scene 上限的输入且不改变持久字节", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-save-invalid-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    const opened = await openProjectVNext(projectDirectory);
    const before = await readFile(join(projectDirectory, "project.json"), "utf8");
    const scenes = Array.from({ length: 1001 }, (_, index) => ({
      id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      narration: { text: "" },
      assetIds: [],
    }));

    await expect(opened.saveProject(
      { assets: [], scenes },
      opened.inspection.projectRevision,
    )).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      diagnostics: [{ code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED", metric: "scenes" }],
    });
    expect(await readFile(join(projectDirectory, "project.json"), "utf8")).toBe(before);
    await opened.release();
  });

  it("保存前项目清单身份变化会停止写入并保留 project.json", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-save-identity-"));
    const projectDirectory = join(parentDirectory, "project");
    await createProjectVNext(projectDirectory);
    const opened = await openProjectVNext(projectDirectory);
    const projectFile = join(projectDirectory, "project.json");
    const before = await readFile(projectFile, "utf8");
    const manifestFile = join(projectDirectory, "narracut.json");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as Record<string, unknown>;
    manifest.projectId = "10000000-0000-4000-8000-000000000099";
    await writeFile(manifestFile, JSON.stringify(manifest));

    await expect(opened.saveProject(
      { assets: [], scenes: [] },
      opened.inspection.projectRevision,
    )).rejects.toMatchObject({ code: "PROJECT_IDENTITY_LOST" });
    expect(await readFile(projectFile, "utf8")).toBe(before);
    await opened.release();
  });

  it("项目持有租约时即使目录被移动，同一物理目录仍不能重复打开", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-open-moved-"));
    const projectDirectory = join(parentDirectory, "project");
    const movedDirectory = join(parentDirectory, "project-moved");
    await createProjectVNext(projectDirectory);

    const opened = await openProjectVNext(projectDirectory);
    await rename(projectDirectory, movedDirectory);
    await expect(openProjectVNext(movedDirectory)).rejects.toMatchObject({
      code: "PROJECT_IN_USE",
      path: movedDirectory,
    });
    await opened.release();

    const reopened = await openProjectVNext(movedDirectory);
    await reopened.release();
  });

  it("open 拒绝当前修订指针损坏的项目且不创建租约", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-open-current-"));
    const projectDirectory = join(parentDirectory, "project");
    const leasePath = join(projectDirectory, ".narracut", "workspace.lease");
    await createProjectVNext(projectDirectory);
    await writeFile(join(projectDirectory, ".narracut", "current.json"), '{"revisionId":"missing"}');

    await expect(openProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CURRENT_INVALID",
      path: join(projectDirectory, ".narracut", "current.json"),
    });
    await expect(access(leasePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("并发创建同一目标时只允许一个操作发布", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "narracut-create-race-"));
    const projectDirectory = join(parentDirectory, "project");
    const results = await Promise.allSettled([
      createProjectVNext(projectDirectory),
      createProjectVNext(projectDirectory),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(inspectProjectVNext(projectDirectory)).resolves.toMatchObject({
      project: { assets: [], scenes: [] },
    });
  });

  it("open 拒绝普通目录且不创建、补全或改写内容", async () => {
    const directory = await mkdtemp(join(tmpdir(), "narracut-open-invalid-"));
    await writeFile(join(directory, "keep.txt"), "保持原样");
    const before = await readdir(directory);

    await expect(openProjectVNext(directory)).rejects.toMatchObject({
      code: "NOT_A_NARRACUT_PROJECT",
      path: join(directory, "narracut.json"),
    });
    expect(await readdir(directory)).toEqual(before);
    expect(await readFile(join(directory, "keep.txt"), "utf8")).toBe("保持原样");
  });
});

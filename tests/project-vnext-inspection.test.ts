import { createHash } from "node:crypto";
import { link, mkdtemp, mkdir, readdir, readFile, rename, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inspectProjectVNext } from "../src/server/project-vnext-inspection";

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "narracut-vnext-inspect-"));
  const projectDirectory = join(root, "demo");
  await mkdir(join(projectDirectory, "assets"), { recursive: true });
  await mkdir(join(projectDirectory, "speech"));
  await mkdir(join(projectDirectory, "renders"));
  await writeFile(join(projectDirectory, "narracut.json"), JSON.stringify({
    kind: "narracut-project",
    formatVersion: 1,
    projectId: "10000000-0000-4000-8000-000000000001",
  }));
  await writeFile(join(projectDirectory, "project.json"), '{"assets":[],"scenes":[]}');
  await writeFile(join(projectDirectory, "video.md"), "");
  const programDirectory = join(
    projectDirectory,
    ".opaque-state",
    "revision-1",
    "render-program",
  );
  await mkdir(join(programDirectory, "src"), { recursive: true });
  await mkdir(join(programDirectory, "resources"));
  await writeFile(join(programDirectory, "program.json"), JSON.stringify({
    apiVersion: 1,
    output: { width: 1920, height: 1080, fps: 30 },
  }));
  await writeFile(join(programDirectory, "package.json"), '{"private":true}');
  await writeFile(join(programDirectory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(
    join(programDirectory, "src", "RenderProgram.tsx"),
    "export const RenderProgram = () => null;\n",
  );
  return projectDirectory;
}

async function treeFingerprint(root: string): Promise<string> {
  const entries: string[] = [];
  async function visit(directory: string, prefix = ""): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const absolutePath = join(directory, name);
      const relativePath = prefix === "" ? name : `${prefix}/${name}`;
      const facts = await stat(absolutePath);
      if (facts.isDirectory()) {
        entries.push(`d:${relativePath}:${facts.mode}`);
        await visit(absolutePath, relativePath);
      } else {
        const bytes = await readFile(absolutePath);
        entries.push(`f:${relativePath}:${facts.mode}:${createHash("sha256").update(bytes).digest("hex")}`);
      }
    }
  }
  await visit(root);
  return entries.join("\n");
}

describe("Project VNext 只读检查", () => {
  it("正向识别合法项目且不改动目录", async () => {
    const projectDirectory = await createProject();
    const before = await treeFingerprint(projectDirectory);

    const inspected = await inspectProjectVNext(projectDirectory);

    expect(inspected).toMatchObject({
      projectDirectory,
      manifest: {
        kind: "narracut-project",
        formatVersion: 1,
        projectId: "10000000-0000-4000-8000-000000000001",
      },
      project: { assets: [], scenes: [] },
      videoBrief: "",
      renderPrograms: {
        directories: [join(projectDirectory, ".opaque-state", "revision-1", "render-program")],
      },
    });
    expect(await treeFingerprint(projectDirectory)).toBe(before);
  });

  it("把未来格式与 Legacy/普通目录分开拒绝", async () => {
    const projectDirectory = await createProject();
    await writeFile(join(projectDirectory, "narracut.json"), JSON.stringify({
      kind: "narracut-project",
      formatVersion: 2,
      projectId: "10000000-0000-4000-8000-000000000001",
    }));

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_FORMAT_UNSUPPORTED",
      path: join(projectDirectory, "narracut.json"),
    });
  });

  it("在 JSON 解析前拒绝控制文件中的无效 UTF-8", async () => {
    const projectDirectory = await createProject();
    await writeFile(join(projectDirectory, "project.json"), Buffer.from([
      0x7b, 0x22, 0x61, 0x73, 0x73, 0x65, 0x74, 0x73, 0x22, 0x3a, 0x5b,
      0x5d, 0x2c, 0x22, 0x73, 0x63, 0x65, 0x6e, 0x65, 0x73, 0x22, 0x3a,
      0x5b, 0x5d, 0x2c, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d,
    ]));

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: join(projectDirectory, "project.json"),
      diagnostics: [{ code: "PROJECT_CONTROL_FILE_INVALID_UTF8", component: "project.json" }],
    });
  });

  it("拒绝 JSON 重复字段而不是采用最后一个值", async () => {
    const projectDirectory = await createProject();
    await writeFile(
      join(projectDirectory, "project.json"),
      '{"assets":[],"assets":[],"scenes":[]}',
    );

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: join(projectDirectory, "project.json"),
      diagnostics: [{
        code: "PROJECT_CONTROL_FILE_DUPLICATE_FIELD",
        component: "project.json",
        jsonPath: "$.assets",
      }],
    });
  });

  it("在读取和解析前按固定字节上限拒绝控制文件", async () => {
    const projectDirectory = await createProject();
    await writeFile(join(projectDirectory, "project.json"), Buffer.alloc(10 * 1024 * 1024 + 1, 0x20));

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: join(projectDirectory, "project.json"),
      diagnostics: [{
        code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
        component: "project.json",
        metric: "bytes",
        actual: 10 * 1024 * 1024 + 1,
        limit: 10 * 1024 * 1024,
      }],
    });
  });

  it("不把 Legacy 清单当作可迁移或可只读打开的项目", async () => {
    const projectDirectory = await createProject();
    await writeFile(join(projectDirectory, "narracut.json"), JSON.stringify({
      kind: "legacy-narracut-project",
      formatVersion: 1,
      projectId: "10000000-0000-4000-8000-000000000001",
    }));

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "NOT_A_NARRACUT_PROJECT",
      path: join(projectDirectory, "narracut.json"),
    });
  });

  it("聚合当前格式清单的 Schema 问题并拒绝未知字段", async () => {
    const projectDirectory = await createProject();
    await writeFile(join(projectDirectory, "narracut.json"), JSON.stringify({
      kind: "narracut-project",
      formatVersion: 1,
      projectId: "not-a-uuid",
      displayName: "不得进入清单",
    }));

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: join(projectDirectory, "narracut.json"),
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "PROJECT_MANIFEST_SCHEMA_INVALID",
          jsonPath: "$.displayName",
        }),
        expect.objectContaining({
          code: "PROJECT_MANIFEST_SCHEMA_INVALID",
          jsonPath: "$.projectId",
        }),
      ]),
    });
  });

  it("统一校验 Project DSL 的未知字段、路径、唯一性与交叉引用", async () => {
    const projectDirectory = await createProject();
    const assetId = "20000000-0000-4000-8000-000000000001";
    const unknownAssetId = "20000000-0000-4000-8000-000000000099";
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [
        { id: assetId, path: "../escape.png", kind: "image" },
        { id: assetId, path: "assets/second.png" },
      ],
      scenes: [{
        id: "30000000-0000-4000-8000-000000000001",
        narration: { text: 42 },
        assetIds: [unknownAssetId, unknownAssetId],
        speech: null,
        visual: {},
      }],
      metadata: {},
    }));

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: join(projectDirectory, "project.json"),
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "PROJECT_DSL_SCHEMA_INVALID", jsonPath: "$.metadata" }),
        expect.objectContaining({ code: "PROJECT_DSL_SCHEMA_INVALID", jsonPath: "$.assets[0].kind" }),
        expect.objectContaining({ code: "PROJECT_DSL_PATH_INVALID", jsonPath: "$.assets[0].path" }),
        expect.objectContaining({ code: "PROJECT_DSL_ID_DUPLICATE", jsonPath: "$.assets[1].id" }),
        expect.objectContaining({ code: "PROJECT_DSL_REFERENCE_INVALID", jsonPath: "$.scenes[0].assetIds[0]" }),
        expect.objectContaining({ code: "PROJECT_DSL_REFERENCE_DUPLICATE", jsonPath: "$.scenes[0].assetIds[1]" }),
        expect.objectContaining({ code: "PROJECT_DSL_SCHEMA_INVALID", jsonPath: "$.scenes[0].speech" }),
      ]),
    });
  });

  it("稳定区分不可访问路径、非项目与当前项目内容缺失", async () => {
    const projectDirectory = await createProject();
    const unavailablePath = join(projectDirectory, "missing-project");
    await expect(inspectProjectVNext(unavailablePath)).rejects.toMatchObject({
      code: "PROJECT_PATH_UNAVAILABLE",
      path: unavailablePath,
    });

    await unlink(join(projectDirectory, "narracut.json"));
    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "NOT_A_NARRACUT_PROJECT",
      path: join(projectDirectory, "narracut.json"),
    });

    await writeFile(join(projectDirectory, "narracut.json"), JSON.stringify({
      kind: "narracut-project",
      formatVersion: 1,
      projectId: "10000000-0000-4000-8000-000000000001",
    }));
    await unlink(join(projectDirectory, "video.md"));
    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: join(projectDirectory, "video.md"),
      diagnostics: [{ code: "PROJECT_REQUIRED_CONTENT_MISSING", component: "video.md" }],
    });
  });

  it("拒绝 Asset 中的符号链接和硬链接", async () => {
    const projectDirectory = await createProject();
    const assetId = "20000000-0000-4000-8000-000000000001";
    const sourcePath = join(projectDirectory, "source.bin");
    const assetPath = join(projectDirectory, "assets", "linked.bin");
    await writeFile(sourcePath, "bytes");
    await symlink(sourcePath, assetPath);
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [{ id: assetId, path: "assets/linked.bin" }],
      scenes: [],
    }));

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: assetPath,
      diagnostics: [{ code: "PROJECT_RESOURCE_INVALID", component: "assets/linked.bin" }],
    });

    await unlink(assetPath);
    await link(sourcePath, assetPath);
    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: assetPath,
      diagnostics: [{ code: "PROJECT_RESOURCE_INVALID", component: "assets/linked.bin" }],
    });
  });

  it("不固化父存储布局地发现并验证 Render Program 内部树", async () => {
    const projectDirectory = await createProject();
    const programDirectory = join(projectDirectory, ".opaque-state", "revision-1", "render-program");
    const sourcePath = join(projectDirectory, "program-resource-source.bin");
    const resourcePath = join(programDirectory, "resources", "linked.bin");
    await writeFile(sourcePath, "bytes");
    await link(sourcePath, resourcePath);

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: resourcePath,
      diagnostics: [{
        code: "PROJECT_RESOURCE_INVALID",
        component: ".opaque-state/revision-1/render-program/resources/linked.bin",
      }],
    });

    await unlink(resourcePath);
    await rename(
      programDirectory,
      join(projectDirectory, ".opaque-state", "revision-1", "program-tree"),
    );
    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: projectDirectory,
      diagnostics: [{ code: "PROJECT_REQUIRED_CONTENT_MISSING" }],
    });
  });

  it("在发现 Render Program 时拒绝过深的项目目录树", async () => {
    const projectDirectory = await createProject();
    let deepDirectory = join(projectDirectory, "deep-tree");
    for (let depth = 0; depth < 33; depth += 1) {
      deepDirectory = join(deepDirectory, `level-${depth}`);
    }
    await mkdir(deepDirectory, { recursive: true });

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: expect.stringContaining("deep-tree"),
      diagnostics: [{
        code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
        metric: "directoryDepth",
        limit: 32,
      }],
    });
  });

  it("在读取控制文件前拒绝符号链接逃逸", async () => {
    const projectDirectory = await createProject();
    const projectPath = join(projectDirectory, "project.json");
    const externalPath = join(projectDirectory, "external-project.json");
    await writeFile(externalPath, '{"assets":[],"scenes":[]}');
    await unlink(projectPath);
    await symlink(externalPath, projectPath);

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: projectPath,
      diagnostics: [{ code: "PROJECT_REQUIRED_CONTENT_INVALID", component: "project.json" }],
    });
  });

  it("逐段拒绝 Asset 路径中的中间目录符号链接", async () => {
    const projectDirectory = await createProject();
    const outsideDirectory = join(projectDirectory, "..", "outside-assets");
    await mkdir(outsideDirectory);
    await writeFile(join(outsideDirectory, "file.bin"), "outside");
    const linkedDirectory = join(projectDirectory, "assets", "external");
    await symlink(outsideDirectory, linkedDirectory);
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [{
        id: "20000000-0000-4000-8000-000000000001",
        path: "assets/external/file.bin",
      }],
      scenes: [],
    }));

    await expect(inspectProjectVNext(projectDirectory)).rejects.toMatchObject({
      code: "PROJECT_CONTENT_INVALID",
      path: linkedDirectory,
      diagnostics: [{ code: "PROJECT_RESOURCE_INVALID", component: "assets/external" }],
    });
  });

  it("对结构、数字、产品数组、路径与 TTS 字符串预算都立即给出单条资源诊断", async () => {
    const projectDirectory = await createProject();
    const projectPath = join(projectDirectory, "project.json");
    const expectLimit = async (metric: string) => {
      try {
        await inspectProjectVNext(projectDirectory);
        throw new Error("预期资源检查失败");
      } catch (error) {
        expect(error).toMatchObject({
          code: "PROJECT_CONTENT_INVALID",
          path: projectPath,
          diagnostics: [{ code: "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED", metric }],
        });
        expect((error as { diagnostics: unknown[] }).diagnostics).toHaveLength(1);
      }
    };

    await writeFile(projectPath, '{"assets":[],"scenes":[],"x":{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}}}');
    await expectLimit("depth");

    await writeFile(projectPath, `{"assets":[],"scenes":[{"id":"30000000-0000-4000-8000-000000000001","narration":{"text":"x"},"assetIds":[],"speech":{"path":"speech/30000000-0000-4000-8000-000000000001.mp3","durationMs":${"1".repeat(65)},"sourceTextHash":"sha256:${"0".repeat(64)}","ttsProfileId":"x"}}]}`);
    await expectLimit("numberBytes");

    await writeFile(projectPath, JSON.stringify({
      assets: Array.from({ length: 1001 }, (_, index) => ({
        id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        path: `assets/${index}`,
      })),
      scenes: [],
    }));
    await expectLimit("assets");

    const assetId = "20000000-0000-4000-8000-000000000001";
    const sceneId = "30000000-0000-4000-8000-000000000001";
    await writeFile(projectPath, JSON.stringify({
      assets: [{ id: assetId, path: `assets/${"a".repeat(1018)}` }],
      scenes: [],
    }));
    await expectLimit("pathBytes");

    await writeFile(projectPath, JSON.stringify({
      assets: [{ id: assetId, path: "assets/a" }],
      scenes: [{ id: sceneId, narration: { text: "x" }, assetIds: Array(257).fill(assetId) }],
    }));
    await expectLimit("sceneAssetIds");

    await writeFile(projectPath, JSON.stringify({
      assets: [],
      scenes: [{
        id: sceneId,
        narration: { text: "x" },
        assetIds: [],
        speech: {
          path: `speech/${sceneId}.mp3`,
          durationMs: 1,
          sourceTextHash: `sha256:${createHash("sha256").update("x").digest("hex")}`,
          ttsProfileId: "x".repeat(257),
        },
      }],
    }));
    await expectLimit("ttsProfileIdScalars");
  });

  it("稳定排序、去重并把聚合诊断截断在 100 条", async () => {
    const projectDirectory = await createProject();
    const unknownFields = Object.fromEntries(
      Array.from({ length: 105 }, (_, index) => [`unknown${String(index).padStart(3, "0")}`, true]),
    );
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [],
      scenes: [],
      ...unknownFields,
    }));

    try {
      await inspectProjectVNext(projectDirectory);
      throw new Error("预期 Project DSL 检查失败");
    } catch (error) {
      const diagnostics = (error as { diagnostics: Array<{ code: string; jsonPath?: string }> }).diagnostics;
      expect(diagnostics).toHaveLength(100);
      expect(diagnostics[0]?.jsonPath).toBe("$.unknown000");
      expect(diagnostics[99]?.code).toBe("DIAGNOSTICS_TRUNCATED");
    }
  });
});

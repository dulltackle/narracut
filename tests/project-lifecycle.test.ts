import { access, mkdir, mkdtemp, readFile, readdir, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createProjectVNext, openProjectVNext } from "../src/server/project-lifecycle";
import { inspectProjectVNext } from "../src/server/project-vnext-inspection";

describe("Project VNext 生命周期", () => {
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

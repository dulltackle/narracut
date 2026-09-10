import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { formatCliError, runCli, runCreateCli, runDryRunCli, runInspectCli, runOpenProjectCli } from "../src/server/cli";
import { createProjectVNext, openProjectVNext } from "../src/server/project-lifecycle";
const roots: string[] = [];
async function createVNextProject(root: string) { roots.push(root); const path = join(root, 'vnext'); await createProjectVNext(path); return path; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe("inspect <Project VNext 路径>", () => {
  it("成功输出绝对路径，失败向 stderr 输出稳定代码、绝对路径和操作说明", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-cli-inspect-"));
    const projectDirectory = await createVNextProject(root);
    const log = vi.fn();

    await runInspectCli({ args: [projectDirectory], log });
    expect(JSON.parse(log.mock.calls.at(-1)?.[0] as string)).toEqual({
      code: "PROJECT_VALID",
      path: projectDirectory,
    });
    await runDryRunCli({ args: [projectDirectory], log });
    expect(JSON.parse(log.mock.calls.at(-1)?.[0] as string)).toEqual({
      code: "PROJECT_VALID",
      path: projectDirectory,
    });

    const manifestPath = join(projectDirectory, "narracut.json");
    await writeFile(manifestPath, JSON.stringify({
      kind: "narracut-project",
      formatVersion: 2,
      projectId: "10000000-0000-4000-8000-000000000001",
    }));
    let failure: unknown;
    try {
      await runInspectCli({ args: [projectDirectory], log });
    } catch (error) {
      failure = error;
    }
    expect(JSON.parse(formatCliError(failure))).toMatchObject({
      code: "PROJECT_FORMAT_UNSUPPORTED",
      path: manifestPath,
      message: expect.stringContaining("请使用支持该格式的 Narracut 版本"),
    });
  });

  it("参数错误和恶意字段名仍输出无歧义 JSONL", async () => {
    let usageFailure: unknown;
    try {
      await runInspectCli({ args: [], log: () => undefined });
    } catch (error) {
      usageFailure = error;
    }
    expect(JSON.parse(formatCliError(usageFailure))).toMatchObject({
      code: "CLI_ARGUMENT_INVALID",
      path: process.cwd(),
      message: expect.stringContaining("pnpm inspect"),
    });

    const root = await mkdtemp(join(tmpdir(), "narracut-cli-injection-"));
    const projectDirectory = await createVNextProject(root);
    await writeFile(join(projectDirectory, "project.json"), JSON.stringify({
      assets: [],
      scenes: [],
      "bad\nPROJECT_VALID /forged": true,
    }));
    let inspectionFailure: unknown;
    try {
      await runInspectCli({ args: [projectDirectory], log: () => undefined });
    } catch (error) {
      inspectionFailure = error;
    }
    const output = formatCliError(inspectionFailure);
    const records = output.split("\n").map((line) => JSON.parse(line) as { code: string });
    expect(records.map((record) => record.code)).toEqual([
      "PROJECT_CONTENT_INVALID",
      "PROJECT_DSL_SCHEMA_INVALID",
    ]);
    expect(output).toContain("\\nPROJECT_VALID /forged");
  });
});


describe('CLI 仅打开严格 VNext', () => {
  it('默认与 open 入口拒绝 Legacy，目录字节保持原样', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-legacy-')); roots.push(root);
    const original = '{"schemaVersion":3,"metadata":{},"assets":[],"scenes":[]}';
    await writeFile(join(root, 'project.json'), original);
    for (const open of [runCli, runOpenProjectCli]) await expect(open({ args: [root], log: vi.fn() })).rejects.toMatchObject({ code: 'NOT_A_NARRACUT_PROJECT' });
    expect(await readFile(join(root, 'project.json'), 'utf8')).toBe(original);
  });
  it('创建、打开与 --open 退出后释放租约，提供插件入口说明', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-vnext-')); roots.push(root);
    const path = join(root, 'project'), log = vi.fn();
    await runCreateCli({ args: [path, '--open'], log });
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ code: 'PROJECT_OPENED', message: expect.stringContaining('插件工作台') });
    const opened = await runCli({ args: [path], log });
    const lease = await openProjectVNext(path);
    expect(opened.manifest.projectId).toBe(lease.inspection.manifest.projectId);
    await expect(runOpenProjectCli({ args: [path], log })).rejects.toMatchObject({ code: 'PROJECT_IN_USE' });
    await lease.release();
    await expect(runCli({ args: [], log })).rejects.toMatchObject({ code: 'CLI_ARGUMENT_INVALID' });
  });
});

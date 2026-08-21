import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";
import sharp from "sharp";

import type { RenderWorkerHandle, RenderWorkerInput } from "../../src/server/render-jobs";
import { startNarracutServer, type RunningServer } from "../../src/server/server";

const sceneId = "31000000-0000-4000-8000-000000000003";
const narration = "先确认成片来自点击时的版本。";
let server: RunningServer;
let projectDirectory: string;
let worker: FakeWorker;
let workerInput: RenderWorkerInput | undefined;
const execFileAsync = promisify(execFile);

class FakeWorker extends EventEmitter implements RenderWorkerHandle {
  kill(): boolean {
    this.emit("exit", null, "SIGTERM");
    return true;
  }
}

function project(withSpeech = true) {
  return {
    schemaVersion: 3,
    metadata: { name: "渲染闭环" },
    theme: {
      presetId: "narracut/default@1",
      defaultTextStyleId: "narracut/panel@1",
      defaultTextMotionId: "narracut/fade@1",
      accentColor: "#00A3A6",
      fontId: "narracut/noto-sans-cjk-sc@1",
    },
    assets: [],
    scenes: [{
      id: sceneId,
      narration: { text: narration },
      ...(withSpeech ? {
        speech: {
          path: `speech/${sceneId}.mp3`,
          durationMs: 100,
          sourceTextHash: `sha256:${createHash("sha256").update(narration).digest("hex")}`,
          ttsProfileId: "narracut-mandarin-news-v1",
        },
      } : {}),
      visual: { type: "card", title: "渲染快照" },
      transition: "cut",
    }],
  };
}

async function start(withSpeech = true) {
  const root = await mkdtemp(join(tmpdir(), "narracut-render-ui-"));
  projectDirectory = join(root, "project");
  await mkdir(join(projectDirectory, "speech"), { recursive: true });
  await writeFile(join(projectDirectory, "project.json"), `${JSON.stringify(project(withSpeech))}\n`);
  if (withSpeech) {
    await writeFile(
      join(projectDirectory, "speech", `${sceneId}.mp3`),
      await readFile(resolve("fixtures/demo/speech/20000000-0000-4000-8000-000000000001.mp3")),
    );
  }
  worker = new FakeWorker();
  workerInput = undefined;
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    host: "127.0.0.1",
    initialPort: 0,
    renderWorkerFactory: (input) => {
      workerInput = input;
      return worker;
    },
    openDirectory: async () => undefined,
  });
}

test.afterEach(async () => {
  await server.close();
});

test("阻断项打开任务抽屉且不会创建 Render Job", async ({ page }) => {
  await start(false);
  await page.goto(server.url);

  await page.getByRole("button", { name: "检查并渲染 · 1" }).click();

  await expect(page.getByRole("heading", { name: "任务与渲染" })).toBeVisible();
  const blocker = page.getByRole("button", { name: /Scene 01 缺少 Speech/ });
  await expect(blocker).toBeVisible();
  await expect(blocker).toBeFocused();
  expect(workerInput).toBeUndefined();
});

test("从未保存内存版本启动后台渲染，继续编辑并查看三件产物", async ({ page }) => {
  await start();
  await page.route("**/api/project", async (route) => {
    if (route.request().method() === "PUT") await route.abort("connectionfailed");
    else await route.continue();
  });
  await page.goto(server.url);
  await page.getByRole("button", { name: "编辑项目名" }).click();
  await page.getByRole("textbox", { name: "项目名" }).fill("点击时内存版本");
  await page.getByRole("textbox", { name: "项目名" }).press("Enter");

  await page.getByRole("button", { name: "渲染 MP4" }).click();

  await expect(page.getByRole("button", { name: /正在启动/ })).toBeDisabled();
  await expect(page.getByText("来自未保存版本")).toBeVisible();
  expect(JSON.parse(await readFile(workerInput!.snapshotFile, "utf8")).metadata.name)
    .toBe("点击时内存版本");

  const narrationBox = page.getByRole("textbox", { name: "Scene 1 Narration" }).first();
  await narrationBox.fill("渲染期间继续编辑的下一版");
  await expect(narrationBox).toHaveValue("渲染期间继续编辑的下一版");
  expect(JSON.parse(await readFile(workerInput!.snapshotFile, "utf8")).scenes[0].narration.text)
    .toBe(narration);

  worker.emit("message", { type: "progress", stage: "encoding", progress: 0.42 });
  await expect(page.getByRole("button", { name: "正在渲染 · 42%" })).toBeDisabled();
  await writeFile(workerInput!.outputFile, "mp4");
  await writeFile(workerInput!.logFile, "render log");
  worker.emit("message", { type: "completed", durationInFrames: 3 });

  await expect(page.getByRole("button", { name: "渲染完成" })).toBeVisible();
  await expect(page.getByText("out.mp4", { exact: true })).toBeVisible();
  await expect(page.getByText("project.snapshot.json", { exact: true })).toBeVisible();
  await expect(page.getByText("render.log", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开产物目录" }).first()).toBeVisible();
});

test("用户可以取消后台渲染并继续使用工作台", async ({ page }) => {
  await start();
  await page.goto(server.url);
  await page.getByRole("button", { name: "渲染 MP4" }).click();
  await page.getByRole("button", { name: "取消渲染" }).click();

  await expect(page.getByTestId("render-job-task")).toContainText("已取消");
  await expect(page.getByRole("button", { name: "渲染 MP4" })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Scene 1 Narration" }).first())
    .toBeEnabled();
});

test("活跃 Render 提供原生离开保护，详情返回后恢复任务焦点", async ({ page }) => {
  await start();
  await page.goto(server.url);
  await page.getByRole("button", { name: "渲染 MP4" }).click();
  const summary = page.getByRole("button", { name: "查看 Render Job 详情" });
  await expect(summary).toBeVisible();

  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    const result = window.onbeforeunload?.(event as BeforeUnloadEvent);
    return { installed: window.onbeforeunload !== null, result, defaultPrevented: event.defaultPrevented };
  })).toEqual({ installed: true, result: "", defaultPrevented: true });

  await summary.click();
  await expect(page.getByRole("heading", { name: "Render Job" })).toBeVisible();
  await page.getByRole("button", { name: "返回任务总览" }).click();
  await expect(summary).toBeFocused();
  await page.getByRole("button", { name: "取消渲染" }).click();
  await expect(page.getByTestId("render-job-task")).toContainText("已取消");

  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    const result = window.onbeforeunload?.(event as BeforeUnloadEvent);
    return { installed: window.onbeforeunload !== null, result, defaultPrevented: event.defaultPrevented };
  })).toEqual({ installed: true, result: undefined, defaultPrevented: false });
});

test("项目切换会等待活跃任务取消，取消失败时留在当前项目", async ({ page }) => {
  await start();
  await page.goto(server.url);
  await page.getByRole("button", { name: "渲染 MP4" }).click();
  await expect(page.getByRole("button", { name: /正在启动/ })).toBeDisabled();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("narracut:project-switch", {
      detail: { destination: `${window.location.origin}/#switched` },
    }));
  });
  await expect(page.getByTestId("project-switch-guard")).toContainText("1 个任务仍在运行");
  await expect(page.getByTestId("project-switch-guard")).toContainText("render");
  await page.getByRole("button", { name: "取消任务后切换" }).click();
  await expect(page).toHaveURL(/#switched$/u);

  await page.getByRole("button", { name: "渲染 MP4" }).click();
  await expect(page.getByRole("button", { name: /正在启动/ })).toBeDisabled();
  await page.route("**/api/jobs/*", async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({ status: 500, body: "取消 worker 失败" });
    } else {
      await route.continue();
    }
  });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("narracut:project-switch", {
      detail: { destination: `${window.location.origin}/#blocked` },
    }));
  });
  await page.getByRole("button", { name: "取消任务后切换" }).click();
  await expect(page.getByTestId("project-switch-guard").getByRole("alert"))
    .toContainText("取消 worker 失败");
  await expect(page).not.toHaveURL(/#blocked$/u);
});

test("刷新后恢复活跃 Render，但不会继承旧终态历史", async ({ page }) => {
  await start();
  await page.goto(server.url);
  await page.getByRole("button", { name: "渲染 MP4" }).click();

  await page.reload();
  await expect(page.getByRole("button", { name: /正在启动/ })).toBeDisabled();
  worker.emit("message", { type: "completed", durationInFrames: 3 });
  await expect(page.getByRole("button", { name: "渲染完成" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "渲染 MP4" })).toBeVisible();
  await page.getByRole("button", { name: /任务/ }).click();
  await expect(page.getByTestId("render-job-task")).toHaveCount(0);
});

test("Auto Save 冲突时仍从当前内存版本创建渲染快照", async ({ page }) => {
  await start();
  await page.goto(server.url);
  await writeFile(
    join(projectDirectory, "project.json"),
    `${JSON.stringify({ ...project(), metadata: { name: "磁盘外部版本" } })}\n`,
  );
  await page.getByRole("button", { name: "编辑项目名" }).click();
  await page.getByRole("textbox", { name: "项目名" }).fill("冲突中的内存版本");
  await page.getByRole("textbox", { name: "项目名" }).press("Enter");

  await expect(page.getByRole("heading", { name: "项目文件已在外部更改" }))
    .toBeVisible();
  await page.getByRole("button", { name: "渲染当前内存版本" }).click();

  await expect(page.getByText("来自未保存版本")).toBeVisible();
  expect(JSON.parse(await readFile(workerInput!.snapshotFile, "utf8")).metadata.name)
    .toBe("冲突中的内存版本");
});

test("图片型项目通过默认 fork worker 生成帧数正确的可解码 MP4", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "narracut-render-output-"));
  projectDirectory = join(root, "project");
  const imageId = "32000000-0000-4000-8000-000000000001";
  const sceneIds = [1, 2, 3, 4].map((index) =>
    `33000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
  await mkdir(join(projectDirectory, "assets"), { recursive: true });
  await mkdir(join(projectDirectory, "speech"), { recursive: true });
  await sharp({
    create: { width: 1920, height: 1080, channels: 3, background: "#1f6f78" },
  }).png().toFile(join(projectDirectory, "assets", `${imageId}.png`));
  const scenes = [
    { visual: { type: "card", label: "NARRACUT", title: "图片项目" } },
    { visual: { type: "image", assetId: imageId } },
    { visual: { type: "image", assetId: imageId, caption: { text: "Image + Caption" } } },
    { visual: { type: "card", title: "完成", body: "预览就是成片" } },
  ].map((item, index) => {
    const text = `Scene ${index + 1} 的 Speech`;
    return {
      id: sceneIds[index],
      narration: { text },
      speech: {
        path: `speech/${sceneIds[index]}.mp3`,
        durationMs: 100,
        sourceTextHash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
        ttsProfileId: "narracut-mandarin-news-v1",
      },
      visual: item.visual,
      transition: "cut",
    };
  });
  for (const id of sceneIds) {
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=32000", "-t", "0.10",
      "-ac", "1", "-b:a", "64k", join(projectDirectory, "speech", `${id}.mp3`),
    ]);
  }
  const imageProject = {
    schemaVersion: 3,
    metadata: { name: "真实成片验收" },
    theme: {
      presetId: "narracut/default@1",
      defaultTextStyleId: "narracut/panel@1",
      defaultTextMotionId: "narracut/fade@1",
      accentColor: "#00A3A6",
      fontId: "narracut/noto-sans-cjk-sc@1",
    },
    assets: [{ id: imageId, kind: "image", path: `assets/${imageId}.png` }],
    scenes,
  };
  await writeFile(join(projectDirectory, "project.json"), `${JSON.stringify(imageProject)}\n`);
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    host: "127.0.0.1",
    initialPort: 0,
    openDirectory: async () => undefined,
  });

  await page.goto(server.url);
  await page.getByRole("button", { name: "渲染 MP4" }).click();
  await expect(page.getByRole("button", { name: "渲染完成" })).toBeVisible({ timeout: 120_000 });

  const renderDirectories = await readdir(join(projectDirectory, "renders"));
  expect(renderDirectories).toHaveLength(1);
  const resultDirectory = join(projectDirectory, "renders", renderDirectories[0]);
  const files = await readdir(resultDirectory);
  expect(files.sort()).toEqual([".media", "out.mp4", "project.snapshot.json", "render.log"]);
  expect(await readdir(join(resultDirectory, ".media", "speech"))).toHaveLength(4);
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_read_frames",
    "-of", "json", join(resultDirectory, "out.mp4"),
  ]);
  expect(JSON.parse(stdout).streams[0]).toMatchObject({
    codec_name: "h264",
    width: 1920,
    height: 1080,
    r_frame_rate: "30/1",
    nb_read_frames: "12",
  });
  const { stdout: streamsOutput } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name",
    "-of", "json", join(resultDirectory, "out.mp4"),
  ]);
  const streams = JSON.parse(streamsOutput).streams as Array<{
    codec_type: string;
    codec_name: string;
  }>;
  expect(streams.filter((stream) => stream.codec_type === "audio")).toEqual([
    expect.objectContaining({ codec_name: "aac" }),
  ]);
});

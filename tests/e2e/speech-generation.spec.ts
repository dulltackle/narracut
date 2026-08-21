import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { startNarracutServer, type RunningServer } from "../../src/server/server";

const execFileAsync = promisify(execFile);
const sceneId = "8b000000-0000-4000-8000-000000000001";
const narrationText = "请确认样本架已经放置到位。";
const durationMs = 468;
let server: RunningServer;
let projectDirectory: string;
let projectFile: string;
let providerAudio: Buffer;
let providerMode: "pending" | "auth-failure";
let resolveProvider: (() => void) | undefined;
let providerCalls: number;

function sourceTextHash(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function projectWithSpeech(hasSpeech = false) {
  return {
    schemaVersion: 3,
    metadata: { name: "Speech 生成验收" },
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
      narration: { text: narrationText },
      ...(hasSpeech ? {
        speech: {
          path: `speech/${sceneId}.mp3`,
          durationMs,
          sourceTextHash: sourceTextHash(narrationText),
          ttsProfileId: "narracut-mandarin-news-v1",
        },
      } : {}),
      visual: { type: "card", title: "Speech 状态演示" },
      transition: "cut",
    }],
  };
}

test.beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "narracut-speech-e2e-"));
  projectDirectory = join(root, "project");
  projectFile = join(projectDirectory, "project.json");
  await mkdir(projectDirectory);
  const fixture = join(root, "provider.mp3");
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=32000",
    "-t",
    "0.432",
    "-ac",
    "1",
    "-b:a",
    "64k",
    fixture,
  ]);
  providerAudio = await readFile(fixture);
  providerMode = "pending";
  providerCalls = 0;
  resolveProvider = undefined;
  const ttsFetch: typeof fetch = async (_input, init) => {
    providerCalls += 1;
    if (providerMode === "auth-failure") {
      return new Response(JSON.stringify({
        base_resp: { status_code: 1004, status_msg: "invalid api key" },
      }), { status: 401, headers: { "content-type": "application/json" } });
    }
    await new Promise<void>((resolvePromise, rejectPromise) => {
      resolveProvider = resolvePromise;
      init?.signal?.addEventListener(
        "abort",
        () => rejectPromise(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
    return Response.json({
      data: { audio: providerAudio.toString("hex") },
      extra_info: { audio_length: durationMs, audio_format: "mp3" },
      base_resp: { status_code: 0, status_msg: "success" },
    });
  };
  await writeFile(projectFile, `${JSON.stringify(projectWithSpeech())}\n`);
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    host: "127.0.0.1",
    initialPort: 0,
    ttsFetch,
    environment: { TOKENDANCE_API_KEY: "fake-e2e-key" },
  });
});

test.afterEach(async () => {
  await server.close();
});

test("首次生成期间保留 Draft，成功后 Speech 成为 Player 的时长来源", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.getByTestId("player-draft-state")).toContainText("Draft · 5.0s");
  await page.getByRole("button", { name: "生成 Speech", exact: true }).click();

  const row = page.getByTestId("scene-row");
  await expect(row.getByText("正在生成", { exact: true })).toBeVisible();
  await expect(row.getByText("当前仍使用 Draft Duration")).toBeVisible();
  await expect(page.getByTestId("player-draft-state")).toContainText("正在生成 · 仅供预览");
  resolveProvider?.();

  await expect(row.getByText("已生成 · 可撤销")).toBeVisible();
  await expect(page.getByTestId("player-scene-state")).toContainText("Speech · 0.5s");
  await expect.poll(async () => JSON.parse(await readFile(projectFile, "utf8"))).toMatchObject({
    scenes: [{
      speech: {
        path: `speech/${sceneId}.mp3`,
        durationMs,
        sourceTextHash: sourceTextHash(narrationText),
        ttsProfileId: "narracut-mandarin-news-v1",
      },
    }],
  });
});

test("安全提交无响应时退出等待态并保留 Draft", async ({ page }) => {
  await page.route("**/api/jobs/*/commit", async () => {
    await new Promise<void>(() => undefined);
  });
  await page.goto(server.url);
  await page.getByRole("button", { name: "生成 Speech", exact: true }).click();
  resolveProvider?.();

  const row = page.getByTestId("scene-row");
  await expect(row.getByText("等待安全应用")).toBeVisible();
  await expect(row.getByText("Speech 生成失败")).toBeVisible({ timeout: 8_000 });
  await expect(row.getByText("仍使用 Draft Duration")).toBeVisible();
  await expect(row.getByText("等待安全应用")).toHaveCount(0);
  await expect(page.getByTestId("player-draft-state")).toContainText("Draft · 5.0s");
  expect((JSON.parse(await readFile(projectFile, "utf8"))).scenes[0].speech)
    .toBeUndefined();
});

test("重新生成失败时旧 Speech、Duration 与恢复动作保持可见", async ({ page }) => {
  await mkdir(join(projectDirectory, "speech"));
  await writeFile(join(projectDirectory, "speech", `${sceneId}.mp3`), providerAudio);
  await writeFile(projectFile, `${JSON.stringify(projectWithSpeech(true))}\n`);
  providerMode = "auth-failure";
  await page.goto(server.url);

  await page.getByRole("button", { name: "重新生成 Scene 1 Speech" }).click();
  const row = page.getByTestId("scene-row");
  await expect(row.getByText("Speech 生成失败")).toBeVisible();
  await expect(row.getByText("旧 Speech 仍有效 · 0.5 秒")).toBeVisible();
  await expect(page.getByTestId("player-scene-state")).toContainText("Speech · 0.5s");

  await row.getByRole("button", { name: "查看 Scene 1 Speech 失败详情" }).click();
  const task = page.getByTestId("speech-generation-task");
  await expect(task).toContainText("TokenDance 鉴权失败");
  await expect(task).toContainText("TTS_AUTH_FAILED · 需要检查配置");
  await expect(task.getByRole("button", { name: "重试" })).toBeVisible();
  expect((JSON.parse(await readFile(projectFile, "utf8"))).scenes[0].speech.durationMs)
    .toBe(durationMs);
});

test("取消生成后恢复 Draft，并把焦点送回对应 Speech 单元格", async ({ page }) => {
  await page.goto(server.url);
  await page.getByRole("button", { name: "生成 Speech", exact: true }).click();

  const row = page.getByTestId("scene-row");
  await expect(row.getByText("正在生成", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "取消 Scene 1 Speech 生成" }).click();

  const speechCell = row.locator("[data-speech-cell-scene-id]");
  await expect(speechCell).toContainText("已取消 · 使用 Draft Duration");
  await expect(speechCell).toBeFocused();
  await expect(page.getByTestId("player-draft-state")).toContainText("Draft · 5.0s");
});

test("快速双击只会为同一 Scene 创建一个 Speech 任务", async ({ page }) => {
  await page.goto(server.url);
  await page.getByRole("button", { name: "生成 Speech", exact: true }).dblclick();

  await expect(page.getByTestId("scene-row").getByText("正在生成", { exact: true }))
    .toBeVisible();
  expect(providerCalls).toBe(1);
  resolveProvider?.();
  await expect(page.getByTestId("scene-row").getByText("已生成 · 可撤销"))
    .toBeVisible();
});

test("删除生成中的 Scene 不取消 Job，迟到 Speech 被丢弃且 Undo 不复活结果", async ({ page }) => {
  await page.goto(server.url);
  await page.getByRole("button", { name: "生成 Speech", exact: true }).click();
  await expect(page.getByTestId("scene-row").getByText("正在生成", { exact: true }))
    .toBeVisible();

  await page.getByRole("button", { name: "删除 Scene 1" }).click();
  await expect(page.getByRole("heading", { name: "从第一句讲解开始" })).toBeVisible();
  resolveProvider?.();

  await expect(page.getByTestId("speech-generation-task")).toContainText(
    "结果未应用 · 目标 Scene 已删除",
  );
  await expect(page.getByRole("complementary", { name: "任务与渲染" })).toBeVisible();
  await expect
    .poll(async () => JSON.parse(await readFile(projectFile, "utf8")).scenes)
    .toEqual([]);

  await page.getByRole("button", { name: "撤销：删除 Scene 01" }).click();
  await expect(page.getByTestId("scene-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "生成 Speech", exact: true })).toBeVisible();
  expect(JSON.parse(await readFile(projectFile, "utf8")).scenes[0].speech).toBeUndefined();
  expect(providerCalls).toBe(1);
});

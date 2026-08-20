import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { startNarracutServer, type RunningServer } from "../../src/server/server";
import type { Project } from "../../src/shared/project";

let server: RunningServer;
let projectFile: string;
let projectDirectory: string;
const execFileAsync = promisify(execFile);

const sceneIds = [
  "88000000-0000-4000-8000-000000000001",
  "88000000-0000-4000-8000-000000000002",
  "88000000-0000-4000-8000-000000000003",
];

const projectTheme = {
  presetId: "narracut/default@1",
  defaultTextStyleId: "narracut/panel@1",
  defaultTextMotionId: "narracut/fade@1",
  accentColor: "#00A3A6",
  fontId: "narracut/noto-sans-cjk-sc@1",
};

function speech(sceneId: string, durationMs: number, narrationText: string) {
  return {
    path: `speech/${sceneId}.mp3`,
    durationMs,
    sourceTextHash: `sha256:${createHash("sha256").update(narrationText).digest("hex")}`,
    ttsProfileId: "narracut-mandarin-news-v1",
  };
}

function playerProject(): Project {
  return {
    schemaVersion: 3,
    metadata: { name: "Player 行为夹具" },
    theme: projectTheme,
    assets: [],
    scenes: [
      {
        id: sceneIds[0],
        narration: { text: "第一段 Narration" },
        speech: speech(sceneIds[0], 500, "第一段 Narration"),
        visual: { type: "card", title: "第一张 Card" },
        transition: "cut",
      },
      {
        id: sceneIds[1],
        narration: { text: "第二段 Narration" },
        speech: speech(sceneIds[1], 1000, "第二段 Narration"),
        visual: { type: "card", title: "第二张 Card" },
        transition: "cut",
      },
      {
        id: sceneIds[2],
        narration: { text: "第三段 Draft Narration" },
        visual: { type: "card", title: "第三张 Draft Card" },
        transition: "cut",
      },
    ],
  };
}

async function writeProject(project: Project) {
  await writeFile(projectFile, `${JSON.stringify(project)}\n`);
}

test.beforeAll(async () => {
  projectDirectory = await mkdtemp(join(tmpdir(), "narracut-player-e2e-"));
  projectFile = join(projectDirectory, "project.json");
  await mkdir(join(projectDirectory, "assets"));
  await mkdir(join(projectDirectory, "speech"));
  await Promise.all([
    [sceneIds[0], "0.5"],
    [sceneIds[1], "1.0"],
  ].map(([sceneId, duration]) =>
    execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=32000:cl=mono",
      "-t",
      duration,
      "-b:a",
      "64k",
      join(projectDirectory, "speech", `${sceneId}.mp3`),
    ]),
  ));
  const shortVideoBase64 = await readFile(
    resolve("tests/fixtures/short-video.mp4.b64"),
    "utf8",
  );
  await writeFile(
    join(projectDirectory, "assets", "short.mp4"),
    Buffer.from(shortVideoBase64.trim(), "base64"),
  );
  await writeFile(
    join(projectDirectory, "assets", "still.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5ZkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await writeFile(join(projectDirectory, "assets", "corrupt.mp4"), "not a video");
  await writeProject(playerProject());
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    initialPort: 0,
  });
});

test.afterAll(async () => {
  await server.close();
});

test.afterEach(async () => {
  await server.releaseProjectLease();
});

test("播放跨 Cut 只更新播放 Scene，真实事件驱动播放状态", async ({ page }) => {
  await writeProject(playerProject());
  await page.goto(server.url);

  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 01");
  await expect(page.getByTestId("player-playing-scene")).toHaveText("播放 01");
  await expect(page.getByTestId("player-playback-state")).toHaveText("已暂停");

  await page.getByRole("button", { name: "播放" }).click();
  await expect(page.getByTestId("player-playback-state")).toHaveText("播放中");
  await expect(page.getByRole("button", { name: "暂停" })).toBeVisible();
  await expect.poll(async () => page.getByTestId("player-playing-scene").textContent())
    .toBe("播放 02");
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 01");
});

test("Speech 连续播放时不暂停 Web Audio 上下文", async ({ page }) => {
  await page.addInitScript(() => {
    const transitions: string[] = [];
    Object.defineProperty(window, "__audioContextTransitions", {
      value: transitions,
    });
    for (const method of ["resume", "suspend"] as const) {
      const original = AudioContext.prototype[method];
      AudioContext.prototype[method] = function trackAudioContextTransition() {
        transitions.push(method);
        return original.call(this);
      };
    }
  });

  const project = playerProject();
  project.scenes = [project.scenes[1]];
  await writeProject(project);
  await page.goto(server.url);

  await expect(page.getByTestId("player-scene-state")).toContainText("Speech · 1.0s");
  await page.getByRole("button", { name: "播放" }).click();
  await page.waitForTimeout(850);

  const transitions = await page.evaluate(() =>
    (window as typeof window & { __audioContextTransitions: string[] })
      .__audioContextTransitions,
  );
  const firstResume = transitions.indexOf("resume");
  expect(firstResume, "测试必须经过真实 Web Audio 播放路径").toBeGreaterThanOrEqual(0);
  expect(
    transitions.slice(firstResume + 1).filter((event) => event === "suspend"),
    "Speech 连续播放期间不应暂停 Web Audio 上下文",
  ).toEqual([]);
});

test("点击表格行选中并跳到 Scene 开头，同时保留播放或暂停状态", async ({ page }) => {
  await writeProject(playerProject());
  await page.goto(server.url);

  await page.getByRole("textbox", { name: "Scene 2 Narration" }).click();
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 01");
  await expect(page.getByRole("slider", { name: "项目播放进度" })).toHaveValue("0");

  const keyboardSelect = page.getByRole("button", { name: "选择并预览 Scene 2" });
  await keyboardSelect.focus();
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 01");
  await keyboardSelect.press("Enter");
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 02");
  await expect(page.getByTestId("player-playing-scene")).toHaveText("播放 02");
  await expect(page.getByTestId("player-playback-state")).toHaveText("已暂停");
  await expect(page.getByRole("slider", { name: "项目播放进度" })).toHaveValue("15");

  await page.getByRole("button", { name: "播放" }).click();
  await expect(page.getByTestId("player-playback-state")).toHaveText("播放中");
  await page.getByTestId("scene-row").nth(2).locator("td").last().click();
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 03");
  await expect(page.getByTestId("player-playing-scene")).toHaveText("播放 03");
  await expect(page.getByTestId("player-playback-state")).toHaveText("播放中");
});

test("播放中重排按稳定 Scene ID 恢复 Scene 内位置，且不改变选中 Scene", async ({ page }) => {
  await writeProject(playerProject());
  await page.goto(server.url);

  const progress = page.getByRole("slider", { name: "项目播放进度" });
  await progress.fill("30");
  await expect(page.getByTestId("player-playing-scene")).toHaveText("播放 02");
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 01");
  await page.getByRole("button", { name: "播放" }).click();

  const handle = page.getByRole("button", { name: "重排 Scene 2" });
  await handle.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerType: "mouse" });
  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 01");
  await handle.press("Enter");
  await handle.press("ArrowUp");
  await handle.press("Enter");

  await expect(page.getByTestId("player-selected-scene")).toHaveText("选中 02");
  await expect(page.getByTestId("player-playing-scene")).toHaveText("播放 01");
  await expect(page.getByTestId("player-playback-state")).toHaveText("播放中");
  await expect.poll(async () => Number(await progress.inputValue())).toBeLessThan(45);
});

test("Image 等待就绪，Video 静音并在短于 Scene 时保持最后画面", async ({ page }) => {
  const imageId = "89000000-0000-4000-8000-000000000001";
  const videoId = "89000000-0000-4000-8000-000000000002";
  const project = playerProject();
  project.assets = [
    { id: imageId, kind: "image", path: "assets/still.png" },
    { id: videoId, kind: "video", path: "assets/short.mp4" },
  ];
  project.scenes = [
    {
      id: sceneIds[0],
      narration: { text: "Image Scene" },
      speech: speech(sceneIds[0], 1000, "Image Scene"),
      visual: { type: "image", assetId: imageId, caption: { text: "Image Caption", textMotionId: "narracut/none@1" } },
      transition: "cut",
    },
    {
      id: sceneIds[1],
      narration: { text: "Video Scene" },
      speech: speech(sceneIds[1], 2000, "Video Scene"),
      visual: { type: "video", assetId: videoId, caption: { text: "Video Caption", textMotionId: "narracut/none@1" } },
      transition: "cut",
    },
  ];
  await writeProject(project);
  await page.goto(server.url);

  await expect(page.getByTestId("media-asset")).toHaveAttribute("data-media-kind", "image");
  await expect(page.getByTestId("media-asset")).toHaveAttribute("data-media-status", "ready");
  await expect(page.getByTestId("composition-text-block")).toContainText("Image Caption");

  await page.getByRole("button", { name: "选择并预览 Scene 2" }).click();
  await expect(page.getByTestId("media-asset")).toHaveAttribute("data-media-kind", "video");
  await expect(page.getByTestId("media-asset")).toHaveAttribute("data-media-muted", "true");
  await expect(page.getByTestId("media-asset")).toHaveAttribute("data-media-status", "ready");
  await page.getByRole("slider", { name: "项目播放进度" }).fill("85");
  await expect(page.getByTestId("media-asset")).toHaveAttribute("data-media-status", "ready");
  const videoCanvas = page.getByTestId("media-asset").locator("canvas");
  await expect(videoCanvas).toHaveCount(1);
  await expect.poll(async () => videoCanvas.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (context === null || canvas.width === 0 || canvas.height === 0) return false;
    const [red, green, blue, alpha] = context.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
    ).data;
    return alpha === 255 && red < 80 && green > 120 && blue > 100;
  })).toBe(true);
  await expect(page.getByTestId("media-asset").locator("video, audio")).toHaveCount(0);
  await expect(page.getByTestId("composition-text-block")).toContainText("Video Caption");
});

test("损坏 Video 只替换素材层并保留 Caption 与 Subtitle", async ({ page }) => {
  const videoId = "89000000-0000-4000-8000-000000000003";
  const project = playerProject();
  project.assets = [{ id: videoId, kind: "video", path: "assets/corrupt.mp4" }];
  project.scenes = [{
    id: sceneIds[0],
    narration: { text: "损坏素材仍可信的 Subtitle" },
    speech: speech(sceneIds[0], 2000, "损坏素材仍可信的 Subtitle"),
    visual: {
      type: "video",
      assetId: videoId,
      caption: { text: "损坏素材仍可信的 Caption", textMotionId: "narracut/none@1" },
    },
    transition: "cut",
  }];
  await writeProject(project);
  await page.goto(server.url);

  await expect(page.getByTestId("asset-placeholder")).toContainText("当前文件无法读取或解码");
  await expect(page.getByTestId("composition-text-block")).toContainText("损坏素材仍可信的 Caption");
  await expect(page.getByTestId("player-subtitle")).toContainText("损坏素材仍可信的 Subtitle");
  await expect(page.getByTestId("player-runtime-error")).toHaveCount(0);
});

test("Draft 与不可用 Asset 分层降级，Caption 与 Subtitle 继续可信显示", async ({ page }) => {
  const project = playerProject();
  project.scenes = [
    {
      id: sceneIds[0],
      narration: { text: "可信 Subtitle" },
      visual: {
        type: "image",
        caption: { text: "可信 Caption", textMotionId: "narracut/none@1" },
      },
      transition: "cut",
    },
  ];
  await writeProject(project);
  await page.goto(server.url);

  await expect(page.getByTestId("asset-placeholder")).toHaveAttribute(
    "data-asset-kind",
    "image",
  );
  await expect(page.getByTestId("asset-placeholder")).toContainText("尚未绑定 Asset");
  await expect(page.getByTestId("composition-text-block")).toContainText("可信 Caption");
  await expect(page.getByTestId("player-subtitle")).toContainText("可信 Subtitle");
  await expect(page.getByTestId("player-draft-state")).toContainText(
    "Draft · 5.0s",
  );
  await expect(page.getByTestId("player-draft-state")).toContainText("仅供预览");
});

test("字体或 Preset 无法解析时 Player 显示明确阻断状态", async ({ page }) => {
  const project = playerProject();
  project.theme = {
    ...project.theme,
    fontId: "vendor/missing-font@1",
  };
  await writeProject(project);
  await page.goto(server.url);

  await expect(page.getByTestId("player-blocking-state")).toContainText(
    "字体或文字 Preset 无法解析",
  );
  await expect(page.getByTestId("player-blocking-state")).toContainText(
    "vendor/missing-font@1",
  );

  await page.getByRole("tab", { name: "项目", exact: true }).click();
  await page.getByRole("combobox", { name: "渲染字体" }).selectOption(projectTheme.fontId);
  await expect(page.getByTestId("player-blocking-state")).toHaveCount(0);
  await expect(page.getByTestId("player-visual")).toBeVisible();
});

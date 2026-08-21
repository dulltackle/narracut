import { execFile } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { preflightRenderMedia } from "../src/server/render-preflight";
import { DEFAULT_PROJECT_THEME, type Project } from "../src/shared/project";

const execFileAsync = promisify(execFile);
const sceneId = "34000000-0000-4000-8000-000000000001";
const assetId = "35000000-0000-4000-8000-000000000001";

function videoProject(path: string): Project {
  return {
    schemaVersion: 3,
    metadata: { name: "视频规范预检" },
    theme: DEFAULT_PROJECT_THEME,
    assets: [{ id: assetId, kind: "video", path }],
    scenes: [{
      id: sceneId,
      narration: { text: "渲染前检查视频规范" },
      visual: { type: "video", assetId },
      transition: "cut",
    }],
  };
}

async function videoFixture(
  name: string,
  codecArguments: string[],
): Promise<{ projectRoot: string; relativePath: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), "narracut-render-preflight-"));
  const relativePath = `assets/${name}`;
  const output = join(projectRoot, relativePath);
  await mkdir(join(projectRoot, "assets"));
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x2A2226:s=1920x1080:r=30:d=0.1",
    "-frames:v",
    "3",
    "-an",
    ...codecArguments,
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    output,
  ]);
  return { projectRoot, relativePath };
}

describe("渲染视频 Asset 预检", () => {
  it("拒绝 ffprobe 可读取但 Remotion 无法渲染的 HEVC Main 10", async () => {
    const { projectRoot, relativePath } = await videoFixture("hevc.mp4", [
      "-c:v",
      "libx265",
      "-pix_fmt",
      "yuv420p10le",
      "-x265-params",
      "log-level=error:pools=1",
    ]);

    await expect(
      preflightRenderMedia(videoProject(relativePath), projectRoot),
    ).rejects.toMatchObject({
      code: "VIDEO_ASSET_NOT_NORMALIZED",
      sceneId,
      path: relativePath,
    });
  }, 20_000);

  it("接受规范 H.264 High@4.1 视频", async () => {
    const { projectRoot, relativePath } = await videoFixture("h264.mp4", [
      "-vf",
      "format=yuv420p,setsar=1",
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-level:v",
      "4.1",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-fps_mode",
      "cfr",
      "-color_range",
      "tv",
      "-colorspace",
      "bt709",
      "-color_trc",
      "bt709",
      "-color_primaries",
      "bt709",
    ]);

    await expect(
      preflightRenderMedia(videoProject(relativePath), projectRoot),
    ).resolves.toMatchObject({ [relativePath]: true });
  }, 20_000);
});

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { startNarracutServer, type RunningServer } from "../src/server/server";
import {
  assertNormalizedVideoProbe,
  probeVideoFile,
  runRemotionCli,
} from "../src/server/video-media";

const execFileAsync = promisify(execFile);
const runningServers: RunningServer[] = [];
const sceneId = "80000000-0000-4000-8000-000000000001";
type Rgb = readonly [number, number, number];

function pixelAt(
  data: Buffer,
  width: number,
  channels: number,
  x: number,
  y: number,
): Rgb {
  const offset = (y * width + x) * channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

function colorDistance(actual: Rgb, expected: Rgb): number {
  return Math.hypot(
    actual[0] - expected[0],
    actual[1] - expected[1],
    actual[2] - expected[2],
  );
}

async function fixture(
  file: string,
  args: string[],
): Promise<void> {
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, file]);
}

async function startServer() {
  const root = await mkdtemp(join(tmpdir(), "narracut-video-import-"));
  const projectDirectory = join(root, "project");
  const staticDirectory = join(root, "client");
  const sourceDirectory = join(root, "sources");
  await Promise.all([mkdir(projectDirectory), mkdir(staticDirectory), mkdir(sourceDirectory)]);
  await writeFile(join(projectDirectory, "project.json"), '{"schemaVersion":3,"metadata":{},"assets":[],"scenes":[]}\n');
  await writeFile(join(staticDirectory, "index.html"), "<main>Narracut</main>");
  const server = await startNarracutServer({
    projectDirectory,
    staticDirectory,
    host: "127.0.0.1",
    initialPort: 0,
  });
  runningServers.push(server);
  const sessionId = "video-import-session";
  const lease = await fetch(`${server.url}/api/project/lease`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  expect(lease.status).toBe(200);
  return { projectDirectory, sourceDirectory, server, sessionId };
}

async function importVideo(
  server: RunningServer,
  sessionId: string,
  file: string,
): Promise<Record<string, any>> {
  const response = await fetch(`${server.url}/api/jobs/video-import`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-narracut-file-name": encodeURIComponent(file.split("/").at(-1)!),
      "x-narracut-scene-id": sceneId,
      "x-narracut-session-id": sessionId,
    },
    body: await readFile(file),
  });
  expect(response.status).toBe(202);
  const created = await response.json() as { job: { id: string } };
  let job: Record<string, any> = {};
  await expect.poll(async () => {
    const current = await fetch(`${server.url}/api/jobs/${created.job.id}`);
    job = await current.json() as Record<string, any>;
    return job.status;
  }, { timeout: 120_000, interval: 250 }).toMatch(/succeeded|failed|cancelled/);
  return job;
}

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
});

describe.sequential("真实视频导入", () => {
  it("H.264 目标 profile 带音轨时走 remux，输出无音轨且不修改 DSL", async () => {
    const { projectDirectory, sourceDirectory, server, sessionId } = await startServer();
    const source = join(sourceDirectory, "with-audio.mp4");
    await fixture(source, [
      "-f", "lavfi", "-i", "color=c=red:s=1920x1080:r=30:d=0.2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2",
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1",
      "-pix_fmt", "yuv420p", "-r", "30", "-fps_mode", "cfr",
      "-color_range", "tv", "-colorspace", "bt709", "-color_trc", "bt709", "-color_primaries", "bt709",
      "-c:a", "aac", "-shortest", "-movflags", "+faststart",
    ]);

    const job = await importVideo(server, sessionId, source);
    expect(job).toMatchObject({ status: "succeeded", result: { facts: { mode: "remux", enlarged: false } } });
    const output = join(projectDirectory, ...job.result.asset.path.split("/"));
    const outputProbe = await probeVideoFile(output);
    expect(() => assertNormalizedVideoProbe(outputProbe)).not.toThrow();
    expect(outputProbe.streams).toHaveLength(1);
    expect(JSON.parse(await readFile(join(projectDirectory, "project.json"), "utf8")).assets).toEqual([]);
  }, 30_000);

  it("HEVC Main 10、旋转、VFR、4:3 与低分辨率输入完整转码", async () => {
    const { projectDirectory, sourceDirectory, server, sessionId } = await startServer();
    const base = join(sourceDirectory, "base-hevc.mp4");
    const source = join(sourceDirectory, "rotated-vfr.mov");
    const markerFrame = (rate: number) => [
      `color=c=0x20C060:s=320x240:r=${rate}:d=0.2`,
      "drawbox=x=0:y=0:w=48:h=48:color=0xFF2020:t=fill",
      "drawbox=x=272:y=0:w=48:h=48:color=0x2040FF:t=fill",
      "drawbox=x=272:y=192:w=48:h=48:color=0xFFD020:t=fill",
      "drawbox=x=0:y=192:w=48:h=48:color=0xF020D0:t=fill",
      "drawbox=x=120:y=80:w=80:h=80:color=white:t=fill",
    ].join(",");
    await fixture(base, [
      "-f", "lavfi", "-i", markerFrame(15),
      "-f", "lavfi", "-i", markerFrame(30),
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]",
      "-c:v", "libx265", "-pix_fmt", "yuv420p10le",
      "-x265-params", "log-level=error:pools=1", "-fps_mode", "vfr",
    ]);
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-display_rotation", "90", "-i", base,
      "-c", "copy", source,
    ]);
    const sourceVideo = (await probeVideoFile(source)).streams?.find(
      (stream) => stream.codec_type === "video",
    );
    expect(sourceVideo?.r_frame_rate).not.toBe(sourceVideo?.avg_frame_rate);

    const job = await importVideo(server, sessionId, source);
    expect(job, job.error?.message).toMatchObject({
      status: "succeeded",
      result: {
        facts: {
          mode: "transcode",
          sourceWidth: 240,
          sourceHeight: 320,
          enlarged: true,
        },
      },
    });
    const output = join(projectDirectory, ...job.result.asset.path.split("/"));
    const outputProbe = await probeVideoFile(output);
    expect(() => assertNormalizedVideoProbe(outputProbe)).not.toThrow();
    const frame = join(sourceDirectory, "normalized-frame.png");
    await runRemotionCli("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", output,
      "-frames:v", "1",
      frame,
    ]);
    const { data, info } = await sharp(frame)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 1920, height: 1080, channels: 3 });

    const warmBlack: Rgb = [0x2A, 0x22, 0x26];
    expect(colorDistance(pixelAt(data, info.width, info.channels, 100, 540), warmBlack)).toBeLessThan(12);
    expect(colorDistance(pixelAt(data, info.width, info.channels, 1819, 540), warmBlack)).toBeLessThan(12);
    const occupiedColumns = Array.from({ length: info.width }, (_, x) => x).filter(
      (x) => colorDistance(pixelAt(data, info.width, info.channels, x, 540), warmBlack) > 30,
    );
    expect(occupiedColumns[0]).toBeGreaterThanOrEqual(551);
    expect(occupiedColumns[0]).toBeLessThanOrEqual(559);
    expect(occupiedColumns.at(-1)).toBeGreaterThanOrEqual(1360);
    expect(occupiedColumns.at(-1)).toBeLessThanOrEqual(1368);

    const blue = pixelAt(data, info.width, info.channels, 622, 67);
    const yellow = pixelAt(data, info.width, info.channels, 1298, 67);
    const magenta = pixelAt(data, info.width, info.channels, 1298, 1012);
    const red = pixelAt(data, info.width, info.channels, 622, 1012);
    expect(magenta[0]).toBeGreaterThan(150);
    expect(magenta[2]).toBeGreaterThan(150);
    expect(magenta[1]).toBeLessThan(120);
    expect(red[0]).toBeGreaterThan(150);
    expect(red[1]).toBeLessThan(120);
    expect(red[2]).toBeLessThan(120);
    expect(blue[2]).toBeGreaterThan(150);
    expect(blue[0]).toBeLessThan(120);
    expect(blue[1]).toBeLessThan(140);
    expect(yellow[0]).toBeGreaterThan(150);
    expect(yellow[1]).toBeGreaterThan(140);
    expect(yellow[2]).toBeLessThan(120);

    const whiteColumns = Array.from({ length: info.width }, (_, x) => x).filter((x) => {
      const [r, g, b] = pixelAt(data, info.width, info.channels, x, 540);
      return r > 200 && g > 200 && b > 200;
    });
    const whiteRows = Array.from({ length: info.height }, (_, y) => y).filter((y) => {
      const [r, g, b] = pixelAt(data, info.width, info.channels, 960, y);
      return r > 200 && g > 200 && b > 200;
    });
    const markerWidth = whiteColumns.at(-1)! - whiteColumns[0] + 1;
    const markerHeight = whiteRows.at(-1)! - whiteRows[0] + 1;
    expect(markerWidth).toBeGreaterThanOrEqual(265);
    expect(markerWidth).toBeLessThanOrEqual(275);
    expect(Math.abs(markerWidth - markerHeight)).toBeLessThanOrEqual(4);
    expect((await readdir(join(projectDirectory, "assets"))).filter((name) => name.startsWith("."))).toEqual([]);
  }, 120_000);

  it("系统 PATH 中的媒体工具不可用时仍通过 Remotion 平台二进制完成转码", async () => {
    const { projectDirectory, sourceDirectory, server, sessionId } = await startServer();
    const source = join(sourceDirectory, "remotion-only-hevc.mp4");
    await fixture(source, [
      "-f", "lavfi", "-i", "color=c=0x20C060:s=320x240:r=24:d=0.2",
      "-c:v", "libx265", "-pix_fmt", "yuv420p10le",
      "-x265-params", "log-level=error:pools=1",
    ]);
    const poisonedPath = join(sourceDirectory, "poisoned-path");
    await mkdir(poisonedPath);
    const previousPath = process.env.PATH;
    process.env.PATH = poisonedPath;
    let job: Record<string, any>;
    try {
      job = await importVideo(server, sessionId, source);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }

    expect(job, job.error?.message).toMatchObject({
      status: "succeeded",
      result: { facts: { mode: "transcode" } },
    });
    const output = join(projectDirectory, ...job.result.asset.path.split("/"));
    const outputProbe = await probeVideoFile(output);
    expect(() => assertNormalizedVideoProbe(outputProbe)).not.toThrow();
  }, 120_000);

  it.each([
    ["多视频轨", "multi.mp4", [
      "-f", "lavfi", "-i", "color=c=red:s=64x64:r=30:d=0.1",
      "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=30:d=0.1",
      "-map", "0:v", "-map", "1:v", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]],
    ["不支持编码", "vp9.mp4", [
      "-f", "lavfi", "-i", "color=c=red:s=64x64:r=30:d=0.1",
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p",
    ]],
    ["HDR", "hdr.mp4", [
      "-f", "lavfi", "-i", "color=c=red:s=64x64:r=30:d=0.1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
    ]],
  ] as const)("按真实媒体内容拒绝%s", async (_label, name, args) => {
    const { sourceDirectory, server, sessionId } = await startServer();
    const source = join(sourceDirectory, name);
    await fixture(source, [...args]);
    const job = await importVideo(server, sessionId, source);
    expect(job.status).toBe("failed");
    expect(job.error?.code).toMatch(/VIDEO_/);
  }, 30_000);
});

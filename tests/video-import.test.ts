import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { startNarracutServer, type RunningServer } from "../src/server/server";
import { assertNormalizedVideoProbe, probeVideoFile } from "../src/server/video-media";

const execFileAsync = promisify(execFile);
const runningServers: RunningServer[] = [];
const sceneId = "80000000-0000-4000-8000-000000000001";

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
    await fixture(base, [
      "-f", "lavfi", "-i", "testsrc2=s=320x240:r=15:d=0.2",
      "-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=0.2",
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
    expect((await readdir(join(projectDirectory, "assets"))).filter((name) => name.startsWith("."))).toEqual([]);
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

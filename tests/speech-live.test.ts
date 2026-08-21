import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

import { startNarracutServer, type RunningServer } from "../src/server/server";

const execFileAsync = promisify(execFile);
const apiKey = process.env.TOKENDANCE_API_KEY;
const sceneId = "8c000000-0000-4000-8000-000000000001";
const sessionId = "speech-live-session";
let server: RunningServer | undefined;

afterAll(async () => {
  await server?.close();
});

const describeLive = apiKey === undefined ? describe.skip : describe.sequential;

describeLive("TokenDance Speech 真实请求", () => {
  it("串行生成最少中文样本，并验证 API 与本地容器时长", async () => {
    const root = await mkdtemp(join(tmpdir(), "narracut-speech-live-"));
    const projectDirectory = join(root, "project");
    const staticDirectory = join(root, "client");
    await mkdir(projectDirectory);
    await mkdir(staticDirectory);
    await writeFile(
      join(projectDirectory, "project.json"),
      '{"schemaVersion":3,"metadata":{},"assets":[],"scenes":[]}\n',
    );
    await writeFile(join(staticDirectory, "index.html"), "<main>Narracut</main>");
    server = await startNarracutServer({
      projectDirectory,
      staticDirectory,
      host: "127.0.0.1",
      initialPort: 0,
      environment: { TOKENDANCE_API_KEY: apiKey },
    });
    const lease = await fetch(`${server.url}/api/project/lease`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    expect(lease.status).toBe(200);
    const create = await fetch(`${server.url}/api/jobs/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narracut-session-id": sessionId,
      },
      body: JSON.stringify({
        sceneId,
        narrationText: "Narracut Speech 自动化验收。",
      }),
    });
    expect(create.status).toBe(202);
    const { job: created } = (await create.json()) as { job: { id: string } };
    let job: {
      status: string;
      error?: { code: string; message: string; retryable: boolean };
      result?: {
        speech: { path: string; durationMs: number };
        facts: { containerDurationMs: number };
      };
    } | undefined;
    await expect.poll(async () => {
      const response = await fetch(`${server!.url}/api/jobs/${created.id}`);
      job = await response.json() as typeof job;
      return job?.status;
    }, { timeout: 30_000 }).toMatch(/^(succeeded|failed)$/u);

    if (job?.status === "failed") {
      const category = job.error?.retryable
        ? "瞬时网络或限流错误"
        : "协议、鉴权、模型或响应结构错误";
      throw new Error(`${category}：${job.error?.code ?? "UNKNOWN"} · ${job.error?.message ?? "未知错误"}`);
    }
    const currentProject = await fetch(`${server.url}/api/project`);
    const commit = await fetch(`${server.url}/api/jobs/${created.id}/commit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narracut-session-id": sessionId,
        "if-match": currentProject.headers.get("etag")!,
      },
      body: JSON.stringify({
        schemaVersion: 3,
        metadata: {},
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
          narration: { text: "Narracut Speech 自动化验收。" },
          speech: job!.result!.speech,
          visual: { type: "card", title: "真实 Speech 验收" },
          transition: "cut",
        }],
      }),
    });
    expect(commit.status).toBe(200);
    expect(job?.result?.speech.durationMs).toBe(job?.result?.facts.containerDurationMs);
    const speechFile = join(projectDirectory, job!.result!.speech.path);
    expect((await readFile(speechFile)).byteLength).toBeGreaterThan(1_000);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      speechFile,
    ]);
    expect(Math.round(Number(stdout.trim()) * 1_000))
      .toBe(job?.result?.speech.durationMs);
  });
});

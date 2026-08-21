import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { startNarracutServer, type RunningServer } from "../src/server/server";
import { SpeechGenerationJobs } from "../src/server/speech-generation-jobs";

const execFileAsync = promisify(execFile);
const sceneId = "8a000000-0000-4000-8000-000000000001";
const sessionId = "speech-generation-session";
const narrationText = "请确认样本架已经放置到位。";
const expectedDurationMs = 468;
const runningServers: RunningServer[] = [];
let providerAudio: Buffer;

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "narracut-speech-fixture-"));
  const audioFile = join(root, "speech.mp3");
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
    audioFile,
  ]);
  providerAudio = await readFile(audioFile);
});

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
});

async function startServer(ttsFetch: typeof fetch) {
  const root = await mkdtemp(join(tmpdir(), "narracut-speech-generation-"));
  const projectDirectory = join(root, "project");
  const staticDirectory = join(root, "client");
  await mkdir(projectDirectory);
  await mkdir(staticDirectory);
  await writeFile(
    join(projectDirectory, "project.json"),
    '{"schemaVersion":3,"metadata":{},"assets":[],"scenes":[]}\n',
  );
  await writeFile(join(staticDirectory, "index.html"), "<main>Narracut</main>");
  const server = await startNarracutServer({
    projectDirectory,
    staticDirectory,
    host: "127.0.0.1",
    initialPort: 0,
    ttsFetch,
    environment: { TOKENDANCE_API_KEY: "fake-test-key" },
  });
  runningServers.push(server);
  const lease = await fetch(`${server.url}/api/project/lease`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  expect(lease.status).toBe(200);
  return { projectDirectory, server };
}

async function waitForTerminalJob(
  server: RunningServer,
  jobId: string,
  expectedStatus: "succeeded" | "failed" | "cancelled" = "succeeded",
) {
  let job: Record<string, unknown> | undefined;
  await expect.poll(async () => {
    const response = await fetch(`${server.url}/api/jobs/${jobId}`);
    job = (await response.json()) as Record<string, unknown>;
    return job.status;
  }, { timeout: 5_000 }).toBe(expectedStatus);
  return job!;
}

async function commitPreparedJob(
  server: RunningServer,
  jobId: string,
  speech: Record<string, unknown>,
): Promise<void> {
  const current = await fetch(`${server.url}/api/project`);
  const response = await fetch(`${server.url}/api/jobs/${jobId}/commit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-narracut-session-id": sessionId,
      "if-match": current.headers.get("etag")!,
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
        narration: { text: narrationText },
        speech,
        visual: { type: "card", title: "Speech 测试" },
        transition: "cut",
      }],
    }),
  });
  expect(response.status).toBe(200);
}

describe.sequential("Speech 生成 Job", () => {
  it("通过固定 MiniMax T2A 协议生成并原子发布可解码 Speech", async () => {
    const providerRequests: Array<{ url: string; authorization: string; body: unknown }> = [];
    const ttsFetch: typeof fetch = async (input, init) => {
      providerRequests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization") ?? "",
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({
        data: { audio: providerAudio.toString("hex") },
        extra_info: { audio_length: expectedDurationMs, audio_format: "mp3" },
        base_resp: { status_code: 0, status_msg: "success" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const { projectDirectory, server } = await startServer(ttsFetch);

    const create = await fetch(`${server.url}/api/jobs/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narracut-session-id": sessionId,
      },
      body: JSON.stringify({ sceneId, narrationText }),
    });
    expect(create.status).toBe(202);
    const created = (await create.json()) as { job: { id: string } };
    const job = await waitForTerminalJob(server, created.job.id);
    const duplicate = await fetch(`${server.url}/api/jobs/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narracut-session-id": sessionId,
      },
      body: JSON.stringify({ sceneId, narrationText }),
    });
    expect(duplicate.status).toBe(409);
    await commitPreparedJob(
      server,
      created.job.id,
      (job.result as { speech: Record<string, unknown> }).speech,
    );

    expect(providerRequests).toEqual([{
      url: "https://tokendance.space/gateway/minimax/v1/t2a_v2",
      authorization: "Bearer fake-test-key",
      body: {
        model: "minimax-speech-2.8-turbo",
        text: narrationText,
        stream: false,
        voice_setting: {
          voice_id: "Chinese (Mandarin)_News_Anchor",
          speed: 1,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1,
        },
      },
    }]);
    expect(job).toMatchObject({
      type: "speech-generation",
      sceneId,
      status: "succeeded",
      stage: "prepared",
      result: {
        speech: {
          path: `speech/${sceneId}.mp3`,
          durationMs: expectedDurationMs,
          ttsProfileId: "narracut-mandarin-news-v1",
        },
        facts: { fileRevision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u) },
      },
    });
    expect(await readFile(join(projectDirectory, "speech", `${sceneId}.mp3`)))
      .toEqual(providerAudio);
    await expect(readFile(join(projectDirectory, "project.json"), "utf8").then(JSON.parse))
      .resolves.toMatchObject({ scenes: [{ speech: { path: `speech/${sceneId}.mp3` } }] });
    expect(JSON.stringify(job)).not.toContain("fake-test-key");
    await expect(
      fetch(`${server.url}/api/jobs/${created.job.id}`).then((response) => response.json()),
    ).resolves.toMatchObject({ status: "succeeded", stage: "completed" });

    const revisions = await fetch(`${server.url}/api/speech/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: [`speech/${sceneId}.mp3`] }),
    });
    expect(revisions.status).toBe(200);
    await expect(revisions.json()).resolves.toEqual({
      results: [{
        path: `speech/${sceneId}.mp3`,
        exists: true,
        revision: (job.result as { facts: { fileRevision: string } }).facts.fileRevision,
      }],
    });
  });

  it("鉴权失败明确分类，且重新生成失败不清除旧 Speech 文件", async () => {
    const ttsFetch: typeof fetch = async () =>
      new Response(JSON.stringify({
        base_resp: { status_code: 1004, status_msg: "invalid api key" },
      }), { status: 401, headers: { "content-type": "application/json" } });
    const { projectDirectory, server } = await startServer(ttsFetch);
    const speechDirectory = join(projectDirectory, "speech");
    await mkdir(speechDirectory);
    const speechFile = join(speechDirectory, `${sceneId}.mp3`);
    await writeFile(speechFile, providerAudio);

    const create = await fetch(`${server.url}/api/jobs/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narracut-session-id": sessionId,
      },
      body: JSON.stringify({ sceneId, narrationText }),
    });
    const created = (await create.json()) as { job: { id: string } };
    const job = await waitForTerminalJob(server, created.job.id, "failed");

    expect(job).toMatchObject({
      status: "failed",
      error: {
        code: "TTS_AUTH_FAILED",
        retryable: false,
      },
    });
    expect(await readFile(speechFile)).toEqual(providerAudio);
    expect(JSON.stringify(job)).not.toContain("invalid api key");
  });

  it("取消进行中的请求后保留旧 Speech，且同一 Scene 不并发生成", async () => {
    const ttsFetch: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    const { projectDirectory, server } = await startServer(ttsFetch);
    const speechDirectory = join(projectDirectory, "speech");
    await mkdir(speechDirectory);
    const speechFile = join(speechDirectory, `${sceneId}.mp3`);
    await writeFile(speechFile, providerAudio);
    const request = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narracut-session-id": sessionId,
      },
      body: JSON.stringify({ sceneId, narrationText }),
    } satisfies RequestInit;

    const first = await fetch(`${server.url}/api/jobs/speech`, request);
    const created = (await first.json()) as { job: { id: string } };
    const concurrent = await fetch(`${server.url}/api/jobs/speech`, request);
    expect(concurrent.status).toBe(409);
    const cancel = await fetch(`${server.url}/api/jobs/${created.job.id}`, {
      method: "DELETE",
      headers: { "x-narracut-session-id": sessionId },
    });
    expect(cancel.status).toBe(200);
    await waitForTerminalJob(server, created.job.id, "cancelled");
    expect(await readFile(speechFile)).toEqual(providerAudio);
  });

  it("429 按瞬时错误重试，耗尽后与协议错误明确区分", async () => {
    let attempts = 0;
    const ttsFetch: typeof fetch = async () => {
      attempts += 1;
      return new Response(JSON.stringify({
        base_resp: { status_code: 1002, status_msg: "rate limit exceeded" },
      }), { status: 429, headers: { "content-type": "application/json" } });
    };
    const { server } = await startServer(ttsFetch);
    const create = await fetch(`${server.url}/api/jobs/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narracut-session-id": sessionId,
      },
      body: JSON.stringify({ sceneId, narrationText }),
    });
    const created = (await create.json()) as { job: { id: string } };
    const job = await waitForTerminalJob(server, created.job.id, "failed");

    expect(attempts).toBe(3);
    expect(job).toMatchObject({
      error: {
        code: "TTS_RATE_LIMITED",
        retryable: true,
      },
    });
  });

  it("HTTP 200 的业务限流仍会重试，半开连接按网络超时失败", async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-speech-errors-"));
    let attempts = 0;
    const limited = new SpeechGenerationJobs(projectDirectory, {
      apiKey: "fake-test-key",
      retryDelaysMs: [0, 0],
      fetchImpl: async () => {
        attempts += 1;
        return Response.json({
          base_resp: { status_code: 1002, status_msg: "rate limit exceeded" },
        });
      },
    });
    const limitedJob = limited.create({ sceneId, narrationText });
    await expect.poll(() => limited.get(limitedJob.id)?.status).toBe("failed");
    expect(attempts).toBe(3);
    expect(limited.get(limitedJob.id)?.error).toMatchObject({
      code: "TTS_RATE_LIMITED",
      retryable: true,
    });

    const timedOut = new SpeechGenerationJobs(projectDirectory, {
      apiKey: "fake-test-key",
      retryDelaysMs: [],
      requestTimeoutMs: 5,
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    });
    const timeoutJob = timedOut.create({
      sceneId: "8a000000-0000-4000-8000-000000000002",
      narrationText,
    });
    await expect.poll(() => timedOut.get(timeoutJob.id)?.status).toBe("failed");
    expect(timedOut.get(timeoutJob.id)?.error).toMatchObject({
      code: "TTS_NETWORK_ERROR",
      retryable: true,
    });
  });

  it("进入原子提交点后不再伪装取消，监听器异常也不反转落盘结果", async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), "narracut-speech-commit-"));
    const jobs = new SpeechGenerationJobs(projectDirectory, {
      apiKey: "fake-test-key",
      fetchImpl: async () => Response.json({
        data: { audio: providerAudio.toString("hex") },
        extra_info: { audio_length: expectedDurationMs, audio_format: "mp3" },
        base_resp: { status_code: 0, status_msg: "success" },
      }),
    });
    let jobId = "";
    jobs.subscribe((job) => {
      if (job.stage === "finalizing") jobs.cancel(jobId);
      throw new Error("模拟已断开的 SSE 监听器");
    });

    const created = jobs.create({ sceneId, narrationText });
    jobId = created.id;
    await expect.poll(() => jobs.get(jobId)?.status, { timeout: 5_000 })
      .toBe("succeeded");
    await jobs.commit(jobId);
    await jobs.acknowledge(jobId);
    expect(await readFile(join(projectDirectory, "speech", `${sceneId}.mp3`)))
      .toEqual(providerAudio);
  });

  it("准备完成但前提过期时只丢弃 staged 文件，不覆盖 canonical Speech", async () => {
    const ttsFetch: typeof fetch = async () => Response.json({
      data: { audio: providerAudio.toString("hex") },
      extra_info: { audio_length: expectedDurationMs, audio_format: "mp3" },
      base_resp: { status_code: 0, status_msg: "success" },
    });
    const { projectDirectory, server } = await startServer(ttsFetch);
    const speechDirectory = join(projectDirectory, "speech");
    await mkdir(speechDirectory);
    const speechFile = join(speechDirectory, `${sceneId}.mp3`);
    const previousCanonical = Buffer.from("previous canonical speech");
    await writeFile(speechFile, previousCanonical);

    const create = await fetch(`${server.url}/api/jobs/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narracut-session-id": sessionId,
      },
      body: JSON.stringify({ sceneId, narrationText }),
    });
    const created = (await create.json()) as { job: { id: string } };
    await waitForTerminalJob(server, created.job.id);
    expect(await readFile(speechFile)).toEqual(previousCanonical);

    const discard = await fetch(`${server.url}/api/jobs/${created.job.id}/discard`, {
      method: "POST",
      headers: { "x-narracut-session-id": sessionId },
    });
    expect(discard.status).toBe(200);
    expect(await readFile(speechFile)).toEqual(previousCanonical);

    const second = await fetch(`${server.url}/api/jobs/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narracut-session-id": sessionId,
      },
      body: JSON.stringify({ sceneId, narrationText }),
    });
    expect(second.status).toBe(202);
    const secondJob = (await second.json()) as { job: { id: string } };
    await waitForTerminalJob(server, secondJob.job.id);
    const recover = await fetch(`${server.url}/api/jobs/speech/recover`, {
      method: "POST",
      headers: { "x-narracut-session-id": sessionId },
    });
    expect(recover.status).toBe(200);
    await expect(recover.json()).resolves.toMatchObject({
      jobs: [{ id: secondJob.job.id, status: "cancelled" }],
    });
    const afterRecovery = await fetch(`${server.url}/api/jobs/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narracut-session-id": sessionId,
      },
      body: JSON.stringify({ sceneId, narrationText }),
    });
    expect(afterRecovery.status).toBe(202);
    const thirdJob = (await afterRecovery.json()) as { job: { id: string } };
    await fetch(`${server.url}/api/jobs/${thirdJob.job.id}`, {
      method: "DELETE",
      headers: { "x-narracut-session-id": sessionId },
    });
  });
});

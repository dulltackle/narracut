import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RenderWorkerHandle, RenderWorkerInput } from "../src/server/render-jobs";
import { startNarracutServer, type RunningServer } from "../src/server/server";
import type { Project } from "../src/shared/project";

const runningServers: RunningServer[] = [];
const sceneId = "31000000-0000-4000-8000-000000000002";
const sessionId = "render-api-session";

class FakeWorker extends EventEmitter implements RenderWorkerHandle {
  kill(): boolean {
    this.emit("exit", null, "SIGTERM");
    return true;
  }
}

function project(name: string, withSpeech = true): Project {
  return {
    schemaVersion: 3,
    metadata: { name },
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
      narration: { text: "从前端内存直接渲染" },
      ...(withSpeech ? {
        speech: {
          path: `speech/${sceneId}.mp3`,
          durationMs: 100,
          sourceTextHash: "sha256:a8f90aed4cdb5d17ad86765c85b097930ef3fbf97d7e0f81539adcd87075ae47",
          ttsProfileId: "narracut-mandarin-news-v1" as const,
        },
      } : {}),
      visual: { type: "card", title: "Render API" },
      transition: "cut",
    }],
  };
}

async function setup(worker: FakeWorker, onOpen?: (directory: string) => void) {
  const root = await mkdtemp(join(tmpdir(), "narracut-render-api-"));
  const projectDirectory = join(root, "project");
  const staticDirectory = join(root, "client");
  await mkdir(join(projectDirectory, "speech"), { recursive: true });
  await mkdir(staticDirectory, { recursive: true });
  await writeFile(join(projectDirectory, "project.json"), `${JSON.stringify(project("磁盘版本"))}\n`);
  await writeFile(
    join(projectDirectory, "speech", `${sceneId}.mp3`),
    await readFile(resolve("fixtures/demo/speech/20000000-0000-4000-8000-000000000001.mp3")),
  );
  await writeFile(join(staticDirectory, "index.html"), "<main>Narracut</main>");
  let workerInput: RenderWorkerInput | undefined;
  const server = await startNarracutServer({
    projectDirectory,
    staticDirectory,
    host: "127.0.0.1",
    initialPort: 0,
    renderWorkerFactory: (input) => {
      workerInput = input;
      return worker;
    },
    openDirectory: async (directory) => onOpen?.(directory),
  });
  runningServers.push(server);
  const renewLease = async () => {
    const lease = await fetch(`${server.url}/api/project/lease`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    expect(lease.status).toBe(200);
  };
  await renewLease();
  return {
    projectDirectory,
    server,
    getWorkerInput: () => workerInput,
    renewLease,
  };
}

const renderHeaders = {
  "content-type": "application/json",
  "x-narracut-session-id": sessionId,
};

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
});

async function readSseEvent(response: Response, eventName: string): Promise<unknown> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`SSE 在 ${eventName} 前结束。`);
      buffered += decoder.decode(value, { stream: true });
      const blocks = buffered.split("\n\n");
      buffered = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = block.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
        const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        if (event === eventName && data !== undefined) return JSON.parse(data);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

describe("Render API", () => {
  it("拒绝 Render-ready 阻断，但 warning 不阻止从完整内存 DSL 创建 Job", async () => {
    const worker = new FakeWorker();
    const { server, getWorkerInput, renewLease } = await setup(worker);
    const blocked = await fetch(`${server.url}/api/jobs/render`, {
      method: "POST",
      headers: renderHeaders,
      body: JSON.stringify(project("缺少 Speech", false)),
    });
    expect(blocked.status).toBe(422);
    expect(await blocked.text()).toContain("缺少 Speech");

    const memoryProject = project("点击时内存版本");
    memoryProject.theme.accentColor = "#0F172A";
    const created = await fetch(`${server.url}/api/jobs/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narracut-session-id": sessionId,
        "x-narracut-snapshot-source": "unsaved",
      },
      body: JSON.stringify(memoryProject),
    });
    expect(created.status).toBe(202);
    const { job } = await created.json() as { job: { id: string; artifacts: { snapshot: string } } };
    expect(JSON.parse(await readFile(job.artifacts.snapshot, "utf8"))).toEqual(memoryProject);
    expect(getWorkerInput()?.snapshotFile).toBe(job.artifacts.snapshot);
    expect(getWorkerInput()?.mediaBaseUrl).toMatch(
      new RegExp(`^${server.url.replaceAll(".", "\\.")}/media/`),
    );

    const duplicate = await fetch(`${server.url}/api/jobs/render`, {
      method: "POST",
      headers: renderHeaders,
      body: JSON.stringify(memoryProject),
    });
    expect(duplicate.status).toBe(409);

    await renewLease();
    const cancelled = await fetch(`${server.url}/api/jobs/${job.id}`, {
      method: "DELETE",
      headers: { "x-narracut-session-id": sessionId },
    });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ status: "cancelled" });
  });

  it("完成后可通过受约束入口打开该 Job 的产物目录", async () => {
    const worker = new FakeWorker();
    let opened: string | undefined;
    const { server, renewLease } = await setup(worker, (directory) => { opened = directory; });
    const response = await fetch(`${server.url}/api/jobs/render`, {
      method: "POST",
      headers: renderHeaders,
      body: JSON.stringify(project("完成")),
    });
    const { job } = await response.json() as { job: { id: string; artifacts: { directory: string } } };
    worker.emit("message", { type: "completed", durationInFrames: 3 });

    await renewLease();
    const openedResponse = await fetch(`${server.url}/api/jobs/${job.id}/open-output`, {
      method: "POST",
      headers: { "x-narracut-session-id": sessionId },
    });

    expect(openedResponse.status).toBe(204);
    expect(opened).toBe(job.artifacts.directory);
  });

  it("拒绝没有编辑租约或 JSON content-type 的渲染副作用", async () => {
    const worker = new FakeWorker();
    const { server } = await setup(worker);
    const noSession = await fetch(`${server.url}/api/jobs/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(project("无租约")),
    });
    expect(noSession.status).toBe(423);

    const wrongType = await fetch(`${server.url}/api/jobs/render`, {
      method: "POST",
      headers: { "x-narracut-session-id": sessionId },
      body: JSON.stringify(project("错误类型")),
    });
    expect(wrongType.status).toBe(415);
  });

  it("SSE 每次重连先返回当前快照，并在 worker 完成后给出确定终态", async () => {
    const worker = new FakeWorker();
    const { server } = await setup(worker);
    const response = await fetch(`${server.url}/api/jobs/render`, {
      method: "POST",
      headers: renderHeaders,
      body: JSON.stringify(project("SSE 重连")),
    });
    const { job } = await response.json() as { job: { id: string } };

    const firstSnapshot = await readSseEvent(
      await fetch(`${server.url}/api/jobs/events`),
      "snapshot",
    ) as Array<{ id: string; status: string }>;
    expect(firstSnapshot).toContainEqual(expect.objectContaining({ id: job.id, status: "processing" }));

    worker.emit("message", { type: "progress", stage: "encoding", progress: 0.42 });
    const reconnectedSnapshot = await readSseEvent(
      await fetch(`${server.url}/api/jobs/events`),
      "snapshot",
    ) as Array<{ id: string; progress?: number }>;
    expect(reconnectedSnapshot).toContainEqual(expect.objectContaining({ id: job.id, progress: 0.42 }));

    worker.emit("message", { type: "completed", durationInFrames: 3 });
    const terminalSnapshot = await readSseEvent(
      await fetch(`${server.url}/api/jobs/events`),
      "snapshot",
    ) as Array<{ id: string; status: string }>;
    expect(terminalSnapshot).toContainEqual(expect.objectContaining({ id: job.id, status: "succeeded" }));
  });
});

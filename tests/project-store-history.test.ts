import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectStore } from "../src/client/project-store";
import type { Project, Speech } from "../src/shared/project";

const sceneId = "91000000-0000-4000-8000-000000000001";
const imageAssetId = "91000000-0000-4000-8000-000000000002";
const importedAssetId = "91000000-0000-4000-8000-000000000003";

function projectFixture(): Project {
  return {
    schemaVersion: 3,
    metadata: {},
    theme: {
      presetId: "narracut/default@1",
      defaultTextStyleId: "narracut/panel@1",
      defaultTextMotionId: "narracut/fade@1",
      accentColor: "#00A3A6",
      fontId: "narracut/noto-sans-cjk-sc@1",
    },
    assets: [
      { id: imageAssetId, kind: "image", path: `assets/${imageAssetId}.png` },
    ],
    scenes: [
      {
        id: sceneId,
        narration: { text: "原始旁白" },
        visual: { type: "image" },
        transition: "cut",
      },
    ],
  };
}

function externalProjectFixture(): Project {
  const project = projectFixture();
  return {
    ...project,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      narration: { text: "外部版本旁白" },
    })),
  };
}

function projectLoadResponse(url: string, init?: RequestInit): Response {
  if (url.endsWith("/api/project") && init?.method !== "PUT") {
    return new Response(JSON.stringify(externalProjectFixture()), {
      headers: { etag: '"history-test-etag"' },
    });
  }
  if (url.endsWith("/api/project/lease")) {
    return Response.json({ status: "acquired", expiresAt: Date.now() + 8_000 });
  }
  if (url.endsWith("/api/project-info")) {
    return Response.json({
      projectDirectory: "/tmp/narracut-history-test",
      projectFile: "/tmp/narracut-history-test/project.json",
      fallbackName: "narracut-history-test",
    });
  }
  if (url.endsWith("/api/assets/probe")) {
    return Response.json({ results: [] });
  }
  return new Response(null, {
    status: 204,
    headers: { etag: '"history-test-next-etag"' },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
  useProjectStore.getState().endTextTransaction();
  useProjectStore.setState({
    phase: "ready",
    project: projectFixture(),
    diagnostics: [],
    selectedSceneId: sceneId,
    saveStatus: "saved",
    saveErrorMessage: undefined,
    saveDiagnostics: [],
    dirty: false,
    migrationPending: false,
    leaseStatus: "acquired",
    leaseLostWhileEditing: false,
    externalConflict: undefined,
    conflictResolving: false,
    undoStack: [],
    redoStack: [],
    historyNotice: undefined,
    historyEventId: 0,
    historyFocusRequest: undefined,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Project DSL 事务历史", () => {
  it("保存请求超过 5 秒会中止并进入重试", async () => {
    vi.useFakeTimers();
    let putAttempt = 0;
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (String(input).endsWith("/api/project") && init?.method === "PUT") {
          putAttempt += 1;
          if (putAttempt === 1) {
            return new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener(
                "abort",
                () => reject(init.signal?.reason),
                { once: true },
              );
            });
          }
          return Promise.resolve(
            new Response(null, {
              status: 204,
              headers: { etag: '"timeout-retry-etag"' },
            }),
          );
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const savePromise = useProjectStore
      .getState()
      .updateVisual(sceneId, { type: "image", caption: { text: "超时重试" } });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(useProjectStore.getState().saveStatus).toBe("saving");
    await vi.advanceTimersByTimeAsync(1);
    expect(useProjectStore.getState()).toMatchObject({
      saveStatus: "retrying",
      saveRetryAttempt: 1,
      saveErrorMessage: "写入失败，将在 1 秒后重试。",
      dirty: true,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await savePromise;
    expect(putAttempt).toBe(2);
    expect(useProjectStore.getState()).toMatchObject({
      saveStatus: "saved",
      dirty: false,
    });
  });

  it("超时重试先确认原快照，再保存期间产生的最新 DSL", async () => {
    vi.useFakeTimers();
    const savedCaptions: string[] = [];
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (String(input).endsWith("/api/project") && init?.method === "PUT") {
          const project = JSON.parse(String(init.body)) as Project;
          const visual = project.scenes[0].visual;
          const caption =
            visual.type === "image" || visual.type === "video"
              ? visual.caption?.text
              : undefined;
          savedCaptions.push(caption ?? "");
          if (savedCaptions.length === 1) {
            return new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener(
                "abort",
                () => reject(init.signal?.reason),
                { once: true },
              );
            });
          }
          return Promise.resolve(
            new Response(null, {
              status: 204,
              headers: { etag: `"timeout-retry-${savedCaptions.length}"` },
            }),
          );
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const firstSave = useProjectStore
      .getState()
      .updateVisual(sceneId, { type: "image", caption: { text: "待确认快照" } });
    const latestSave = useProjectStore
      .getState()
      .updateVisual(sceneId, { type: "image", caption: { text: "最新 pending DSL" } });

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all([firstSave, latestSave]);

    expect(savedCaptions).toEqual([
      "待确认快照",
      "待确认快照",
      "最新 pending DSL",
    ]);
    expect(useProjectStore.getState()).toMatchObject({
      saveStatus: "saved",
      dirty: false,
    });
  });

  it("连续四次超时后保留内存 DSL，手动重试可恢复", async () => {
    vi.useFakeTimers();
    let putAttempt = 0;
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (String(input).endsWith("/api/project") && init?.method === "PUT") {
          putAttempt += 1;
          if (putAttempt <= 4) {
            return new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener(
                "abort",
                () => reject(init.signal?.reason),
                { once: true },
              );
            });
          }
          return Promise.resolve(
            new Response(null, {
              status: 204,
              headers: { etag: '"manual-timeout-retry-etag"' },
            }),
          );
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const savePromise = useProjectStore
      .getState()
      .updateVisual(sceneId, { type: "image", caption: { text: "内存保留版本" } });
    await vi.advanceTimersByTimeAsync(27_000);
    await savePromise;

    expect(putAttempt).toBe(4);
    expect(useProjectStore.getState()).toMatchObject({
      saveStatus: "error",
      saveErrorMessage: "本地项目服务超过 5 秒未响应。",
      dirty: true,
    });
    expect(useProjectStore.getState().project?.scenes[0].visual).toMatchObject({
      caption: { text: "内存保留版本" },
    });

    await useProjectStore.getState().retrySave();
    expect(putAttempt).toBe(5);
    expect(useProjectStore.getState()).toMatchObject({
      saveStatus: "saved",
      dirty: false,
    });
  });

  it("Asset 绑定独立成事务，并保存完整不可变快照", async () => {
    await useProjectStore.getState().bindAsset(sceneId, imageAssetId);

    const state = useProjectStore.getState();
    expect(state.project?.scenes[0].visual).toEqual({
      type: "image",
      assetId: imageAssetId,
    });
    expect(state.undoStack).toHaveLength(1);
    expect(state.undoStack[0].label).toBe("绑定 Scene 01 Asset");
    expect(Object.isFrozen(state.undoStack[0].before)).toBe(true);
    expect(Object.isFrozen(state.undoStack[0].after.scenes[0].visual)).toBe(true);

    await state.undo();
    expect(useProjectStore.getState().project?.scenes[0].visual).toEqual({
      type: "image",
    });
  });

  it("只接受请求前提仍成立的 Speech Job 回填", async () => {
    const speech: Speech = {
      path: `speech/${sceneId}.mp3`,
      durationMs: 1500,
      sourceTextHash: `sha256:${"1".repeat(64)}`,
      ttsProfileId: "narracut-mandarin-news-v1",
    };
    const accepted = await useProjectStore.getState().applyJobResult({
      kind: "speech",
      sceneId,
      expected: { narrationText: "原始旁白", speech: undefined },
      speech,
    });

    expect(accepted).toBe(true);
    expect(useProjectStore.getState().project?.scenes[0].speech).toEqual(speech);
    expect(useProjectStore.getState().historyNotice).toBe("Speech 已应用 · 可撤销");

    useProjectStore.getState().updateNarration(sceneId, "后来修改的旁白");
    useProjectStore.getState().endTextTransaction();
    const historySize = useProjectStore.getState().undoStack.length;
    const staleAccepted = await useProjectStore.getState().applyJobResult({
      kind: "speech",
      sceneId,
      expected: { narrationText: "原始旁白", speech: undefined },
      speech,
    });

    expect(staleAccepted).toBe(false);
    expect(useProjectStore.getState().undoStack).toHaveLength(historySize);
    expect(useProjectStore.getState().project?.scenes[0].speech).toBeUndefined();
  });

  it("外部冲突处理期间拒绝 Job 回填与所有 DSL 编辑", async () => {
    const projectBeforeConflict = useProjectStore.getState().project!;
    useProjectStore.setState({
      saveStatus: "conflict",
      conflictResolving: true,
      externalConflict: {
        diskRaw: JSON.stringify(externalProjectFixture()),
        diskEtag: '"external-etag"',
        diskProject: externalProjectFixture(),
        diskSavedCanonical: JSON.stringify(externalProjectFixture()),
        diskDiagnostics: [],
        migrated: false,
      },
    });

    const accepted = await useProjectStore.getState().applyJobResult({
      kind: "speech",
      sceneId,
      expected: { narrationText: "原始旁白", speech: undefined },
      speech: {
        path: `speech/${sceneId}.mp3`,
        durationMs: 1500,
        sourceTextHash: `sha256:${"3".repeat(64)}`,
        ttsProfileId: "narracut-mandarin-news-v1",
      },
    });
    useProjectStore.getState().updateNarration(sceneId, "不应应用的编辑");
    await useProjectStore.getState().undo();

    expect(accepted).toBe(false);
    expect(useProjectStore.getState().project).toBe(projectBeforeConflict);
    expect(useProjectStore.getState().undoStack).toHaveLength(0);
  });

  it("保存级校验失败会阻断 PUT 且不进入 I/O 重试", async () => {
    const invalidProject = {
      ...projectFixture(),
      scenes: [
        {
          ...projectFixture().scenes[0],
          id: "不是稳定 ID",
        },
      ],
    } as Project;
    useProjectStore.setState({ project: invalidProject, dirty: true });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    await useProjectStore.getState().retrySave();

    expect(useProjectStore.getState().saveStatus).toBe("blocked-validation");
    expect(useProjectStore.getState().saveDiagnostics).not.toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Asset Job 以稳定 Scene ID 和 Visual 前提原子回填 catalog 与绑定", async () => {
    const accepted = await useProjectStore.getState().applyJobResult({
      kind: "asset",
      sceneId,
      expected: { visualType: "image", assetId: undefined },
      asset: {
        id: importedAssetId,
        kind: "image",
        path: `assets/${importedAssetId}.png`,
      },
    });

    expect(accepted).toBe(true);
    const project = useProjectStore.getState().project;
    expect(project?.assets).toContainEqual(
      expect.objectContaining({ id: importedAssetId, kind: "image" }),
    );
    expect(project?.scenes[0]).toMatchObject({
      id: sceneId,
      visual: { type: "image", assetId: importedAssetId },
    });
    expect(useProjectStore.getState().historyNotice).toBe("Asset 已应用 · 可撤销");
    expect(useProjectStore.getState().undoStack.at(-1)?.label).toBe(
      "应用 Scene 01 Asset",
    );

    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project?.scenes[0].visual).toEqual({
      type: "image",
    });
    expect(useProjectStore.getState().project?.assets).toContainEqual(
      expect.objectContaining({ id: importedAssetId, kind: "image" }),
    );
  });

  it("失效提案可先登记为未绑定 Asset，清除绑定只形成一次可撤销事务", async () => {
    const imported = {
      id: importedAssetId,
      kind: "image" as const,
      path: `assets/${importedAssetId}.png`,
    };
    expect(await useProjectStore.getState().registerAsset(imported)).toBe(true);
    expect(useProjectStore.getState().undoStack).toHaveLength(0);
    expect(useProjectStore.getState().project?.assets).toContainEqual(imported);

    await useProjectStore.getState().bindAsset(sceneId, importedAssetId);
    expect(await useProjectStore.getState().clearAsset(sceneId)).toBe(true);
    expect(useProjectStore.getState().project?.scenes[0].visual).toEqual({
      type: "image",
    });
    expect(useProjectStore.getState().historyNotice).toBe("已清除绑定 · 可撤销");

    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project?.scenes[0].visual).toEqual({
      type: "image",
      assetId: importedAssetId,
    });
    expect(useProjectStore.getState().project?.assets).toContainEqual(imported);
  });

  it("运行态不进入历史，Undo 回填只写 Project DSL", async () => {
    useProjectStore.setState({
      saveStatus: "saving",
      taskDrawerOpen: true,
      diagnostics: [
        {
          code: "RUNTIME_ONLY_TEST",
          severity: "warning",
          path: [],
          message: "仅用于验证运行态边界",
        },
      ],
    });
    expect(useProjectStore.getState().undoStack).toHaveLength(0);

    const speech: Speech = {
      path: `speech/${sceneId}.mp3`,
      durationMs: 1500,
      sourceTextHash: `sha256:${"2".repeat(64)}`,
      ttsProfileId: "narracut-mandarin-news-v1",
    };
    await useProjectStore.getState().applyJobResult({
      kind: "speech",
      sceneId,
      expected: { narrationText: "原始旁白", speech: undefined },
      speech,
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    await useProjectStore.getState().undo();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/project",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(useProjectStore.getState().project?.scenes[0].speech).toBeUndefined();
  });

  it("最多保留最近 100 个完整事务", () => {
    for (let index = 1; index <= 101; index += 1) {
      useProjectStore.getState().updateNarration(sceneId, `旁白 ${index}`);
      useProjectStore.getState().endTextTransaction();
    }

    const history = useProjectStore.getState().undoStack;
    expect(history).toHaveLength(100);
    expect(history[0].before.scenes[0].narration.text).toBe("旁白 1");
    expect(history.at(-1)?.after.scenes[0].narration.text).toBe("旁白 101");
  });

  it("重新加载会取消尚未入队的 Narration debounce", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      projectLoadResponse(String(input), init),
    );
    vi.stubGlobal("fetch", fetchMock);
    useProjectStore.getState().updateNarration(sceneId, "不应越过加载边界");

    await useProjectStore.getState().load();
    await vi.advanceTimersByTimeAsync(600);

    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(0);
    expect(useProjectStore.getState().project?.scenes[0].narration.text).toBe(
      "外部版本旁白",
    );
    expect(useProjectStore.getState().undoStack).toHaveLength(0);
    vi.useRealTimers();
  });

  it("重新加载会等待在途 PUT 完成后再读取新 DSL", async () => {
    const events: string[] = [];
    let finishPut: (() => void) | undefined;
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/project") && init?.method === "PUT") {
          events.push("put:start");
          await new Promise<void>((resolve) => {
            finishPut = resolve;
          });
          events.push("put:end");
          return new Response(null, { status: 204 });
        }
        if (url.endsWith("/api/project") && init?.method !== "PUT") {
          events.push("get:project");
        }
        return projectLoadResponse(url, init);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const savePromise = useProjectStore
      .getState()
      .updateVisual(sceneId, { type: "image", caption: { text: "在途保存" } });
    await vi.waitFor(() => expect(events).toEqual(["put:start"]));

    const loadPromise = useProjectStore.getState().load();
    await Promise.resolve();
    expect(events).toEqual(["put:start"]);

    finishPut?.();
    await savePromise;
    await loadPromise;
    expect(events).toEqual(["put:start", "put:end", "get:project"]);
    expect(useProjectStore.getState().project?.scenes[0].narration.text).toBe(
      "外部版本旁白",
    );
    expect(useProjectStore.getState().undoStack).toHaveLength(0);
  });
});

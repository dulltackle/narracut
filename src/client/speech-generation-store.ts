import { create } from "zustand";

import type { SpeechGenerationJob } from "../shared/jobs";
import {
  CURRENT_TTS_PROFILE_ID,
  type Speech,
} from "../shared/project";
import { createClientUuid } from "./client-uuid";
import { getProjectSessionId, useProjectStore } from "./project-store";

type SpeechResolution =
  | "applied"
  | "scene-deleted"
  | "narration-changed"
  | "profile-changed"
  | "speech-changed"
  | "apply-failed";

export type ClientSpeechGenerationJob = SpeechGenerationJob & {
  expected: {
    narrationText: string;
    speech: Speech | undefined;
    ttsProfileId: typeof CURRENT_TTS_PROFILE_ID;
  };
  resolution?: SpeechResolution;
  handlingResult?: boolean;
  cancelError?: string;
};

type SpeechGenerationState = {
  jobs: Record<string, ClientSpeechGenerationJob>;
  announcement: string;
  connected: boolean;
  connect: () => () => void;
  startGeneration: (sceneId: string) => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
  retry: (jobId: string) => Promise<void>;
};

const startingScenes = new Set<string>();
let recoveryPromise: Promise<void> | undefined;
const SPEECH_CLEANUP_REQUEST_TIMEOUT_MS = 2_000;

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function discardPreparedJob(jobId: string): Promise<boolean> {
  for (const delayMs of [0, 150, 450]) {
    if (delayMs > 0) {
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, delayMs));
    }
    try {
      const response = await fetchWithTimeout(
        `/api/jobs/${jobId}/discard`,
        {
          method: "POST",
          headers: { "x-narracut-session-id": getProjectSessionId() },
        },
        SPEECH_CLEANUP_REQUEST_TIMEOUT_MS,
      );
      if (response.ok || response.status === 404 || response.status === 409) {
        return true;
      }
    } catch {
      // 短暂的本地服务连接失败会在下一轮重试。
    }
  }
  return false;
}

export const speechGenerationStageCopy: Record<
  SpeechGenerationJob["stage"],
  string
> = {
  waiting: "等待生成",
  requesting: "正在生成",
  validating: "正在校验 Speech",
  prepared: "等待安全应用",
  finalizing: "正在写入项目",
  completed: "Speech 生成完成",
  cancelling: "正在取消",
  cancelled: "已取消",
  failed: "Speech 生成失败",
};

function sameSpeech(left: Speech | undefined, right: Speech | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function activeForScene(
  jobs: Record<string, ClientSpeechGenerationJob>,
  sceneId: string,
): boolean {
  return Object.values(jobs).some(
    (job) =>
      job.sceneId === sceneId &&
      (job.status === "queued" ||
        job.status === "processing" ||
        job.status === "cancelling" ||
        (job.status === "succeeded" &&
          job.resolution === undefined &&
          (job.handlingResult === true ||
            job.stage === "prepared" ||
            job.stage === "finalizing"))),
  );
}

async function handleSucceeded(jobId: string): Promise<void> {
  const job = useSpeechGenerationStore.getState().jobs[jobId];
  if (job?.result === undefined || job.resolution !== undefined) return;
  const projectState = useProjectStore.getState();
  const scene = projectState.project?.scenes.find(
    (candidate) => candidate.id === job.sceneId,
  );
  let resolution: SpeechResolution | undefined;
  if (scene === undefined) {
    resolution = "scene-deleted";
  } else if (scene.narration.text !== job.expected.narrationText) {
    resolution = "narration-changed";
  } else if (job.result.speech.ttsProfileId !== job.expected.ttsProfileId) {
    resolution = "profile-changed";
  } else if (!sameSpeech(scene.speech, job.expected.speech)) {
    resolution = "speech-changed";
  }
  if (resolution === undefined) {
    try {
      const applied = await projectState.applyJobResult({
          kind: "speech",
          jobId: job.id,
          sceneId: job.sceneId,
          expected: {
            narrationText: job.expected.narrationText,
            speech: job.expected.speech,
          },
          speech: job.result.speech,
          fileRevision: job.result.facts.fileRevision,
        });
      resolution = applied ? "applied" : "apply-failed";
    } catch {
      resolution = "apply-failed";
    }
  }
  if (resolution !== "applied") {
    const discarded = await discardPreparedJob(job.id);
    if (!discarded) {
      useSpeechGenerationStore.setState({
        announcement: "旧任务结果未应用，但 staged Speech 暂时无法清理；重新打开项目会自动恢复",
      });
    }
  }
  const settledResolution = resolution ?? "apply-failed";
  const announcement =
    settledResolution === "applied"
      ? "Speech 已生成并应用"
      : settledResolution === "scene-deleted"
        ? "Speech 已生成，但目标 Scene 已删除，结果未应用"
        : settledResolution === "narration-changed"
          ? "Narration 已改变，旧任务结果未应用"
          : settledResolution === "profile-changed"
            ? "TTS profile 已改变，旧任务结果未应用"
          : settledResolution === "speech-changed"
            ? "当前 Speech 已改变，旧任务结果未应用"
            : "Speech 已落盘，但无法更新 Project DSL";
  useSpeechGenerationStore.setState((state) => ({
    jobs: {
      ...state.jobs,
      [jobId]: {
        ...state.jobs[jobId],
        resolution: settledResolution,
        handlingResult: false,
      },
    },
    announcement,
  }));
  if (settledResolution !== "applied") {
    useProjectStore.getState().setTaskDrawerOpen(true);
  }
}

function receiveServerJob(incoming: SpeechGenerationJob): void {
  const current = useSpeechGenerationStore.getState().jobs[incoming.id];
  if (current === undefined) return;
  const phaseChanged =
    current.stage !== incoming.stage || current.status !== incoming.status;
  const shouldHandle =
    incoming.status === "succeeded" &&
    current.resolution === undefined &&
    !current.handlingResult;
  useSpeechGenerationStore.setState((state) => ({
    jobs: {
      ...state.jobs,
      [incoming.id]: {
        ...state.jobs[incoming.id],
        ...incoming,
        handlingResult: shouldHandle || state.jobs[incoming.id].handlingResult,
      },
    },
    announcement:
      phaseChanged &&
      (incoming.stage === "requesting" ||
        incoming.status === "failed" ||
        incoming.status === "cancelled")
        ? speechGenerationStageCopy[incoming.stage]
        : state.announcement,
  }));
  if (shouldHandle) void handleSucceeded(incoming.id);
}

function localFailure(
  sceneId: string,
  expected: ClientSpeechGenerationJob["expected"],
  message: string,
): void {
  const now = new Date().toISOString();
  const id = `local-${createClientUuid()}`;
  useSpeechGenerationStore.setState((state) => ({
    jobs: {
      ...state.jobs,
      [id]: {
        id,
        type: "speech-generation",
        sceneId,
        narrationText: expected.narrationText,
        status: "failed",
        stage: "failed",
        createdAt: now,
        updatedAt: now,
        expected,
        error: {
          code: "SPEECH_JOB_START_FAILED",
          message,
          retryable: true,
        },
      },
    },
    announcement: message,
  }));
}

export function latestSpeechJobForScene(
  jobs: Record<string, ClientSpeechGenerationJob>,
  sceneId: string,
): ClientSpeechGenerationJob | undefined {
  return Object.values(jobs)
    .filter((job) => job.sceneId === sceneId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export const useSpeechGenerationStore = create<SpeechGenerationState>((set, get) => ({
  jobs: {},
  announcement: "",
  connected: false,
  connect: () => {
    if (get().connected) return () => undefined;
    recoveryPromise = fetch("/api/jobs/speech/recover", {
      method: "POST",
      headers: { "x-narracut-session-id": getProjectSessionId() },
    }).then(() => undefined, () => undefined);
    const source = new EventSource("/api/jobs/events");
    set({ connected: true });
    const onJob = (event: MessageEvent<string>) => {
      const incoming = JSON.parse(event.data) as import("../shared/jobs").NarracutJob;
      if (incoming.type === "speech-generation") receiveServerJob(incoming);
    };
    source.addEventListener("job", onJob as EventListener);
    source.onerror = () =>
      set({ announcement: "Speech 任务进度连接已中断，正在重新连接" });
    return () => {
      source.removeEventListener("job", onJob as EventListener);
      source.close();
      set({ connected: false });
    };
  },
  startGeneration: async (sceneId) => {
    await recoveryPromise;
    const scene = useProjectStore
      .getState()
      .project?.scenes.find((candidate) => candidate.id === sceneId);
    if (
      scene === undefined ||
      scene.narration.text.trim().length === 0 ||
      activeForScene(get().jobs, sceneId) ||
      startingScenes.has(sceneId)
    ) {
      return;
    }
    const expected = {
      narrationText: scene.narration.text,
      speech: scene.speech,
      ttsProfileId: CURRENT_TTS_PROFILE_ID,
    } as const;
    startingScenes.add(sceneId);
    try {
      const response = await fetch("/api/jobs/speech", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-narracut-session-id": getProjectSessionId(),
        },
        body: JSON.stringify({ sceneId, narrationText: scene.narration.text }),
      });
      if (!response.ok) {
        localFailure(
          sceneId,
          expected,
          response.status === 409
            ? "这个 Scene 已有未完成的 Speech 任务；重新打开项目可自动恢复。"
            : (await response.text()) || "无法创建 Speech 任务。",
        );
        return;
      }
      const payload = (await response.json()) as { job?: SpeechGenerationJob };
      if (payload.job === undefined) throw new Error("任务服务返回了无效响应。");
      set((state) => ({
        jobs: {
          ...state.jobs,
          [payload.job!.id]: { ...payload.job!, expected },
        },
        announcement: scene.speech === undefined
          ? "Speech 已加入生成队列"
          : "Speech 已加入重新生成队列；当前版本继续有效",
      }));
      try {
        const latest = await fetch(`/api/jobs/${payload.job.id}`);
        if (latest.ok) receiveServerJob((await latest.json()) as SpeechGenerationJob);
      } catch {
        set({ announcement: "Speech 任务已创建，正在等待实时进度" });
      }
    } catch (error) {
      localFailure(
        sceneId,
        expected,
        error instanceof Error ? error.message : "无法创建 Speech 任务。",
      );
    } finally {
      startingScenes.delete(sceneId);
    }
  },
  cancel: async (jobId) => {
    const job = get().jobs[jobId];
    if (job === undefined || job.id.startsWith("local-")) return;
    set((state) => ({
      jobs: {
        ...state.jobs,
        [jobId]: { ...state.jobs[jobId], cancelError: undefined },
      },
    }));
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: "DELETE",
        headers: { "x-narracut-session-id": getProjectSessionId() },
      });
      if (!response.ok) {
        const message = (await response.text()) || "无法取消 Speech 任务。";
        set((state) => ({
          jobs: {
            ...state.jobs,
            [jobId]: { ...state.jobs[jobId], cancelError: message },
          },
          announcement: message,
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法取消 Speech 任务。";
      set((state) => ({
        jobs: {
          ...state.jobs,
          [jobId]: { ...state.jobs[jobId], cancelError: message },
        },
        announcement: message,
      }));
    }
  },
  retry: async (jobId) => {
    const job = get().jobs[jobId];
    if (job === undefined) return;
    await get().startGeneration(job.sceneId);
  },
}));

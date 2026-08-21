import { create } from "zustand";

import type { VideoImportJob } from "../shared/jobs";
import { createClientUuid } from "./client-uuid";
import { getProjectSessionId, useProjectStore } from "./project-store";

type ProposalResolution =
  | "auto-applied"
  | "orphaned"
  | "changed"
  | "incompatible"
  | "applied"
  | "kept"
  | "registration-failed";

export type ClientVideoImportJob = VideoImportJob & {
  expected: { visualType: "video"; assetId: string | undefined };
  sourceFile: File;
  handlingResult?: boolean;
  resolution?: ProposalResolution;
  proposalDialogOpen?: boolean;
  cancelError?: string;
  proposalError?: string;
};

type VideoImportState = {
  jobs: Record<string, ClientVideoImportJob>;
  announcement: string;
  connected: boolean;
  connect: () => () => void;
  startImport: (sceneId: string, file: File) => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
  retry: (jobId: string) => Promise<void>;
  applyPending: (jobId: string) => Promise<boolean>;
  keepPending: (jobId: string) => void;
  hidePending: (jobId: string) => void;
  showPending: (jobId: string) => void;
};

const stageCopy: Record<VideoImportJob["stage"], string> = {
  waiting: "排队中",
  probing: "正在检查媒体",
  normalizing: "正在规范化",
  verifying: "正在复核",
  finalizing: "正在写入项目",
  completed: "已导入并应用",
  cancelling: "正在取消",
  cancelled: "已取消",
  failed: "导入失败",
};

function activeForScene(jobs: Record<string, ClientVideoImportJob>, sceneId: string) {
  return Object.values(jobs).some(
    (job) => job.sceneId === sceneId &&
      (job.status === "queued" || job.status === "processing" || job.status === "cancelling"),
  );
}

async function handleSucceeded(jobId: string): Promise<void> {
  const job = useVideoImportStore.getState().jobs[jobId];
  if (job?.result === undefined || job.resolution !== undefined) return;
  const projectState = useProjectStore.getState();
  const scene = projectState.project?.scenes.find((candidate) => candidate.id === job.sceneId);
  try {
    if (scene?.visual.type === "video" && scene.visual.assetId === job.expected.assetId) {
      const applied = await projectState.applyJobResult({
        kind: "asset",
        sceneId: job.sceneId,
        expected: job.expected,
        asset: job.result.asset,
      });
      if (applied) {
        useVideoImportStore.setState((state) => ({
          jobs: {
            ...state.jobs,
            [jobId]: { ...state.jobs[jobId], resolution: "auto-applied" },
          },
          announcement: job.result!.facts.enlarged
            ? "视频已导入并应用；已放大到 1080p"
            : "视频已导入并应用",
        }));
        return;
      }
    }

    const registered = await useProjectStore.getState().registerAsset(job.result.asset);
    if (!registered) throw new Error("无法登记导入后的 Asset。");
    const currentScene = useProjectStore.getState().project?.scenes.find(
      (candidate) => candidate.id === job.sceneId,
    );
    const resolution: ProposalResolution = currentScene === undefined
      ? "orphaned"
      : currentScene.visual.type !== "video"
        ? "incompatible"
        : "changed";
    if (resolution === "orphaned") useProjectStore.getState().setTaskDrawerOpen(true);
    useVideoImportStore.setState((state) => ({
      jobs: {
        ...state.jobs,
        [jobId]: {
          ...state.jobs[jobId],
          resolution,
          proposalDialogOpen: resolution !== "orphaned",
        },
      },
      announcement: resolution === "orphaned"
        ? "视频已导入，但目标 Scene 已删除"
        : "视频已导入，匹配提案需要确认",
    }));
  } catch (error) {
    useVideoImportStore.setState((state) => ({
      jobs: {
        ...state.jobs,
        [jobId]: {
          ...state.jobs[jobId],
          resolution: "registration-failed",
          error: {
            code: "ASSET_REGISTRATION_FAILED",
            message: error instanceof Error ? error.message : "无法登记导入后的 Asset。",
          },
        },
      },
      announcement: "视频已落盘，但无法登记 Asset",
    }));
  }
}

function receiveServerJob(incoming: VideoImportJob): void {
  if (incoming.type !== "video-import") return;
  const current = useVideoImportStore.getState().jobs[incoming.id];
  if (current === undefined) return;
  const phaseChanged = current.stage !== incoming.stage || current.status !== incoming.status;
  const shouldHandle = incoming.status === "succeeded" &&
    current.resolution === undefined && !current.handlingResult;
  useVideoImportStore.setState((state) => ({
    jobs: {
      ...state.jobs,
      [incoming.id]: {
        ...state.jobs[incoming.id],
        ...incoming,
        handlingResult: shouldHandle || state.jobs[incoming.id].handlingResult,
      },
    },
    announcement: phaseChanged ? stageCopy[incoming.stage] : state.announcement,
  }));
  if (shouldHandle) void handleSucceeded(incoming.id);
}

export const useVideoImportStore = create<VideoImportState>((set, get) => ({
  jobs: {},
  announcement: "",
  connected: false,
  connect: () => {
    if (get().connected) return () => undefined;
    const source = new EventSource("/api/jobs/events");
    set({ connected: true });
    const onJob = (event: MessageEvent<string>) => {
      const incoming = JSON.parse(event.data) as { type?: string };
      if (incoming.type === "video-import") receiveServerJob(incoming as VideoImportJob);
    };
    source.addEventListener("job", onJob as EventListener);
    source.onerror = () => set({ announcement: "任务进度连接已中断，正在重新连接" });
    return () => {
      source.removeEventListener("job", onJob as EventListener);
      source.close();
      set({ connected: false });
    };
  },
  startImport: async (sceneId, file) => {
    const scene = useProjectStore.getState().project?.scenes.find(
      (candidate) => candidate.id === sceneId,
    );
    if (scene?.visual.type !== "video" || activeForScene(get().jobs, sceneId)) return;
    const expected = { visualType: "video" as const, assetId: scene.visual.assetId };
    const recordFailure = (message: string) => {
      const now = new Date().toISOString();
      const id = `local-${createClientUuid()}`;
      set((state) => ({
        jobs: {
          ...state.jobs,
          [id]: {
            id,
            type: "video-import",
            sceneId,
            fileName: file.name,
            status: "failed",
            stage: "failed",
            createdAt: now,
            updatedAt: now,
            expected,
            sourceFile: file,
            error: { code: "VIDEO_IMPORT_START_FAILED", message },
          },
        },
        announcement: message,
      }));
    };
    try {
      const response = await fetch("/api/jobs/video-import", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-narracut-file-name": encodeURIComponent(file.name),
          "x-narracut-scene-id": sceneId,
          "x-narracut-session-id": getProjectSessionId(),
        },
        body: file,
      });
      if (!response.ok) {
        recordFailure((await response.text()) || "无法创建视频导入任务。");
        return;
      }
      const payload = await response.json() as { job?: VideoImportJob };
      if (payload.job === undefined) throw new Error("任务服务返回了无效响应。");
      set((state) => ({
        jobs: {
          ...state.jobs,
          [payload.job!.id]: { ...payload.job!, expected, sourceFile: file },
        },
        announcement: "视频已加入处理队列",
      }));
      try {
        const latest = await fetch(`/api/jobs/${payload.job.id}`);
        if (latest.ok) receiveServerJob(await latest.json() as VideoImportJob);
      } catch {
        set({ announcement: "任务已创建，正在等待实时进度" });
      }
    } catch (error) {
      recordFailure(error instanceof Error ? error.message : "无法创建视频导入任务。");
    }
  },
  cancel: async (jobId) => {
    const job = get().jobs[jobId];
    if (job === undefined || job.id.startsWith("local-")) return;
    set((state) => ({ jobs: { ...state.jobs, [jobId]: { ...state.jobs[jobId], cancelError: undefined } } }));
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: "DELETE",
        headers: { "x-narracut-session-id": getProjectSessionId() },
      });
      if (!response.ok) throw new Error((await response.text()) || "无法取消视频导入任务。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法取消视频导入任务。";
      set((state) => ({
        jobs: { ...state.jobs, [jobId]: { ...state.jobs[jobId], cancelError: message } },
        announcement: message,
      }));
    }
  },
  retry: async (jobId) => {
    const job = get().jobs[jobId];
    if (job === undefined) return;
    if (job.resolution === "registration-failed") {
      set((state) => ({
        jobs: { ...state.jobs, [jobId]: { ...state.jobs[jobId], resolution: undefined, error: undefined, handlingResult: true } },
        announcement: "正在重新登记 Asset",
      }));
      await handleSucceeded(jobId);
      return;
    }
    await get().startImport(job.sceneId, job.sourceFile);
  },
  applyPending: async (jobId) => {
    const job = get().jobs[jobId];
    if (job?.result === undefined || job.resolution !== "changed") return false;
    const currentScene = useProjectStore.getState().project?.scenes.find(
      (scene) => scene.id === job.sceneId,
    );
    if (currentScene === undefined || currentScene.visual.type !== "video") {
      const resolution = currentScene === undefined ? "orphaned" : "incompatible";
      set((state) => ({
        jobs: { ...state.jobs, [jobId]: { ...state.jobs[jobId], resolution, proposalDialogOpen: resolution !== "orphaned", proposalError: undefined } },
        announcement: resolution === "orphaned" ? "无法应用视频：目标 Scene 已删除" : "无法应用视频：Visual 已不兼容",
      }));
      return false;
    }
    try {
      const applied = await useProjectStore.getState().bindAsset(job.sceneId, job.result.asset.id);
      set((state) => ({
        jobs: {
          ...state.jobs,
          [jobId]: {
            ...state.jobs[jobId],
            ...(applied ? { resolution: "applied" as const, proposalDialogOpen: false } : { proposalError: "当前 Scene 已再次变化，无法应用这段视频。" }),
          },
        },
        announcement: applied ? "已应用新视频；可撤销" : "当前 Scene 已再次变化，无法应用这段视频",
      }));
      return applied;
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法应用这段视频。";
      set((state) => ({
        jobs: { ...state.jobs, [jobId]: { ...state.jobs[jobId], proposalError: message } },
        announcement: message,
      }));
      return false;
    }
  },
  keepPending: (jobId) => set((state) => ({
    jobs: { ...state.jobs, [jobId]: { ...state.jobs[jobId], resolution: "kept", proposalDialogOpen: false } },
    announcement: "已保留当前绑定；新视频作为未绑定 Asset 保留",
  })),
  hidePending: (jobId) => set((state) => ({
    jobs: { ...state.jobs, [jobId]: { ...state.jobs[jobId], proposalDialogOpen: false } },
  })),
  showPending: (jobId) => set((state) => {
    const job = state.jobs[jobId];
    const currentScene = useProjectStore.getState().project?.scenes.find((scene) => scene.id === job.sceneId);
    const resolution = currentScene === undefined
      ? "orphaned"
      : currentScene.visual.type !== "video"
        ? "incompatible"
        : job.resolution;
    return {
      jobs: { ...state.jobs, [jobId]: { ...job, resolution, proposalDialogOpen: resolution !== "orphaned", proposalError: undefined } },
      announcement: resolution === "orphaned" ? "无法确认视频：目标 Scene 已删除" : state.announcement,
    };
  }),
}));

export function latestVideoJobForScene(
  jobs: Record<string, ClientVideoImportJob>,
  sceneId: string,
): ClientVideoImportJob | undefined {
  return Object.values(jobs)
    .filter((job) => job.sceneId === sceneId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export const videoImportStageCopy = stageCopy;

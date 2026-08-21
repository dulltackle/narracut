import { create } from "zustand";

import { canApplyJobUpdate, isActiveJob, type ImageImportJob } from "../shared/jobs";
import { createClientUuid } from "./client-uuid";
import { connectJobEvents, type JobEventOrigin } from "./job-events";
import { getProjectSessionId, useProjectStore } from "./project-store";

type ProposalResolution =
  | "auto-applied"
  | "orphaned"
  | "changed"
  | "incompatible"
  | "applied"
  | "kept"
  | "registration-failed";

export type ClientImageImportJob = ImageImportJob & {
  expected: { visualType: "image"; assetId: string | undefined };
  sourceFile?: File;
  recovered?: boolean;
  handlingResult?: boolean;
  resolution?: ProposalResolution;
  proposalDialogOpen?: boolean;
  cancelError?: string;
  proposalError?: string;
};

type ImageImportState = {
  jobs: Record<string, ClientImageImportJob>;
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

const deferredServerJobs = new Map<string, ImageImportJob>();
const deferredServerJobTimers = new Map<string, number>();

const stageCopy: Record<ImageImportJob["stage"], string> = {
  waiting: "等待处理",
  validating: "正在检查图片",
  normalizing: "正在规范化图片",
  verifying: "正在复核结果",
  finalizing: "正在写入项目",
  completed: "图片导入完成",
  cancelling: "正在取消",
  cancelled: "图片导入已取消",
  failed: "图片导入失败",
};

function activeForScene(
  jobs: Record<string, ClientImageImportJob>,
  sceneId: string,
): boolean {
  return Object.values(jobs).some(
    (job) =>
      job.sceneId === sceneId &&
      (job.status === "queued" ||
        job.status === "processing" ||
        job.status === "cancelling"),
  );
}

async function handleSucceeded(jobId: string): Promise<void> {
  const job = useImageImportStore.getState().jobs[jobId];
  if (job?.result === undefined || job.resolution !== undefined) return;
  const projectState = useProjectStore.getState();
  const scene = projectState.project?.scenes.find(
    (candidate) => candidate.id === job.sceneId,
  );
  try {
    if (
      scene?.visual.type === "image" &&
      scene.visual.assetId === job.expected.assetId
    ) {
      const applied = await projectState.applyJobResult({
        kind: "asset",
        sceneId: job.sceneId,
        expected: job.expected,
        asset: job.result.asset,
      });
      if (applied) {
        useImageImportStore.setState((state) => ({
          jobs: {
            ...state.jobs,
            [jobId]: { ...state.jobs[jobId], resolution: "auto-applied" },
          },
          announcement: job.result!.facts.enlarged
            ? "图片已导入并应用；低分辨率图片已放大到 1080p"
            : "图片已导入并应用",
        }));
        return;
      }
    }

    const registered = await useProjectStore.getState().registerAsset(job.result.asset);
    if (!registered) throw new Error("无法登记导入后的 Asset。");
    const currentScene = useProjectStore
      .getState()
      .project?.scenes.find((candidate) => candidate.id === job.sceneId);
    const resolution: ProposalResolution =
      currentScene === undefined
        ? "orphaned"
        : currentScene.visual.type !== "image"
          ? "incompatible"
          : "changed";
    if (resolution === "orphaned") {
      useProjectStore.getState().setTaskDrawerOpen(true);
    }
    useImageImportStore.setState((state) => ({
      jobs: {
        ...state.jobs,
        [jobId]: {
          ...state.jobs[jobId],
          resolution,
          proposalDialogOpen: resolution !== "orphaned",
        },
      },
      announcement:
        resolution === "orphaned"
          ? "图片已导入，但目标 Scene 已删除"
          : "图片已导入，匹配提案需要确认",
    }));
  } catch (error) {
    useImageImportStore.setState((state) => ({
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
      announcement: "图片已落盘，但无法登记 Asset",
    }));
  }
}

function receiveServerJob(
  incoming: ImageImportJob,
  origin: JobEventOrigin = "event",
  deferred = false,
): void {
  let current = useImageImportStore.getState().jobs[incoming.id];
  if (current === undefined) {
    if (origin === "event" && !deferred) {
      deferredServerJobs.set(incoming.id, incoming);
      if (!deferredServerJobTimers.has(incoming.id)) {
        deferredServerJobTimers.set(incoming.id, window.setTimeout(() => {
          deferredServerJobTimers.delete(incoming.id);
          const latest = deferredServerJobs.get(incoming.id);
          deferredServerJobs.delete(incoming.id);
          if (latest !== undefined) receiveServerJob(latest, "event", true);
        }, 100));
      }
      return;
    }
    if (origin === "snapshot" && !isActiveJob(incoming)) return;
    current = {
      ...incoming,
      expected: { visualType: "image", assetId: `recovered-${incoming.id}` },
      recovered: true,
    };
    useImageImportStore.setState((state) => ({
      jobs: { ...state.jobs, [incoming.id]: current! },
    }));
  } else {
    const timer = deferredServerJobTimers.get(incoming.id);
    if (timer !== undefined) window.clearTimeout(timer);
    deferredServerJobTimers.delete(incoming.id);
    deferredServerJobs.delete(incoming.id);
    if (!canApplyJobUpdate(current, incoming)) return;
  }
  const phaseChanged =
    current.stage !== incoming.stage || current.status !== incoming.status;
  const shouldHandle =
    incoming.status === "succeeded" &&
    current.resolution === undefined &&
    !current.handlingResult;
  useImageImportStore.setState((state) => ({
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

export const useImageImportStore = create<ImageImportState>((set, get) => ({
  jobs: {},
  announcement: "",
  connected: false,
  connect: () => {
    if (get().connected) return () => undefined;
    set({ connected: true });
    const disconnect = connectJobEvents((job, origin) => {
      if (job.type === "image-import") receiveServerJob(job, origin);
    });
    return () => {
      disconnect();
      set({ connected: false });
    };
  },
  startImport: async (sceneId, file) => {
    const project = useProjectStore.getState().project;
    const scene = project?.scenes.find((candidate) => candidate.id === sceneId);
    if (scene?.visual.type !== "image" || activeForScene(get().jobs, sceneId)) return;
    const expected = { visualType: "image" as const, assetId: scene.visual.assetId };
    const recordFailure = (message: string) => {
      const now = new Date().toISOString();
      const id = `local-${createClientUuid()}`;
      set((state) => ({
        jobs: {
          ...state.jobs,
          [id]: {
            id,
            kind: "image-import",
            type: "image-import",
            sceneId,
            fileName: file.name,
            status: "failed",
            stage: "failed",
            createdAt: now,
            updatedAt: now,
            expected,
            sourceFile: file,
            error: { code: "IMAGE_IMPORT_START_FAILED", message },
          },
        },
        announcement: message,
      }));
    };
    try {
      const response = await fetch("/api/jobs/image-import", {
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
        recordFailure((await response.text()) || "无法创建图片导入任务。");
        return;
      }
      const payload = (await response.json()) as { job?: ImageImportJob };
      if (payload.job === undefined) throw new Error("任务服务返回了无效响应。");
      const job = payload.job;
      set((state) => ({
        jobs: {
          ...state.jobs,
          [job.id]: { ...job, expected, sourceFile: file },
        },
        announcement: "图片已加入处理队列",
      }));
      try {
        const latestResponse = await fetch(`/api/jobs/${job.id}`);
        if (latestResponse.ok) {
          receiveServerJob((await latestResponse.json()) as ImageImportJob);
        }
      } catch {
        set({ announcement: "任务已创建，正在等待实时进度" });
      }
    } catch (error) {
      recordFailure(
        error instanceof Error ? error.message : "无法创建图片导入任务。",
      );
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
        const message = (await response.text()) || "无法取消图片导入任务。";
        set((state) => ({
          jobs: {
            ...state.jobs,
            [jobId]: { ...state.jobs[jobId], cancelError: message },
          },
          announcement: message,
        }));
        return;
      }
      receiveServerJob((await response.json()) as ImageImportJob);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "无法取消图片导入任务。";
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
    if (job.resolution === "registration-failed") {
      set((state) => ({
        jobs: {
          ...state.jobs,
          [jobId]: {
            ...state.jobs[jobId],
            resolution: undefined,
            error: undefined,
            handlingResult: true,
          },
        },
        announcement: "正在重新登记 Asset",
      }));
      await handleSucceeded(jobId);
      return;
    }
    if (job.sourceFile !== undefined) await get().startImport(job.sceneId, job.sourceFile);
  },
  applyPending: async (jobId) => {
    const job = get().jobs[jobId];
    if (job?.result === undefined || job.resolution !== "changed") return false;
    const currentScene = useProjectStore
      .getState()
      .project?.scenes.find((scene) => scene.id === job.sceneId);
    if (currentScene === undefined || currentScene.visual.type !== "image") {
      const resolution = currentScene === undefined ? "orphaned" : "incompatible";
      set((state) => ({
        jobs: {
          ...state.jobs,
          [jobId]: {
            ...state.jobs[jobId],
            resolution,
            proposalDialogOpen: resolution !== "orphaned",
            proposalError: undefined,
          },
        },
        announcement:
          resolution === "orphaned"
            ? "无法应用图片：目标 Scene 已删除"
            : "无法应用图片：Visual 已不兼容",
      }));
      return false;
    }
    let applied = false;
    try {
      applied = await useProjectStore
        .getState()
        .bindAsset(job.sceneId, job.result.asset.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "无法应用这张图片。";
      set((state) => ({
        jobs: {
          ...state.jobs,
          [jobId]: { ...state.jobs[jobId], proposalError: message },
        },
        announcement: message,
      }));
      return false;
    }
    if (applied) {
      set((state) => ({
        jobs: {
          ...state.jobs,
          [jobId]: {
            ...state.jobs[jobId],
            resolution: "applied",
            proposalDialogOpen: false,
            proposalError: undefined,
          },
        },
        announcement: "已应用新图片；可撤销",
      }));
    } else {
      set((state) => ({
        jobs: {
          ...state.jobs,
          [jobId]: {
            ...state.jobs[jobId],
            proposalError: "当前 Scene 已再次变化，无法应用这张图片。",
          },
        },
        announcement: "当前 Scene 已再次变化，无法应用这张图片",
      }));
    }
    return applied;
  },
  keepPending: (jobId) =>
    set((state) => ({
      jobs: {
        ...state.jobs,
        [jobId]: {
          ...state.jobs[jobId],
          resolution: "kept",
          proposalDialogOpen: false,
        },
      },
      announcement: "已保留当前绑定；新图片作为未绑定 Asset 保留",
    })),
  hidePending: (jobId) =>
    set((state) => ({
      jobs: {
        ...state.jobs,
        [jobId]: { ...state.jobs[jobId], proposalDialogOpen: false },
      },
    })),
  showPending: (jobId) =>
    set((state) => {
      const job = state.jobs[jobId];
      const currentScene = useProjectStore
        .getState()
        .project?.scenes.find((scene) => scene.id === job.sceneId);
      const resolution =
        currentScene === undefined
          ? "orphaned"
          : currentScene.visual.type !== "image"
            ? "incompatible"
            : job.resolution;
      return {
        jobs: {
          ...state.jobs,
          [jobId]: {
            ...job,
            resolution,
            proposalDialogOpen: resolution !== "orphaned",
            proposalError: undefined,
          },
        },
        announcement:
          resolution === "orphaned"
            ? "无法确认图片：目标 Scene 已删除"
            : state.announcement,
      };
    }),
}));

export function latestImageJobForScene(
  jobs: Record<string, ClientImageImportJob>,
  sceneId: string,
): ClientImageImportJob | undefined {
  return Object.values(jobs)
    .filter((job) => job.sceneId === sceneId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export const imageImportStageCopy = stageCopy;

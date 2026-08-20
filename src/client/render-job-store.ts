import { create } from "zustand";

import type { RenderJob } from "../shared/jobs";
import { getProjectSessionId, useProjectStore } from "./project-store";

type RenderJobState = {
  jobs: Record<string, RenderJob>;
  announcement: string;
  connected: boolean;
  starting: boolean;
  startError?: string;
  openError?: string;
  connect: () => () => void;
  start: () => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
  openOutput: (jobId: string) => Promise<void>;
};

export const renderStageCopy: Record<RenderJob["stage"], string> = {
  waiting: "等待渲染",
  starting: "正在启动",
  preflight: "正在复核快照",
  "loading-media": "正在加载字体与媒体",
  encoding: "正在渲染",
  finalizing: "正在收尾",
  completed: "渲染完成",
  cancelling: "正在取消",
  cancelled: "已取消",
  failed: "渲染失败",
};

function receiveServerJob(incoming: RenderJob): void {
  if (incoming.type !== "render") return;
  const current = useRenderJobStore.getState().jobs[incoming.id];
  const changed = current?.stage !== incoming.stage || current?.status !== incoming.status;
  useRenderJobStore.setState((state) => ({
    jobs: { ...state.jobs, [incoming.id]: incoming },
    announcement: changed ? renderStageCopy[incoming.stage] : state.announcement,
    startError: undefined,
  }));
}

export function activeRenderJob(jobs: Record<string, RenderJob>): RenderJob | undefined {
  return Object.values(jobs).find(
    (job) =>
      job.status === "queued" ||
      job.status === "processing" ||
      job.status === "cancelling",
  );
}

export function latestRenderJob(jobs: Record<string, RenderJob>): RenderJob | undefined {
  return Object.values(jobs).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )[0];
}

export const useRenderJobStore = create<RenderJobState>((set, get) => ({
  jobs: {},
  announcement: "",
  connected: false,
  starting: false,
  connect: () => {
    if (get().connected) return () => undefined;
    const source = new EventSource("/api/jobs/events");
    set({ connected: true });
    const onJob = (event: MessageEvent<string>) => {
      const job = JSON.parse(event.data) as { type?: string };
      if (job.type === "render") receiveServerJob(job as RenderJob);
    };
    source.addEventListener("job", onJob as EventListener);
    source.onerror = () => set({ announcement: "渲染进度连接已中断，正在重新连接" });
    return () => {
      source.removeEventListener("job", onJob as EventListener);
      source.close();
      set({ connected: false });
    };
  },
  start: async () => {
    if (get().starting || activeRenderJob(get().jobs) !== undefined) return;
    const projectState = useProjectStore.getState();
    if (projectState.project === undefined) return;
    set({ starting: true, startError: undefined, openError: undefined });
    try {
      const response = await fetch("/api/jobs/render", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-narracut-session-id": getProjectSessionId(),
          "x-narracut-snapshot-source":
            projectState.saveStatus === "saved" ? "saved" : "unsaved",
        },
        body: JSON.stringify(projectState.project),
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "无法创建 Render Job。");
      }
      const payload = await response.json() as { job?: RenderJob };
      if (payload.job === undefined) throw new Error("任务服务返回了无效响应。");
      receiveServerJob(payload.job);
      useProjectStore.getState().setTaskDrawerOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法创建 Render Job。";
      set({ startError: message, announcement: "Render Job 创建失败" });
      useProjectStore.getState().setTaskDrawerOpen(true);
    } finally {
      set({ starting: false });
    }
  },
  cancel: async (jobId) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: "DELETE",
        headers: { "x-narracut-session-id": getProjectSessionId() },
      });
      if (!response.ok) throw new Error((await response.text()) || "无法取消 Render Job。");
      receiveServerJob(await response.json() as RenderJob);
    } catch (error) {
      set({
        startError: error instanceof Error ? error.message : "无法取消 Render Job。",
        announcement: "取消 Render Job 失败",
      });
    }
  },
  openOutput: async (jobId) => {
    set({ openError: undefined });
    try {
      const response = await fetch(`/api/jobs/${jobId}/open-output`, {
        method: "POST",
        headers: { "x-narracut-session-id": getProjectSessionId() },
      });
      if (!response.ok) throw new Error((await response.text()) || "无法打开产物目录。");
      set({ announcement: "已打开产物目录" });
    } catch (error) {
      set({
        openError: error instanceof Error ? error.message : "无法打开产物目录。",
        announcement: "产物目录无法打开",
      });
    }
  },
}));

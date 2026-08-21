import { create } from "zustand";

import type { NarracutJob } from "../shared/jobs";

export type JobEventOrigin = "snapshot" | "event";
type JobEventListener = (job: NarracutJob, origin: JobEventOrigin) => void;

type JobConnectionState = {
  status: "idle" | "connecting" | "connected" | "disconnected";
  announcement: string;
};

export const useJobConnectionStore = create<JobConnectionState>(() => ({
  status: "idle",
  announcement: "",
}));

const listeners = new Set<JobEventListener>();
const latestJobs = new Map<string, { job: NarracutJob; origin: JobEventOrigin }>();
let source: EventSource | undefined;
let consumers = 0;

function publish(job: NarracutJob, origin: JobEventOrigin): void {
  latestJobs.set(job.id, { job, origin });
  for (const listener of listeners) listener(job, origin);
}

function parseJob(input: string): NarracutJob | undefined {
  try {
    const value = JSON.parse(input) as NarracutJob;
    return typeof value === "object" && value !== null && typeof value.type === "string"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function ensureSource(): void {
  if (source !== undefined) return;
  useJobConnectionStore.setState({ status: "connecting", announcement: "" });
  source = new EventSource("/api/jobs/events");
  source.onopen = () => {
    useJobConnectionStore.setState((state) => ({
      status: "connected",
      announcement:
        state.status === "disconnected" ? "任务状态连接已恢复" : state.announcement,
    }));
  };
  source.onerror = () => {
    useJobConnectionStore.setState({
      status: "disconnected",
      announcement: "任务状态连接中断，正在重新连接",
    });
  };
  source.addEventListener("snapshot", ((event: MessageEvent<string>) => {
    try {
      const jobs = JSON.parse(event.data) as unknown;
      if (Array.isArray(jobs)) {
        latestJobs.clear();
        for (const value of jobs) {
          const job = parseJob(JSON.stringify(value));
          if (job !== undefined) publish(job, "snapshot");
        }
      }
    } catch {
      useJobConnectionStore.setState({
        status: "disconnected",
        announcement: "任务状态快照无法读取，正在重新连接",
      });
    }
  }) as EventListener);
  source.addEventListener("job", ((event: MessageEvent<string>) => {
    const job = parseJob(event.data);
    if (job !== undefined) publish(job, "event");
  }) as EventListener);
}

export function connectJobEvents(listener: JobEventListener): () => void {
  listeners.add(listener);
  consumers += 1;
  for (const value of latestJobs.values()) listener(value.job, value.origin);
  ensureSource();
  return () => {
    listeners.delete(listener);
    consumers = Math.max(0, consumers - 1);
    if (consumers === 0 && source !== undefined) {
      source.close();
      source = undefined;
      latestJobs.clear();
      useJobConnectionStore.setState({ status: "idle", announcement: "" });
    }
  };
}

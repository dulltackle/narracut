import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CircleNotch } from "@phosphor-icons/react/CircleNotch";
import { FilmSlate } from "@phosphor-icons/react/FilmSlate";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { ImageSquare } from "@phosphor-icons/react/ImageSquare";
import { SpeakerHigh } from "@phosphor-icons/react/SpeakerHigh";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { create } from "zustand";

import { isActiveJob, type NarracutJob } from "../shared/jobs";
import { resolveRenderDiagnosticScene } from "../shared/diagnostics";
import type { Project } from "../shared/project";
import {
  imageImportStageCopy,
  type ClientImageImportJob,
  useImageImportStore,
} from "./image-import-store";
import { useJobConnectionStore } from "./job-events";
import { renderStageCopy, useRenderJobStore } from "./render-job-store";
import {
  speechGenerationStageCopy,
  type ClientSpeechGenerationJob,
  useSpeechGenerationStore,
} from "./speech-generation-store";
import {
  type ClientVideoImportJob,
  useVideoImportStore,
  videoImportStageCopy,
} from "./video-import-store";

export type ClientJob =
  | ClientImageImportJob
  | ClientVideoImportJob
  | ClientSpeechGenerationJob
  | Extract<NarracutJob, { type: "render" }>;

type JobDrawerSelection = {
  selectedJobId?: string;
  selectJob: (jobId?: string) => void;
};

export const useJobDrawerSelection = create<JobDrawerSelection>((set) => ({
  selectedJobId: undefined,
  selectJob: (selectedJobId) => set({ selectedJobId }),
}));

export function isClientJobActive(job: ClientJob): boolean {
  if (isActiveJob(job)) return true;
  if ("handlingResult" in job && job.handlingResult === true) return true;
  return job.type === "speech-generation" &&
    job.status === "succeeded" &&
    job.resolution === undefined &&
    (job.stage === "prepared" || job.stage === "finalizing");
}

export function jobNeedsAttention(job: ClientJob): boolean {
  if (job.status === "failed" || job.error?.cleanupFailed === true) return true;
  if ("cancelError" in job && job.cancelError !== undefined) return true;
  if (!("resolution" in job) || job.resolution === undefined) return false;
  return !["applied", "auto-applied", "kept"].includes(job.resolution);
}

function kindCopy(job: ClientJob): string {
  if (job.type === "render") return "Render";
  if (job.type === "speech-generation") return "Speech";
  if (job.type === "video-import") return "Transcode";
  return "Image Import";
}

function stageCopy(job: ClientJob): string {
  if (job.type === "render") return renderStageCopy[job.stage];
  if (job.type === "speech-generation") return speechGenerationStageCopy[job.stage];
  if (job.type === "video-import") return videoImportStageCopy[job.stage];
  return imageImportStageCopy[job.stage];
}

function resolutionCopy(job: ClientJob): string {
  if ("cancelError" in job && job.cancelError !== undefined) return job.cancelError;
  if (job.error?.cleanupFailed) return job.error.message;
  if (job.type === "speech-generation") {
    const copy = {
      applied: "结果已应用",
      "scene-deleted": "结果未应用 · 目标 Scene 已删除",
      "narration-changed": "结果未应用 · Narration 已改变",
      "profile-changed": "结果未应用 · TTS profile 已改变",
      "speech-changed": "结果未应用 · 当前 Speech 已改变",
      "apply-failed": "Speech 已落盘，但 Project DSL 更新失败",
    } as const;
    return job.resolution === undefined ? job.error?.message ?? stageCopy(job) : copy[job.resolution];
  }
  if (job.type === "image-import" || job.type === "video-import") {
    const noun = job.type === "video-import" ? "视频" : "图片";
    const resolution = job.resolution;
    if (resolution === "orphaned") return `${noun}已导入，但目标 Scene 已删除`;
    if (resolution === "changed") return "导入结果待确认 · 当前绑定保持不变";
    if (resolution === "incompatible") return "导入结果待确认 · Visual 已不兼容";
    if (resolution === "registration-failed") return job.error?.message ?? "无法登记导入后的 Asset";
    if (resolution === "kept") return "已保留为未绑定 Asset";
    if (resolution === "applied" || resolution === "auto-applied") return "已导入并应用";
  }
  return job.error?.message ?? stageCopy(job);
}

function sceneLabel(job: ClientJob, project: Project): string {
  if (!("sceneId" in job)) return project.metadata.name || "当前项目";
  const index = project.scenes.findIndex((scene) => scene.id === job.sceneId);
  return index < 0 ? `Scene · ${job.sceneId.slice(0, 8)}` : `Scene ${String(index + 1).padStart(2, "0")}`;
}

function jobTitle(job: ClientJob, project: Project): string {
  if (job.type === "render") return project.metadata.name || "当前项目";
  if (job.type === "speech-generation") return job.narrationText;
  return job.fileName;
}

function JobIcon({ job }: { job: ClientJob }) {
  if (isClientJobActive(job)) return <CircleNotch className="spinner-inline" />;
  if (jobNeedsAttention(job)) return <WarningCircle weight="fill" />;
  if (job.status === "succeeded") return <CheckCircle weight="fill" />;
  if (job.type === "speech-generation") return <SpeakerHigh weight="fill" />;
  if (job.type === "image-import") return <ImageSquare weight="fill" />;
  return <FilmSlate weight="fill" />;
}

function JobActions({ job, compact = false }: { job: ClientJob; compact?: boolean }) {
  const cancelImage = useImageImportStore((state) => state.cancel);
  const retryImage = useImageImportStore((state) => state.retry);
  const showImage = useImageImportStore((state) => state.showPending);
  const cancelVideo = useVideoImportStore((state) => state.cancel);
  const retryVideo = useVideoImportStore((state) => state.retry);
  const showVideo = useVideoImportStore((state) => state.showPending);
  const cancelSpeech = useSpeechGenerationStore((state) => state.cancel);
  const retrySpeech = useSpeechGenerationStore((state) => state.retry);
  const cancelRender = useRenderJobStore((state) => state.cancel);
  const openOutput = useRenderJobStore((state) => state.openOutput);
  const active = isClientJobActive(job);
  const className = compact ? "btn compact" : "btn";
  const cancel = () => {
    if (job.type === "render") return cancelRender(job.id);
    if (job.type === "speech-generation") return cancelSpeech(job.id);
    if (job.type === "video-import") return cancelVideo(job.id);
    return cancelImage(job.id);
  };
  const retry = () => {
    if (job.type === "speech-generation") return retrySpeech(job.id);
    if (job.type === "video-import") return retryVideo(job.id);
    if (job.type === "image-import") return retryImage(job.id);
  };
  const canRetry = job.type === "speech-generation" ||
    ((job.type === "image-import" || job.type === "video-import") &&
      job.sourceFile !== undefined);
  return (
    <div className="job-actions">
      {active && job.status !== "cancelling" ? (
        <button className={className} type="button" onClick={() => void cancel()}>
          {job.type === "render" ? "取消渲染" : "取消任务"}
        </button>
      ) : null}
      {job.status === "failed" && job.type !== "render" && canRetry ? (
        <button className={className} type="button" onClick={() => void retry()}>
          <ArrowCounterClockwise />重试
        </button>
      ) : null}
      {job.type === "image-import" && (job.resolution === "changed" || job.resolution === "incompatible") ? (
        <button className={className} type="button" onClick={() => showImage(job.id)}>查看并确认</button>
      ) : null}
      {job.type === "video-import" && (job.resolution === "changed" || job.resolution === "incompatible") ? (
        <button className={className} type="button" onClick={() => showVideo(job.id)}>查看并确认</button>
      ) : null}
      {job.type === "render" && job.status === "succeeded" ? (
        <button className={`${className} primary`} type="button" onClick={() => void openOutput(job.id)}>
          <FolderOpen />打开产物目录
        </button>
      ) : null}
    </div>
  );
}

function testId(job: ClientJob): string {
  if (job.type === "render") return "render-job-task";
  if (job.type === "speech-generation") return "speech-generation-task";
  if (job.type === "video-import") return "video-import-task";
  return "image-import-task";
}

function JobRow({ job, project, onOpen }: { job: ClientJob; project: Project; onOpen: () => void }) {
  const progress = job.progress === undefined ? undefined : Math.round(job.progress * 100);
  return (
    <article className={`job-row ${job.status}${jobNeedsAttention(job) ? " needs-attention" : ""}`} data-testid={testId(job)}>
      <button className="job-row-main" type="button" data-job-open={job.id} onClick={onOpen} aria-label={`查看 ${kindCopy(job)} Job 详情`}>
        <span className="job-kind-icon" aria-hidden="true"><JobIcon job={job} /></span>
        <span className="job-row-copy">
          <span className="job-row-heading"><strong>{kindCopy(job)} · {sceneLabel(job, project)}</strong><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></span>
          <span className="job-title" title={jobTitle(job, project)}>{jobTitle(job, project)}</span>
          <span className="job-stage">{resolutionCopy(job)}{job.type === "render" ? ` · ${job.snapshotSource === "unsaved" ? "来自未保存版本" : "来自已保存版本"}` : ""}{progress === undefined || !isClientJobActive(job) ? "" : ` · ${progress}%`}</span>
          {job.error ? <code>{job.error.code} · {job.error.retryable ? "可重试" : "需要检查配置"}</code> : null}
        </span>
      </button>
      {isClientJobActive(job) ? <div className="job-progress" aria-label={progress === undefined ? stageCopy(job) : `任务进度 ${progress}%`}><i style={progress === undefined ? undefined : { width: `${progress}%` }} /></div> : null}
      {job.type === "render" && job.status === "succeeded" ? <div className="job-artifact-summary"><span>out.mp4</span><span>project.snapshot.json</span><span>render.log</span></div> : null}
      <JobActions job={job} compact />
    </article>
  );
}

function JobDetail({ job, project, onLocate }: { job: ClientJob; project: Project; onLocate: (job: ClientJob) => void }) {
  const progress = job.progress === undefined ? undefined : Math.round(job.progress * 100);
  const sceneId = "sceneId" in job
    ? job.sceneId
    : job.error === undefined
      ? undefined
      : resolveRenderDiagnosticScene(job.error, job.snapshotPlan)?.sceneId;
  return (
    <article className="job-detail-view" data-testid={testId(job)}>
      <div className="job-detail-hero">
        <span className="job-kind-icon" aria-hidden="true"><JobIcon job={job} /></span>
        <div><strong>{kindCopy(job)}</strong><span>{resolutionCopy(job)}</span></div>
      </div>
      {isClientJobActive(job) ? <div className="job-detail-progress"><div><i style={progress === undefined ? undefined : { width: `${progress}%` }} /></div><span>{progress === undefined ? "按真实阶段更新" : `${progress}%`}</span></div> : null}
      <dl className="job-facts">
        <div><dt>状态</dt><dd>{job.status}</dd></div>
        <div><dt>阶段</dt><dd>{stageCopy(job)}</dd></div>
        <div><dt>创建时间</dt><dd>{new Date(job.createdAt).toLocaleString("zh-CN", { hour12: false })}</dd></div>
        <div><dt>Job ID</dt><dd><code>{job.id}</code></dd></div>
        <div><dt>作用目标</dt><dd>{sceneLabel(job, project)}</dd></div>
        <div><dt>输入或产物</dt><dd>{jobTitle(job, project)}</dd></div>
      </dl>
      {job.error ? <div className="job-detail-error" role="alert"><WarningCircle weight="fill" /><div><strong>{job.error.message}</strong><code>{job.error.code} · {job.error.retryable ? "可重试" : "需要检查配置"}</code><span>{job.error.retryable ? "可以重试并创建新的 Job；当前历史不会被改写。" : "请检查配置或输入后再创建新的 Job。"}</span></div></div> : null}
      {job.type === "render" && job.status === "succeeded" ? <div className="job-artifacts"><div><strong>out.mp4</strong><code>{job.artifacts.output}</code></div><div><strong>project.snapshot.json</strong><code>{job.artifacts.snapshot}</code></div><div><strong>render.log</strong><code>{job.artifacts.log}</code></div></div> : null}
      <JobActions job={job} />
      {sceneId !== undefined ? <button className="btn job-locate" type="button" onClick={() => onLocate(job)}>定位到 Scene</button> : null}
    </article>
  );
}

export function TaskDrawer({
  open,
  jobs,
  project,
  onClose,
  onLocate,
  children,
}: {
  open: boolean;
  jobs: ClientJob[];
  project: Project;
  onClose: () => void;
  onLocate: (job: ClientJob) => void;
  children?: ReactNode;
}) {
  const selectedJobId = useJobDrawerSelection((state) => state.selectedJobId);
  const selectJob = useJobDrawerSelection((state) => state.selectJob);
  const connection = useJobConnectionStore();
  const [showAll, setShowAll] = useState(false);
  const overviewScrollRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => [...jobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [jobs]);
  const active = ordered.filter(isClientJobActive);
  const attention = ordered.filter((job) => !isClientJobActive(job) && jobNeedsAttention(job));
  const completed = ordered.filter((job) => !isClientJobActive(job) && !jobNeedsAttention(job));
  const visibleCompleted = showAll ? completed : completed.slice(0, 5);
  const selected = ordered.find((job) => job.id === selectedJobId);
  const openJob = (job: ClientJob) => {
    overviewScrollRef.current = bodyRef.current?.scrollTop ?? 0;
    selectJob(job.id);
    requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: 0 }));
  };
  const back = () => {
    const jobId = selectedJobId;
    selectJob(undefined);
    requestAnimationFrame(() => {
      bodyRef.current?.scrollTo({ top: overviewScrollRef.current });
      bodyRef.current?.querySelector<HTMLElement>(`[data-job-open="${jobId}"]`)?.focus();
    });
  };
  const close = () => {
    selectJob(undefined);
    onClose();
  };
  const group = (title: string, items: ClientJob[]) => items.length === 0 ? null : (
    <section className="job-group"><h3>{title}<span>{items.length}</span></h3><div className="job-list">{items.map((job) => <JobRow key={job.id} job={job} project={project} onOpen={() => openJob(job)} />)}</div></section>
  );
  return (
    <aside className={`task-drawer ${open ? "open" : ""}`} aria-hidden={!open} aria-label="任务与渲染">
      <header>
        {selected ? <button className="btn icon" type="button" aria-label="返回任务总览" onClick={back}><ArrowLeft /></button> : <span className="drawer-back-slot" aria-hidden="true" />}
        <div><h2>{selected ? `${kindCopy(selected)} Job` : "任务与渲染"}</h2>{selected ? <span>{sceneLabel(selected, project)}</span> : null}</div>
        <button className="btn icon" type="button" aria-label="关闭任务抽屉" onClick={close}><X /></button>
      </header>
      <div className="task-drawer-body" ref={bodyRef}>
        {selected ? <JobDetail job={selected} project={project} onLocate={onLocate} /> : <div className="task-groups">
          {connection.status === "disconnected" ? <div className="job-connection-warning" role="status"><WarningCircle /><span>任务状态连接中断，正在重新连接</span></div> : null}
          {group("进行中", active)}
          {group("需要处理", attention)}
          {group("最近完成", visibleCompleted)}
          {completed.length > 5 ? <button className="btn job-history-toggle" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? "收起历史" : `查看更多 · ${completed.length}`}</button> : null}
          {active.length === 0 && attention.length === 0 && completed.length === 0 ? <div className="task-empty"><CheckCircle size={42} weight="fill" /><strong>本页面会话暂无任务</strong><span>发起 Render、Speech 或 Transcode 后，会在这里持续显示。</span></div> : null}
          {children}
        </div>}
      </div>
      <div className="sr-only" aria-live="polite">{connection.announcement}</div>
    </aside>
  );
}

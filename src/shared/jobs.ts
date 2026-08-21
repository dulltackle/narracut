export type JobKind = "render" | "speech" | "transcode" | "image-import";

export type JobStatus =
  | "queued"
  | "processing"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

export type JobError = {
  code: string;
  message: string;
  retryable?: boolean;
  cleanupFailed?: boolean;
};

export type JobBase = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress?: number;
  createdAt: string;
  updatedAt: string;
  error?: JobError;
};

export function isActiveJob(job: Pick<JobBase, "status">): boolean {
  return job.status === "queued" || job.status === "processing" || job.status === "cancelling";
}

export function isTerminalJob(job: Pick<JobBase, "status">): boolean {
  return job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";
}

export function canApplyJobUpdate(
  current: Pick<JobBase, "id" | "status" | "updatedAt">,
  incoming: Pick<JobBase, "id" | "status" | "updatedAt">,
): boolean {
  if (current.id !== incoming.id) return false;
  if (isTerminalJob(current) && isActiveJob(incoming)) return false;
  if (
    current.status === "cancelling" &&
    (incoming.status === "queued" || incoming.status === "processing")
  ) return false;
  return incoming.updatedAt >= current.updatedAt;
}

export type ImageImportJobStatus =
  | "queued"
  | "processing"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ImageImportJobStage =
  | "waiting"
  | "validating"
  | "normalizing"
  | "verifying"
  | "finalizing"
  | "completed"
  | "cancelling"
  | "cancelled"
  | "failed";

export type ImageImportJob = JobBase & {
  kind: "image-import";
  type: "image-import";
  sceneId: string;
  fileName: string;
  status: ImageImportJobStatus;
  stage: ImageImportJobStage;
  createdAt: string;
  updatedAt: string;
  result?: {
    asset: { id: string; kind: "image"; path: string };
    facts: {
      sourceWidth: number;
      sourceHeight: number;
      width: 1920;
      height: 1080;
      enlarged: boolean;
    };
  };
  error?: {
    code: string;
    message: string;
    cleanupFailed?: boolean;
  };
};

export type VideoImportJobStatus = ImageImportJobStatus;

export type VideoImportJobStage =
  | "waiting"
  | "probing"
  | "normalizing"
  | "verifying"
  | "finalizing"
  | "completed"
  | "cancelling"
  | "cancelled"
  | "failed";

export type VideoImportJob = JobBase & {
  kind: "transcode";
  type: "video-import";
  sceneId: string;
  fileName: string;
  status: VideoImportJobStatus;
  stage: VideoImportJobStage;
  progress?: number;
  createdAt: string;
  updatedAt: string;
  result?: {
    asset: { id: string; kind: "video"; path: string };
    facts: {
      sourceWidth: number;
      sourceHeight: number;
      width: 1920;
      height: 1080;
      durationSeconds: number;
      frameCount: number;
      enlarged: boolean;
      mode: "remux" | "transcode";
    };
  };
  error?: {
    code: string;
    message: string;
    cleanupFailed?: boolean;
  };
};

export type SpeechGenerationJobStatus =
  | "queued"
  | "processing"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SpeechGenerationJobStage =
  | "waiting"
  | "requesting"
  | "validating"
  | "prepared"
  | "finalizing"
  | "completed"
  | "cancelling"
  | "cancelled"
  | "failed";

export type SpeechGenerationJob = JobBase & {
  kind: "speech";
  type: "speech-generation";
  sceneId: string;
  narrationText: string;
  status: SpeechGenerationJobStatus;
  stage: SpeechGenerationJobStage;
  createdAt: string;
  updatedAt: string;
  result?: {
    speech: {
      path: string;
      durationMs: number;
      sourceTextHash: string;
      ttsProfileId: string;
    };
    facts: {
      fileRevision: string;
      containerDurationMs: number;
    };
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    cleanupFailed?: boolean;
  };
};

export type RenderJobStatus =
  | "queued"
  | "processing"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

export type RenderJobStage =
  | "waiting"
  | "starting"
  | "preflight"
  | "loading-media"
  | "encoding"
  | "finalizing"
  | "completed"
  | "cancelling"
  | "cancelled"
  | "failed";

export type RenderJob = JobBase & {
  kind: "render";
  type: "render";
  status: RenderJobStatus;
  stage: RenderJobStage;
  progress?: number;
  createdAt: string;
  updatedAt: string;
  snapshotSource: "saved" | "unsaved";
  artifacts: {
    directory: string;
    snapshot: string;
    output: string;
    log: string;
  };
  snapshotPlan: Array<{
    sceneId: string;
    sequenceName: string;
    startFrame: number;
    durationInFrames: number;
  }>;
  durationInFrames?: number;
  error?: {
    code: string;
    message: string;
    sceneId?: string;
    frame?: number;
    sequenceName?: string;
    frameRange?: { startFrame: number; endFrame: number };
  };
};

export type NarracutJob = ImageImportJob | VideoImportJob | SpeechGenerationJob | RenderJob;

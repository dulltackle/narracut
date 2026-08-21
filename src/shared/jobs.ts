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

export type ImageImportJob = {
  id: string;
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

export type VideoImportJob = {
  id: string;
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

export type SpeechGenerationJob = {
  id: string;
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

export type RenderJob = {
  id: string;
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
    startFrame: number;
    durationInFrames: number;
  }>;
  durationInFrames?: number;
  error?: {
    code: string;
    message: string;
    sceneId?: string;
    frame?: number;
  };
};

export type NarracutJob = ImageImportJob | VideoImportJob | SpeechGenerationJob | RenderJob;

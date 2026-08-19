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

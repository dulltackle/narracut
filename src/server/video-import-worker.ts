import { VideoImportJobs, type VideoImportWorkerInput } from "./video-import-jobs";

const input = JSON.parse(process.argv[2] ?? "null") as VideoImportWorkerInput | null;
if (input === null) throw new Error("缺少 Transcode worker 输入。");

const jobs = new VideoImportJobs(input.projectRoot, {
  mediaBaseUrl: () => input.mediaBaseUrl,
  runInline: true,
});
let jobId: string | undefined;
let stopping = false;

jobs.subscribe((job) => {
  if (["succeeded", "failed", "cancelled"].includes(job.status) && !stopping) {
    stopping = true;
    void jobs.close().then(() => {
      process.send?.(
        { job: jobs.get(job.id) ?? job },
        undefined,
        undefined,
        () => process.exit(0),
      );
    });
    return;
  }
  process.send?.({ job });
});

const created = jobs.create({
  id: input.jobId,
  sceneId: input.sceneId,
  fileName: input.fileName,
  sourceFile: input.sourceFile,
  sourceBytes: input.sourceBytes,
});
jobId = created.id;
process.send?.({ job: created });

process.once("SIGTERM", () => {
  stopping = true;
  if (jobId !== undefined) jobs.cancel(jobId);
  void jobs.close().finally(() => process.exit(0));
});

import {
  SpeechGenerationJobs,
  type SpeechWorkerInput,
} from "./speech-generation-jobs";

process.once("message", (message: SpeechWorkerInput) => {
  const jobs = new SpeechGenerationJobs(message.projectRoot, {
    apiKey: message.apiKey,
    retryDelaysMs: message.retryDelaysMs,
    requestTimeoutMs: message.requestTimeoutMs,
    runInline: true,
  });
  let jobId: string | undefined;
  let stopping = false;
  jobs.subscribe((job) => {
    if (!["succeeded", "failed", "cancelled"].includes(job.status)) {
      process.send?.({ state: jobs.workerState(job.id) });
      return;
    }
    if (stopping) return;
    stopping = true;
    void jobs.waitForSettlement(job.id).then(() => {
      const state = jobs.workerState(job.id);
      process.send?.({ state }, undefined, undefined, () => process.exit(0));
    });
  });
  const created = jobs.create({
    id: message.jobId,
    sceneId: message.sceneId,
    narrationText: message.narrationText,
  });
  jobId = created.id;
  process.send?.({ state: jobs.workerState(created.id) });
  process.once("SIGTERM", () => {
    stopping = true;
    if (jobId !== undefined) jobs.cancel(jobId);
    void jobs.close().then(() => {
      const state = jobId === undefined ? undefined : jobs.workerState(jobId);
      process.send?.({ state }, undefined, undefined, () => process.exit(0));
    });
  });
});

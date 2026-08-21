import { describe, expect, it } from "vitest";

import {
  canApplyJobUpdate,
  isActiveJob,
  isTerminalJob,
  type JobStatus,
} from "../src/shared/jobs";

describe("Job 公共生命周期", () => {
  it.each<JobStatus>(["queued", "processing", "cancelling"])(
    "%s 是需要离开保护的活跃状态",
    (status) => {
      expect(isActiveJob({ status })).toBe(true);
      expect(isTerminalJob({ status })).toBe(false);
    },
  );

  it.each<JobStatus>(["succeeded", "failed", "cancelled"])(
    "%s 是可以写入会话历史的确定终态",
    (status) => {
      expect(isActiveJob({ status })).toBe(false);
      expect(isTerminalJob({ status })).toBe(true);
    },
  );

  it("终态和 cancelling 不会被延迟的活跃更新反转", () => {
    expect(canApplyJobUpdate(
      { id: "job-1", status: "failed", updatedAt: "2026-01-01T00:00:02.000Z" },
      { id: "job-1", status: "processing", updatedAt: "2026-01-01T00:00:01.000Z" },
    )).toBe(false);
    expect(canApplyJobUpdate(
      { id: "job-1", status: "cancelling", updatedAt: "2026-01-01T00:00:01.000Z" },
      { id: "job-1", status: "processing", updatedAt: "2026-01-01T00:00:02.000Z" },
    )).toBe(false);
  });
});

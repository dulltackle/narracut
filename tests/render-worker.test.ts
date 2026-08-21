import { describe, expect, it } from "vitest";

import { renderWorkerFailureMessage } from "../src/server/render-worker";

describe("Render worker 失败定位证据", () => {
  it("保留 renderer 错误及其 cause 上的 Scene、Sequence、帧与帧区间", () => {
    const cause = Object.assign(new Error("底层序列失败"), {
      sceneId: "73000000-0000-4000-8000-000000000002",
      sequenceName: "Scene 73000000-0000-4000-8000-000000000002",
      frame: 112,
      frameRange: { startFrame: 110, endFrame: 118 },
    });
    const error = new Error("第二幕渲染失败", { cause });

    expect(renderWorkerFailureMessage(error)).toEqual({
      type: "failed",
      code: "RENDER_FAILED",
      message: "第二幕渲染失败",
      sceneId: cause.sceneId,
      sequenceName: cause.sequenceName,
      frame: 112,
      frameRange: { startFrame: 110, endFrame: 118 },
    });
  });
});

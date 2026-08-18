import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderProjectStill } from "../src/remotion/renderer";
import { createRenderSnapshot } from "../src/remotion/render-snapshot";
import { DEFAULT_PROJECT_THEME, type Project } from "../src/shared/project";

describe("Remotion 最终 renderer", () => {
  it("通过最终 bundle 渲染共享 Composition 的关键帧", async () => {
    const sceneId = "71000000-0000-4000-8000-000000000001";
    const project: Project = {
      schemaVersion: 3,
      metadata: { name: "真实渲染夹具" },
      theme: DEFAULT_PROJECT_THEME,
      assets: [],
      scenes: [
        {
          id: sceneId,
          narration: { text: "Player 与 Render 使用同一 Composition" },
          speech: {
            path: `speech/${sceneId}.mp3`,
            durationMs: 1000,
            sourceTextHash: `sha256:${"0".repeat(64)}`,
            ttsProfileId: "narracut/test@1",
          },
          visual: {
            type: "card",
            label: "共享快照",
            title: "聚焦文字",
            textStyleId: "narracut/spotlight@1",
            textMotionId: "narracut/none@1",
          },
          transition: "cut",
        },
      ],
    };
    const output = join(tmpdir(), `narracut-render-${process.pid}.png`);
    const snapshot = createRenderSnapshot(project, "http://127.0.0.1:9/media/");

    await renderProjectStill(snapshot, output, 15);

    expect((await stat(output)).size).toBeGreaterThan(10_000);
  }, 60_000);
});

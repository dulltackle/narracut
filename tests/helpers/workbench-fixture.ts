import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
type Scene = {
  id: string;
  index: number;
  narration: string;
  assets: Array<{ id: string; path: string }>;
  speech: { status: "available"; durationMs: number } | { status: "missing" };
};

function scene(index: number): Scene {
  return {
    id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    index,
    narration: index === 1
      ? "在每一个认真生活的日常里，总有一些被忽略的细节。"
      : `第 ${index} 个 Scene 的完整 Narration，用于验证可扫描的只读行。`,
    assets: index % 2 === 0
      ? [{ id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`, path: `assets/scene-${index}.png` }]
      : [],
    speech: index % 3 === 0
      ? { status: "missing" }
      : { status: "available", durationMs: 1600 + index * 100 },
  };
}

export function validResult(sceneCount = 5) {
  const scenes = Array.from({ length: sceneCount }, (_, index) => scene(index + 1));
  const assets = scenes.flatMap((item) => item.assets);
  const videoBriefContent = "# 产品演示\n\n保留纸张与胶片的触感。\n";
  const videoBriefRevision = `sha256:${createHash("sha256").update(videoBriefContent).digest("hex")}`;
  return {
    status: "valid",
    connection: { status: "connected", readOnly: false },
    writable: true,
    projectRevision: `sha256:${"1".repeat(64)}`,
    videoBrief: {
      content: videoBriefContent,
      revision: videoBriefRevision,
      bytes: Buffer.byteLength(videoBriefContent),
      state: "saved",
    },
    currentRenderProgram: {
      briefRevision: videoBriefRevision,
      briefReviewPending: false,
      previewPreserved: true,
    },
    projectDsl: {
      assets,
      scenes: scenes.map((item) => ({
        id: item.id,
        narration: { text: item.narration },
        assetIds: item.assets.map((asset) => asset.id),
        ...(item.speech.status === "missing" ? {} : {
          speech: {
            path: `speech/${item.id}.mp3`,
            durationMs: item.speech.durationMs,
            sourceTextHash: `sha256:${createHash("sha256").update(item.narration, "utf8").digest("hex")}`,
            ttsProfileId: "narracut/default",
          },
        }),
      })),
    },
    project: {
      directory: "/work/projects/product-demo",
      folderName: "product-demo",
      projectId: "10000000-0000-4000-8000-000000000001",
      sceneCount,
      assetCount: Math.floor(sceneCount / 2),
    },
    checks: {
      manifest: { status: "valid", label: "项目清单" },
      dsl: { status: "valid", label: "Project DSL" },
      videoBrief: { status: "valid", label: "video.md", bytes: 28 },
    },
    scenes,
    assetStates: assets.map((asset) => ({ ...asset, status: "available" as const, size: 1024 })),
    warnings: [],
  };
}

export async function installAppToolBridge(
  page: Page,
  handler: (name: string, args: Record<string, any>) => unknown,
): Promise<void> {
  await page.exposeFunction("handleNarracutAppTool", handler);
  await page.evaluate(() => {
    (window as unknown as { openai: unknown }).openai = {
      callTool: (name: string, args: Record<string, unknown>) =>
        (window as unknown as {
          handleNarracutAppTool: (name: string, args: Record<string, unknown>) => unknown;
        }).handleNarracutAppTool(name, args),
    };
  });
}


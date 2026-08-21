import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compareVisualFrames } from "./support/visual-comparison";

async function writePixels(
  path: string,
  pixels: number[],
  width = 2,
  height = 2,
): Promise<void> {
  await sharp(Buffer.from(pixels), {
    raw: { width, height, channels: 3 },
  }).png().toFile(path);
}

describe("逐帧视觉证据比较", () => {
  it("允许受控像素误差，但用 Scene、帧和差异区域报告真实分叉", async () => {
    const directory = await mkdtemp(join(tmpdir(), "narracut-visual-comparison-"));
    const preview = join(directory, "preview.png");
    const encoded = join(directory, "encoded.png");
    const divergent = join(directory, "divergent.png");
    const base = [
      20, 30, 40, 20, 30, 40,
      20, 30, 40, 20, 30, 40,
    ];
    await writePixels(preview, base);
    await writePixels(encoded, base.map((channel) => channel + 3));
    await writePixels(divergent, [
      ...base.slice(0, 9),
      220, 10, 10,
    ]);

    await expect(compareVisualFrames(preview, encoded, {
      sceneId: "scene-controlled-error",
      frame: 17,
      channelThreshold: 6,
      maxDifferentPixelRatio: 0,
      artifactDirectory: directory,
    })).resolves.toMatchObject({ differentPixels: 0, differentPixelRatio: 0 });

    await expect(compareVisualFrames(preview, divergent, {
      sceneId: "scene-visible-divergence",
      frame: 23,
      channelThreshold: 6,
      maxDifferentPixelRatio: 0,
      artifactDirectory: directory,
    })).rejects.toThrow(
      /Scene scene-visible-divergence · 帧 23.*差异区域 x=1, y=1, width=1, height=1/,
    );
  });

  it("用局部监控区域捕获会被全画幅比例掩盖的文字差异", async () => {
    const directory = await mkdtemp(join(tmpdir(), "narracut-visual-region-"));
    const preview = join(directory, "preview.png");
    const changed = join(directory, "changed.png");
    const pixels = Array.from({ length: 100 * 100 * 3 }, () => 20);
    const changedPixels = [...pixels];
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        const offset = (y * 100 + x) * 3;
        changedPixels[offset] = 240;
        changedPixels[offset + 1] = 240;
        changedPixels[offset + 2] = 240;
      }
    }
    await writePixels(preview, pixels, 100, 100);
    await writePixels(changed, changedPixels, 100, 100);

    await expect(compareVisualFrames(preview, changed, {
      sceneId: "scene-localized-text",
      frame: 31,
      channelThreshold: 6,
      maxDifferentPixelRatio: 0.015,
      artifactDirectory: directory,
    })).resolves.toMatchObject({ differentPixelRatio: 0.01 });

    await expect(compareVisualFrames(preview, changed, {
      sceneId: "scene-localized-text",
      frame: 31,
      channelThreshold: 6,
      maxDifferentPixelRatio: 0.015,
      artifactDirectory: directory,
      regions: [{
        name: "Subtitle",
        left: 0,
        top: 0,
        width: 10,
        height: 10,
        maxDifferentPixelRatio: 0.02,
      }],
    })).rejects.toThrow(/监控区域 Subtitle 100\/100 \(100\.0000%\)/);
  });
});

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

export type VisualComparisonOptions = {
  sceneId: string;
  frame: number;
  channelThreshold: number;
  maxDifferentPixelRatio: number;
  artifactDirectory: string;
  regions?: VisualComparisonRegion[];
};

export type VisualComparisonRegion = {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  maxDifferentPixelRatio: number;
};

export type VisualComparisonRegionResult = VisualComparisonRegion & {
  differentPixels: number;
  differentPixelRatio: number;
};

export type VisualComparisonResult = {
  width: number;
  height: number;
  differentPixels: number;
  differentPixelRatio: number;
  meanAbsoluteChannelDifference: number;
  regions: VisualComparisonRegionResult[];
};

type RawImage = {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
};

async function readRawImage(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

function artifactName(sceneId: string, frame: number): string {
  const safeSceneId = sceneId.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  return `visual-diff-${safeSceneId}-frame-${frame}.png`;
}

export async function compareVisualFrames(
  previewPath: string,
  renderPath: string,
  options: VisualComparisonOptions,
): Promise<VisualComparisonResult> {
  const [preview, render] = await Promise.all([
    readRawImage(previewPath),
    readRawImage(renderPath),
  ]);
  if (
    preview.width !== render.width ||
    preview.height !== render.height ||
    preview.channels !== render.channels
  ) {
    throw new Error(
      `Scene ${options.sceneId} · 帧 ${options.frame} · 画面尺寸不一致：` +
      `Player ${preview.width}×${preview.height}×${preview.channels}，` +
      `MP4 ${render.width}×${render.height}×${render.channels}`,
    );
  }

  const pixelCount = preview.width * preview.height;
  const diff = Buffer.alloc(pixelCount * 3);
  const differentPixelMask = Buffer.alloc(pixelCount);
  let differentPixels = 0;
  let totalAbsoluteChannelDifference = 0;
  let minX = preview.width;
  let minY = preview.height;
  let maxX = -1;
  let maxY = -1;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const sourceOffset = pixel * preview.channels;
    const differences = [0, 1, 2].map((channel) =>
      Math.abs(preview.data[sourceOffset + channel] - render.data[sourceOffset + channel]),
    );
    totalAbsoluteChannelDifference += differences[0] + differences[1] + differences[2];
    const different = differences.some((value) => value > options.channelThreshold);
    const targetOffset = pixel * 3;
    if (different) {
      differentPixelMask[pixel] = 1;
      differentPixels += 1;
      const x = pixel % preview.width;
      const y = Math.floor(pixel / preview.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      diff[targetOffset] = 255;
      diff[targetOffset + 1] = Math.min(255, differences[1] * 8);
      diff[targetOffset + 2] = Math.min(255, differences[2] * 8);
    } else {
      const luminance = Math.round(
        (preview.data[sourceOffset] +
          preview.data[sourceOffset + 1] +
          preview.data[sourceOffset + 2]) /
          9,
      );
      diff[targetOffset] = luminance;
      diff[targetOffset + 1] = luminance;
      diff[targetOffset + 2] = luminance;
    }
  }

  const regions = (options.regions ?? []).map((region): VisualComparisonRegionResult => {
    const left = Math.floor(region.left);
    const top = Math.floor(region.top);
    const width = Math.ceil(region.width);
    const height = Math.ceil(region.height);
    if (
      left < 0 || top < 0 || width < 1 || height < 1 ||
      left + width > preview.width || top + height > preview.height
    ) {
      throw new Error(
        `Scene ${options.sceneId} · 帧 ${options.frame} · ` +
        `监控区域 ${region.name} 越过画面边界：` +
        `x=${left}, y=${top}, width=${width}, height=${height}`,
      );
    }
    let regionDifferentPixels = 0;
    for (let y = top; y < top + height; y += 1) {
      for (let x = left; x < left + width; x += 1) {
        regionDifferentPixels += differentPixelMask[y * preview.width + x];
      }
    }
    return {
      ...region,
      left,
      top,
      width,
      height,
      differentPixels: regionDifferentPixels,
      differentPixelRatio: regionDifferentPixels / (width * height),
    };
  });
  const result = {
    width: preview.width,
    height: preview.height,
    differentPixels,
    differentPixelRatio: differentPixels / pixelCount,
    meanAbsoluteChannelDifference:
      totalAbsoluteChannelDifference / (pixelCount * 3),
    regions,
  };
  const failedRegion = regions.find(
    (region) => region.differentPixelRatio > region.maxDifferentPixelRatio,
  );
  if (
    result.differentPixelRatio <= options.maxDifferentPixelRatio &&
    failedRegion === undefined
  ) return result;

  await mkdir(options.artifactDirectory, { recursive: true });
  const artifactPath = join(
    options.artifactDirectory,
    artifactName(options.sceneId, options.frame),
  );
  await sharp(diff, {
    raw: { width: preview.width, height: preview.height, channels: 3 },
  }).png().toFile(artifactPath);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  throw new Error(
    `Scene ${options.sceneId} · 帧 ${options.frame} · ` +
    `差异像素 ${differentPixels}/${pixelCount} ` +
    `(${(result.differentPixelRatio * 100).toFixed(4)}%)，` +
    (failedRegion === undefined
      ? ""
      : `监控区域 ${failedRegion.name} ` +
        `${failedRegion.differentPixels}/${failedRegion.width * failedRegion.height} ` +
        `(${(failedRegion.differentPixelRatio * 100).toFixed(4)}%)，`) +
    `差异区域 x=${minX}, y=${minY}, width=${width}, height=${height}；` +
    `差异图：${artifactPath}`,
  );
}

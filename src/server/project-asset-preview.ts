import { constants as fsConstants } from "node:fs";
import { lstat, open as openFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  validateProjectVNextResources,
  type ProjectVNextInspection,
} from "./project-vnext-inspection";

const MAX_INLINE_PREVIEW_BYTES = 32 * 1024 * 1024;

type PreviewKind = "image" | "video" | "audio" | "document" | "unsupported";

export type ProjectAssetPreview = {
  status: "available";
  id: string;
  path: string;
  filename: string;
  size: number;
  kind: PreviewKind;
  mediaType?: string;
  dataUrl?: string;
  reason?: string;
} | {
  status: "unavailable";
  id: string;
  path: string;
  reason: string;
} | {
  status: "dangling";
  id: string;
  reason: string;
};

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Buffer, start: number, end: number): string {
  return bytes.subarray(start, end).toString("ascii");
}

function detectPreview(bytes: Buffer): { kind: PreviewKind; mediaType?: string } {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: "image", mediaType: "image/png" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", mediaType: "image/jpeg" };
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return { kind: "image", mediaType: "image/gif" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return { kind: "image", mediaType: "image/webp" };
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: "video", mediaType: "video/webm" };
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    return /^M4A/u.test(brand)
      ? { kind: "audio", mediaType: "audio/mp4" }
      : { kind: "video", mediaType: brand === "qt  " ? "video/quicktime" : "video/mp4" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") {
    return { kind: "audio", mediaType: "audio/wav" };
  }
  if (ascii(bytes, 0, 4) === "OggS") return { kind: "audio", mediaType: "audio/ogg" };
  if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0)) {
    return { kind: "audio", mediaType: "audio/mpeg" };
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return { kind: "document", mediaType: "application/pdf" };
  return { kind: "unsupported" };
}

export async function readProjectAssetPreview(
  inspection: ProjectVNextInspection,
  assetId: string,
): Promise<ProjectAssetPreview> {
  const asset = inspection.project.assets.find((item) => item.id === assetId);
  if (asset === undefined) {
    return { status: "dangling", id: assetId, reason: "未找到登记的 Asset。" };
  }
  const absolutePath = join(inspection.projectDirectory, asset.path);
  try {
    const { assetStates: [runtime] } = await validateProjectVNextResources(
      inspection.projectDirectory,
      { assets: [asset], scenes: [] },
    );
    if (runtime?.status !== "available") {
      return {
        status: "unavailable",
        id: asset.id,
        path: asset.path,
        reason: runtime?.reason ?? "Asset 文件不可用。",
      };
    }
    const before = await lstat(absolutePath);
    const handle = await openFile(absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() || opened.nlink !== 1 ||
        opened.dev !== before.dev || opened.ino !== before.ino
      ) {
        return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset 文件身份已变化。" };
      }
      const header = Buffer.alloc(Math.min(32, opened.size));
      if (header.length > 0) await handle.read(header, 0, header.length, 0);
      const detected = detectPreview(header);
      const common = {
        status: "available" as const,
        id: asset.id,
        path: asset.path,
        filename: basename(asset.path),
        size: opened.size,
        ...detected,
      };
      if (detected.kind === "unsupported") {
        return { ...common, reason: "当前格式不支持内容预览。" };
      }
      if (opened.size > MAX_INLINE_PREVIEW_BYTES) {
        return { ...common, reason: "当前宿主无法安全加载此内容预览。" };
      }
      const bytes = Buffer.alloc(opened.size);
      let position = 0;
      while (position < bytes.length) {
        const { bytesRead } = await handle.read(bytes, position, bytes.length - position, position);
        if (bytesRead === 0) break;
        position += bytesRead;
      }
      if (position !== opened.size) {
        return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset 在读取期间发生变化。" };
      }
      const after = await handle.stat();
      if (
        after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
        after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      ) {
        return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset 在读取期间发生变化。" };
      }
      return {
        ...common,
        dataUrl: `data:${detected.mediaType};base64,${bytes.toString("base64")}`,
      };
    } finally {
      await handle.close();
    }
  } catch {
    return { status: "unavailable", id: asset.id, path: asset.path, reason: "Asset 文件缺失、无法读取或身份无效。" };
  }
}

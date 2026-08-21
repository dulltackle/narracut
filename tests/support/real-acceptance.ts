import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { Project } from "../../src/shared/project";
import { preflightPublicE2E } from "./public-e2e";

const execFileAsync = promisify(execFile);

export type RealAcceptanceSource = {
  kind: "image" | "video";
  path: string;
};

export type RealAcceptanceManifest = {
  version: 1;
  fixtureFingerprint: string;
  scenes: Array<{
    index: number;
    sceneId: string;
    narrationFingerprint: string;
    sourceFingerprint: string;
    assetId: string;
    assetPath: string;
    normalizedAssetFingerprint: string;
  }>;
};

type RealAcceptancePreflightOptions = {
  fixtureRoot: string;
  evidenceRoot: string;
  resumeDirectory?: string;
  envFile: string;
  environment?: NodeJS.ProcessEnv;
  probe?: typeof fetch;
  isPrivatePath?: (path: string) => Promise<boolean>;
};

export async function resolveCanonicalPath(path: string): Promise<string> {
  let existingPrefix = resolve(path);
  const missingSegments: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(existingPrefix), ...missingSegments);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const parent = dirname(existingPrefix);
      if (parent === existingPrefix) throw error;
      missingSegments.unshift(basename(existingPrefix));
      existingPrefix = parent;
    }
  }
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function pathIsOutsideRepositoryOrIgnored(path: string): Promise<boolean> {
  const repositoryRoot = await realpath(
    (await execFileAsync("git", ["rev-parse", "--show-toplevel"])).stdout.trim(),
  );
  const absolutePath = await resolveCanonicalPath(path);
  const repositoryRelativePath = relative(repositoryRoot, absolutePath);
  if (
    repositoryRelativePath === ".." ||
    repositoryRelativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(repositoryRelativePath)
  ) return true;
  try {
    await execFileAsync("git", ["check-ignore", "--quiet", "--no-index", absolutePath], {
      cwd: repositoryRoot,
    });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 1) return false;
    throw error;
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function createRealAcceptanceManifest({
  fixtureFingerprint,
  sourceFingerprints,
  narrations,
  project,
  projectRoot,
}: {
  fixtureFingerprint: string;
  sourceFingerprints: string[];
  narrations: string[];
  project: Project;
  projectRoot: string;
}): Promise<RealAcceptanceManifest> {
  if (
    project.scenes.length !== narrations.length ||
    sourceFingerprints.length !== narrations.length
  ) {
    throw new Error("真实验收工程、Narration 与源素材数量必须一致。");
  }
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const scenes = await Promise.all(project.scenes.map(async (scene, index) => {
    if (scene.narration.text !== narrations[index]) {
      throw new Error(`真实验收工程的 Scene ${index + 1} Narration 与当前夹具不一致。`);
    }
    if (scene.visual.type === "card" || scene.visual.assetId === undefined) {
      throw new Error(`真实验收工程的 Scene ${index + 1} 未绑定 Asset。`);
    }
    const asset = assets.get(scene.visual.assetId);
    if (asset === undefined) {
      throw new Error(`真实验收工程的 Scene ${index + 1} 引用了不存在的 Asset。`);
    }
    return {
      index: index + 1,
      sceneId: scene.id,
      narrationFingerprint: `sha256:${createHash("sha256")
        .update(scene.narration.text)
        .digest("hex")}`,
      sourceFingerprint: sourceFingerprints[index],
      assetId: asset.id,
      assetPath: asset.path,
      normalizedAssetFingerprint: `sha256:${await sha256File(join(projectRoot, asset.path))}`,
    };
  }));
  return { version: 1, fixtureFingerprint, scenes };
}

async function requireRegularFile(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isFile()) return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  throw new Error(`真实验收夹具缺少文件：${path}`);
}

export async function preflightRealAcceptance({
  fixtureRoot,
  evidenceRoot,
  resumeDirectory,
  envFile,
  environment = process.env,
  probe = fetch,
  isPrivatePath = pathIsOutsideRepositoryOrIgnored,
}: RealAcceptancePreflightOptions): Promise<{
  apiKey: string;
  narrations: string[];
  sources: RealAcceptanceSource[];
  sourceFingerprints: string[];
  fixtureFingerprint: string;
  fixtureRoot: string;
  evidenceRoot: string;
  resumeDirectory?: string;
}> {
  const [canonicalFixtureRoot, canonicalEvidenceRoot, canonicalResumeDirectory] = await Promise.all([
    resolveCanonicalPath(fixtureRoot),
    resolveCanonicalPath(evidenceRoot),
    resumeDirectory === undefined ? undefined : resolveCanonicalPath(resumeDirectory),
  ]);
  const [{ apiKey }, privateFixture, privateEvidence, privateResume] = await Promise.all([
    preflightPublicE2E({ environment, envFile, probe }),
    isPrivatePath(canonicalFixtureRoot),
    isPrivatePath(canonicalEvidenceRoot),
    canonicalResumeDirectory === undefined
      ? true
      : isPrivatePath(canonicalResumeDirectory),
  ]);
  if (!privateFixture) {
    throw new Error("真实夹具目录必须位于仓库外或被 Git 忽略。");
  }
  if (!privateEvidence) {
    throw new Error("证据目录必须位于仓库外或被 Git 忽略。");
  }
  if (!privateResume) {
    throw new Error("续跑目录必须位于仓库外或被 Git 忽略。");
  }
  if (
    canonicalResumeDirectory !== undefined &&
    !isWithin(canonicalEvidenceRoot, canonicalResumeDirectory)
  ) {
    throw new Error("续跑目录必须位于已验证的证据目录内。");
  }

  const scriptPath = join(canonicalFixtureRoot, "script.md");
  await requireRegularFile(scriptPath);
  const narrations = (await readFile(scriptPath, "utf8"))
    .split(/\r\n|\n|\r/u)
    .filter((line) => line.trim().length > 0);
  if (narrations.length !== 13) {
    throw new Error(
      `真实夹具必须恰好包含 13 条非空 Narration，实际为 ${narrations.length} 条。`,
    );
  }

  const sources: RealAcceptanceSource[] = Array.from({ length: 13 }, (_, index) => ({
    kind: index === 0 ? "image" as const : "video" as const,
    path: join(canonicalFixtureRoot, "clips", `${index + 1}.${index === 0 ? "png" : "mp4"}`),
  }));
  await Promise.all(sources.map((source) => requireRegularFile(source.path)));
  const contentHashes = await Promise.all([
    sha256File(scriptPath),
    ...sources.map((source) => sha256File(source.path)),
  ]);
  const fixtureFingerprint = `sha256:${createHash("sha256")
    .update(contentHashes.join("\n"))
    .digest("hex")}`;

  return {
    apiKey,
    narrations,
    sources,
    sourceFingerprints: contentHashes.slice(1).map((hash) => `sha256:${hash}`),
    fixtureFingerprint,
    fixtureRoot: canonicalFixtureRoot,
    evidenceRoot: canonicalEvidenceRoot,
    ...(canonicalResumeDirectory === undefined
      ? {}
      : { resumeDirectory: canonicalResumeDirectory }),
  };
}

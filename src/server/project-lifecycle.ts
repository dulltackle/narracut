import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, type Stats } from "node:fs";
import {
  access,
  link,
  lstat,
  mkdir,
  open as openFile,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  inspectProjectVNext,
  ProjectInspectionError,
  readProjectVNextRevision,
  validateProjectVNextForSave,
  validateProjectVNextResources,
  type ProjectVNext,
  type ProjectVNextInspection,
} from "./project-vnext-inspection";
import { parseStrictJson } from "./strict-json";

const STARTER_REACT_VERSION = "19.2.8";
const STARTER_REMOTION_VERSION = "4.0.512";

export type ProjectLifecycleErrorCode =
  | "PROJECT_CREATE_TARGET_EXISTS"
  | "PROJECT_CREATE_TARGET_INVALID"
  | "PROJECT_TEMPORARY_RESIDUE"
  | "PROJECT_TEMPORARY_RESIDUE_UNOWNED"
  | "PROJECT_CREATE_FAILED"
  | "PROJECT_CREATE_CLEANUP_FAILED"
  | "PROJECT_IN_USE"
  | "PROJECT_IDENTITY_LOST"
  | "PROJECT_SAVE_CONFLICT"
  | "PROJECT_SAVE_FAILED"
  | "PROJECT_CURRENT_INVALID"
  | "PROJECT_OPEN_FAILED";

export class ProjectLifecycleError extends Error {
  constructor(
    readonly code: ProjectLifecycleErrorCode,
    readonly path: string,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "ProjectLifecycleError";
  }
}

export type CreatedProjectVNext = {
  projectDirectory: string;
  projectId: string;
  revisionId: string;
};

type CreateProjectOptions = {
  createId?: () => string;
  confirmTemporaryCleanup?: boolean;
};

const OPERATION_MARKER = ".narracut-operation.json";
const activeLeasePaths = new Set<string>();

function isCreateOperationMarker(
  value: unknown,
  projectDirectory: string,
  operationToken?: string,
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  return Object.keys(marker).length === 5 &&
    marker.kind === "narracut-operation" &&
    marker.version === 1 &&
    marker.operation === "create" &&
    marker.targetDirectory === projectDirectory &&
    typeof marker.operationToken === "string" &&
    marker.operationToken.length > 0 &&
    (operationToken === undefined || marker.operationToken === operationToken);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function removeConfirmedCreateResidue(
  temporaryDirectory: string,
  projectDirectory: string,
  confirmed: boolean,
): Promise<void> {
  const facts = await lstat(temporaryDirectory);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `临时路径不是可确认归属的普通目录：${temporaryDirectory}。Narracut 拒绝删除。`,
    );
  }
  const markerPath = join(temporaryDirectory, OPERATION_MARKER);
  let marker: unknown;
  try {
    const markerFacts = await lstat(markerPath);
    if (!markerFacts.isFile() || markerFacts.isSymbolicLink() || markerFacts.nlink !== 1 || markerFacts.size > 4096) {
      throw new Error("invalid marker");
    }
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `临时目录缺少可验证的创建标记：${temporaryDirectory}。Narracut 拒绝删除。`,
    );
  }
  if (!isCreateOperationMarker(marker, projectDirectory)) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `临时目录标记与本次创建目标不匹配：${temporaryDirectory}。Narracut 拒绝删除。`,
    );
  }
  if (!confirmed) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE",
      temporaryDirectory,
      `发现与本次目标匹配的创建残留：${temporaryDirectory}。请确认清理后从头重试。`,
    );
  }
  const currentFacts = await lstat(temporaryDirectory);
  if (currentFacts.dev !== facts.dev || currentFacts.ino !== facts.ino || !currentFacts.isDirectory()) {
    throw new ProjectLifecycleError(
      "PROJECT_TEMPORARY_RESIDUE_UNOWNED",
      temporaryDirectory,
      `临时目录在确认期间发生变化：${temporaryDirectory}。Narracut 拒绝删除。`,
    );
  }
  await rm(temporaryDirectory, { recursive: true });
}

function starterLockfile(): string {
  return `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      react:
        specifier: ${STARTER_REACT_VERSION}
        version: ${STARTER_REACT_VERSION}
      react-dom:
        specifier: ${STARTER_REACT_VERSION}
        version: ${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION})
      remotion:
        specifier: ${STARTER_REMOTION_VERSION}
        version: ${STARTER_REMOTION_VERSION}(react-dom@${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION}))(react@${STARTER_REACT_VERSION})

packages:

  react-dom@${STARTER_REACT_VERSION}:
    resolution: {integrity: sha512-rVprimfGBG3DR+Tq0IQG2DT5PxKth1WIGDmj5yPmlzr4YBe7uyE+Du4oVqTDXZSHGGGXRtTJEGSSePyQCMBglQ==}
    peerDependencies:
      react: ^${STARTER_REACT_VERSION}

  react@${STARTER_REACT_VERSION}:
    resolution: {integrity: sha512-PWaYA1L/q9u2u7xYQi+Y3L3Yfnie7XyLeaJICV1MGD6LprsBxcAqGjYyr0eY3p+QdsA+x/Irkt4Qif8D63+Sbw==}
    engines: {node: '>=0.10.0'}

  remotion@${STARTER_REMOTION_VERSION}:
    resolution: {integrity: sha512-L47ImosLFn/uSEGhgV6nO9agEjrRTD+xfeIC4QlGSkCkHjG4IpH2dm0psRoLrK0eo8iiUc4rwUFNnNxQpLnx2w==}
    peerDependencies:
      react: '>=16.8.0'
      react-dom: '>=16.8.0'

  scheduler@0.27.0:
    resolution: {integrity: sha512-eNv+WrVbKu1f3vbYJT/xtiF5syA5HPIMtf9IgY/nKg0sWqzAUEvqY/xm7OcZc/qafLx/iO9FgOmeSAp4v5ti/Q==}

snapshots:

  react-dom@${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION}):
    dependencies:
      react: ${STARTER_REACT_VERSION}
      scheduler: 0.27.0

  react@${STARTER_REACT_VERSION}: {}

  remotion@${STARTER_REMOTION_VERSION}(react-dom@${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION}))(react@${STARTER_REACT_VERSION}):
    dependencies:
      react: ${STARTER_REACT_VERSION}
      react-dom: ${STARTER_REACT_VERSION}(react@${STARTER_REACT_VERSION})

  scheduler@0.27.0: {}
`;
}

function starterManifest(projectId: string): string {
  return JSON.stringify({ kind: "narracut-project", formatVersion: 1, projectId });
}

function starterCurrent(revisionId: string): string {
  return JSON.stringify({ revisionId });
}

function starterRevision(revisionId: string): string {
  return JSON.stringify({
    revisionId,
    previousRevisionId: null,
    source: "starter",
    summary: "Narracut starter Render Program",
  });
}

function starterProgramManifest(): string {
  return JSON.stringify({ apiVersion: 1, output: { width: 1920, height: 1080, fps: 30 } });
}

function starterPackageManifest(): string {
  return JSON.stringify({
    private: true,
    dependencies: {
      react: STARTER_REACT_VERSION,
      "react-dom": STARTER_REACT_VERSION,
      remotion: STARTER_REMOTION_VERSION,
    },
  });
}

function starterSource(): string {
  return 'import { AbsoluteFill } from "remotion";\n\n' +
    'type RenderProgramInputV1 = Readonly<{ apiVersion: 1 }>;\n\n' +
    'export function RenderProgram(input: RenderProgramInputV1) {\n' +
    '  void input;\n' +
    '  return <AbsoluteFill style={{ backgroundColor: "#090d0e" }} />;\n' +
    '}\n';
}

async function writeStarterProject(
  temporaryDirectory: string,
  projectId: string,
  revisionId: string,
): Promise<void> {
  const renderProgramDirectory = join(
    temporaryDirectory,
    ".narracut",
    "revisions",
    revisionId,
    "render-program",
  );
  await Promise.all([
    mkdir(join(temporaryDirectory, "assets"), { recursive: true }),
    mkdir(join(temporaryDirectory, "speech"), { recursive: true }),
    mkdir(join(temporaryDirectory, "renders"), { recursive: true }),
    mkdir(join(renderProgramDirectory, "src"), { recursive: true }),
    mkdir(join(renderProgramDirectory, "resources"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(temporaryDirectory, "narracut.json"), starterManifest(projectId)),
    writeFile(join(temporaryDirectory, "project.json"), '{"assets":[],"scenes":[]}'),
    writeFile(join(temporaryDirectory, "video.md"), ""),
    writeFile(join(temporaryDirectory, ".narracut", "current.json"), starterCurrent(revisionId)),
    writeFile(
      join(temporaryDirectory, ".narracut", "revisions", revisionId, "revision.json"),
      starterRevision(revisionId),
    ),
    writeFile(join(renderProgramDirectory, "program.json"), starterProgramManifest()),
    writeFile(join(renderProgramDirectory, "package.json"), starterPackageManifest()),
    writeFile(join(renderProgramDirectory, "pnpm-lock.yaml"), starterLockfile()),
    writeFile(join(renderProgramDirectory, "src", "RenderProgram.tsx"), starterSource()),
  ]);
}

async function validateStarterProject(
  temporaryDirectory: string,
  projectId: string,
  revisionId: string,
): Promise<void> {
  const renderProgramDirectory = join(
    temporaryDirectory,
    ".narracut",
    "revisions",
    revisionId,
    "render-program",
  );
  const [
    inspection,
    manifest,
    projectDsl,
    videoBrief,
    current,
    revision,
    programManifest,
    packageManifest,
    lockfile,
    source,
  ] = await Promise.all([
    inspectProjectVNext(temporaryDirectory),
    readFile(join(temporaryDirectory, "narracut.json"), "utf8"),
    readFile(join(temporaryDirectory, "project.json"), "utf8"),
    readFile(join(temporaryDirectory, "video.md"), "utf8"),
    readFile(join(temporaryDirectory, ".narracut", "current.json"), "utf8"),
    readFile(join(temporaryDirectory, ".narracut", "revisions", revisionId, "revision.json"), "utf8"),
    readFile(join(renderProgramDirectory, "program.json"), "utf8"),
    readFile(join(renderProgramDirectory, "package.json"), "utf8"),
    readFile(join(renderProgramDirectory, "pnpm-lock.yaml"), "utf8"),
    readFile(join(renderProgramDirectory, "src", "RenderProgram.tsx"), "utf8"),
  ]);
  if (
    inspection.manifest.projectId !== projectId ||
    inspection.project.assets.length !== 0 ||
    inspection.project.scenes.length !== 0 ||
    inspection.videoBrief !== "" ||
    manifest !== starterManifest(projectId) ||
    projectDsl !== '{"assets":[],"scenes":[]}' ||
    videoBrief !== "" ||
    current !== starterCurrent(revisionId) ||
    revision !== starterRevision(revisionId) ||
    programManifest !== starterProgramManifest() ||
    packageManifest !== starterPackageManifest() ||
    lockfile !== starterLockfile() ||
    source !== starterSource()
  ) {
    throw new Error("starter 项目复核结果与创建输入不一致。");
  }
}

const INTERNAL_JSON_LIMITS = {
  maxDepth: 8,
  maxArrayItems: 32,
  maxObjectFields: 64,
  maxNodes: 256,
  maxStringScalars: 4096,
  maxStringBytes: 16_384,
  maxNumberBytes: 32,
} as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readRegularUtf8(path: string, maxBytes: number): Promise<string> {
  const facts = await lstat(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > maxBytes) {
    throw new Error(`不是受支持的普通文件：${path}`);
  }
  return readFile(path, "utf8");
}

async function validateCurrentProjectState(
  inspection: ProjectVNextInspection,
): Promise<void> {
  const projectDirectory = inspection.projectDirectory;
  const currentPath = join(projectDirectory, ".narracut", "current.json");
  try {
    const current = parseStrictJson(
      await readRegularUtf8(currentPath, 4096),
      INTERNAL_JSON_LIMITS,
    );
    if (
      !isPlainRecord(current) ||
      Object.keys(current).length !== 1 ||
      typeof current.revisionId !== "string" ||
      !UUID_PATTERN.test(current.revisionId)
    ) {
      throw new Error("当前修订指针无效。");
    }
    const revisionId = current.revisionId;
    const revisionDirectory = join(projectDirectory, ".narracut", "revisions", revisionId);
    const renderProgramDirectory = join(revisionDirectory, "render-program");
    if (!inspection.renderPrograms.directories.includes(renderProgramDirectory)) {
      throw new Error("当前修订没有可检查的 Render Program。");
    }
    const [revision, program, packageJson, lockfile, source] = await Promise.all([
      readRegularUtf8(join(revisionDirectory, "revision.json"), 16_384)
        .then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join(renderProgramDirectory, "program.json"), 16_384)
        .then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join(renderProgramDirectory, "package.json"), 65_536)
        .then((value) => parseStrictJson(value, INTERNAL_JSON_LIMITS)),
      readRegularUtf8(join(renderProgramDirectory, "pnpm-lock.yaml"), 1_048_576),
      readRegularUtf8(join(renderProgramDirectory, "src", "RenderProgram.tsx"), 10_485_760),
    ]);
    if (
      !isPlainRecord(revision) ||
      Object.keys(revision).some((key) =>
        !["revisionId", "previousRevisionId", "source", "summary"].includes(key)
      ) ||
      revision.revisionId !== revisionId ||
      !(revision.previousRevisionId === null ||
        (typeof revision.previousRevisionId === "string" && UUID_PATTERN.test(revision.previousRevisionId))) ||
      typeof revision.source !== "string" ||
      typeof revision.summary !== "string"
    ) {
      throw new Error("当前修订元数据无效。");
    }
    const output = isPlainRecord(program) && isPlainRecord(program.output)
      ? program.output
      : null;
    if (
      !isPlainRecord(program) ||
      program.apiVersion !== 1 ||
      output === null ||
      ![output.width, output.height, output.fps].every(
        (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0,
      )
    ) {
      throw new Error("当前 Render Program manifest 无效。");
    }
    if (!isPlainRecord(packageJson) || !isPlainRecord(packageJson.dependencies)) {
      throw new Error("当前 Render Program package manifest 无效。");
    }
    const dependencies = Object.entries(packageJson.dependencies);
    if (
      packageJson.private !== true ||
      dependencies.length === 0 ||
      dependencies.some(([, version]) =>
        typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)
      ) ||
      dependencies.some(([name, version]) =>
        !lockfile.includes(`      ${name}:\n        specifier: ${String(version)}\n`)
      ) ||
      !source.includes("export function RenderProgram(input:")
    ) {
      throw new Error("当前 Render Program 依赖或入口无效。");
    }
  } catch (cause) {
    if (cause instanceof ProjectLifecycleError) throw cause;
    throw new ProjectLifecycleError(
      "PROJECT_CURRENT_INVALID",
      currentPath,
      `当前 Render Program 修订无效：${projectDirectory}。Narracut 不会打开或修复该项目。`,
      { cause },
    );
  }
}

type DirectoryIdentity = { dev: number; ino: number };

async function captureDirectoryIdentity(path: string): Promise<DirectoryIdentity> {
  const facts = await lstat(path);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new Error(`路径不是普通目录：${path}`);
  }
  return { dev: facts.dev, ino: facts.ino };
}

function hasIdentity(
  facts: { dev: number; ino: number },
  identity: DirectoryIdentity,
): boolean {
  return facts.dev === identity.dev && facts.ino === identity.ino;
}

async function cleanupOwnedTemporaryDirectory(
  temporaryDirectory: string,
  identity: DirectoryIdentity,
  markerWritten: boolean,
  projectDirectory: string,
  operationToken: string,
): Promise<void> {
  let facts;
  try {
    facts = await lstat(temporaryDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, identity)) {
    throw new Error("创建临时目录已被替换，无法证明清理所有权。");
  }
  if (markerWritten) {
    const marker = JSON.parse(await readRegularUtf8(
      join(temporaryDirectory, OPERATION_MARKER),
      4096,
    )) as unknown;
    if (!isCreateOperationMarker(marker, projectDirectory, operationToken)) {
      throw new Error("创建临时目录标记已变化，无法证明清理所有权。");
    }
  }
  await rm(temporaryDirectory, { recursive: true });
}

async function cleanupTargetReservation(
  projectDirectory: string,
  identity: DirectoryIdentity,
): Promise<void> {
  let facts;
  try {
    facts = await lstat(projectDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, identity)) {
    throw new Error("发布目标保留目录已被替换，无法证明清理所有权。");
  }
  if ((await readdir(projectDirectory)).length !== 0) {
    throw new Error("发布目标保留目录出现外部内容，Narracut 拒绝删除。");
  }
  await rmdir(projectDirectory);
}

export async function createProjectVNext(
  inputPath: string,
  options: CreateProjectOptions = {},
): Promise<CreatedProjectVNext> {
  const projectDirectory = resolve(inputPath);
  const projectName = basename(projectDirectory);
  if (projectName === "" || projectName === "." || projectName === "..") {
    throw new ProjectLifecycleError(
      "PROJECT_CREATE_TARGET_INVALID",
      projectDirectory,
      "创建目标必须是带有项目文件夹名的绝对路径。",
    );
  }
  const temporaryDirectory = join(dirname(projectDirectory), `.${projectName}.narracut-tmp`);
  const createId = options.createId ?? randomUUID;
  const projectId = createId();
  const revisionId = createId();
  const operationToken = randomUUID();
  let temporaryIdentity: DirectoryIdentity | null = null;
  let markerWritten = false;
  let targetReservationIdentity: DirectoryIdentity | null = null;
  try {
    if (await pathExists(projectDirectory)) {
      throw new ProjectLifecycleError(
        "PROJECT_CREATE_TARGET_EXISTS",
        projectDirectory,
        `创建目标已存在：${projectDirectory}。请选择尚不存在的新路径。`,
      );
    }
    if (await pathExists(temporaryDirectory)) {
      await removeConfirmedCreateResidue(
        temporaryDirectory,
        projectDirectory,
        options.confirmTemporaryCleanup === true,
      );
    }
    await mkdir(temporaryDirectory);
    temporaryIdentity = await captureDirectoryIdentity(temporaryDirectory);
    await writeFile(join(temporaryDirectory, OPERATION_MARKER), JSON.stringify({
      kind: "narracut-operation",
      version: 1,
      operation: "create",
      targetDirectory: projectDirectory,
      operationToken,
    }));
    markerWritten = true;
    await writeStarterProject(temporaryDirectory, projectId, revisionId);
    await validateStarterProject(temporaryDirectory, projectId, revisionId);
    if (process.platform !== "win32") {
      try {
        await mkdir(projectDirectory);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          throw new ProjectLifecycleError(
            "PROJECT_CREATE_TARGET_EXISTS",
            projectDirectory,
            `原子发布前目标已经出现：${projectDirectory}。Narracut 拒绝接管。`,
            { cause: error },
          );
        }
        throw error;
      }
      targetReservationIdentity = await captureDirectoryIdentity(projectDirectory);
    } else if (await pathExists(projectDirectory)) {
      throw new ProjectLifecycleError(
        "PROJECT_CREATE_TARGET_EXISTS",
        projectDirectory,
        `原子发布前目标已经出现：${projectDirectory}。Narracut 拒绝接管。`,
      );
    }
    await unlink(join(temporaryDirectory, OPERATION_MARKER));
    markerWritten = false;
    if (targetReservationIdentity !== null) {
      const currentReservation = await lstat(projectDirectory);
      if (
        !currentReservation.isDirectory() ||
        currentReservation.isSymbolicLink() ||
        !hasIdentity(currentReservation, targetReservationIdentity) ||
        (await readdir(projectDirectory)).length !== 0
      ) {
        throw new ProjectLifecycleError(
          "PROJECT_CREATE_TARGET_EXISTS",
          projectDirectory,
          `原子发布时目标保留目录发生变化：${projectDirectory}。Narracut 拒绝覆盖。`,
        );
      }
    }
    await rename(temporaryDirectory, projectDirectory);
    temporaryIdentity = null;
    targetReservationIdentity = null;
    return { projectDirectory, projectId, revisionId };
  } catch (cause) {
    try {
      if (targetReservationIdentity !== null) {
        await cleanupTargetReservation(projectDirectory, targetReservationIdentity);
      }
      if (temporaryIdentity !== null) {
        await cleanupOwnedTemporaryDirectory(
          temporaryDirectory,
          temporaryIdentity,
          markerWritten,
          projectDirectory,
          operationToken,
        );
      }
    } catch (cleanupCause) {
      throw new ProjectLifecycleError(
        "PROJECT_CREATE_CLEANUP_FAILED",
        temporaryDirectory,
        `创建失败，且无法证明临时产物仍归本次操作所有；已保留现场：${temporaryDirectory}。`,
        { cause: cleanupCause },
      );
    }
    if (cause instanceof ProjectLifecycleError) throw cause;
    throw new ProjectLifecycleError(
      "PROJECT_CREATE_FAILED",
      projectDirectory,
      `无法创建 Project VNext：${projectDirectory}。`,
      { cause },
    );
  }
}

export type OpenedProjectVNext = {
  inspection: ProjectVNextInspection;
  saveProject: (
    project: unknown,
    baselineRevision: string,
  ) => Promise<{ inspection: ProjectVNextInspection }>;
  importAsset: (input: {
    sourcePath: string;
    targetSceneId?: string;
    baselineRevision: string;
  }) => Promise<{
    status: "imported-and-bound" | "imported-unbound" | "rejected" | "failed";
    code: string;
    message: string;
    asset: { id: string; path: string } | null;
    inspection: ProjectVNextInspection;
  }>;
  release: () => Promise<void>;
};

type LeaseMarker = {
  kind: "narracut-project-lease";
  version: 1;
  projectDirectory: string;
  projectId: string;
  pid: number;
  processIdentity: string | null;
  token: string;
};

async function readProcessIdentity(pid: number): Promise<string | null> {
  if (process.platform !== "linux") return null;
  try {
    const statBytes = await readFile(`/proc/${pid}/stat`, "utf8");
    const commandEnd = statBytes.lastIndexOf(")");
    if (commandEnd < 0) return null;
    return statBytes.slice(commandEnd + 2).trim().split(/\s+/u)[19] ?? null;
  } catch {
    return null;
  }
}

async function leaseHolderIsAlive(marker: LeaseMarker): Promise<boolean> {
  if (!Number.isSafeInteger(marker.pid) || marker.pid <= 0) return true;
  try {
    process.kill(marker.pid, 0);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    return true;
  }
  if (marker.processIdentity === null) return true;
  const currentIdentity = await readProcessIdentity(marker.pid);
  return currentIdentity === null || currentIdentity === marker.processIdentity;
}

function isLeaseMarker(value: unknown): value is LeaseMarker {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const marker = value as Partial<LeaseMarker>;
  return marker.kind === "narracut-project-lease" &&
    marker.version === 1 &&
    typeof marker.projectDirectory === "string" &&
    typeof marker.projectId === "string" &&
    typeof marker.pid === "number" &&
    (marker.processIdentity === null || typeof marker.processIdentity === "string") &&
    typeof marker.token === "string";
}

async function clearStaleLease(leasePath: string): Promise<boolean> {
  let facts;
  let marker: unknown;
  try {
    facts = await lstat(leasePath);
    if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.size > 4096) return false;
    marker = JSON.parse(await readFile(leasePath, "utf8"));
  } catch {
    return false;
  }
  if (!isLeaseMarker(marker) || await leaseHolderIsAlive(marker)) return false;
  const currentFacts = await lstat(leasePath);
  if (currentFacts.dev !== facts.dev || currentFacts.ino !== facts.ino) return false;
  await unlink(leasePath);
  return true;
}

type ProjectLease = {
  assertCurrent: () => Promise<void>;
  release: () => Promise<void>;
};

async function acquireProjectLease(
  inspection: ProjectVNextInspection,
): Promise<ProjectLease> {
  const projectDirectory = inspection.projectDirectory;
  const leasePath = join(projectDirectory, ".narracut", "workspace.lease");
  if (activeLeasePaths.has(leasePath)) {
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `项目已由另一个 Narracut 工作区占用：${projectDirectory}。`,
    );
  }
  const marker: LeaseMarker = {
    kind: "narracut-project-lease",
    version: 1,
    projectDirectory,
    projectId: inspection.manifest.projectId,
    pid: process.pid,
    processIdentity: await readProcessIdentity(process.pid),
    token: randomUUID(),
  };
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await openFile(leasePath, "wx", 0o600);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (attempt === 0 && await clearStaleLease(leasePath)) continue;
      throw new ProjectLifecycleError(
        "PROJECT_IN_USE",
        projectDirectory,
        `项目已由另一个 Narracut 工作区占用：${projectDirectory}。`,
        { cause: error },
      );
    }
  }
  if (handle === undefined) {
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `无法取得项目写入租约：${projectDirectory}。`,
    );
  }
  try {
    await handle.writeFile(JSON.stringify(marker));
    await handle.sync();
  } catch (cause) {
    await handle.close();
    await rm(leasePath, { force: true });
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `无法写入项目租约：${projectDirectory}。`,
      { cause },
    );
  }
  await handle.close();
  let leaseDirectoryHandle;
  try {
    leaseDirectoryHandle = await openFile(dirname(leasePath), "r");
  } catch (cause) {
    await rm(leasePath, { force: true });
    throw new ProjectLifecycleError(
      "PROJECT_IN_USE",
      projectDirectory,
      `无法锚定项目租约目录：${projectDirectory}。`,
      { cause },
    );
  }
  activeLeasePaths.add(leasePath);
  let released = false;
  const assertCurrent = async () => {
    if (released) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        projectDirectory,
        "项目工作区租约已经释放；Narracut 已停止写入。",
      );
    }
    try {
      const current = JSON.parse(await readFile(leasePath, "utf8")) as Partial<LeaseMarker>;
      if (current.token !== marker.token || current.projectId !== marker.projectId) throw new Error("租约身份不匹配");
    } catch (cause) {
      throw new ProjectLifecycleError(
        "PROJECT_IDENTITY_LOST",
        projectDirectory,
        "项目写入租约已经失效；Narracut 已停止写入并保留内存修改。",
        { cause },
      );
    }
  };
  const release = async () => {
    if (released) return;
    released = true;
    activeLeasePaths.delete(leasePath);
    const anchoredLeasePath = process.platform === "win32"
      ? leasePath
      : `/dev/fd/${leaseDirectoryHandle.fd}/workspace.lease`;
    try {
      const current = JSON.parse(await readFile(anchoredLeasePath, "utf8")) as Partial<LeaseMarker>;
      if (current.token === marker.token) await unlink(anchoredLeasePath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    } finally {
      await leaseDirectoryHandle.close();
    }
  };
  return { assertCurrent, release };
}

function revisionOf(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function currentProjectRevision(projectFile: string, message: string): Promise<string> {
  try {
    return await readProjectVNextRevision(projectFile);
  } catch (cause) {
    throw new ProjectLifecycleError(
      "PROJECT_SAVE_CONFLICT",
      projectFile,
      message,
      { cause },
    );
  }
}

function assertWorkbenchMutation(current: ProjectVNext, next: ProjectVNext, projectPath: string): void {
  if (JSON.stringify(current.assets) !== JSON.stringify(next.assets)) {
    throw new ProjectLifecycleError(
      "PROJECT_SAVE_FAILED",
      projectPath,
      "本次保存只能修改 Scene；Asset 登记表必须保持不变。",
    );
  }
  const currentScenes = new Map(current.scenes.map((scene) => [scene.id, scene]));
  for (const scene of next.scenes) {
    const previous = currentScenes.get(scene.id);
    if (previous === undefined) {
      if (scene.speech !== undefined) {
        throw new ProjectLifecycleError(
          "PROJECT_SAVE_FAILED",
          projectPath,
          "新增或复制的 Scene 不能创建 Speech；请从表格工作区重试。",
        );
      }
      continue;
    }
    if (scene.narration.text !== previous.narration.text && scene.speech !== undefined) {
      throw new ProjectLifecycleError(
        "PROJECT_SAVE_FAILED",
        projectPath,
        `Scene ${scene.id} 修改 Narration 后必须移除失效 Speech。`,
      );
    }
    if (
      scene.speech !== undefined &&
      JSON.stringify(scene.speech) !== JSON.stringify(previous.speech)
    ) {
      throw new ProjectLifecycleError(
        "PROJECT_SAVE_FAILED",
        projectPath,
        `Scene ${scene.id} 的 Speech 不属于本票可写范围。`,
      );
    }
  }
}

function assetSourceRejection(
  inspection: ProjectVNextInspection,
  code: string,
  message: string,
): Awaited<ReturnType<OpenedProjectVNext["importAsset"]>> {
  return { status: "rejected", code, message, asset: null, inspection };
}

const MAX_ASSET_FILENAME_BYTES = 255;

function truncateUtf8(value: string, maxBytes: number): string {
  let result = value;
  while (Buffer.byteLength(result, "utf8") > maxBytes) result = [...result].slice(0, -1).join("");
  return result;
}

function safeAssetFilename(sourcePath: string): string {
  const original = basename(sourcePath).replace(/[\u0000-\u001f\u007f]/gu, "_");
  const fallback = original === "" || original === "." || original === ".." ? "asset" : original;
  if (Buffer.byteLength(fallback, "utf8") <= MAX_ASSET_FILENAME_BYTES) return fallback;
  const extensionIndex = fallback.lastIndexOf(".");
  const extension = extensionIndex > 0 && Buffer.byteLength(fallback.slice(extensionIndex), "utf8") <= 64
    ? fallback.slice(extensionIndex)
    : "";
  const stem = truncateUtf8(
    extension === "" ? fallback : fallback.slice(0, extensionIndex),
    MAX_ASSET_FILENAME_BYTES - Buffer.byteLength(extension, "utf8"),
  );
  return `${stem || "asset"}${extension}`;
}

function suffixedAssetFilename(filename: string, suffix: number): string {
  const extensionIndex = filename.lastIndexOf(".");
  const stem = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : "";
  const marker = suffix === 1 ? "" : `-${suffix}`;
  const stemBudget = MAX_ASSET_FILENAME_BYTES -
    Buffer.byteLength(marker, "utf8") - Buffer.byteLength(extension, "utf8");
  return `${truncateUtf8(stem, Math.max(1, stemBudget)) || "asset"}${marker}${extension}`;
}

async function uniqueAssetPath(assetsDirectory: string, sourcePath: string): Promise<string> {
  const filename = safeAssetFilename(sourcePath);
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const candidate = suffixedAssetFilename(filename, suffix);
    const relativePath = `assets/${candidate}`;
    try {
      await access(join(assetsDirectory, candidate));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return relativePath;
      throw error;
    }
  }
  return `assets/${randomUUID()}`;
}

async function isProjectControlFile(
  projectDirectory: string,
  sourcePath: string,
  sourceFacts: Stats,
): Promise<boolean> {
  for (const name of ["narracut.json", "project.json", "video.md"]) {
    const controlPath = join(projectDirectory, name);
    if (resolve(sourcePath) === controlPath) return true;
    const controlFacts = await lstat(controlPath);
    if (sourceFacts.dev === controlFacts.dev && sourceFacts.ino === controlFacts.ino) return true;
  }
  return false;
}

async function copyStableFile(
  source: FileHandle,
  opened: Stats,
  temporaryPath: string,
  assertDestinationCurrent: () => Promise<void>,
): Promise<void> {
  let destination = null;
  try {
    await assertDestinationCurrent();
    destination = await openFile(temporaryPath, "wx", 0o600);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(buffer, written, bytesRead - written, position + written);
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await destination.sync();
    const after = await source.stat();
    if (
      after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || position !== opened.size
    ) {
      throw new Error("导入源在复制期间发生变化。");
    }
  } finally {
    await destination?.close().catch(() => undefined);
  }
}

async function replaceProjectFile(
  projectFile: string,
  bytes: Buffer,
  assertWritable: () => Promise<void>,
): Promise<void> {
  const temporaryFile = join(dirname(projectFile), `.project.json.${randomUUID()}.tmp`);
  let committed = false;
  try {
    const handle = await openFile(temporaryFile, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertWritable();
    await rename(temporaryFile, projectFile);
    committed = true;
    try {
      const directory = await openFile(dirname(projectFile), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch {
      // rename 是提交点；提交后的目录同步/清理失败不得回报为保存失败。
    }
  } finally {
    if (!committed) await rm(temporaryFile, { force: true }).catch(() => undefined);
  }
}

export async function openProjectVNext(inputPath: string): Promise<OpenedProjectVNext> {
  const projectDirectory = await realpath(resolve(inputPath)).catch(() => resolve(inputPath));
  try {
    const initialInspection = await inspectProjectVNext(projectDirectory);
    await validateCurrentProjectState(initialInspection);
    const directoryIdentity = await captureDirectoryIdentity(projectDirectory);
    const lease = await acquireProjectLease(initialInspection);
    let assetsDirectoryHandle: FileHandle | null = null;
    try {
      const inspection = await inspectProjectVNext(projectDirectory);
      await validateCurrentProjectState(inspection);
      if (inspection.manifest.projectId !== initialInspection.manifest.projectId) {
        throw new ProjectLifecycleError(
          "PROJECT_IDENTITY_LOST",
          projectDirectory,
          `取得租约时项目身份发生变化：${projectDirectory}。`,
        );
      }
      const assetsDirectory = join(projectDirectory, "assets");
      const assetsDirectoryIdentity = await captureDirectoryIdentity(assetsDirectory);
      assetsDirectoryHandle = await openFile(assetsDirectory, "r");
      const openedAssetsDirectory = await assetsDirectoryHandle.stat();
      if (!openedAssetsDirectory.isDirectory() || !hasIdentity(openedAssetsDirectory, assetsDirectoryIdentity)) {
        throw new ProjectLifecycleError(
          "PROJECT_IDENTITY_LOST",
          assetsDirectory,
          "Asset 目录身份在打开期间发生变化；Narracut 已停止写入。",
        );
      }
      const anchoredAssetsDirectory = process.platform === "win32"
        ? assetsDirectory
        : `/dev/fd/${assetsDirectoryHandle.fd}`;
      let currentInspection = inspection;
      let saveQueue = Promise.resolve();
      let closing = false;
      let releasePromise: Promise<void> | null = null;
      const assertWritable = async () => {
        await lease.assertCurrent();
        let facts;
        try {
          facts = await lstat(projectDirectory);
        } catch (cause) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "项目目录已经移动或不可用；Narracut 已停止写入并保留内存修改。",
            { cause },
          );
        }
        if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, directoryIdentity)) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "项目目录身份已经变化；Narracut 已停止写入并保留内存修改。",
          );
        }
        try {
          const manifestPath = join(projectDirectory, "narracut.json");
          const manifestFacts = await lstat(manifestPath);
          if (!manifestFacts.isFile() || manifestFacts.isSymbolicLink() || manifestFacts.nlink !== 1 || manifestFacts.size > 4096) {
            throw new Error("项目清单文件身份无效");
          }
          const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { projectId?: unknown };
          if (manifest.projectId !== initialInspection.manifest.projectId) {
            throw new Error("项目清单中的 projectId 已变化");
          }
        } catch (cause) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "项目清单身份已经变化；Narracut 已停止写入并保留内存修改。",
            { cause },
          );
        }
      };
      const assertAssetsDirectoryCurrent = async () => {
        await assertWritable();
        let facts;
        try {
          facts = await lstat(assetsDirectory);
        } catch (cause) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            assetsDirectory,
            "Asset 目录已移动或不可用；Narracut 已停止导入。",
            { cause },
          );
        }
        if (!facts.isDirectory() || facts.isSymbolicLink() || !hasIdentity(facts, assetsDirectoryIdentity)) {
          throw new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            assetsDirectory,
            "Asset 目录身份已变化；Narracut 已停止导入。",
          );
        }
      };
      const saveProject: OpenedProjectVNext["saveProject"] = (project, baselineRevision) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "项目工作区正在关闭；Narracut 已停止接收新的写入。",
          ));
        }
        const operation = saveQueue.then(async () => {
          const projectFile = join(projectDirectory, "project.json");
          try {
            await assertWritable();
            if (await currentProjectRevision(
              projectFile,
              "无法确认 project.json 仍是当前磁盘基线；Narracut 已停止自动保存。",
            ) !== baselineRevision) {
              throw new ProjectLifecycleError(
                "PROJECT_SAVE_CONFLICT",
                projectFile,
                "project.json 已被外部修改；Narracut 已停止自动保存，不会覆盖磁盘内容。",
              );
            }
            const validated = validateProjectVNextForSave(project, projectFile);
            assertWorkbenchMutation(currentInspection.project, validated.project, projectFile);
            const { assetStates, warnings } = await validateProjectVNextResources(
              projectDirectory,
              validated.project,
            );
            const nextRevision = revisionOf(validated.bytes);
            if (nextRevision !== baselineRevision) {
              await replaceProjectFile(projectFile, validated.bytes, async () => {
                await assertWritable();
                if (await currentProjectRevision(
                  projectFile,
                  "project.json 在提交前变得不可安全读取；Narracut 拒绝覆盖。",
                ) !== baselineRevision) {
                  throw new ProjectLifecycleError(
                    "PROJECT_SAVE_CONFLICT",
                    projectFile,
                    "project.json 在提交前发生外部变化；Narracut 拒绝覆盖。",
                  );
                }
              });
            }
            currentInspection = {
              ...currentInspection,
              project: validated.project,
              projectRevision: nextRevision,
              assetStates,
              warnings,
            };
            return { inspection: currentInspection };
          } catch (cause) {
            if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) {
              throw cause;
            }
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_FAILED",
              projectFile,
              "无法原子保存 project.json；Narracut 已保留内存修改。",
              { cause },
            );
          }
        });
        saveQueue = operation.then(() => undefined, () => undefined);
        return operation;
      };
      const importAsset: OpenedProjectVNext["importAsset"] = (input) => {
        if (closing) {
          return Promise.reject(new ProjectLifecycleError(
            "PROJECT_IDENTITY_LOST",
            projectDirectory,
            "项目工作区正在关闭；Narracut 已停止接收新的写入。",
          ));
        }
        const operation = saveQueue.then(async () => {
          const projectFile = join(projectDirectory, "project.json");
          const sourcePath = resolve(input.sourcePath);
          await assertWritable();
          if (await currentProjectRevision(
            projectFile,
            "无法确认 project.json 仍是当前磁盘基线；Narracut 已停止导入。",
          ) !== input.baselineRevision) {
            throw new ProjectLifecycleError(
              "PROJECT_SAVE_CONFLICT",
              projectFile,
              "project.json 已被外部修改；Narracut 已停止导入，不会覆盖磁盘内容。",
            );
          }
          let pathFacts;
          try {
            pathFacts = await lstat(sourcePath);
          } catch (cause) {
            return {
              status: "failed" as const,
              code: "ASSET_SOURCE_UNAVAILABLE",
              message: "无法读取导入源；请检查文件是否仍存在且可访问。",
              asset: null,
              inspection: currentInspection,
            };
          }
          if (pathFacts.isSymbolicLink()) {
            return assetSourceRejection(
              currentInspection,
              "ASSET_SOURCE_SYMBOLIC_LINK",
              "导入源是符号链接；请选择链接指向的普通文件。",
            );
          }
          if (!pathFacts.isFile()) {
            return assetSourceRejection(
              currentInspection,
              "ASSET_SOURCE_NOT_FILE",
              pathFacts.isDirectory()
                ? "导入源是目录；请选择一个或多个普通文件。"
                : "导入源不是普通文件；请选择可复制的普通文件。",
            );
          }
          let source: FileHandle;
          try {
            source = await openFile(sourcePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
          } catch (cause) {
            return {
              status: "failed" as const,
              code: "ASSET_SOURCE_UNAVAILABLE",
              message: "无法安全打开导入源；请重新选择文件。",
              asset: null,
              inspection: currentInspection,
            };
          }
          try {
            const sourceFacts = await source.stat();
            if (!sourceFacts.isFile() || !hasIdentity(sourceFacts, pathFacts)) {
              return assetSourceRejection(
                currentInspection,
                "ASSET_SOURCE_CHANGED",
                "导入源在打开时发生变化；请重新选择文件。",
              );
            }
            if (await isProjectControlFile(projectDirectory, sourcePath, sourceFacts)) {
              return assetSourceRejection(
                currentInspection,
                "ASSET_SOURCE_PROJECT_CONTROL_FILE",
                "项目控制文件不能登记为 Asset。",
              );
            }
            if (currentInspection.project.assets.length >= 1_000) {
              return assetSourceRejection(
                currentInspection,
                "PROJECT_ASSET_LIMIT_REACHED",
                "项目已达到 1,000 个 Asset 上限。",
              );
            }

            await assertAssetsDirectoryCurrent();
            const asset = {
              id: randomUUID(),
              path: await uniqueAssetPath(anchoredAssetsDirectory, sourcePath),
            };
            const temporaryPath = join(anchoredAssetsDirectory, `.import-${randomUUID()}.tmp`);
            let finalPath = join(anchoredAssetsDirectory, basename(asset.path));
            let published = false;
            try {
              await copyStableFile(source, sourceFacts, temporaryPath, assertAssetsDirectoryCurrent);
              for (let attempt = 0; attempt < 10_000; attempt += 1) {
                try {
                  await assertAssetsDirectoryCurrent();
                  await link(temporaryPath, finalPath);
                  published = true;
                  break;
                } catch (cause) {
                  if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST")) throw cause;
                  asset.path = await uniqueAssetPath(anchoredAssetsDirectory, sourcePath);
                  finalPath = join(anchoredAssetsDirectory, basename(asset.path));
                }
              }
              if (!published) throw new Error("无法为 Asset 分配唯一项目路径。");
              await assertAssetsDirectoryCurrent();
              await unlink(temporaryPath);

              const project = structuredClone(currentInspection.project);
              project.assets.push(asset);
              const targetScene = input.targetSceneId === undefined
                ? undefined
                : project.scenes.find((scene) => scene.id === input.targetSceneId);
              const bound = targetScene !== undefined && targetScene.assetIds.length < 256;
              if (bound) targetScene.assetIds.push(asset.id);
              const validated = validateProjectVNextForSave(project, projectFile);
              const { assetStates, warnings } = await validateProjectVNextResources(
                projectDirectory,
                validated.project,
              );
              const nextRevision = revisionOf(validated.bytes);
              await replaceProjectFile(projectFile, validated.bytes, async () => {
                await assertAssetsDirectoryCurrent();
                if (await currentProjectRevision(
                  projectFile,
                  "project.json 在提交前变得不可安全读取；Narracut 拒绝完成导入。",
                ) !== input.baselineRevision) {
                  throw new ProjectLifecycleError(
                    "PROJECT_SAVE_CONFLICT",
                    projectFile,
                    "project.json 在导入提交前发生外部变化；Narracut 拒绝覆盖。",
                  );
                }
              });
              currentInspection = {
                ...currentInspection,
                project: validated.project,
                projectRevision: nextRevision,
                assetStates,
                warnings,
              };
              return {
                status: bound ? "imported-and-bound" as const : "imported-unbound" as const,
                code: bound ? "ASSET_IMPORTED_AND_BOUND" : "ASSET_IMPORTED_UNBOUND",
                message: bound
                  ? "Asset 已导入并绑定到原目标 Scene。"
                  : targetScene === undefined && input.targetSceneId !== undefined
                    ? "Asset 已导入；原目标 Scene 已不存在，因此保持暂未绑定。"
                    : targetScene !== undefined
                      ? "Asset 已导入；原目标 Scene 已达到 256 个引用上限，因此保持暂未绑定。"
                      : "Asset 已导入并登记为暂未绑定。",
                asset,
                inspection: currentInspection,
              };
            } catch (cause) {
              if (published) await unlink(finalPath).catch(() => undefined);
              await unlink(temporaryPath).catch(() => undefined);
              if (cause instanceof ProjectLifecycleError || cause instanceof ProjectInspectionError) throw cause;
              return {
                status: "failed" as const,
                code: "ASSET_IMPORT_FAILED",
                message: cause instanceof Error ? cause.message : "无法复制并登记 Asset。",
                asset: null,
                inspection: currentInspection,
              };
            }
          } finally {
            await source.close().catch(() => undefined);
          }
        });
        saveQueue = operation.then(() => undefined, () => undefined);
        return operation;
      };
      const release = async () => {
        closing = true;
        releasePromise ??= saveQueue.then(async () => {
          try {
            await lease.release();
          } finally {
            await assetsDirectoryHandle?.close();
            assetsDirectoryHandle = null;
          }
        });
        await releasePromise;
      };
      return { inspection, saveProject, importAsset, release };
    } catch (error) {
      try {
        await lease.release();
      } finally {
        await assetsDirectoryHandle?.close();
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ProjectLifecycleError || error instanceof ProjectInspectionError) {
      throw error;
    }
    throw new ProjectLifecycleError(
      "PROJECT_OPEN_FAILED",
      projectDirectory,
      `无法打开 Project VNext：${projectDirectory}。`,
      { cause: error },
    );
  }
}

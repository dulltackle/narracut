import { create } from "zustand";

import {
  CURRENT_SCHEMA_VERSION,
  CURRENT_TTS_PROFILE_ID,
  migrateKnownProjectToCurrent,
  ProjectMigrationError,
  readSchemaVersion,
  type Asset,
  type Diagnostic,
  type Project,
  type Speech,
  type Visual,
  validateProjectConsistency,
  validateProjectStructure,
  validateSpeechFreshness,
} from "../shared/project";
import { createClientUuid } from "./client-uuid";
import { diagnosticsFromMediaProbe } from "../shared/diagnostics";

export type ProjectInfo = {
  projectDirectory: string;
  projectFile: string;
  fallbackName: string;
};

type UnknownProject = Record<string, unknown>;

export type SaveStatus =
  | "saved"
  | "pending"
  | "saving"
  | "retrying"
  | "error"
  | "blocked-validation"
  | "migrated"
  | "occupied"
  | "conflict";

type ExternalConflict = {
  diskRaw: string;
  diskEtag: string;
  diskProject?: Project;
  diskSavedCanonical?: string;
  diskDiagnostics: Diagnostic[];
  migrated: boolean;
  errorMessage?: string;
  resolutionError?: string;
};

type HistoryFocusTarget =
  | "narration"
  | "visual-type"
  | "reorder"
  | "scene-select"
  | "add-scene";

type HistoryFocusRequest = {
  eventId: number;
  sceneId?: string;
  target: HistoryFocusTarget;
  force?: boolean;
};

type HistoryEntry = {
  id: number;
  before: Project;
  after: Project;
  label: string;
  sceneId?: string;
  focusTarget?: HistoryFocusTarget;
  deletedScene?: {
    sceneId: string;
    selectedSceneIdAfter?: string;
    focusSceneIdAfter?: string;
  };
  beforeSpeechRevisions: Record<string, string>;
  afterSpeechRevisions: Record<string, string>;
};

export type ProjectJobResult =
  | {
      kind: "speech";
      jobId: string;
      sceneId: string;
      expected: { narrationText: string; speech: Speech | undefined };
      speech: Speech;
      fileRevision: string;
    }
  | {
      kind: "asset";
      sceneId: string;
      expected: {
        visualType: "image" | "video";
        assetId: string | undefined;
      };
      asset: Asset;
      videoDurationInFrames?: number;
    };

type ProjectState = {
  phase: "loading" | "ready" | "readonly" | "occupied" | "error";
  project?: Project;
  unknownProject?: UnknownProject;
  unknownVersion?: number;
  info?: ProjectInfo;
  diagnostics: Diagnostic[];
  mediaDiagnostics: Diagnostic[];
  mediaAvailability: Record<string, boolean>;
  mediaRevisions: Record<string, string>;
  videoDurationInFrames: Record<string, number>;
  errorMessage?: string;
  selectedSceneId?: string;
  saveStatus: SaveStatus;
  saveErrorMessage?: string;
  saveRetryAttempt?: number;
  saveDiagnostics: Diagnostic[];
  dirty: boolean;
  migrationPending: boolean;
  migrationSavedNotice: boolean;
  leaseStatus: "none" | "acquired" | "occupied";
  leaseLostWhileEditing: boolean;
  externalConflict?: ExternalConflict;
  conflictResolving: boolean;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  historyNotice?: string;
  historyAnnouncement?: string;
  historyEventId: number;
  historyFocusRequest?: HistoryFocusRequest;
  taskDrawerOpen: boolean;
  speechCommitInFlight: boolean;
  load: () => Promise<void>;
  flushSave: () => Promise<void>;
  retrySave: () => Promise<void>;
  checkDiskRevision: () => Promise<void>;
  recheckLease: () => Promise<void>;
  loadDiskVersion: () => Promise<void>;
  keepCurrentVersion: () => Promise<void>;
  selectScene: (sceneId: string) => void;
  setTaskDrawerOpen: (open: boolean) => void;
  updateProjectName: (name: string) => Promise<void>;
  updateTheme: (theme: Project["theme"]) => Promise<void>;
  updateNarration: (sceneId: string, text: string) => void;
  endTextTransaction: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clearHistoryNotice: () => void;
  registerAsset: (asset: Asset, videoDurationInFrames?: number) => Promise<boolean>;
  bindAsset: (sceneId: string, assetId: string) => Promise<boolean>;
  clearAsset: (sceneId: string) => Promise<boolean>;
  applyJobResult: (result: ProjectJobResult) => Promise<boolean>;
  updateVisual: (sceneId: string, visual: Visual) => Promise<void>;
  reorderScene: (sceneId: string, targetIndex: number) => Promise<void>;
  deleteScene: (sceneId: string) => Promise<boolean>;
  addScenesFromLines: (
    lines: string[],
    visualType?: "video" | "image",
  ) => Promise<void>;
};

const renderOnlyDiagnosticCodes = new Set([
  "PROJECT_THEME_PRESET_MISSING",
  "TEXT_STYLE_PRESET_MISSING",
  "TEXT_MOTION_PRESET_MISSING",
  "THEME_FONT_MISSING",
  "THEME_ACCENT_CONTRAST_LOW",
  "TEXT_SAFE_AREA_OVERFLOW",
  "FONT_COVERAGE_UNSUPPORTED",
  "LOGO_ASSET_MISSING",
  "LOGO_ASSET_KIND_MISMATCH",
]);

const inspectableProjectDiagnosticCodes = new Set([
  "SCENE_ASSET_MISSING",
  "SCENE_ASSET_KIND_MISMATCH",
]);

function hasSaveBlockingError(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      !renderOnlyDiagnosticCodes.has(diagnostic.code),
  );
}

function hasLoadBlockingError(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      !renderOnlyDiagnosticCodes.has(diagnostic.code) &&
      !inspectableProjectDiagnosticCodes.has(diagnostic.code),
  );
}

let trailingSaveTimer: ReturnType<typeof setTimeout> | undefined;
let maxWaitSaveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave: Project | undefined;
let inFlightSave: Promise<void> | undefined;
let inFlightCanonical: string | undefined;
let expectedProjectEtag: string | undefined;
let lastSavedCanonical: string | undefined;
let preMigrationBackupPending = false;
let leaseRenewTimer: ReturnType<typeof setInterval> | undefined;
let leaseRecheckTimer: ReturnType<typeof setTimeout> | undefined;
let loadGeneration = 0;
let lifecycleListenersInstalled = false;
const PROJECT_SESSION_STORAGE_KEY = "narracut:project-session-id";

function getOrCreateProjectSessionId(): string {
  if (typeof window === "undefined") return createClientUuid();
  try {
    const existing = window.sessionStorage.getItem(PROJECT_SESSION_STORAGE_KEY);
    if (existing !== null && existing.length > 0 && existing.length <= 128) {
      return existing;
    }
    const created = createClientUuid();
    window.sessionStorage.setItem(PROJECT_SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return createClientUuid();
  }
}

const sessionId = getOrCreateProjectSessionId();
export const getProjectSessionId = (): string => sessionId;
let nextHistoryEntryId = 0;
let historyOperationToken = 0;
let speechCommitTail = Promise.resolve();
let textTransaction:
  | { key: string; entryId: number; lastEditAt: number }
  | undefined;
let textTransactionTimer: ReturnType<typeof setTimeout> | undefined;

const TEXT_TRANSACTION_IDLE_MS = 750;
const HISTORY_LIMIT = 100;
const SAVE_DEBOUNCE_MS = 800;
const SAVE_MAX_WAIT_MS = 1_000;
const SAVE_REQUEST_TIMEOUT_MS = 5_000;
const SPEECH_COMMIT_REQUEST_TIMEOUT_MS = 5_000;
const SPEECH_RECONCILE_REQUEST_TIMEOUT_MS = 2_000;
const SAVE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
const LEASE_RENEW_MS = 1_000;

async function acquireSpeechCommit(): Promise<() => void> {
  const previous = speechCommitTail;
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  speechCommitTail = previous.then(() => current);
  await previous;
  return release;
}

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function immutableProject(project: Project): Project {
  return freezeDeep(structuredClone(project));
}

function sameSerializableValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function preserveRegisteredAssets(snapshot: Project, current: Project): Project {
  const snapshotAssetIds = new Set(snapshot.assets.map((asset) => asset.id));
  const registeredAfterSnapshot = current.assets.filter(
    (asset) => !snapshotAssetIds.has(asset.id),
  );
  return registeredAfterSnapshot.length === 0
    ? snapshot
    : { ...snapshot, assets: [...snapshot.assets, ...registeredAfterSnapshot] };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function canonicalProject(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canMutateProject(get: GetProjectState): boolean {
  const state = get();
  return (
    state.phase === "ready" &&
    state.leaseStatus === "acquired" &&
    state.externalConflict === undefined &&
    !state.conflictResolving &&
    !state.speechCommitInFlight
  );
}

function serializeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

function clearSaveTimers(): void {
  if (trailingSaveTimer !== undefined) clearTimeout(trailingSaveTimer);
  if (maxWaitSaveTimer !== undefined) clearTimeout(maxWaitSaveTimer);
  trailingSaveTimer = undefined;
  maxWaitSaveTimer = undefined;
}

function clearLeaseRenewal(): void {
  if (leaseRenewTimer !== undefined) clearInterval(leaseRenewTimer);
  if (leaseRecheckTimer !== undefined) clearTimeout(leaseRecheckTimer);
  leaseRenewTimer = undefined;
  leaseRecheckTimer = undefined;
}

function finishTextTransaction(): void {
  if (textTransactionTimer !== undefined) clearTimeout(textTransactionTimer);
  textTransactionTimer = undefined;
  textTransaction = undefined;
}

function scheduleTextTransactionBoundary(entryId: number): void {
  if (textTransactionTimer !== undefined) clearTimeout(textTransactionTimer);
  textTransactionTimer = setTimeout(() => {
    if (textTransaction?.entryId === entryId) finishTextTransaction();
  }, TEXT_TRANSACTION_IDLE_MS);
}

function structuralErrorMessage(diagnostics: Diagnostic[]): string {
  return diagnostics[0]?.message ?? "Project DSL 未通过结构与内部一致性校验。";
}

function asUnknownProject(input: unknown): UnknownProject {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as UnknownProject)
    : {};
}

type SetProjectState = (state: Partial<ProjectState>) => void;
type GetProjectState = () => ProjectState;

class PersistenceError extends Error {
  constructor(
    readonly kind: "io" | "timeout" | "conflict" | "lease" | "permanent",
    message: string,
  ) {
    super(message);
  }
}

function parseProjectBytes(raw: string): {
  project?: Project;
  savedCanonical?: string;
  migrated: boolean;
  diagnostics: Diagnostic[];
  errorMessage?: string;
} {
  try {
    const input: unknown = JSON.parse(raw);
    const schemaVersion = readSchemaVersion(input);
    if (schemaVersion > CURRENT_SCHEMA_VERSION) {
      return {
        migrated: false,
        diagnostics: [],
        errorMessage: `项目使用 schemaVersion ${schemaVersion}，当前应用无法安全写回。`,
      };
    }
    const currentProject = migrateKnownProjectToCurrent(input);
    const structural = validateProjectStructure(currentProject);
    if (!structural.success) {
      return {
        migrated: schemaVersion < CURRENT_SCHEMA_VERSION,
        diagnostics: structural.diagnostics,
        errorMessage: structuralErrorMessage(structural.diagnostics),
      };
    }
    const diagnostics = validateProjectConsistency(structural.project);
    if (hasLoadBlockingError(diagnostics)) {
      return {
        migrated: schemaVersion < CURRENT_SCHEMA_VERSION,
        diagnostics,
        errorMessage: structuralErrorMessage(diagnostics),
      };
    }
    return {
      project: structural.project,
      savedCanonical: canonicalProject(input),
      migrated: schemaVersion < CURRENT_SCHEMA_VERSION,
      diagnostics,
    };
  } catch (error) {
    return {
      migrated: false,
      diagnostics:
        error instanceof ProjectMigrationError ? error.diagnostics : [],
      errorMessage:
        error instanceof Error ? error.message : "Project DSL 不是合法的 JSON。",
    };
  }
}

async function withoutStaleSpeech(project: Project): Promise<Project> {
  const diagnostics = await validateSpeechFreshness(
    project,
    CURRENT_TTS_PROFILE_ID,
  );
  const staleSceneIds = new Set(
    diagnostics.flatMap((diagnostic) =>
      diagnostic.sceneId === undefined ? [] : [diagnostic.sceneId],
    ),
  );
  if (staleSceneIds.size === 0) return project;
  return {
    ...project,
    scenes: project.scenes.map((scene) => {
      if (!staleSceneIds.has(scene.id) || scene.speech === undefined) return scene;
      const { speech: _speech, ...withoutSpeech } = scene;
      return withoutSpeech;
    }),
  };
}

type MediaProbeResult = {
  availability: Record<string, boolean>;
  videoDurationInFrames: Record<string, number>;
  diagnostics: Diagnostic[];
};

async function probeMediaAvailability(project: Project): Promise<MediaProbeResult> {
  const paths = [
    ...project.assets.map((asset) => asset.path),
    ...project.scenes.flatMap((scene) =>
      scene.speech === undefined ? [] : [scene.speech.path],
    ),
  ];
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) {
    return { availability: {}, videoDurationInFrames: {}, diagnostics: [] };
  }
  const videoPaths = project.assets
    .filter((asset) => asset.kind === "video")
    .map((asset) => asset.path);
  const imagePaths = project.assets
    .filter((asset) => asset.kind === "image")
    .map((asset) => asset.path);
  const speechPaths = project.scenes.flatMap((scene) =>
    scene.speech === undefined ? [] : [scene.speech.path],
  );
  const response = await fetch("/api/assets/probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths: uniquePaths, imagePaths, videoPaths, speechPaths }),
  });
  if (!response.ok) {
    return { availability: {}, videoDurationInFrames: {}, diagnostics: [] };
  }
  const payload = (await response.json()) as {
    results: Array<{
      path: string;
      exists: boolean;
      error?: string;
      videoDurationInFrames?: number;
    }>;
  };
  return {
    availability: Object.fromEntries(
      payload.results.map((result) => [result.path, result.exists]),
    ),
    videoDurationInFrames: Object.fromEntries(
      payload.results.flatMap((result) =>
        result.videoDurationInFrames === undefined
          ? []
          : [[result.path, result.videoDurationInFrames] as const],
      ),
    ),
    diagnostics: diagnosticsFromMediaProbe(project, payload.results),
  };
}

async function probeSpeechRevisions(project: Project): Promise<Record<string, string>> {
  const paths = [...new Set(project.scenes.flatMap((scene) =>
    scene.speech === undefined ? [] : [scene.speech.path],
  ))];
  if (paths.length === 0) return {};
  const response = await fetch("/api/speech/revisions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!response.ok) return {};
  const payload = (await response.json()) as {
    results: Array<{ path: string; exists: boolean; revision?: string }>;
  };
  return Object.fromEntries(
    payload.results.flatMap((result) =>
      result.exists && result.revision !== undefined
        ? [[result.path, result.revision] as const]
        : [],
    ),
  );
}

function revisionsForProject(
  project: Project,
  revisions: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    project.scenes.flatMap((scene) => {
      const path = scene.speech?.path;
      return path !== undefined && revisions[path] !== undefined
        ? [[path, revisions[path]] as const]
        : [];
    }),
  );
}

async function restoreHistorySpeech(
  project: Project,
  expectedRevisions: Record<string, string> | undefined,
): Promise<{
  project: Project;
  revisions: Record<string, string>;
  availability: Record<string, boolean>;
  discarded: boolean;
}> {
  const paths = [...new Set(project.scenes.flatMap((scene) =>
    scene.speech === undefined ? [] : [scene.speech.path],
  ))];
  if (paths.length === 0) {
    return { project, revisions: {}, availability: {}, discarded: false };
  }
  let results: Array<{ path: string; exists: boolean; revision?: string }> = [];
  try {
    const response = await fetch("/api/speech/revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths }),
    });
    if (response.ok) {
      results = ((await response.json()) as {
        results: Array<{ path: string; exists: boolean; revision?: string }>;
      }).results;
    }
  } catch {
    // 无法证明文件修订一致时，下面会安全移除 Speech 引用。
  }
  const current = new Map(results.map((result) => [result.path, result]));
  let discarded = false;
  const restored: Project = {
    ...project,
    scenes: project.scenes.map((scene) => {
      if (scene.speech === undefined) return scene;
      const result = current.get(scene.speech.path);
      if (
        expectedRevisions?.[scene.speech.path] !== undefined &&
        result?.exists === true &&
        result.revision === expectedRevisions[scene.speech.path]
      ) {
        return scene;
      }
      discarded = true;
      const { speech: _speech, ...withoutSpeech } = scene;
      return withoutSpeech;
    }),
  };
  return {
    project: restored,
    revisions: Object.fromEntries(results.flatMap((result) =>
      result.exists && result.revision !== undefined
        ? [[result.path, result.revision] as const]
        : [],
    )),
    availability: Object.fromEntries(results.map((result) => [result.path, result.exists])),
    discarded,
  };
}

async function requestLease(): Promise<{
  status: "acquired" | "occupied";
  expiresAt?: number;
}> {
  const response = await fetch("/api/project/lease", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (response.status === 409) {
    const payload = (await response.json()) as { expiresAt?: number };
    return { status: "occupied", expiresAt: payload.expiresAt };
  }
  if (!response.ok) throw new Error("无法取得项目编辑权。");
  const payload = (await response.json()) as {
    status?: "acquired" | "occupied";
    expiresAt?: number;
  };
  return {
    status: payload.status === "occupied" ? "occupied" : "acquired",
    expiresAt: payload.expiresAt,
  };
}

function saveBlockingDiagnostics(project: Project): Diagnostic[] {
  const structural = validateProjectStructure(project);
  if (!structural.success) return structural.diagnostics;
  return validateProjectConsistency(structural.project).filter(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      !renderOnlyDiagnosticCodes.has(diagnostic.code),
  );
}

async function putProject(
  project: Project,
  backupKind?: "pre-migration" | "external-conflict",
): Promise<string | undefined> {
  const diagnostics = saveBlockingDiagnostics(project);
  if (diagnostics.length > 0) {
    throw new PersistenceError("permanent", structuralErrorMessage(diagnostics));
  }
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "x-narracut-session-id": sessionId,
    "if-match": expectedProjectEtag ?? '"untracked"',
  };
  if (backupKind !== undefined) headers["x-narracut-backup-kind"] = backupKind;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SAVE_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("/api/project", {
      method: "PUT",
      headers,
      body: serializeProject(project),
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new PersistenceError(
        "timeout",
        "本地项目服务超过 5 秒未响应。",
      );
    }
    throw new PersistenceError(
      "io",
      error instanceof Error ? error.message : "无法连接本地项目服务。",
    );
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 412) {
    throw new PersistenceError("conflict", "Project DSL 已在磁盘上改变。");
  }
  if (response.status === 423) {
    throw new PersistenceError("lease", "当前页面已失去项目编辑权。");
  }
  if (!response.ok) {
    const detail = (await response.text()).trim();
    const message = detail || `保存失败：HTTP ${response.status}`;
    throw new PersistenceError(
      response.status >= 500 ? "io" : "permanent",
      message,
    );
  }
  return response.headers.get("etag") ?? undefined;
}

async function commitSpeechProject(jobId: string, project: Project): Promise<string> {
  const confirmCommittedProject = async (): Promise<string | undefined> => {
    try {
      const current = await fetchWithTimeout(
        "/api/project",
        { cache: "no-store" },
        SPEECH_RECONCILE_REQUEST_TIMEOUT_MS,
      );
      const etag = current.headers.get("etag");
      if (!current.ok || etag === null) return undefined;
      const raw = await current.text();
      return canonicalProject(JSON.parse(raw)) === canonicalProject(project)
        ? etag
        : undefined;
    } catch {
      return undefined;
    }
  };
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `/api/jobs/${jobId}/commit`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-narracut-session-id": sessionId,
          "if-match": expectedProjectEtag ?? '"untracked"',
        },
        body: serializeProject(project),
      },
      SPEECH_COMMIT_REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    const committedEtag = await confirmCommittedProject();
    if (committedEtag !== undefined) return committedEtag;
    throw error;
  }
  if (!response.ok) {
    if (response.status >= 500) {
      const committedEtag = await confirmCommittedProject();
      if (committedEtag !== undefined) return committedEtag;
    }
    throw new Error((await response.text()) || "无法提交 Speech 与 Project DSL。");
  }
  const etag = response.headers.get("etag");
  if (etag === null) throw new Error("Speech 提交未返回 Project 修订。");
  return etag;
}

function markLeaseLost(set: SetProjectState, get: GetProjectState): void {
  clearLeaseRenewal();
  clearSaveTimers();
  set({
    phase: "occupied",
    leaseStatus: "occupied",
    leaseLostWhileEditing: get().project !== undefined,
    saveStatus: "occupied",
    saveErrorMessage: "当前页面已失去项目编辑权，内存修改尚未被覆盖。",
  });
}

async function readDiskRevision(): Promise<{
  raw: string;
  etag: string;
  parsed: ReturnType<typeof parseProjectBytes>;
}> {
  const response = await fetch("/api/project", { cache: "no-store" });
  if (!response.ok) throw new Error("无法检查磁盘上的 Project DSL。");
  const raw = await response.text();
  const etag = response.headers.get("etag");
  if (etag === null) throw new Error("本地服务没有返回 Project DSL 修订标识。");
  return { raw, etag, parsed: parseProjectBytes(raw) };
}

async function backupMemoryVersion(
  project: Project,
  diskEtag: string,
): Promise<"created" | "stale"> {
  const response = await fetch("/api/project/backups", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-narracut-session-id": sessionId,
      "x-narracut-backup-kind": "external-conflict",
      "if-match": diskEtag,
    },
    body: serializeProject(project),
  });
  if (response.status === 412) return "stale";
  if (!response.ok) {
    throw new Error((await response.text()) || "无法备份内存版本。");
  }
  return "created";
}

async function installDiskProject(
  disk: Awaited<ReturnType<typeof readDiskRevision>>,
  set: SetProjectState,
): Promise<void> {
  const {
    project: parsedProject,
    diagnostics: parsedDiagnostics,
    migrated,
    savedCanonical,
  } = disk.parsed;
  if (parsedProject === undefined || savedCanonical === undefined) {
    throw new Error(disk.parsed.errorMessage ?? "磁盘 Project DSL 无法安全载入。");
  }
  const project = await withoutStaleSpeech(parsedProject);
  const diagnostics =
    project === parsedProject ? parsedDiagnostics : validateProjectConsistency(project);
  expectedProjectEtag = disk.etag;
  lastSavedCanonical = savedCanonical;
  preMigrationBackupPending = migrated;
  pendingSave = undefined;
  clearSaveTimers();
  const mediaProbe = await probeMediaAvailability(project);
  set({
    phase: "ready",
    project,
    diagnostics,
    mediaDiagnostics: mediaProbe.diagnostics,
    mediaAvailability: mediaProbe.availability,
    videoDurationInFrames: mediaProbe.videoDurationInFrames,
    mediaRevisions: await probeSpeechRevisions(project),
    selectedSceneId: project.scenes[0]?.id,
    undoStack: [],
    redoStack: [],
    historyNotice: undefined,
    historyAnnouncement: undefined,
    historyFocusRequest: undefined,
    saveStatus: migrated ? "migrated" : "saved",
    saveErrorMessage: undefined,
    saveRetryAttempt: undefined,
    saveDiagnostics: [],
    dirty: migrated,
    migrationPending: migrated,
    externalConflict: undefined,
    conflictResolving: false,
    leaseStatus: "acquired",
    leaseLostWhileEditing: false,
  });
}

async function prepareExternalConflict(
  set: SetProjectState,
  get: GetProjectState,
  disk?: Awaited<ReturnType<typeof readDiskRevision>>,
): Promise<void> {
  try {
    const revision = disk ?? (await readDiskRevision());
    if (revision.etag === expectedProjectEtag) return;
    const currentProject = get().project;
    const currentDirty =
      currentProject !== undefined &&
      canonicalProject(currentProject) !== lastSavedCanonical;
    if (!currentDirty && revision.parsed.project !== undefined) {
      if (currentProject === undefined) return;
      const backupResult = await backupMemoryVersion(currentProject, revision.etag);
      if (backupResult === "stale") {
        const latest = await readDiskRevision();
        clearSaveTimers();
        set({
          saveStatus: "conflict",
          externalConflict: {
            diskRaw: latest.raw,
            diskEtag: latest.etag,
            diskProject: latest.parsed.project,
            diskSavedCanonical: latest.parsed.savedCanonical,
            diskDiagnostics: latest.parsed.diagnostics,
            migrated: latest.parsed.migrated,
            errorMessage: latest.parsed.errorMessage,
            resolutionError: "备份期间磁盘版本再次改变，请明确选择要保留的版本。",
          },
          conflictResolving: false,
        });
        return;
      }
      await installDiskProject(revision, set);
      return;
    }
    clearSaveTimers();
    set({
      saveStatus: "conflict",
      saveErrorMessage: undefined,
      externalConflict: {
        diskRaw: revision.raw,
        diskEtag: revision.etag,
        diskProject: revision.parsed.project,
        diskSavedCanonical: revision.parsed.savedCanonical,
        diskDiagnostics: revision.parsed.diagnostics,
        migrated: revision.parsed.migrated,
        errorMessage: revision.parsed.errorMessage,
      },
      conflictResolving: false,
    });
  } catch (error) {
    set({
      saveStatus: "error",
      saveErrorMessage:
        error instanceof Error ? error.message : "无法检查磁盘修订。",
    });
  }
}

async function runSaveQueue(
  set: SetProjectState,
  get: GetProjectState,
): Promise<void> {
  if (inFlightSave !== undefined) return inFlightSave;
  if (
    pendingSave === undefined ||
    get().leaseStatus !== "acquired" ||
    get().externalConflict !== undefined
  ) {
    return;
  }

  const operation = (async () => {
    while (
      pendingSave !== undefined &&
      get().leaseStatus === "acquired" &&
      get().externalConflict === undefined
    ) {
      let snapshot = pendingSave;
      pendingSave = undefined;
      let succeeded = false;
      let preserveSnapshotForRetry = false;
      for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) {
          const delay = SAVE_RETRY_DELAYS_MS[attempt - 1];
          set({
            saveStatus: "retrying",
            saveRetryAttempt: attempt,
            saveErrorMessage: `写入失败，将在 ${delay / 1_000} 秒后重试。`,
          });
          await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, delay));
          if (
            get().leaseStatus !== "acquired" ||
            get().externalConflict !== undefined
          ) {
            pendingSave = get().project;
            return;
          }
          if (!preserveSnapshotForRetry && pendingSave !== undefined) {
            snapshot = pendingSave;
            pendingSave = undefined;
          }
        }

        const diagnostics = saveBlockingDiagnostics(snapshot);
        if (diagnostics.length > 0) {
          pendingSave = snapshot;
          set({
            saveStatus: "blocked-validation",
            saveDiagnostics: diagnostics,
            saveErrorMessage: structuralErrorMessage(diagnostics),
            saveRetryAttempt: undefined,
            dirty: true,
          });
          return;
        }

        inFlightCanonical = canonicalProject(snapshot);
        set({
          saveStatus: attempt === 0 ? "saving" : "retrying",
          saveRetryAttempt: attempt === 0 ? undefined : attempt,
          saveErrorMessage: undefined,
        });
        try {
          const usedMigrationBackup = preMigrationBackupPending;
          const nextEtag = await putProject(
            snapshot,
            usedMigrationBackup ? "pre-migration" : undefined,
          );
          if (nextEtag !== undefined) expectedProjectEtag = nextEtag;
          lastSavedCanonical = inFlightCanonical;
          if (usedMigrationBackup) {
            preMigrationBackupPending = false;
            set({ migrationPending: false, migrationSavedNotice: true });
            setTimeout(() => set({ migrationSavedNotice: false }), 2_500);
          }
          succeeded = true;
          break;
        } catch (error) {
          if (!(error instanceof PersistenceError)) throw error;
          preserveSnapshotForRetry = error.kind === "timeout";
          if (error.kind === "conflict") {
            pendingSave = get().project;
            await prepareExternalConflict(set, get);
            return;
          }
          if (error.kind === "lease") {
            pendingSave = get().project;
            markLeaseLost(set, get);
            return;
          }
          if (error.kind === "permanent") {
            pendingSave = get().project;
            set({
              saveStatus: "error",
              saveErrorMessage: error.message,
              saveRetryAttempt: undefined,
              dirty: true,
            });
            return;
          }
          if (attempt === SAVE_RETRY_DELAYS_MS.length) {
            pendingSave = get().project;
            set({
              saveStatus: "error",
              saveErrorMessage: error.message,
              saveRetryAttempt: undefined,
              dirty: true,
            });
            return;
          }
        } finally {
          inFlightCanonical = undefined;
        }
      }

      if (!succeeded) return;
      const current = get().project;
      if (current === undefined) return;
      const currentCanonical = canonicalProject(current);
      const dirty = currentCanonical !== lastSavedCanonical;
      if (dirty && pendingSave === undefined) pendingSave = immutableProject(current);
      set({
        saveStatus: dirty ? "pending" : "saved",
        saveErrorMessage: undefined,
        saveRetryAttempt: undefined,
        saveDiagnostics: [],
        dirty,
      });
    }
  })();
  inFlightSave = operation.finally(() => {
    inFlightSave = undefined;
  });
  return inFlightSave;
}

function scheduleProjectSave(
  project: Project,
  mode: "text" | "immediate",
  set: SetProjectState,
  get: GetProjectState,
): Promise<void> {
  const currentCanonical = canonicalProject(project);
  const dirty = currentCanonical !== lastSavedCanonical;
  if (!dirty && inFlightCanonical === undefined) {
    pendingSave = undefined;
    clearSaveTimers();
    set({
      saveStatus: "saved",
      saveErrorMessage: undefined,
      saveRetryAttempt: undefined,
      saveDiagnostics: [],
      dirty: false,
    });
    return Promise.resolve();
  }
  pendingSave = immutableProject(project);
  set({
    saveStatus: inFlightSave === undefined ? "pending" : get().saveStatus,
    saveErrorMessage: undefined,
    saveRetryAttempt: undefined,
    saveDiagnostics: [],
    dirty,
  });
  if (mode === "immediate") {
    clearSaveTimers();
    return runSaveQueue(set, get);
  }
  if (trailingSaveTimer !== undefined) clearTimeout(trailingSaveTimer);
  trailingSaveTimer = setTimeout(() => {
    clearSaveTimers();
    void runSaveQueue(set, get);
  }, SAVE_DEBOUNCE_MS);
  if (maxWaitSaveTimer === undefined) {
    maxWaitSaveTimer = setTimeout(() => {
      clearSaveTimers();
      void runSaveQueue(set, get);
    }, SAVE_MAX_WAIT_MS);
  }
  return Promise.resolve();
}

function startLeaseRenewal(set: SetProjectState, get: GetProjectState): void {
  clearLeaseRenewal();
  leaseRenewTimer = setInterval(() => {
    void requestLease()
      .then(({ status }) => {
        if (status === "occupied") markLeaseLost(set, get);
      })
      .catch(() => markLeaseLost(set, get));
  }, LEASE_RENEW_MS);
}

function scheduleLeaseRecheck(
  expiresAt: number | undefined,
  get: GetProjectState,
): void {
  if (expiresAt === undefined) return;
  if (leaseRecheckTimer !== undefined) clearTimeout(leaseRecheckTimer);
  const waitMs = Math.max(0, Math.min(3_100, expiresAt - Date.now() + 50));
  leaseRecheckTimer = setTimeout(() => {
    leaseRecheckTimer = undefined;
    if (get().phase !== "occupied" || get().leaseLostWhileEditing) return;
    void requestLease().then((result) => {
      if (result.status === "acquired") void get().load();
    });
  }, waitMs);
}

function installLifecycleListeners(get: GetProjectState): void {
  if (lifecycleListenersInstalled || typeof window === "undefined") return;
  lifecycleListenersInstalled = true;
  window.addEventListener("focus", () => void get().checkDiskRevision());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void get().flushSave();
  });
  window.addEventListener("pagehide", () => {
    void get().flushSave();
    if (get().dirty) return;
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/project/lease/release", sessionId);
      return;
    }
    void fetch("/api/project/lease", {
      method: "DELETE",
      headers: { "x-narracut-session-id": sessionId },
      keepalive: true,
    });
  });
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  phase: "loading",
  diagnostics: [],
  mediaDiagnostics: [],
  mediaAvailability: {},
  mediaRevisions: {},
  videoDurationInFrames: {},
  saveStatus: "saved",
  saveDiagnostics: [],
  dirty: false,
  migrationPending: false,
  migrationSavedNotice: false,
  leaseStatus: "none",
  leaseLostWhileEditing: false,
  conflictResolving: false,
  undoStack: [],
  redoStack: [],
  historyEventId: 0,
  taskDrawerOpen: false,
  speechCommitInFlight: false,
  load: async () => {
    const generation = ++loadGeneration;
    finishTextTransaction();
    clearSaveTimers();
    clearLeaseRenewal();
    pendingSave = undefined;
    set({
      phase: "loading",
      diagnostics: [],
      mediaDiagnostics: [],
      errorMessage: undefined,
      project: undefined,
      unknownProject: undefined,
      mediaAvailability: {},
      mediaRevisions: {},
      videoDurationInFrames: {},
      saveStatus: "saved",
      saveErrorMessage: undefined,
      saveRetryAttempt: undefined,
      saveDiagnostics: [],
      dirty: false,
      migrationPending: false,
      migrationSavedNotice: false,
      leaseStatus: "none",
      leaseLostWhileEditing: false,
      externalConflict: undefined,
      conflictResolving: false,
      undoStack: [],
      redoStack: [],
      historyNotice: undefined,
      historyAnnouncement: undefined,
      historyFocusRequest: undefined,
    });

    await inFlightSave?.catch(() => undefined);

    try {
      const [projectResponse, infoResponse] = await Promise.all([
        fetch("/api/project", { cache: "no-store" }),
        fetch("/api/project-info", { cache: "no-store" }),
      ]);
      if (!projectResponse.ok || !infoResponse.ok) {
        throw new Error("本地服务未能读取项目文件。");
      }

      const [projectText, info] = await Promise.all([
        projectResponse.text(),
        infoResponse.json() as Promise<ProjectInfo>,
      ]);
      if (generation !== loadGeneration) return;
      const etag = projectResponse.headers.get("etag");
      if (etag === null) {
        throw new Error("本地服务没有返回 Project DSL 修订标识。");
      }
      const input: unknown = JSON.parse(projectText);
      const schemaVersion = readSchemaVersion(input);

      if (schemaVersion > CURRENT_SCHEMA_VERSION) {
        set({
          phase: "readonly",
          info,
          unknownProject: asUnknownProject(input),
          unknownVersion: schemaVersion,
          selectedSceneId: undefined,
          saveStatus: "saved",
          leaseStatus: "none",
        });
        return;
      }

      const migratedProject = migrateKnownProjectToCurrent(input);
      const structural = validateProjectStructure(migratedProject);
      if (!structural.success) {
        set({
          phase: "error",
          info,
          diagnostics: structural.diagnostics,
          errorMessage: structuralErrorMessage(structural.diagnostics),
        });
        return;
      }

      const diagnostics = validateProjectConsistency(structural.project);
      if (hasLoadBlockingError(diagnostics)) {
        set({
          phase: "error",
          info,
          diagnostics,
          errorMessage: structuralErrorMessage(diagnostics),
        });
        return;
      }

      const currentProject = await withoutStaleSpeech(structural.project);
      const currentDiagnostics =
        currentProject === structural.project
          ? diagnostics
          : validateProjectConsistency(currentProject);
      const [mediaProbe, mediaRevisions] = await Promise.all([
        probeMediaAvailability(currentProject),
        probeSpeechRevisions(currentProject),
      ]);
      const leaseResponse = await requestLease();
      const leaseResult = leaseResponse.status;
      if (generation !== loadGeneration) return;
      expectedProjectEtag = etag;
      lastSavedCanonical = canonicalProject(input);
      preMigrationBackupPending = schemaVersion < CURRENT_SCHEMA_VERSION;

      set({
        phase: leaseResult === "acquired" ? "ready" : "occupied",
        info,
        project: currentProject,
        diagnostics: currentDiagnostics,
        mediaDiagnostics: mediaProbe.diagnostics,
        mediaAvailability: mediaProbe.availability,
        videoDurationInFrames: mediaProbe.videoDurationInFrames,
        mediaRevisions,
        selectedSceneId: currentProject.scenes[0]?.id,
        saveStatus:
          leaseResult === "occupied"
            ? "occupied"
            : preMigrationBackupPending
              ? "migrated"
              : "saved",
        dirty: preMigrationBackupPending,
        migrationPending: preMigrationBackupPending,
        leaseStatus: leaseResult,
        leaseLostWhileEditing: false,
      });
      installLifecycleListeners(get);
      if (leaseResult === "acquired") startLeaseRenewal(set, get);
      else scheduleLeaseRecheck(leaseResponse.expiresAt, get);
    } catch (error) {
      if (generation !== loadGeneration) return;
      set({
        phase: "error",
        diagnostics:
          error instanceof ProjectMigrationError ? error.diagnostics : [],
        errorMessage:
          error instanceof Error ? error.message : "Project DSL 加载失败。",
      });
    }
  },
  flushSave: async () => {
    clearSaveTimers();
    await runSaveQueue(set, get);
  },
  retrySave: async () => {
    const project = get().project;
    if (project === undefined || get().leaseStatus !== "acquired") return;
    pendingSave = immutableProject(project);
    set({
      saveStatus: "pending",
      saveErrorMessage: undefined,
      saveRetryAttempt: undefined,
    });
    await runSaveQueue(set, get);
  },
  checkDiskRevision: async () => {
    if (
      get().phase !== "ready" ||
      get().leaseStatus !== "acquired" ||
      get().externalConflict !== undefined
    ) {
      return;
    }
    const disk = await readDiskRevision();
    if (disk.etag !== expectedProjectEtag) {
      await prepareExternalConflict(set, get, disk);
    }
  },
  recheckLease: async () => {
    if (!get().leaseLostWhileEditing) {
      let leaseResult = await requestLease();
      if (leaseResult.status === "occupied" && leaseResult.expiresAt !== undefined) {
        const waitMs = Math.max(0, Math.min(8_100, leaseResult.expiresAt - Date.now() + 50));
        await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, waitMs));
        leaseResult = await requestLease();
      }
      if (leaseResult.status === "occupied") return;
      await get().load();
      return;
    }
    try {
      let leaseResult = await requestLease();
      if (leaseResult.status === "occupied" && leaseResult.expiresAt !== undefined) {
        const waitMs = Math.max(0, Math.min(8_100, leaseResult.expiresAt - Date.now() + 50));
        await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, waitMs));
        leaseResult = await requestLease();
      }
      if (leaseResult.status === "occupied") return;
      set({ phase: "ready", leaseStatus: "acquired" });
      startLeaseRenewal(set, get);
      const disk = await readDiskRevision();
      if (disk.etag !== expectedProjectEtag) {
        await prepareExternalConflict(set, get, disk);
        return;
      }
      set({
        leaseLostWhileEditing: false,
        saveStatus: get().dirty ? "pending" : "saved",
        saveErrorMessage: undefined,
      });
      if (get().dirty && get().project !== undefined) {
        pendingSave = immutableProject(get().project!);
        await runSaveQueue(set, get);
      }
    } catch (error) {
      set({
        saveErrorMessage:
          error instanceof Error ? error.message : "无法重新检查编辑权。",
      });
    }
  },
  loadDiskVersion: async () => {
    const conflict = get().externalConflict;
    const current = get().project;
    if (conflict === undefined || current === undefined) return;
    set({ conflictResolving: true });
    try {
      const latest = await readDiskRevision();
      if (latest.etag !== conflict.diskEtag) {
        set({
          externalConflict: {
            diskRaw: latest.raw,
            diskEtag: latest.etag,
            diskProject: latest.parsed.project,
            diskSavedCanonical: latest.parsed.savedCanonical,
            diskDiagnostics: latest.parsed.diagnostics,
            migrated: latest.parsed.migrated,
            errorMessage: latest.parsed.errorMessage,
            resolutionError: "磁盘版本再次改变，请重新确认选择。",
          },
          conflictResolving: false,
        });
        return;
      }
      if (latest.parsed.project === undefined) {
        throw new Error(latest.parsed.errorMessage ?? "磁盘版本无法安全载入。");
      }
      const backupResult = await backupMemoryVersion(current, latest.etag);
      if (backupResult === "stale") {
        const refreshed = await readDiskRevision();
        set({
          externalConflict: {
            diskRaw: refreshed.raw,
            diskEtag: refreshed.etag,
            diskProject: refreshed.parsed.project,
            diskSavedCanonical: refreshed.parsed.savedCanonical,
            diskDiagnostics: refreshed.parsed.diagnostics,
            migrated: refreshed.parsed.migrated,
            errorMessage: refreshed.parsed.errorMessage,
            resolutionError: "备份期间磁盘版本再次改变，请重新确认选择。",
          },
          conflictResolving: false,
        });
        return;
      }
      await installDiskProject(latest, set);
    } catch (error) {
      set({
        externalConflict: {
          ...conflict,
          resolutionError:
            error instanceof Error ? error.message : "无法载入磁盘版本。",
        },
        conflictResolving: false,
      });
    }
  },
  keepCurrentVersion: async () => {
    const conflict = get().externalConflict;
    const current = get().project;
    if (conflict === undefined || current === undefined) return;
    set({ conflictResolving: true });
    expectedProjectEtag = conflict.diskEtag;
    try {
      const nextEtag = await putProject(current, "external-conflict");
      if (nextEtag !== undefined) expectedProjectEtag = nextEtag;
      lastSavedCanonical = canonicalProject(current);
      const latestProject = get().project;
      const latestCanonical =
        latestProject === undefined ? lastSavedCanonical : canonicalProject(latestProject);
      const dirty = latestCanonical !== lastSavedCanonical;
      pendingSave = dirty && latestProject !== undefined
        ? immutableProject(latestProject)
        : undefined;
      set({
        saveStatus: dirty ? "pending" : "saved",
        saveErrorMessage: undefined,
        saveRetryAttempt: undefined,
        saveDiagnostics: [],
        dirty,
        externalConflict: undefined,
        conflictResolving: false,
      });
      if (dirty) await runSaveQueue(set, get);
    } catch (error) {
      set({
        externalConflict: {
          ...conflict,
          resolutionError:
            error instanceof Error ? error.message : "无法保留当前版本。",
        },
        conflictResolving: false,
      });
    }
  },
  selectScene: (selectedSceneId) => set({ selectedSceneId }),
  setTaskDrawerOpen: (taskDrawerOpen) => set({ taskDrawerOpen }),
  updateProjectName: async (name) => {
    const project = get().project;
    if (project === undefined || !canMutateProject(get)) return;

    const metadata = { ...project.metadata };
    if (name === "") delete metadata.name;
    else metadata.name = name;
    const nextProject: Project = { ...project, metadata };
    if (sameSerializableValue(project.metadata, metadata)) return;
    finishTextTransaction();
    const entry: HistoryEntry = {
      id: ++nextHistoryEntryId,
      before: immutableProject(project),
      after: immutableProject(nextProject),
      beforeSpeechRevisions: revisionsForProject(project, get().mediaRevisions),
      afterSpeechRevisions: revisionsForProject(nextProject, get().mediaRevisions),
      label: "重命名项目",
    };
    set({
      project: nextProject,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
    });
    await scheduleProjectSave(nextProject, "immediate", set, get);
  },
  updateTheme: async (theme) => {
    const project = get().project;
    if (project === undefined || !canMutateProject(get)) return;
    const nextProject: Project = { ...project, theme };
    const structural = validateProjectStructure(nextProject);
    if (!structural.success) {
      throw new Error(structuralErrorMessage(structural.diagnostics));
    }
    const diagnostics = validateProjectConsistency(structural.project);
    if (hasSaveBlockingError(diagnostics)) {
      throw new Error(structuralErrorMessage(diagnostics));
    }
    if (sameSerializableValue(project.theme, structural.project.theme)) return;
    finishTextTransaction();
    const entry: HistoryEntry = {
      id: ++nextHistoryEntryId,
      before: immutableProject(project),
      after: immutableProject(structural.project),
      beforeSpeechRevisions: revisionsForProject(project, get().mediaRevisions),
      afterSpeechRevisions: revisionsForProject(structural.project, get().mediaRevisions),
      label: "编辑 Project Theme",
    };
    set({
      project: structural.project,
      diagnostics,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
    });
    await scheduleProjectSave(structural.project, "immediate", set, get);
  },
  updateNarration: (sceneId, text) => {
    const project = get().project;
    if (project === undefined || !canMutateProject(get)) return;

    const nextProject: Project = {
      ...project,
      scenes: project.scenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, narration: { text }, speech: undefined }
          : scene,
      ),
    };
    const now = Date.now();
    const textKey = `scene:${sceneId}:narration`;
    const sceneNumber = project.scenes.findIndex((scene) => scene.id === sceneId) + 1;
    const label = `编辑 Scene ${String(sceneNumber).padStart(2, "0")} 旁白`;
    const currentUndoStack = get().undoStack;
    const activeEntry = currentUndoStack.at(-1);
    let undoStack: HistoryEntry[];
    if (
      textTransaction?.key === textKey &&
      now - textTransaction.lastEditAt <= TEXT_TRANSACTION_IDLE_MS &&
      activeEntry?.id === textTransaction.entryId
    ) {
      undoStack = [
        ...currentUndoStack.slice(0, -1),
        {
          ...activeEntry,
          after: immutableProject(nextProject),
          afterSpeechRevisions: revisionsForProject(
            nextProject,
            get().mediaRevisions,
          ),
        },
      ];
      textTransaction.lastEditAt = now;
    } else {
      finishTextTransaction();
      const entry: HistoryEntry = {
        id: ++nextHistoryEntryId,
        before: immutableProject(project),
        after: immutableProject(nextProject),
        label,
        sceneId,
        focusTarget: "narration",
        beforeSpeechRevisions: revisionsForProject(project, get().mediaRevisions),
        afterSpeechRevisions: revisionsForProject(nextProject, get().mediaRevisions),
      };
      undoStack = [...currentUndoStack, entry].slice(-HISTORY_LIMIT);
      textTransaction = { key: textKey, entryId: entry.id, lastEditAt: now };
    }
    scheduleTextTransactionBoundary(textTransaction.entryId);
    set({
      project: nextProject,
      diagnostics: validateProjectConsistency(nextProject),
      undoStack,
      redoStack: [],
    });
    void scheduleProjectSave(nextProject, "text", set, get);
  },
  endTextTransaction: () => {
    finishTextTransaction();
    void get().flushSave();
  },
  undo: async () => {
    finishTextTransaction();
    if (!canMutateProject(get)) return;
    const { undoStack, redoStack } = get();
    const entry = undoStack.at(-1);
    if (entry === undefined) {
      set((state) => ({
        historyNotice: "没有可撤销的编辑",
        historyAnnouncement: undefined,
        historyEventId: state.historyEventId + 1,
      }));
      return;
    }
    const operationToken = ++historyOperationToken;
    const projectAtStart = get().project;
    const historyProject =
      entry.deletedScene === undefined
        ? entry.before
        : preserveRegisteredAssets(entry.before, projectAtStart!);
    const restored = await restoreHistorySpeech(historyProject, entry.beforeSpeechRevisions);
    if (
      operationToken !== historyOperationToken ||
      get().project !== projectAtStart ||
      get().undoStack.at(-1)?.id !== entry.id
    ) return;
    const project = restored.project;
    const selectedSceneId = get().selectedSceneId;
    const restoredDeletedSceneId = entry.deletedScene?.sceneId;
    set((state) => ({
      project,
      mediaRevisions: { ...state.mediaRevisions, ...restored.revisions },
      mediaAvailability: { ...state.mediaAvailability, ...restored.availability },
      selectedSceneId:
        restoredDeletedSceneId !== undefined &&
        project.scenes.some((scene) => scene.id === restoredDeletedSceneId)
          ? restoredDeletedSceneId
          : project.scenes.some((scene) => scene.id === selectedSceneId)
            ? selectedSceneId
            : project.scenes[0]?.id,
      diagnostics: validateProjectConsistency(project),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, entry],
      historyNotice:
        entry.deletedScene === undefined
          ? restored.discarded
            ? `已撤销：${entry.label}；Speech 文件修订已改变，已恢复为缺 Speech`
            : `已撤销：${entry.label}`
          : undefined,
      historyAnnouncement:
        entry.deletedScene === undefined
          ? undefined
          : restored.discarded
            ? `已撤销：${entry.label}；Speech 文件修订已改变，已恢复为缺 Speech`
            : `已撤销：${entry.label}`,
      historyEventId: state.historyEventId + 1,
      historyFocusRequest:
        restoredDeletedSceneId !== undefined
          ? {
              eventId: state.historyEventId + 1,
              sceneId: restoredDeletedSceneId,
              target: "scene-select",
              force: true,
            }
          : entry.sceneId === undefined || entry.focusTarget === undefined
            ? undefined
            : {
                eventId: state.historyEventId + 1,
                sceneId: entry.sceneId,
                target: entry.focusTarget,
              },
    }));
    await scheduleProjectSave(project, "immediate", set, get);
  },
  redo: async () => {
    finishTextTransaction();
    if (!canMutateProject(get)) return;
    const { undoStack, redoStack } = get();
    const entry = redoStack.at(-1);
    if (entry === undefined) {
      set((state) => ({
        historyNotice: "没有可重做的编辑",
        historyAnnouncement: undefined,
        historyEventId: state.historyEventId + 1,
      }));
      return;
    }
    const operationToken = ++historyOperationToken;
    const projectAtStart = get().project;
    const historyProject =
      entry.deletedScene === undefined
        ? entry.after
        : preserveRegisteredAssets(entry.after, projectAtStart!);
    const restored = await restoreHistorySpeech(historyProject, entry.afterSpeechRevisions);
    if (
      operationToken !== historyOperationToken ||
      get().project !== projectAtStart ||
      get().redoStack.at(-1)?.id !== entry.id
    ) return;
    const project = restored.project;
    const selectedSceneId = get().selectedSceneId;
    const deletedScene = entry.deletedScene;
    set((state) => ({
      project,
      mediaRevisions: { ...state.mediaRevisions, ...restored.revisions },
      mediaAvailability: { ...state.mediaAvailability, ...restored.availability },
      selectedSceneId:
        deletedScene !== undefined
          ? project.scenes.some((scene) => scene.id === selectedSceneId)
            ? selectedSceneId
            : deletedScene.selectedSceneIdAfter
          : project.scenes.some((scene) => scene.id === selectedSceneId)
            ? selectedSceneId
            : project.scenes[0]?.id,
      diagnostics: validateProjectConsistency(project),
      undoStack: [...undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: redoStack.slice(0, -1),
      historyNotice:
        entry.deletedScene === undefined
          ? restored.discarded
            ? `已重做：${entry.label}；Speech 文件修订已改变，已恢复为缺 Speech`
            : `已重做：${entry.label}`
          : undefined,
      historyAnnouncement:
        entry.deletedScene === undefined
          ? undefined
          : restored.discarded
            ? `已重做：${entry.label}；Speech 文件修订已改变，已恢复为缺 Speech`
            : `已重做：${entry.label}`,
      historyEventId: state.historyEventId + 1,
      historyFocusRequest:
        deletedScene !== undefined
          ? deletedScene.focusSceneIdAfter === undefined
            ? {
                eventId: state.historyEventId + 1,
                target: "add-scene",
                force: true,
              }
            : {
                eventId: state.historyEventId + 1,
                sceneId: deletedScene.focusSceneIdAfter,
                target: "scene-select",
                force: true,
              }
          : entry.sceneId === undefined || entry.focusTarget === undefined
            ? undefined
            : {
                eventId: state.historyEventId + 1,
                sceneId: entry.sceneId,
                target: entry.focusTarget,
              },
    }));
    await scheduleProjectSave(project, "immediate", set, get);
  },
  clearHistoryNotice: () => set({ historyNotice: undefined }),
  registerAsset: async (asset, videoDurationInFrames) => {
    const project = get().project;
    if (project === undefined || !canMutateProject(get)) return false;
    const existing = project.assets.find((candidate) => candidate.id === asset.id);
    if (existing !== undefined) return sameSerializableValue(existing, asset);
    const nextProject: Project = {
      ...project,
      assets: [...project.assets, asset],
    };
    const structural = validateProjectStructure(nextProject);
    const diagnostics = structural.success
      ? validateProjectConsistency(structural.project)
      : structural.diagnostics;
    if (!structural.success || hasSaveBlockingError(diagnostics)) {
      throw new Error(structuralErrorMessage(diagnostics));
    }
    finishTextTransaction();
    set((state) => ({
      project: structural.project,
      diagnostics,
      mediaAvailability: { ...state.mediaAvailability, [asset.path]: true },
      videoDurationInFrames:
        videoDurationInFrames === undefined
          ? state.videoDurationInFrames
          : { ...state.videoDurationInFrames, [asset.path]: videoDurationInFrames },
    }));
    await scheduleProjectSave(structural.project, "immediate", set, get);
    return true;
  },
  bindAsset: async (sceneId, assetId) => {
    const project = get().project;
    if (project === undefined || !canMutateProject(get)) return false;
    const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
    const scene = project.scenes[sceneIndex];
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (
      scene === undefined ||
      scene.visual.type === "card" ||
      asset === undefined ||
      asset.kind !== scene.visual.type ||
      scene.visual.assetId === assetId
    ) {
      return false;
    }
    const nextProject: Project = {
      ...project,
      scenes: project.scenes.map((candidate) =>
        candidate.id === sceneId
          ? { ...candidate, visual: { ...candidate.visual, assetId } }
          : candidate,
      ),
    };
    const structural = validateProjectStructure(nextProject);
    const diagnostics = structural.success
      ? validateProjectConsistency(structural.project)
      : structural.diagnostics;
    if (!structural.success || hasSaveBlockingError(diagnostics)) {
      throw new Error(structuralErrorMessage(diagnostics));
    }
    finishTextTransaction();
    const entry: HistoryEntry = {
      id: ++nextHistoryEntryId,
      before: immutableProject(project),
      after: immutableProject(structural.project),
      beforeSpeechRevisions: revisionsForProject(project, get().mediaRevisions),
      afterSpeechRevisions: revisionsForProject(structural.project, get().mediaRevisions),
      label: `绑定 Scene ${String(sceneIndex + 1).padStart(2, "0")} Asset`,
      sceneId,
      focusTarget: "visual-type",
    };
    set({
      project: structural.project,
      diagnostics,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
    });
    await scheduleProjectSave(structural.project, "immediate", set, get);
    return true;
  },
  clearAsset: async (sceneId) => {
    const project = get().project;
    if (project === undefined || !canMutateProject(get)) return false;
    const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
    const scene = project.scenes[sceneIndex];
    if (
      scene === undefined ||
      scene.visual.type === "card" ||
      scene.visual.assetId === undefined
    ) {
      return false;
    }
    const nextProject: Project = {
      ...project,
      scenes: project.scenes.map((candidate) => {
        if (candidate.id !== sceneId || candidate.visual.type === "card") {
          return candidate;
        }
        const { assetId: _assetId, ...visual } = candidate.visual;
        return { ...candidate, visual };
      }),
    };
    const structural = validateProjectStructure(nextProject);
    const diagnostics = structural.success
      ? validateProjectConsistency(structural.project)
      : structural.diagnostics;
    if (!structural.success || hasSaveBlockingError(diagnostics)) {
      throw new Error(structuralErrorMessage(diagnostics));
    }
    finishTextTransaction();
    const entry: HistoryEntry = {
      id: ++nextHistoryEntryId,
      before: immutableProject(project),
      after: immutableProject(structural.project),
      beforeSpeechRevisions: revisionsForProject(project, get().mediaRevisions),
      afterSpeechRevisions: revisionsForProject(structural.project, get().mediaRevisions),
      label: `清除 Scene ${String(sceneIndex + 1).padStart(2, "0")} Asset 绑定`,
      sceneId,
      focusTarget: "visual-type",
    };
    set((state) => ({
      project: structural.project,
      diagnostics,
      undoStack: [...state.undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
      historyNotice: "已清除绑定 · 可撤销",
      historyAnnouncement: undefined,
      historyEventId: state.historyEventId + 1,
    }));
    await scheduleProjectSave(structural.project, "immediate", set, get);
    return true;
  },
  applyJobResult: async (result) => {
    const releaseSpeechCommit =
      result.kind === "speech" ? await acquireSpeechCommit() : undefined;
    try {
      if (result.kind === "speech") await get().flushSave();
    const project = get().project;
    if (project === undefined || !canMutateProject(get)) return false;
    const sceneIndex = project.scenes.findIndex(
      (scene) => scene.id === result.sceneId,
    );
    const scene = project.scenes[sceneIndex];
    if (scene === undefined) return false;

    let nextProject: Project;
    let historyBefore = project;
    let label: string;
    let notice: string;
    if (result.kind === "speech") {
      if (
        scene.narration.text !== result.expected.narrationText ||
        !sameSerializableValue(scene.speech, result.expected.speech)
      ) {
        return false;
      }
      nextProject = {
        ...project,
        scenes: project.scenes.map((candidate) =>
          candidate.id === result.sceneId
            ? { ...candidate, speech: result.speech }
            : candidate,
        ),
      };
      label = `应用 Scene ${String(sceneIndex + 1).padStart(2, "0")} Speech`;
      notice = "Speech 已应用 · 可撤销";
    } else {
      const existingAsset = project.assets.find(
        (asset) => asset.id === result.asset.id,
      );
      if (
        scene.visual.type === "card" ||
        scene.visual.type !== result.expected.visualType ||
        scene.visual.assetId !== result.expected.assetId ||
        result.asset.kind !== result.expected.visualType ||
        (existingAsset !== undefined &&
          !sameSerializableValue(existingAsset, result.asset))
      ) {
        return false;
      }
      const projectWithAsset: Project =
        existingAsset === undefined
          ? { ...project, assets: [...project.assets, result.asset] }
          : project;
      historyBefore = projectWithAsset;
      nextProject = {
        ...projectWithAsset,
        scenes: project.scenes.map((candidate) =>
          candidate.id === result.sceneId && candidate.visual.type !== "card"
            ? {
                ...candidate,
                visual: { ...candidate.visual, assetId: result.asset.id },
              }
            : candidate,
        ),
      };
      label = `应用 Scene ${String(sceneIndex + 1).padStart(2, "0")} Asset`;
      notice = "Asset 已应用 · 可撤销";
    }

    const structural = validateProjectStructure(nextProject);
    const diagnostics = structural.success
      ? validateProjectConsistency(structural.project)
      : structural.diagnostics;
    if (!structural.success || hasSaveBlockingError(diagnostics)) {
      throw new Error(structuralErrorMessage(diagnostics));
    }
    let committedEtag: string | undefined;
    if (result.kind === "speech") {
      set({ speechCommitInFlight: true });
      try {
        committedEtag = await commitSpeechProject(result.jobId, structural.project);
      } catch (error) {
        set({ speechCommitInFlight: false });
        throw error;
      }
      expectedProjectEtag = committedEtag;
      lastSavedCanonical = canonicalProject(structural.project);
      pendingSave = undefined;
      clearSaveTimers();
    }
    finishTextTransaction();
    const entry: HistoryEntry = {
      id: ++nextHistoryEntryId,
      before: immutableProject(historyBefore),
      after: immutableProject(structural.project),
      label,
      sceneId: result.sceneId,
      focusTarget: result.kind === "speech" ? "narration" : "visual-type",
      beforeSpeechRevisions: revisionsForProject(
        historyBefore,
        get().mediaRevisions,
      ),
      afterSpeechRevisions:
        result.kind === "speech"
          ? {
              ...revisionsForProject(structural.project, get().mediaRevisions),
              [result.speech.path]: result.fileRevision,
            }
          : revisionsForProject(structural.project, get().mediaRevisions),
    };
    set((state) => ({
      project: structural.project,
      diagnostics,
      mediaAvailability:
        result.kind === "asset"
          ? { ...state.mediaAvailability, [result.asset.path]: true }
          : { ...state.mediaAvailability, [result.speech.path]: true },
      videoDurationInFrames:
        result.kind !== "asset" || result.videoDurationInFrames === undefined
          ? state.videoDurationInFrames
          : {
              ...state.videoDurationInFrames,
              [result.asset.path]: result.videoDurationInFrames,
            },
      mediaDiagnostics: state.mediaDiagnostics.filter((diagnostic) => {
        if (result.kind === "speech") {
          return diagnostic.relativePath !== result.speech.path &&
            !(diagnostic.sceneId === result.sceneId && diagnostic.path.includes("speech"));
        }
        if (diagnostic.sceneId !== result.sceneId) return true;
        return !diagnostic.path.some((segment) => segment === "visual" || segment === "assetId");
      }),
      mediaRevisions:
        result.kind === "speech"
          ? { ...state.mediaRevisions, [result.speech.path]: result.fileRevision }
          : state.mediaRevisions,
      undoStack: [...state.undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
      historyNotice: notice,
      historyAnnouncement: undefined,
      historyEventId: state.historyEventId + 1,
      ...(result.kind === "speech"
        ? {
            speechCommitInFlight: false,
            saveStatus: "saved" as const,
            saveErrorMessage: undefined,
            saveRetryAttempt: undefined,
            saveDiagnostics: [],
            dirty: false,
          }
        : {}),
    }));
    if (result.kind === "asset") {
      await scheduleProjectSave(structural.project, "immediate", set, get);
    }
      return true;
    } finally {
      releaseSpeechCommit?.();
    }
  },
  updateVisual: async (sceneId, visual) => {
    const project = get().project;
    if (project === undefined || !canMutateProject(get)) return;

    const nextProject: Project = {
      ...project,
      scenes: project.scenes.map((scene) =>
        scene.id === sceneId ? { ...scene, visual } : scene,
      ),
    };
    const structural = validateProjectStructure(nextProject);
    const diagnostics = structural.success
      ? validateProjectConsistency(structural.project)
      : structural.diagnostics;
    if (!structural.success || hasSaveBlockingError(diagnostics)) {
      throw new Error(structuralErrorMessage(diagnostics));
    }
    finishTextTransaction();
    const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
    const previousVisual = project.scenes[sceneIndex]?.visual;
    const entry: HistoryEntry = {
      id: ++nextHistoryEntryId,
      before: immutableProject(project),
      after: immutableProject(structural.project),
      beforeSpeechRevisions: revisionsForProject(project, get().mediaRevisions),
      afterSpeechRevisions: revisionsForProject(structural.project, get().mediaRevisions),
      label:
        previousVisual?.type === visual.type
          ? `编辑 Scene ${String(sceneIndex + 1).padStart(2, "0")} 画面内容`
          : `切换 Scene ${String(sceneIndex + 1).padStart(2, "0")} 画面类型`,
      sceneId,
      focusTarget: "visual-type",
    };
    set({
      project: structural.project,
      diagnostics,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
    });
    await scheduleProjectSave(structural.project, "immediate", set, get);
  },
  reorderScene: async (sceneId, targetIndex) => {
    const project = get().project;
    if (project === undefined || !canMutateProject(get)) return;
    const sourceIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
    if (
      sourceIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= project.scenes.length ||
      sourceIndex === targetIndex
    ) {
      return;
    }

    const scenes = [...project.scenes];
    const [scene] = scenes.splice(sourceIndex, 1);
    scenes.splice(targetIndex, 0, scene);
    const nextProject: Project = { ...project, scenes };
    const structural = validateProjectStructure(nextProject);
    const diagnostics = structural.success
      ? validateProjectConsistency(structural.project)
      : structural.diagnostics;
    if (!structural.success || hasSaveBlockingError(diagnostics)) {
      throw new Error(structuralErrorMessage(diagnostics));
    }
    finishTextTransaction();
    const entry: HistoryEntry = {
      id: ++nextHistoryEntryId,
      before: immutableProject(project),
      after: immutableProject(structural.project),
      beforeSpeechRevisions: revisionsForProject(project, get().mediaRevisions),
      afterSpeechRevisions: revisionsForProject(structural.project, get().mediaRevisions),
      label: `移动 Scene ${String(sourceIndex + 1).padStart(2, "0")} 到第 ${targetIndex + 1} 项`,
      sceneId,
      focusTarget: "reorder",
    };
    set({
      project: structural.project,
      diagnostics,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
    });
    await scheduleProjectSave(structural.project, "immediate", set, get);
  },
  deleteScene: async (sceneId) => {
    const project = get().project;
    if (project === undefined || !canMutateProject(get)) return false;
    const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
    if (sceneIndex < 0) return false;

    const scenes = project.scenes.filter((scene) => scene.id !== sceneId);
    const nextProject: Project = { ...project, scenes };
    const structural = validateProjectStructure(nextProject);
    const diagnostics = structural.success
      ? validateProjectConsistency(structural.project)
      : structural.diagnostics;
    if (!structural.success || hasSaveBlockingError(diagnostics)) {
      throw new Error(structuralErrorMessage(diagnostics));
    }

    const focusSceneIdAfter = scenes[sceneIndex]?.id ?? scenes[sceneIndex - 1]?.id;
    const currentSelectedSceneId = get().selectedSceneId;
    const selectedSceneIdAfter =
      currentSelectedSceneId === sceneId
        ? focusSceneIdAfter
        : scenes.some((scene) => scene.id === currentSelectedSceneId)
          ? currentSelectedSceneId
          : focusSceneIdAfter;
    finishTextTransaction();
    const entry: HistoryEntry = {
      id: ++nextHistoryEntryId,
      before: immutableProject(project),
      after: immutableProject(structural.project),
      beforeSpeechRevisions: revisionsForProject(project, get().mediaRevisions),
      afterSpeechRevisions: revisionsForProject(
        structural.project,
        get().mediaRevisions,
      ),
      label: `删除 Scene ${String(sceneIndex + 1).padStart(2, "0")}`,
      sceneId,
      deletedScene: {
        sceneId,
        selectedSceneIdAfter,
        focusSceneIdAfter,
      },
    };
    set((state) => ({
      project: structural.project,
      diagnostics,
      selectedSceneId: selectedSceneIdAfter,
      undoStack: [...state.undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
      historyNotice: undefined,
      historyAnnouncement: `已删除 Scene ${sceneIndex + 1}，可撤销`,
      historyEventId: state.historyEventId + 1,
      historyFocusRequest:
        focusSceneIdAfter === undefined
          ? {
              eventId: state.historyEventId + 1,
              target: "add-scene",
              force: true,
            }
          : {
              eventId: state.historyEventId + 1,
              sceneId: focusSceneIdAfter,
              target: "scene-select",
              force: true,
            },
    }));
    await scheduleProjectSave(structural.project, "immediate", set, get);
    return true;
  },
  addScenesFromLines: async (lines, visualType = "video") => {
    const project = get().project;
    if (project === undefined || !canMutateProject(get) || lines.length === 0) {
      return;
    }

    const newScenes = lines.map((text) => ({
      id: createClientUuid(),
      narration: { text },
      visual: { type: visualType },
      transition: "cut" as const,
    }));
    const scenes = [...project.scenes];
    scenes.push(...newScenes);
    const nextProject: Project = { ...project, scenes };
    const structural = validateProjectStructure(nextProject);
    const diagnostics = structural.success
      ? validateProjectConsistency(structural.project)
      : structural.diagnostics;
    if (!structural.success || hasSaveBlockingError(diagnostics)) {
      throw new Error(structuralErrorMessage(diagnostics));
    }
    finishTextTransaction();
    const entry: HistoryEntry = {
      id: ++nextHistoryEntryId,
      before: immutableProject(project),
      after: immutableProject(structural.project),
      beforeSpeechRevisions: revisionsForProject(project, get().mediaRevisions),
      afterSpeechRevisions: revisionsForProject(structural.project, get().mediaRevisions),
      label:
        newScenes.length === 1
          ? "新增 1 个 Scene"
          : `新增 ${newScenes.length} 个 Scene`,
      sceneId: newScenes[0]?.id,
      focusTarget: "narration",
    };
    set({
      project: structural.project,
      diagnostics,
      selectedSceneId: newScenes[0]?.id,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
    });
    await scheduleProjectSave(structural.project, "immediate", set, get);
  },
}));

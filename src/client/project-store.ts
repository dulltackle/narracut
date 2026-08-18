import { create } from "zustand";

import {
  CURRENT_SCHEMA_VERSION,
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
} from "../shared/project";

export type ProjectInfo = {
  projectDirectory: string;
  projectFile: string;
  fallbackName: string;
};

type UnknownProject = Record<string, unknown>;

type HistoryFocusTarget = "narration" | "visual-type" | "reorder";

type HistoryEntry = {
  id: number;
  before: Project;
  after: Project;
  label: string;
  sceneId?: string;
  focusTarget?: HistoryFocusTarget;
};

export type ProjectJobResult =
  | {
      kind: "speech";
      sceneId: string;
      expected: { narrationText: string; speech: Speech | undefined };
      speech: Speech;
    }
  | {
      kind: "asset";
      sceneId: string;
      expected: {
        visualType: "image" | "video";
        assetId: string | undefined;
      };
      asset: Asset;
    };

type ProjectState = {
  phase: "loading" | "ready" | "readonly" | "error";
  project?: Project;
  unknownProject?: UnknownProject;
  unknownVersion?: number;
  info?: ProjectInfo;
  diagnostics: Diagnostic[];
  mediaAvailability: Record<string, boolean>;
  errorMessage?: string;
  selectedSceneId?: string;
  saveStatus: "saved" | "saving" | "error";
  saveErrorMessage?: string;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  historyNotice?: string;
  historyEventId: number;
  historyFocusRequest?: {
    eventId: number;
    sceneId: string;
    target: HistoryFocusTarget;
  };
  taskDrawerOpen: boolean;
  load: () => Promise<void>;
  selectScene: (sceneId: string) => void;
  setTaskDrawerOpen: (open: boolean) => void;
  updateProjectName: (name: string) => Promise<void>;
  updateTheme: (theme: Project["theme"]) => Promise<void>;
  updateNarration: (sceneId: string, text: string) => void;
  endTextTransaction: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clearHistoryNotice: () => void;
  bindAsset: (sceneId: string, assetId: string) => Promise<boolean>;
  applyJobResult: (result: ProjectJobResult) => Promise<boolean>;
  updateVisual: (sceneId: string, visual: Visual) => Promise<void>;
  reorderScene: (sceneId: string, targetIndex: number) => Promise<void>;
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
  "LOGO_ASSET_MISSING",
  "LOGO_ASSET_KIND_MISMATCH",
]);

function hasSaveBlockingError(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      !renderOnlyDiagnosticCodes.has(diagnostic.code),
  );
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveQueue: Promise<void> = Promise.resolve();
let latestSaveRevision = 0;
let nextHistoryEntryId = 0;
let textTransaction:
  | { key: string; entryId: number; lastEditAt: number }
  | undefined;
let textTransactionTimer: ReturnType<typeof setTimeout> | undefined;

const TEXT_TRANSACTION_IDLE_MS = 750;
const HISTORY_LIMIT = 100;

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

async function saveProject(project: Project): Promise<void> {
  const response = await fetch("/api/project", {
    method: "PUT",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: `${JSON.stringify(project, null, 2)}\n`,
  });
  if (!response.ok) throw new Error(`保存失败：HTTP ${response.status}`);
}

function enqueueSave(
  project: Project,
  revision: number,
  setState: (state: Partial<ProjectState>) => void,
): Promise<void> {
  const operation = saveQueue
    .catch(() => undefined)
    .then(() => saveProject(project));
  saveQueue = operation;
  return operation.then(
    () => {
      if (revision === latestSaveRevision) setState({ saveStatus: "saved" });
    },
    (error: unknown) => {
      if (revision === latestSaveRevision) setState({ saveStatus: "error" });
      if (revision === latestSaveRevision) {
        setState({
          saveErrorMessage:
            error instanceof Error ? error.message : "无法写入 Project DSL。",
        });
      }
    },
  );
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  phase: "loading",
  diagnostics: [],
  mediaAvailability: {},
  saveStatus: "saved",
  undoStack: [],
  redoStack: [],
  historyEventId: 0,
  taskDrawerOpen: false,
  load: async () => {
    finishTextTransaction();
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = undefined;
    latestSaveRevision += 1;
    set({
      phase: "loading",
      diagnostics: [],
      errorMessage: undefined,
      project: undefined,
      unknownProject: undefined,
      mediaAvailability: {},
      saveStatus: "saved",
      saveErrorMessage: undefined,
      undoStack: [],
      redoStack: [],
      historyNotice: undefined,
      historyFocusRequest: undefined,
    });

    await saveQueue.catch(() => undefined);

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
        });
        return;
      }

      const currentProject = migrateKnownProjectToCurrent(input);
      const structural = validateProjectStructure(currentProject);
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
      if (hasSaveBlockingError(diagnostics)) {
        set({
          phase: "error",
          info,
          diagnostics,
          errorMessage: structuralErrorMessage(diagnostics),
        });
        return;
      }

      const projectPaths = [
        ...structural.project.assets.map((asset) => asset.path),
        ...structural.project.scenes.flatMap((scene) =>
          scene.speech === undefined ? [] : [scene.speech.path],
        ),
      ];
      const uniquePaths = [...new Set(projectPaths)];
      let mediaAvailability: Record<string, boolean> = {};
      if (uniquePaths.length > 0) {
        const probeResponse = await fetch("/api/assets/probe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paths: uniquePaths }),
        });
        if (probeResponse.ok) {
          const payload = (await probeResponse.json()) as {
            results: Array<{ path: string; exists: boolean }>;
          };
          mediaAvailability = Object.fromEntries(
            payload.results.map((result) => [result.path, result.exists]),
          );
        }
      }

      set({
        phase: "ready",
        info,
        project: structural.project,
        diagnostics,
        mediaAvailability,
        selectedSceneId: structural.project.scenes[0]?.id,
        saveStatus: "saved",
      });
    } catch (error) {
      set({
        phase: "error",
        diagnostics:
          error instanceof ProjectMigrationError ? error.diagnostics : [],
        errorMessage:
          error instanceof Error ? error.message : "Project DSL 加载失败。",
      });
    }
  },
  selectScene: (selectedSceneId) => set({ selectedSceneId }),
  setTaskDrawerOpen: (taskDrawerOpen) => set({ taskDrawerOpen }),
  updateProjectName: async (name) => {
    const project = get().project;
    if (project === undefined || get().phase !== "ready") return;

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
      label: "重命名项目",
    };
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set({
      project: nextProject,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
      saveStatus: "saving",
      saveErrorMessage: undefined,
    });
    await enqueueSave(nextProject, revision, set);
  },
  updateTheme: async (theme) => {
    const project = get().project;
    if (project === undefined || get().phase !== "ready") return;
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
      label: "编辑 Project Theme",
    };
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set({
      project: structural.project,
      diagnostics,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
      saveStatus: "saving",
      saveErrorMessage: undefined,
    });
    await enqueueSave(structural.project, revision, set);
  },
  updateNarration: (sceneId, text) => {
    const project = get().project;
    if (project === undefined || get().phase !== "ready") return;

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
        { ...activeEntry, after: immutableProject(nextProject) },
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
      };
      undoStack = [...currentUndoStack, entry].slice(-HISTORY_LIMIT);
      textTransaction = { key: textKey, entryId: entry.id, lastEditAt: now };
    }
    scheduleTextTransactionBoundary(textTransaction.entryId);
    const revision = ++latestSaveRevision;
    set({
      project: nextProject,
      undoStack,
      redoStack: [],
      saveStatus: "saving",
      saveErrorMessage: undefined,
    });
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void enqueueSave(nextProject, revision, set);
    }, 500);
  },
  endTextTransaction: finishTextTransaction,
  undo: async () => {
    finishTextTransaction();
    const { undoStack, redoStack } = get();
    const entry = undoStack.at(-1);
    if (entry === undefined) {
      set((state) => ({
        historyNotice: "没有可撤销的编辑",
        historyEventId: state.historyEventId + 1,
      }));
      return;
    }
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    const project = entry.before;
    const selectedSceneId = get().selectedSceneId;
    set((state) => ({
      project,
      selectedSceneId: project.scenes.some((scene) => scene.id === selectedSceneId)
        ? selectedSceneId
        : project.scenes[0]?.id,
      diagnostics: validateProjectConsistency(project),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, entry],
      historyNotice: `已撤销：${entry.label}`,
      historyEventId: state.historyEventId + 1,
      historyFocusRequest:
        entry.sceneId === undefined || entry.focusTarget === undefined
          ? undefined
          : {
              eventId: state.historyEventId + 1,
              sceneId: entry.sceneId,
              target: entry.focusTarget,
            },
      saveStatus: "saving",
      saveErrorMessage: undefined,
    }));
    await enqueueSave(project, revision, set);
  },
  redo: async () => {
    finishTextTransaction();
    const { undoStack, redoStack } = get();
    const entry = redoStack.at(-1);
    if (entry === undefined) {
      set((state) => ({
        historyNotice: "没有可重做的编辑",
        historyEventId: state.historyEventId + 1,
      }));
      return;
    }
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    const project = entry.after;
    const selectedSceneId = get().selectedSceneId;
    set((state) => ({
      project,
      selectedSceneId: project.scenes.some((scene) => scene.id === selectedSceneId)
        ? selectedSceneId
        : project.scenes[0]?.id,
      diagnostics: validateProjectConsistency(project),
      undoStack: [...undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: redoStack.slice(0, -1),
      historyNotice: `已重做：${entry.label}`,
      historyEventId: state.historyEventId + 1,
      historyFocusRequest:
        entry.sceneId === undefined || entry.focusTarget === undefined
          ? undefined
          : {
              eventId: state.historyEventId + 1,
              sceneId: entry.sceneId,
              target: entry.focusTarget,
            },
      saveStatus: "saving",
      saveErrorMessage: undefined,
    }));
    await enqueueSave(project, revision, set);
  },
  clearHistoryNotice: () => set({ historyNotice: undefined }),
  bindAsset: async (sceneId, assetId) => {
    const project = get().project;
    if (project === undefined || get().phase !== "ready") return false;
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
      label: `绑定 Scene ${String(sceneIndex + 1).padStart(2, "0")} Asset`,
      sceneId,
      focusTarget: "visual-type",
    };
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set({
      project: structural.project,
      diagnostics,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
      saveStatus: "saving",
      saveErrorMessage: undefined,
    });
    await enqueueSave(structural.project, revision, set);
    return true;
  },
  applyJobResult: async (result) => {
    const project = get().project;
    if (project === undefined || get().phase !== "ready") return false;
    const sceneIndex = project.scenes.findIndex(
      (scene) => scene.id === result.sceneId,
    );
    const scene = project.scenes[sceneIndex];
    if (scene === undefined) return false;

    let nextProject: Project;
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
      nextProject = {
        ...project,
        assets:
          existingAsset === undefined
            ? [...project.assets, result.asset]
            : project.assets,
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
    finishTextTransaction();
    const entry: HistoryEntry = {
      id: ++nextHistoryEntryId,
      before: immutableProject(project),
      after: immutableProject(structural.project),
      label,
      sceneId: result.sceneId,
      focusTarget: result.kind === "speech" ? "narration" : "visual-type",
    };
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set((state) => ({
      project: structural.project,
      diagnostics,
      undoStack: [...state.undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
      historyNotice: notice,
      historyEventId: state.historyEventId + 1,
      saveStatus: "saving",
      saveErrorMessage: undefined,
    }));
    await enqueueSave(structural.project, revision, set);
    return true;
  },
  updateVisual: async (sceneId, visual) => {
    const project = get().project;
    if (project === undefined || get().phase !== "ready") return;

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
      label:
        previousVisual?.type === visual.type
          ? `编辑 Scene ${String(sceneIndex + 1).padStart(2, "0")} 画面内容`
          : `切换 Scene ${String(sceneIndex + 1).padStart(2, "0")} 画面类型`,
      sceneId,
      focusTarget: "visual-type",
    };
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set({
      project: structural.project,
      diagnostics,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
      saveStatus: "saving",
      saveErrorMessage: undefined,
    });
    await enqueueSave(structural.project, revision, set);
  },
  reorderScene: async (sceneId, targetIndex) => {
    const project = get().project;
    if (project === undefined || get().phase !== "ready") return;
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
      label: `移动 Scene ${String(sourceIndex + 1).padStart(2, "0")} 到第 ${targetIndex + 1} 项`,
      sceneId,
      focusTarget: "reorder",
    };
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set({
      project: structural.project,
      diagnostics,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
      saveStatus: "saving",
      saveErrorMessage: undefined,
    });
    await enqueueSave(structural.project, revision, set);
  },
  addScenesFromLines: async (lines, visualType = "video") => {
    const project = get().project;
    if (project === undefined || get().phase !== "ready" || lines.length === 0) {
      return;
    }

    const newScenes = lines.map((text) => ({
      id: crypto.randomUUID(),
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
      label:
        newScenes.length === 1
          ? "新增 1 个 Scene"
          : `新增 ${newScenes.length} 个 Scene`,
      sceneId: newScenes[0]?.id,
      focusTarget: "narration",
    };
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set({
      project: structural.project,
      diagnostics,
      selectedSceneId: newScenes[0]?.id,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
      saveStatus: "saving",
      saveErrorMessage: undefined,
    });
    await enqueueSave(structural.project, revision, set);
  },
}));

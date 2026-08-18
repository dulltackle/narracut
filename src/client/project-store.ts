import { create } from "zustand";

import {
  CURRENT_SCHEMA_VERSION,
  migrateKnownProjectToCurrent,
  ProjectMigrationError,
  readSchemaVersion,
  type Diagnostic,
  type Project,
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
  taskDrawerOpen: boolean;
  load: () => Promise<void>;
  selectScene: (sceneId: string) => void;
  setTaskDrawerOpen: (open: boolean) => void;
  updateProjectName: (name: string) => Promise<void>;
  updateTheme: (theme: Project["theme"]) => Promise<void>;
  updateNarration: (sceneId: string, text: string) => void;
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
  taskDrawerOpen: false,
  load: async () => {
    set({
      phase: "loading",
      diagnostics: [],
      errorMessage: undefined,
      project: undefined,
      unknownProject: undefined,
      mediaAvailability: {},
      saveStatus: "saved",
      saveErrorMessage: undefined,
    });

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
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set({
      project: nextProject,
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
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set({
      project: structural.project,
      diagnostics,
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
    const revision = ++latestSaveRevision;
    set({
      project: nextProject,
      saveStatus: "saving",
      saveErrorMessage: undefined,
    });
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void enqueueSave(nextProject, revision, set);
    }, 500);
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
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set({
      project: structural.project,
      diagnostics,
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
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set({
      project: structural.project,
      diagnostics,
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
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const revision = ++latestSaveRevision;
    set({
      project: structural.project,
      diagnostics,
      selectedSceneId: newScenes[0]?.id,
      saveStatus: "saving",
      saveErrorMessage: undefined,
    });
    await enqueueSave(structural.project, revision, set);
  },
}));

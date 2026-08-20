import { StrictMode, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Player, type PlayerRef } from "@remotion/player";
import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ArrowDown } from "@phosphor-icons/react/ArrowDown";
import { ArrowUp } from "@phosphor-icons/react/ArrowUp";
import { ArrowUUpLeft } from "@phosphor-icons/react/ArrowUUpLeft";
import { ArrowsOutSimple } from "@phosphor-icons/react/ArrowsOutSimple";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CircleNotch } from "@phosphor-icons/react/CircleNotch";
import { ClipboardText } from "@phosphor-icons/react/ClipboardText";
import { DotsSixVertical } from "@phosphor-icons/react/DotsSixVertical";
import { FilmSlate } from "@phosphor-icons/react/FilmSlate";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { ImageSquare } from "@phosphor-icons/react/ImageSquare";
import { ListChecks } from "@phosphor-icons/react/ListChecks";
import { LockSimple } from "@phosphor-icons/react/LockSimple";
import { Pause } from "@phosphor-icons/react/Pause";
import { Play } from "@phosphor-icons/react/Play";
import { Plus } from "@phosphor-icons/react/Plus";
import { SpeakerHigh } from "@phosphor-icons/react/SpeakerHigh";
import { Trash } from "@phosphor-icons/react/Trash";
import { UploadSimple } from "@phosphor-icons/react/UploadSimple";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";

import type { Asset, Scene, Visual } from "../shared/project";
import type { RenderJob } from "../shared/jobs";
import { CURRENT_SCHEMA_VERSION } from "../shared/project";
import { ProjectComposition } from "../remotion/ProjectComposition";
import {
  createPreviewSnapshot,
  findSceneAtFrame,
  frameForSceneOffset,
  validateRenderReadiness,
} from "../remotion/render-snapshot";
import { useProjectStore } from "./project-store";
import {
  imageImportStageCopy,
  latestImageJobForScene,
  useImageImportStore,
  type ClientImageImportJob,
} from "./image-import-store";
import {
  latestSpeechJobForScene,
  speechGenerationStageCopy,
  useSpeechGenerationStore,
  type ClientSpeechGenerationJob,
} from "./speech-generation-store";
import { useVideoThumbnail } from "./video-thumbnail-store";
import {
  activeRenderJob,
  latestRenderJob,
  renderStageCopy,
  useRenderJobStore,
} from "./render-job-store";
import {
  ProjectThemeInspector,
  SceneTextPresentationInspector,
} from "./text-presentation-controls";
import {
  hasCaption,
  migrateVisual,
  type CardVisual,
  type VisualType,
} from "./visual-migration";
import "./styles.css";

const visualLabels: Record<Visual["type"], string> = {
  card: "Card",
  image: "Image",
  video: "Video",
};

const inspectorVisualLabels: Record<Visual["type"], string> = {
  card: "文字卡片",
  image: "图片",
  video: "视频",
};

function BrandMark() {
  return (
    <div className="mark" aria-hidden="true">
      N
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="app-shell" data-testid="loading-screen">
      <header className="simple-topbar">
        <BrandMark />
        <div>
          <strong>Narracut</strong>
          <span>本地项目工作台</span>
        </div>
      </header>
      <main className="workspace loading-workspace" aria-hidden="true">
        <section className="pane script-pane loading-pane"><div className="pane-head"><span className="loading-skeleton loading-title" /></div><div className="loading-rows">{Array.from({ length: 5 }, (_, index) => <div className="loading-row" key={index}><span className="loading-skeleton" /><span className="loading-skeleton wide" /><span className="loading-skeleton" /><span className="loading-skeleton" /></div>)}</div></section>
        <section className="pane player-pane loading-pane"><div className="pane-head"><span className="loading-skeleton loading-title" /></div><div className="stage"><div className="loading-player-frame" /></div></section>
        <section className="pane inspector-pane loading-pane"><div className="pane-head"><span className="loading-skeleton loading-title" /></div><div className="loading-inspector"><span className="loading-skeleton" /><span className="loading-skeleton short" /><span className="loading-skeleton tall" /></div></section>
      </main>
      <section className="loading-overlay" aria-live="polite">
        <div className="state-card">
          <CircleNotch className="spinner" size={48} aria-hidden="true" />
          <h1>正在打开项目</h1>
          <p>先完成结构与内部一致性校验，再进入可编辑工作台。加载过程中不会改写项目文件。</p>
          <ol className="loading-steps">
            <li className="done"><CheckCircle weight="fill" />读取 Project DSL <span>完成</span></li>
            <li className="current"><CircleNotch />校验 Scene 与持久引用 <span>进行中</span></li>
            <li><CircleNotch />探测本地媒体 <span>等待</span></li>
            <li><CircleNotch />建立编辑运行时 <span>等待</span></li>
          </ol>
          <div className="loading-progress"><span /></div>
        </div>
      </section>
    </div>
  );
}

function ErrorScreen() {
  const info = useProjectStore((state) => state.info);
  const diagnostics = useProjectStore((state) => state.diagnostics);
  const errorMessage = useProjectStore((state) => state.errorMessage);
  const load = useProjectStore((state) => state.load);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const diagnostic = diagnostics[0];

  return (
    <div className="app-shell">
      <header className="simple-topbar">
        <BrandMark />
        <div><strong>Narracut</strong><span>本地项目工作台</span></div>
      </header>
      <main className="centered-state">
        <section className="state-card error-card">
          <WarningCircle className="state-icon danger" size={52} weight="fill" />
          <p className="eyebrow danger-text">项目未打开</p>
          <h1>Project DSL 校验失败</h1>
          <p>我们没有进入编辑运行时，也没有改写原始文件。修正以下结构问题后可重新加载。</p>
          <div className="diagnostic-card">
            <strong>{errorMessage}</strong>
            {diagnostic ? <p>{diagnostic.path.join(".") || "project.json"}：{diagnostic.message}</p> : null}
          </div>
          <div className="path-box">{info?.projectFile ?? "project.json"}</div>
          <div className="state-actions">
            <button className="btn primary" onClick={() => void load()}><ArrowCounterClockwise />重新加载</button>
            <button className="btn" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
              <ClipboardText />{detailsOpen ? "收起技术详情" : "查看技术详情"}
            </button>
          </div>
          {detailsOpen ? (
            <pre data-testid="error-details">{JSON.stringify(diagnostics, null, 2) || "PROJECT_DSL_READ_FAILED"}</pre>
          ) : null}
          <p className="state-help">这不是媒体缺失或 Render-ready 问题；Project DSL 必须先通过结构与内部一致性校验。</p>
        </section>
      </main>
    </div>
  );
}

function safeUnknownScenes(project: Record<string, unknown> | undefined) {
  if (!Array.isArray(project?.scenes)) return [];
  return project.scenes.flatMap((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const scene = value as Record<string, unknown>;
    const narration = scene.narration;
    const visual = scene.visual;
    const text =
      typeof narration === "object" && narration !== null &&
      typeof Reflect.get(narration, "text") === "string"
        ? String(Reflect.get(narration, "text"))
        : "当前版本无法安全读取 Narration";
    const visualType =
      typeof visual === "object" && visual !== null &&
      typeof Reflect.get(visual, "type") === "string"
        ? String(Reflect.get(visual, "type"))
        : "未知";
    const assetId =
      typeof visual === "object" && visual !== null &&
      typeof Reflect.get(visual, "assetId") === "string"
        ? String(Reflect.get(visual, "assetId"))
        : undefined;
    return [{ index, text, visualType, assetId }];
  });
}

function safeUnknownAssets(project: Record<string, unknown> | undefined): Asset[] {
  if (!Array.isArray(project?.assets)) return [];
  return project.assets.flatMap((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const id = Reflect.get(value, "id");
    const kind = Reflect.get(value, "kind");
    const path = Reflect.get(value, "path");
    if (
      typeof id !== "string" ||
      (kind !== "image" && kind !== "video") ||
      typeof path !== "string"
    ) return [];
    return [{ id, kind, path }];
  });
}

function ReadonlyScreen() {
  const info = useProjectStore((state) => state.info);
  const project = useProjectStore((state) => state.unknownProject);
  const version = useProjectStore((state) => state.unknownVersion);
  const scenes = safeUnknownScenes(project);
  const readonlyAssets = useMemo(() => safeUnknownAssets(project), [project]);
  const assets = useMemo(
    () => new Map(readonlyAssets.map((asset) => [asset.id, asset])),
    [readonlyAssets],
  );
  const [mediaAvailability, setMediaAvailability] = useState<Record<string, boolean>>({});
  const [assetPreview, setAssetPreview] = useState<{
    asset: Asset;
    displayName: string;
    trigger: HTMLElement;
  }>();
  useEffect(() => {
    const paths = [...new Set(readonlyAssets.map((asset) => asset.path))];
    let cancelled = false;
    setMediaAvailability({});
    if (paths.length === 0) return () => { cancelled = true; };
    void fetch("/api/assets/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths }),
    })
      .then(async (response) => response.ok
        ? response.json() as Promise<{ results: Array<{ path: string; exists: boolean }> }>
        : { results: [] })
      .then(({ results }) => {
        if (!cancelled) {
          setMediaAvailability(Object.fromEntries(
            results.map((result) => [result.path, result.exists]),
          ));
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [readonlyAssets]);
  const metadata = project?.metadata;
  const projectName =
    typeof metadata === "object" && metadata !== null &&
    typeof Reflect.get(metadata, "name") === "string"
      ? String(Reflect.get(metadata, "name"))
      : info?.fallbackName ?? "未命名项目";
  const selected = scenes[0];
  const closeAssetPreview = () => {
    const trigger = assetPreview?.trigger;
    setAssetPreview(undefined);
    requestAnimationFrame(() => trigger?.focus());
  };

  return (
    <div className="readonly-shell">
      <section className="readonly-banner">
        <div><LockSimple weight="fill" /><strong>需要升级 Narracut 才能编辑</strong><span>项目使用 schemaVersion {version}，当前应用仅支持到 {CURRENT_SCHEMA_VERSION}。原始文件保持不变。</span></div>
        <button className="btn" onClick={() => void navigator.clipboard.writeText(info?.projectDirectory ?? "")}><ClipboardText />复制项目路径</button>
      </section>
      <Topbar projectName={projectName} readOnly />
      <main className="workspace">
        <section className="pane script-pane readonly-script">
          <PaneHeading title="脚本表" meta={`${scenes.length} 个 Scene · 仅查看`} />
          <div className="table-wrap"><table><thead><tr><th>顺序</th><th>Narration</th><th>Visual Type</th><th>Asset</th><th>状态</th></tr></thead><tbody>
            {scenes.map((scene) => {
              const asset = scene.assetId === undefined ? undefined : assets.get(scene.assetId);
              const displayName = asset?.path.split("/").at(-1) ?? "";
              return <tr key={scene.index}><td>{String(scene.index + 1).padStart(2, "0")}</td><td>{scene.text}</td><td>{scene.visualType}</td><td>{asset === undefined ? <span className="readonly-asset-empty">{scene.assetId === undefined ? "未绑定" : "缺少 Asset"}</span> : <div className="asset-cell asset-bound"><AssetSummaryButton asset={asset} sceneIndex={scene.index} displayName={displayName} detail={`${asset.kind === "image" ? "Image" : "Video"} · 只读检查`} thumbnailAvailable={mediaAvailability[asset.path] ?? false} onOpen={(trigger) => setAssetPreview({ asset, displayName, trigger })} /></div>}</td><td>需新版应用验证</td></tr>;
            })}
          </tbody></table></div>
        </section>
        <section className="pane player-pane"><PaneHeading title="Player" meta="预览不可用" /><div className="stage"><div className="preview-frame"><LockSimple size={48} /><p>{selected?.text ?? "无法安全预览此项目"}</p><span className="preview-badge">仅显示已解析内容</span></div></div></section>
        <section className="pane inspector-pane"><PaneHeading title="属性" meta={selected ? `场景 ${String(selected.index + 1).padStart(2, "0")} · 只读` : "只读"} /><div className="inspector-scroll"><h3>场景</h3>{selected ? <><label>旁白文稿<textarea value={selected.text} disabled /></label><label>画面类型<input value={inspectorVisualLabels[selected.visualType as Visual["type"]] ?? selected.visualType} disabled /></label></> : null}<h3>阻断原因</h3><div className="readonly-note">未知的项目格式版本可能包含当前应用无法安全解释的字段，因此编辑、写入、后台任务与渲染均已阻止。</div></div></section>
      </main>
      {assetPreview ? <AssetPreviewDialog asset={assetPreview.asset} displayName={assetPreview.displayName} available={undefined} onClose={closeAssetPreview} /> : null}
    </div>
  );
}

function PaneHeading({ title, meta, actions }: { title: string; meta: ReactNode; actions?: ReactNode }) {
  return <div className="pane-head"><div className="pane-title"><h2>{title}</h2><span>{meta}</span></div>{actions}</div>;
}

const saveStatusCopy: Record<import("./project-store").SaveStatus, string> = {
  saved: "已保存",
  pending: "待保存",
  saving: "保存中",
  retrying: "保存重试",
  error: "保存失败",
  "blocked-validation": "无法保存",
  migrated: "已升级 · 待保存",
  occupied: "只读占用",
  conflict: "外部冲突",
};

function SaveStateControl() {
  const saveStatus = useProjectStore((state) => state.saveStatus);
  const saveErrorMessage = useProjectStore((state) => state.saveErrorMessage);
  const retryAttempt = useProjectStore((state) => state.saveRetryAttempt);
  const saveDiagnostics = useProjectStore((state) => state.saveDiagnostics);
  const retrySave = useProjectStore((state) => state.retrySave);
  const setTaskDrawerOpen = useProjectStore((state) => state.setTaskDrawerOpen);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasDetails = saveStatus === "error" || saveStatus === "blocked-validation";
  const label =
    saveStatus === "retrying"
      ? `保存重试 ${retryAttempt ?? 1}/3`
      : saveStatus === "blocked-validation"
        ? `无法保存 · ${saveDiagnostics.length} 项问题`
        : saveStatusCopy[saveStatus];
  const icon =
    saveStatus === "saved" ? <CheckCircle weight="fill" />
      : saveStatus === "saving" || saveStatus === "retrying" ? <CircleNotch className="spinner-inline" />
        : saveStatus === "error" || saveStatus === "blocked-validation" || saveStatus === "conflict" ? <WarningCircle weight="fill" />
          : saveStatus === "occupied" ? <LockSimple weight="fill" />
            : <CircleNotch weight="bold" />;

  useEffect(() => {
    if (!hasDetails) setDetailsOpen(false);
  }, [hasDetails]);

  return (
    <div className="save-control">
      <button
        type="button"
        className={`save-state ${saveStatus}`}
        data-testid="save-status"
        aria-expanded={hasDetails ? detailsOpen : undefined}
        aria-haspopup={hasDetails ? "dialog" : undefined}
        onClick={() => hasDetails && setDetailsOpen((open) => !open)}
      >
        <span role={saveStatus === "error" ? "alert" : undefined} aria-live={saveStatus === "error" ? "assertive" : "polite"} aria-atomic="true">{icon}{label}</span>
      </button>
      {detailsOpen ? (
        <section className="save-details" role="dialog" aria-label={label}>
          <strong>{saveStatus === "blocked-validation" ? "Project DSL 尚未写入" : "自动保存已暂停"}</strong>
          <p>{saveErrorMessage ?? "本地项目服务暂时无法完成写入。"}</p>
          <p>当前修改仍安全保留在内存中。</p>
          {saveStatus === "blocked-validation" ? (
            <button className="btn" type="button" onClick={() => { setTaskDrawerOpen(true); setDetailsOpen(false); }}>查看问题</button>
          ) : (
            <button className="btn primary" type="button" onClick={() => { setDetailsOpen(false); void retrySave(); }}>立即重试</button>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Topbar({ projectName, readOnly = false, controlsDisabled = false, renderDisabled = false, renderDiagnostics }: { projectName: string; readOnly?: boolean; controlsDisabled?: boolean; renderDisabled?: boolean; renderDiagnostics?: import("../shared/project").Diagnostic[] }) {
  const info = useProjectStore((state) => state.info);
  const persistedProjectName = useProjectStore((state) => state.project?.metadata.name);
  const setTaskDrawerOpen = useProjectStore((state) => state.setTaskDrawerOpen);
  const projectDiagnostics = useProjectStore((state) => state.diagnostics);
  const imageJobCount = useImageImportStore(
    (state) => Object.keys(state.jobs).length,
  );
  const speechJobCount = useSpeechGenerationStore(
    (state) => Object.keys(state.jobs).length,
  );
  const renderJobs = useRenderJobStore((state) => state.jobs);
  const renderStarting = useRenderJobStore((state) => state.starting);
  const startRender = useRenderJobStore((state) => state.start);
  const openOutput = useRenderJobStore((state) => state.openOutput);
  const diagnostics = renderDiagnostics ?? projectDiagnostics;
  const updateProjectName = useProjectStore((state) => state.updateProjectName);
  const undoStack = useProjectStore((state) => state.undoStack);
  const redoStack = useProjectStore((state) => state.redoStack);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const historyNotice = useProjectStore((state) => state.historyNotice);
  const historyAnnouncement = useProjectStore((state) => state.historyAnnouncement);
  const historyEventId = useProjectStore((state) => state.historyEventId);
  const clearHistoryNotice = useProjectStore((state) => state.clearHistoryNotice);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [showLatestRenderResult, setShowLatestRenderResult] = useState(false);
  const projectNameButtonRef = useRef<HTMLButtonElement>(null);
  const actionsDisabled = readOnly || controlsDisabled;
  const renderBlockers = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const activeRender = activeRenderJob(renderJobs);
  const latestRender = latestRenderJob(renderJobs);
  const undoEntry = undoStack.at(-1);
  const redoEntry = redoStack.at(-1);
  const undoLabel = undoEntry === undefined ? "撤销" : `撤销：${undoEntry.label}`;
  const redoLabel = redoEntry === undefined ? "重做" : `重做：${redoEntry.label}`;
  useEffect(() => {
    if (historyNotice === undefined) return;
    const timer = window.setTimeout(clearHistoryNotice, 2200);
    return () => window.clearTimeout(timer);
  }, [historyEventId, historyNotice, clearHistoryNotice]);
  useEffect(() => {
    if (latestRender?.status !== "succeeded" && latestRender?.status !== "failed") {
      setShowLatestRenderResult(false);
      return;
    }
    setShowLatestRenderResult(true);
    const timer = window.setTimeout(() => setShowLatestRenderResult(false), 8_000);
    return () => window.clearTimeout(timer);
  }, [latestRender?.id, latestRender?.status]);
  useEffect(() => {
    if (actionsDisabled) return;
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const key = event.key.toLowerCase();
      const wantsUndo = (event.metaKey || event.ctrlKey) && key === "z" && !event.shiftKey;
      const wantsRedo =
        ((event.metaKey || event.ctrlKey) && key === "z" && event.shiftKey) ||
        (event.ctrlKey && !event.metaKey && key === "y");
      if (!wantsUndo && !wantsRedo) return;
      event.preventDefault();
      if (wantsUndo) void undo();
      else void redo();
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [actionsDisabled, redo, undo]);
  const beginProjectNameEdit = () => {
    setProjectNameDraft(persistedProjectName ?? "");
    setEditingProjectName(true);
  };
  const finishProjectNameEdit = () => {
    setEditingProjectName(false);
    void updateProjectName(projectNameDraft);
  };
  const cancelProjectNameEdit = () => {
    setEditingProjectName(false);
    requestAnimationFrame(() => projectNameButtonRef.current?.focus());
  };
  const renderLabel =
    renderStarting
      ? "正在创建快照"
      : activeRender !== undefined
        ? activeRender.stage === "encoding" && activeRender.progress !== undefined
          ? `正在渲染 · ${Math.round(activeRender.progress * 100)}%`
          : renderStageCopy[activeRender.stage]
        : showLatestRenderResult && latestRender?.status === "succeeded"
          ? "渲染完成"
          : showLatestRenderResult && latestRender?.status === "failed"
            ? "渲染失败 · 查看"
            : readOnly
              ? "检查并渲染"
              : renderBlockers.length > 0
                ? `检查并渲染 · ${renderBlockers.length}`
                : "渲染 MP4";
  const handleRenderAction = () => {
    if (showLatestRenderResult && latestRender?.status === "failed") {
      setTaskDrawerOpen(true);
      return;
    }
    if (renderBlockers.length > 0 || readOnly) {
      setTaskDrawerOpen(true);
      return;
    }
    void startRender();
  };
  return (
    <header className="topbar">
      <div className="brand"><BrandMark /><div className="project-title">{editingProjectName ? <input autoFocus className="project-name-editor" aria-label="项目名" value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} onBlur={finishProjectNameEdit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.preventDefault(); cancelProjectNameEdit(); } }} /> : actionsDisabled ? <strong>{projectName}</strong> : <button ref={projectNameButtonRef} className="project-name-button" type="button" aria-label="编辑项目名" onClick={beginProjectNameEdit}>{projectName}</button>}<small>{info?.projectDirectory}</small></div>{readOnly ? <span className="readonly-pill">只读模式</span> : <SaveStateControl />}</div>
      <div className="history-cluster">
        <div className="history">
          <button className="btn icon" type="button" aria-label={undoLabel} title={undoLabel} disabled={actionsDisabled || undoEntry === undefined} onClick={() => void undo()}><ArrowUUpLeft /></button>
          <button className="btn icon" type="button" aria-label={redoLabel} title={redoLabel} disabled={actionsDisabled || redoEntry === undefined} onClick={() => void redo()}><ArrowCounterClockwise /></button>
        </div>
        {historyNotice === undefined ? null : <div key={historyEventId} className="history-feedback" role="status" aria-live="polite">{historyNotice}</div>}
        {historyAnnouncement === undefined ? null : <div key={historyEventId} className="sr-only" role="status" aria-live="polite" data-testid="history-announcement">{historyAnnouncement}</div>}
      </div>
      <div className="top-actions"><button className="btn" disabled={readOnly || renderDisabled} onClick={() => setTaskDrawerOpen(true)}><ListChecks />任务 <span className="count">{diagnostics.length + imageJobCount + speechJobCount + Object.keys(renderJobs).length}</span></button>{showLatestRenderResult && latestRender?.status === "succeeded" ? <button className="btn render-output-shortcut" type="button" onClick={() => void openOutput(latestRender.id)}><FolderOpen />打开产物目录</button> : null}<button className="btn primary render-primary" disabled={readOnly || renderDisabled || renderStarting || activeRender !== undefined || (showLatestRenderResult && latestRender?.status === "succeeded")} onClick={handleRenderAction}><FilmSlate />{renderLabel}</button></div>
    </header>
  );
}

function assetForScene(scene: Scene, assets: Map<string, Asset>) {
  if (!("assetId" in scene.visual) || scene.visual.assetId === undefined) return undefined;
  return assets.get(scene.visual.assetId);
}

function captionForVisual(visual: Visual): string | undefined {
  return visual.type === "card" ? undefined : visual.caption?.text;
}

function sceneAssetStatus(
  scene: Scene,
  asset: Asset | undefined,
  mediaAvailability: Record<string, boolean>,
  diagnostics: import("../shared/project").Diagnostic[],
) {
  if ("assetId" in scene.visual && asset === undefined) {
    return { className: "status-error", label: "缺少 Asset" };
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { className: "status-error", label: "渲染阻断" };
  }
  if (asset !== undefined && mediaAvailability[asset.path] === false) {
    return { className: "status-error", label: "文件缺失" };
  }
  return { className: "status-ready", label: "可编辑草稿" };
}

function mediaUrl(path: string): string {
  return `/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function AssetThumbnail({ asset, label, available: availableOverride }: { asset: Asset; label: string; available?: boolean }) {
  const storedAvailable = useProjectStore(
    (state) => state.mediaAvailability[asset.path] !== false,
  );
  const available = availableOverride ?? storedAvailable;
  const videoThumbnail = useVideoThumbnail(
    asset.kind === "video" ? asset.path : undefined,
    available && asset.kind === "video",
  );
  if (!available) {
    return (
      <span className="asset-thumbnail asset-thumbnail-missing" role="img" aria-label={`${label}（文件不可用）`}>
        <ImageSquare aria-hidden="true" />
      </span>
    );
  }
  if (asset.kind === "video") {
    return (
      <span
        ref={videoThumbnail.ref}
        className="asset-thumbnail asset-thumbnail-video"
        data-thumbnail-status={videoThumbnail.status}
        aria-hidden="true"
      >
        {videoThumbnail.url === undefined ? (
          <FilmSlate weight="fill" />
        ) : (
          <img src={videoThumbnail.url} alt="" decoding="async" />
        )}
      </span>
    );
  }
  return (
    <img
      className="asset-thumbnail"
      src={mediaUrl(asset.path)}
      alt=""
      aria-label={label}
    />
  );
}

function AssetSummaryButton({
  asset,
  sceneIndex,
  displayName,
  detail,
  thumbnailAvailable,
  onOpen,
}: {
  asset: Asset;
  sceneIndex: number;
  displayName: string;
  detail: string;
  thumbnailAvailable?: boolean;
  onOpen: (trigger: HTMLElement) => void;
}) {
  return (
    <span
      className="asset-preview-trigger"
      role="button"
      tabIndex={0}
      aria-label={`预览 Scene ${sceneIndex + 1} ${asset.kind === "image" ? "Image" : "Video"} Asset ${displayName}`}
      onClick={(event) => onOpen(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen(event.currentTarget);
      }}
    >
      <AssetThumbnail asset={asset} label={`Scene ${sceneIndex + 1} 已绑定${asset.kind === "image" ? "图片" : "视频"}`} available={thumbnailAvailable} />
      <span className="asset-bound-copy">
        <strong title={displayName}>{displayName}</strong>
        <small>{detail}</small>
      </span>
    </span>
  );
}

function AssetCell({
  scene,
  sceneIndex,
  asset,
  onPreview,
}: {
  scene: Scene;
  sceneIndex: number;
  asset: Asset | undefined;
  onPreview: (
    asset: Asset,
    sceneIndex: number,
    displayName: string,
    trigger: HTMLElement,
  ) => void;
}) {
  const jobs = useImageImportStore((state) => state.jobs);
  const startImport = useImageImportStore((state) => state.startImport);
  const cancel = useImageImportStore((state) => state.cancel);
  const retry = useImageImportStore((state) => state.retry);
  const showPending = useImageImportStore((state) => state.showPending);
  const clearAsset = useProjectStore((state) => state.clearAsset);
  const setTaskDrawerOpen = useProjectStore((state) => state.setTaskDrawerOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const job = latestImageJobForScene(jobs, scene.id);
  const active =
    job?.status === "queued" ||
    job?.status === "processing" ||
    job?.status === "cancelling";
  const sourceName = Object.values(jobs).find(
    (candidate) => candidate.result?.asset.id === asset?.id,
  )?.fileName;
  const assetName = sourceName ?? asset?.path.split("/").at(-1) ?? "";
  const chooseFile = () => inputRef.current?.click();
  const input =
    scene.visual.type === "image" ? (
      <input
        ref={inputRef}
        className="asset-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        aria-label={`为 Scene ${sceneIndex + 1} 选择图片`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file !== undefined) void startImport(scene.id, file);
        }}
      />
    ) : null;

  if (scene.visual.type === "card") {
    return (
      <div className="asset-cell asset-not-applicable" data-asset-cell-scene-id={scene.id}>
        <ImageSquare aria-hidden="true" />
        <span><strong>不适用</strong><small>生成型画面</small></span>
      </div>
    );
  }

  if (scene.visual.type !== "image" && asset === undefined) {
    return (
      <div className="asset-cell asset-not-applicable" data-asset-cell-scene-id={scene.id}>
        <ImageSquare aria-hidden="true" />
        <span><strong>视频 Asset</strong><small>本票不提供导入</small></span>
      </div>
    );
  }

  if (asset !== undefined) {
    const enlarged =
      job?.result?.asset.id === asset.id && job.result.facts.enlarged;
    const cleanupFailed = job?.error?.cleanupFailed === true;
    const operation = active && job !== undefined
      ? {
          tone: "progress",
          copy: job.cancelError ?? imageImportStageCopy[job.stage],
          detail: job.cancelError ? `${job.fileName} · 可再次取消` : job.fileName,
          role: job.cancelError ? "alert" as const : "status" as const,
        }
      : job?.status === "failed" || job?.resolution === "registration-failed"
        ? {
            tone: "error",
            copy: job.error?.message ?? "图片导入失败",
            detail: "旧绑定保持不变",
            role: "alert" as const,
          }
        : job?.resolution === "changed" || job?.resolution === "incompatible"
          ? {
              tone: "pending",
              copy: "导入结果待确认",
              detail: job.resolution === "changed" ? "当前绑定保持不变" : "Visual 已不兼容",
              role: "status" as const,
            }
          : cleanupFailed
            ? {
                tone: "error",
                copy: "临时文件清理失败",
                detail: "当前绑定保持不变 · 查看任务",
                role: "alert" as const,
              }
            : undefined;
    return (
      <div className={`asset-cell asset-bound${operation === undefined ? "" : " has-operation"}`} data-asset-cell-scene-id={scene.id}>
        {input}
        <AssetSummaryButton
          asset={asset}
          sceneIndex={sceneIndex}
          displayName={assetName}
          detail={enlarged ? "Image · 已放大到 1080p" : asset.kind === "image" ? "Image · 1920×1080" : "Video · 原始媒体"}
          onOpen={(trigger) => onPreview(asset, sceneIndex, assetName, trigger)}
        />
        <div className="asset-actions">
          {active && job !== undefined ? (
            <button className="asset-icon-button" type="button" aria-label={`取消导入 ${job.fileName}`} disabled={job.status === "cancelling"} onClick={() => void cancel(job.id)}><X /></button>
          ) : job?.status === "failed" || job?.resolution === "registration-failed" ? (
            <><button className="asset-icon-button" type="button" aria-label={`重试导入 ${job.fileName}`} onClick={() => void retry(job.id)}><ArrowCounterClockwise /></button><button className="asset-icon-button" type="button" aria-label="重新选择图片" onClick={chooseFile}><UploadSimple /></button></>
          ) : job?.resolution === "changed" || job?.resolution === "incompatible" ? (
            <button className="asset-icon-button" type="button" aria-label="查看并确认图片导入结果" onClick={() => { showPending(job.id); setTaskDrawerOpen(true); }}><ListChecks /></button>
          ) : (
            <>{asset.kind === "image" ? <button className="asset-icon-button" type="button" aria-label={`替换 Scene ${sceneIndex + 1} 图片`} onClick={chooseFile}><UploadSimple /></button> : null}<button className="asset-icon-button danger-button" type="button" aria-label={`清除 Scene ${sceneIndex + 1} ${asset.kind === "image" ? "图片" : "视频"}绑定`} onClick={() => void clearAsset(scene.id)}><Trash /></button></>
          )}
        </div>
        {operation === undefined ? null : <div className={`asset-bound-operation ${operation.tone}`} role={operation.role}><strong>{operation.copy}</strong><span>{operation.detail}</span>{active && job?.status === "processing" ? <span className="asset-progress" aria-hidden="true"><i /></span> : null}</div>}
      </div>
    );
  }

  if (active && job !== undefined) {
    return (
      <div className="asset-cell asset-job" data-asset-cell-scene-id={scene.id} role="status">
        {input}
        <div className="asset-job-copy">
          <strong title={job.cancelError ?? job.fileName} tabIndex={0} role={job.cancelError ? "alert" : undefined}>{job.cancelError ?? job.fileName}</strong>
          <small>{job.cancelError ? `${job.fileName} · 可再次取消` : imageImportStageCopy[job.stage]}</small>
          {job.status === "processing" ? <span className="asset-progress" aria-hidden="true"><i /></span> : null}
        </div>
        <button className="asset-icon-button" type="button" aria-label={`取消导入 ${job.fileName}`} disabled={job.status === "cancelling"} onClick={() => void cancel(job.id)}><X /></button>
      </div>
    );
  }

  if (job?.status === "failed" || job?.resolution === "registration-failed") {
    return (
      <div className="asset-cell asset-job asset-job-failed" data-asset-cell-scene-id={scene.id}>
        {input}
        <div className="asset-job-copy">
          <strong title={job.fileName} tabIndex={0}>{job.error?.message ?? "图片导入失败"}</strong>
          <small>{asset ? "旧绑定保持不变" : job.resolution === "registration-failed" ? "尚未建立绑定" : job.fileName}</small>
        </div>
        <div className="asset-actions">
          <button className="asset-icon-button" type="button" aria-label={`重试导入 ${job.fileName}`} onClick={() => void retry(job.id)}><ArrowCounterClockwise /></button>
          <button className="asset-icon-button" type="button" aria-label="重新选择图片" onClick={chooseFile}><UploadSimple /></button>
        </div>
      </div>
    );
  }

  if (job?.resolution === "changed" || job?.resolution === "incompatible") {
    return (
      <div className="asset-cell asset-pending" data-asset-cell-scene-id={scene.id}>
        {input}
        {asset ? <AssetThumbnail asset={asset} label={`Scene ${sceneIndex + 1} 当前图片`} /> : <ImageSquare aria-hidden="true" />}
        <span><strong>导入结果待确认</strong><small>{job.resolution === "changed" ? "Scene 已发生变化" : "Visual 已不兼容"}</small></span>
        <button className="asset-icon-button" type="button" aria-label="查看并确认图片导入结果" onClick={() => { showPending(job.id); setTaskDrawerOpen(true); }}><ListChecks /></button>
      </div>
    );
  }

  return (
    <div className="asset-cell asset-empty" data-asset-cell-scene-id={scene.id}>
      {input}
      <button className="asset-import-button" type="button" onClick={chooseFile}><UploadSimple />导入图片</button>
      <small>{job?.status === "cancelled" ? "已取消 · PNG、JPEG 或 WebP" : "PNG、JPEG 或 WebP"}</small>
    </div>
  );
}

function ImageProposalDialog({ job }: { job: ClientImageImportJob }) {
  const project = useProjectStore((state) => state.project);
  const applyPending = useImageImportStore((state) => state.applyPending);
  const keepPending = useImageImportStore((state) => state.keepPending);
  const hidePending = useImageImportStore((state) => state.hidePending);
  const currentScene = project?.scenes.find((scene) => scene.id === job.sceneId);
  const currentAsset = project?.assets.find(
    (asset) =>
      currentScene?.visual.type === "image" && asset.id === currentScene.visual.assetId,
  );
  const newAsset = job.result?.asset;
  const restoreFocus = () =>
    requestAnimationFrame(() => {
      const cell = document.querySelector<HTMLElement>(
        `[data-asset-cell-scene-id="${job.sceneId}"]`,
      );
      cell?.setAttribute("tabindex", "-1");
      cell?.focus();
    });
  const keep = () => {
    keepPending(job.id);
    restoreFocus();
  };
  const close = () => {
    hidePending(job.id);
    restoreFocus();
  };
  const apply = async () => {
    if (await applyPending(job.id)) restoreFocus();
  };
  const compatible = job.resolution === "changed";
  return (
    <ModalFrame
      title={compatible ? "图片已导入，Scene 已发生变化" : "图片已导入，但 Visual 已不兼容"}
      description={compatible ? "导入期间当前绑定发生了变化。请明确选择保留哪张图片。" : "新图片已作为未绑定 Asset 保留，但不能应用到当前 Visual。"}
      onCancel={close}
      footer={compatible ? <><button className="btn" type="button" data-autofocus onClick={keep}>保留当前绑定</button><button className="btn primary" type="button" onClick={() => void apply()}>应用新图片</button></> : <button className="btn primary" type="button" data-autofocus onClick={keep}>保留为未绑定 Asset</button>}
    >
      {job.proposalError ? <div className="asset-proposal-error" role="alert"><WarningCircle weight="fill" />{job.proposalError}</div> : null}
      <div className="asset-comparison">
        <section><span>当前绑定</span>{currentAsset ? <AssetThumbnail asset={currentAsset} label="当前绑定图片" /> : <div className="asset-comparison-empty"><ImageSquare /><small>未绑定</small></div>}<strong>{currentAsset?.path.split("/").at(-1) ?? "未绑定"}</strong></section>
        <section><span>新图片</span>{newAsset ? <AssetThumbnail asset={newAsset} label="新导入图片" /> : null}<strong>{job.fileName}</strong></section>
      </div>
    </ModalFrame>
  );
}

function ImageJobTask({ job }: { job: ClientImageImportJob }) {
  const cancel = useImageImportStore((state) => state.cancel);
  const retry = useImageImportStore((state) => state.retry);
  const showPending = useImageImportStore((state) => state.showPending);
  const active =
    job.status === "queued" ||
    job.status === "processing" ||
    job.status === "cancelling";
  const visiblyFailed =
    job.status === "failed" ||
    job.resolution === "registration-failed" ||
    job.cancelError !== undefined ||
    job.error?.cleanupFailed === true;
  const resolutionCopy =
    job.cancelError ??
    (job.error?.cleanupFailed ? job.error.message : undefined) ??
    (job.resolution === "registration-failed"
      ? `${job.error?.message ?? "无法登记导入后的 Asset"} · ${job.expected.assetId ? "旧绑定保持不变" : "尚未建立绑定"}`
      : job.resolution === "orphaned"
      ? "图片已导入，但目标 Scene 已删除"
      : job.resolution === "changed" || job.resolution === "incompatible"
        ? "导入结果待确认"
        : job.resolution === "kept"
          ? "已保留为未绑定 Asset"
          : job.resolution === "applied" || job.resolution === "auto-applied"
            ? job.result?.facts.enlarged
              ? "已应用 · 已放大到 1080p"
              : "已导入并应用"
            : job.error?.message ?? imageImportStageCopy[job.stage]);
  return (
    <article className={`image-job-task ${job.status}${visiblyFailed ? " is-error" : ""}`} data-testid="image-import-task">
      <div className="image-job-icon" aria-hidden="true">
        {visiblyFailed ? <WarningCircle weight="fill" /> : job.status === "processing" || job.status === "queued" || job.status === "cancelling" ? <CircleNotch className="spinner-inline" /> : <ImageSquare weight="fill" />}
      </div>
      <div className="image-job-detail">
        <strong title={job.fileName}>{job.fileName}</strong>
        <span>{resolutionCopy}</span>
        <code>Scene · {job.sceneId.slice(0, 8)}</code>
      </div>
      <div className="image-job-actions">
        {active && job.status !== "cancelling" ? <button className="btn compact" type="button" onClick={() => void cancel(job.id)}>{job.cancelError ? "再次取消" : "取消"}</button> : null}
        {job.status === "failed" || job.resolution === "registration-failed" ? <button className="btn compact" type="button" onClick={() => void retry(job.id)}>{job.resolution === "registration-failed" ? "重新登记" : "重试"}</button> : null}
        {job.resolution === "changed" || job.resolution === "incompatible" ? <button className="btn compact" type="button" onClick={() => showPending(job.id)}>查看并确认</button> : null}
      </div>
    </article>
  );
}

function SpeechCell({ scene, sceneIndex }: { scene: Scene; sceneIndex: number }) {
  const jobs = useSpeechGenerationStore((state) => state.jobs);
  const startGeneration = useSpeechGenerationStore((state) => state.startGeneration);
  const cancel = useSpeechGenerationStore((state) => state.cancel);
  const retry = useSpeechGenerationStore((state) => state.retry);
  const setTaskDrawerOpen = useProjectStore((state) => state.setTaskDrawerOpen);
  const speechAvailable = useProjectStore((state) =>
    scene.speech === undefined
      ? false
      : state.mediaAvailability[scene.speech.path] !== false,
  );
  const job = latestSpeechJobForScene(jobs, scene.id);
  const cellRef = useRef<HTMLDivElement>(null);
  const previousJobStatusRef = useRef(job?.status);
  useEffect(() => {
    const previousStatus = previousJobStatusRef.current;
    previousJobStatusRef.current = job?.status;
    if (
      (previousStatus === "queued" ||
        previousStatus === "processing" ||
        previousStatus === "cancelling") &&
      job?.status === "cancelled"
    ) {
      cellRef.current?.focus();
    }
  }, [job?.status]);
  const active =
    job?.status === "queued" ||
    job?.status === "processing" ||
    job?.status === "cancelling" ||
    (job?.status === "succeeded" && job.handlingResult === true);
  const canCancel =
    job?.status === "queued" || job?.status === "processing";
  const hasSpeech = scene.speech !== undefined && speechAvailable;
  const duration = hasSpeech
    ? `${(scene.speech!.durationMs / 1_000).toFixed(1)} 秒`
    : undefined;

  if (active && job !== undefined) {
    const regenerating = job.expected.speech !== undefined && hasSpeech;
    return (
      <div
        ref={cellRef}
        tabIndex={-1}
        className={`speech-cell speech-active${regenerating ? " keeps-speech" : ""}`}
        data-speech-cell-scene-id={scene.id}
      >
        <span className="speech-state-icon" aria-hidden="true"><CircleNotch className="spinner-inline" /></span>
        <span className="speech-copy">
          <strong>{job.status === "cancelling" ? "正在取消" : regenerating ? speechGenerationStageCopy[job.stage].replace("生成", "重新生成") : speechGenerationStageCopy[job.stage]}</strong>
          <small>{regenerating ? `旧 Speech 继续有效 · ${duration}` : "当前仍使用 Draft Duration"}</small>
          {job.status === "processing" ? <span className="speech-progress" aria-hidden="true"><i /></span> : null}
        </span>
        {canCancel ? <button className="speech-icon-button" type="button" aria-label={`取消 Scene ${sceneIndex + 1} Speech 生成`} onClick={() => void cancel(job.id)}><X /></button> : null}
      </div>
    );
  }

  if (job?.status === "failed" || job?.resolution === "apply-failed") {
    return (
      <div ref={cellRef} tabIndex={-1} className="speech-cell speech-failed" data-speech-cell-scene-id={scene.id}>
        <span className="speech-state-icon" aria-hidden="true"><WarningCircle weight="fill" /></span>
        <span className="speech-copy">
          <strong>Speech 生成失败</strong>
          <small>{hasSpeech ? `旧 Speech 仍有效 · ${duration}` : "仍使用 Draft Duration"}</small>
        </span>
        <span className="speech-actions">
          <button className="speech-icon-button" type="button" aria-label={`重试 Scene ${sceneIndex + 1} Speech`} onClick={() => void retry(job.id)}><ArrowCounterClockwise /></button>
          <button className="speech-icon-button" type="button" aria-label={`查看 Scene ${sceneIndex + 1} Speech 失败详情`} onClick={() => setTaskDrawerOpen(true)}><ListChecks /></button>
        </span>
      </div>
    );
  }

  if (hasSpeech) {
    const staleResult =
      job?.resolution === "narration-changed" ||
      job?.resolution === "profile-changed" ||
      job?.resolution === "speech-changed" ||
      job?.resolution === "scene-deleted";
    return (
      <div ref={cellRef} tabIndex={-1} className="speech-cell speech-ready" data-speech-cell-scene-id={scene.id}>
        <span className="speech-state-icon" aria-hidden="true"><CheckCircle weight="fill" /></span>
        <span className="speech-copy">
          <strong>{job?.status === "cancelled" ? "已取消 · Speech 未变" : job?.resolution === "applied" ? "已生成 · 可撤销" : "Speech 已生成"}</strong>
          <small>{job?.status === "cancelled" ? `旧 Speech 保持有效 · ${duration}` : staleResult ? `当前版本 ${duration} · 旧结果未应用` : duration}</small>
        </span>
        <button className="speech-icon-button" type="button" aria-label={`重新生成 Scene ${sceneIndex + 1} Speech`} onClick={() => void startGeneration(scene.id)}><ArrowCounterClockwise /></button>
      </div>
    );
  }

  return (
    <div ref={cellRef} tabIndex={-1} className="speech-cell speech-empty" data-speech-cell-scene-id={scene.id}>
      <button className="speech-generate-button" type="button" disabled={scene.narration.text.trim().length === 0} onClick={() => void startGeneration(scene.id)}><SpeakerHigh />生成 Speech</button>
      <small>{job?.status === "cancelled" ? "已取消 · 使用 Draft Duration" : job?.resolution !== undefined ? "旧任务结果未应用 · 使用 Draft Duration" : "使用 Draft Duration · 仅供预览"}</small>
    </div>
  );
}

function SpeechJobTask({ job }: { job: ClientSpeechGenerationJob }) {
  const project = useProjectStore((state) => state.project);
  const cancel = useSpeechGenerationStore((state) => state.cancel);
  const retry = useSpeechGenerationStore((state) => state.retry);
  const sceneIndex = project?.scenes.findIndex((scene) => scene.id === job.sceneId) ?? -1;
  const active =
    job.status === "queued" ||
    job.status === "processing" ||
    job.status === "cancelling";
  const failed = job.status === "failed" || job.resolution === "apply-failed";
  const kept = job.expected.speech !== undefined;
  const resolution =
    job.cancelError ??
    (job.resolution === "scene-deleted"
      ? "结果未应用 · 目标 Scene 已删除"
      : job.resolution === "narration-changed"
        ? "结果未应用 · Narration 已改变"
        : job.resolution === "profile-changed"
          ? "结果未应用 · TTS profile 已改变"
        : job.resolution === "speech-changed"
          ? "结果未应用 · 当前 Speech 已改变"
          : job.resolution === "apply-failed"
            ? "Speech 已落盘，但 Project DSL 更新失败"
            : job.resolution === "applied"
              ? "Speech 已应用 · 可撤销"
              : job.error?.message ?? speechGenerationStageCopy[job.stage]);
  return (
    <article className={`speech-job-task ${job.status}${failed ? " is-error" : ""}`} data-testid="speech-generation-task">
      <div className="speech-job-icon" aria-hidden="true">
        {failed ? <WarningCircle weight="fill" /> : active ? <CircleNotch className="spinner-inline" /> : <SpeakerHigh weight="fill" />}
      </div>
      <div className="speech-job-detail">
        <strong title={job.narrationText} tabIndex={0}>{job.narrationText}</strong>
        <span>{resolution}</span>
        <code>{sceneIndex >= 0 ? `Scene ${String(sceneIndex + 1).padStart(2, "0")}` : `Scene · ${job.sceneId.slice(0, 8)}`} · {kept && job.resolution !== "applied" ? "旧 Speech 保持有效" : kept ? "重新生成" : "Draft Duration"}</code>
        {job.error ? <small>{job.error.code} · {job.error.retryable ? "可重试" : "需要检查配置"}</small> : null}
      </div>
      <div className="speech-job-actions">
        {active && job.status !== "cancelling" ? <button className="btn compact" type="button" onClick={() => void cancel(job.id)}>{job.cancelError ? "再次取消" : "取消"}</button> : null}
        {failed ? <button className="btn compact" type="button" onClick={() => void retry(job.id)}>重试</button> : null}
      </div>
    </article>
  );
}

function RenderJobTask({
  job,
  onNavigate,
}: {
  job: RenderJob;
  onNavigate: (job: RenderJob) => void;
}) {
  const cancel = useRenderJobStore((state) => state.cancel);
  const openOutput = useRenderJobStore((state) => state.openOutput);
  const active =
    job.status === "queued" ||
    job.status === "processing" ||
    job.status === "cancelling";
  const progress = job.progress === undefined ? undefined : Math.round(job.progress * 100);
  return (
    <article className={`render-job-task ${job.status}`} data-testid="render-job-task">
      <div className="render-job-head">
        <span className="render-job-icon" aria-hidden="true">
          {active ? <CircleNotch className="spinner-inline" /> : job.status === "succeeded" ? <CheckCircle weight="fill" /> : job.status === "failed" ? <WarningCircle weight="fill" /> : <FilmSlate weight="fill" />}
        </span>
        <span>
          <strong>{renderStageCopy[job.stage]}</strong>
          <small>{job.snapshotSource === "unsaved" ? "来自未保存版本" : "来自已保存版本"}</small>
        </span>
        <time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
      </div>
      {active ? (
        <div className="render-job-progress" aria-label={progress === undefined ? renderStageCopy[job.stage] : `渲染进度 ${progress}%`}>
          <span><i style={progress === undefined ? undefined : { width: `${progress}%` }} /></span>
          <small>{progress === undefined ? "按真实阶段更新" : `${progress}%`}</small>
        </div>
      ) : null}
      {job.status === "succeeded" ? (
        <div className="render-artifacts">
          <div><strong>out.mp4</strong><code>{job.artifacts.output}</code></div>
          <div><strong>project.snapshot.json</strong><code>{job.artifacts.snapshot}</code></div>
          <div><strong>render.log</strong><code>{job.artifacts.log}</code></div>
          <div className="render-directory"><strong>结果目录</strong><code>{job.artifacts.directory}</code></div>
        </div>
      ) : null}
      {job.error !== undefined ? (
        <button className="render-error" type="button" onClick={() => onNavigate(job)}>
          <WarningCircle weight="fill" />
          <span><strong>{job.error.message}</strong><code>{job.error.code}{job.error.sceneId ? ` · Scene ${job.error.sceneId.slice(0, 8)}` : ""}</code></span>
        </button>
      ) : null}
      <div className="render-job-actions">
        {active && job.status !== "cancelling" ? <button className="btn compact" type="button" onClick={() => void cancel(job.id)}>取消渲染</button> : null}
        {job.status === "succeeded" ? <button className="btn primary compact" type="button" onClick={() => void openOutput(job.id)}><FolderOpen />打开产物目录</button> : null}
      </div>
    </article>
  );
}

function openNarrationPopover(popoverId: string, editorId: string) {
  const popover = document.getElementById(popoverId);
  popover?.showPopover();
  requestAnimationFrame(() => document.getElementById(editorId)?.focus());
}

function closeNarrationPopover(popoverId: string) {
  document.getElementById(popoverId)?.hidePopover();
}

function ModalFrame({
  title,
  description,
  onCancel,
  children,
  footer,
  dismissible = true,
  dialogRole = "dialog",
  className,
}: {
  title: string;
  description: string;
  onCancel?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  dialogRole?: "dialog" | "alertdialog";
  className?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = `dialog-${title.replace(/\s+/gu, "-")}`;
  const descriptionId = `${titleId}-description`;
  useEffect(() => {
    const preferred = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)");
    const first = dialogRef.current?.querySelector<HTMLElement>("button, input, select, textarea");
    (preferred ?? first)?.focus();
  }, []);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && dismissible && onCancel !== undefined) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), video[controls], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={dismissible ? onCancel : undefined}>
      <section ref={dialogRef} className={`transaction-dialog${className === undefined ? "" : ` ${className}`}`} role={dialogRole} aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={handleKeyDown} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div>{dismissible && onCancel !== undefined ? <button className="btn icon" type="button" aria-label="关闭" onClick={onCancel}><X /></button> : null}</header>
        <div className="transaction-dialog-body">{children}</div>
        {footer === undefined ? null : <footer>{footer}</footer>}
      </section>
    </div>
  );
}

function AssetPreviewDialog({
  asset,
  displayName,
  available,
  onClose,
}: {
  asset: Asset;
  displayName: string;
  available: boolean | undefined;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    available === false ? "error" : "loading",
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setStatus(available === false ? "error" : "loading");
  }, [asset.id, available]);
  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [asset.id]);

  const markUnavailable = () => setStatus("error");
  const kindLabel = asset.kind === "image" ? "Image" : "Video";
  const close = () => {
    videoRef.current?.pause();
    onClose();
  };
  return (
    <ModalFrame
      title={displayName}
      description={`只读检查 ${kindLabel} Asset 本体；不会叠加 Caption、Subtitle 或改变 Player。`}
      onCancel={close}
      className="asset-preview-dialog"
    >
      <div className="asset-preview-canvas" data-testid="asset-preview-canvas">
        {status === "loading" ? (
          <div className="asset-preview-state" role="status">
            <CircleNotch className="spinner-inline" aria-hidden="true" />
            <strong>正在载入 Asset</strong>
            <span>从项目媒体读取原始内容…</span>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="asset-preview-state asset-preview-error" role="alert">
            <WarningCircle weight="fill" aria-hidden="true" />
            <strong>Asset 文件不可用</strong>
            <span>文件缺失、HTTP 读取失败或媒体无法解码。</span>
            <code>{asset.path}</code>
          </div>
        ) : null}
        {available === false || status === "error" ? null : asset.kind === "image" ? (
          <img
            src={mediaUrl(asset.path)}
            alt={displayName}
            onLoad={() => setStatus("ready")}
            onError={markUnavailable}
          />
        ) : (
          <video
            ref={videoRef}
            src={mediaUrl(asset.path)}
            aria-label={displayName}
            controls
            preload="auto"
            onLoadedData={() => setStatus("ready")}
            onError={markUnavailable}
          />
        )}
      </div>
      <dl className="asset-preview-meta">
        <div><dt>Kind</dt><dd>{kindLabel}</dd></div>
        <div><dt>项目相对路径</dt><dd><code>{asset.path}</code></dd></div>
      </dl>
    </ModalFrame>
  );
}

function AddCaptionDialog({
  onAdd,
  onCancel,
}: {
  onAdd: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <ModalFrame title="添加画面说明" description="画面说明是叠加在图片或视频上的独立文字，不会替换旁白或底部字幕；提交前项目文件保持不变。" onCancel={onCancel} footer={<><button className="btn" type="button" onClick={onCancel}>取消</button><button className="btn primary" type="button" disabled={text.trim() === ""} onClick={() => onAdd(text)}>添加画面说明</button></>}>
      <label>说明文字<textarea data-autofocus aria-label="说明文字" value={text} onChange={(event) => setText(event.target.value)} /></label>
    </ModalFrame>
  );
}

function CardContentDialog({
  onCreate,
  onCancel,
}: {
  onCreate: (card: CardVisual) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [itemsText, setItemsText] = useState("");
  const items = itemsText
    .split(/\r\n|\n|\r/u)
    .filter((item) => item.trim() !== "");
  const hasContent =
    [label, title, body].some((value) => value.trim() !== "") || items.length > 0;
  const create = () => {
    if (!hasContent) return;
    onCreate({
      type: "card",
      ...(label.trim() === "" ? {} : { label }),
      ...(title.trim() === "" ? {} : { title }),
      ...(body.trim() === "" ? {} : { body }),
      ...(items.length === 0 ? {} : { items }),
    });
  };
  return (
    <ModalFrame title="填写文字卡片内容" description="文字卡片至少需要标签、标题、正文或列表中的一项；提交前项目文件保持不变。" onCancel={onCancel} footer={<><button className="btn" type="button" onClick={onCancel}>取消</button><button className="btn primary" type="button" disabled={!hasContent} onClick={create}>创建文字卡片</button></>}>
      <label>卡片标签<input data-autofocus aria-label="卡片标签" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <label>卡片标题<input aria-label="卡片标题" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>卡片正文<textarea aria-label="卡片正文" value={body} onChange={(event) => setBody(event.target.value)} /></label>
      <label>卡片列表（每行一项）<textarea aria-label="卡片列表（每行一项）" value={itemsText} onChange={(event) => setItemsText(event.target.value)} /></label>
    </ModalFrame>
  );
}

function VisualLossDialog({
  losses,
  onConfirm,
  onCancel,
}: {
  losses: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalFrame title="确认 Visual 切换" description="以下内容与目标 Visual 不兼容。确认后只保存新分支，不会在 DSL 中保留隐藏字段。" onCancel={onCancel} footer={<><button data-autofocus className="btn" type="button" onClick={onCancel}>取消</button><button className="btn primary" type="button" onClick={onConfirm}>确认切换</button></>}>
      <ul className="loss-list">{losses.map((loss, index) => <li key={`${index}-${loss}`}><WarningCircle weight="fill" />{loss}</li>)}</ul>
    </ModalFrame>
  );
}

function CommittedTextField({
  label,
  value,
  multiline = false,
  onCommit,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onCommit: (value: string) => boolean | void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft === value) return;
    if (onCommit(draft) === false) setDraft(value);
  };
  return (
    <label>{label}{multiline ? <textarea aria-label={label} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} /> : <input aria-label={label} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} />}</label>
  );
}

function cardHasContent(card: CardVisual): boolean {
  return (
    card.label !== undefined ||
    card.title !== undefined ||
    card.body !== undefined ||
    card.items !== undefined
  );
}

function CardFields({
  visual,
  onChange,
}: {
  visual: CardVisual;
  onChange: (visual: Visual) => void;
}) {
  const [itemDrafts, setItemDrafts] = useState(visual.items ?? []);
  useEffect(() => setItemDrafts(visual.items ?? []), [visual.items]);
  const commitField = (field: "label" | "title" | "body", value: string) => {
    const next = { ...visual };
    if (value.trim() === "") delete next[field];
    else next[field] = value;
    if (!cardHasContent(next)) return false;
    onChange(next);
  };
  const commitItems = (items: string[]) => {
    const nonBlankItems = items.filter((item) => item.trim() !== "");
    const next = { ...visual };
    if (nonBlankItems.length === 0) delete next.items;
    else next.items = nonBlankItems;
    if (!cardHasContent(next)) return false;
    onChange(next);
    setItemDrafts(nonBlankItems);
  };
  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= itemDrafts.length) return;
    const items = [...itemDrafts];
    [items[index], items[target]] = [items[target], items[index]];
    setItemDrafts(items);
    commitItems(items);
  };
  return (
    <>
      <h3>文字卡片</h3>
      <CommittedTextField label="卡片标签" value={visual.label ?? ""} onCommit={(value) => commitField("label", value)} />
      <CommittedTextField label="卡片标题" value={visual.title ?? ""} onCommit={(value) => commitField("title", value)} />
      <CommittedTextField label="卡片正文" value={visual.body ?? ""} multiline onCommit={(value) => commitField("body", value)} />
      <div className="bullet-heading"><strong>列表</strong><button className="btn compact" type="button" aria-label="添加列表项" onClick={() => setItemDrafts((items) => [...items, ""])}><Plus />添加</button></div>
      <div className="bullet-list">
        {itemDrafts.map((item, index) => (
          <div className="bullet-row" key={index}>
            <input aria-label={`列表项 ${index + 1}`} value={item} onChange={(event) => setItemDrafts((items) => items.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} onBlur={() => { if (commitItems(itemDrafts) === false) setItemDrafts(visual.items ?? []); }} />
            <div className="bullet-actions"><button className="btn icon" type="button" aria-label={`上移列表项 ${index + 1}`} disabled={index === 0} onClick={() => moveItem(index, -1)}><ArrowUp /></button><button className="btn icon" type="button" aria-label={`下移列表项 ${index + 1}`} disabled={index === itemDrafts.length - 1} onClick={() => moveItem(index, 1)}><ArrowDown /></button><button className="btn icon danger-button" type="button" aria-label={`删除列表项 ${index + 1}`} onClick={() => { const items = itemDrafts.filter((_, itemIndex) => itemIndex !== index); setItemDrafts(items); if (commitItems(items) === false) setItemDrafts(visual.items ?? []); }}><Trash /></button></div>
          </div>
        ))}
      </div>
      <div className="inspector-note neutral-note">文字卡片至少保留标签、标题、正文或列表中的一项。</div>
    </>
  );
}

function MediaFields({
  visual,
  onChange,
}: {
  visual: Extract<Visual, { type: "image" | "video" }>;
  onChange: (visual: Visual) => void;
}) {
  const [addingCaption, setAddingCaption] = useState(false);
  return (
    <>
      <h3>画面说明</h3>
      {hasCaption(visual) ? (
        <CommittedTextField label="说明文字" value={visual.caption.text} multiline onCommit={(text) => {
          if (text.trim() === "") {
            const { caption: _caption, ...next } = visual;
            onChange(next);
          } else {
            onChange({ ...visual, caption: { ...visual.caption, text } });
          }
        }} />
      ) : (
        <div className="inspector-note neutral-note"><span>当前画面没有说明文字；旁白仍会显示为底部字幕。</span><button className="btn compact" type="button" onClick={() => setAddingCaption(true)}><Plus />添加画面说明</button></div>
      )}
      <h3>画面素材</h3>
      <div className="inspector-note neutral-note">当前画面使用脚本表中已绑定的项目素材。</div>
      {addingCaption ? <AddCaptionDialog onCancel={() => setAddingCaption(false)} onAdd={(text) => { onChange({ ...visual, caption: { text } }); setAddingCaption(false); }} /> : null}
    </>
  );
}

function VisualFields({
  visual,
  onChange,
}: {
  visual: Visual;
  onChange: (visual: Visual) => void;
}) {
  if (visual.type === "card") {
    return <CardFields visual={visual} onChange={onChange} />;
  }
  return <MediaFields visual={visual} onChange={onChange} />;
}

function BatchCreateDialog({
  existingSceneCount,
  onClose,
  onCreate,
}: {
  existingSceneCount: number;
  onClose: () => void;
  onCreate: (lines: string[], visualType: "video" | "image") => Promise<void>;
}) {
  const [step, setStep] = useState<"raw" | "review">("raw");
  const [rawNarration, setRawNarration] = useState("");
  const [draftLines, setDraftLines] = useState<string[]>([]);
  const [blankLineCount, setBlankLineCount] = useState(0);
  const [visualType, setVisualType] = useState<"video" | "image">("video");
  const [creating, setCreating] = useState(false);

  const reviewSplit = () => {
    const lines = rawNarration.split(/\r\n|\n|\r/);
    const nonBlankLines = lines.filter((line) => !/^\s*$/u.test(line));
    setDraftLines(nonBlankLines);
    setBlankLineCount(lines.length - nonBlankLines.length);
    setStep("review");
  };
  const updateDraftLine = (index: number, text: string) => {
    setDraftLines((lines) =>
      lines.map((line, lineIndex) => (lineIndex === index ? text : line)),
    );
  };
  const deleteDraftLine = (index: number) => {
    setDraftLines((lines) => lines.filter((_, lineIndex) => lineIndex !== index));
  };
  const mergeDraftLine = (index: number) => {
    if (index === 0) return;
    setDraftLines((lines) =>
      lines.flatMap((line, lineIndex) => {
        if (lineIndex === index - 1) return [`${line}\n${lines[index]}`];
        return lineIndex === index ? [] : [line];
      }),
    );
  };
  const createScenes = async () => {
    if (draftLines.length === 0 || creating) return;
    setCreating(true);
    await onCreate(draftLines, visualType);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="paste-dialog" role="dialog" aria-modal="true" aria-labelledby="paste-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">原位创建</p><h2 id="paste-title">{step === "raw" ? "粘贴多行 Narration" : "确认拆分结果"}</h2></div><button className="btn icon" aria-label="关闭" onClick={onClose}><X /></button></header>
        <p>{step === "raw" ? "只按换行拆分，不按标点推测；纯空白行会被忽略。" : "可编辑、删除或并入上一行；这些操作仍只发生在临时草稿。"}</p>
        {step === "raw" ? (
          <textarea autoFocus aria-label="原文" placeholder={"第一句 Narration\n第二句 Narration"} value={rawNarration} onChange={(event) => setRawNarration(event.target.value)} />
        ) : (
          <div className="draft-review">
            <div className="draft-summary"><span><strong>{draftLines.length}</strong> 条将创建为 Scene</span><span><strong>{blankLineCount}</strong> 个空白行已忽略</span></div>
            <fieldset className="visual-choice"><legend>整批 Visual</legend><label><input type="radio" name="batch-visual" value="video" checked={visualType === "video"} onChange={() => setVisualType("video")} />Video</label><label><input type="radio" name="batch-visual" value="image" checked={visualType === "image"} onChange={() => setVisualType("image")} />Image</label></fieldset>
            <div className="draft-list">
              {draftLines.map((line, index) => (
                <div className="draft-row" key={index}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <textarea aria-label={`拆分结果 ${index + 1}`} value={line} onChange={(event) => updateDraftLine(index, event.target.value)} />
                  <div className="draft-actions">
                    <button className="btn icon" aria-label={`将第 ${index + 1} 行并入上一行`} disabled={index === 0} onClick={() => mergeDraftLine(index)}><ArrowUUpLeft /></button>
                    <button className="btn icon danger-button" aria-label={`删除第 ${index + 1} 行`} onClick={() => deleteDraftLine(index)}><X /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <footer><span className="draft-status">尚未写入 · scenes[] 仍为 {existingSceneCount}</span><div>{step === "review" ? <button className="btn text-button" onClick={() => setStep("raw")}>返回原文</button> : null}<button className="btn" onClick={onClose}>取消</button>{step === "raw" ? <button className="btn primary" onClick={reviewSplit}>整理拆分</button> : <button className="btn primary" disabled={draftLines.length === 0 || creating} onClick={() => void createScenes()}>{creating ? "保存中" : "创建 Scene"}</button>}</div></footer>
      </section>
    </div>
  );
}

function WorkspaceBanner({ kind }: { kind: "lease" | "migration" | "migration-saved" }) {
  const recheckLease = useProjectStore((state) => state.recheckLease);
  if (kind === "lease") {
    return (
      <section className="workspace-banner lease-banner" data-testid="lease-banner" role="status">
        <div><LockSimple weight="fill" /><span><strong>此项目正在另一个标签页中编辑</strong><small>工作台保持可见，但所有编辑、Undo/Redo、渲染与写文件任务均已暂停。</small></span></div>
        <button className="btn" type="button" onClick={() => void recheckLease()}>重新检查编辑权</button>
      </section>
    );
  }
  return (
    <section className={`workspace-banner ${kind}`} data-testid="migration-banner" role="status">
      <div><CheckCircle weight="fill" /><span><strong>{kind === "migration-saved" ? "项目已升级并保存" : "项目已升级到当前 DSL 版本"}</strong><small>{kind === "migration-saved" ? "原始项目文件已保留为不可覆盖的迁移备份。" : "首次正常保存前会备份原始项目文件。"}</small></span></div>
    </section>
  );
}

function formatProjectTimecode(frame: number, fps: number): string {
  const normalizedFrame = Math.max(0, Math.floor(frame));
  const totalSeconds = Math.floor(normalizedFrame / fps);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const frames = normalizedFrame % fps;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

function ExternalConflictDialog() {
  const conflict = useProjectStore((state) => state.externalConflict);
  const resolving = useProjectStore((state) => state.conflictResolving);
  const loadDiskVersion = useProjectStore((state) => state.loadDiskVersion);
  const keepCurrentVersion = useProjectStore((state) => state.keepCurrentVersion);
  const renderJobs = useRenderJobStore((state) => state.jobs);
  const renderStarting = useRenderJobStore((state) => state.starting);
  const startRender = useRenderJobStore((state) => state.start);
  if (conflict === undefined) return null;
  const loadDisabled = resolving || conflict.diskProject === undefined;
  const activeRender = activeRenderJob(renderJobs);
  return (
    <ModalFrame
      title="项目文件已在外部更改"
      description="当前页面与磁盘版本都包含修改。继续前必须选择保留哪一份。"
      dismissible={false}
      dialogRole="alertdialog"
      footer={<><button className="btn conflict-render" type="button" disabled={renderStarting || activeRender !== undefined} onClick={() => void startRender()}><FilmSlate />{activeRender ? renderStageCopy[activeRender.stage] : renderStarting ? "正在创建快照" : "渲染当前内存版本"}</button><button className="btn" type="button" disabled={resolving} onClick={() => void keepCurrentVersion()}>保留当前版本</button><button className="btn primary" type="button" data-autofocus disabled={loadDisabled} onClick={() => void loadDiskVersion()}>载入磁盘版本</button></>}
    >
      <div className="conflict-choices">
        <div><strong>载入磁盘版本</strong><p>先把当前页面的内存 DSL 备份为 external-conflict 文件，再载入并校验磁盘版本；Undo/Redo 历史会清空。</p></div>
        <div><strong>保留当前版本</strong><p>先把磁盘 DSL 备份为 external-conflict 文件，再用当前内存 DSL 覆盖；现有编辑历史会保留。</p></div>
      </div>
      <p className="conflict-render-note">无需先解决冲突即可渲染；产物会明确标记为来自当前未保存内存版本。</p>
      {conflict.errorMessage || conflict.resolutionError ? <div className="conflict-error" role="alert"><WarningCircle weight="fill" /><span><strong>暂时无法完成选择</strong>{conflict.resolutionError ?? conflict.errorMessage}</span></div> : null}
      {resolving ? <div className="conflict-progress" role="status"><CircleNotch className="spinner-inline" />正在备份并核对项目文件…</div> : null}
    </ModalFrame>
  );
}

function Workspace({ occupied = false }: { occupied?: boolean }) {
  const project = useProjectStore((state) => state.project);
  const info = useProjectStore((state) => state.info);
  const selectedSceneId = useProjectStore((state) => state.selectedSceneId);
  const selectScene = useProjectStore((state) => state.selectScene);
  const updateNarration = useProjectStore((state) => state.updateNarration);
  const endTextTransaction = useProjectStore((state) => state.endTextTransaction);
  const updateVisual = useProjectStore((state) => state.updateVisual);
  const updateTheme = useProjectStore((state) => state.updateTheme);
  const reorderScene = useProjectStore((state) => state.reorderScene);
  const deleteScene = useProjectStore((state) => state.deleteScene);
  const taskDrawerOpen = useProjectStore((state) => state.taskDrawerOpen);
  const setTaskDrawerOpen = useProjectStore((state) => state.setTaskDrawerOpen);
  const addScenesFromLines = useProjectStore((state) => state.addScenesFromLines);
  const mediaAvailability = useProjectStore((state) => state.mediaAvailability);
  const mediaRevisions = useProjectStore((state) => state.mediaRevisions);
  const diagnostics = useProjectStore((state) => state.diagnostics);
  const saveDiagnostics = useProjectStore((state) => state.saveDiagnostics);
  const historyFocusRequest = useProjectStore((state) => state.historyFocusRequest);
  const externalConflict = useProjectStore((state) => state.externalConflict);
  const speechCommitInFlight = useProjectStore((state) => state.speechCommitInFlight);
  const migrationPending = useProjectStore((state) => state.migrationPending);
  const migrationSavedNotice = useProjectStore((state) => state.migrationSavedNotice);
  const imageJobs = useImageImportStore((state) => state.jobs);
  const imageJobAnnouncement = useImageImportStore((state) => state.announcement);
  const connectImageJobs = useImageImportStore((state) => state.connect);
  const speechJobs = useSpeechGenerationStore((state) => state.jobs);
  const speechJobAnnouncement = useSpeechGenerationStore((state) => state.announcement);
  const connectSpeechJobs = useSpeechGenerationStore((state) => state.connect);
  const renderJobs = useRenderJobStore((state) => state.jobs);
  const renderJobAnnouncement = useRenderJobStore((state) => state.announcement);
  const renderStartError = useRenderJobStore((state) => state.startError);
  const renderOpenError = useRenderJobStore((state) => state.openError);
  const connectRenderJobs = useRenderJobStore((state) => state.connect);
  const workspaceDisabled =
    occupied || externalConflict !== undefined || speechCommitInFlight;
  const [playing, setPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playerBuffering, setPlayerBuffering] = useState(false);
  const [playerError, setPlayerError] = useState<string>();
  const [playerGeneration, setPlayerGeneration] = useState(0);
  const [sceneBoundaryAnnouncement, setSceneBoundaryAnnouncement] = useState("");
  const [inspectorMode, setInspectorMode] = useState<"scene" | "project">("scene");
  const [safeAreaVisible, setSafeAreaVisible] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [cardChoice, setCardChoice] = useState<{
    sceneId: string;
    trigger: HTMLSelectElement;
  }>();
  const [pendingVisualChange, setPendingVisualChange] = useState<{
    sceneId: string;
    visual: Visual;
    losses: string[];
    trigger: HTMLSelectElement;
  }>();
  const [draggedSceneId, setDraggedSceneId] = useState<string>();
  const [dropTargetIndex, setDropTargetIndex] = useState<number>();
  const [keyboardReorder, setKeyboardReorder] = useState<{
    sceneId: string;
    targetIndex: number;
  }>();
  const [reorderNotice, setReorderNotice] = useState("");
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const [assetPreview, setAssetPreview] = useState<{
    sceneId: string;
    asset: Asset;
    displayName: string;
    trigger: HTMLElement;
  }>();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const selectedNarrationRef = useRef<HTMLTextAreaElement>(null);
  const firstRenderBlockerRef = useRef<HTMLButtonElement>(null);
  const singleSceneFocusPendingRef = useRef(false);
  const playerRef = useRef<PlayerRef>(null);
  const scrubWasPlayingRef = useRef(false);
  const previousPlayingSceneIdRef = useRef<string | undefined>(undefined);
  const pendingStructuralPlaybackRef = useRef<{
    sceneId: string;
    offsetInFrames: number;
    wasPlaying: boolean;
  } | undefined>(undefined);
  const assets = useMemo(
    () => new Map(project?.assets.map((asset) => [asset.id, asset]) ?? []),
    [project?.assets],
  );
  const sceneCount = project?.scenes.length ?? 0;
  const previewSnapshot = useMemo(
    () =>
      project === undefined
        ? undefined
        : createPreviewSnapshot(
            project,
            `${window.location.origin}/media/`,
            mediaAvailability,
            mediaRevisions,
          ),
    [project, mediaAvailability, mediaRevisions],
  );
  const playerInputProps = useMemo(
    () => previewSnapshot === undefined ? undefined : { snapshot: previewSnapshot },
    [previewSnapshot],
  );
  const previousPreviewSnapshotRef = useRef(previewSnapshot);
  const structuralSnapshotRef = useRef(previewSnapshot);
  useEffect(() => connectImageJobs(), [connectImageJobs]);
  useEffect(() => connectSpeechJobs(), [connectSpeechJobs]);
  useEffect(() => connectRenderJobs(), [connectRenderJobs]);
  useEffect(() => {
    if (
      previousPreviewSnapshotRef.current !== previewSnapshot &&
      playerError !== undefined
    ) {
      setPlayerError(undefined);
      setPlayerBuffering(false);
      setPlayerGeneration((generation) => generation + 1);
    }
    previousPreviewSnapshotRef.current = previewSnapshot;
  }, [playerError, previewSnapshot]);
  useEffect(() => {
    const previous = structuralSnapshotRef.current;
    structuralSnapshotRef.current = previewSnapshot;
    const pending = pendingStructuralPlaybackRef.current;
    pendingStructuralPlaybackRef.current = undefined;
    if (
      previewSnapshot === undefined ||
      previewSnapshot.scenes.length === 0
    ) {
      playerRef.current?.pause();
      setPlaying(false);
      setCurrentFrame(0);
      return;
    }
    if (previous === undefined && pending === undefined) return;
    const previousResolved =
      pending === undefined && previous !== undefined
        ? findSceneAtFrame(previous, currentFrame)
        : undefined;
    const playbackContext =
      pending ??
      (previousResolved === undefined
        ? selectedSceneId === undefined
          ? undefined
          : { sceneId: selectedSceneId, offsetInFrames: 0, wasPlaying: false }
        : {
            sceneId: previousResolved.scene.id,
            offsetInFrames: currentFrame - previousResolved.startFrame,
            wasPlaying: playerRef.current?.isPlaying() ?? playing,
          });
    if (playbackContext === undefined) return;
    const restoredFrame = frameForSceneOffset(
      previewSnapshot,
      playbackContext.sceneId,
      playbackContext.offsetInFrames,
    );
    const fallbackFrame =
      restoredFrame ??
      (selectedSceneId === undefined
        ? undefined
        : frameForSceneOffset(previewSnapshot, selectedSceneId, 0));
    if (fallbackFrame === undefined) return;
    const frame = requestAnimationFrame(() => {
      playerRef.current?.seekTo(fallbackFrame);
      setCurrentFrame(fallbackFrame);
      if (restoredFrame !== undefined && playbackContext.wasPlaying) playerRef.current?.play();
      else playerRef.current?.pause();
    });
    return () => cancelAnimationFrame(frame);
  }, [previewSnapshot]);
  const renderDiagnostics = useMemo(
    () =>
      project === undefined
        ? diagnostics
        : [...diagnostics, ...validateRenderReadiness(project, mediaAvailability)],
    [project, diagnostics, mediaAvailability],
  );
  const firstRenderBlocker = renderDiagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  useEffect(() => {
    if (!taskDrawerOpen || firstRenderBlocker === undefined) return;
    const frame = requestAnimationFrame(() => firstRenderBlockerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [taskDrawerOpen, firstRenderBlocker]);
  useEffect(() => {
    const player = playerRef.current;
    if (player === null || previewSnapshot === undefined) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onFrame = (event: { detail: { frame: number } }) => {
      setCurrentFrame(event.detail.frame);
    };
    const onWaiting = () => setPlayerBuffering(true);
    const onResume = () => setPlayerBuffering(false);
    const onError = (event: { detail: { error: Error } }) => {
      setPlayerError(event.detail.error.message);
      setPlaying(false);
    };
    setCurrentFrame(player.getCurrentFrame());
    setPlaying(player.isPlaying());
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("seeked", onFrame);
    player.addEventListener("waiting", onWaiting);
    player.addEventListener("resume", onResume);
    player.addEventListener("error", onError);
    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onEnded);
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("seeked", onFrame);
      player.removeEventListener("waiting", onWaiting);
      player.removeEventListener("resume", onResume);
      player.removeEventListener("error", onError);
    };
  }, [playerGeneration, previewSnapshot?.durationInFrames, previewSnapshot?.previewBlockers.length]);
  useEffect(() => {
    if (!singleSceneFocusPendingRef.current || sceneCount === 0) return;
    singleSceneFocusPendingRef.current = false;
    if (tableScrollRef.current !== null) {
      tableScrollRef.current.scrollTo({
        top: tableScrollRef.current.scrollHeight,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    }
    selectedNarrationRef.current?.focus({ preventScroll: true });
  }, [sceneCount, selectedSceneId]);
  useEffect(() => {
    if (historyFocusRequest === undefined) return;
    const activeElement = document.activeElement;
    if (
      historyFocusRequest.force !== true &&
      activeElement !== document.body &&
      activeElement?.isConnected
    ) return;
    const selector =
      historyFocusRequest.target === "add-scene"
        ? "[data-add-scene]"
        : historyFocusRequest.target === "scene-select"
          ? `[data-scene-id="${historyFocusRequest.sceneId}"] [data-scene-select]`
          : historyFocusRequest.target === "narration"
            ? `[data-narration-scene-id="${historyFocusRequest.sceneId}"]`
            : historyFocusRequest.target === "reorder"
              ? `[data-reorder-handle="${historyFocusRequest.sceneId}"]`
              : `[data-visual-type-scene-id="${historyFocusRequest.sceneId}"]`;
    const frame = requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(selector)?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [historyFocusRequest]);
  if (project === undefined) return null;

  const addSingleScene = () => {
    singleSceneFocusPendingRef.current = true;
    void addScenesFromLines([""]);
  };

  const selectedScene =
    project.scenes.find((scene) => scene.id === selectedSceneId) ?? project.scenes[0];
  const selectedAsset = selectedScene ? assetForScene(selectedScene, assets) : undefined;
  const projectName = project.metadata.name || info?.fallbackName || "未命名项目";
  const imageJobList = Object.values(imageJobs).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const speechJobList = Object.values(speechJobs).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const renderJobList = Object.values(renderJobs).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const currentRenderJob = renderJobList.find(
    (job) =>
      job.status === "queued" ||
      job.status === "processing" ||
      job.status === "cancelling",
  );
  const completedRenderJobs = renderJobList.filter((job) => job !== currentRenderJob);
  const pendingImageProposal = imageJobList.find(
    (job) =>
      job.proposalDialogOpen &&
      (job.resolution === "changed" || job.resolution === "incompatible"),
  );
  const selectedSceneIndex = selectedScene ? project.scenes.indexOf(selectedScene) : -1;
  const playingResolved =
    previewSnapshot === undefined
      ? undefined
      : findSceneAtFrame(previewSnapshot, currentFrame);
  const playingSceneIndex =
    playingResolved === undefined
      ? -1
      : project.scenes.findIndex((scene) => scene.id === playingResolved.scene.id);
  const previewBlocker = previewSnapshot?.previewBlockers[0];

  useEffect(() => {
    const playingSceneId = playingResolved?.scene.id;
    if (
      playingSceneId !== undefined &&
      previousPlayingSceneIdRef.current !== undefined &&
      previousPlayingSceneIdRef.current !== playingSceneId
    ) {
      setSceneBoundaryAnnouncement(
        `正在播放 Scene ${String(playingSceneIndex + 1).padStart(2, "0")}`,
      );
    }
    previousPlayingSceneIdRef.current = playingSceneId;
  }, [playingResolved?.scene.id, playingSceneIndex]);

  const selectAndSeekScene = (sceneId: string) => {
    if (previewSnapshot === undefined) return;
    const resolved = previewSnapshot.scenes.find(
      (candidate) => candidate.scene.id === sceneId,
    );
    if (resolved === undefined) return;
    const wasPlaying = playerRef.current?.isPlaying() ?? playing;
    selectScene(sceneId);
    playerRef.current?.seekTo(resolved.startFrame);
    setCurrentFrame(resolved.startFrame);
    if (wasPlaying) playerRef.current?.play();
    else playerRef.current?.pause();
  };

  const navigateToDiagnostic = (
    sceneId: string | undefined,
    path: Array<string | number> = [],
  ) => {
    if (sceneId === undefined || !project.scenes.some((scene) => scene.id === sceneId)) {
      setInspectorMode("project");
      setTaskDrawerOpen(false);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>("[data-testid='inspector-project'] input, [data-testid='inspector-project'] select")?.focus(),
      );
      return;
    }
    selectAndSeekScene(sceneId);
    setInspectorMode("scene");
    setTaskDrawerOpen(false);
    const target = path.includes("speech")
      ? `[data-speech-cell-scene-id="${sceneId}"]`
      : path.includes("narration")
        ? `[data-narration-scene-id="${sceneId}"]`
        : path.includes("visual")
          ? `[data-visual-type-scene-id="${sceneId}"]`
          : `[data-scene-select][aria-label*="Scene ${project.scenes.findIndex((scene) => scene.id === sceneId) + 1}"]`;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(target)?.focus());
  };

  const navigateRenderJob = (job: RenderJob) => {
    const frameScene =
      job.error?.frame === undefined
        ? undefined
        : job.snapshotPlan.find(
            (scene) =>
              job.error!.frame! >= scene.startFrame &&
              job.error!.frame! < scene.startFrame + scene.durationInFrames,
          )?.sceneId;
    navigateToDiagnostic(job.error?.sceneId ?? frameScene);
  };

  const closeAssetPreview = () => {
    const trigger = assetPreview?.trigger;
    setAssetPreview(undefined);
    requestAnimationFrame(() => trigger?.focus());
  };

  const handleDeleteScene = (sceneId: string) => {
    const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
    const playbackFrame = playerRef.current?.getCurrentFrame() ?? currentFrame;
    const playbackScene =
      previewSnapshot === undefined
        ? undefined
        : findSceneAtFrame(previewSnapshot, playbackFrame);
    if (sceneIndex >= 0 && playbackScene !== undefined) {
      const wasPlaying = playerRef.current?.isPlaying() ?? playing;
      const nextSceneId =
        project.scenes[sceneIndex + 1]?.id ?? project.scenes[sceneIndex - 1]?.id;
      pendingStructuralPlaybackRef.current =
        playbackScene.scene.id === sceneId
          ? nextSceneId === undefined
            ? undefined
            : { sceneId: nextSceneId, offsetInFrames: 0, wasPlaying: false }
          : {
              sceneId: playbackScene.scene.id,
              offsetInFrames: playbackFrame - playbackScene.startFrame,
              wasPlaying,
            };
      if (wasPlaying) playerRef.current?.pause();
    }
    const narrationPopover = document.querySelector<HTMLElement>(
      `[data-narration-popover-scene-id="${sceneId}"]`,
    );
    if (narrationPopover?.matches(":popover-open")) {
      narrationPopover.hidePopover();
    }
    if (assetPreview?.sceneId === sceneId) setAssetPreview(undefined);
    if (cardChoice?.sceneId === sceneId) setCardChoice(undefined);
    if (pendingVisualChange?.sceneId === sceneId) setPendingVisualChange(undefined);
    if (draggedSceneId === sceneId) {
      setDraggedSceneId(undefined);
      setDropTargetIndex(undefined);
    }
    if (keyboardReorder?.sceneId === sceneId) {
      setKeyboardReorder(undefined);
      setDropTargetIndex(undefined);
      setReorderAnnouncement("");
    }
    void deleteScene(sceneId);
  };

  const seekProjectFrame = (frame: number) => {
    if (previewSnapshot === undefined) return;
    const nextFrame = Math.min(
      previewSnapshot.durationInFrames - 1,
      Math.max(0, Math.floor(frame)),
    );
    playerRef.current?.seekTo(nextFrame);
    setCurrentFrame(nextFrame);
  };

  const beginScrub = () => {
    scrubWasPlayingRef.current = playerRef.current?.isPlaying() ?? playing;
    if (scrubWasPlayingRef.current) playerRef.current?.pause();
  };

  const endScrub = () => {
    if (scrubWasPlayingRef.current) playerRef.current?.play();
    scrubWasPlayingRef.current = false;
  };

  const restoreVisualTrigger = (trigger: HTMLSelectElement) => {
    requestAnimationFrame(() => trigger.focus());
  };
  const stageVisualMigration = (
    sceneId: string,
    targetType: VisualType,
    trigger: HTMLSelectElement,
    cardDraft?: CardVisual,
  ) => {
    const scene = project.scenes.find((candidate) => candidate.id === sceneId);
    if (scene === undefined) return;
    const migration = migrateVisual(
      scene.visual,
      targetType,
      assetForScene(scene, assets),
      cardDraft,
    );
    if (migration.losses.length > 0) {
      setPendingVisualChange({
        sceneId,
        visual: migration.visual,
        losses: migration.losses,
        trigger,
      });
      return;
    }
    void updateVisual(sceneId, migration.visual);
    restoreVisualTrigger(trigger);
  };
  const requestVisualChange = (
    scene: Scene,
    targetType: VisualType,
    trigger: HTMLSelectElement,
  ) => {
    if (scene.visual.type === targetType) return;
    if (
      targetType === "card" &&
      scene.visual.type !== "card" &&
      scene.visual.caption === undefined
    ) {
      setCardChoice({ sceneId: scene.id, trigger });
      return;
    }
    stageVisualMigration(scene.id, targetType, trigger);
  };
  const focusReorderHandle = (sceneId: string) => {
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-reorder-handle="${sceneId}"]`)
        ?.focus();
    });
  };
  const commitReorder = (
    sceneId: string,
    targetIndex: number,
    restoreFocus = false,
  ) => {
    const scene = project.scenes.find((candidate) => candidate.id === sceneId);
    if (scene === undefined) return;
    const sourceIndex = project.scenes.indexOf(scene);
    if (sourceIndex !== targetIndex) {
      const playbackFrame = playerRef.current?.getCurrentFrame() ?? currentFrame;
      const playbackScene =
        previewSnapshot === undefined
          ? undefined
          : findSceneAtFrame(previewSnapshot, playbackFrame);
      if (playbackScene !== undefined) {
        const wasPlaying = playerRef.current?.isPlaying() ?? playing;
        pendingStructuralPlaybackRef.current = {
          sceneId: playbackScene.scene.id,
          offsetInFrames: playbackFrame - playbackScene.startFrame,
          wasPlaying,
        };
        if (wasPlaying) playerRef.current?.pause();
      }
      void reorderScene(sceneId, targetIndex);
    }
    const message = `Scene 已移动到第 ${targetIndex + 1} 项`;
    setReorderNotice(message);
    setReorderAnnouncement(message);
    if (restoreFocus) focusReorderHandle(sceneId);
  };
  const handleReorderKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    scene: Scene,
    index: number,
  ) => {
    const active = keyboardReorder?.sceneId === scene.id;
    if (!active && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      setKeyboardReorder({ sceneId: scene.id, targetIndex: index });
      setReorderAnnouncement(`已提起 Scene ${index + 1}，使用方向键移动`);
      return;
    }
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setKeyboardReorder(undefined);
      setDropTargetIndex(undefined);
      setReorderAnnouncement(`已取消 Scene ${index + 1} 重排`);
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const targetIndex = keyboardReorder.targetIndex;
      setKeyboardReorder(undefined);
      setDropTargetIndex(undefined);
      commitReorder(scene.id, targetIndex, true);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    const targetIndex = keyboardReorder.targetIndex + direction;
    if (targetIndex < 0 || targetIndex >= project.scenes.length) return;
    setKeyboardReorder({ sceneId: scene.id, targetIndex });
    setDropTargetIndex(targetIndex);
    setReorderAnnouncement(`Scene 将移动到第 ${targetIndex + 1} 项`);
  };

  if (project.scenes.length === 0) {
    return <EmptyWorkspace project={project} projectName={projectName} diagnostics={diagnostics} controlsDisabled={workspaceDisabled} occupied={occupied} onThemeChange={(theme) => void updateTheme(theme)} onAddScene={addSingleScene} />;
  }

  const bannerKind = occupied ? "lease" : migrationSavedNotice ? "migration-saved" : migrationPending ? "migration" : undefined;
  const maxFrame = Math.max(0, (previewSnapshot?.durationInFrames ?? 1) - 1);
  const progressPercent = maxFrame === 0 ? 0 : (currentFrame / maxFrame) * 100;
  const playingScene = playingResolved?.scene;
  const playingSpeechJob =
    playingScene === undefined
      ? undefined
      : latestSpeechJobForScene(speechJobs, playingScene.id);
  const playingSpeechActive =
    playingSpeechJob?.status === "queued" ||
    playingSpeechJob?.status === "processing" ||
    playingSpeechJob?.status === "cancelling";
  const playingSceneStatus =
    playingScene?.speech === undefined
      ? {
          tone: "draft",
          label: "Draft · 5.0s",
          detail: playingSpeechActive ? "正在生成 · 仅供预览" : "仅供预览",
        }
      : mediaAvailability[playingScene.speech.path] === false
        ? { tone: "error", label: "Speech 缺失", detail: "预览静音" }
        : {
            tone: "ready",
            label: `Speech · ${(playingScene.speech.durationMs / 1000).toFixed(1)}s`,
            detail: playingSpeechActive ? "正在重新生成 · 当前版本仍有效" : "逐帧可信",
          };

  return (
    <div className={`app-shell ${bannerKind === undefined ? "" : "has-banner"}`}>
      <Topbar projectName={projectName} controlsDisabled={workspaceDisabled} renderDisabled={occupied || speechCommitInFlight} renderDiagnostics={renderDiagnostics} />
      {bannerKind === undefined ? null : <WorkspaceBanner kind={bannerKind} />}
      <fieldset className="workspace-lock" disabled={workspaceDisabled}>
      <main className="workspace" data-testid={occupied ? "readonly-workbench" : "global-workbench"}>
        <section className="pane script-pane">
          <PaneHeading title="脚本表" meta={`${project.scenes.length} 个 Scene`} actions={<div className="filter"><button aria-pressed="true">全部</button><button aria-pressed="false">待修复</button></div>} />
          <div className="table-wrap" ref={tableScrollRef}>
            <table className="scene-table"><thead><tr><th>顺序</th><th>Narration</th><th>Visual Type</th><th>Asset</th><th>Speech</th><th>状态</th><th className="scene-actions-heading">操作</th></tr></thead><tbody>
              {project.scenes.map((scene, index) => {
                const asset = assetForScene(scene, assets);
                const sceneDiagnostics = renderDiagnostics.filter(
                  (diagnostic) => diagnostic.sceneId === scene.id,
                );
                const assetStatus = sceneAssetStatus(scene, asset, mediaAvailability, sceneDiagnostics);
                const selected = scene.id === selectedScene?.id;
                const narrationPopoverId = `narration-popover-${scene.id}`;
                const expandedNarrationId = `narration-expanded-${scene.id}`;
                return (
                  <tr key={scene.id} className={`${selected ? "selected" : ""} ${dropTargetIndex === index ? "drop-target" : ""}`} data-testid="scene-row" data-scene-id={scene.id} onPointerDownCapture={(event) => { const target = event.target; if (target instanceof Element && target.closest("button, input, select, textarea, a, [contenteditable='true'], [role='button']")) return; selectAndSeekScene(scene.id); }} onDragOver={(event) => { if (draggedSceneId === undefined) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTargetIndex(index); }} onDrop={(event) => { event.preventDefault(); const sceneId = draggedSceneId ?? event.dataTransfer.getData("text/plain"); setDraggedSceneId(undefined); setDropTargetIndex(undefined); if (sceneId !== "") commitReorder(sceneId, index); }}>
                    <td><div className="order-cell"><button className="reorder-handle" type="button" draggable data-reorder-handle={scene.id} aria-label={`重排 Scene ${index + 1}`} aria-pressed={keyboardReorder?.sceneId === scene.id} onClick={(event) => event.stopPropagation()} onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => { setDraggedSceneId(scene.id); setDropTargetIndex(index); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", scene.id); }} onDragEnd={() => { setDraggedSceneId(undefined); setDropTargetIndex(undefined); }} onKeyDown={(event) => handleReorderKeyDown(event, scene, index)}><DotsSixVertical weight="bold" /></button><button className="scene-number scene-select" type="button" data-scene-select aria-label={`选择并预览 Scene ${index + 1}`} aria-current={selected ? "true" : undefined} onClick={() => selectAndSeekScene(scene.id)}>{String(index + 1).padStart(2, "0")}</button></div></td>
                    <td><div className="narration-cell">
                      <textarea ref={selected ? selectedNarrationRef : undefined} data-narration-scene-id={scene.id} className="narration" aria-label={`Scene ${index + 1} Narration`} value={scene.narration.text} onClick={(event) => event.stopPropagation()} onChange={(event) => updateNarration(scene.id, event.target.value)} onBlur={endTextTransaction} />
                      <button className="narration-expand" type="button" aria-label={`扩大编辑 Scene ${index + 1} Narration`} onClick={(event) => { event.stopPropagation(); openNarrationPopover(narrationPopoverId, expandedNarrationId); }}><ArrowsOutSimple /></button>
                      <section id={narrationPopoverId} data-narration-popover-scene-id={scene.id} className="narration-popover" popover="auto" role="dialog" aria-label={`扩大编辑 Scene ${index + 1} Narration`} onClick={(event) => event.stopPropagation()}>
                        <header><div><p className="eyebrow">Scene {String(index + 1).padStart(2, "0")}</p><h2>扩大编辑 Narration</h2></div><button className="btn icon" type="button" aria-label="关闭扩大编辑" onClick={() => closeNarrationPopover(narrationPopoverId)}><X /></button></header>
                        <textarea id={expandedNarrationId} aria-label={`Scene ${index + 1} Narration 扩大编辑`} value={scene.narration.text} onChange={(event) => updateNarration(scene.id, event.target.value)} onBlur={endTextTransaction} />
                        <small>内容会直接写回当前 Scene</small>
                      </section>
                    </div></td>
                    <td><div className="table-cell visual-type-cell"><select data-visual-type-scene-id={scene.id} aria-label={`Scene ${index + 1} Visual Type`} value={scene.visual.type} onClick={(event) => event.stopPropagation()} onChange={(event) => requestVisualChange(scene, event.target.value as VisualType, event.currentTarget)}>{(Object.keys(visualLabels) as VisualType[]).map((type) => <option key={type} value={type}>{visualLabels[type]}</option>)}</select><span>{captionForVisual(scene.visual) ?? (scene.visual.type === "card" ? "结构化文字画面" : "标准画面")}</span></div></td>
                    <td><AssetCell scene={scene} sceneIndex={index} asset={asset} onPreview={(previewAsset, _sceneIndex, displayName, trigger) => setAssetPreview({ sceneId: scene.id, asset: previewAsset, displayName, trigger })} /></td>
                    <td><SpeechCell scene={scene} sceneIndex={index} /></td>
                    <td><span className={assetStatus.className}>{assetStatus.label}</span></td>
                    <td className="scene-actions-cell"><button className="scene-delete-button" type="button" aria-label={`删除 Scene ${index + 1}`} title={`删除 Scene ${index + 1}`} onClick={(event) => { event.stopPropagation(); handleDeleteScene(scene.id); }}><Trash /></button></td>
                  </tr>
                );
              })}
            </tbody></table>
          </div>
          <div className={`reorder-feedback ${reorderNotice === "" ? "empty" : ""}`} role="status" aria-label="重排提示">{reorderNotice}</div>
          <div className="sr-only" aria-live="assertive">{reorderAnnouncement}</div>
          <footer className="script-footer"><button className="btn compact" onClick={() => setBatchDialogOpen(true)}><Plus />批量添加</button><button className="btn compact" onClick={addSingleScene}><Plus />新增一条</button></footer>
        </section>

        <section className="pane player-pane">
          <PaneHeading
            title="Player"
            meta={
              <span className="player-scene-context" aria-label="Player Scene 上下文">
                <b data-testid="player-selected-scene">选中 {String(selectedSceneIndex + 1).padStart(2, "0")}</b>
                <i aria-hidden="true" />
                <b data-testid="player-playing-scene">播放 {String(playingSceneIndex + 1).padStart(2, "0")}</b>
              </span>
            }
            actions={<button className="btn compact safe-area-toggle" aria-pressed={safeAreaVisible} onClick={() => setSafeAreaVisible((visible) => !visible)}>安全区</button>}
          />
          <div className="stage"><div className="preview-frame remotion-preview">
            {previewBlocker !== undefined ? (
              <div className="player-blocking-state" data-testid="player-blocking-state" role="alert">
                <WarningCircle weight="fill" size={32} />
                <strong>字体或文字 Preset 无法解析</strong>
                <span>{previewBlocker.message}</span>
                <small>请在项目主题或 Scene 文字表现中恢复内置版本；不会改用系统或在线字体。</small>
              </div>
            ) : previewSnapshot && playerInputProps ? (
              <Player
                key={playerGeneration}
                ref={playerRef}
                component={ProjectComposition}
                inputProps={playerInputProps}
                durationInFrames={previewSnapshot.durationInFrames}
                compositionWidth={previewSnapshot.width}
                compositionHeight={previewSnapshot.height}
                fps={previewSnapshot.fps}
                controls={false}
                clickToPlay={false}
                acknowledgeRemotionLicense
                style={{ width: "100%", height: "100%" }}
              />
            ) : null}
            {playerError !== undefined ? (
              <div className="player-blocking-state" data-testid="player-runtime-error" role="alert">
                <WarningCircle weight="fill" size={32} />
                <strong>当前预览无法继续</strong>
                <span>{playerError}</span>
                <small>请检查当前 Scene 的项目文件后重试。</small>
              </div>
            ) : null}
            {safeAreaVisible ? <div className="safe-area-overlay" data-testid="safe-area-overlay"><span>80px SAFE</span></div> : null}
          </div></div>
          <div className="player-controls">
            <button
              className="play-button"
              aria-label={playing ? "暂停" : "播放"}
              disabled={previewSnapshot === undefined || previewBlocker !== undefined}
              onClick={() => {
                if (playerRef.current?.isPlaying()) playerRef.current.pause();
                else playerRef.current?.play();
              }}
            >
              {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
            </button>
            <span className="playback-copy">
              <strong data-testid="player-playback-state">{playing ? "播放中" : "已暂停"}</strong>
              <small>{playerBuffering ? "正在缓冲当前资源" : "Remotion Player"}</small>
            </span>
            <label className="scrubber">
              <span className="sr-only">项目播放进度</span>
              <input
                type="range"
                aria-label="项目播放进度"
                min={0}
                max={maxFrame}
                step={1}
                value={Math.min(currentFrame, maxFrame)}
                disabled={previewBlocker !== undefined}
                style={{ background: `linear-gradient(to right, var(--accent) ${progressPercent}%, var(--border) ${progressPercent}%)` }}
                onChange={(event) => seekProjectFrame(Number(event.currentTarget.value))}
                onPointerDown={beginScrub}
                onPointerUp={endScrub}
                onPointerCancel={endScrub}
              />
              <span className="timecode">
                {formatProjectTimecode(currentFrame, previewSnapshot?.fps ?? 30)} / {formatProjectTimecode(maxFrame, previewSnapshot?.fps ?? 30)}
              </span>
            </label>
            <span className={`scene-playback-state ${playingSceneStatus.tone}`} data-testid={playingSceneStatus.tone === "draft" ? "player-draft-state" : "player-scene-state"} role="status">
              {playingSceneStatus.tone === "ready" ? <CheckCircle weight="fill" aria-hidden="true" /> : <WarningCircle weight="fill" aria-hidden="true" />}
              <span><strong>{playingSceneStatus.label}</strong><small>{playingSceneStatus.detail}</small></span>
            </span>
          </div>
          <div className="sr-only" aria-live="polite">{sceneBoundaryAnnouncement}</div>
        </section>

        <section className="pane inspector-pane">
          <PaneHeading title="属性" meta={inspectorMode === "project" ? "项目主题" : selectedScene ? inspectorVisualLabels[selectedScene.visual.type] : "未选择场景"} actions={<div className="inspector-tabs" role="tablist" aria-label="属性范围"><button role="tab" aria-selected={inspectorMode === "scene"} onClick={() => setInspectorMode("scene")}>场景</button><button role="tab" aria-selected={inspectorMode === "project"} onClick={() => setInspectorMode("project")}>项目</button></div>} />
          <div className="inspector-scroll" data-testid={inspectorMode === "project" ? "inspector-project" : "inspector-scene"}>
            {inspectorMode === "project" ? (
              <ProjectThemeInspector project={project} diagnostics={diagnostics} onChange={(theme) => void updateTheme(theme)} />
            ) : selectedScene ? <><h3>场景 {String(project.scenes.indexOf(selectedScene) + 1).padStart(2, "0")}</h3><label>旁白文稿（同时作为底部字幕）<textarea value={selectedScene.narration.text} onChange={(event) => updateNarration(selectedScene.id, event.target.value)} onBlur={endTextTransaction} /></label><VisualFields visual={selectedScene.visual} onChange={(visual) => void updateVisual(selectedScene.id, visual)} /><SceneTextPresentationInspector sceneIndex={selectedSceneIndex} visual={selectedScene.visual} theme={project.theme} diagnostics={diagnostics} onChange={(visual) => void updateVisual(selectedScene.id, visual)} onMotionChange={(visual) => { void updateVisual(selectedScene.id, visual).then(() => { const resolved = previewSnapshot?.scenes.find((candidate) => candidate.scene.id === selectedScene.id); if (resolved) playerRef.current?.seekTo(resolved.startFrame); playerRef.current?.play(); }); }} /><label>素材项目相对路径<input value={selectedAsset?.path ?? "未绑定"} readOnly /></label><div className="inspector-note"><WarningCircle weight="fill" />缺少旁白音频时，预览使用 5 秒草稿时长；最终渲染前仍需生成。</div></> : null}
          </div>
        </section>
      </main>
      <aside className={`task-drawer ${taskDrawerOpen ? "open" : ""}`} aria-hidden={!taskDrawerOpen} aria-label="任务与渲染">
        <header><h2>任务与渲染</h2><button className="btn icon" aria-label="关闭任务抽屉" onClick={() => setTaskDrawerOpen(false)}><X /></button></header>
        <div className="task-groups">
          {currentRenderJob ? <section><h3>当前渲染</h3><RenderJobTask job={currentRenderJob} onNavigate={navigateRenderJob} /></section> : null}
          {completedRenderJobs.length > 0 ? <section><h3>渲染结果</h3><div className="render-job-list">{completedRenderJobs.map((job) => <RenderJobTask key={job.id} job={job} onNavigate={navigateRenderJob} />)}</div></section> : null}
          {renderStartError || renderOpenError ? <section><h3>渲染操作</h3><div className="render-operation-error" role="alert"><WarningCircle weight="fill" /><span><strong>{renderOpenError ? "结果目录无法打开" : "无法创建 Render Job"}</strong>{renderOpenError ?? renderStartError}</span></div></section> : null}
          {speechJobList.length > 0 ? <section><h3>Speech 生成</h3><div className="speech-job-list">{speechJobList.map((job) => <SpeechJobTask key={job.id} job={job} />)}</div></section> : null}
          {imageJobList.length > 0 ? <section><h3>图片导入</h3><div className="image-job-list">{imageJobList.map((job) => <ImageJobTask key={job.id} job={job} />)}</div></section> : null}
          {saveDiagnostics.length > 0 ? <section><h3>保存问题</h3><div className="task-diagnostics">{saveDiagnostics.map((diagnostic) => <div key={`save-${diagnostic.code}-${diagnostic.path.join(".")}`} className="error"><WarningCircle weight="fill" /><span><strong>阻止保存</strong>{diagnostic.message}<code>{diagnostic.path.join(".") || "project.json"}</code></span></div>)}</div></section> : null}
          <section><h3>Render-ready 问题</h3>{renderDiagnostics.length === 0 ? <div className="task-empty"><ListChecks size={48} /><strong>可以渲染</strong><span>当前快照未发现 Theme、Preset、媒体或文字版面问题。</span></div> : <div className="task-diagnostics">{renderDiagnostics.map((diagnostic) => <button ref={diagnostic === firstRenderBlocker ? firstRenderBlockerRef : undefined} type="button" key={`${diagnostic.code}-${diagnostic.path.join(".")}`} className={diagnostic.severity} onClick={() => navigateToDiagnostic(diagnostic.sceneId, diagnostic.path)}><WarningCircle weight="fill" /><span><strong>{diagnostic.severity === "error" ? "阻断 · 前往修复" : "提醒 · 查看"}</strong>{diagnostic.message}<code>{diagnostic.path.join(".")}</code></span></button>)}</div>}</section>
        </div>
      </aside>
      {batchDialogOpen ? <BatchCreateDialog existingSceneCount={project.scenes.length} onClose={() => setBatchDialogOpen(false)} onCreate={async (lines, visualType) => { await addScenesFromLines(lines, visualType); setBatchDialogOpen(false); }} /> : null}
      {cardChoice ? <CardContentDialog onCancel={() => { const trigger = cardChoice.trigger; setCardChoice(undefined); restoreVisualTrigger(trigger); }} onCreate={(card) => { const choice = cardChoice; setCardChoice(undefined); stageVisualMigration(choice.sceneId, "card", choice.trigger, card); }} /> : null}
      {pendingVisualChange ? <VisualLossDialog losses={pendingVisualChange.losses} onCancel={() => { const trigger = pendingVisualChange.trigger; setPendingVisualChange(undefined); restoreVisualTrigger(trigger); }} onConfirm={() => { const change = pendingVisualChange; setPendingVisualChange(undefined); void updateVisual(change.sceneId, change.visual); restoreVisualTrigger(change.trigger); }} /> : null}
      </fieldset>
      <div className="sr-only" aria-live="polite">{imageJobAnnouncement}</div>
      <div className="sr-only" aria-live="polite">{speechJobAnnouncement}</div>
      <div className="sr-only" aria-live="polite">{renderJobAnnouncement}</div>
      {assetPreview ? <AssetPreviewDialog asset={assetPreview.asset} displayName={assetPreview.displayName} available={mediaAvailability[assetPreview.asset.path]} onClose={closeAssetPreview} /> : null}
      {pendingImageProposal ? <ImageProposalDialog job={pendingImageProposal} /> : null}
      <ExternalConflictDialog />
    </div>
  );
}

function EmptyWorkspaceTaskDrawer({
  project,
  diagnostics,
}: {
  project: import("../shared/project").Project;
  diagnostics: import("../shared/project").Diagnostic[];
}) {
  const taskDrawerOpen = useProjectStore((state) => state.taskDrawerOpen);
  const setTaskDrawerOpen = useProjectStore((state) => state.setTaskDrawerOpen);
  const saveDiagnostics = useProjectStore((state) => state.saveDiagnostics);
  const mediaAvailability = useProjectStore((state) => state.mediaAvailability);
  const imageJobs = useImageImportStore((state) => state.jobs);
  const speechJobs = useSpeechGenerationStore((state) => state.jobs);
  const renderJobs = useRenderJobStore((state) => state.jobs);
  const renderStartError = useRenderJobStore((state) => state.startError);
  const renderOpenError = useRenderJobStore((state) => state.openError);
  const imageJobList = Object.values(imageJobs).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const speechJobList = Object.values(speechJobs).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const renderJobList = Object.values(renderJobs).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const currentRenderJob = renderJobList.find(
    (job) =>
      job.status === "queued" ||
      job.status === "processing" ||
      job.status === "cancelling",
  );
  const completedRenderJobs = renderJobList.filter(
    (job) => job !== currentRenderJob,
  );
  const renderDiagnostics = [
    ...diagnostics,
    ...validateRenderReadiness(project, mediaAvailability),
  ];

  return (
    <aside className={`task-drawer ${taskDrawerOpen ? "open" : ""}`} aria-hidden={!taskDrawerOpen} aria-label="任务与渲染">
      <header><h2>任务与渲染</h2><button className="btn icon" aria-label="关闭任务抽屉" onClick={() => setTaskDrawerOpen(false)}><X /></button></header>
      <div className="task-groups">
        {currentRenderJob ? <section><h3>当前渲染</h3><RenderJobTask job={currentRenderJob} onNavigate={() => setTaskDrawerOpen(false)} /></section> : null}
        {completedRenderJobs.length > 0 ? <section><h3>渲染结果</h3><div className="render-job-list">{completedRenderJobs.map((job) => <RenderJobTask key={job.id} job={job} onNavigate={() => setTaskDrawerOpen(false)} />)}</div></section> : null}
        {renderStartError || renderOpenError ? <section><h3>渲染操作</h3><div className="render-operation-error" role="alert"><WarningCircle weight="fill" /><span><strong>{renderOpenError ? "结果目录无法打开" : "无法创建 Render Job"}</strong>{renderOpenError ?? renderStartError}</span></div></section> : null}
        {speechJobList.length > 0 ? <section><h3>Speech 生成</h3><div className="speech-job-list">{speechJobList.map((job) => <SpeechJobTask key={job.id} job={job} />)}</div></section> : null}
        {imageJobList.length > 0 ? <section><h3>图片导入</h3><div className="image-job-list">{imageJobList.map((job) => <ImageJobTask key={job.id} job={job} />)}</div></section> : null}
        {saveDiagnostics.length > 0 ? <section><h3>保存问题</h3><div className="task-diagnostics">{saveDiagnostics.map((diagnostic) => <div key={`save-${diagnostic.code}-${diagnostic.path.join(".")}`} className="error"><WarningCircle weight="fill" /><span><strong>阻止保存</strong>{diagnostic.message}<code>{diagnostic.path.join(".") || "project.json"}</code></span></div>)}</div></section> : null}
        <section><h3>Render-ready 问题</h3>{renderDiagnostics.length === 0 ? <div className="task-empty"><ListChecks size={48} /><strong>可以渲染</strong><span>当前快照未发现 Theme、Preset、媒体或文字版面问题。</span></div> : <div className="task-diagnostics">{renderDiagnostics.map((diagnostic) => <div key={`${diagnostic.code}-${diagnostic.path.join(".")}`} className={diagnostic.severity}><WarningCircle weight="fill" /><span><strong>{diagnostic.severity === "error" ? "阻断" : "提醒"}</strong>{diagnostic.message}<code>{diagnostic.path.join(".")}</code></span></div>)}</div>}</section>
      </div>
    </aside>
  );
}

function EmptyWorkspace({ project, projectName, diagnostics, controlsDisabled, occupied, onThemeChange, onAddScene }: { project: import("../shared/project").Project; projectName: string; diagnostics: import("../shared/project").Diagnostic[]; controlsDisabled: boolean; occupied: boolean; onThemeChange: (theme: import("../shared/project").Project["theme"]) => void; onAddScene: () => void }) {
  const addScenesFromLines = useProjectStore((state) => state.addScenesFromLines);
  const migrationPending = useProjectStore((state) => state.migrationPending);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const bannerKind = occupied ? "lease" : migrationPending ? "migration" : undefined;

  return (
    <div className={`app-shell ${bannerKind === undefined ? "" : "has-banner"}`}><Topbar projectName={projectName} controlsDisabled={controlsDisabled} renderDisabled={occupied} />{bannerKind === undefined ? null : <WorkspaceBanner kind={bannerKind} />}<fieldset className="workspace-lock" disabled={controlsDisabled}><main className="workspace" data-testid={occupied ? "readonly-workbench" : "global-workbench"}>
      <section className="pane script-pane empty-script"><PaneHeading title="脚本表" meta="0 个 Scene" actions={<button className="btn compact" onClick={() => setBatchDialogOpen(true)}>新建 Scene</button>} /><div className="empty-state"><span className="first-scene-badge">01</span><h1>从第一句讲解开始</h1><p>粘贴逐行 Narration，我们只按换行拆分，并在真正写入项目之前让你整理完整结果。</p><div className="empty-actions"><button className="btn primary" onClick={() => setBatchDialogOpen(true)}><Plus />粘贴多行 Narration</button><button className="btn" data-add-scene onClick={onAddScene}>新增一条</button></div><small>空白行会被忽略并计数 · Scene 数量不限</small></div></section>
      <section className="pane player-pane"><PaneHeading title="Player" meta="无 Scene" /><div className="stage"><div className="preview-frame empty-preview"><strong>暂无可预览内容</strong><span>创建 Scene 后，这里会显示画面与可储存的字幕层。</span></div></div><div className="player-controls"><button className="play-button" aria-label="播放" disabled><Play weight="fill" /></button><span className="timecode">00:00 / 00:00</span><div className="scrubber"><span /></div></div></section>
      <section className="pane inspector-pane"><PaneHeading title="属性" meta="项目主题" actions={<div className="inspector-tabs" role="tablist" aria-label="属性范围"><button role="tab" aria-selected="false" disabled>场景</button><button role="tab" aria-selected="true">项目</button></div>} /><div className="inspector-scroll" data-testid="inspector-project"><ProjectThemeInspector project={project} diagnostics={diagnostics} onChange={onThemeChange} /></div></section>
    </main>
      <EmptyWorkspaceTaskDrawer project={project} diagnostics={diagnostics} />
      {batchDialogOpen ? <BatchCreateDialog existingSceneCount={0} onClose={() => setBatchDialogOpen(false)} onCreate={async (lines, visualType) => { await addScenesFromLines(lines, visualType); setBatchDialogOpen(false); }} /> : null}
      </fieldset><ExternalConflictDialog />
    </div>
  );
}

function App() {
  const phase = useProjectStore((state) => state.phase);
  const load = useProjectStore((state) => state.load);
  useEffect(() => { void load(); }, [load]);
  if (phase === "loading") return <LoadingScreen />;
  if (phase === "error") return <ErrorScreen />;
  if (phase === "readonly") return <ReadonlyScreen />;
  if (phase === "occupied") return <Workspace occupied />;
  return <Workspace />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

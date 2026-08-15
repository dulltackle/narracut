import { StrictMode, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ArrowUUpLeft } from "@phosphor-icons/react/ArrowUUpLeft";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CircleNotch } from "@phosphor-icons/react/CircleNotch";
import { ClipboardText } from "@phosphor-icons/react/ClipboardText";
import { FilmSlate } from "@phosphor-icons/react/FilmSlate";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { ListChecks } from "@phosphor-icons/react/ListChecks";
import { LockSimple } from "@phosphor-icons/react/LockSimple";
import { Pause } from "@phosphor-icons/react/Pause";
import { Play } from "@phosphor-icons/react/Play";
import { Plus } from "@phosphor-icons/react/Plus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";

import type { Asset, Scene, Visual } from "../shared/project";
import { CURRENT_SCHEMA_VERSION } from "../shared/project";
import { useProjectStore } from "./project-store";
import "./styles.css";

const visualLabels: Record<Visual["type"], string> = {
  title: "Title",
  image: "Image",
  "image-caption": "Image + Caption",
  video: "Video",
  "video-caption": "Video + Caption",
  "end-card": "End Card",
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
    return [{ index, text, visualType }];
  });
}

function ReadonlyScreen() {
  const info = useProjectStore((state) => state.info);
  const project = useProjectStore((state) => state.unknownProject);
  const version = useProjectStore((state) => state.unknownVersion);
  const scenes = safeUnknownScenes(project);
  const metadata = project?.metadata;
  const projectName =
    typeof metadata === "object" && metadata !== null &&
    typeof Reflect.get(metadata, "name") === "string"
      ? String(Reflect.get(metadata, "name"))
      : info?.fallbackName ?? "未命名项目";
  const selected = scenes[0];

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
          <div className="table-wrap"><table><thead><tr><th>顺序</th><th>Narration</th><th>Visual Type</th><th>状态</th></tr></thead><tbody>
            {scenes.map((scene) => <tr key={scene.index}><td>{String(scene.index + 1).padStart(2, "0")}</td><td>{scene.text}</td><td>{scene.visualType}</td><td>需新版应用验证</td></tr>)}
          </tbody></table></div>
        </section>
        <section className="pane player-pane"><PaneHeading title="Player" meta="预览不可用" /><div className="stage"><div className="preview-frame"><LockSimple size={48} /><p>{selected?.text ?? "无法安全预览此项目"}</p><span className="preview-badge">仅显示已解析内容</span></div></div></section>
        <section className="pane inspector-pane"><PaneHeading title="Inspector" meta={selected ? `Scene ${String(selected.index + 1).padStart(2, "0")} · 只读` : "只读"} /><div className="inspector-scroll"><h3>Scene</h3>{selected ? <><label>Narration<textarea value={selected.text} disabled /></label><label>Visual Type<input value={selected.visualType} disabled /></label></> : null}<h3>阻断原因</h3><div className="readonly-note">未知的新 schemaVersion 可能包含当前应用无法安全解释的字段，因此编辑、写入、Job 与渲染均已阻止。</div></div></section>
      </main>
    </div>
  );
}

function PaneHeading({ title, meta, actions }: { title: string; meta: string; actions?: ReactNode }) {
  return <div className="pane-head"><div className="pane-title"><h2>{title}</h2><span>{meta}</span></div>{actions}</div>;
}

function Topbar({ projectName, readOnly = false, controlsDisabled = false }: { projectName: string; readOnly?: boolean; controlsDisabled?: boolean }) {
  const info = useProjectStore((state) => state.info);
  const saveStatus = useProjectStore((state) => state.saveStatus);
  const saveErrorMessage = useProjectStore((state) => state.saveErrorMessage);
  const setTaskDrawerOpen = useProjectStore((state) => state.setTaskDrawerOpen);
  const actionsDisabled = readOnly || controlsDisabled;
  return (
    <header className="topbar">
      <div className="brand"><BrandMark /><div className="project-title"><strong>{projectName}</strong><small>{info?.projectDirectory}</small></div>{readOnly ? <span className="readonly-pill">只读模式</span> : <span className={`save-state ${saveStatus}`} title={saveErrorMessage} aria-label={saveErrorMessage ?? undefined}>{saveStatus === "saved" ? "已保存" : saveStatus === "saving" ? "保存中" : "保存失败"}</span>}</div>
      <div className="history"><button className="btn icon" aria-label="撤销" disabled><ArrowUUpLeft /></button><button className="btn icon" aria-label="重做" disabled><ArrowCounterClockwise /></button></div>
      <div className="top-actions"><button className="btn" disabled={actionsDisabled} onClick={() => setTaskDrawerOpen(true)}><ListChecks />任务 <span className="count">0</span></button><button className="btn primary" disabled={actionsDisabled}><FilmSlate />检查并渲染</button></div>
    </header>
  );
}

function assetForScene(scene: Scene, assets: Map<string, Asset>) {
  if (!("assetId" in scene.visual) || scene.visual.assetId === undefined) return undefined;
  return assets.get(scene.visual.assetId);
}

function captionForVisual(visual: Visual): string | undefined {
  if (visual.type !== "image-caption" && visual.type !== "video-caption") return undefined;
  return visual.caption.kind === "step"
    ? `步骤 ${visual.caption.number} · ${visual.caption.name}`
    : visual.caption.text;
}

function PlayerMedia({
  asset,
  exists,
}: {
  asset: Asset | undefined;
  exists: boolean;
}) {
  if (asset !== undefined && exists && asset.kind === "image") {
    return <img src={`/media/${asset.path}`} alt="当前 Scene Asset" />;
  }
  if (asset !== undefined && exists && asset.kind === "video") {
    return <video src={`/media/${asset.path}`} muted playsInline />;
  }
  return (
    <div className="media-fallback">
      <FolderOpen size={56} />
      <span>{asset ? "项目中的 Asset 文件不可用" : "尚未绑定可预览的 Asset"}</span>
    </div>
  );
}

function sceneAssetStatus(
  scene: Scene,
  asset: Asset | undefined,
  mediaAvailability: Record<string, boolean>,
) {
  if ("assetId" in scene.visual && asset === undefined) {
    return { className: "status-error", label: "缺少 Asset" };
  }
  if (asset !== undefined && mediaAvailability[asset.path] === false) {
    return { className: "status-error", label: "文件缺失" };
  }
  return { className: "status-ready", label: "可编辑草稿" };
}

function Workspace() {
  const project = useProjectStore((state) => state.project);
  const info = useProjectStore((state) => state.info);
  const selectedSceneId = useProjectStore((state) => state.selectedSceneId);
  const selectScene = useProjectStore((state) => state.selectScene);
  const updateNarration = useProjectStore((state) => state.updateNarration);
  const taskDrawerOpen = useProjectStore((state) => state.taskDrawerOpen);
  const setTaskDrawerOpen = useProjectStore((state) => state.setTaskDrawerOpen);
  const mediaAvailability = useProjectStore((state) => state.mediaAvailability);
  const [playing, setPlaying] = useState(false);
  const assets = useMemo(
    () => new Map(project?.assets.map((asset) => [asset.id, asset]) ?? []),
    [project?.assets],
  );
  if (project === undefined) return null;

  const selectedScene =
    project.scenes.find((scene) => scene.id === selectedSceneId) ?? project.scenes[0];
  const selectedAsset = selectedScene ? assetForScene(selectedScene, assets) : undefined;
  const selectedMediaExists =
    selectedAsset !== undefined && mediaAvailability[selectedAsset.path] === true;
  const projectName = project.metadata.name || info?.fallbackName || "未命名项目";

  if (project.scenes.length === 0) {
    return <EmptyWorkspace projectName={projectName} />;
  }

  return (
    <div className="app-shell">
      <Topbar projectName={projectName} />
      <main className="workspace" data-testid="global-workbench">
        <section className="pane script-pane">
          <PaneHeading title="脚本表" meta={`${project.scenes.length} 个 Scene`} actions={<div className="filter"><button aria-pressed="true">全部</button><button aria-pressed="false">待修复</button></div>} />
          <div className="table-wrap">
            <table className="scene-table"><thead><tr><th>顺序</th><th>Narration</th><th>Visual Type</th><th>Asset</th><th>Speech</th><th>状态</th></tr></thead><tbody>
              {project.scenes.map((scene, index) => {
                const asset = assetForScene(scene, assets);
                const assetStatus = sceneAssetStatus(scene, asset, mediaAvailability);
                const selected = scene.id === selectedScene?.id;
                return (
                  <tr key={scene.id} className={selected ? "selected" : ""} data-testid="scene-row" onClick={() => selectScene(scene.id)}>
                    <td><span className="scene-number">{String(index + 1).padStart(2, "0")}</span></td>
                    <td><textarea className="narration" aria-label={`Scene ${index + 1} Narration`} value={scene.narration.text} onClick={(event) => event.stopPropagation()} onChange={(event) => updateNarration(scene.id, event.target.value)} /></td>
                    <td><div className="table-cell"><strong>{visualLabels[scene.visual.type]}</strong><span>{captionForVisual(scene.visual) ?? "标准画面"}</span></div></td>
                    <td><div className="table-cell"><strong>{asset?.path.split("/").at(-1) ?? "尚未绑定"}</strong><span>{asset ? "项目相对路径" : "需要 Asset"}</span></div></td>
                    <td><div className="table-cell"><strong>{scene.speech ? "已生成" : "缺少 Speech"}</strong><span>{scene.speech ? `${(scene.speech.durationMs / 1000).toFixed(1)} 秒` : "使用 Draft Duration"}</span></div></td>
                    <td><span className={assetStatus.className}>{assetStatus.label}</span></td>
                  </tr>
                );
              })}
            </tbody></table>
          </div>
          <footer className="script-footer"><button className="btn compact"><Plus />添加 Scene</button></footer>
        </section>

        <section className="pane player-pane">
          <PaneHeading title="Player" meta={selectedScene ? `选中 Scene ${String(project.scenes.indexOf(selectedScene) + 1).padStart(2, "0")}` : "未选择 Scene"} actions={<button className="btn compact">适合画面</button>} />
          <div className="stage"><div className="preview-frame">
            <PlayerMedia asset={selectedAsset} exists={selectedMediaExists} />
            {selectedScene ? <><div className="caption">{captionForVisual(selectedScene.visual)}</div><div className="subtitle" data-testid="player-subtitle">{selectedScene.narration.text || "请输入 Narration"}</div></> : null}
          </div></div>
          <div className="player-controls"><button className="play-button" aria-label={playing ? "暂停" : "播放"} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button><span className="timecode">00:00 / --:--</span><div className="scrubber"><span /></div></div>
        </section>

        <section className="pane inspector-pane">
          <PaneHeading title="Inspector" meta={selectedScene ? visualLabels[selectedScene.visual.type] : "未选择 Scene"} />
          <div className="inspector-scroll" data-testid="inspector-scene">
            {selectedScene ? <><h3>Scene {String(project.scenes.indexOf(selectedScene) + 1).padStart(2, "0")}</h3><label>Narration<textarea value={selectedScene.narration.text} onChange={(event) => updateNarration(selectedScene.id, event.target.value)} /></label><label>Visual Type<input value={visualLabels[selectedScene.visual.type]} readOnly /></label><label>项目相对路径<input value={selectedAsset?.path ?? "未绑定"} readOnly /></label><div className="inspector-note"><WarningCircle weight="fill" />缺少 Speech 时使用 Draft Duration；最终渲染前仍需补齐。</div></> : null}
          </div>
        </section>
      </main>
      <aside className={`task-drawer ${taskDrawerOpen ? "open" : ""}`} aria-hidden={!taskDrawerOpen}><header><h2>任务</h2><button className="btn icon" aria-label="关闭任务抽屉" onClick={() => setTaskDrawerOpen(false)}><X /></button></header><div className="task-empty"><ListChecks size={48} /><strong>暂无运行中的任务</strong><span>转码、Speech 与渲染任务会显示在这里。</span></div></aside>
    </div>
  );
}

function EmptyWorkspace({ projectName }: { projectName: string }) {
  const addScenesFromLines = useProjectStore((state) => state.addScenesFromLines);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const lines = pasteText
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const createScenes = async () => {
    await addScenesFromLines(lines);
    setDialogOpen(false);
  };

  return (
    <div className="app-shell"><Topbar projectName={projectName} controlsDisabled /><main className="workspace">
      <section className="pane script-pane empty-script"><PaneHeading title="脚本表" meta="0 个 Scene" actions={<button className="btn compact" onClick={() => setDialogOpen(true)}>新建 Scene</button>} /><div className="empty-state"><span className="first-scene-badge">01</span><h1>从第一句讲解开始</h1><p>粘贴逐行文案，我们会按换行拆成 Scene，并在写入项目前让你检查完整结果。</p><div className="empty-actions"><button className="btn primary" onClick={() => setDialogOpen(true)}><Plus />粘贴多行文案</button><button className="btn" onClick={() => setDialogOpen(true)}>逐条新增 Scene</button></div><small>项目名与 Logo 可稍后补充 · 不提供示例内容</small></div></section>
      <section className="pane player-pane"><PaneHeading title="Player" meta="无 Scene" /><div className="stage"><div className="preview-frame empty-preview"><strong>暂无可预览内容</strong><span>创建 Scene 后，这里会显示画面与可储存的字幕层。</span></div></div><div className="player-controls"><button className="play-button" aria-label="播放" disabled><Play weight="fill" /></button><span className="timecode">00:00 / 00:00</span><div className="scrubber"><span /></div></div></section>
      <section className="pane inspector-pane"><PaneHeading title="Inspector" meta="项目" /><div className="inspector-scroll"><h3>项目元数据 · 可跳过</h3><label>项目名<input placeholder="未填写时使用文件夹名" /></label><label>Logo<input value="尚未选择" readOnly /></label><button className="btn compact" disabled>选择 Logo</button><h3 className="project-dsl-heading">Project DSL</h3><div className="readonly-note neutral-note">结构有效 · scenes[] 为空。只有创建至少一个 Scene 后才会离开空状态。</div></div></section>
    </main>
      {dialogOpen ? (
        <div className="modal-backdrop" onMouseDown={() => setDialogOpen(false)}>
          <section className="paste-dialog" role="dialog" aria-modal="true" aria-labelledby="paste-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><p className="eyebrow">原位创建</p><h2 id="paste-title">从多行文案创建 Scene</h2></div><button className="btn icon" aria-label="关闭" onClick={() => setDialogOpen(false)}><X /></button></header>
            <p>每个非空行会原样成为一个 Scene 的 Narration；创建后仍可在脚本表里逐句修改。</p>
            <textarea autoFocus aria-label="多行 Narration" placeholder={"第一句 Narration\n第二句 Narration"} value={pasteText} onChange={(event) => setPasteText(event.target.value)} />
            <div className="paste-preview"><strong>{lines.length === 0 ? "等待输入" : `将创建 ${lines.length} 个 Scene`}</strong><span>{lines.slice(0, 3).join(" · ") || "空行会被忽略"}</span></div>
            <footer><button className="btn" onClick={() => setDialogOpen(false)}>取消</button><button className="btn primary" disabled={lines.length === 0} onClick={() => void createScenes()}>创建 {lines.length} 个 Scene</button></footer>
          </section>
        </div>
      ) : null}
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
  return <Workspace />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

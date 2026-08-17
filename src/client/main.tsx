import { StrictMode, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
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
import { ListChecks } from "@phosphor-icons/react/ListChecks";
import { LockSimple } from "@phosphor-icons/react/LockSimple";
import { Pause } from "@phosphor-icons/react/Pause";
import { Play } from "@phosphor-icons/react/Play";
import { Plus } from "@phosphor-icons/react/Plus";
import { Trash } from "@phosphor-icons/react/Trash";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";

import type { Asset, Scene, Visual } from "../shared/project";
import { CURRENT_SCHEMA_VERSION } from "../shared/project";
import { useProjectStore } from "./project-store";
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
  const persistedProjectName = useProjectStore((state) => state.project?.metadata.name);
  const saveStatus = useProjectStore((state) => state.saveStatus);
  const saveErrorMessage = useProjectStore((state) => state.saveErrorMessage);
  const setTaskDrawerOpen = useProjectStore((state) => state.setTaskDrawerOpen);
  const updateProjectName = useProjectStore((state) => state.updateProjectName);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const projectNameButtonRef = useRef<HTMLButtonElement>(null);
  const actionsDisabled = readOnly || controlsDisabled;
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
  return (
    <header className="topbar">
      <div className="brand"><BrandMark /><div className="project-title">{editingProjectName ? <input autoFocus className="project-name-editor" aria-label="项目名" value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} onBlur={finishProjectNameEdit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.preventDefault(); cancelProjectNameEdit(); } }} /> : readOnly ? <strong>{projectName}</strong> : <button ref={projectNameButtonRef} className="project-name-button" type="button" aria-label="编辑项目名" onClick={beginProjectNameEdit}>{projectName}</button>}<small>{info?.projectDirectory}</small></div>{readOnly ? <span className="readonly-pill">只读模式</span> : <span className={`save-state ${saveStatus}`} title={saveErrorMessage} aria-label={saveErrorMessage ?? undefined}>{saveStatus === "saved" ? "已保存" : saveStatus === "saving" ? "保存中" : "保存失败"}</span>}</div>
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
  return visual.type === "card" ? undefined : visual.caption?.text;
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

function PlayerVisual({
  scene,
  asset,
  exists,
}: {
  scene: Scene;
  asset: Asset | undefined;
  exists: boolean;
}) {
  if (scene.visual.type === "card") {
    return (
      <div className="visual-layer card-visual" data-testid="player-visual">
        <div className="card-content">
          {scene.visual.label ? <span>{scene.visual.label}</span> : null}
          {scene.visual.title ? <strong>{scene.visual.title}</strong> : null}
          {scene.visual.body ? <p>{scene.visual.body}</p> : null}
          {scene.visual.items ? <ul>{scene.visual.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : null}
        </div>
        <div className="subtitle" data-testid="player-subtitle">{scene.narration.text || "请输入 Narration"}</div>
      </div>
    );
  }
  return (
    <div className="visual-layer" data-testid="player-visual">
      <PlayerMedia asset={asset} exists={exists} />
      <div className="caption">{captionForVisual(scene.visual)}</div>
      <div className="subtitle" data-testid="player-subtitle">{scene.narration.text || "请输入 Narration"}</div>
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

function sceneAssetCopy(scene: Scene, asset: Asset | undefined) {
  if (scene.visual.type === "card") {
    return { primary: "不适用", secondary: "生成型画面" };
  }
  return {
    primary: asset?.path.split("/").at(-1) ?? "尚未绑定",
    secondary: asset ? "项目相对路径" : "需要 Asset",
  };
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
}: {
  title: string;
  description: string;
  onCancel: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = `dialog-${title.replace(/\s+/gu, "-")}`;
  const descriptionId = `${titleId}-description`;
  useEffect(() => {
    const preferred = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    const first = dialogRef.current?.querySelector<HTMLElement>("button, input, select, textarea");
    (preferred ?? first)?.focus();
  }, []);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <section ref={dialogRef} className="transaction-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={handleKeyDown} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div><button className="btn icon" type="button" aria-label="关闭" onClick={onCancel}><X /></button></header>
        <div className="transaction-dialog-body">{children}</div>
        {footer === undefined ? null : <footer>{footer}</footer>}
      </section>
    </div>
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
    <ModalFrame title="添加 Caption" description="Caption 是一段不分类用途的正文；提交前 Project DSL 保持不变。" onCancel={onCancel} footer={<><button className="btn" type="button" onClick={onCancel}>取消</button><button className="btn primary" type="button" disabled={text.trim() === ""} onClick={() => onAdd(text)}>添加 Caption</button></>}>
      <label>Caption 正文<textarea data-autofocus aria-label="Caption 正文" value={text} onChange={(event) => setText(event.target.value)} /></label>
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
    <ModalFrame title="填写 Card 内容" description="Card 至少需要标签、标题、正文或列表中的一项；提交前 Project DSL 保持不变。" onCancel={onCancel} footer={<><button className="btn" type="button" onClick={onCancel}>取消</button><button className="btn primary" type="button" disabled={!hasContent} onClick={create}>创建 Card</button></>}>
      <label>Card 标签<input data-autofocus aria-label="Card 标签" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <label>Card 标题<input aria-label="Card 标题" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Card 正文<textarea aria-label="Card 正文" value={body} onChange={(event) => setBody(event.target.value)} /></label>
      <label>Card 列表（每行一项）<textarea aria-label="Card 列表（每行一项）" value={itemsText} onChange={(event) => setItemsText(event.target.value)} /></label>
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

function textLayoutNeedsReview(visual: Visual): boolean {
  if (visual.type === "card") {
    const characterCount = [visual.label, visual.title, visual.body, ...(visual.items ?? [])]
      .filter((value): value is string => value !== undefined)
      .join("")
      .length;
    return characterCount > 180 || (visual.items?.length ?? 0) > 5;
  }
  return (visual.caption?.text.length ?? 0) > 100;
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
      <h3>Card</h3>
      <CommittedTextField label="Card 标签" value={visual.label ?? ""} onCommit={(value) => commitField("label", value)} />
      <CommittedTextField label="Card 标题" value={visual.title ?? ""} onCommit={(value) => commitField("title", value)} />
      <CommittedTextField label="Card 正文" value={visual.body ?? ""} multiline onCommit={(value) => commitField("body", value)} />
      <div className="bullet-heading"><strong>列表</strong><button className="btn compact" type="button" aria-label="添加列表项" onClick={() => setItemDrafts((items) => [...items, ""])}><Plus />添加</button></div>
      <div className="bullet-list">
        {itemDrafts.map((item, index) => (
          <div className="bullet-row" key={index}>
            <input aria-label={`列表项 ${index + 1}`} value={item} onChange={(event) => setItemDrafts((items) => items.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} onBlur={() => { if (commitItems(itemDrafts) === false) setItemDrafts(visual.items ?? []); }} />
            <div className="bullet-actions"><button className="btn icon" type="button" aria-label={`上移列表项 ${index + 1}`} disabled={index === 0} onClick={() => moveItem(index, -1)}><ArrowUp /></button><button className="btn icon" type="button" aria-label={`下移列表项 ${index + 1}`} disabled={index === itemDrafts.length - 1} onClick={() => moveItem(index, 1)}><ArrowDown /></button><button className="btn icon danger-button" type="button" aria-label={`删除列表项 ${index + 1}`} onClick={() => { const items = itemDrafts.filter((_, itemIndex) => itemIndex !== index); setItemDrafts(items); if (commitItems(items) === false) setItemDrafts(visual.items ?? []); }}><Trash /></button></div>
          </div>
        ))}
      </div>
      <div className="inspector-note neutral-note">Card 至少保留标签、标题、正文或列表中的一项。</div>
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
      <h3>Caption</h3>
      {hasCaption(visual) ? (
        <CommittedTextField label="Caption 正文" value={visual.caption.text} multiline onCommit={(text) => {
          if (text.trim() === "") {
            const { caption: _caption, ...next } = visual;
            onChange(next);
          } else {
            onChange({ ...visual, caption: { text } });
          }
        }} />
      ) : (
        <div className="inspector-note neutral-note"><span>当前 Visual 没有 Caption。</span><button className="btn compact" type="button" onClick={() => setAddingCaption(true)}><Plus />添加 Caption</button></div>
      )}
      <h3>Asset</h3>
      <div className="inspector-note neutral-note">此 Visual 使用现有 Asset 上下文；本票不扩展导入流程。</div>
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

function Workspace() {
  const project = useProjectStore((state) => state.project);
  const info = useProjectStore((state) => state.info);
  const selectedSceneId = useProjectStore((state) => state.selectedSceneId);
  const selectScene = useProjectStore((state) => state.selectScene);
  const updateNarration = useProjectStore((state) => state.updateNarration);
  const updateVisual = useProjectStore((state) => state.updateVisual);
  const reorderScene = useProjectStore((state) => state.reorderScene);
  const taskDrawerOpen = useProjectStore((state) => state.taskDrawerOpen);
  const setTaskDrawerOpen = useProjectStore((state) => state.setTaskDrawerOpen);
  const addScenesFromLines = useProjectStore((state) => state.addScenesFromLines);
  const mediaAvailability = useProjectStore((state) => state.mediaAvailability);
  const [playing, setPlaying] = useState(false);
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
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const selectedNarrationRef = useRef<HTMLTextAreaElement>(null);
  const singleSceneFocusPendingRef = useRef(false);
  const assets = useMemo(
    () => new Map(project?.assets.map((asset) => [asset.id, asset]) ?? []),
    [project?.assets],
  );
  const sceneCount = project?.scenes.length ?? 0;
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
  if (project === undefined) return null;

  const addSingleScene = () => {
    singleSceneFocusPendingRef.current = true;
    void addScenesFromLines([""]);
  };

  const selectedScene =
    project.scenes.find((scene) => scene.id === selectedSceneId) ?? project.scenes[0];
  const selectedAsset = selectedScene ? assetForScene(selectedScene, assets) : undefined;
  const selectedMediaExists =
    selectedAsset !== undefined && mediaAvailability[selectedAsset.path] === true;
  const projectName = project.metadata.name || info?.fallbackName || "未命名项目";

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
    if (sourceIndex !== targetIndex) void reorderScene(sceneId, targetIndex);
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
    return <EmptyWorkspace projectName={projectName} onAddScene={addSingleScene} />;
  }

  return (
    <div className="app-shell">
      <Topbar projectName={projectName} />
      <main className="workspace" data-testid="global-workbench">
        <section className="pane script-pane">
          <PaneHeading title="脚本表" meta={`${project.scenes.length} 个 Scene`} actions={<div className="filter"><button aria-pressed="true">全部</button><button aria-pressed="false">待修复</button></div>} />
          <div className="table-wrap" ref={tableScrollRef}>
            <table className="scene-table"><thead><tr><th>顺序</th><th>Narration</th><th>Visual Type</th><th>Asset</th><th>Speech</th><th>状态</th></tr></thead><tbody>
              {project.scenes.map((scene, index) => {
                const asset = assetForScene(scene, assets);
                const assetCopy = sceneAssetCopy(scene, asset);
                const assetStatus = sceneAssetStatus(scene, asset, mediaAvailability);
                const selected = scene.id === selectedScene?.id;
                const narrationPopoverId = `narration-popover-${scene.id}`;
                const expandedNarrationId = `narration-expanded-${scene.id}`;
                return (
                  <tr key={scene.id} className={`${selected ? "selected" : ""} ${dropTargetIndex === index ? "drop-target" : ""}`} data-testid="scene-row" data-scene-id={scene.id} onPointerDownCapture={() => selectScene(scene.id)} onClick={() => selectScene(scene.id)} onDragOver={(event) => { if (draggedSceneId === undefined) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTargetIndex(index); }} onDrop={(event) => { event.preventDefault(); const sceneId = draggedSceneId ?? event.dataTransfer.getData("text/plain"); setDraggedSceneId(undefined); setDropTargetIndex(undefined); if (sceneId !== "") commitReorder(sceneId, index); }}>
                    <td><div className="order-cell"><button className="reorder-handle" type="button" draggable data-reorder-handle={scene.id} aria-label={`重排 Scene ${index + 1}`} aria-pressed={keyboardReorder?.sceneId === scene.id} onClick={(event) => event.stopPropagation()} onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => { setDraggedSceneId(scene.id); setDropTargetIndex(index); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", scene.id); }} onDragEnd={() => { setDraggedSceneId(undefined); setDropTargetIndex(undefined); }} onKeyDown={(event) => handleReorderKeyDown(event, scene, index)}><DotsSixVertical weight="bold" /></button><span className="scene-number">{String(index + 1).padStart(2, "0")}</span></div></td>
                    <td><div className="narration-cell">
                      <textarea ref={selected ? selectedNarrationRef : undefined} className="narration" aria-label={`Scene ${index + 1} Narration`} value={scene.narration.text} onClick={(event) => event.stopPropagation()} onChange={(event) => updateNarration(scene.id, event.target.value)} />
                      <button className="narration-expand" type="button" aria-label={`扩大编辑 Scene ${index + 1} Narration`} onClick={(event) => { event.stopPropagation(); openNarrationPopover(narrationPopoverId, expandedNarrationId); }}><ArrowsOutSimple /></button>
                      <section id={narrationPopoverId} className="narration-popover" popover="auto" role="dialog" aria-label={`扩大编辑 Scene ${index + 1} Narration`} onClick={(event) => event.stopPropagation()}>
                        <header><div><p className="eyebrow">Scene {String(index + 1).padStart(2, "0")}</p><h2>扩大编辑 Narration</h2></div><button className="btn icon" type="button" aria-label="关闭扩大编辑" onClick={() => closeNarrationPopover(narrationPopoverId)}><X /></button></header>
                        <textarea id={expandedNarrationId} aria-label={`Scene ${index + 1} Narration 扩大编辑`} value={scene.narration.text} onChange={(event) => updateNarration(scene.id, event.target.value)} />
                        <small>内容会直接写回当前 Scene</small>
                      </section>
                    </div></td>
                    <td><div className="table-cell visual-type-cell"><select aria-label={`Scene ${index + 1} Visual Type`} value={scene.visual.type} onClick={(event) => event.stopPropagation()} onChange={(event) => requestVisualChange(scene, event.target.value as VisualType, event.currentTarget)}>{(Object.keys(visualLabels) as VisualType[]).map((type) => <option key={type} value={type}>{visualLabels[type]}</option>)}</select><span>{captionForVisual(scene.visual) ?? (scene.visual.type === "card" ? "结构化文字画面" : "标准画面")}</span></div></td>
                    <td><div className="table-cell"><strong>{assetCopy.primary}</strong><span>{assetCopy.secondary}</span></div></td>
                    <td><div className="table-cell"><strong>{scene.speech ? "已生成" : "缺少 Speech"}</strong><span>{scene.speech ? `${(scene.speech.durationMs / 1000).toFixed(1)} 秒` : "使用 Draft Duration"}</span></div></td>
                    <td><span className={assetStatus.className}>{assetStatus.label}</span></td>
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
          <PaneHeading title="Player" meta={selectedScene ? `选中 Scene ${String(project.scenes.indexOf(selectedScene) + 1).padStart(2, "0")}` : "未选择 Scene"} actions={<button className="btn compact">适合画面</button>} />
          <div className="stage"><div className="preview-frame">
            {selectedScene ? <PlayerVisual scene={selectedScene} asset={selectedAsset} exists={selectedMediaExists} /> : null}
          </div></div>
          <div className="player-controls"><button className="play-button" aria-label={playing ? "暂停" : "播放"} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button><span className="timecode">00:00 / --:--</span><div className="scrubber"><span /></div></div>
        </section>

        <section className="pane inspector-pane">
          <PaneHeading title="Inspector" meta={selectedScene ? visualLabels[selectedScene.visual.type] : "未选择 Scene"} />
          <div className="inspector-scroll" data-testid="inspector-scene">
            {selectedScene ? <><h3>Scene {String(project.scenes.indexOf(selectedScene) + 1).padStart(2, "0")}</h3><label>Narration<textarea value={selectedScene.narration.text} onChange={(event) => updateNarration(selectedScene.id, event.target.value)} /></label><VisualFields visual={selectedScene.visual} onChange={(visual) => void updateVisual(selectedScene.id, visual)} />{textLayoutNeedsReview(selectedScene.visual) ? <div className="inspector-note"><WarningCircle weight="fill" /><span>文字较多，可能超出成片安全版面；请在 Player 中检查，是否调整由作者决定。</span></div> : null}<label>项目相对路径<input value={selectedAsset?.path ?? "未绑定"} readOnly /></label><div className="inspector-note"><WarningCircle weight="fill" />缺少 Speech 时使用 Draft Duration；最终渲染前仍需补齐。</div></> : null}
          </div>
        </section>
      </main>
      <aside className={`task-drawer ${taskDrawerOpen ? "open" : ""}`} aria-hidden={!taskDrawerOpen}><header><h2>任务</h2><button className="btn icon" aria-label="关闭任务抽屉" onClick={() => setTaskDrawerOpen(false)}><X /></button></header><div className="task-empty"><ListChecks size={48} /><strong>暂无运行中的任务</strong><span>转码、Speech 与渲染任务会显示在这里。</span></div></aside>
      {batchDialogOpen ? <BatchCreateDialog existingSceneCount={project.scenes.length} onClose={() => setBatchDialogOpen(false)} onCreate={async (lines, visualType) => { await addScenesFromLines(lines, visualType); setBatchDialogOpen(false); }} /> : null}
      {cardChoice ? <CardContentDialog onCancel={() => { const trigger = cardChoice.trigger; setCardChoice(undefined); restoreVisualTrigger(trigger); }} onCreate={(card) => { const choice = cardChoice; setCardChoice(undefined); stageVisualMigration(choice.sceneId, "card", choice.trigger, card); }} /> : null}
      {pendingVisualChange ? <VisualLossDialog losses={pendingVisualChange.losses} onCancel={() => { const trigger = pendingVisualChange.trigger; setPendingVisualChange(undefined); restoreVisualTrigger(trigger); }} onConfirm={() => { const change = pendingVisualChange; setPendingVisualChange(undefined); void updateVisual(change.sceneId, change.visual); restoreVisualTrigger(change.trigger); }} /> : null}
    </div>
  );
}

function EmptyWorkspace({ projectName, onAddScene }: { projectName: string; onAddScene: () => void }) {
  const addScenesFromLines = useProjectStore((state) => state.addScenesFromLines);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);

  return (
    <div className="app-shell"><Topbar projectName={projectName} controlsDisabled /><main className="workspace">
      <section className="pane script-pane empty-script"><PaneHeading title="脚本表" meta="0 个 Scene" actions={<button className="btn compact" onClick={() => setBatchDialogOpen(true)}>新建 Scene</button>} /><div className="empty-state"><span className="first-scene-badge">01</span><h1>从第一句讲解开始</h1><p>粘贴逐行 Narration，我们只按换行拆分，并在真正写入项目之前让你整理完整结果。</p><div className="empty-actions"><button className="btn primary" onClick={() => setBatchDialogOpen(true)}><Plus />粘贴多行 Narration</button><button className="btn" onClick={onAddScene}>新增一条</button></div><small>空白行会被忽略并计数 · Scene 数量不限</small></div></section>
      <section className="pane player-pane"><PaneHeading title="Player" meta="无 Scene" /><div className="stage"><div className="preview-frame empty-preview"><strong>暂无可预览内容</strong><span>创建 Scene 后，这里会显示画面与可储存的字幕层。</span></div></div><div className="player-controls"><button className="play-button" aria-label="播放" disabled><Play weight="fill" /></button><span className="timecode">00:00 / 00:00</span><div className="scrubber"><span /></div></div></section>
      <section className="pane inspector-pane"><PaneHeading title="Inspector" meta="项目" /><div className="inspector-scroll"><h3>Project DSL</h3><div className="readonly-note neutral-note"><span><strong>结构有效</strong><br />scenes[] 为空。草稿操作不会写入项目。</span></div><h3 className="project-dsl-heading">创建规则</h3><div className="readonly-note neutral-note">Narration 只按换行拆分；非空行保留原始空格与 Unicode。至少创建一个 Scene 后才离开空状态。</div></div></section>
    </main>
      {batchDialogOpen ? <BatchCreateDialog existingSceneCount={0} onClose={() => setBatchDialogOpen(false)} onCreate={async (lines, visualType) => { await addScenesFromLines(lines, visualType); setBatchDialogOpen(false); }} /> : null}
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

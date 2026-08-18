import { WarningCircle } from "@phosphor-icons/react/WarningCircle";

import {
  DEFAULT_PROJECT_THEME,
  FONT_PRESETS,
  resolveTextPresentation,
  TEXT_MOTION_PRESETS,
  TEXT_STYLE_PRESETS,
  type Asset,
  type Diagnostic,
  type Project,
  type Visual,
} from "../shared/project";

type PresetSelectorProps = {
  kind: "style" | "motion";
  label: string;
  value: string | undefined;
  inheritedId?: string;
  onChange: (value: string | undefined) => void;
};

function PresetSelector({ kind, label, value, inheritedId, onChange }: PresetSelectorProps) {
  const presets = kind === "style" ? TEXT_STYLE_PRESETS : TEXT_MOTION_PRESETS;
  const activeId = value ?? inheritedId;
  const unknown = activeId !== undefined && !presets.some((preset) => preset.id === activeId);
  return (
    <fieldset className={`preset-fieldset ${kind}`}>
      <legend>{label}</legend>
      {inheritedId === undefined ? null : (
        <button
          type="button"
          className={`inherit-option ${value === undefined ? "selected" : ""}`}
          aria-pressed={value === undefined}
          onClick={() => onChange(undefined)}
        >
          <span>跟随项目</span>
          <small>当前使用 {inheritedId}</small>
        </button>
      )}
      {unknown ? (
        <div className="preset-missing" role="alert">
          <WarningCircle weight="fill" />
          <span><strong>预设不可用</strong><code>{activeId}</code></span>
          <button type="button" className="btn compact" onClick={() => onChange(inheritedId === undefined ? presets[0].id : undefined)}>
            {inheritedId === undefined ? "更换为首个内置预设" : "恢复项目默认"}
          </button>
        </div>
      ) : null}
      <div className="preset-options">
        {presets.map((preset) => {
          const selected = value === preset.id;
          return (
            <button
              type="button"
              key={preset.id}
              className={`preset-option ${selected ? "selected" : ""}`}
              aria-pressed={selected}
              aria-label={`${label}：${preset.name}`}
              onClick={() => onChange(preset.id)}
            >
              {kind === "style" ? (
                <span className={`style-swatch ${preset.id.split("/").at(-1)?.split("@")[0]}`} aria-hidden="true">
                  <i>中立标签</i><b>主要文字</b><em>正文与列表</em>
                </span>
              ) : <span className="motion-mark" aria-hidden="true" />}
              <span className="preset-copy"><strong>{preset.name}</strong><code>{preset.id}</code></span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function diagnosticsForPrefix(diagnostics: Diagnostic[], prefix: Array<string | number>) {
  return diagnostics.filter((diagnostic) =>
    prefix.every((segment, index) => diagnostic.path[index] === segment),
  );
}

function DiagnosticList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="field-diagnostics">
      {diagnostics.map((diagnostic) => (
        <div key={`${diagnostic.code}-${diagnostic.path.join(".")}`} className={diagnostic.severity}>
          <WarningCircle weight="fill" />
          <span><strong>{diagnostic.severity === "error" ? "阻断渲染" : "请检查"}</strong>{diagnostic.message}</span>
        </div>
      ))}
    </div>
  );
}

export function ProjectThemeInspector({
  project,
  diagnostics,
  onChange,
}: {
  project: Project;
  diagnostics: Diagnostic[];
  onChange: (theme: Project["theme"]) => void;
}) {
  const theme = project.theme;
  const imageAssets = project.assets.filter((asset) => asset.kind === "image");
  const logo = project.assets.find((asset) => asset.id === theme.logoAssetId);
  const themeMissing = theme.presetId !== DEFAULT_PROJECT_THEME.presetId;
  return (
    <>
      <div className="theme-identity">
        <span>项目主题</span>
        <strong>{themeMissing ? "主题不可用" : "Narracut 默认主题"}</strong>
        <code>{theme.presetId}</code>
        {themeMissing ? (
          <button
            type="button"
            className="btn compact"
            onClick={() => onChange({ ...theme, presetId: DEFAULT_PROJECT_THEME.presetId })}
          >
            恢复内置主题
          </button>
        ) : null}
      </div>
      <h3>默认文字</h3>
      <PresetSelector
        kind="style"
        label="项目默认文字样式"
        value={theme.defaultTextStyleId}
        onChange={(defaultTextStyleId) => onChange({ ...theme, defaultTextStyleId: defaultTextStyleId ?? DEFAULT_PROJECT_THEME.defaultTextStyleId })}
      />
      <PresetSelector
        kind="motion"
        label="项目默认入场动画"
        value={theme.defaultTextMotionId}
        onChange={(defaultTextMotionId) => onChange({ ...theme, defaultTextMotionId: defaultTextMotionId ?? DEFAULT_PROJECT_THEME.defaultTextMotionId })}
      />
      <h3>品牌</h3>
      <label>品牌强调色
        <span className="color-control">
          <input
            type="color"
            aria-label="品牌强调色"
            value={theme.accentColor.toLowerCase()}
            onChange={(event) => onChange({ ...theme, accentColor: event.target.value.toUpperCase() })}
          />
          <code>{theme.accentColor}</code>
        </span>
      </label>
      <label>渲染字体
        <select
          aria-label="渲染字体"
          value={theme.fontId}
          onChange={(event) => onChange({ ...theme, fontId: event.target.value })}
        >
          {!FONT_PRESETS.some((font) => font.id === theme.fontId) ? <option value={theme.fontId}>{theme.fontId}（不可用）</option> : null}
          {FONT_PRESETS.map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}
        </select>
      </label>
      <label>项目标志
        <select
          aria-label="项目标志"
          value={theme.logoAssetId ?? ""}
          onChange={(event) => {
            const next = { ...theme };
            if (event.target.value === "") delete next.logoAssetId;
            else next.logoAssetId = event.target.value;
            onChange(next);
          }}
        >
          <option value="">不使用标志</option>
          {logo !== undefined && !imageAssets.some((asset) => asset.id === logo.id) ? <option value={logo.id}>{logo.path}（不可用）</option> : null}
          {imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.path}</option>)}
        </select>
      </label>
      {logo?.kind === "image" ? (
        <div className="logo-preview"><img src={`/media/${logo.path}`} alt="当前项目标志缩略图" /><code>{logo.path}</code></div>
      ) : null}
      <DiagnosticList diagnostics={diagnosticsForPrefix(diagnostics, ["theme"])} />
    </>
  );
}

function overridesForVisual(visual: Visual) {
  return visual.type === "card" ? visual : visual.caption;
}

function withOverride(
  visual: Visual,
  field: "textStyleId" | "textMotionId",
  value: string | undefined,
): Visual {
  if (visual.type === "card") {
    const next = { ...visual };
    if (value === undefined) delete next[field];
    else next[field] = value;
    return next;
  }
  if (visual.caption === undefined) return visual;
  const caption = { ...visual.caption };
  if (value === undefined) delete caption[field];
  else caption[field] = value;
  return { ...visual, caption };
}

export function SceneTextPresentationInspector({
  sceneIndex,
  visual,
  theme,
  diagnostics,
  onChange,
  onMotionChange,
}: {
  sceneIndex: number;
  visual: Visual;
  theme: Project["theme"];
  diagnostics: Diagnostic[];
  onChange: (visual: Visual) => void;
  onMotionChange: (visual: Visual) => void;
}) {
  const overrides = overridesForVisual(visual);
  if (overrides === undefined) return null;
  const resolved = resolveTextPresentation(theme, overrides);
  const hasOverride = overrides.textStyleId !== undefined || overrides.textMotionId !== undefined;
  return (
    <>
      <h3>文字表现</h3>
      <div className="resolution-status">
        <span>{hasOverride ? "当前场景单独设置" : "继承项目默认"}</span>
        <code>{resolved.styleId} · {resolved.motionId}</code>
        {hasOverride ? (
          <button type="button" className="btn compact" onClick={() => onChange(withOverride(withOverride(visual, "textStyleId", undefined), "textMotionId", undefined))}>
            恢复项目默认
          </button>
        ) : null}
      </div>
      <PresetSelector
        kind="style"
        label="场景文字样式"
        value={overrides.textStyleId}
        inheritedId={theme.defaultTextStyleId}
        onChange={(value) => onChange(withOverride(visual, "textStyleId", value))}
      />
      <PresetSelector
        kind="motion"
        label="场景入场动画"
        value={overrides.textMotionId}
        inheritedId={theme.defaultTextMotionId}
        onChange={(value) => onMotionChange(withOverride(visual, "textMotionId", value))}
      />
      <DiagnosticList diagnostics={diagnosticsForPrefix(diagnostics, ["scenes", sceneIndex, "visual"])} />
    </>
  );
}

export function assetForLogo(theme: Project["theme"], assets: Asset[]) {
  return assets.find((asset) => asset.id === theme.logoAssetId);
}

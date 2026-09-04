(() => {
  const app = document.getElementById("app");
  const ROW_HEIGHT = 112;
  const WINDOW_SIZE = 18;
  const HISTORY_BYTE_LIMIT = 24 * 1024 * 1024;
  const pending = new Map();
  let rpcId = 10;
  let pollTimer = null;
  let pollFailures = 0;
  let saveTimer = null;
  let activeSavePromise = null;
  let briefSaveTimer = null;
  let activeBriefSavePromise = null;
  let assetPreviewRequest = 0;
  let speechPollTimer = null;

  const state = {
    result: null,
    project: null,
    baselineRevision: null,
    version: 0,
    savedVersion: 0,
    saveStatus: "saved",
    saveError: null,
    autosaveStopped: false,
    saveInFlight: false,
    workspace: "table",
    selected: null,
    start: 0,
    inspectionOpen: false,
    inspectorMode: "project",
    assetSearch: "",
    assetBusy: false,
    assetImportResults: [],
    assetPreview: null,
    previewReturnAssetId: null,
    editing: null,
    editGroupOpen: false,
    expanded: null,
    undo: [],
    redo: [],
    toast: null,
    focusTarget: null,
    dragged: null,
    operationMessage: null,
    hostValidation: null,
    agentBusy: false,
    agentError: null,
    speechJobs: {},
    ttsForm: null,
    ttsApiKey: "",
    ttsClearCredential: false,
    ttsSaving: false,
    ttsError: null,
    ttsBlockedReason: null,
    ttsPendingConfirm: null,
    brief: {
      open: false,
      base: "",
      local: "",
      baselineRevision: null,
      version: 0,
      savedVersion: 0,
      status: "saved",
      error: null,
      saveInFlight: false,
      editGroupOpen: false,
      undo: [],
      redo: [],
      historyBytes: 0,
      conflict: null,
      conflictTab: "base",
      merge: "",
      exporting: false,
      exportMessage: null,
    },
    launcher: {
      parentDirectory: "",
      projectName: "",
      busy: false,
      stage: "ready",
      error: null,
    },
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const pad = (value) => String(value).padStart(2, "0");
  const count = (value) => new Intl.NumberFormat("en-US").format(value);
  const clone = (value) => structuredClone(value);
  function createUuid() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function rail(result) {
    const project = result?.project ?? {};
    const connected = result?.connection?.status === "connected";
    return `<header class="project-rail">
      <div class="brand">Narracut</div>
      <div class="folder"><span class="folder-mark" aria-hidden="true"></span><span>${escapeHtml(project.folderName ?? "等待项目")}</span></div>
      <div class="project-id"><strong>PROJECT ID</strong><span>${escapeHtml(project.projectId ?? "—")}</span></div>
      <div class="connection"><span class="lamp" data-status="${connected ? "connected" : "loading"}" aria-hidden="true"></span><span>${connected ? "连接正常" : "连接中"}</span></div>
    </header>`;
  }

  function tabs() {
    return `<nav class="tabs" role="tablist" aria-label="Narracut 工作区">
      <button class="tab" type="button" role="tab" data-workspace="table" aria-selected="${state.workspace === "table"}">表格工作区</button>
      <button class="tab" type="button" role="tab" data-workspace="agent" aria-selected="${state.workspace === "agent"}">Agent 工作区</button>
      <button class="inspection-toggle" type="button" data-open-inspection aria-expanded="${state.inspectionOpen}">打开项目检查</button>
    </nav>`;
  }

  function composer() {
    const reason = state.workspace === "agent"
      ? "完整创作指令将在后续功能中启用"
      : "Composer 不编辑 Scene，请使用接触表";
    return `<footer class="composer">
      <div class="composer-label">Composer</div>
      <div class="composer-field">
        <input aria-label="Composer" aria-describedby="composer-disabled-reason" type="text" disabled>
        <span class="composer-placeholder">Composer 将在后续功能中启用</span>
        <div class="composer-reason" id="composer-disabled-reason">${reason}</div>
      </div>
      <div class="lock" aria-hidden="true"><span class="lock-shape"></span></div>
    </footer>`;
  }

  function launcherRail() {
    return `<header class="launch-rail"><div class="brand">Narracut</div><div class="launch-title">项目启动台</div><div class="launch-connection"><span class="lamp" aria-hidden="true"></span><span>连接正常</span></div></header>`;
  }

  function validProjectName() {
    const name = state.launcher.projectName;
    return name.length > 0 && name === name.trim() && name !== "." && name !== ".." &&
      !/[\\/\x00-\x1f\x7f]/u.test(name) && new TextEncoder().encode(name).length <= 255;
  }

  function finalProjectPath() {
    const parent = state.launcher.parentDirectory;
    if (!parent || !validProjectName()) return "";
    const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
    return `${parent.replace(/[\\/]+$/u, "")}${separator}${state.launcher.projectName}`;
  }

  function launcherVerdict() {
    if (!state.launcher.parentDirectory) return { valid: false, copy: "先通过系统窗口选择父目录" };
    if (!state.launcher.projectName) return { valid: false, copy: "填写新的项目文件夹名" };
    if (!validProjectName()) return { valid: false, copy: "文件夹名不能包含路径分隔符、控制字符或首尾空格" };
    return { valid: true, copy: "路径可用 · 目标文件夹必须不存在" };
  }

  function launcherError() {
    const error = state.launcher.error;
    if (!error) return "";
    const residue = error.code === "PROJECT_TEMPORARY_RESIDUE";
    return `<div class="launch-error" role="status"><strong>${escapeHtml(error.code ?? "PROJECT_OPERATION_FAILED")}</strong><span>${escapeHtml(error.message ?? "项目操作失败，请核对路径后重试。")}</span>${error.path ? `<div>${escapeHtml(error.path)}</div>` : ""}${residue ? '<button type="button" class="launch-button residue-action" data-confirm-residue>确认清理并从头重试</button>' : ""}</div>`;
  }

  function launcher() {
    const finalPath = finalProjectPath();
    const verdict = launcherVerdict();
    const busy = state.launcher.busy;
    return `<main class="launcher-main">
      <section class="launch-frame" aria-label="原子发布检查台"><div class="launch-ticket">
        <section class="launch-step"><div class="step-index" aria-hidden="true">01</div><div class="step-copy"><h2>选择父目录</h2><div class="field-row"><div class="path-field" data-parent-path data-empty="${!state.launcher.parentDirectory}">${escapeHtml(state.launcher.parentDirectory || "尚未选择父目录")}</div><button class="launch-button" type="button" data-pick-parent ${busy ? "disabled" : ""}>选择父文件夹</button></div></div></section>
        <section class="launch-step"><div class="step-index" aria-hidden="true">02</div><div class="step-copy"><h2>项目文件夹名</h2><input class="name-field" aria-label="项目文件夹名" value="${escapeHtml(state.launcher.projectName)}" placeholder="例如：海边采访" ${busy ? "disabled" : ""}></div></section>
        <section class="launch-step"><div class="step-index" aria-hidden="true">03</div><div class="step-copy"><h2>核对最终项目路径</h2><code class="final-path" data-final-path title="${escapeHtml(finalPath)}">${escapeHtml(finalPath || "选择位置并填写名称后显示")}</code><p class="path-verdict" data-path-verdict data-valid="${verdict.valid}">${escapeHtml(verdict.copy)}</p>${launcherError()}</div></section>
        <section class="launch-step"><div class="step-index" aria-hidden="true">04</div><div class="step-copy"><h2>将创建</h2><div class="create-grid"><ul class="creation-list"><li><span class="file-glyph" aria-hidden="true"></span><span>narracut.json · 严格项目清单</span></li><li><span class="file-glyph" aria-hidden="true"></span><span>project.json · 空 Project DSL</span></li><li><span class="file-glyph" aria-hidden="true"></span><span>零字节 video.md</span></li><li><span class="file-glyph" aria-hidden="true"></span><span>starter 当前 Render Program 修订</span></li><li><span class="file-glyph" aria-hidden="true"></span><span>pnpm-lock.yaml · 精确依赖</span></li></ul><button class="create-action" type="button" data-create-project ${!verdict.valid || busy ? "disabled" : ""}>${busy ? "正在原子创建…" : "原子创建并打开"}</button></div></div></section>
      </div></section>
      <aside class="launch-side" aria-label="其他入口"><h2>其他入口</h2><div class="side-actions"><section class="side-entry"><span class="side-folder" aria-hidden="true"></span><div><h3>打开项目</h3><p>严格校验已有 Project VNext</p></div><button class="side-button" type="button" data-open-project ${busy ? "disabled" : ""}>选择项目文件夹</button></section><section class="side-entry" data-disabled="true"><span class="side-folder" aria-hidden="true"></span><div><h3>从恢复快照创建</h3><p>此入口将在恢复流程可用后启用</p></div><button class="side-button" type="button" disabled>从恢复快照创建</button></section></div></aside>
    </main>`;
  }

  function launcherFooter() {
    const busy = state.launcher.busy;
    return `<footer class="launch-footer"><strong>本地文件系统</strong><span class="footer-rule" aria-hidden="true"></span><span>${busy ? `<span class="launch-busy">${state.launcher.stage === "opening" ? "正在严格校验并取得租约" : "正在写入、复核并原子发布"}</span>` : "准备就绪 · 创建过程不联网、不安装依赖"}</span><span class="footer-status" aria-hidden="true"></span></footer>`;
  }

  function checks(result) {
    return Object.values(result.checks ?? {}).map((check) => `<div class="check"><span class="check-mark" aria-hidden="true"></span><span>${escapeHtml(check.label)}</span><span class="check-state">有效</span></div>`).join("");
  }

  function currentScenes() {
    return state.project?.scenes ?? [];
  }

  function selectedScene() {
    return currentScenes().find((scene) => scene.id === state.selected) ?? currentScenes()[0] ?? null;
  }

  function assetsFor(scene) {
    const assets = new Map((state.project?.assets ?? []).map((asset) => [asset.id, asset]));
    return scene.assetIds.map((id) => ({ id, path: assets.get(id)?.path ?? null }));
  }

  function assetFilename(path) {
    return path?.split("/").at(-1) ?? null;
  }

  function assetRuntime(assetId) {
    return (state.result?.assetStates ?? []).find((item) => item.id === assetId) ?? null;
  }

  function assetSummary(scene) {
    const assets = assetsFor(scene);
    const abnormal = assets.some((asset) => asset.path === null || assetRuntime(asset.id)?.status === "unavailable");
    let text;
    if (assets.length === 0) text = "未绑定 · 添加";
    else if (assets.length === 1) text = assetFilename(assets[0].path) ?? `悬空 ${assets[0].id.slice(0, 8)}`;
    else text = `${assets.length} 个 Asset · ${assetFilename(assets[0].path) ?? assets[0].id.slice(0, 8)} +${assets.length - 1}`;
    return { text, abnormal };
  }

  function speechRuntime(scene) {
    return (state.result?.speechStates ?? []).find((item) => item.sceneId === scene.id)
      ?? state.result?.scenes?.find((item) => item.id === scene.id)?.speech
      ?? (scene.speech ? { sceneId: scene.id, status: "available", durationMs: scene.speech.durationMs } : { sceneId: scene.id, status: "missing" });
  }

  function sceneTimeWindow(scene) {
    return (state.result?.timeline?.scenes ?? []).find((item) => item.sceneId === scene.id)
      ?? state.result?.scenes?.find((item) => item.id === scene.id)?.time
      ?? null;
  }

  function seconds(durationMs) {
    if (!Number.isFinite(durationMs)) return "—";
    return `${(durationMs / 1000).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "")} 秒`;
  }

  function initializeTtsForm(tts = state.result?.tts) {
    const capabilities = tts?.capabilities ?? {};
    const config = tts?.config;
    state.ttsForm = config ? clone(config) : {
      provider: "tokendance",
      model: capabilities.models?.[0]?.value ?? "minimax-speech-2.8-turbo",
      voice: capabilities.voices?.[0]?.value ?? "Chinese (Mandarin)_News_Anchor",
      speed: 1,
      volume: 1,
      pitch: 0,
    };
  }

  function importStatusLabel(status) {
    return {
      copying: "正在复制",
      "imported-and-bound": "已导入并绑定",
      "imported-unbound": "已导入但未绑定",
      rejected: "已拒绝",
      failed: "导入失败",
    }[status] ?? status;
  }

  function briefStatusLabel() {
    const brief = state.brief;
    if (brief.status === "conflict") return "外部冲突";
    if (brief.status === "saving") return "保存中";
    if (brief.status === "dirty") return "有未保存修改";
    if (brief.status === "failed") return "保存失败";
    return brief.local.length === 0 ? "空白" : "已保存";
  }

  function briefEntryStatusLabel() {
    return `Brief ${briefStatusLabel()}`;
  }

  function projectInspector(result) {
    const scene = selectedScene();
    const writable = result.writable === true;
    const speech = scene ? speechRuntime(scene) : null;
    const time = scene ? sceneTimeWindow(scene) : null;
    const speechReady = speech?.status === "available";
    return `<aside class="inspection" aria-label="项目检查" data-open="${state.inspectionOpen}">
      <button type="button" class="inspection-close" data-close-inspection aria-label="关闭项目检查">关闭</button>
      <h2>项目检查</h2><div class="rule"></div><div class="checks">${checks(result)}</div>
      ${scene ? `<section class="selected"><div class="rule"></div><h3>Scene ${pad(currentScenes().indexOf(scene) + 1)}</h3><p class="selected-copy" data-testid="scene-narration-detail">${escapeHtml(scene.narration.text)}</p><dl class="facts"><div class="fact"><dt>Scene ID</dt><dd>${escapeHtml(scene.id)}</dd></div><div class="fact"><dt>Asset</dt><dd>${scene.assetIds.length}</dd></div><div class="fact"><dt>Speech</dt><dd>${speechReady ? `已生成 · ${seconds(speech.durationMs)}` : "Draft Duration"}</dd></div>${time ? `<div class="fact"><dt>Time Window</dt><dd>帧 ${time.startFrame}–${time.startFrame + time.durationInFrames}（不含 ${time.startFrame + time.durationInFrames}）</dd></div>` : ""}</dl><p class="render-readiness" data-ready="${speechReady}">${speechReady ? "可用于最终 Render" : "仅供草稿 Preview · 阻断最终 Render"}</p></section>` : ""}
      <div class="inspection-actions"><button class="inspection-action brief-entry" type="button" data-open-brief aria-label="Video Brief ${briefStatusLabel()}" ${writable ? "" : "disabled"}><span class="brief-entry-copy"><strong>Video Brief</strong><small>原始 Markdown · video.md</small></span><span data-brief-entry-state>${briefEntryStatusLabel()}</span></button>${writable ? `<button class="inspection-action" type="button" data-open-tts>TTS 配置 <span>${result.tts?.status === "configured" ? "已配置" : "待配置"}</span></button><button class="inspection-action" type="button" data-manage-project-assets>管理项目 Asset <span>${count(state.project?.assets.length ?? 0)}</span></button>` : ""}</div>
      <section class="readonly"><strong data-writable="${writable}">${writable ? "内容写入边界" : "只读"}</strong><p>${writable ? "表格工作区可以修改 Scene、Narration 与 Asset 引用；预览只检查 Asset 本体，不改变 Scene 或 Player。" : "当前项目只提供检查。Scene、Narration、Asset 和 Speech 不会在这里被修改。"}</p></section>
    </aside>`;
  }

  function ttsInspector(result) {
    if (!state.ttsForm) initializeTtsForm(result.tts);
    const tts = result.tts ?? {};
    const capabilities = tts.capabilities ?? {};
    const form = state.ttsForm;
    const credential = tts.credential ?? { status: "missing", storage: "session" };
    const range = (name, fallback) => capabilities.ranges?.[name] ?? fallback;
    const pending = state.ttsPendingConfirm;
    return `<aside class="inspection tts-inspection" aria-label="项目 TTS 配置" data-open="${state.inspectionOpen}">
      <button type="button" class="inspection-close" data-close-inspection aria-label="关闭项目 TTS 配置">关闭</button>
      <button type="button" class="inspection-back" data-project-inspection>返回项目检查</button>
      <h2>项目 TTS 配置</h2><p class="tts-kicker">TokenDance · 项目级输出契约</p><div class="rule"></div>
      ${state.ttsBlockedReason ? `<div class="tts-blocked" role="status"><strong>生成前需要配置</strong><span>${escapeHtml(state.ttsBlockedReason)}</span></div>` : ""}
      <form class="tts-form" data-tts-form>
        <label><span>Provider</span><input value="TokenDance" disabled aria-label="TTS Provider"></label>
        <label><span>模型</span><select data-tts-field="model" aria-label="TTS 模型">${(capabilities.models ?? []).map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === form.model ? "selected" : ""}>${escapeHtml(item.label ?? item.value)}</option>`).join("")}</select></label>
        <label><span>声音</span><select data-tts-field="voice" aria-label="TTS 声音">${(capabilities.voices ?? []).map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === form.voice ? "selected" : ""}>${escapeHtml(item.label ?? item.value)}</option>`).join("")}</select></label>
        <div class="tts-number-grid">
          <label><span>语速</span><input type="number" data-tts-field="speed" aria-label="TTS 语速" min="${range("speed", { min: .5 }).min}" max="${range("speed", { max: 2 }).max}" step="0.1" value="${form.speed}"></label>
          <label><span>音量</span><input type="number" data-tts-field="volume" aria-label="TTS 音量" min="${range("volume", { min: .1 }).min}" max="${range("volume", { max: 10 }).max}" step="0.1" value="${form.volume}"></label>
          <label><span>音调</span><input type="number" data-tts-field="pitch" aria-label="TTS 音调" min="${range("pitch", { min: -12 }).min}" max="${range("pitch", { max: 12 }).max}" step="1" value="${form.pitch}"></label>
        </div>
        <div class="fixed-contract"><strong>固定音频规格</strong><span>MP3 · 32 kHz · 单声道</span><small>采样率、码率与声道不可在项目中覆盖。</small></div>
        <label class="credential-field"><span>TokenDance API Key</span><input type="password" data-tts-api-key aria-label="TokenDance API Key" value="${escapeHtml(state.ttsApiKey)}" autocomplete="off" placeholder="${credential.status === "available" && !state.ttsClearCredential ? credential.masked ?? "已在本次会话中设置" : "仅保存到本次会话"}"></label>
        <div class="credential-state"><span class="status-mark" data-status="${credential.status === "available" && !state.ttsClearCredential ? "connected" : "unavailable"}" aria-hidden="true"></span><span>${credential.status === "available" && !state.ttsClearCredential ? `API Key 已就绪 · ${escapeHtml(credential.masked ?? "已隐藏")}` : "API Key 缺失"}</span>${credential.status === "available" && !state.ttsClearCredential ? '<button type="button" data-clear-tts-key>清除会话凭据</button>' : ""}</div>
        <p class="session-warning">当前宿主未提供安全凭据库。API Key 只保留在本次应用会话，不写入项目、配置或日志。</p>
        ${state.ttsError ? `<div class="tts-error" role="alert">${escapeHtml(state.ttsError)}</div>` : ""}
        ${pending ? `<div class="tts-confirm" role="alertdialog" aria-label="确认更改 TTS 输出配置"><strong>将使 ${pending.affectedSpeechCount} 条 Speech 失效</strong><p>保存后会原子移除不再匹配的 Speech 记录；Scene、Narration 与 Asset 引用保持不变。</p><div><button type="button" data-confirm-tts>确认保存</button><button type="button" data-cancel-tts-confirm>取消</button></div></div>` : `<button class="tts-save" type="submit" ${state.ttsSaving ? "disabled" : ""}>${state.ttsSaving ? "正在保存…" : "保存 TTS 配置"}</button>`}
      </form>
    </aside>`;
  }

  function assetItem(assetId, index, scene) {
    const asset = state.project.assets.find((item) => item.id === assetId);
    if (!asset) {
      return `<li class="asset-item" data-status="dangling"><div class="asset-item-head"><span class="asset-warning" aria-hidden="true"></span><strong>悬空 Asset ID</strong></div><code>${escapeHtml(assetId)}</code><p>未找到登记的 Asset</p><div class="asset-controls"><button type="button" data-unlink-asset="${escapeHtml(assetId)}" aria-label="解除悬空 Asset ID 引用">解除引用</button></div></li>`;
    }
    const runtime = assetRuntime(asset.id);
    const unavailable = runtime?.status === "unavailable";
    const filename = assetFilename(asset.path);
    return `<li class="asset-item" data-status="${unavailable ? "unavailable" : "available"}">
      <div class="asset-item-head">${unavailable ? '<span class="asset-warning" aria-hidden="true"></span>' : ""}<strong>${escapeHtml(filename)}</strong><span>${unavailable ? "文件不可用" : "可用"}</span></div>
      <code>${escapeHtml(asset.path)}</code>${unavailable ? `<p>${escapeHtml(runtime.reason ?? "文件缺失或无法读取。")}</p>` : ""}
      <div class="asset-controls">
        <button type="button" data-preview-asset="${escapeHtml(asset.id)}" aria-label="预览 ${escapeHtml(filename)}" ${unavailable ? "disabled" : ""}>预览</button>
        <button type="button" data-move-asset="${escapeHtml(asset.id)}" data-direction="up" aria-label="将 ${escapeHtml(filename)} 上移" ${state.assetBusy || index === 0 ? "disabled" : ""}>上移</button>
        <button type="button" data-move-asset="${escapeHtml(asset.id)}" data-direction="down" aria-label="将 ${escapeHtml(filename)} 下移" ${state.assetBusy || index === scene.assetIds.length - 1 ? "disabled" : ""}>下移</button>
        <label><span class="sr-only">将 ${escapeHtml(filename)} 移动到位置</span><input type="number" min="1" max="${scene.assetIds.length}" value="${index + 1}" data-asset-position="${escapeHtml(asset.id)}" aria-label="将 ${escapeHtml(filename)} 移动到位置" ${state.assetBusy ? "disabled" : ""}></label>
        <button type="button" data-apply-asset-position="${escapeHtml(asset.id)}" ${state.assetBusy ? "disabled" : ""}>移动</button>
        <button type="button" data-unlink-asset="${escapeHtml(asset.id)}" aria-label="解除 ${escapeHtml(filename)} 引用" ${state.assetBusy ? "disabled" : ""}>解除引用</button>
      </div>
    </li>`;
  }

  function assetImportLedger() {
    if (state.assetImportResults.length === 0) return "";
    return `<ol class="import-ledger" aria-label="Asset 导入结果">${state.assetImportResults.map((item) => `<li data-status="${escapeHtml(item.status)}"><span class="status-mark" data-status="${item.status === "copying" ? "running" : item.status.startsWith("imported-") ? "connected" : "unavailable"}" aria-hidden="true"></span><div><strong>${escapeHtml(item.name)}</strong><span>${importStatusLabel(item.status)}</span>${item.message ? `<small>${escapeHtml(item.message)}</small>` : ""}</div></li>`).join("")}</ol>`;
  }

  function sceneAssetInspector(result) {
    const scene = selectedScene();
    if (!scene) {
      state.inspectorMode = "project";
      return projectInspector(result);
    }
    const sceneIndex = currentScenes().indexOf(scene) + 1;
    const atSceneLimit = scene.assetIds.length >= 256;
    const atProjectLimit = state.project.assets.length >= 1000;
    return `<aside class="inspection asset-inspection" aria-label="项目检查" data-open="${state.inspectionOpen}">
      <button type="button" class="inspection-close" data-close-inspection aria-label="关闭项目检查">关闭</button>
      <button type="button" class="inspection-back" data-project-inspection>返回项目检查</button>
      <h2>Scene ${pad(sceneIndex)} · Asset</h2><div class="rule"></div>
      <dl class="asset-panel-facts"><div><dt>Scene ID</dt><dd>${escapeHtml(scene.id.slice(0, 8))}…</dd></div><div><dt>引用</dt><dd>${scene.assetIds.length} / 256</dd></div></dl>
      <div class="asset-primary-actions"><button type="button" data-import-assets data-target-scene="${escapeHtml(scene.id)}" ${state.assetBusy || atProjectLimit || atSceneLimit || state.autosaveStopped ? "disabled" : ""}>${state.assetBusy ? "正在导入…" : "导入并绑定"}</button><button type="button" data-add-existing ${state.assetBusy || atSceneLimit || state.project.assets.length === 0 || state.autosaveStopped ? "disabled" : ""}>添加已有 Asset</button></div>
      ${atProjectLimit ? '<p class="capacity-note">项目已达到 1,000 个 Asset 上限。</p>' : atSceneLimit ? '<p class="capacity-note">当前 Scene 已达到 256 个 Asset 引用上限。</p>' : ""}
      ${assetImportLedger()}
      ${scene.assetIds.length === 0 ? '<div class="asset-empty"><strong>尚未绑定 Asset</strong><p>导入新文件，或从项目登记表添加已有 Asset。</p></div>' : `<ol class="asset-list">${scene.assetIds.map((id, index) => assetItem(id, index, scene)).join("")}</ol>`}
    </aside>`;
  }

  function assetPickerInspector(result, projectMode = false) {
    const scene = selectedScene();
    const referenced = new Set(scene?.assetIds ?? []);
    const query = state.assetSearch.trim().toLocaleLowerCase();
    const filtered = state.project.assets.filter((asset) => asset.path.toLocaleLowerCase().includes(query));
    const visible = filtered.slice(0, 100);
    return `<aside class="inspection asset-inspection" aria-label="项目检查" data-open="${state.inspectionOpen}">
      <button type="button" class="inspection-close" data-close-inspection aria-label="关闭项目检查">关闭</button>
      <button type="button" class="inspection-back" ${projectMode ? "data-project-inspection" : "data-scene-assets"}>${projectMode ? "返回项目检查" : "返回 Scene Asset"}</button>
      <h2>${projectMode ? "项目 Asset" : "添加已有 Asset"}</h2><div class="rule"></div>
      ${projectMode ? `<button type="button" class="project-import" data-import-assets ${state.assetBusy || state.project.assets.length >= 1000 || state.autosaveStopped ? "disabled" : ""}>${state.assetBusy ? "正在导入…" : "导入暂未绑定 Asset"}</button>${state.project.assets.length >= 1000 ? '<p class="capacity-note">项目已达到 1,000 个 Asset 上限，不能继续导入。</p>' : ""}${assetImportLedger()}` : ""}
      <label class="asset-search"><span>按项目相对路径搜索</span><input type="search" aria-label="搜索项目 Asset" value="${escapeHtml(state.assetSearch)}" placeholder="assets/…"></label>
      ${state.project.assets.length === 0 ? '<div class="asset-empty"><strong>项目中还没有 Asset</strong><p>先从系统文件选择窗口导入普通文件。</p></div>' : `<ul class="project-asset-list">${visible.map((asset) => {
        const runtime = assetRuntime(asset.id);
        const unavailable = runtime?.status === "unavailable";
        const inScene = referenced.has(asset.id);
        const filename = assetFilename(asset.path);
        const boundCount = currentScenes().filter((item) => item.assetIds.includes(asset.id)).length;
        return `<li data-status="${unavailable ? "unavailable" : "available"}"><div><strong>${escapeHtml(filename)}</strong><code>${escapeHtml(asset.path)}</code><span>${unavailable ? "文件不可用" : projectMode ? boundCount === 0 ? "暂未绑定" : `${boundCount} 个 Scene 引用` : inScene ? "已引用" : "可添加"}</span></div><div>${!projectMode ? `<button type="button" data-add-asset="${escapeHtml(asset.id)}" aria-label="添加 ${escapeHtml(filename)}" ${state.assetBusy || inScene || unavailable || (scene?.assetIds.length ?? 0) >= 256 ? "disabled" : ""}>${inScene ? "已引用" : "添加"}</button>` : ""}<button type="button" data-preview-asset="${escapeHtml(asset.id)}" aria-label="预览 ${escapeHtml(filename)}" ${unavailable ? "disabled" : ""}>预览</button></div></li>`;
      }).join("")}</ul>`}
      ${filtered.length > visible.length ? `<p class="capacity-note">仅显示前 ${visible.length} 项，请缩小搜索范围。</p>` : ""}
    </aside>`;
  }

  function inspector(result) {
    if (state.inspectorMode === "tts") return ttsInspector(result);
    if (state.inspectorMode === "scene-assets") return sceneAssetInspector(result);
    if (state.inspectorMode === "asset-picker") return assetPickerInspector(result, false);
    if (state.inspectorMode === "project-assets") return assetPickerInspector(result, true);
    return projectInspector(result);
  }

  function saveLabel() {
    return {
      saved: "已保存",
      dirty: "待保存",
      saving: "保存中",
      failed: "保存失败",
      conflict: "保存冲突",
      identity: "身份失效",
    }[state.saveStatus] ?? "已保存";
  }

  function actionButtons(inMenu = false) {
    const scene = selectedScene();
    const index = scene ? currentScenes().indexOf(scene) : -1;
    const disabled = !scene || state.autosaveStopped || state.assetBusy;
    return `<button class="scene-action" type="button" data-copy ${disabled || currentScenes().length >= 1000 ? "disabled" : ""}>复制</button>
      <button class="scene-action" type="button" data-move-up ${disabled || index <= 0 ? "disabled" : ""}>上移</button>
      <button class="scene-action" type="button" data-move-down ${disabled || index >= currentScenes().length - 1 ? "disabled" : ""}>下移</button>
      <label class="sr-only" for="${inMenu ? "scene-move-mobile" : "scene-move"}">移动到位置</label>
      <input id="${inMenu ? "scene-move-mobile" : "scene-move"}" class="move-field" type="number" min="1" max="${Math.max(1, currentScenes().length)}" value="${Math.max(1, index + 1)}" aria-label="移动到位置" ${disabled ? "disabled" : ""}>
      <button class="scene-action" type="button" data-move ${disabled ? "disabled" : ""}>移动</button>
      <button class="scene-action" type="button" data-delete ${disabled ? "disabled" : ""}>删除</button>`;
  }

  function toolbar() {
    const stopped = state.autosaveStopped || state.assetBusy;
    return `<div class="scene-toolbar" aria-label="Scene 操作轨">
      <div class="toolbar-primary"><button class="scene-action" data-primary="true" type="button" data-add ${currentScenes().length >= 1000 || stopped ? "disabled" : ""}>新增 Scene</button></div>
      <div class="toolbar-actions">${actionButtons()}</div>
      <div class="toolbar-history">
        <button class="scene-action" type="button" data-undo aria-label="Undo" ${state.undo.length === 0 || stopped ? "disabled" : ""}>Undo</button>
        <button class="scene-action" type="button" data-redo aria-label="Redo" ${state.redo.length === 0 || stopped ? "disabled" : ""}>Redo</button>
        <span class="save-state" data-save-state data-status="${state.saveStatus}">${saveLabel()}</span>
        ${state.saveStatus === "failed" ? '<span class="save-error"><button class="scene-action" type="button" data-retry>重试保存</button></span>' : ""}
        <details class="scene-menu"><summary class="scene-action">Scene 操作</summary><div class="scene-menu-panel">${actionButtons(true)}</div></details>
      </div>
    </div>`;
  }

  function speechPresentation(scene) {
    const runtime = speechRuntime(scene);
    const job = state.speechJobs[scene.id];
    if (job && !["succeeded", "cancelled", "failed", "rejected"].includes(job.status)) {
      return { label: job.stage, detail: job.pollError ? "状态读取中断 · 后台仍运行，正在重试" : "既有 Speech 在新结果提交前保持可用", mark: "running", action: "cancel" };
    }
    if (job && ["cancelled", "failed", "rejected"].includes(job.status)) {
      return { label: job.stage, detail: job.error?.message ?? "既有 Speech 保持不变", mark: "unavailable", action: "retry" };
    }
    if (runtime.status === "available") {
      return { label: "已生成", detail: seconds(runtime.durationMs), mark: "connected", action: "regenerate" };
    }
    const labels = {
      missing: "缺失",
      unavailable: "文件不可用",
      "decode-failed": "解码失败",
      changed: "音频已变更",
      "profile-mismatch": "配置已变更",
    };
    return {
      label: labels[runtime.status] ?? "缺失",
      detail: scene.narration.text.trim() === "" ? "空 Narration" : "Draft · 5 秒",
      mark: runtime.status === "missing" ? "idle" : "unavailable",
      action: "generate",
    };
  }

  function sceneRow(scene, index, editable = true) {
    const selected = scene.id === state.selected;
    const assets = assetsFor(scene);
    const summary = assetSummary(scene);
    const editing = state.editing === scene.id;
    const speech = speechPresentation(scene);
    const speechDisabled = state.autosaveStopped || state.assetBusy || scene.narration.text.trim() === "";
    const speechAction = speech.action === "cancel"
      ? `<button type="button" class="speech-action" data-cancel-speech aria-label="取消 Speech 生成" ${speechDisabled ? "disabled" : ""}>取消</button>`
      : `<button type="button" class="speech-action" data-speech-action aria-label="${speech.action === "regenerate" ? "重新生成 Speech" : speech.action === "retry" ? "重试生成 Speech" : "生成 Speech"}" ${speechDisabled ? "disabled" : ""}>${speech.action === "regenerate" ? "重新生成" : speech.action === "retry" ? "重试" : "生成"}</button>`;
    return `<div class="scene-row" role="group" draggable="false" data-scene-row data-scene-id="${escapeHtml(scene.id)}" data-selected="${selected}" aria-label="Scene ${pad(index + 1)} 行">
      <span class="scene-no">${editable ? `<button class="drag-handle" type="button" draggable="${!state.assetBusy}" aria-label="拖动第 ${index + 1} 行" ${state.assetBusy ? "disabled" : ""}><span aria-hidden="true"></span></button>` : ""}<button class="scene-select" type="button" aria-label="Scene ${pad(index + 1)}：${escapeHtml(scene.narration.text)}" aria-pressed="${selected}"><strong>${pad(index + 1)}</strong><small>${pad(index + 1)}A</small></button></span>
      <span class="scene-copy">${editable && editing ? `<span class="narration-editor-wrap"><textarea class="narration-editor" aria-label="Scene ${pad(index + 1)} Narration" data-narration-editor ${state.assetBusy ? "disabled" : ""}>${escapeHtml(scene.narration.text)}</textarea><button class="expand-editor" type="button" data-expand ${state.assetBusy ? "disabled" : ""}>展开编辑</button></span><small class="narration-help">修改 Narration 会立即移除原 Speech</small>` : `<span class="narration-view">${escapeHtml(scene.narration.text || "空 Narration")}</span>${editable ? `<button class="edit-narration" type="button" data-edit-narration ${state.assetBusy ? "disabled" : ""}>编辑 Narration</button>` : ""}`}</span>
      ${editable ? `<button class="scene-assets" type="button" data-open-scene-assets aria-label="第 ${pad(index + 1)} 个 Scene 的 Asset：${escapeHtml(summary.text)}"><span class="cell-label">Asset</span><span class="cell-value">${summary.abnormal ? '<span class="asset-warning" aria-hidden="true"></span>' : ""}${escapeHtml(summary.text)}</span><span class="cell-detail">${assets.length === 0 ? "管理引用" : `${assets.length} / 256`}</span></button>` : `<span class="scene-assets"><span class="cell-label">Asset</span><span class="cell-value">${summary.abnormal ? '<span class="asset-warning" aria-hidden="true"></span>' : ""}${escapeHtml(summary.text)}</span><span class="cell-detail">${assets.length === 0 ? "未绑定文件" : `${assets.length} / 256`}</span></span>`}
      <div class="scene-speech"><span class="cell-label">Speech</span><span class="cell-value ${speech.mark === "connected" ? "ready" : "missing"}"><span class="status-mark" data-status="${speech.mark}" aria-hidden="true"></span>${escapeHtml(speech.label)}</span><span class="cell-detail" title="${escapeHtml(speech.detail)}">${escapeHtml(speech.detail)}</span>${editable ? speechAction : ""}</div>
    </div>`;
  }

  function expandedEditor() {
    const scene = currentScenes().find((item) => item.id === state.expanded);
    if (!scene) return "";
    const index = currentScenes().indexOf(scene) + 1;
    return `<div class="expanded-editor" role="dialog" aria-modal="true" aria-labelledby="expanded-title"><section class="expanded-sheet"><h2 id="expanded-title">Scene ${pad(index)} Narration</h2><textarea aria-label="展开的 Narration" data-expanded-editor>${escapeHtml(scene.narration.text)}</textarea><p>修改 Narration 会立即移除原 Speech；关闭后进入自动保存队列。</p><div class="expanded-actions"><button class="scene-action" type="button" data-close-expanded>完成</button></div></section></div>`;
  }

  function table(result) {
    const editable = result.writable === true && state.project !== null;
    if (!editable) {
      const scenes = state.project?.scenes ?? [];
      if (!scenes.length) return `<main class="stage"><section class="state-panel"><div class="state-copy"><h1 tabindex="-1" data-empty-title>项目中还没有 Scene</h1><p>项目有效，可继续只读检查。</p><div class="state-code">0 SCENES · PROJECT VNEXT</div></div></section></main>`;
      const start = Math.max(0, Math.min(state.start, Math.max(0, scenes.length - WINDOW_SIZE)));
      const rows = scenes.slice(start, start + WINDOW_SIZE).map((scene, offset) => sceneRow(scene, start + offset, false)).join("");
      return `<main class="stage"><section class="contact-frame" aria-label="Scene 只读接触印样">
        <div class="film-edge"><span>NCUT · ${escapeHtml(result.project.projectId.slice(0, 13))}</span><span>CONTACT SHEET</span><span>${count(scenes.length)} SCENES</span></div>
        <div class="contact-sheet"><div class="scene-header"><span>Scene</span><span>Narration</span><span>Asset</span><span>Speech</span></div><div class="scene-scroll" tabindex="0" aria-label="Scene 列表"><div class="scene-spacer" style="height:${scenes.length * ROW_HEIGHT}px"><div class="scene-window" style="transform:translateY(${start * ROW_HEIGHT}px)">${rows}</div></div></div></div>
        <div class="film-edge"><span>READ ONLY</span><span>${count(scenes.length)} SCENES</span><span>NCUT 01</span></div>
      </section></main>`;
    }
    const scenes = currentScenes();
    const start = Math.max(0, Math.min(state.start, Math.max(0, scenes.length - WINDOW_SIZE)));
    const rows = scenes.slice(start, start + WINDOW_SIZE).map((scene, offset) => sceneRow(scene, start + offset)).join("");
    const empty = `<div class="empty-edit"><div><h1 tabindex="-1" data-empty-title>项目中还没有 Scene</h1><p>从第一句 Narration 开始搭建脚本。Scene 会在合法校验后自动保存。</p><button class="scene-action" data-primary="true" type="button" data-add-first ${state.assetBusy ? "disabled" : ""}>新增第一个 Scene</button><div class="state-code">0 SCENES · PROJECT VNEXT</div></div></div>`;
    return `<main class="stage"><section class="contact-frame" data-editable="true" aria-label="Scene 可编辑接触印样">
      <div class="film-edge"><span>NCUT · ${escapeHtml(result.project.projectId.slice(0, 13))}</span><span>EDITING BENCH</span><span>${count(scenes.length)} SCENES</span></div>
      ${toolbar()}
      ${scenes.length === 0 ? empty : `<div class="contact-sheet"><div class="scene-header"><span>Scene</span><span>Narration</span><span>Asset</span><span>Speech</span></div><div class="scene-scroll" tabindex="0" aria-label="Scene 列表"><div class="scene-spacer" style="height:${scenes.length * ROW_HEIGHT}px"><div class="scene-window" style="transform:translateY(${start * ROW_HEIGHT}px)">${rows}</div></div></div></div>`}
      <div class="film-edge"><span>SCENE WRITE BOUNDARY</span><span>${count(scenes.length)} SCENES</span><span>NCUT 01</span></div>
      ${state.toast ? `<div class="undo-toast" role="status"><span>${escapeHtml(state.toast)}</span><button type="button" data-undo-delete>撤销删除</button></div>` : ""}
    </section>${expandedEditor()}</main>`;
  }

  function statusCopy(validation) {
    if (!validation) return { label: "未开始", mark: "idle", detail: "等待固定宿主验证任务" };
    if (validation.status === "running") return { label: "运行中", mark: "running", detail: "正在等待 Codex 返回结构化结果" };
    if (validation.status === "succeeded") return { label: "验证成功", mark: "succeeded", detail: "临时任务已终结" };
    const reasons = {
      USER_STOPPED: "用户已停止，可明确继续",
      CODEX_THREAD_UNAVAILABLE: "原线程已丢失，继续时自动替换",
      CODEX_INTERRUPTED: "Codex Turn 已中断，可重新继续",
      CODEX_UNAVAILABLE: "Codex 宿主不可用，可稍后重试",
    };
    return { label: "已停止", mark: "stopped", detail: reasons[validation.reason] ?? "任务已安全停止" };
  }

  function agent(result) {
    const validation = state.hostValidation;
    const status = statusCopy(validation);
    const connected = validation?.connection?.status === "connected";
    const replaced = validation?.connection?.replaced === true;
    const succeeded = validation?.status === "succeeded";
    const running = validation?.status === "running";
    const stopped = validation?.status === "stopped";
    const taskId = validation?.taskId ?? "—";
    const threadId = validation?.connection?.threadId ?? "—";
    const scene = selectedScene();
    const sceneIndex = scene ? currentScenes().indexOf(scene) + 1 : 0;
    const diagnostic = validation?.diagnostic ?? (state.agentError ? { code: "HOST_TOOL_ERROR", message: state.agentError } : null);
    const summary = validation?.result?.summary;
    const briefReviewPending = result.currentRenderProgram?.briefReviewPending;
    const briefReviewState = briefReviewPending === undefined
      ? { mark: "idle", label: "Brief 关系未检查", detail: "打开可写项目后校验当前 Render Program 的 Brief 指纹" }
      : briefReviewPending
        ? { mark: "unavailable", label: "Brief 待复核", detail: "当前 Render Program 与既有 Preview 保持不变" }
        : { mark: "connected", label: "已对应当前 Brief", detail: "当前 Render Program 已绑定这份 Brief 指纹" };
    return `<main class="stage"><section class="agent-panel" aria-labelledby="agent-validation-title">
      <header class="agent-head"><div><h1 id="agent-validation-title">Codex 创作线程验证</h1><p>运行一次固定、只读的宿主任务，核对专用线程的创建、状态回传与驱动权边界。验证结果不是候选 Render Program，也不会修改项目内容。</p></div><div class="protocol-tag">APP SERVER · READ ONLY</div></header>
      <div class="agent-main"><section class="task-board" aria-label="临时任务状态"><h2 class="board-title"><span>临时任务状态</span><span>ONE TASK · ONE DRIVER</span></h2><dl class="status-ledger">
        <div class="status-line"><span class="status-mark" data-status="${status.mark}" aria-hidden="true"></span><dt>任务状态</dt><dd><span>${status.label}</span><span class="replacement-note">${escapeHtml(status.detail)}</span></dd></div>
        <div class="status-line"><span class="status-mark" data-status="${connected ? "connected" : validation ? "unavailable" : "idle"}" aria-hidden="true"></span><dt>线程连接</dt><dd><span>${connected ? "Codex 创作线程已连接" : validation ? "Codex 创作线程不可用" : "等待开始"}</span>${replaced ? '<span class="replacement-note">替代线程已接管</span>' : ""}</dd></div>
        <div class="status-line" data-brief-review="${briefReviewPending === true}"><span class="status-mark" data-status="${briefReviewState.mark}" aria-hidden="true"></span><dt>Video Brief</dt><dd><span>${briefReviewState.label}</span><span class="replacement-note">${briefReviewState.detail}</span></dd></div>
        <div class="status-line"><span class="status-mark" data-status="idle" aria-hidden="true"></span><dt>当前 Scene</dt><dd>${scene ? `Scene ${pad(sceneIndex)} 保持选中` : "当前项目没有 Scene"}</dd></div>
        <div class="status-line"><span class="status-mark" data-status="idle" aria-hidden="true"></span><dt>Task ID</dt><dd>${escapeHtml(taskId)}</dd></div><div class="status-line"><span class="status-mark" data-status="idle" aria-hidden="true"></span><dt>Thread</dt><dd>${escapeHtml(threadId)}</dd></div>
      </dl></section><section class="result-board" aria-label="验证结果"><h2 class="board-title"><span>验证结果</span><span>BOUNDED RESULT</span></h2><div class="result-field" data-status="${succeeded ? "succeeded" : status.mark}"><h2>${succeeded ? "验证成功" : running ? "正在验证" : stopped ? "验证已停止" : "等待验证"}</h2><p>${succeeded ? escapeHtml(summary) : running ? "结果只有通过任务身份、当前驱动身份和项目身份校验后才会进入这里。" : stopped ? "已保留最小任务检查点；继续时优先恢复原线程，失效则自动创建替代线程。" : "开始后，Narracut 将自动创建专用 Codex 创作线程；无需选择 Thread 或输入 Thread ID。"}</p>${succeeded ? '<div class="proof-list"><div class="proof-item">任务与当前驱动身份已校验</div><div class="proof-item">项目内容未修改</div></div>' : ""}</div>${diagnostic ? `<div class="agent-diagnostic" role="status"><strong>${escapeHtml(diagnostic.code)}</strong>${escapeHtml(diagnostic.message)}</div>` : ""}</section></div>
      <footer class="agent-actions" aria-label="宿主验证操作"><button class="agent-action" data-agent-action="start" data-kind="primary" type="button" ${state.agentBusy || running || stopped ? "disabled" : ""}>开始验证</button><button class="agent-action" data-agent-action="stop" data-kind="stop" type="button" ${state.agentBusy || !running ? "disabled" : ""}>停止</button><button class="agent-action" data-agent-action="continue" data-kind="primary" type="button" ${state.agentBusy || !stopped ? "disabled" : ""}>继续</button><div class="agent-action-note">不保存对话副本、推理、工具日志或未提交修改</div></footer>
    </section></main>`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "大小未知";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }

  function assetPreviewLayer() {
    const preview = state.assetPreview;
    if (!preview) return "";
    let content;
    if (preview.status === "loading") {
      content = '<div class="preview-state"><div class="loading" aria-label="正在读取 Asset"><i></i><i></i><i></i></div><p>正在只读检查 Asset…</p></div>';
    } else if (preview.status === "unavailable") {
      content = `<div class="preview-state" data-status="unavailable"><span class="asset-warning" aria-hidden="true"></span><h2>文件不可用</h2><code>${escapeHtml(preview.id)}</code><code>${escapeHtml(preview.path)}</code><p>${escapeHtml(preview.reason)}</p></div>`;
    } else if (preview.status === "dangling") {
      content = `<div class="preview-state" data-status="dangling"><span class="asset-warning" aria-hidden="true"></span><h2>悬空 Asset ID</h2><code>${escapeHtml(preview.id)}</code><p>${escapeHtml(preview.reason)}</p></div>`;
    } else if (preview.status === "identity-lost") {
      content = `<div class="preview-state" data-status="identity-lost"><span class="asset-warning" aria-hidden="true"></span><h2>项目身份失效</h2><code>${escapeHtml(preview.id)}</code><p>${escapeHtml(preview.reason)}</p></div>`;
    } else {
      const media = preview.dataUrl && preview.kind === "image"
        ? `<img src="${escapeHtml(preview.dataUrl)}" alt="${escapeHtml(preview.filename)} 只读预览">`
        : preview.dataUrl && preview.kind === "video"
          ? `<video src="${escapeHtml(preview.dataUrl)}" controls preload="metadata" aria-label="${escapeHtml(preview.filename)} 只读预览"></video>`
          : preview.dataUrl && preview.kind === "audio"
            ? `<audio src="${escapeHtml(preview.dataUrl)}" controls preload="metadata" aria-label="${escapeHtml(preview.filename)} 只读预览"></audio>`
            : preview.dataUrl && preview.kind === "document"
              ? `<iframe src="${escapeHtml(preview.dataUrl)}" title="${escapeHtml(preview.filename)} 只读预览"></iframe>`
              : `<div class="preview-state"><h2>${escapeHtml(preview.filename)}</h2><p>${escapeHtml(preview.reason ?? "当前格式不支持内容预览。")}</p></div>`;
      content = `<div class="preview-media">${media}</div><dl class="preview-facts"><div><dt>文件</dt><dd>${escapeHtml(preview.filename)}</dd></div><div><dt>项目路径</dt><dd>${escapeHtml(preview.path)}</dd></div><div><dt>大小</dt><dd>${formatBytes(preview.size)}</dd></div></dl>`;
    }
    return `<div class="asset-preview-layer" role="dialog" aria-modal="true" aria-label="Asset 只读预览"><section class="asset-preview-sheet"><header><div><strong>Asset 只读预览</strong><span>只检查文件本体，不改变 Scene 或 Player</span></div><button type="button" data-close-preview aria-label="关闭预览">关闭</button></header><div class="asset-preview-body">${content}</div></section></div>`;
  }

  function briefEditorLayer() {
    const brief = state.brief;
    if (!brief.open) return "";
    const conflict = brief.conflict;
    const status = briefStatusLabel();
    const byteCount = new TextEncoder().encode(brief.local).length;
    const historyDisabled = brief.status === "conflict" || brief.saveInFlight;
    const header = `<header class="brief-head"><div><h1 id="brief-editor-title">编辑 Video Brief</h1><p>项目级创作意图 · 自由 Markdown · 不改变 Scene 内容</p></div><div class="brief-head-actions"><button type="button" data-brief-undo aria-label="Video Brief Undo" ${brief.undo.length === 0 || historyDisabled ? "disabled" : ""}>Undo</button><button type="button" data-brief-redo aria-label="Video Brief Redo" ${brief.redo.length === 0 || historyDisabled ? "disabled" : ""}>Redo</button><span class="brief-save-state" data-brief-save-state data-status="${brief.status}" role="status">${status}</span><button type="button" data-close-brief aria-label="关闭 Video Brief 编辑器">关闭</button></div></header>`;
    if (conflict) {
      const tabs = [["base", "BASE"], ["local", "LOCAL"], ["disk", "DISK"]];
      return `<div class="brief-layer" role="dialog" aria-modal="true" aria-label="编辑 Video Brief" aria-labelledby="brief-editor-title"><section class="brief-sheet" data-mode="conflict">${header}<main class="brief-conflict"><div class="brief-conflict-copy"><span class="status-mark" data-status="unavailable" aria-hidden="true"></span><div><h2>外部冲突</h2><p>自动保存已停止。比较三份只读证据，编辑新的完整合并结果，或明确放弃、导出 LOCAL。</p></div></div><div class="brief-evidence-tabs" role="tablist" aria-label="Video Brief 冲突证据">${tabs.map(([key, label]) => `<button type="button" role="tab" data-brief-conflict-tab="${key}" aria-selected="${brief.conflictTab === key}">查看 ${label}</button>`).join("")}</div><div class="brief-evidence-grid">${tabs.map(([key, label]) => `<label class="brief-evidence" data-current="${brief.conflictTab === key}"><span>${label} · 只读证据</span><textarea readonly aria-label="${label} 只读证据">${escapeHtml(key === "base" ? conflict.base : key === "local" ? conflict.local : conflict.disk)}</textarea></label>`).join("")}</div><label class="brief-merge"><span>合并结果 · 可编辑的完整 video.md</span><textarea data-brief-merge aria-label="合并结果">${escapeHtml(brief.merge)}</textarea></label>${brief.error ? `<div class="brief-error" role="alert">${escapeHtml(brief.error.message)}</div>` : ""}<div class="brief-resolution-actions"><button type="button" data-submit-brief-merge>提交合并结果</button><button type="button" data-discard-brief-local>放弃 LOCAL 并载入 DISK</button><button type="button" data-export-brief-local ${brief.exporting ? "disabled" : ""}>${brief.exporting ? "正在导出…" : "导出 LOCAL"}</button></div></main></section></div>`;
    }
    return `<div class="brief-layer" role="dialog" aria-modal="true" aria-label="编辑 Video Brief" aria-labelledby="brief-editor-title"><section class="brief-sheet">${header}<main class="brief-editor-main"><label><span class="sr-only">Video Brief 原始 Markdown</span><textarea data-brief-editor aria-label="Video Brief 原始 Markdown" spellcheck="true" maxlength="2097152">${escapeHtml(normalizeBriefEditorText(brief.local))}</textarea></label><footer><span>${formatBytes(byteCount)} / 2 MiB</span><span>保存完整原始字节 · 不自动格式化</span></footer>${brief.error ? `<div class="brief-error" role="alert">${escapeHtml(brief.error.message)}${brief.status === "failed" ? '<button type="button" data-retry-brief>重试保存</button>' : ""}</div>` : ""}${brief.exportMessage ? `<div class="brief-export-message" role="status">${escapeHtml(brief.exportMessage)}</div>` : ""}</main></section></div>`;
  }

  function valid(result) {
    return `<div class="workspace">${state.workspace === "table" ? table(result) : agent(result)}${inspector(result)}</div>${assetPreviewLayer()}${briefEditorLayer()}`;
  }

  function invalid(result) {
    const error = result.error ?? {};
    const diagnostics = error.diagnostics ?? [];
    return `<div class="workspace"><main class="stage"><section class="state-panel"><div class="state-copy"><h1>项目无法打开</h1><p>${escapeHtml(error.message ?? "项目检查失败，请核对目录与内容后重试。")}</p><div class="state-code">${escapeHtml(error.code ?? "PROJECT_INSPECTION_FAILED")}</div><ul class="diagnostics">${diagnostics.map((item) => `<li><strong>${escapeHtml(item.component)}</strong><br><span>${escapeHtml(item.message)}</span></li>`).join("")}</ul></div></section></main><aside class="inspection" aria-label="项目检查" data-open="${state.inspectionOpen}"><button type="button" class="inspection-close" data-close-inspection aria-label="关闭项目检查">关闭</button><h2>项目检查</h2><div class="rule"></div><section class="readonly"><strong>只读检查失败</strong><p>错误已同时返回给模型与工作台；Narracut 未修改该目录。</p></section></aside></div>`;
  }

  function loading() {
    return `<div class="workspace"><main class="stage"><section class="state-panel"><div class="loading" aria-label="正在连接 Narracut"><i></i><i></i><i></i></div></section></main><aside class="inspection" aria-label="项目检查"><h2>项目检查</h2><div class="rule"></div><p>等待工具结果…</p></aside></div>`;
  }

  function render() {
    const result = state.result;
    const launcherMode = result?.status === "launcher";
    app.className = `app-shell${launcherMode ? " launcher-shell" : state.project ? " editing-shell" : ""}`;
    app.innerHTML = launcherMode
      ? `${launcherRail()}${launcher()}${launcherFooter()}`
      : `${rail(result)}${tabs()}${result === null ? loading() : result.status === "valid" ? valid(result) : invalid(result)}${composer()}`;
    bind();
    if (state.focusTarget) {
      const target = state.focusTarget;
      state.focusTarget = null;
      const element = document.querySelector(target);
      if (element) element.focus();
      else requestAnimationFrame(() => document.querySelector(target)?.focus());
    }
  }

  function announce(message) {
    const announcer = document.getElementById("launcher-status-announcer");
    announcer.textContent = "";
    requestAnimationFrame(() => { announcer.textContent = message; });
  }

  function validateProject(project) {
    const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    const onlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
    const canonicalPath = (value, root) => {
      if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
      if ([...value].length > 1024 || new TextEncoder().encode(value).length > 1024) return false;
      const parts = value.split("/");
      return parts[0] === root && parts.length > 1 && parts.every((part) => part !== "" && part !== "." && part !== "..");
    };
    if (!isRecord(project) || !onlyKeys(project, ["assets", "scenes"]) || !Array.isArray(project.assets) || !Array.isArray(project.scenes)) return "Project DSL 必须是只含 assets 与 scenes 的对象。";
    if (project.assets.length > 1000) return "Asset 数量超过 1,000 项上限。";
    if (project.scenes.length > 1000) return "Scene 数量超过 1,000 项上限。";
    const assetIds = new Set();
    const assetPaths = new Set();
    for (const asset of project.assets) {
      if (!isRecord(asset) || !onlyKeys(asset, ["id", "path"]) || !uuid.test(asset.id) || !canonicalPath(asset.path, "assets")) return "Asset 必须只含规范 UUID 与 assets/ 下的项目相对路径。";
      if (assetIds.has(asset.id) || assetPaths.has(asset.path)) return "Asset ID 与路径必须在项目内唯一。";
      assetIds.add(asset.id);
      assetPaths.add(asset.path);
    }
    const sceneIds = new Set();
    for (const scene of project.scenes) {
      if (!isRecord(scene) || !onlyKeys(scene, ["id", "narration", "assetIds", "speech"])) return "Scene 包含未知字段或结构无效。";
      if (!uuid.test(scene.id) || sceneIds.has(scene.id)) return "Scene ID 必须是项目内唯一的规范 UUID。";
      sceneIds.add(scene.id);
      if (!isRecord(scene.narration) || !onlyKeys(scene.narration, ["text"]) || typeof scene.narration.text !== "string") return "Narration 必须是只含 text 的对象。";
      if ([...scene.narration.text].length > 65_536 || new TextEncoder().encode(scene.narration.text).length > 256 * 1024) return "Narration 超过 65,536 个 Unicode 标量或 256 KiB 上限。";
      if (!Array.isArray(scene.assetIds) || scene.assetIds.length > 256 || new Set(scene.assetIds).size !== scene.assetIds.length || scene.assetIds.some((id) => !uuid.test(id) || !assetIds.has(id))) return "Scene 的 Asset 引用无效或超过上限。";
      if ("speech" in scene) {
        const speech = scene.speech;
        if (!isRecord(speech) || !onlyKeys(speech, ["path", "durationMs", "sourceTextHash", "ttsProfileId", "audioContentHash"]) ||
          !canonicalPath(speech.path, "speech") || speech.path !== `speech/${scene.id}.mp3` ||
          !Number.isSafeInteger(speech.durationMs) || speech.durationMs <= 0 ||
          typeof speech.sourceTextHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(speech.sourceTextHash) ||
          typeof speech.ttsProfileId !== "string" || [...speech.ttsProfileId].length > 256 ||
          (speech.audioContentHash !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(speech.audioContentHash))) return "Speech 必须与 Scene 身份匹配并满足严格资源约束。";
      }
    }
    if (new TextEncoder().encode(JSON.stringify(project)).length > 10 * 1024 * 1024) return "project.json 超过 10 MiB 上限。";
    return null;
  }

  function validateSaveIdentity() {
    const project = state.result?.project;
    const absolute = typeof project?.directory === "string" && (/^\//u.test(project.directory) || /^[A-Za-z]:[\\/]/u.test(project.directory));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
    if (!state.result?.writable || !absolute || !uuid.test(project?.projectId ?? "") || !/^sha256:[0-9a-f]{64}$/u.test(state.baselineRevision ?? "")) return "项目写入身份或磁盘基线无效。";
    return null;
  }

  async function validateSpeechHashes(project) {
    for (const scene of project.scenes) {
      if (!scene.speech) continue;
      let digest;
      if (crypto.subtle?.digest) {
        const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scene.narration.text));
        digest = [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
      } else {
        digest = sha256Utf8(scene.narration.text);
      }
      const actual = `sha256:${digest}`;
      if (actual !== scene.speech.sourceTextHash) return `Scene ${scene.id} 的 Speech 文本摘要与 Narration 不一致。`;
    }
    return null;
  }

  function sha256Utf8(value) {
    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const bytes = [...new TextEncoder().encode(value)];
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let shift = 56; shift >= 0; shift -= 8) bytes.push(Math.floor(bitLength / (2 ** shift)) & 0xff);
    const rotate = (word, bits) => (word >>> bits) | (word << (32 - bits));
    for (let offset = 0; offset < bytes.length; offset += 64) {
      const words = new Uint32Array(64);
      for (let index = 0; index < 16; index += 1) {
        const base = offset + index * 4;
        words[index] = ((bytes[base] << 24) | (bytes[base + 1] << 16) | (bytes[base + 2] << 8) | bytes[base + 3]) >>> 0;
      }
      for (let index = 16; index < 64; index += 1) {
        const left = words[index - 15];
        const right = words[index - 2];
        const sigma0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3);
        const sigma1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10);
        words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
        const choose = (e & f) ^ (~e & g);
        const temp1 = (h + sum1 + choose + constants[index] + words[index]) >>> 0;
        const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (sum0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
    }
    return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
  }

  function updateSaveIndicator() {
    const indicator = document.querySelector("[data-save-state]");
    if (!indicator) return;
    indicator.dataset.status = state.saveStatus;
    indicator.textContent = saveLabel();
    const undoButton = document.querySelector("[data-undo]");
    const redoButton = document.querySelector("[data-redo]");
    if (undoButton) undoButton.disabled = state.undo.length === 0 || state.autosaveStopped || state.assetBusy;
    if (redoButton) redoButton.disabled = state.redo.length === 0 || state.autosaveStopped || state.assetBusy;
  }

  function snapshot() {
    const project = clone(state.project);
    const bytes = new TextEncoder().encode(JSON.stringify(project)).length;
    return { project, selected: state.selected, bytes };
  }

  function pushHistory(stack, entry) {
    stack.push(entry);
    let total = stack.reduce((sum, item) => sum + item.bytes, 0);
    while (stack.length > 1 && total > HISTORY_BYTE_LIMIT) total -= stack.shift().bytes;
  }

  function recordSnapshot() {
    pushHistory(state.undo, snapshot());
    state.redo = [];
  }

  function markDirty(immediate = false) {
    state.version += 1;
    state.saveStatus = "dirty";
    state.saveError = null;
    updateSaveIndicator();
    clearTimeout(saveTimer);
    if (!state.autosaveStopped) saveTimer = setTimeout(saveProject, immediate ? 0 : 450);
  }

  function saveProject() {
    clearTimeout(saveTimer);
    if (activeSavePromise) return activeSavePromise;
    if (state.autosaveStopped || !state.project || state.version === state.savedVersion) return Promise.resolve();
    activeSavePromise = performProjectSave();
    return activeSavePromise;
  }

  async function performProjectSave() {
    const savingVersion = state.version;
    state.saveInFlight = true;
    state.saveStatus = "saving";
    updateSaveIndicator();
    try {
      const validationError = validateSaveIdentity() ?? validateProject(state.project) ?? await validateSpeechHashes(state.project);
      if (validationError) {
        state.saveStatus = "failed";
        state.saveError = validationError;
        render();
        announce(`保存失败。${validationError}`);
        return;
      }
      const response = await callHostTool("save_project_scenes", {
        projectDirectory: state.result.project.directory,
        projectId: state.result.project.projectId,
        baselineRevision: state.baselineRevision,
        project: clone(state.project),
      });
      const content = response?.structuredContent ?? response;
      if (response?.isError || ["save-failed", "save-conflict", "identity-lost"].includes(content?.status)) {
        const failure = content?.error ?? { code: "PROJECT_SAVE_FAILED", message: "保存失败，请重试。" };
        state.saveError = failure;
        state.saveStatus = content?.status === "save-conflict" ? "conflict" : content?.status === "identity-lost" ? "identity" : "failed";
        state.autosaveStopped = state.saveStatus === "conflict" || state.saveStatus === "identity";
        render();
        announce(`${saveLabel()}。${failure.message}`);
        return;
      }
      state.baselineRevision = content.projectRevision ?? state.baselineRevision;
      state.savedVersion = savingVersion;
      state.result = { ...state.result, ...content, status: "valid", projectDsl: state.project };
      state.saveStatus = state.version === savingVersion ? "saved" : "dirty";
      updateSaveIndicator();
      const operationMessage = state.operationMessage?.version <= savingVersion
        ? state.operationMessage.message
        : null;
      if (operationMessage) state.operationMessage = null;
      announce(state.saveStatus === "saved"
        ? `${operationMessage ? `${operationMessage} ` : ""}Scene 已保存。`
        : "当前修改已保存，仍有后续修改待保存。");
    } catch (error) {
      state.saveStatus = "failed";
      state.saveError = { code: "HOST_TOOL_ERROR", message: error?.message ?? "保存失败，请重试。" };
      render();
      announce(`保存失败。${state.saveError.message}`);
    } finally {
      state.saveInFlight = false;
      activeSavePromise = null;
      if (!state.autosaveStopped && state.saveStatus === "dirty" && state.version > state.savedVersion) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveProject, 0);
      }
    }
  }

  function updateBriefIndicator() {
    const brief = state.brief;
    document.querySelectorAll("[data-brief-save-state]").forEach((indicator) => {
      indicator.dataset.status = brief.status;
      indicator.textContent = briefStatusLabel();
    });
    document.querySelectorAll("[data-brief-entry-state]").forEach((indicator) => {
      indicator.textContent = briefEntryStatusLabel();
    });
    document.querySelectorAll("[data-open-brief]").forEach((button) => {
      button.setAttribute("aria-label", `Video Brief ${briefStatusLabel()}`);
    });
    const undoButton = document.querySelector("[data-brief-undo]");
    const redoButton = document.querySelector("[data-brief-redo]");
    if (undoButton) undoButton.disabled = brief.undo.length === 0 || brief.status === "conflict" || brief.saveInFlight;
    if (redoButton) redoButton.disabled = brief.redo.length === 0 || brief.status === "conflict" || brief.saveInFlight;
  }

  function pushBriefHistory(stack, content) {
    stack.push({ content, bytes: new TextEncoder().encode(content).length });
    let total = stack.reduce((sum, item) => sum + item.bytes, 0);
    while (stack.length > 1 && total > HISTORY_BYTE_LIMIT) total -= stack.shift().bytes;
  }

  function normalizeBriefEditorText(content) {
    return content.replace(/\r\n|\r/gu, "\n");
  }

  function rawBriefIndex(content, editorOffset) {
    let rawOffset = 0;
    let normalizedOffset = 0;
    while (rawOffset < content.length && normalizedOffset < editorOffset) {
      rawOffset += content[rawOffset] === "\r" && content[rawOffset + 1] === "\n" ? 2 : 1;
      normalizedOffset += 1;
    }
    return rawOffset;
  }

  function preferredBriefNewline(content) {
    const counts = { "\r\n": 0, "\r": 0, "\n": 0 };
    for (let index = 0; index < content.length; index += 1) {
      if (content[index] === "\r" && content[index + 1] === "\n") {
        counts["\r\n"] += 1;
        index += 1;
      } else if (content[index] === "\r") counts["\r"] += 1;
      else if (content[index] === "\n") counts["\n"] += 1;
    }
    const preferred = Object.entries(counts).sort((left, right) => right[1] - left[1])[0];
    return preferred[1] === 0 ? "\n" : preferred[0];
  }

  function reconcileBriefEditorText(content, editorValue) {
    const previous = normalizeBriefEditorText(content);
    if (previous === editorValue) return content;
    let prefix = 0;
    while (prefix < previous.length && prefix < editorValue.length && previous[prefix] === editorValue[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < previous.length - prefix && suffix < editorValue.length - prefix &&
      previous[previous.length - suffix - 1] === editorValue[editorValue.length - suffix - 1]
    ) suffix += 1;
    const rawStart = rawBriefIndex(content, prefix);
    const rawEnd = rawBriefIndex(content, previous.length - suffix);
    const inserted = editorValue.slice(prefix, editorValue.length - suffix)
      .replace(/\n/gu, preferredBriefNewline(content));
    return `${content.slice(0, rawStart)}${inserted}${content.slice(rawEnd)}`;
  }

  function markBriefDirty(immediate = false) {
    const brief = state.brief;
    brief.version += 1;
    brief.status = "dirty";
    brief.error = null;
    brief.exportMessage = null;
    updateBriefIndicator();
    clearTimeout(briefSaveTimer);
    if (!brief.conflict) briefSaveTimer = setTimeout(saveVideoBrief, immediate ? 0 : 450);
  }

  function updateBrief(value) {
    const brief = state.brief;
    if (!brief.editGroupOpen) {
      pushBriefHistory(brief.undo, brief.local);
      brief.redo = [];
      brief.editGroupOpen = true;
    }
    brief.local = reconcileBriefEditorText(brief.local, value);
    markBriefDirty(false);
  }

  function saveVideoBrief() {
    clearTimeout(briefSaveTimer);
    if (activeBriefSavePromise) return activeBriefSavePromise;
    const brief = state.brief;
    if (brief.conflict || brief.version === brief.savedVersion) return Promise.resolve();
    activeBriefSavePromise = performVideoBriefSave();
    return activeBriefSavePromise;
  }

  async function performVideoBriefSave() {
    const brief = state.brief;
    const savingVersion = brief.version;
    const savingContent = brief.local;
    const baselineRevision = brief.baselineRevision;
    brief.editGroupOpen = false;
    brief.saveInFlight = true;
    brief.status = "saving";
    updateBriefIndicator();
    try {
      const bytes = new TextEncoder().encode(savingContent).length;
      if (!/^sha256:[0-9a-f]{64}$/u.test(baselineRevision ?? "") || bytes > 2 * 1024 * 1024) {
        throw new Error(bytes > 2 * 1024 * 1024
          ? `Video Brief 为 ${bytes} 字节，超过 2 MiB 上限。`
          : "Video Brief ETag 无效。");
      }
      const response = await callHostTool("save_project_video_brief", {
        projectDirectory: state.result.project.directory,
        projectId: state.result.project.projectId,
        baselineRevision,
        content: savingContent,
      });
      const content = response?.structuredContent ?? response;
      if (content?.status === "brief-conflict") {
        brief.status = "conflict";
        brief.conflict = {
          base: brief.base,
          local: brief.local,
          disk: content.disk.content,
          diskRevision: content.disk.revision,
        };
        brief.merge = brief.local;
        brief.conflictTab = "base";
        brief.error = null;
        state.focusTarget = "[data-brief-merge]";
        render();
        announce("Video Brief 发生外部冲突。自动保存已停止，BASE、LOCAL 与 DISK 均已保留。");
        return;
      }
      if (response?.isError || ["brief-save-failed", "identity-lost"].includes(content?.status)) {
        const failure = content?.error ?? { code: "BRIEF_SAVE_FAILED", message: "Video Brief 保存失败，请重试。" };
        brief.status = "failed";
        brief.error = failure;
        state.focusTarget = "[data-brief-editor]";
        render();
        announce(`Video Brief 保存失败。${failure.message}`);
        return;
      }
      brief.base = savingContent;
      brief.baselineRevision = content.videoBrief?.revision ?? baselineRevision;
      brief.savedVersion = savingVersion;
      brief.status = brief.version === savingVersion ? "saved" : "dirty";
      state.result = { ...state.result, ...content, status: "valid" };
      updateBriefIndicator();
      announce(brief.status === "saved" ? "Video Brief 已保存。" : "当前 Brief 修改已保存，仍有后续修改待保存。");
    } catch (error) {
      brief.status = "failed";
      brief.error = { code: "HOST_TOOL_ERROR", message: error?.message ?? "Video Brief 保存失败，请重试。" };
      state.focusTarget = "[data-brief-editor]";
      render();
      announce(`Video Brief 保存失败。${brief.error.message}`);
    } finally {
      brief.saveInFlight = false;
      activeBriefSavePromise = null;
      updateBriefIndicator();
      if (!brief.conflict && brief.status === "dirty" && brief.version > brief.savedVersion) {
        clearTimeout(briefSaveTimer);
        briefSaveTimer = setTimeout(saveVideoBrief, 0);
      }
    }
  }

  function moveBriefHistory(from, to) {
    const brief = state.brief;
    const previous = from.pop();
    if (!previous || brief.conflict || brief.saveInFlight) return;
    pushBriefHistory(to, brief.local);
    brief.local = previous.content;
    brief.editGroupOpen = false;
    state.focusTarget = "[data-brief-editor]";
    markBriefDirty(true);
    render();
  }

  function discardBriefLocal() {
    const brief = state.brief;
    if (!brief.conflict) return;
    brief.undo = [];
    brief.redo = [];
    brief.local = brief.conflict.disk;
    brief.base = brief.conflict.disk;
    brief.baselineRevision = brief.conflict.diskRevision;
    brief.version += 1;
    brief.savedVersion = brief.version;
    brief.status = "saved";
    brief.conflict = null;
    brief.error = null;
    brief.editGroupOpen = false;
    state.result = {
      ...state.result,
      videoBrief: {
        content: brief.local,
        revision: brief.baselineRevision,
        bytes: new TextEncoder().encode(brief.local).length,
        state: brief.local === "" ? "empty" : "saved",
      },
      currentRenderProgram: {
        ...(state.result.currentRenderProgram ?? { briefRevision: null, previewPreserved: true }),
        briefReviewPending: state.result.currentRenderProgram?.briefRevision !== brief.baselineRevision,
        previewPreserved: true,
      },
    };
    state.focusTarget = "[data-brief-editor]";
    render();
    announce("已放弃 LOCAL 并载入 DISK；没有覆盖外部内容。");
  }

  function submitBriefMerge() {
    const brief = state.brief;
    if (!brief.conflict) return;
    pushBriefHistory(brief.undo, brief.local);
    brief.redo = [];
    brief.local = brief.merge;
    brief.base = brief.conflict.disk;
    brief.baselineRevision = brief.conflict.diskRevision;
    brief.conflict = null;
    brief.editGroupOpen = false;
    state.focusTarget = "[data-brief-editor]";
    markBriefDirty(true);
    render();
    announce("合并结果已进入串行保存队列。");
  }

  async function exportBriefLocal() {
    const brief = state.brief;
    if (!brief.conflict || brief.exporting) return;
    const api = window.openai;
    const picker = api?.selectDirectory ?? api?.pickDirectory ?? api?.requestDirectoryPicker;
    if (typeof picker !== "function") {
      brief.error = { code: "HOST_DIRECTORY_PICKER_UNAVAILABLE", message: "当前插件宿主没有提供系统文件夹选择能力；LOCAL 仍保留在内存中。" };
      render();
      announce(brief.error.message);
      return;
    }
    brief.exporting = true;
    brief.error = null;
    render();
    try {
      const selected = await picker.call(api, {
        purpose: "export-video-brief-local",
        title: "选择项目外的 Video Brief LOCAL 导出目录",
        canCreateDirectories: true,
      });
      const targetDirectory = directoryPath(selected);
      if (targetDirectory === null) {
        brief.exporting = false;
        render();
        document.querySelector("[data-export-brief-local]")?.focus();
        return;
      }
      const response = await callHostTool("export_project_video_brief_local", {
        projectDirectory: state.result.project.directory,
        projectId: state.result.project.projectId,
        targetDirectory,
        content: brief.conflict.local,
      });
      const content = response?.structuredContent ?? response;
      if (response?.isError || content?.status !== "brief-exported") {
        throw new Error(content?.error?.message ?? "Video Brief LOCAL 导出失败。");
      }
      const exportedPath = content.exported.path;
      brief.exporting = false;
      discardBriefLocal();
      brief.exportMessage = `LOCAL 已导出到 ${exportedPath}；编辑器已载入 DISK。`;
      render();
      announce(brief.exportMessage);
    } catch (error) {
      brief.exporting = false;
      brief.error = { code: "BRIEF_EXPORT_FAILED", message: error?.message ?? "Video Brief LOCAL 导出失败；LOCAL 仍保留在内存中。" };
      render();
      announce(brief.error.message);
    }
  }

  function commitProject(nextProject, message, options = {}) {
    const error = validateProject(nextProject);
    if (error) {
      announce(`修改被拒绝。${error}`);
      return false;
    }
    state.editGroupOpen = false;
    recordSnapshot();
    state.project = nextProject;
    if (options.selected !== undefined) state.selected = options.selected;
    state.editing = options.editing ?? null;
    state.toast = options.toast ?? null;
    state.focusTarget = options.focusTarget ?? null;
    markDirty(options.immediate === true);
    state.operationMessage = message ? { version: state.version, message } : null;
    render();
    if (message) announce(message);
    return true;
  }

  function addScene() {
    if (state.autosaveStopped || state.assetBusy || !state.project) return;
    const id = createUuid();
    const scenes = clone(currentScenes());
    const index = state.selected ? Math.max(0, scenes.findIndex((scene) => scene.id === state.selected) + 1) : scenes.length;
    scenes.splice(index, 0, { id, narration: { text: "" }, assetIds: [] });
    commitProject({ ...clone(state.project), scenes }, `已新增 Scene ${pad(index + 1)}。`, {
      selected: id,
      editing: id,
      focusTarget: "[data-narration-editor]",
      immediate: true,
    });
  }

  function copyScene() {
    const source = selectedScene();
    if (!source || state.autosaveStopped || state.assetBusy) return;
    const scenes = clone(currentScenes());
    const index = scenes.findIndex((scene) => scene.id === source.id);
    const copy = { id: createUuid(), narration: { text: source.narration.text }, assetIds: [...source.assetIds] };
    scenes.splice(index + 1, 0, copy);
    commitProject({ ...clone(state.project), scenes }, `已复制 Scene ${pad(index + 1)}；副本位于位置 ${index + 2}，Speech 缺失。`, { selected: copy.id, immediate: true });
  }

  function deleteScene() {
    const source = selectedScene();
    if (!source || state.autosaveStopped || state.assetBusy) return;
    const scenes = clone(currentScenes());
    const index = scenes.findIndex((scene) => scene.id === source.id);
    scenes.splice(index, 1);
    const nextSelected = scenes[index]?.id ?? scenes[index - 1]?.id ?? null;
    commitProject({ ...clone(state.project), scenes }, `已删除 Scene ${pad(index + 1)}；可撤销。`, {
      selected: nextSelected,
      toast: `已删除 Scene ${pad(index + 1)}`,
      immediate: true,
    });
  }

  function moveScene(targetIndex) {
    const source = selectedScene();
    const scenes = clone(currentScenes());
    const from = scenes.findIndex((scene) => scene.id === source?.id);
    const to = Math.max(0, Math.min(scenes.length - 1, targetIndex));
    if (from < 0 || from === to || state.autosaveStopped || state.assetBusy) return;
    const [moved] = scenes.splice(from, 1);
    scenes.splice(to, 0, moved);
    commitProject({ ...clone(state.project), scenes }, `Scene 已从位置 ${from + 1} 移动到位置 ${to + 1}。`, { selected: moved.id, immediate: true });
    requestAnimationFrame(() => document.querySelector(`[data-scene-id="${CSS.escape(moved.id)}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  function undo() {
    const previous = state.undo.pop();
    if (!previous || state.autosaveStopped || state.assetBusy) return;
    pushHistory(state.redo, snapshot());
    state.project = previous.project;
    state.selected = previous.selected;
    state.editing = null;
    state.toast = null;
    state.operationMessage = null;
    markDirty(true);
    render();
    announce("已撤销上一个 Scene 修改，正在重新保存。");
  }

  function redo() {
    const next = state.redo.pop();
    if (!next || state.autosaveStopped || state.assetBusy) return;
    pushHistory(state.undo, snapshot());
    state.project = next.project;
    state.selected = next.selected;
    state.editing = null;
    state.toast = null;
    markDirty(true);
    render();
    announce("已重做 Scene 修改，正在重新保存。");
  }

  function updateNarration(sceneId, value, source) {
    const index = currentScenes().findIndex((scene) => scene.id === sceneId);
    if (index < 0 || state.autosaveStopped || state.assetBusy) return;
    const previousValue = state.project.scenes[index].narration.text;
    if ([...value].length > 65_536 || new TextEncoder().encode(value).length > 256 * 1024) {
      source.value = previousValue;
      announce("输入被拒绝。Narration 超过 65,536 个 Unicode 标量或 256 KiB 上限。");
      return;
    }
    if (!state.editGroupOpen) {
      recordSnapshot();
      state.editGroupOpen = true;
    }
    state.project.scenes[index] = {
      ...state.project.scenes[index],
      narration: { text: value },
    };
    delete state.project.scenes[index].speech;
    markDirty(false);
  }

  function rebaseHistoryAssets(assets) {
    for (const stack of [state.undo, state.redo]) {
      for (const entry of stack) {
        entry.project.assets = clone(assets);
        entry.bytes = new TextEncoder().encode(JSON.stringify(entry.project)).length;
      }
    }
  }

  function rebaseHistorySpeech(project) {
    const speechByScene = new Map(project.scenes.map((scene) => [scene.id, scene.speech]));
    for (const stack of [state.undo, state.redo]) {
      for (const entry of stack) {
        for (const scene of entry.project.scenes) {
          const speech = speechByScene.get(scene.id);
          if (speech === undefined) delete scene.speech;
          else scene.speech = clone(speech);
        }
        entry.bytes = new TextEncoder().encode(JSON.stringify(entry.project)).length;
      }
    }
  }

  function changeSceneAssets(sceneId, nextAssetIds, message) {
    const project = clone(state.project);
    const scene = project.scenes.find((item) => item.id === sceneId);
    if (!scene || state.autosaveStopped || state.assetBusy) return false;
    scene.assetIds = nextAssetIds;
    return commitProject(project, message, { selected: sceneId, immediate: true });
  }

  function addExistingAsset(assetId) {
    const scene = selectedScene();
    if (!scene || scene.assetIds.includes(assetId) || scene.assetIds.length >= 256) return;
    changeSceneAssets(scene.id, [...scene.assetIds, assetId], `已将 ${assetFilename(state.project.assets.find((asset) => asset.id === assetId)?.path) ?? "Asset"} 添加到 Scene。`);
  }

  function moveAssetReference(assetId, targetIndex) {
    const scene = selectedScene();
    if (!scene) return;
    const from = scene.assetIds.indexOf(assetId);
    const to = Math.max(0, Math.min(scene.assetIds.length - 1, targetIndex));
    if (from < 0 || from === to) return;
    const next = [...scene.assetIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    changeSceneAssets(scene.id, next, `Asset 已从位置 ${from + 1} 移动到位置 ${to + 1}。`);
  }

  function unlinkAssetReference(assetId) {
    const scene = selectedScene();
    if (!scene || !scene.assetIds.includes(assetId)) return;
    changeSceneAssets(scene.id, scene.assetIds.filter((id) => id !== assetId), "已解除当前 Scene 的 Asset 引用；项目登记与文件保持不变。");
  }

  function selectedFilePaths(value) {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(selectedFilePaths);
    if (value && typeof value === "object") {
      for (const key of ["path", "filePath", "absolutePath"]) {
        if (typeof value[key] === "string") return [value[key]];
      }
      for (const key of ["files", "paths", "items"]) {
        if (Array.isArray(value[key])) return value[key].flatMap(selectedFilePaths);
      }
    }
    return [];
  }

  async function chooseAssetFiles() {
    const api = window.openai;
    const picker = api?.selectFiles ?? api?.pickFiles ?? api?.requestFilePicker;
    if (typeof picker !== "function") {
      state.assetImportResults = [{ name: "系统文件选择器", status: "failed", message: "当前插件宿主没有提供系统文件选择能力。" }];
      render();
      announce("当前插件宿主没有提供系统文件选择能力；Narracut 不会退化为网页上传。");
      return [];
    }
    try {
      const selected = await picker.call(api, {
        purpose: "import-assets",
        title: "选择要复制进 Narracut 项目的文件",
        multiple: true,
        filesOnly: true,
      });
      return selectedFilePaths(selected);
    } catch (error) {
      state.assetImportResults = [{ name: "系统文件选择器", status: "failed", message: error?.message ?? "无法打开系统文件选择窗口。" }];
      render();
      announce("系统文件选择窗口无法打开，请重试。");
      return [];
    }
  }

  async function flushProjectBeforeAssetImport() {
    clearTimeout(saveTimer);
    state.editGroupOpen = false;
    while (!state.autosaveStopped && state.version !== state.savedVersion) {
      await saveProject();
      if (["failed", "conflict", "identity"].includes(state.saveStatus)) return false;
    }
    return !state.autosaveStopped && state.version === state.savedVersion;
  }

  function applyWorkspaceContent(content) {
    if (content?.projectDsl) {
      const nextProject = clone(content.projectDsl);
      rebaseHistorySpeech(nextProject);
      state.project = nextProject;
      state.baselineRevision = content.projectRevision ?? state.baselineRevision;
      state.version += 1;
      state.savedVersion = state.version;
      state.saveStatus = "saved";
    }
    state.result = { ...state.result, ...content, status: "valid", projectDsl: state.project };
  }

  async function saveTtsSettings(confirmed = false) {
    if (state.ttsSaving || !state.ttsForm || !state.result?.project) return;
    const oldConfig = state.result.tts?.status === "configured" ? state.result.tts.config : null;
    const configChanged = JSON.stringify(oldConfig) !== JSON.stringify(state.ttsForm);
    const affectedSpeechCount = configChanged
      ? currentScenes().filter((scene) => scene.speech !== undefined).length
      : 0;
    if (!confirmed && affectedSpeechCount > 0) {
      state.ttsPendingConfirm = { affectedSpeechCount };
      render();
      document.querySelector("[data-confirm-tts]")?.focus();
      return;
    }
    const expectedAffectedSpeechCount = confirmed
      ? state.ttsPendingConfirm?.affectedSpeechCount ?? affectedSpeechCount
      : affectedSpeechCount;
    if (!await flushProjectBeforeAssetImport()) {
      state.ttsError = "请先解决 Scene 保存失败、冲突或身份问题。";
      render();
      return;
    }
    state.ttsSaving = true;
    state.ttsError = null;
    state.ttsPendingConfirm = null;
    render();
    try {
      const credentialAction = state.ttsClearCredential ? "clear" : state.ttsApiKey.trim() ? "replace" : "keep";
      const response = await callHostTool("save_project_tts_settings", {
        projectDirectory: state.result.project.directory,
        projectId: state.result.project.projectId,
        baselineRevision: state.baselineRevision,
        config: clone(state.ttsForm),
        credentialAction,
        expectedAffectedSpeechCount,
        ...(credentialAction === "replace" ? { apiKey: state.ttsApiKey.trim() } : {}),
      });
      const content = response?.structuredContent ?? response;
      if (content?.status === "tts-confirmation-required") {
        state.ttsPendingConfirm = { affectedSpeechCount: content.affectedSpeechCount };
        state.ttsError = null;
        announce(`TTS 配置变更需要确认，将移除 ${content.affectedSpeechCount} 条 Speech。`);
        return;
      }
      if (response?.isError || ["tts-save-failed", "save-conflict", "identity-lost"].includes(content?.status)) {
        throw new Error(content?.error?.message ?? "TTS 配置保存失败。");
      }
      applyWorkspaceContent(content);
      initializeTtsForm(content.tts);
      state.ttsApiKey = "";
      state.ttsClearCredential = false;
      state.ttsBlockedReason = null;
      announce(content.affectedSpeechCount > 0
        ? `TTS 配置已保存；${content.affectedSpeechCount} 条不匹配的 Speech 已移除。`
        : "TTS 配置已保存。");
    } catch (error) {
      state.ttsError = error?.message ?? "TTS 配置保存失败。";
      announce(`TTS 配置保存失败。${state.ttsError}`);
    } finally {
      state.ttsSaving = false;
      render();
    }
  }

  function scheduleSpeechPoll(delay = 900) {
    clearTimeout(speechPollTimer);
    const activeJobs = Object.values(state.speechJobs).filter((job) =>
      !["succeeded", "cancelled", "failed", "rejected"].includes(job.status));
    if (activeJobs.length === 0) return;
    speechPollTimer = setTimeout(async () => {
      await Promise.all(activeJobs.map(async (known) => {
        try {
          const response = await callHostTool("get_scene_speech_job", { jobId: known.id });
          const content = response?.structuredContent ?? response;
          if (response?.isError || !content?.speechJob) throw new Error(content?.error?.message ?? "无法读取 Speech 状态。");
          const job = { ...content.speechJob, pollFailures: 0, pollError: null };
          const stageChanged = known.status !== job.status || known.stage !== job.stage;
          state.speechJobs[job.sceneId] = job;
          if (content.projectDsl) applyWorkspaceContent(content);
          if (stageChanged) announce(`Speech：${job.stage}。`);
          if (["succeeded", "cancelled", "failed", "rejected"].includes(job.status)) {
            state.focusTarget = `[data-scene-id="${job.sceneId}"] [data-speech-action]`;
          }
        } catch (error) {
          const pollFailures = (known.pollFailures ?? 0) + 1;
          state.speechJobs[known.sceneId] = {
            ...known,
            pollFailures,
            pollError: error?.message ?? "无法读取 Speech 状态。",
          };
          if (pollFailures === 1) announce("Speech 状态读取暂时中断，正在重试；后台生成没有被标记为失败。");
        }
      }));
      render();
      const failures = Math.max(0, ...Object.values(state.speechJobs).map((job) => job.pollFailures ?? 0));
      scheduleSpeechPoll(Math.min(4_000, 900 * (2 ** Math.min(failures, 2))));
    }, delay);
  }

  async function startSpeech(sceneId) {
    const scene = currentScenes().find((item) => item.id === sceneId);
    if (!scene || scene.narration.text.trim() === "") return;
    const configured = state.result.tts?.status === "configured";
    const credentialReady = state.result.tts?.credential?.status === "available";
    if (!configured || !credentialReady) {
      state.selected = sceneId;
      state.inspectorMode = "tts";
      state.inspectionOpen = true;
      state.ttsBlockedReason = "需要先保存 TTS 配置与 API Key";
      render();
      state.focusTarget = null;
      document.querySelector("[data-tts-api-key]")?.focus();
      return;
    }
    if (!await flushProjectBeforeAssetImport()) {
      announce("Speech 生成已取消：Scene 修改尚未安全保存。");
      return;
    }
    try {
      const response = await callHostTool("start_scene_speech", {
        projectDirectory: state.result.project.directory,
        projectId: state.result.project.projectId,
        sceneId,
      });
      const content = response?.structuredContent ?? response;
      if (response?.isError || !content?.speechJob) throw new Error(content?.error?.message ?? "无法开始 Speech 生成。");
      state.speechJobs[sceneId] = content.speechJob;
      announce("Speech 已排队。");
      render();
      scheduleSpeechPoll();
    } catch (error) {
      state.speechJobs[sceneId] = { id: "", sceneId, status: "failed", stage: "生成失败", error: { message: error?.message ?? "无法开始 Speech 生成。" } };
      render();
      announce(`Speech 生成失败。${error?.message ?? "请重试。"}`);
    }
  }

  async function cancelSpeech(sceneId) {
    const known = state.speechJobs[sceneId];
    if (!known?.id) return;
    try {
      const response = await callHostTool("cancel_scene_speech_job", { jobId: known.id });
      const content = response?.structuredContent ?? response;
      if (response?.isError || !content?.speechJob) throw new Error(content?.error?.message ?? "无法取消 Speech 生成。");
      state.speechJobs[sceneId] = content.speechJob;
      const cancelled = content.speechJob.status === "cancelled";
      if (cancelled) state.focusTarget = `[data-scene-id="${sceneId}"] [data-speech-action]`;
      render();
      announce(cancelled
        ? "Speech 生成已取消；既有 Speech 保持不变。"
        : "Speech 已进入原子提交，无法取消；将继续完成并同步结果。");
      if (!cancelled) scheduleSpeechPoll();
    } catch (error) {
      announce(`无法取消 Speech 生成。${error?.message ?? "请重试。"}`);
    }
  }

  async function importAssets(targetSceneId) {
    if (state.assetBusy || state.autosaveStopped || !state.project) return;
    state.assetImportResults = [];
    state.assetBusy = true;
    render();
    if (!await flushProjectBeforeAssetImport()) {
      state.assetBusy = false;
      state.assetImportResults = [{
        name: "待保存的 Scene 修改",
        status: "failed",
        message: "请先解决保存失败、冲突或身份问题，再导入 Asset。",
      }];
      render();
      announce("Asset 导入已取消：Scene 修改尚未安全保存。");
      return;
    }
    const sourcePaths = await chooseAssetFiles();
    if (sourcePaths.length === 0) {
      state.assetBusy = false;
      render();
      requestAnimationFrame(() => document.querySelector("[data-import-assets]")?.focus());
      return;
    }
    state.assetImportResults = sourcePaths.map((path) => ({ name: assetFilename(path) ?? path, path, status: "copying", message: "" }));
    render();
    for (let index = 0; index < sourcePaths.length; index += 1) {
      const sourcePath = sourcePaths[index];
      const beforeProject = clone(state.project);
      try {
        const response = await callHostTool("import_project_asset", {
          projectDirectory: state.result.project.directory,
          projectId: state.result.project.projectId,
          baselineRevision: state.baselineRevision,
          sourcePath,
          ...(targetSceneId ? { targetSceneId } : {}),
        });
        const content = response?.structuredContent ?? response;
        if (response?.isError || ["save-conflict", "identity-lost", "asset-import-failed"].includes(content?.status)) {
          const failure = content?.error ?? { code: "ASSET_IMPORT_FAILED", message: "Asset 导入失败。" };
          state.assetImportResults[index] = { ...state.assetImportResults[index], status: "failed", message: failure.message };
          if (["save-conflict", "identity-lost"].includes(content?.status)) {
            state.saveStatus = content.status === "save-conflict" ? "conflict" : "identity";
            state.autosaveStopped = true;
          }
        } else {
          const result = content.assetImport ?? { status: "failed", message: "Asset 导入没有返回结果。" };
          state.assetImportResults[index] = { ...state.assetImportResults[index], status: result.status, message: result.message };
          if (result.status.startsWith("imported-") && content.projectDsl) {
            const nextProject = clone(content.projectDsl);
            rebaseHistoryAssets(nextProject.assets);
            if (result.status === "imported-and-bound" && targetSceneId) {
              const undoProject = clone(nextProject);
              const undoScene = undoProject.scenes.find((scene) => scene.id === targetSceneId);
              const beforeScene = beforeProject.scenes.find((scene) => scene.id === targetSceneId);
              if (undoScene && beforeScene) {
                undoScene.assetIds = [...beforeScene.assetIds];
                pushHistory(state.undo, {
                  project: undoProject,
                  selected: state.selected,
                  bytes: new TextEncoder().encode(JSON.stringify(undoProject)).length,
                });
                state.redo = [];
              }
            }
            state.project = nextProject;
            state.baselineRevision = content.projectRevision ?? state.baselineRevision;
            state.version += 1;
            state.savedVersion = state.version;
            state.saveStatus = "saved";
            state.result = { ...state.result, ...content, status: "valid", projectDsl: nextProject };
          }
        }
      } catch (error) {
        state.assetImportResults[index] = { ...state.assetImportResults[index], status: "failed", message: error?.message ?? "宿主导入调用失败。" };
      }
      render();
      announce(`${state.assetImportResults[index].name}：${importStatusLabel(state.assetImportResults[index].status)}。${state.assetImportResults[index].message}`);
    }
    state.assetBusy = false;
    render();
  }

  async function openAssetPreview(assetId) {
    const requestId = ++assetPreviewRequest;
    const projectIdentity = `${state.result?.project?.directory}\u001f${state.result?.project?.projectId}`;
    state.previewReturnAssetId = assetId;
    state.assetPreview = { status: "loading", id: assetId };
    render();
    try {
      const response = await callHostTool("read_project_asset_preview", {
        projectDirectory: state.result.project.directory,
        projectId: state.result.project.projectId,
        assetId,
      });
      if (
        requestId !== assetPreviewRequest || state.previewReturnAssetId !== assetId ||
        projectIdentity !== `${state.result?.project?.directory}\u001f${state.result?.project?.projectId}`
      ) return;
      const content = response?.structuredContent ?? response;
      state.assetPreview = response?.isError || content?.status === "identity-lost"
        ? { status: "identity-lost", id: assetId, reason: content?.error?.message ?? "项目身份已失效。" }
        : content?.assetPreview ?? {
          status: "unavailable", id: assetId, path: "", reason: "预览没有返回可用结果。",
        };
    } catch (error) {
      if (requestId !== assetPreviewRequest || state.previewReturnAssetId !== assetId) return;
      const asset = state.project.assets.find((item) => item.id === assetId);
      state.assetPreview = { status: "unavailable", id: assetId, path: asset?.path ?? "", reason: error?.message ?? "无法读取 Asset 预览。" };
    }
    render();
    document.querySelector("[data-close-preview]")?.focus();
  }

  function closeAssetPreview() {
    assetPreviewRequest += 1;
    document.querySelectorAll(".asset-preview-layer audio,.asset-preview-layer video").forEach((media) => media.pause());
    const assetId = state.previewReturnAssetId;
    state.assetPreview = null;
    state.previewReturnAssetId = null;
    render();
    requestAnimationFrame(() => document.querySelector(`[data-preview-asset="${CSS.escape(assetId ?? "")}"]`)?.focus());
  }

  function trapAssetPreviewFocus(event) {
    if (event.key !== "Tab" || !state.assetPreview) return;
    const layer = document.querySelector(".asset-preview-layer");
    if (!layer) return;
    const focusable = [...layer.querySelectorAll(
      'button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),video[controls],audio[controls],iframe,[tabindex]:not([tabindex="-1"])',
    )];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    const focusOutside = !layer.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || focusOutside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || focusOutside)) {
      event.preventDefault();
      first.focus();
    }
  }

  function trapBriefFocus(event) {
    if (event.key !== "Tab" || !state.brief.open) return;
    const layer = document.querySelector(".brief-layer");
    if (!layer) return;
    const focusable = [...layer.querySelectorAll(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
    )];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    const focusOutside = !layer.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || focusOutside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || focusOutside)) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindSceneRows() {
    document.querySelectorAll("[data-scene-row]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if (event.target.closest("button,textarea,input")) return;
        state.selected = row.dataset.sceneId;
        state.toast = null;
        render();
      });
      row.querySelector(".scene-select")?.addEventListener("click", () => {
        state.selected = row.dataset.sceneId;
        state.toast = null;
        render();
      });
      row.querySelector("[data-edit-narration]")?.addEventListener("click", () => {
        state.selected = row.dataset.sceneId;
        state.editing = row.dataset.sceneId;
        state.editGroupOpen = false;
        state.focusTarget = "[data-narration-editor]";
        render();
      });
      row.querySelector("[data-open-scene-assets]")?.addEventListener("click", () => {
        state.selected = row.dataset.sceneId;
        state.inspectorMode = "scene-assets";
        state.inspectionOpen = true;
        state.assetSearch = "";
        render();
      });
      row.querySelector("[data-speech-action]")?.addEventListener("click", () => startSpeech(row.dataset.sceneId));
      row.querySelector("[data-cancel-speech]")?.addEventListener("click", () => cancelSpeech(row.dataset.sceneId));
      const editor = row.querySelector("[data-narration-editor]");
      editor?.addEventListener("input", () => updateNarration(row.dataset.sceneId, editor.value, editor));
      editor?.addEventListener("blur", (event) => {
        if (event.relatedTarget?.matches?.("[data-expand]")) return;
        state.editGroupOpen = false;
        saveProject();
      });
      row.querySelector("[data-expand]")?.addEventListener("click", () => {
        state.expanded = row.dataset.sceneId;
        state.focusTarget = "[data-expanded-editor]";
        render();
      });
      const handle = row.querySelector(".drag-handle");
      handle?.addEventListener("dragstart", (event) => {
        state.dragged = row.dataset.sceneId;
        row.dataset.dragging = "true";
        event.dataTransfer.effectAllowed = "move";
      });
      handle?.addEventListener("dragend", () => {
        state.dragged = null;
        delete row.dataset.dragging;
      });
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!state.dragged) return;
        state.selected = state.dragged;
        moveScene(currentScenes().findIndex((scene) => scene.id === row.dataset.sceneId));
        state.dragged = null;
      });
    });
  }

  function bindSceneScroll() {
    document.querySelector(".scene-scroll")?.addEventListener("scroll", (event) => {
      const scrollTop = event.currentTarget.scrollTop;
      const next = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3);
      if (next !== state.start) {
        state.start = next;
        render();
        requestAnimationFrame(() => { document.querySelector(".scene-scroll").scrollTop = scrollTop; });
      }
    }, { passive: true });
  }

  function bindTable() {
    document.querySelectorAll("[data-add],[data-add-first]").forEach((button) => button.addEventListener("click", addScene));
    document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", copyScene));
    document.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", deleteScene));
    document.querySelectorAll("[data-move-up]").forEach((button) => button.addEventListener("click", () => moveScene(currentScenes().findIndex((scene) => scene.id === state.selected) - 1)));
    document.querySelectorAll("[data-move-down]").forEach((button) => button.addEventListener("click", () => moveScene(currentScenes().findIndex((scene) => scene.id === state.selected) + 1)));
    document.querySelectorAll("[data-move]").forEach((button) => button.addEventListener("click", () => {
      const input = button.previousElementSibling;
      moveScene(Number(input.value) - 1);
    }));
    document.querySelector("[data-undo]")?.addEventListener("click", undo);
    document.querySelector("[data-redo]")?.addEventListener("click", redo);
    document.querySelector("[data-undo-delete]")?.addEventListener("click", undo);
    document.querySelector("[data-retry]")?.addEventListener("click", () => {
      state.saveStatus = "dirty";
      state.saveError = null;
      render();
      saveProject();
    });
    document.querySelector("[data-close-expanded]")?.addEventListener("click", () => {
      state.expanded = null;
      state.editGroupOpen = false;
      render();
      saveProject();
    });
    const expanded = document.querySelector("[data-expanded-editor]");
    expanded?.addEventListener("input", () => updateNarration(state.expanded, expanded.value, expanded));
    bindSceneScroll();
    bindSceneRows();
  }

  function bindInspector() {
    document.querySelector("[data-close-inspection]")?.addEventListener("click", () => {
      state.inspectionOpen = false;
      document.querySelector(".inspection")?.setAttribute("data-open", "false");
      document.querySelector("[data-open-inspection]")?.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll("[data-project-inspection]").forEach((button) => button.addEventListener("click", () => {
      state.inspectorMode = "project";
      state.assetSearch = "";
      state.ttsBlockedReason = null;
      state.ttsPendingConfirm = null;
      render();
    }));
    document.querySelector("[data-open-brief]")?.addEventListener("click", () => {
      state.brief.open = true;
      state.brief.error = null;
      state.focusTarget = state.brief.conflict ? "[data-brief-merge]" : "[data-brief-editor]";
      render();
    });
    document.querySelector("[data-open-tts]")?.addEventListener("click", () => {
      state.inspectorMode = "tts";
      state.inspectionOpen = true;
      state.ttsBlockedReason = null;
      initializeTtsForm();
      render();
    });
    document.querySelector("[data-manage-project-assets]")?.addEventListener("click", () => {
      state.inspectorMode = "project-assets";
      state.assetSearch = "";
      state.inspectionOpen = true;
      render();
    });
    document.querySelector("[data-add-existing]")?.addEventListener("click", () => {
      state.inspectorMode = "asset-picker";
      state.assetSearch = "";
      render();
      document.querySelector("[aria-label='搜索项目 Asset']")?.focus();
    });
    document.querySelector("[data-scene-assets]")?.addEventListener("click", () => {
      state.inspectorMode = "scene-assets";
      state.assetSearch = "";
      render();
    });
    document.querySelector("[aria-label='搜索项目 Asset']")?.addEventListener("input", (event) => {
      state.assetSearch = event.currentTarget.value;
      render();
      const input = document.querySelector("[aria-label='搜索项目 Asset']");
      input?.focus();
      input?.setSelectionRange(state.assetSearch.length, state.assetSearch.length);
    });
    document.querySelectorAll("[data-import-assets]").forEach((button) => button.addEventListener("click", () => importAssets(button.dataset.targetScene)));
    document.querySelectorAll("[data-add-asset]").forEach((button) => button.addEventListener("click", () => addExistingAsset(button.dataset.addAsset)));
    document.querySelectorAll("[data-preview-asset]").forEach((button) => button.addEventListener("click", () => openAssetPreview(button.dataset.previewAsset)));
    document.querySelectorAll("[data-move-asset]").forEach((button) => button.addEventListener("click", () => {
      const scene = selectedScene();
      const index = scene?.assetIds.indexOf(button.dataset.moveAsset) ?? -1;
      moveAssetReference(button.dataset.moveAsset, index + (button.dataset.direction === "up" ? -1 : 1));
    }));
    document.querySelectorAll("[data-apply-asset-position]").forEach((button) => button.addEventListener("click", () => {
      const input = document.querySelector(`[data-asset-position="${CSS.escape(button.dataset.applyAssetPosition)}"]`);
      moveAssetReference(button.dataset.applyAssetPosition, Number(input?.value) - 1);
    }));
    document.querySelectorAll("[data-unlink-asset]").forEach((button) => button.addEventListener("click", () => unlinkAssetReference(button.dataset.unlinkAsset)));
    document.querySelectorAll("[data-tts-field]").forEach((field) => field.addEventListener("input", () => {
      const key = field.dataset.ttsField;
      state.ttsForm[key] = field.type === "number" ? Number(field.value) : field.value;
      state.ttsPendingConfirm = null;
    }));
    document.querySelector("[data-tts-api-key]")?.addEventListener("input", (event) => {
      state.ttsApiKey = event.currentTarget.value;
      state.ttsClearCredential = false;
    });
    document.querySelector("[data-clear-tts-key]")?.addEventListener("click", () => {
      state.ttsClearCredential = true;
      state.ttsApiKey = "";
      render();
      document.querySelector("[data-tts-api-key]")?.focus();
    });
    document.querySelector("[data-tts-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      saveTtsSettings(false);
    });
    document.querySelector("[data-confirm-tts]")?.addEventListener("click", () => saveTtsSettings(true));
    document.querySelector("[data-cancel-tts-confirm]")?.addEventListener("click", () => {
      state.ttsPendingConfirm = null;
      render();
      document.querySelector(".tts-save")?.focus();
    });
  }

  function bindBriefEditor() {
    if (!state.brief.open) return;
    document.querySelector("[data-close-brief]")?.addEventListener("click", () => {
      state.brief.open = false;
      state.brief.editGroupOpen = false;
      state.focusTarget = "[data-open-brief]";
      saveVideoBrief();
      render();
    });
    document.querySelector("[data-brief-undo]")?.addEventListener("click", () => moveBriefHistory(state.brief.undo, state.brief.redo));
    document.querySelector("[data-brief-redo]")?.addEventListener("click", () => moveBriefHistory(state.brief.redo, state.brief.undo));
    document.querySelector("[data-retry-brief]")?.addEventListener("click", () => {
      state.brief.status = "dirty";
      state.brief.error = null;
      saveVideoBrief();
      updateBriefIndicator();
    });
    const editor = document.querySelector("[data-brief-editor]");
    editor?.addEventListener("input", () => updateBrief(editor.value));
    editor?.addEventListener("blur", (event) => {
      if (event.relatedTarget?.matches?.("[data-brief-undo],[data-brief-redo]")) return;
      state.brief.editGroupOpen = false;
      saveVideoBrief();
    });
    document.querySelectorAll("[data-brief-conflict-tab]").forEach((button) => button.addEventListener("click", () => {
      state.brief.conflictTab = button.dataset.briefConflictTab;
      state.focusTarget = `[data-brief-conflict-tab="${button.dataset.briefConflictTab}"]`;
      render();
    }));
    document.querySelector("[data-brief-merge]")?.addEventListener("input", (event) => {
      state.brief.merge = reconcileBriefEditorText(state.brief.merge, event.currentTarget.value);
    });
    document.querySelector("[data-submit-brief-merge]")?.addEventListener("click", submitBriefMerge);
    document.querySelector("[data-discard-brief-local]")?.addEventListener("click", discardBriefLocal);
    document.querySelector("[data-export-brief-local]")?.addEventListener("click", exportBriefLocal);
  }

  function bind() {
    if (state.result?.status === "launcher") {
      bindLauncher();
      return;
    }
    document.querySelectorAll("[data-workspace]").forEach((tab) => tab.addEventListener("click", () => {
      state.workspace = tab.dataset.workspace;
      state.editGroupOpen = false;
      render();
    }));
    document.querySelector("[data-open-inspection]")?.addEventListener("click", () => {
      state.inspectionOpen = true;
      document.querySelector(".inspection")?.setAttribute("data-open", "true");
      document.querySelector("[data-open-inspection]")?.setAttribute("aria-expanded", "true");
    });
    document.querySelectorAll("[data-agent-action]").forEach((button) => button.addEventListener("click", () => runAgentAction(button.dataset.agentAction)));
    document.querySelector("[data-close-preview]")?.addEventListener("click", closeAssetPreview);
    document.onkeydown = (event) => {
      trapAssetPreviewFocus(event);
      trapBriefFocus(event);
      if (event.key === "Escape" && state.assetPreview) {
        event.preventDefault();
        closeAssetPreview();
      } else if (event.key === "Escape" && state.brief.open) {
        event.preventDefault();
        state.brief.open = false;
        state.brief.editGroupOpen = false;
        state.focusTarget = "[data-open-brief]";
        saveVideoBrief();
        render();
      }
    };
    bindInspector();
    bindBriefEditor();
    if (state.workspace === "table" && state.result?.status === "valid" && state.result.writable) bindTable();
    if (state.result?.status === "valid" && !state.result.writable) {
      document.querySelectorAll("[data-scene-id]").forEach((row) => row.addEventListener("click", () => {
        state.selected = row.dataset.sceneId;
        render();
      }));
      bindSceneScroll();
    }
  }

  function request(method, params) {
    const id = rpcId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error("宿主请求超时，请重试。"));
      }, 15_000);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }

  async function callHostTool(name, args) {
    if (typeof window.openai?.callTool === "function") return window.openai.callTool(name, args);
    return request("tools/call", { name, arguments: args });
  }

  function directoryPath(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return directoryPath(value[0]);
    if (value && typeof value === "object") {
      for (const key of ["path", "directory", "absolutePath"]) if (typeof value[key] === "string") return value[key];
    }
    return null;
  }

  async function chooseDirectory(purpose, trigger) {
    const api = window.openai;
    const picker = api?.selectDirectory ?? api?.pickDirectory ?? api?.requestDirectoryPicker;
    if (typeof picker !== "function") {
      state.launcher.error = { code: "HOST_DIRECTORY_PICKER_UNAVAILABLE", message: "当前插件宿主没有提供系统文件夹选择能力；Narracut 不会退化为网页文件浏览器。" };
      render();
      document.querySelector(trigger)?.focus();
      return null;
    }
    try {
      const selected = await picker.call(api, { purpose, title: purpose === "create-parent" ? "选择新项目的父目录" : "选择要打开的 Project VNext", canCreateDirectories: true });
      const path = directoryPath(selected);
      if (path === null) document.querySelector(trigger)?.focus();
      return path;
    } catch (error) {
      state.launcher.error = { code: "HOST_DIRECTORY_PICKER_FAILED", message: error?.message ?? "系统文件夹选择窗口无法打开，请重试。" };
      render();
      document.querySelector(trigger)?.focus();
      return null;
    }
  }

  async function pickParent() {
    const path = await chooseDirectory("create-parent", "[data-pick-parent]");
    if (path === null) return;
    state.launcher.parentDirectory = path;
    state.launcher.error = null;
    render();
    document.querySelector(".name-field")?.focus();
  }

  function lifecycleFailure(response, fallback, trigger) {
    const error = response?.structuredContent?.error ?? { code: "PROJECT_OPERATION_FAILED", message: fallback };
    state.launcher.busy = false;
    state.launcher.stage = "ready";
    state.launcher.error = error;
    render();
    announce(`${error.code}。${error.message}`);
    requestAnimationFrame(() => document.querySelector(error.code === "PROJECT_TEMPORARY_RESIDUE" ? "[data-confirm-residue]" : trigger)?.focus());
  }

  async function createFromLauncher(confirmTemporaryCleanup = false) {
    if (state.launcher.busy || !launcherVerdict().valid) return;
    state.launcher.busy = true;
    state.launcher.stage = "creating";
    state.launcher.error = null;
    render();
    try {
      const response = await callHostTool("create_project", { projectDirectory: finalProjectPath(), confirmTemporaryCleanup });
      if (response?.isError || response?.structuredContent?.status === "invalid") return lifecycleFailure(response, "项目创建失败，请核对路径后重试。", "[data-create-project]");
      accept(response.structuredContent, true);
    } catch (error) {
      lifecycleFailure({ structuredContent: { error: { code: "PROJECT_CREATE_FAILED", message: error?.message ?? "项目创建失败，请重试。" } } }, "项目创建失败，请重试。", "[data-create-project]");
    }
  }

  async function openFromLauncher() {
    if (state.launcher.busy) return;
    const path = await chooseDirectory("open-project", "[data-open-project]");
    if (path === null) return;
    state.launcher.busy = true;
    state.launcher.stage = "opening";
    state.launcher.error = null;
    render();
    try {
      const response = await callHostTool("open_project", { projectDirectory: path });
      if (response?.isError || response?.structuredContent?.status === "invalid") return lifecycleFailure(response, "项目无法打开，请核对目录后重试。", "[data-open-project]");
      accept(response.structuredContent, response.structuredContent?.project?.sceneCount === 0);
    } catch (error) {
      lifecycleFailure({ structuredContent: { error: { code: "PROJECT_OPEN_FAILED", message: error?.message ?? "项目无法打开，请重试。" } } }, "项目无法打开，请重试。", "[data-open-project]");
    }
  }

  function bindLauncher() {
    document.querySelector("[data-pick-parent]")?.addEventListener("click", pickParent);
    document.querySelector("[data-open-project]")?.addEventListener("click", openFromLauncher);
    document.querySelector("[data-create-project]")?.addEventListener("click", () => createFromLauncher(false));
    document.querySelector("[data-confirm-residue]")?.addEventListener("click", () => createFromLauncher(true));
    document.querySelector(".name-field")?.addEventListener("input", (event) => {
      state.launcher.projectName = event.currentTarget.value;
      state.launcher.error = null;
      render();
      document.querySelector(".name-field")?.focus();
      document.querySelector(".name-field")?.setSelectionRange(state.launcher.projectName.length, state.launcher.projectName.length);
    });
  }

  function schedulePoll(delay = 250) {
    clearTimeout(pollTimer);
    if (state.hostValidation?.status !== "running") return;
    pollTimer = setTimeout(async () => {
      try {
        const response = await request("tools/call", { name: "get_agent_host_validation", arguments: { taskId: state.hostValidation.taskId } });
        pollFailures = 0;
        applyHostValidation(response?.structuredContent?.hostValidation);
      } catch (error) {
        const message = error?.message ?? "无法读取宿主验证状态";
        if (state.agentError !== message) {
          state.agentError = message;
          render();
        }
        pollFailures = Math.min(pollFailures + 1, 4);
        schedulePoll(Math.min(4000, 250 * (2 ** pollFailures)));
      }
    }, delay);
  }

  function applyHostValidation(validation) {
    if (!validation) return;
    const changed = JSON.stringify(state.hostValidation) !== JSON.stringify(validation) || state.agentBusy || state.agentError !== null;
    state.hostValidation = validation;
    state.agentBusy = false;
    state.agentError = null;
    pollFailures = 0;
    if (changed) {
      render();
      const status = statusCopy(validation);
      document.getElementById("agent-status-announcer").textContent = `${status.label}。${status.detail}`;
    }
    schedulePoll();
  }

  async function runAgentAction(action) {
    if (state.agentBusy || !state.result?.project) return;
    const names = { start: "start_agent_host_validation", stop: "stop_agent_host_validation", continue: "continue_agent_host_validation" };
    const args = action === "start" ? { projectDirectory: state.result.project.directory } : { taskId: state.hostValidation?.taskId };
    state.agentBusy = true;
    state.agentError = null;
    render();
    try {
      const response = await request("tools/call", { name: names[action], arguments: args });
      if (response?.isError) throw new Error(response.structuredContent?.error?.message ?? "宿主验证操作失败");
      applyHostValidation(response?.structuredContent?.hostValidation);
    } catch (error) {
      state.agentBusy = false;
      state.agentError = error?.message ?? "宿主验证操作失败";
      render();
    }
  }

  function deriveReadonlyProject(result) {
    return {
      assets: [...new Map((result.scenes ?? []).flatMap((scene) => scene.assets ?? []).map((asset) => [asset.id, asset])).values()],
      scenes: (result.scenes ?? []).map((scene) => ({
        id: scene.id,
        narration: { text: scene.narration },
        assetIds: (scene.assets ?? []).map((asset) => asset.id),
      })),
    };
  }

  function accept(result, focusEmpty = false) {
    assetPreviewRequest += 1;
    clearTimeout(briefSaveTimer);
    activeBriefSavePromise = null;
    const previousProjectId = state.result?.project?.projectId;
    state.result = result;
    state.start = 0;
    state.inspectionOpen = false;
    state.inspectorMode = "project";
    state.assetSearch = "";
    state.assetBusy = false;
    state.assetImportResults = [];
    state.assetPreview = null;
    state.previewReturnAssetId = null;
    state.launcher.busy = false;
    state.launcher.stage = "ready";
    state.project = result?.status === "valid" ? clone(result.projectDsl ?? deriveReadonlyProject(result)) : null;
    state.baselineRevision = result?.projectRevision ?? null;
    state.version = 0;
    state.savedVersion = 0;
    state.saveStatus = "saved";
    state.saveError = null;
    state.autosaveStopped = false;
    state.saveInFlight = false;
    state.undo = [];
    state.redo = [];
    state.editing = null;
    state.expanded = null;
    state.toast = null;
    state.speechJobs = {};
    state.ttsApiKey = "";
    state.ttsClearCredential = false;
    state.ttsSaving = false;
    state.ttsError = null;
    state.ttsBlockedReason = null;
    state.ttsPendingConfirm = null;
    const incomingBrief = result?.videoBrief ?? {
      content: "",
      revision: null,
      bytes: 0,
      state: "empty",
    };
    state.brief = {
      open: false,
      base: incomingBrief.content ?? "",
      local: incomingBrief.content ?? "",
      baselineRevision: incomingBrief.revision ?? null,
      version: 0,
      savedVersion: 0,
      status: "saved",
      error: null,
      saveInFlight: false,
      editGroupOpen: false,
      undo: [],
      redo: [],
      historyBytes: 0,
      conflict: null,
      conflictTab: "base",
      merge: "",
      exporting: false,
      exportMessage: null,
    };
    initializeTtsForm(result?.tts);
    state.selected = result?.status === "valid" ? state.project?.scenes?.[0]?.id ?? null : null;
    state.focusTarget = focusEmpty ? "[data-empty-title]" : null;
    if (previousProjectId !== result?.project?.projectId) {
      state.hostValidation = null;
      state.agentError = null;
      clearTimeout(pollTimer);
      clearTimeout(speechPollTimer);
    }
    render();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (message?.jsonrpc !== "2.0") return;
    if (message.id !== undefined && message.method === undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message ?? "宿主请求失败"));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === "ui/notifications/tool-result") {
      const content = message.params?.structuredContent;
      if (content?.hostValidation) applyHostValidation(content.hostValidation);
      else accept(content, content?.operation === "created" && content?.project?.sceneCount === 0);
    }
  }, { passive: true });

  render();
  window.parent.postMessage({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { appInfo: { name: "narracut-workbench", version: "0.1.0" }, capabilities: {}, protocolVersion: "2025-06-18" } }, "*");
})();

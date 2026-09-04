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

  function inspector(result) {
    const scene = selectedScene();
    const writable = result.writable === true;
    return `<aside class="inspection" aria-label="项目检查" data-open="${state.inspectionOpen}">
      <button type="button" class="inspection-close" data-close-inspection aria-label="关闭项目检查">关闭</button>
      <h2>项目检查</h2><div class="rule"></div><div class="checks">${checks(result)}</div>
      ${scene ? `<section class="selected"><div class="rule"></div><h3>Scene ${pad(currentScenes().indexOf(scene) + 1)}</h3><p class="selected-copy" data-testid="scene-narration-detail">${escapeHtml(scene.narration.text)}</p><dl class="facts"><div class="fact"><dt>Scene ID</dt><dd>${escapeHtml(scene.id)}</dd></div><div class="fact"><dt>Asset</dt><dd>${scene.assetIds.length}</dd></div><div class="fact"><dt>Speech</dt><dd>${scene.speech ? "已生成" : "缺失"}</dd></div></dl></section>` : ""}
      <section class="readonly"><strong data-writable="${writable}">${writable ? "Scene 写入边界" : "只读"}</strong><p>${writable ? "只有表格工作区可以修改 Scene 与 Narration；Asset、Speech、Agent、Preview 和 Render Program 保持只读。" : "当前项目只提供检查。Scene、Narration、Asset 和 Speech 不会在这里被修改。"}</p></section>
    </aside>`;
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
    const disabled = !scene || state.autosaveStopped;
    return `<button class="scene-action" type="button" data-copy ${disabled || currentScenes().length >= 1000 ? "disabled" : ""}>复制</button>
      <button class="scene-action" type="button" data-move-up ${disabled || index <= 0 ? "disabled" : ""}>上移</button>
      <button class="scene-action" type="button" data-move-down ${disabled || index >= currentScenes().length - 1 ? "disabled" : ""}>下移</button>
      <label class="sr-only" for="${inMenu ? "scene-move-mobile" : "scene-move"}">移动到位置</label>
      <input id="${inMenu ? "scene-move-mobile" : "scene-move"}" class="move-field" type="number" min="1" max="${Math.max(1, currentScenes().length)}" value="${Math.max(1, index + 1)}" aria-label="移动到位置" ${disabled ? "disabled" : ""}>
      <button class="scene-action" type="button" data-move ${disabled ? "disabled" : ""}>移动</button>
      <button class="scene-action" type="button" data-delete ${disabled ? "disabled" : ""}>删除</button>`;
  }

  function toolbar() {
    const stopped = state.autosaveStopped;
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

  function sceneRow(scene, index, editable = true) {
    const selected = scene.id === state.selected;
    const assets = assetsFor(scene);
    const asset = assets[0];
    const editing = state.editing === scene.id;
    const speech = scene.speech;
    return `<div class="scene-row" role="group" draggable="false" data-scene-row data-scene-id="${escapeHtml(scene.id)}" data-selected="${selected}" aria-label="Scene ${pad(index + 1)} 行">
      <span class="scene-no">${editable ? `<button class="drag-handle" type="button" draggable="true" aria-label="拖动第 ${index + 1} 行"><span aria-hidden="true"></span></button>` : ""}<button class="scene-select" type="button" aria-label="Scene ${pad(index + 1)}：${escapeHtml(scene.narration.text)}" aria-pressed="${selected}"><strong>${pad(index + 1)}</strong><small>${pad(index + 1)}A</small></button></span>
      <span class="scene-copy">${editable && editing ? `<span class="narration-editor-wrap"><textarea class="narration-editor" aria-label="Scene ${pad(index + 1)} Narration" data-narration-editor>${escapeHtml(scene.narration.text)}</textarea><button class="expand-editor" type="button" data-expand>展开编辑</button></span><small class="narration-help">修改 Narration 会立即移除原 Speech</small>` : `<span class="narration-view">${escapeHtml(scene.narration.text || "空 Narration")}</span>${editable ? '<button class="edit-narration" type="button" data-edit-narration>编辑 Narration</button>' : ""}`}</span>
      <span class="scene-assets"><span class="cell-label">Asset</span><span class="cell-value">${asset ? `${assets.length} Asset` : "无 Asset"}</span><span class="cell-detail">${escapeHtml(asset?.path ?? "未绑定文件")}</span></span>
      <span class="scene-speech"><span class="cell-label">Speech</span><span class="cell-value ${speech ? "ready" : "missing"}">${speech ? "已生成" : "缺失"}</span><span class="cell-detail">${speech ? `${speech.durationMs} ms` : "Draft Duration"}</span></span>
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
    const empty = `<div class="empty-edit"><div><h1 tabindex="-1" data-empty-title>项目中还没有 Scene</h1><p>从第一句 Narration 开始搭建脚本。Scene 会在合法校验后自动保存。</p><button class="scene-action" data-primary="true" type="button" data-add-first>新增第一个 Scene</button><div class="state-code">0 SCENES · PROJECT VNEXT</div></div></div>`;
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
    return `<main class="stage"><section class="agent-panel" aria-labelledby="agent-validation-title">
      <header class="agent-head"><div><h1 id="agent-validation-title">Codex 创作线程验证</h1><p>运行一次固定、只读的宿主任务，核对专用线程的创建、状态回传与驱动权边界。验证结果不是候选 Render Program，也不会修改项目内容。</p></div><div class="protocol-tag">APP SERVER · READ ONLY</div></header>
      <div class="agent-main"><section class="task-board" aria-label="临时任务状态"><h2 class="board-title"><span>临时任务状态</span><span>ONE TASK · ONE DRIVER</span></h2><dl class="status-ledger">
        <div class="status-line"><span class="status-mark" data-status="${status.mark}" aria-hidden="true"></span><dt>任务状态</dt><dd><span>${status.label}</span><span class="replacement-note">${escapeHtml(status.detail)}</span></dd></div>
        <div class="status-line"><span class="status-mark" data-status="${connected ? "connected" : validation ? "unavailable" : "idle"}" aria-hidden="true"></span><dt>线程连接</dt><dd><span>${connected ? "Codex 创作线程已连接" : validation ? "Codex 创作线程不可用" : "等待开始"}</span>${replaced ? '<span class="replacement-note">替代线程已接管</span>' : ""}</dd></div>
        <div class="status-line"><span class="status-mark" data-status="idle" aria-hidden="true"></span><dt>当前 Scene</dt><dd>${scene ? `Scene ${pad(sceneIndex)} 保持选中` : "当前项目没有 Scene"}</dd></div>
        <div class="status-line"><span class="status-mark" data-status="idle" aria-hidden="true"></span><dt>Task ID</dt><dd>${escapeHtml(taskId)}</dd></div><div class="status-line"><span class="status-mark" data-status="idle" aria-hidden="true"></span><dt>Thread</dt><dd>${escapeHtml(threadId)}</dd></div>
      </dl></section><section class="result-board" aria-label="验证结果"><h2 class="board-title"><span>验证结果</span><span>BOUNDED RESULT</span></h2><div class="result-field" data-status="${succeeded ? "succeeded" : status.mark}"><h2>${succeeded ? "验证成功" : running ? "正在验证" : stopped ? "验证已停止" : "等待验证"}</h2><p>${succeeded ? escapeHtml(summary) : running ? "结果只有通过任务身份、当前驱动身份和项目身份校验后才会进入这里。" : stopped ? "已保留最小任务检查点；继续时优先恢复原线程，失效则自动创建替代线程。" : "开始后，Narracut 将自动创建专用 Codex 创作线程；无需选择 Thread 或输入 Thread ID。"}</p>${succeeded ? '<div class="proof-list"><div class="proof-item">任务与当前驱动身份已校验</div><div class="proof-item">项目内容未修改</div></div>' : ""}</div>${diagnostic ? `<div class="agent-diagnostic" role="status"><strong>${escapeHtml(diagnostic.code)}</strong>${escapeHtml(diagnostic.message)}</div>` : ""}</section></div>
      <footer class="agent-actions" aria-label="宿主验证操作"><button class="agent-action" data-agent-action="start" data-kind="primary" type="button" ${state.agentBusy || running || stopped ? "disabled" : ""}>开始验证</button><button class="agent-action" data-agent-action="stop" data-kind="stop" type="button" ${state.agentBusy || !running ? "disabled" : ""}>停止</button><button class="agent-action" data-agent-action="continue" data-kind="primary" type="button" ${state.agentBusy || !stopped ? "disabled" : ""}>继续</button><div class="agent-action-note">不保存对话副本、推理、工具日志或未提交修改</div></footer>
    </section></main>`;
  }

  function valid(result) {
    return `<div class="workspace">${state.workspace === "table" ? table(result) : agent(result)}${inspector(result)}</div>`;
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
        if (!isRecord(speech) || !onlyKeys(speech, ["path", "durationMs", "sourceTextHash", "ttsProfileId"]) ||
          !canonicalPath(speech.path, "speech") || speech.path !== `speech/${scene.id}.mp3` ||
          !Number.isSafeInteger(speech.durationMs) || speech.durationMs <= 0 ||
          typeof speech.sourceTextHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(speech.sourceTextHash) ||
          typeof speech.ttsProfileId !== "string" || [...speech.ttsProfileId].length > 256) return "Speech 必须与 Scene 身份匹配并满足严格资源约束。";
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
    if (undoButton) undoButton.disabled = state.undo.length === 0 || state.autosaveStopped;
    if (redoButton) redoButton.disabled = state.redo.length === 0 || state.autosaveStopped;
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

  async function saveProject() {
    clearTimeout(saveTimer);
    if (state.saveInFlight || state.autosaveStopped || !state.project || state.version === state.savedVersion) return;
    const error = validateSaveIdentity() ?? validateProject(state.project) ?? await validateSpeechHashes(state.project);
    if (error) {
      state.saveStatus = "failed";
      state.saveError = error;
      render();
      announce(`保存失败。${error}`);
      return;
    }
    const savingVersion = state.version;
    state.saveInFlight = true;
    state.saveStatus = "saving";
    updateSaveIndicator();
    try {
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
      if (!state.autosaveStopped && state.saveStatus === "dirty" && state.version > state.savedVersion) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveProject, 0);
      }
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
    if (state.autosaveStopped || !state.project) return;
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
    if (!source || state.autosaveStopped) return;
    const scenes = clone(currentScenes());
    const index = scenes.findIndex((scene) => scene.id === source.id);
    const copy = { id: createUuid(), narration: { text: source.narration.text }, assetIds: [...source.assetIds] };
    scenes.splice(index + 1, 0, copy);
    commitProject({ ...clone(state.project), scenes }, `已复制 Scene ${pad(index + 1)}；副本位于位置 ${index + 2}，Speech 缺失。`, { selected: copy.id, immediate: true });
  }

  function deleteScene() {
    const source = selectedScene();
    if (!source || state.autosaveStopped) return;
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
    if (from < 0 || from === to || state.autosaveStopped) return;
    const [moved] = scenes.splice(from, 1);
    scenes.splice(to, 0, moved);
    commitProject({ ...clone(state.project), scenes }, `Scene 已从位置 ${from + 1} 移动到位置 ${to + 1}。`, { selected: moved.id, immediate: true });
    requestAnimationFrame(() => document.querySelector(`[data-scene-id="${CSS.escape(moved.id)}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  function undo() {
    const previous = state.undo.pop();
    if (!previous || state.autosaveStopped) return;
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
    if (!next || state.autosaveStopped) return;
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
    if (index < 0 || state.autosaveStopped) return;
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
    bindInspector();
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
    const previousProjectId = state.result?.project?.projectId;
    state.result = result;
    state.start = 0;
    state.inspectionOpen = false;
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
    state.selected = result?.status === "valid" ? state.project?.scenes?.[0]?.id ?? null : null;
    state.focusTarget = focusEmpty ? "[data-empty-title]" : null;
    if (previousProjectId !== result?.project?.projectId) {
      state.hostValidation = null;
      state.agentError = null;
      clearTimeout(pollTimer);
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

(() => {
  const app = document.getElementById("app");
  const ROW_HEIGHT = 112;
  const WINDOW_SIZE = 18;
  const HISTORY_BYTE_LIMIT = 24 * 1024 * 1024;
  const pending = new Map();
  let rpcId = 10;
  let hostReady = false;
  let directoryPicking = false;
  let pollTimer = null;
  let pollFailures = 0;
  let saveTimer = null;
  let activeSavePromise = null;
  let briefSaveTimer = null;
  let activeBriefSavePromise = null;
  let assetPreviewRequest = 0;
  let speechPollTimer = null;
  let bindings = new AbortController();
  let composing = false;
  let renderPending = false;
  const renderedRegions = new WeakMap();

  const state = {
    result: null,
    candidate: null,
    candidateBusy: false,
    candidateAction: null,
    candidateError: null,
    candidateConfirm: false,
    candidateDetails: false,
    project: null,
    baselineRevision: null,
    version: 0,
    savedVersion: 0,
    saveStatus: "saved",
    saveError: null,
    autosaveStopped: false,
    saveInFlight: false,
    workspace: "table",
    composerDraft: "",
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
    creationTask: null,
    creationRecovery: null,
    taskOperation: null,
    takeoverOpen: false,
    takeoverDraft: "",
    takeoverBusy: false,
    takeoverError: "",
    takeoverPending: null,
    takeoverBaseline: null,
    candidateUncertain: false,
    externalBusy: false,
    composerRevision: 0,
    creationFocusPending: false,
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

  let recovery = null;
  let identityCheckBusy = false;
  function recoveryArgs(action, extra = {}) {
    return { action, projectDirectory: recovery.project.directory, projectId: recovery.project.projectId, ...extra };
  }
  async function recoveryCall(action, extra) {
    const response = await callHostTool('project_recovery', recoveryArgs(action, extra));
    const content = response?.structuredContent ?? response;
    if (response?.isError) throw new Error(content?.error?.message ?? '恢复操作失败，请重试。');
    return content;
  }
  function freezeIdentity(reason) {
    if (recovery || !state.project) return;
    const draft = {};
    if (state.version !== state.savedVersion) draft.dsl = JSON.stringify(state.project);
    if (state.brief.version !== state.brief.savedVersion || state.brief.conflict) {
      draft.briefLocal = state.brief.conflict ? state.brief.merge : state.brief.local;
      draft.briefBase = state.brief.conflict?.base ?? state.brief.base;
    }
    recovery = { project: clone(state.result.project), reason, draft, phase: 'sealing', cut: null, target: '', message: '', exported: [], operationId: null };
    state.autosaveStopped = true;
    clearTimeout(saveTimer); clearTimeout(briefSaveTimer); clearTimeout(pollTimer); clearTimeout(speechPollTimer);
    bindings.abort(); composing = false;
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    app.inert = true;
    const dialog = document.createElement('dialog');
    dialog.id = 'recovery-page'; dialog.setAttribute('aria-labelledby', 'recovery-title');
    dialog.innerHTML = `<main class="recovery-surface"><header><span class="status-mark" data-status="unavailable" aria-hidden="true"></span><h1 id="recovery-title" tabindex="-1">项目身份已失效，编辑已停止</h1><p data-recovery-reason></p><p class="recovery-path" data-recovery-source></p></header><section aria-label="核对状态"><h2>保存与恢复状态</h2><p data-recovery-status role="status" aria-live="polite"></p><dl class="recovery-list"><div><dt>Scene 与素材引用（DSL）</dt><dd data-recovery-dsl></dd></div><div><dt>Video Brief</dt><dd data-recovery-brief></dd></div></dl></section><section><h2>导出未保存编辑</h2><p>快照只保存未落盘编辑，恢复仍需要匹配的项目持久内容。DSL 内的素材引用不表示包含素材文件。</p><p class="recovery-note">不携带 Render Program、Asset、Speech、离线依赖、Preview、诊断、聊天或未提交 Agent 修改。</p><label class="recovery-target">项目外的新文件路径<input data-recovery-target placeholder="/恢复目录/未保存编辑.narracut-recovery.json" spellcheck="false"></label><div class="recovery-actions"><button class="agent-action" data-recovery-pick>选择导出文件夹…</button><button class="agent-action" data-primary="true" data-recovery-export>导出恢复快照…</button><button class="agent-action" data-recovery-check hidden>核对导出结果</button><button class="agent-action" data-recovery-seal hidden>重新核对保存</button></div><p data-recovery-message role="status" aria-live="polite"></p><ul data-recovery-exports></ul></section><details><summary>项目身份、恢复基线与提交证据</summary><pre data-recovery-details></pre></details><footer><button class="agent-action" data-recovery-leave>返回启动器</button><div data-recovery-leave-confirm hidden><p>尚未成功导出。离开将丢失只保存在内存中的 Scene 或 Brief 改动。</p><div class="recovery-actions"><button class="agent-action" data-recovery-cancel-leave>继续保留并导出</button><button class="agent-action" data-recovery-confirm-leave>确认丢失改动并离开</button></div></div></footer></main>`;
    document.body.append(dialog);
    dialog.addEventListener('cancel', event => event.preventDefault());
    dialog.querySelector('[data-recovery-reason]').textContent = reason;
    dialog.querySelector('[data-recovery-source]').textContent = recovery.project.directory;
    dialog.querySelector('[data-recovery-target]').addEventListener('input', event => { recovery.target = event.target.value; });
    dialog.querySelector('[data-recovery-pick]').addEventListener('click', async () => {
      const picker = window.openai?.selectDirectory ?? window.openai?.pickDirectory ?? window.openai?.requestDirectoryPicker;
      try {
        if (!picker) throw new Error('当前宿主没有目录选择能力。请在上方填写项目外的新文件完整路径。');
        const directory = directoryPath(await picker.call(window.openai));
        if (!directory) { recovery.message = '已取消选择；未保存编辑仍然保留。'; updateRecovery(); return; }
        recovery.target = `${directory.replace(/[\\/]$/, '')}/恢复-${createUuid()}.narracut-recovery.json`;
        dialog.querySelector('[data-recovery-target]').value = recovery.target;
        recovery.message = ''; updateRecovery();
      } catch (error) { recovery.message = error.message; updateRecovery(); }
    });
    dialog.querySelector('[data-recovery-export]').addEventListener('click', () => exportRecovery(false));
    dialog.querySelector('[data-recovery-check]').addEventListener('click', () => exportRecovery(true));
    dialog.querySelector('[data-recovery-seal]').addEventListener('click', sealRecoveryDraft);
    dialog.querySelector('[data-recovery-leave]').addEventListener('click', () => {
      if (!recovery.exported.length && (recovery.cut || Object.keys(recovery.draft).length) && recovery.phase !== 'empty') {
        dialog.querySelector('[data-recovery-leave-confirm]').hidden = false;
        dialog.querySelector('[data-recovery-cancel-leave]').focus();
      } else leaveRecovery();
    });
    dialog.querySelector('[data-recovery-confirm-leave]').addEventListener('click', leaveRecovery);
    dialog.querySelector('[data-recovery-cancel-leave]').addEventListener('click', () => { dialog.querySelector('[data-recovery-leave-confirm]').hidden = true; dialog.querySelector('[data-recovery-leave]').focus(); });
    updateRecovery(); dialog.showModal(); dialog.querySelector('h1').focus();
    void sealRecoveryDraft();
  }
  function updateRecovery() {
    const dialog = document.getElementById('recovery-page'); if (!dialog || !recovery) return;
    const { phase, cut } = recovery;
    const busy = ['sealing', 'exporting', 'checking'].includes(phase);
    const ambiguous = cut && Object.values(cut.baseline).some(value => Array.isArray(value) && value.length > 1);
    dialog.querySelector('[data-recovery-status]').textContent = phase === 'sealing' ? '正在核对已开始的保存' : phase === 'seal-failed' ? '尚未完成核对；内存编辑已冻结并保留' : phase === 'empty' ? '没有需要导出的未保存 Scene 或 Brief 改动' : ambiguous ? '恢复截面已封存；部分提交结果仍待确认，恢复时需要验证两种精确基线。' : '恢复截面已封存；之后的后台结果不会改变此份内容。';
    dialog.querySelector('[data-recovery-dsl]').textContent = cut?.payload.dsl ? `${count(cut.payload.dsl.bytes)} 字节未保存编辑` : ['sealing', 'seal-failed'].includes(phase) ? '正在核对' : '没有待抢救改动';
    dialog.querySelector('[data-recovery-brief]').textContent = cut?.payload.briefLocal ? `${count(cut.payload.briefLocal.bytes)} 字节 LOCAL${cut.payload.briefBase ? '；附带必要 BASE 冲突证据' : ''}` : ['sealing', 'seal-failed'].includes(phase) ? '正在核对' : '没有待抢救改动';
    dialog.querySelector('[data-recovery-export]').disabled = busy || !cut || phase === 'uncertain';
    dialog.querySelector('[data-recovery-export]').textContent = phase === 'exporting' ? '正在导出…' : recovery.exported.length ? '再导出一份' : '导出恢复快照…';
    dialog.querySelector('[data-recovery-check]').hidden = !['uncertain', 'checking'].includes(phase);
    dialog.querySelector('[data-recovery-check]').disabled = busy;
    dialog.querySelector('[data-recovery-seal]').hidden = phase !== 'seal-failed';
    for (const selector of ['[data-recovery-target]', '[data-recovery-pick]']) dialog.querySelector(selector).disabled = busy || phase === 'uncertain' || !cut;
    dialog.querySelector('[data-recovery-leave]').disabled = busy || phase === 'uncertain';
    dialog.querySelector('[data-recovery-message]').textContent = phase === 'uncertain' || phase === 'checking' ? '正在核对导出结果。核对完成前不会重复提交。' : recovery.message;
    dialog.querySelector('[data-recovery-exports]').innerHTML = recovery.exported.map(path => `<li>已确认导出：<code>${escapeHtml(path)}</code></li>`).join('');
    dialog.querySelector('[data-recovery-details]').textContent = JSON.stringify({ projectId: recovery.project.projectId, recoveryCutId: cut?.recoveryCutId, capturedAt: cut?.capturedAt, baseline: cut?.baseline }, null, 2);
  }
  async function sealRecoveryDraft() {
    recovery.phase = 'sealing'; updateRecovery();
    try {
      const result = await recoveryCall('seal', { draft: recovery.draft });
      recovery.cut = result.cut; recovery.phase = result.cut ? 'sealed' : 'empty'; recovery.message = '';
    } catch (error) { recovery.phase = 'seal-failed'; recovery.message = error.message; }
    updateRecovery();
  }
  async function exportRecovery(check) {
    if (!check) recovery.operationId = createUuid();
    recovery.phase = check ? 'checking' : 'exporting'; updateRecovery();
    try {
      const response = await callHostTool('project_recovery', recoveryArgs(check ? 'status' : 'export', { target: recovery.target, operationId: recovery.operationId }));
      const result = response?.structuredContent ?? response;
      if (result?.status === 'recovery-uncertain') { recovery.phase = 'uncertain'; }
      else if (response?.isError) { recovery.phase = 'failed'; recovery.message = result.error?.message ?? '导出失败，请更换位置或重试。'; }
      else if (result?.status !== 'exported' || !result.path) { recovery.phase = 'uncertain'; }
      else { recovery.phase = 'exported'; recovery.exported.push(result.path); recovery.message = '恢复快照已安全导出。原文件保持不变，再导出时请选择新文件。'; }
    } catch { recovery.phase = 'uncertain'; }
    updateRecovery();
  }
  async function leaveRecovery() {
    try {
      const result = await recoveryCall('leave');
      document.getElementById('recovery-page').remove(); app.inert = false; recovery = null; accept(result);
    } catch (error) { recovery.message = error.message; updateRecovery(); }
  }
  setInterval(async () => {
    if (recovery || identityCheckBusy || !state.project || document.hidden) return;
    identityCheckBusy = true;
    try { await callHostTool('project_recovery', { action: 'check', projectDirectory: state.result.project.directory, projectId: state.result.project.projectId }); } catch { /* 宿主断连不等于项目身份失效。 */ }
    finally { identityCheckBusy = false; }
  }, 1500);

  function rail(result) {
    const project = result?.project ?? {};
    const connected = result?.connection?.status === "connected";
    return `<header class="project-rail">
      <div class="brand">Narracut</div>
      <div class="folder"><span class="folder-mark" aria-hidden="true"></span><span>${escapeHtml(project.folderName ?? "等待项目")}</span></div>
      <div class="project-id">${result?.conversation ? conversationDetails(result) : `<strong>PROJECT ID</strong><span>${escapeHtml(project.projectId ?? "—")}</span>`}</div>
      <div class="connection"><span class="lamp" data-status="${connected ? "connected" : "loading"}" aria-hidden="true"></span><span>${connected ? "连接正常" : "连接中"}</span></div>
    </header>`;
  }

  function conversationDetails(result) {
    const conversation = result.conversation;
    return `<details class="conversation-details"><summary>${conversation.status === 'bound' ? '已关联当前对话 · 查看详情' : '对话归属未确认 · 只读'}</summary><dl><dt>项目路径</dt><dd>${escapeHtml(result.project?.directory ?? '尚未选择项目')}</dd><dt>Project ID</dt><dd>${escapeHtml(result.project?.projectId ?? '—')}</dd><dt>Codex 对话</dt><dd>${escapeHtml(conversation.threadId ?? conversation.reason)}</dd></dl></details>`;
  }

  function tabs() {
    return `<nav class="tabs" role="tablist" aria-label="Narracut 工作区">
      <button class="tab" type="button" role="tab" id="workspace-tab-table" aria-controls="workspace-table" data-workspace="table" aria-selected="${state.workspace === "table"}">表格工作区</button>
      <button class="tab" type="button" role="tab" id="workspace-tab-agent" aria-controls="workspace-agent" data-workspace="agent" aria-selected="${state.workspace === "agent"}">Agent 工作区</button>
      <button class="inspection-toggle" type="button" data-open-inspection aria-expanded="${state.inspectionOpen}">打开项目检查</button>
    </nav>`;
  }

  function composer() {
    if (state.result?.conversation) return `<footer class="conversation-footer" data-conversation-footer>${state.result.conversation.status === 'bound' ? '在当前 Codex 对话中表达创作目标；在这里编辑 Scene、审阅候选与输出。' : escapeHtml(state.result.conversation.reason)}</footer>`;
    return `<footer class="composer" aria-label="创作草稿">
      <label class="composer-label" for="composer-draft">Composer</label>
      <div class="composer-field">
        <textarea id="composer-draft" aria-label="Composer" aria-describedby="composer-draft-reason composer-scope" rows="2" maxlength="4000" placeholder="描述这次希望如何调整成片表现…">${escapeHtml(state.composerDraft)}</textarea>
        <p class="composer-reason" id="composer-draft-reason">输入明确目标后开始创作；草稿仅保留在本次会话</p>
        <p class="composer-reason" id="composer-scope">Agent 只修改候选；Scene 请在表格工作区编辑。候选由你决定是否接受。</p>
      </div>
      <button class="composer-send" type="button" disabled aria-describedby="composer-draft-reason">开始创作</button>
    </footer>`;
  }

  function launcherRail() {
    return `<header class="launch-rail"><div class="brand">Narracut</div><div class="launch-title">项目启动台</div><div class="launch-connection">${state.result?.conversation ? conversationDetails(state.result) : '<span class="lamp" aria-hidden="true"></span><span>连接正常</span>'}</div></header>`;
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

  let restoreLauncher = null;
  function launcher() {
    if (restoreLauncher) return '<div data-restore-root></div>';
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
      <aside class="launch-side" aria-label="其他入口"><h2>其他入口</h2><div class="side-actions"><section class="side-entry"><span class="side-folder" aria-hidden="true"></span><div><h3>打开项目</h3><p>严格校验已有 Project VNext</p></div><button class="side-button" type="button" data-open-project ${busy ? "disabled" : ""}>选择项目文件夹</button></section><section class="side-entry"><span class="side-folder" aria-hidden="true"></span><div><h3>从恢复快照创建</h3><p>核对未保存编辑，恢复到新文件夹</p></div><button class="side-button" type="button" data-open-restore>从恢复快照创建</button></section></div></aside>
    </main>`;
  }

  function launcherFooter() {
    const busy = state.launcher.busy;
    return `<footer class="launch-footer"><strong>本地文件系统</strong><span class="footer-rule" aria-hidden="true"></span><span>${busy ? `<span class="launch-busy">${state.launcher.stage === "opening" ? "正在严格校验并取得租约" : "正在写入、复核并原子发布"}</span>` : (restoreLauncher ? "恢复流程 · 最后确认后才写入新目标" : "准备就绪 · 创建过程不联网、不安装依赖")}</span><span class="footer-status" aria-hidden="true"></span></footer>`;
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
      <h2>项目检查</h2>${result.copyReceipt ? `<section class="copy-result" role="status"><strong>独立副本已打开</strong><p>${escapeHtml(result.project.folderName)}<br>${escapeHtml(result.project.directory)}</p><p>项目身份独立，候选保持停止；明确继续后才运行。</p>${result.copyReceipt.warning ? `<p>${escapeHtml(result.copyReceipt.warning.message)}<br>${escapeHtml(result.copyReceipt.warning.path)}</p>` : ""}</section>` : ""}<div class="rule"></div><div class="checks">${checks(result)}</div>
      ${scene ? `<section class="selected"><div class="rule"></div><h3>Scene ${pad(currentScenes().indexOf(scene) + 1)}</h3><p class="selected-copy" data-testid="scene-narration-detail">${escapeHtml(scene.narration.text)}</p><dl class="facts"><div class="fact"><dt>Scene ID</dt><dd>${escapeHtml(scene.id)}</dd></div><div class="fact"><dt>Asset</dt><dd>${scene.assetIds.length}</dd></div><div class="fact"><dt>Speech</dt><dd>${speechReady ? `已生成 · ${seconds(speech.durationMs)}` : "Draft Duration"}</dd></div>${time ? `<div class="fact"><dt>Time Window</dt><dd>帧 ${time.startFrame}–${time.startFrame + time.durationInFrames}（不含 ${time.startFrame + time.durationInFrames}）</dd></div>` : ""}</dl><p class="render-readiness" data-ready="${speechReady}">${speechReady ? "可用于最终 Render" : "仅供草稿 Preview · 阻断最终 Render"}</p></section>` : ""}
      <div class="inspection-actions">${writable ? `<button class="inspection-action" type="button" data-copy-project>复制项目…</button>` : ""}<button class="inspection-action brief-entry" type="button" data-open-brief aria-label="Video Brief ${briefStatusLabel()}" ${state.result?.writable ? "" : "disabled"}><span class="brief-entry-copy"><strong>Video Brief</strong><small>原始 Markdown · video.md</small></span><span data-brief-entry-state>${briefEntryStatusLabel()}</span></button>${writable ? `<button class="inspection-action" type="button" data-open-tts>TTS 配置 <span>${result.tts?.status === "configured" ? "已配置" : "待配置"}</span></button><button class="inspection-action" type="button" data-manage-project-assets>管理项目 Asset <span>${count(state.project?.assets.length ?? 0)}</span></button>` : ""}</div>
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
    return inspectorContent(result).replace('<div class="rule"></div>', `<div class="rule"></div><p class="candidate-summary">候选：<span data-candidate-summary>${candidateLabel()}</span></p>`);
  }

  function inspectorContent(result) {
    if (state.workspace === "agent") return projectInspector({ ...result, writable: false });
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
      <div class="task-notice" data-task-notice>${taskNotice()}</div>
      ${scenes.length === 0 ? empty : `<div class="contact-sheet"><div class="scene-header"><span>Scene</span><span>Narration</span><span>Asset</span><span>Speech</span></div><div class="scene-scroll" tabindex="0" aria-label="Scene 列表"><div class="scene-spacer" style="height:${scenes.length * ROW_HEIGHT}px"><div class="scene-window" style="transform:translateY(${start * ROW_HEIGHT}px)">${rows}</div></div></div></div>`}
      <div class="film-edge"><span>SCENE WRITE BOUNDARY</span><span>${count(scenes.length)} SCENES</span><span>NCUT 01</span></div>
      ${state.toast ? `<div class="undo-toast" role="status"><span>${escapeHtml(state.toast)}</span><button type="button" data-undo-delete>撤销删除</button></div>` : ""}
    </section>${expandedEditor()}</main>`;
  }

  // 沿用暗房工作台：状态后呈现必要待办；所有内容写入由用户明确决定。
  let taskActionBusy = false, proposalView = null, proposalTab = 'diff', seenBriefChange = null;
  function suggestionMarkup(items, required) {
    return items.filter(item => !!item.required === required).map(item => {
      const index = state.project?.scenes?.findIndex(scene => scene.id === item.sceneId) ?? -1;
      return `<article class="scene-todo"><header><h3>${index < 0 ? 'Scene 已删除' : `Scene ${pad(index + 1)}`} · ${escapeHtml(item.action)}</h3><span>${required ? item.satisfied ? '必要条件已满足' : '完成目标所必需' : '可选优化'}</span></header><code>${escapeHtml(item.sceneId)}</code><p>当前观察：${escapeHtml(item.observation)}</p><details><summary>建议值与理由</summary><p class="creation-instruction">${escapeHtml(item.content)}</p><p>理由：${escapeHtml(item.reason)}</p></details>${required ? `<p>继续条件：${escapeHtml(item.condition?.description ?? '等待用户判断')}${index < 0 ? '。目标已删除，继续后重新判断，不会定位其他 Scene。' : ''}</p>` : ''}<div class="todo-actions"><button class="agent-action" data-todo-scene="${escapeHtml(item.sceneId)}" data-todo-field="${escapeHtml(item.condition?.field ?? 'narration')}" ${index < 0 ? 'disabled' : ''}>定位 Scene</button><button class="agent-action" data-todo-copy="${state.creationTask.suggestions.indexOf(item)}">复制建议值</button></div></article>`;
    }).join('');
  }
  function taskInteractions(task) {
    if (!task || task.status === 'terminated' || state.creationRecovery) return '';
    if (task.transferred) return '<div class="creation-details"><p>任务已转移到另一线程。请在新工作台继续操作；本地草稿仍保留。</p><button class="agent-action" disabled>任务由另一线程控制</button></div>';
    const proposal = task.briefProposal, message = task.pendingMessage;
    return `${task.toolApproval ? `<section class="creation-details"><h3>等待工具批准</h3><p>${escapeHtml(task.toolApproval.summary)}</p><div class="todo-actions"><button class="agent-action" data-task-action="approve-tool">批准此工具操作</button><button class="agent-action" data-task-action="reject-tool">拒绝此工具操作</button></div></section>` : ''}${suggestionMarkup(task.suggestions ?? [], true)}${proposal && ['review','stale','rejected'].includes(proposal.status) ? `<section class="creation-details"><h3>Brief 提案</h3><p>${escapeHtml(proposal.purpose)}</p>${proposal.status === 'rejected' ? '<p>已拒绝提案，原 Brief 保留。</p><button class="agent-action" data-task-action="continue">按当前创作指令继续</button>' : `<button class="agent-action" data-review-proposal>审核 Brief 提案</button>${proposal.status === 'stale' ? '<p>Brief 已变化，需要重新生成提案。</p><button class="agent-action" data-task-action="regenerate-brief">重新生成提案</button>' : ''}`}</section>` : ''}${message ? `<section class="creation-details"><h3>确认保存的创作意图</h3><p>${escapeHtml(message.reply)}</p>${message.fragments.map(fragment => `<blockquote class="creation-instruction">${escapeHtml(fragment)}</blockquote>`).join('')}<div class="todo-actions"><button class="agent-action" data-task-action="confirm-message" ${!message.fragments.length ? 'disabled' : ''}>确认追加</button><button class="agent-action" data-task-action="discuss-message">仅作讨论</button><button class="agent-action" data-task-action="edit-message">返回修改</button></div></section>` : ''}${task.discussion ? `<p class="creation-details creation-instruction">${escapeHtml(task.discussion)}</p>` : ''}${taskControls(task)}`;
  }
  function locateSuggestion(id, field = 'narration') {
    if (!state.project?.scenes.some(scene => scene.id === id)) { announce('目标 Scene 已删除，未定位其他 Scene。'); return; }
    state.selected = id;
    const index = state.project.scenes.findIndex(scene => scene.id === id);
    state.start = Math.max(0, index - 3);
    if (field === 'asset') { state.inspectorMode = 'scene-assets'; state.inspectionOpen = true; state.focusTarget = '[data-import-assets]'; }
    else { state.editing = id; state.focusTarget = '[data-narration-editor]'; }
    switchWorkspace('table'); render();
    requestAnimationFrame(() => { const scroll = document.querySelector('.scene-scroll'); if (scroll) scroll.scrollTop = index * ROW_HEIGHT; });
  }
  function unifiedBriefDiff(proposal) {
    const before = proposal.base.split('\n'), after = proposal.content.split('\n');
    return `--- 原 Brief\n+++ 提案结果\n@@ -1,${before.length} +1,${after.length} @@\n${before.map(line => '-'+line).join('\n')}\n${after.map(line => '+'+line).join('\n')}`;
  }
  async function respondTask(action) {
    if (taskActionBusy || state.creationTask?.transferred) return;
    const task = state.creationTask, project = state.result.project;
    const original = task?.pendingMessage?.original;
    if (action === 'edit-message' && state.composerDraft && state.composerDraft !== original) { announce('Composer 已有新草稿，请先保留或清空后再返回修改。'); return; }
    if (action === 'accept-brief' && (state.brief.saveInFlight || state.brief.conflict || state.brief.version !== state.brief.savedVersion)) { announce('请先保存或处理本地 Brief 修改，再接受提案。'); return; }
    taskActionBusy = true;
    state.taskOperation = action === 'stop' ? 'stopping' : action === 'continue' ? 'reconciling' : null;
    updateTaskRegion();
    document.querySelectorAll('[data-task-action]').forEach(button => { button.disabled = true; });
    try {
      const response = await callHostTool('respond_creation_task', { projectDirectory: project.directory, projectId: project.projectId, action, id: action.endsWith('-tool') ? task.toolApproval?.approvalId : action.includes('message') ? task.pendingMessage?.id : task.briefProposal?.id });
      if (state.result.project !== project) return;
      if (response.isError || !response.structuredContent?.creationTask) throw new Error(response.structuredContent?.error?.message ?? '任务操作回执不完整，请重新核对');
      if (action === 'edit-message') { state.composerDraft = original; state.composerRevision++; document.getElementById('composer-draft').value = original; }
      if (action === 'regenerate-brief' || action === 'reject-brief' || action === 'accept-brief' && response.structuredContent.creationTask.briefProposal?.status === 'saved') { proposalView = null; state.brief.open = false; }
      state.taskOperation = null;
      state.creationRecovery = response.structuredContent.creationRecovery ?? null;
      applyCreation(response.structuredContent.creationTask);
      if (proposalView) proposalView = state.creationTask.briefProposal;
      if (!['stop','continue'].includes(action)) render();
      if (action === 'edit-message') document.getElementById('composer-draft')?.focus();
    } catch (error) { state.taskOperation = action === 'stop' ? 'stop-uncertain' : action === 'continue' ? 'connection-uncertain' : null; state.agentError = error.message; updateTaskRegion(); announce(error.message); schedulePoll(); }
    finally { taskActionBusy = false; updateTaskRegion(); bindings.abort(); bindings = new AbortController(); bind(); }
  }
  function taskControls(task) {
    if (!task || task.status === 'terminated' || state.creationRecovery) return '';
    const operation = state.taskOperation ?? task.operation;
    if (operation === 'connection-uncertain' || operation === 'transfer-uncertain') return '<p class="creation-details" role="status" tabindex="-1" id="task-operation-status">线程连接结果待核对</p>';
    if (operation === 'stopping' || operation === 'reconciling') return `<p class="creation-details" role="status" tabindex="-1" id="task-operation-status">${operation === 'stopping' ? '正在停止…' : '正在核对恢复条件…'}</p>`;
    if (operation === 'stop-uncertain') return '<div class="creation-details"><p role="status">停止结果待核对</p><button class="agent-action" data-task-action="stop">重新核对停止结果</button></div>';
    const stop = ['running', 'waiting'].includes(task.status) ? '<button class="agent-action" data-task-action="stop">停止任务</button>' : '';
    const blocked = task.pendingMessage || ['review','stale','rejected'].includes(task.briefProposal?.status) || ['EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED','TOOL_APPROVAL_REQUIRED'].includes(task.waitingReason ?? task.reason);
    const resume = task.status !== 'running' && !blocked ? '<button class="agent-action" data-task-action="continue">继续任务</button>' : '';
    return `<div class="creation-details todo-actions">${stop}${resume}</div>`;
  }
  function updateRecoveryRegion() {
    const region = document.querySelector('[data-task-recovery]');
    if (!region) return;
    const eligible = state.creationRecovery || state.creationTask && state.creationTask.status !== 'terminated' && !state.creationTask.transferred && state.candidate?.candidate;
    region.hidden = !eligible;
    if (!eligible) return;
    if (!region.firstElementChild) {
      region.innerHTML = `<div class="creation-details"><h2 tabindex="-1" id="task-recovery-title">原任务无法恢复</h2><p data-recovery-copy>任务检查点缺失、损坏或与候选不一致，无法继续原任务。候选已保留；这不代表候选损坏。</p><button class="agent-action" data-open-takeover>用新目标接管…</button><form data-takeover-form hidden><label for="takeover-goal">新任务目标</label><textarea id="takeover-goal" rows="4" maxlength="4000" required aria-describedby="takeover-description"></textarea><p id="takeover-description">保留候选字节，终结旧任务，以新 Task ID 和新目标开始创作。旧审批和待办不继承，旧检查与 Preview 证据需重新核对。</p><p>候选对象：<code data-takeover-path></code></p><p data-takeover-error role="status"></p><button type="button" class="agent-action" data-takeover-reconcile hidden>核对操作结果</button><div class="todo-actions"><button class="agent-action" type="submit" data-submit-takeover>开始新任务并接管候选</button><button class="agent-action" type="button" data-cancel-takeover>取消</button></div></form></div>`;
      region.querySelector('[data-open-takeover]').onclick = () => { state.takeoverOpen = true; state.takeoverBaseline = state.creationRecovery?.candidateBaseline ?? state.candidate?.baseline; updateRecoveryRegion(); region.querySelector('textarea').focus(); };
      region.querySelector('[data-cancel-takeover]').onclick = () => { state.takeoverOpen = false; updateRecoveryRegion(); region.querySelector('[data-open-takeover]').focus(); };
      region.querySelector('textarea').value = state.takeoverDraft;
      region.querySelector('textarea').oninput = event => { state.takeoverDraft = event.target.value; };
      region.querySelector('[data-takeover-reconcile]').onclick = () => void takeoverTask();
      region.querySelector('form').onsubmit = event => { event.preventDefault(); void takeoverTask(); };
    }
    region.querySelector('#task-recovery-title').textContent = state.creationRecovery ? '原任务无法恢复' : '用新目标接管候选';
    region.querySelector('[data-recovery-copy]').hidden = !state.creationRecovery;
    region.querySelector('form').hidden = !state.takeoverOpen;
    region.querySelector('[data-open-takeover]').hidden = state.takeoverOpen;
    region.querySelector('[data-takeover-path]').textContent = state.creationRecovery?.candidatePath ?? state.candidate?.candidate?.path ?? '候选暂不可用，请在候选区域处理完整性问题';
    region.querySelector('[data-takeover-error]').textContent = state.takeoverError;
    region.querySelectorAll('button').forEach(button => { button.disabled = state.takeoverBusy || !!state.takeoverPending || state.candidateBusy || state.candidateUncertain || acceptanceWorkbench.blocked() || state.creationTask?.status === 'running' || !!state.creationTask?.operation; });
    region.querySelector('[data-takeover-reconcile]').hidden = !state.takeoverPending;
    region.querySelector('[data-takeover-reconcile]').disabled = state.takeoverBusy;
    region.querySelector('[data-submit-takeover]').textContent = state.takeoverBusy ? '正在核对并接管…' : '开始新任务并接管候选';
  }
  async function takeoverTask() {
    if (state.takeoverBusy || !state.takeoverDraft.trim()) return;
    const project = state.result.project;
    const pending = state.takeoverPending ?? { id: createUuid(), previousTaskId: state.creationTask?.taskId, baseline: state.takeoverBaseline, instruction: state.takeoverDraft };
    const reconciling = !!state.takeoverPending;
    state.takeoverBusy = true; state.takeoverPending = pending; state.takeoverError = '正在核对操作结果'; updateRecoveryRegion(); updateCandidate();
    try {
      let response;
      if (!reconciling) {
        response = await callHostTool('respond_creation_task', { projectDirectory: project.directory, projectId: project.projectId, action: 'takeover', id: pending.id, instruction: pending.instruction, baseline: pending.baseline, parentOrigin: location.origin }).catch(() => null);
      }
      const failure = response?.structuredContent?.error?.message;
      if (!response?.structuredContent?.creationTask || response.isError) response = await callHostTool('get_creation_task', { projectDirectory: project.directory, projectId: project.projectId });
      if (state.result.project !== project) return;
      const value = response?.structuredContent;
      if (!value || response.isError || !('creationTask' in value)) throw new Error('正在核对操作结果；连接恢复后点击“核对操作结果”，核对前不会重复提交。');
      if (value.candidate) state.candidate = value.candidate;
      state.creationRecovery = value.creationRecovery ?? null;
      const next = value.creationTask;
      if (next && next.taskId === pending.id && !state.creationRecovery) {
        state.takeoverPending = null; state.takeoverOpen = false; state.takeoverDraft = ''; state.takeoverError = '';
        applyCreation(next); previewWorkbench.superseded(); await deliveryWorkbench.refresh().catch(() => {});
        document.getElementById('creation-task-title')?.focus();
      } else {
        state.takeoverPending = null;
        state.takeoverError = failure ?? '接管尚未提交，请核对候选对象后再次明确提交。';
        state.takeoverBaseline = state.creationRecovery?.candidateBaseline ?? state.candidate?.baseline;
        applyCreation(next);
      }
    } catch (error) { if (state.result.project === project) state.takeoverError = `正在核对操作结果。${error.message}`; }
    finally { if (state.result.project === project) { state.takeoverBusy = false; updateRecoveryRegion(); updateCandidate(); } }
  }
  const creationStages = { read: "读取项目", modify: "修改候选", check: "运行检查", preview: "构建 Preview", frames: "检查代表帧", deliver: "准备交付" };
  const creationStopCopy = {
    USER_STOPPED: ['你已停止任务', '点击“继续任务”，从检查点与最新项目内容重新开始。'],
    APP_RESTARTED: ['应用已重启', '点击“继续任务”，重新核对检查点与最新项目内容。'],
    CODEX_USAGE_LIMIT: ['Codex 额度受限', '额度恢复后点击“继续任务”。'],
    CODEX_AUTH_REQUIRED: ['Codex 需要认证', '完成 Codex 认证后点击“继续任务”。'],
    CODEX_UNAVAILABLE: ['Codex 服务不可用', '服务恢复后点击“继续任务”。'],
    CODEX_THREAD_UNAVAILABLE: ['原线程不可用', '点击“继续任务”，自动尝试替代线程。'],
    CODEX_INTERRUPTED: ['Codex 已中断', '点击“继续任务”。'],
    NO_PROGRESS: ['连续多轮没有新的持久成果', '查看当前指令与已有成果，明确继续后重新尝试。'],
  };
  function agent(result) {
    const task = state.creationTask;
    const briefPending = result.currentRenderProgram?.briefReviewPending;
    const label = task?.transferred ? "任务已转移到另一线程" : [state.taskOperation, task?.operation].some(value => ["connection-uncertain", "transfer-uncertain"].includes(value)) ? "线程连接结果待核对" : state.taskOperation === "stopping" || task?.operation === "stopping" ? "正在停止…" : state.taskOperation === "stop-uncertain" || task?.operation === "stop-uncertain" ? "停止结果待核对" : state.taskOperation === "reconciling" || task?.operation === "reconciling" ? "正在核对恢复条件…" : state.creationRecovery ? "原任务无法恢复" : state.agentBusy ? "正在创建创作任务" : !task ? "尚无任务" : { running: "运行中", waiting: "等待用户", stopped: "已停止", terminated: "已终结" }[task.status];
    const reason = task?.transferred ? null : creationStopCopy[task?.reason]?.[0] ?? { USER_STOPPED: "你已停止任务", CODEX_INTERRUPTED: "Codex 已中断", CODEX_THREAD_UNAVAILABLE: "原线程不可用", CODEX_UNAVAILABLE: "Codex 暂不可用", NO_PROGRESS: "连续多轮没有新的持久成果", EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED: "候选已被外部修改", CANDIDATE_READY: "候选已就绪", CANDIDATE_ACCEPTED: "候选已接受", CANDIDATE_ABANDONED: "候选已放弃", TASK_SUPERSEDED: "已被新目标取代", APP_RESTARTED: "应用已重启" }[task?.reason];
    return `<main class="stage"><section class="agent-panel creation-panel" aria-labelledby="creation-task-title">
      <header class="agent-head"><div><h1 id="creation-task-title" tabindex="-1">当前创作指令</h1>${task ? `<p class="creation-instruction">${escapeHtml(task.instruction.slice(0, 200))}${task.instruction.length > 200 ? "…" : ""}</p>${task.instruction.length > 200 ? `<details><summary>展开完整原文</summary><p class="creation-instruction">${escapeHtml(task.instruction)}</p></details>` : ""}` : '<p>在下方 Composer 描述这次希望如何调整成片表现。</p>'}</div></header>
      <div class="creation-state"><span class="status-mark" data-status="${task?.status === "running" && !task.transferred && !state.taskOperation && !task.operation ? "running" : task ? "stopped" : "idle"}" aria-hidden="true"></span><h2>${label}${task?.status === "running" && task.pending ? " · 正在跟进最新项目内容" : ""}${reason ? ` · ${reason}` : ""}</h2>${task?.status === "running" && !task.transferred ? `<p>${creationStages[task.stage] ?? "读取项目"}</p>` : ""}</div>
      ${task?.status === "stopped" && !task.transferred && creationStopCopy[task.reason] ? `<p class="creation-details">${creationStopCopy[task.reason][1]} 候选与有效检查点已保留，不会后台重试。</p>` : ""}
      ${state.agentError ? `<p class="agent-diagnostic" role="alert">${escapeHtml(state.agentError)} · 草稿已保留，可重试。</p>` : ""}
      ${task ? `<section class="creation-details creation-saved"><h3>已保存成果</h3><p>${task.lastSafeStage ? `已保存至：${{read:'项目读取',modify:'候选修改',check:'候选检查',preview:'候选 Preview',frames:'代表帧检查',deliver:'候选交付'}[task.lastSafeStage]}` : '尚无已完成的安全阶段'}</p>${task.status === 'stopped' ? '<p>未完成的修改、工具调用和中间判断不会恢复，必要时会重新执行。检查与 Preview 证据需要重新核对；应用不会自动继续。</p>' : ''}${task.connectionNotice === 'taken-over' ? '<p>任务已由此工作台接管；仍是同一任务，原有停止与等待条件继续有效。</p>' : ''}${task.replacementThread && !task.transferred ? '<p>原线程不可用，已连接替代线程；仍是同一任务。</p>' : ''}</section>` : ''}
      ${task?.pending && !task.transferred ? `<div class="agent-diagnostic"><h3>待处理事项</h3><p>${escapeHtml(task.pending)}</p>${(task.waitingReason ?? task.reason) === "EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED" ? `<button class="agent-action" data-continue-external ${state.externalBusy ? "disabled" : ""}>${state.externalBusy ? "正在核对候选" : "基于外部候选继续"}</button>` : ""}${task.reason === "SCENE_CHANGE_REQUIRED" ? '<button class="agent-action" data-scene-suggestion>前往表格工作区修改 Scene</button>' : ""}</div>` : ""}
      ${taskInteractions(task)}
      ${briefPending !== false ? `<div class="agent-diagnostic" data-brief-review="${briefPending === true}"><strong>${briefPending ? "Brief 待复核" : "Brief 关系未检查"}</strong><p>${briefPending ? "当前 Render Program 与既有 Preview 保持不变" : "打开可写项目后校验当前 Render Program 的 Brief 指纹"}</p></div>` : ""}
      ${task?.divergence ? `<div class="agent-diagnostic"><h3>与 Video Brief 的分歧</h3><div class="brief-divergence"><section><h4>Video Brief</h4><p class="creation-instruction">${escapeHtml(state.brief.base)}</p></section><section><h4>本次用户要求</h4><p class="creation-instruction">${escapeHtml(task.instruction)}</p></section></div><p>${escapeHtml(task.divergence)}</p><p>本次成片表现遵循上方用户原文；Scene、Speech、时间与安全硬约束保持有效。</p></div>` : ""}
      ${task ? `<details class="creation-details"><summary>任务详情</summary><dl><dt>原因</dt><dd>${escapeHtml(task.reason ?? "无")}</dd><dt>Task ID</dt><dd>${escapeHtml(task.taskId)}</dd><dt>线程连接</dt><dd>${escapeHtml(task.threadPointer ?? "尚未连接")}</dd><dt>最后完成的安全阶段</dt><dd>${creationStages[task.lastSafeStage] ?? "尚无"}</dd><dt>Agent 任务检查点</dt><dd>${task.status === "terminated" ? "任务已终结，检查点已消费" : state.creationRecovery ? "无法恢复；候选字节已保留" : task.candidateBaseline ? "已保留，用于继续此任务" : "尚无"}</dd></dl></details>` : ""}
      ${task?.reason === "CANDIDATE_READY" ? '<footer class="agent-actions"><button class="agent-action" data-show-delivery>查看候选交付</button></footer>' : ""}
    </section></main>`;
  }

  function taskNotice() {
    const task = state.creationTask;
    return task ? `<span>${task.transferred ? '任务已转移到另一线程' : state.taskOperation === 'stopping' || task.operation === 'stopping' ? '正在停止…' : state.taskOperation === 'stop-uncertain' || task.operation === 'stop-uncertain' ? '停止结果待核对' : task.status === 'running' ? task.pending ? '运行中 · 正在跟进最新项目内容' : 'Agent 正在创作' : task.status === 'stopped' ? `已停止 · ${creationStopCopy[task.reason]?.[0] ?? '候选与任务检查点已保留'}` : escapeHtml(task.pending ?? (task.status === 'terminated' ? '任务已终结' : '等待用户'))}</span><button class="agent-action" data-view-task>查看任务</button>${["running","waiting"].includes(task.status) && !task.transferred && !state.creationRecovery ? `<button class="agent-action" data-task-action="stop" ${taskActionBusy || task.operation === "stopping" ? "disabled" : ""}>${state.taskOperation === "stopping" || task.operation === "stopping" ? "正在停止…" : "停止任务"}</button>` : ""}` : '';
  }
  function updateTaskRegion() {
    updateRecoveryRegion();
    const notice = document.querySelector('[data-task-notice]');
    if (notice) updateRegion(notice, taskNotice());
    const region = document.querySelector('[data-agent-content]');
    if (!region) return;
    const focused = region.contains(document.activeElement) ? document.activeElement : null;
    const details = [...region.querySelectorAll('details')].map(node => node.open);
    const summaries = [...region.querySelectorAll('summary')];
    const focusIndex = summaries.indexOf(focused);
    const focusId = focused?.id;
    const focusAction = focused?.dataset.taskAction;
    updateRegion(region, agent(state.result));
    const optional = document.querySelector("[data-optional-suggestions]");
    if (optional) updateRegion(optional, suggestionMarkup(state.creationTask?.suggestions ?? [], false));
    [...region.querySelectorAll('details')].forEach((node, index) => { node.open = details[index] ?? false; });
    if (focused && !focused.isConnected) {
      const next = focusId ? document.getElementById(focusId) ?? region.querySelector('[data-task-action]') ?? document.getElementById('creation-task-title') : focusAction ? region.querySelector(`[data-task-action="${focusAction}"]`) ?? document.getElementById('task-operation-status') ?? region.querySelector('[data-task-action]') ?? document.getElementById('creation-task-title') : region.querySelectorAll('summary')[focusIndex];
      next?.focus({ preventScroll: true });
    }
  }

  function updateComposer() {
    const button = document.querySelector('.composer-send');
    const reason = document.getElementById('composer-draft-reason');
    if (reason) { reason.textContent = state.creationTask?.transferred ? "任务已转移到另一线程；本地草稿仍保留" : state.agentError ? `${state.agentError} · 草稿已保留。` : state.creationTask && state.creationTask.status !== 'terminated' ? '发送到同一任务；仅明确创作要求会保存为当前创作指令' : '输入明确目标后开始创作；草稿仅保留在本次会话'; reason.setAttribute('role', 'status'); }
    if (button) { button.disabled = !!state.creationTask?.transferred || !!state.creationTask?.toolApproval || !!state.creationRecovery || !!state.taskOperation || !!state.creationTask?.operation || state.agentBusy || !state.composerDraft.trim() || !state.result?.writable; button.textContent = state.agentBusy ? state.creationTask && state.creationTask.status !== 'terminated' ? '正在发送' : '正在创建创作任务' : state.creationTask && state.creationTask.status !== 'terminated' ? '发送' : '开始创作'; }
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
    if (proposalView) {
      const proposal = state.creationTask?.briefProposal ?? proposalView;
      return `<div class="brief-layer" role="dialog" aria-modal="true" aria-labelledby="brief-review-title"><section class="brief-sheet"><header class="brief-head"><div><h1 id="brief-review-title">审核 Brief 提案</h1><p>${escapeHtml(proposal.purpose)}</p></div><button type="button" data-close-brief>关闭</button></header><main class="brief-proposal-main"><div class="todo-actions"><button class="agent-action" data-proposal-tab="diff" aria-pressed="${proposalTab === 'diff'}">统一 diff</button><button class="agent-action" data-proposal-tab="full" aria-pressed="${proposalTab === 'full'}">完整结果</button></div><p>${proposalTab === 'diff' ? '− 表示删除，+ 表示新增；接受将保存下方完整变化。' : '提案的完整 Markdown 结果 · 只读'}</p><textarea readonly aria-label="${proposalTab === 'diff' ? '统一 diff' : '完整结果'}">${escapeHtml(proposalTab === 'diff' ? unifiedBriefDiff(proposal) : proposal.content)}</textarea>${proposal.status === 'stale' ? '<p role="alert">Brief 已变化，不能覆盖最新内容。请重新生成提案。</p>' : ''}<div class="todo-actions"><button class="agent-action" data-kind="primary" data-task-action="accept-brief" ${proposal.status !== 'review' ? 'disabled' : ''}>接受并保存 Brief</button><button class="agent-action" data-task-action="reject-brief">拒绝提案</button>${proposal.status === 'stale' ? '<button class="agent-action" data-task-action="regenerate-brief">重新生成提案</button>' : ''}</div></main></section></div>`;
    }
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

  function candidateLabel() {
    if (state.candidateBusy) return { read: "正在检查完整性", create: "正在创建", discard: "正在放弃" }[state.candidateAction] ?? "正在保存";
    return { absent: "尚无候选", saved: "已保存 · 尚未接受", "external-change": "外部变化 · 需要重新检查", "integrity-failed": "完整性失败 · 现场已保留" }[state.candidate?.status] ?? "候选状态尚未读取";
  }

  function candidatePanel() {
    const candidate = state.candidate;
    const absent = candidate?.status === "absent";
    const disabled = state.candidateBusy || state.takeoverBusy || !!state.takeoverPending || state.candidateUncertain || acceptanceWorkbench.blocked() || state.creationTask?.status === 'running' || !!state.creationTask?.operation || state.autosaveStopped || !state.result?.writable;
    return `<section class="candidate-panel" aria-labelledby="candidate-title"><header><h2 id="candidate-title">候选 Render Program</h2><span class="candidate-save" role="status"><span class="status-mark" data-status="${candidate?.status === "saved" ? "succeeded" : "unavailable"}" aria-hidden="true"></span>${candidateLabel()}</span></header>
      <p>${absent ? "从当前修订建立唯一可写候选。创建后尚未接受。" : "Agent、人工与受控工具共享这个候选。停止活动或切换工作区都会保留它。"}</p>
      <dl><div><dt>检查</dt><dd>检查批次与操作条件见下方；构建与播放见上方成片 Preview</dd></div><div><dt>恢复检查点</dt><dd>${candidate?.checkpoint ? "上一份完整候选已保留" : "尚无恢复检查点"}</dd></div></dl>
      ${state.candidateError || candidate?.error ? `<p class="candidate-error" role="alert">${escapeHtml((state.candidateError ?? candidate.error).message)}</p>` : ""}
      ${state.candidateUncertain ? '<p role="status">正在核对操作结果；核对前不会重复提交。</p><button class="agent-action" data-candidate-action="read">核对操作结果</button>' : ''}<div class="candidate-actions">${absent ? `<button type="button" class="agent-action primary" data-candidate-action="create" ${disabled ? "disabled" : ""}>从当前修订创建候选</button>` : ""}<button type="button" class="agent-action" data-candidate-action="read" ${disabled ? "disabled" : ""}>重新检查完整性</button>${candidate && !absent ? `<button type="button" class="agent-action" data-candidate-discard ${disabled ? "disabled" : ""}>放弃候选</button>` : ""}</div>
      <details ${state.candidateDetails ? "open" : ""} data-candidate-details><summary>身份与完整性详情</summary><dl><div><dt>来源修订</dt><dd>${escapeHtml(candidate?.sourceRevision ?? "尚未读取")}</dd></div>${[ ["候选", candidate?.candidate], ["恢复检查点", candidate?.checkpoint] ].map(([label, ref]) => ref ? `<div><dt>${label}路径</dt><dd><code>${escapeHtml(ref.path)}</code></dd></div><div><dt>${label}完整树身份</dt><dd><code>${escapeHtml(ref.identity)}</code></dd></div>` : "").join("")}</dl><p>完整性检查核对目录、普通文件和完整树字节；不表示源码、类型或构建检查通过。恢复替换与损坏导出尚未接入。</p></details>
      ${state.candidateConfirm ? `<div class="candidate-confirm" role="alertdialog" aria-modal="true" aria-labelledby="candidate-discard-title" aria-describedby="candidate-discard-help"><h3 id="candidate-discard-title">放弃候选并终结任务？</h3><p id="candidate-discard-help">候选、候选恢复检查点和 Agent 任务检查点将一起删除，并终结旧任务。当前修订保留，操作不可撤销。</p><div class="candidate-actions"><button type="button" class="agent-action" data-candidate-cancel>取消</button><button type="button" class="agent-action" data-candidate-action="discard">放弃候选并终结任务</button></div></div>` : ""}</section>`;
  }

  function updateCandidate() {
    if (composing) return;
    const region = document.querySelector("[data-candidate-region]");
    const active = region?.contains(document.activeElement) ? document.activeElement : null;
    const focusSelector = active?.matches("[data-candidate-discard]") ? "[data-candidate-discard]"
      : active?.matches("[data-candidate-cancel]") ? "[data-candidate-cancel]"
      : active?.matches("summary") ? "[data-candidate-details] summary"
      : active?.dataset.candidateAction ? `[data-candidate-action="${active.dataset.candidateAction}"]` : null;
    updateRegion(region, candidatePanel());
    document.querySelectorAll("[data-candidate-summary]").forEach(node => { node.textContent = candidateLabel(); });
    if (focusSelector) region?.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  async function candidateOperation(action, quiet = false) {
    if (state.candidateBusy || (action !== 'read' && (state.takeoverBusy || state.takeoverPending || state.candidateUncertain || acceptanceWorkbench.blocked())) || !state.result?.writable || state.autosaveStopped || (quiet && state.candidateConfirm)) return;
    const project = state.result.project;
    state.candidateBusy = true;
    state.candidateAction = action;
    if (!quiet) { state.candidateError = null; updateCandidate(); }
    try {
      const response = await callHostTool("manage_project_candidate", { projectDirectory: project.directory, projectId: project.projectId, action, ...(action === "discard" ? { baseline: state.candidate?.baseline, confirmed: true } : {}) });
      if (state.result?.project !== project) return;
      const content = response?.structuredContent;
      if (content?.candidate) {
        state.candidate = content.candidate; state.candidateError = null;
        if (action === 'discard' || state.candidateUncertain) {
          state.candidateUncertain = false;
          if (content.candidate.status === 'absent') {
            previewWorkbench.discarded(); await deliveryWorkbench.refresh().catch(() => {});
            const taskResult = await callHostTool('get_creation_task', { projectDirectory: project.directory, projectId: project.projectId }).catch(() => null);
            if (taskResult?.structuredContent && 'creationTask' in taskResult.structuredContent) applyCreation(taskResult.structuredContent.creationTask);
          } else state.candidateError = { message: '候选仍存在；请重新核对后明确放弃。' };
        }
      }
      else if (content?.error) {
        state.candidateError = content.error;
        if (action === 'discard' && content.error.code === 'CANDIDATE_SAVE_FAILED') state.candidateUncertain = true;
        if (content.error.code === "PROJECT_IDENTITY_LOST") state.autosaveStopped = true;
      } else if (!quiet) { state.candidateUncertain ||= action === 'discard'; state.candidateError = { message: '正在核对操作结果，请点击核对操作结果。' }; }
    } catch (error) {
      if (state.result?.project === project && !quiet) { state.candidateUncertain ||= action === 'discard'; state.candidateError = { message: state.candidateUncertain ? '正在核对操作结果，请点击核对操作结果。' : error.message }; }
    } finally {
      if (state.result?.project === project) {
        state.candidateBusy = false;
        if (action === "discard") state.candidateConfirm = false;
        updateCandidate();
        if (action === "discard") document.querySelector("[data-candidate-action]")?.focus();
      }
    }
  }

  // 事件委托使后台状态刷新不重绑 Composer、Scene 或候选控件。
  app.addEventListener("click", event => {
    const action = event.target.closest("[data-candidate-action]");
    if (action && !action.disabled) candidateOperation(action.dataset.candidateAction);
    if (event.target.closest("[data-candidate-discard]")) {
      state.candidateConfirm = true; updateCandidate();
      document.querySelector("[data-candidate-cancel]")?.focus();
    }
    if (event.target.closest("[data-candidate-cancel]")) {
      state.candidateConfirm = false; updateCandidate();
      document.querySelector("[data-candidate-discard]")?.focus();
    }
  });
  app.addEventListener("toggle", event => {
    if (event.target.matches?.("[data-candidate-details]")) state.candidateDetails = event.target.open;
  }, true);
  app.addEventListener("keydown", event => {
    if (!state.candidateConfirm) return;
    if (event.key === "Escape") { event.preventDefault(); document.querySelector("[data-candidate-cancel]")?.click(); }
    if (event.key === "Tab") {
      const buttons = [...document.querySelectorAll(".candidate-confirm button")];
      event.preventDefault();
      buttons[(buttons.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  });
  setInterval(() => { if (!document.hidden && state.candidate) candidateOperation("read", true); }, 4000);

  const previewWorkbench = createPreviewWorkbench((action, args) => callHostTool("project_preview", { projectDirectory: state.result.project.directory, projectId: state.result.project.projectId, action, ...args }), () => state.result?.project, instanceId => deliveryWorkbench.candidateReady(instanceId));
  const deliveryWorkbench = createDeliveryWorkbench((action, args) => callHostTool(action === "displayed" ? "project_delivery_display" : "project_delivery", { projectDirectory: state.result.project.directory, projectId: state.result.project.projectId, ...(action === "displayed" ? {} : { action }), ...args }), () => state.result?.project ? { ...state.result.project, hasCandidate: !!state.candidate?.candidate, scenes: currentScenes() } : undefined, previewWorkbench, id => locateSuggestion(id));
  const finalRenderWorkbench = createRenderWorkbench(
    (action, args) => callHostTool('project_render', { projectDirectory: state.result.project.directory, projectId: state.result.project.projectId, action, ...args }),
    () => state.result?.project,
    () => state.version === state.savedVersion && !state.saveInFlight && !state.autosaveStopped && !state.assetBusy && state.brief.version === state.brief.savedVersion && !state.brief.saveInFlight && !state.brief.conflict && state.result?.writable !== false,
    previewWorkbench, location => {
      const sceneId = location?.sceneId ?? state.result?.scenes.find(scene => scene.assets?.some(asset => asset.path === location?.path))?.id;
      if (sceneId) state.selected = sceneId;
      switchWorkspace('table'); render();
    }, createUuid,
  );
  const acceptanceWorkbench = createAcceptanceWorkbench(
    (action, args) => callHostTool('project_acceptance', { projectDirectory: state.result.project.directory, projectId: state.result.project.projectId, action, ...args }),
    () => state.result?.project,
    () => !state.takeoverBusy && !state.takeoverPending && !state.candidateUncertain && !(state.candidateBusy && state.candidateAction !== 'read') && state.creationTask?.status !== 'running' && !state.creationTask?.operation && state.version === state.savedVersion && !state.saveInFlight && !state.autosaveStopped && !state.assetBusy && state.brief.version === state.brief.savedVersion && !state.brief.saveInFlight && !state.brief.conflict,
    deliveryWorkbench, previewWorkbench,
    async (result) => {
      if (result?.status === 'accepted' && result.revision.valid !== false && result.revision.current !== false) {
        state.result.currentRenderProgram = { briefRevision: result.revision.briefFingerprint, briefReviewPending: result.revision.briefFingerprint !== state.brief.baselineRevision, previewPreserved: true };
      }
      if (result && 'creationTask' in result) applyCreation(result.creationTask);
      await candidateOperation('read'); await deliveryWorkbench.refresh(); render();
    }
  );
  const checksWorkbench = createChecksWorkbench((action, args) => callHostTool("project_checks", { projectDirectory: state.result.project.directory, projectId: state.result.project.projectId, action, ...args }), () => state.result?.project, location => {
    if (location.kind === "scene" && state.result?.scenes.some(scene => scene.id === location.sceneId)) { state.selected = location.sceneId; previewWorkbench.selectScene(location.sceneId); render(); }
    if (location.kind === "frame") previewWorkbench.navigateFrame(location);
  });

  function valid(result) {
    return `<div class="workspace"><div class="workspace-panel" id="workspace-table" role="tabpanel" aria-labelledby="workspace-tab-table"></div><div class="workspace-panel" id="workspace-agent" role="tabpanel" aria-labelledby="workspace-tab-agent"><div data-agent-content></div><section class="agent-panel" data-task-recovery hidden></section><section class="creation-optional" data-optional-suggestions></section><section class="delivery-panel" data-program-delivery aria-label="候选交付"></section><section class="preview-context" data-program-preview aria-label="成片 Preview"></section><section class="preview-context" data-final-render aria-label="最终 Render"></section><div data-candidate-region></div><section class="checks-panel" data-program-checks aria-label="检查与操作状态"></section><section class="preview-context"><button class="agent-action" type="button" data-scene-suggestion>前往表格工作区修改 Scene</button><p>Scene 修改建议由你在表格工作区手工完成。</p></section></div><div data-inspector-region></div></div><div data-overlay-region></div>`;
  }

  function invalid(result) {
    const error = result.error ?? {};
    if (error.code === 'HOST_INITIALIZATION_FAILED') {
      return `<main class="stage"><section class="state-panel"><div class="state-copy"><h1>工作台连接失败</h1><p>${escapeHtml(error.message)}</p><p>请重新打开 Narracut 项目启动器。</p><div class="state-code">HOST_INITIALIZATION_FAILED</div></div></section></main>`;
    }
    const diagnostics = error.diagnostics ?? [];
    return `<div class="workspace"><main class="stage"><section class="state-panel"><div class="state-copy"><h1>项目无法打开</h1><p>${escapeHtml(error.message ?? "项目检查失败，请核对目录与内容后重试。")}</p><div class="state-code">${escapeHtml(error.code ?? "PROJECT_INSPECTION_FAILED")}</div><ul class="diagnostics">${diagnostics.map((item) => `<li><strong>${escapeHtml(item.component)}</strong><br><span>${escapeHtml(item.message)}</span></li>`).join("")}</ul></div></section></main><aside class="inspection" aria-label="项目检查" data-open="${state.inspectionOpen}"><button type="button" class="inspection-close" data-close-inspection aria-label="关闭项目检查">关闭</button><h2>项目检查</h2><div class="rule"></div><section class="readonly"><strong>只读检查失败</strong><p>错误已同时返回给模型与工作台；Narracut 未修改该目录。</p></section></aside></div>`;
  }

  function loading() {
    return `<div class="workspace"><main class="stage"><section class="state-panel"><div class="loading" aria-label="正在连接 Narracut"><i></i><i></i><i></i></div></section></main><aside class="inspection" aria-label="项目检查"><h2>项目检查</h2><div class="rule"></div><p>等待工具结果…</p></aside></div>`;
  }

  // 外壳、草稿与 Preview 宿主始终留在原 DOM 位置；状态刷新只更新相关区域。
  function updateRegion(element, html) {
    if (!element || renderedRegions.get(element) === html) return;
    element.innerHTML = html;
    renderedRegions.set(element, html);
  }

  function updateWorkspaceVisibility() {
    document.querySelectorAll("[data-workspace]").forEach((tab) => {
      const selected = state.workspace === tab.dataset.workspace;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    for (const name of ["table", "agent"]) {
      const panel = document.getElementById(`workspace-${name}`);
      if (panel) panel.hidden = name !== state.workspace;
    }
  }

  function switchWorkspace(workspace) {
    if (state.workspace === workspace) return;
    state.workspace = workspace;
    updateWorkspaceVisibility();
    previewWorkbench.pauseHidden();
    // 不调用任务、保存或 Scene 写入口，也不由 Scene 选择驱动播放位置。
    updateTaskRegion();
    updateRegion(document.querySelector("[data-inspector-region]"), inspector(state.result));
    bindings.abort();
    bindings = new AbortController();
    bind();
    document.querySelector(`[data-workspace="${workspace}"]`)?.focus();
  }

  function render() {
    if (recovery) return;
    if (composing) {
      renderPending = true;
      return;
    }
    renderPending = false;
    const result = state.result;
    const launcherMode = result?.status === "launcher";
    app.className = `app-shell${launcherMode ? " launcher-shell" : state.project ? " editing-shell" : ""}`;
    app.classList.toggle('conversation-shell', !!result?.conversation && !launcherMode);
    bindings.abort();
    bindings = new AbortController();
    if (launcherMode) {
      app.innerHTML = `${launcherRail()}${launcher()}${launcherFooter()}`;
    } else {
      if ((!document.getElementById("composer-draft") && !document.querySelector('[data-conversation-footer]')) || (result?.conversation && document.getElementById('composer-draft'))) {
        app.innerHTML = `<div data-rail-region></div><div data-tabs-region></div><div data-workspace-region></div>${composer()}`;
        const draft = document.getElementById("composer-draft");
        draft?.addEventListener("input", () => { state.composerDraft = draft.value; state.composerRevision++; updateComposer(); });
      }
      updateRegion(document.querySelector("[data-rail-region]"), rail(result));
      updateRegion(document.querySelector("[data-tabs-region]"), tabs());
      const region = document.querySelector("[data-workspace-region]");
      updateRegion(region, result === null ? loading() : result.status === "valid" ? valid(result) : invalid(result));
      if (result?.status === "valid") {
        updateRegion(document.getElementById("workspace-table"), table(result));
        updateTaskRegion();
        updateCandidate();
        previewWorkbench.mount(document.querySelector("[data-program-preview]"));
        deliveryWorkbench.mount(document.querySelector("[data-program-delivery]"));
        acceptanceWorkbench.mount(document.querySelector("[data-program-acceptance]"));
        finalRenderWorkbench.mount(document.querySelector("[data-final-render]"));
        checksWorkbench.mount(document.querySelector("[data-program-checks]"));
        updateRegion(document.querySelector("[data-inspector-region]"), inspector(result));
        updateRegion(document.querySelector("[data-overlay-region]"), `${assetPreviewLayer()}${briefEditorLayer()}`);
      }
      updateWorkspaceVisibility();
    }
    bind();
    if (launcherMode && result.conversation?.status === 'unavailable') {
      app.querySelectorAll('button,input').forEach(control => { control.disabled = true; });
      const footer = app.querySelector('.launch-footer');
      footer.textContent = result.conversation.reason;
      footer.setAttribute('role', 'status');
    }
    updateComposer();
    if (state.focusTarget) {
      const target = state.focusTarget;
      state.focusTarget = null;
      const element = document.querySelector(target);
      if (element) element.focus();
      else requestAnimationFrame(() => document.querySelector(target)?.focus());
    }
  }

  app.addEventListener("compositionstart", () => { composing = true; });
  app.addEventListener("compositionend", () => {
    composing = false;
    // 最后一条 input 先提交，避免用上一次草稿替换中文候选。
    queueMicrotask(() => { if (renderPending) render(); if (state.creationFocusPending) { state.creationFocusPending = false; switchWorkspace('agent'); document.getElementById('creation-task-title')?.focus(); } });
  });

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
        previewWorkbench.selectScene(state.selected);
        state.toast = null;
        render();
      }, { signal: bindings.signal });
      row.querySelector(".scene-select")?.addEventListener("click", () => {
        state.selected = row.dataset.sceneId;
        previewWorkbench.selectScene(state.selected);
        state.toast = null;
        render();
      }, { signal: bindings.signal });
      row.querySelector("[data-edit-narration]")?.addEventListener("click", () => {
        state.selected = row.dataset.sceneId;
        previewWorkbench.selectScene(state.selected);
        state.editing = row.dataset.sceneId;
        state.editGroupOpen = false;
        state.focusTarget = "[data-narration-editor]";
        render();
      }, { signal: bindings.signal });
      row.querySelector("[data-open-scene-assets]")?.addEventListener("click", () => {
        state.selected = row.dataset.sceneId;
        previewWorkbench.selectScene(state.selected);
        state.inspectorMode = "scene-assets";
        state.inspectionOpen = true;
        state.assetSearch = "";
        render();
      }, { signal: bindings.signal });
      row.querySelector("[data-speech-action]")?.addEventListener("click", () => startSpeech(row.dataset.sceneId), { signal: bindings.signal });
      row.querySelector("[data-cancel-speech]")?.addEventListener("click", () => cancelSpeech(row.dataset.sceneId), { signal: bindings.signal });
      const editor = row.querySelector("[data-narration-editor]");
      editor?.addEventListener("input", () => updateNarration(row.dataset.sceneId, editor.value, editor), { signal: bindings.signal });
      editor?.addEventListener("blur", (event) => {
        if (event.relatedTarget?.matches?.("[data-expand]")) return;
        state.editGroupOpen = false;
        saveProject();
      }, { signal: bindings.signal });
      row.querySelector("[data-expand]")?.addEventListener("click", () => {
        state.expanded = row.dataset.sceneId;
        state.focusTarget = "[data-expanded-editor]";
        render();
      }, { signal: bindings.signal });
      const handle = row.querySelector(".drag-handle");
      handle?.addEventListener("dragstart", (event) => {
        state.dragged = row.dataset.sceneId;
        row.dataset.dragging = "true";
        event.dataTransfer.effectAllowed = "move";
      }, { signal: bindings.signal });
      handle?.addEventListener("dragend", () => {
        state.dragged = null;
        delete row.dataset.dragging;
      }, { signal: bindings.signal });
      row.addEventListener("dragover", (event) => event.preventDefault(), { signal: bindings.signal });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!state.dragged) return;
        state.selected = state.dragged;
        moveScene(currentScenes().findIndex((scene) => scene.id === row.dataset.sceneId));
        state.dragged = null;
      }, { signal: bindings.signal });
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
    }, { signal: bindings.signal, passive: true });
  }

  function bindTable() {
    document.querySelectorAll("[data-add],[data-add-first]").forEach((button) => button.addEventListener("click", addScene, { signal: bindings.signal }));
    document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", copyScene, { signal: bindings.signal }));
    document.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", deleteScene, { signal: bindings.signal }));
    document.querySelectorAll("[data-move-up]").forEach((button) => button.addEventListener("click", () => moveScene(currentScenes().findIndex((scene) => scene.id === state.selected) - 1), { signal: bindings.signal }));
    document.querySelectorAll("[data-move-down]").forEach((button) => button.addEventListener("click", () => moveScene(currentScenes().findIndex((scene) => scene.id === state.selected) + 1), { signal: bindings.signal }));
    document.querySelectorAll("[data-move]").forEach((button) => button.addEventListener("click", () => {
      const input = button.previousElementSibling;
      moveScene(Number(input.value) - 1);
    }, { signal: bindings.signal }));
    document.querySelector("[data-undo]")?.addEventListener("click", undo, { signal: bindings.signal });
    document.querySelector("[data-redo]")?.addEventListener("click", redo, { signal: bindings.signal });
    document.querySelector("[data-undo-delete]")?.addEventListener("click", undo, { signal: bindings.signal });
    document.querySelector("[data-retry]")?.addEventListener("click", () => {
      state.saveStatus = "dirty";
      state.saveError = null;
      render();
      saveProject();
    }, { signal: bindings.signal });
    document.querySelector("[data-close-expanded]")?.addEventListener("click", () => {
      state.expanded = null;
      state.editGroupOpen = false;
      render();
      saveProject();
    }, { signal: bindings.signal });
    const expanded = document.querySelector("[data-expanded-editor]");
    expanded?.addEventListener("input", () => updateNarration(state.expanded, expanded.value, expanded), { signal: bindings.signal });
    bindSceneScroll();
    bindSceneRows();
  }

  function bindInspector() {
    document.querySelector("[data-close-inspection]")?.addEventListener("click", () => {
      state.inspectionOpen = false;
      document.querySelector(".inspection")?.setAttribute("data-open", "false");
      document.querySelector("[data-open-inspection]")?.setAttribute("aria-expanded", "false");
      document.querySelector("[data-open-inspection]")?.focus();
    }, { signal: bindings.signal });
    document.querySelectorAll("[data-project-inspection]").forEach((button) => button.addEventListener("click", () => {
      state.inspectorMode = "project";
      state.assetSearch = "";
      state.ttsBlockedReason = null;
      state.ttsPendingConfirm = null;
      render();
    }, { signal: bindings.signal }));
    document.querySelector("[data-open-brief]")?.addEventListener("click", () => {
      proposalView = null;
      state.brief.open = true;
      state.brief.error = null;
      state.focusTarget = state.brief.conflict ? "[data-brief-merge]" : "[data-brief-editor]";
      render();
    }, { signal: bindings.signal });
    document.querySelector("[data-open-tts]")?.addEventListener("click", () => {
      state.inspectorMode = "tts";
      state.inspectionOpen = true;
      state.ttsBlockedReason = null;
      initializeTtsForm();
      render();
    }, { signal: bindings.signal });
    document.querySelector("[data-manage-project-assets]")?.addEventListener("click", () => {
      state.inspectorMode = "project-assets";
      state.assetSearch = "";
      state.inspectionOpen = true;
      render();
    }, { signal: bindings.signal });
    document.querySelector("[data-add-existing]")?.addEventListener("click", () => {
      state.inspectorMode = "asset-picker";
      state.assetSearch = "";
      render();
      document.querySelector("[aria-label='搜索项目 Asset']")?.focus();
    }, { signal: bindings.signal });
    document.querySelector("[data-scene-assets]")?.addEventListener("click", () => {
      state.inspectorMode = "scene-assets";
      state.assetSearch = "";
      render();
    }, { signal: bindings.signal });
    document.querySelector("[aria-label='搜索项目 Asset']")?.addEventListener("input", (event) => {
      state.assetSearch = event.currentTarget.value;
      render();
      const input = document.querySelector("[aria-label='搜索项目 Asset']");
      input?.focus();
      input?.setSelectionRange(state.assetSearch.length, state.assetSearch.length);
    }, { signal: bindings.signal });
    document.querySelectorAll("[data-import-assets]").forEach((button) => button.addEventListener("click", () => importAssets(button.dataset.targetScene), { signal: bindings.signal }));
    document.querySelectorAll("[data-add-asset]").forEach((button) => button.addEventListener("click", () => addExistingAsset(button.dataset.addAsset), { signal: bindings.signal }));
    document.querySelectorAll("[data-preview-asset]").forEach((button) => button.addEventListener("click", () => openAssetPreview(button.dataset.previewAsset), { signal: bindings.signal }));
    document.querySelectorAll("[data-move-asset]").forEach((button) => button.addEventListener("click", () => {
      const scene = selectedScene();
      const index = scene?.assetIds.indexOf(button.dataset.moveAsset) ?? -1;
      moveAssetReference(button.dataset.moveAsset, index + (button.dataset.direction === "up" ? -1 : 1));
    }, { signal: bindings.signal }));
    document.querySelectorAll("[data-apply-asset-position]").forEach((button) => button.addEventListener("click", () => {
      const input = document.querySelector(`[data-asset-position="${CSS.escape(button.dataset.applyAssetPosition)}"]`);
      moveAssetReference(button.dataset.applyAssetPosition, Number(input?.value) - 1);
    }, { signal: bindings.signal }));
    document.querySelectorAll("[data-unlink-asset]").forEach((button) => button.addEventListener("click", () => unlinkAssetReference(button.dataset.unlinkAsset), { signal: bindings.signal }));
    document.querySelectorAll("[data-tts-field]").forEach((field) => field.addEventListener("input", () => {
      const key = field.dataset.ttsField;
      state.ttsForm[key] = field.type === "number" ? Number(field.value) : field.value;
      state.ttsPendingConfirm = null;
    }, { signal: bindings.signal }));
    document.querySelector("[data-tts-api-key]")?.addEventListener("input", (event) => {
      state.ttsApiKey = event.currentTarget.value;
      state.ttsClearCredential = false;
    }, { signal: bindings.signal });
    document.querySelector("[data-clear-tts-key]")?.addEventListener("click", () => {
      state.ttsClearCredential = true;
      state.ttsApiKey = "";
      render();
      document.querySelector("[data-tts-api-key]")?.focus();
    }, { signal: bindings.signal });
    document.querySelector("[data-tts-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      saveTtsSettings(false);
    }, { signal: bindings.signal });
    document.querySelector("[data-confirm-tts]")?.addEventListener("click", () => saveTtsSettings(true), { signal: bindings.signal });
    document.querySelector("[data-cancel-tts-confirm]")?.addEventListener("click", () => {
      state.ttsPendingConfirm = null;
      render();
      document.querySelector(".tts-save")?.focus();
    }, { signal: bindings.signal });
  }

  function bindBriefEditor() {
    if (!state.brief.open) return;
    document.querySelector("[data-close-brief]")?.addEventListener("click", () => {
      state.brief.open = false;
      state.brief.editGroupOpen = false;
      state.focusTarget = proposalView ? "[data-review-proposal]" : "[data-open-brief]";
      if (!proposalView) saveVideoBrief();
      proposalView = null;
      render();
    }, { signal: bindings.signal });
    document.querySelector("[data-brief-undo]")?.addEventListener("click", () => moveBriefHistory(state.brief.undo, state.brief.redo), { signal: bindings.signal });
    document.querySelector("[data-brief-redo]")?.addEventListener("click", () => moveBriefHistory(state.brief.redo, state.brief.undo), { signal: bindings.signal });
    document.querySelector("[data-retry-brief]")?.addEventListener("click", () => {
      state.brief.status = "dirty";
      state.brief.error = null;
      saveVideoBrief();
      updateBriefIndicator();
    }, { signal: bindings.signal });
    const editor = document.querySelector("[data-brief-editor]");
    editor?.addEventListener("input", () => updateBrief(editor.value), { signal: bindings.signal });
    editor?.addEventListener("blur", (event) => {
      if (event.relatedTarget?.matches?.("[data-brief-undo],[data-brief-redo]")) return;
      state.brief.editGroupOpen = false;
      saveVideoBrief();
    }, { signal: bindings.signal });
    document.querySelectorAll("[data-brief-conflict-tab]").forEach((button) => button.addEventListener("click", () => {
      state.brief.conflictTab = button.dataset.briefConflictTab;
      state.focusTarget = `[data-brief-conflict-tab="${button.dataset.briefConflictTab}"]`;
      render();
    }, { signal: bindings.signal }));
    document.querySelector("[data-brief-merge]")?.addEventListener("input", (event) => {
      state.brief.merge = reconcileBriefEditorText(state.brief.merge, event.currentTarget.value);
    }, { signal: bindings.signal });
    document.querySelector("[data-submit-brief-merge]")?.addEventListener("click", submitBriefMerge, { signal: bindings.signal });
    document.querySelector("[data-discard-brief-local]")?.addEventListener("click", discardBriefLocal, { signal: bindings.signal });
    document.querySelector("[data-export-brief-local]")?.addEventListener("click", exportBriefLocal, { signal: bindings.signal });
  }

  let projectCopy = null;
  let identityConflict = null;
  const copyPhases = { preparing: '正在保存 Scene 与 Video Brief', stopping: '正在安全停止 Agent，保留候选', waiting: '正在等待 Render、Speech 与目录写任务结束', closing: '正在关闭来源工作区', copying: '正在复制完整持久内容', validating: '正在校验副本与来源一致性', publishing: '正在完成原子发布', opening: '副本已创建，正在打开', reconciling: '连接中断，正在等待核对复制结果；来源编辑保持锁定' };
  function copyTarget() { return projectCopy?.parent ? `${projectCopy.parent.replace(/[\\/]$/, '')}/${projectCopy.name}` : ''; }
  function copyDialog() {
    let dialog = document.getElementById('project-copy-dialog');
    if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'project-copy-dialog'; dialog.className = 'project-copy-dialog'; document.body.append(dialog); }
    const c = projectCopy, busy = c.busy, published = c.status === 'created-not-opened';
    const rendering = JSON.stringify(c);
    if (dialog.dataset.rendering === rendering) return;
    dialog.dataset.rendering = rendering;
    const detailsOpen = dialog.querySelector('details')?.open;
    const previousFocus = dialog.contains(document.activeElement) ? [...document.activeElement.attributes].find(attribute => attribute.name.startsWith('data-copy-'))?.name : null;
    const scrollTop = dialog.scrollTop;
    const target = copyTarget();
    const validName = c.name.trim() && !/[\\/\x00-\x1f]/.test(c.name) && !['.', '..'].includes(c.name);
    dialog.setAttribute('aria-labelledby', 'project-copy-title');
    dialog.innerHTML = `<header><h1 id="project-copy-title">复制项目</h1><p>保留当前成果，开启独立的创作方向。</p></header>
      <dl><dt>来源项目 · ${escapeHtml(c.source.folderName)}</dt><dd>${escapeHtml(c.source.directory)}</dd></dl>
      <div class="copy-target-fields"><button class="agent-action" type="button" data-copy-parent ${busy || published ? 'disabled' : ''}>选择父目录</button><label>新文件夹名<input data-copy-name value="${escapeHtml(c.name)}" ${busy || published ? 'disabled' : ''} autocomplete="off"></label></div>
      <dl><dt>副本完整路径</dt><dd data-copy-path>${escapeHtml(target || '请选择父目录')}</dd></dl>
      <p>保留 Scene、Asset、Speech、Video Brief、已保留的修订历史、离线依赖、候选及恢复检查点。</p><p>保留候选，来源工作区将关闭。</p>
      <p class="copy-progress" role="status" aria-live="polite">${escapeHtml(published ? '副本已创建，打开失败' : busy ? copyPhases[c.phase] ?? '正在核对复制结果' : c.status === 'cancelled' ? '复制已取消，临时目录已清理；已停止的 Agent 不会自动恢复。' : '副本使用新项目身份，任务保持停止，明确继续后才运行。')}</p>
      ${c.error ? `<div class="copy-error" role="alert"><p>${escapeHtml(c.error.message)}</p><p>${escapeHtml(c.error.path ?? '')}</p></div>` : ''}
      <details><summary>复制详情</summary><p>副本生成新 Project ID 与任务 ID，清除 Codex 线程指针；旧 Preview 和检查证据需要重新生成。系统临时文件与可重建派生产物不会复制。已有目录即使为空也不能使用。</p></details>
      <footer>${c.phase === "reconciling" ? '<button class="agent-action" data-copy-check>核对复制结果</button>' : ""}${busy ? `<button class="agent-action" data-copy-cancel ${['publishing', 'opening'].includes(c.phase) || !c.operationId ? 'disabled' : ''}>${c.phase === 'publishing' ? '正在完成' : '取消复制'}</button>` : published ? '<button class="agent-action" data-copy-open>重试打开</button>' : `<button class="agent-action" data-copy-submit ${!target || !validName ? 'disabled' : ''}>${c.error?.code === 'PROJECT_TEMPORARY_RESIDUE' ? '确认清理并从头重试' : state.creationTask?.status === 'running' ? '停止任务并复制' : '复制并打开副本'}</button>${c.sourceClosed ? '<button class="agent-action" data-copy-source>重新打开来源</button>' : '<button class="agent-action" data-copy-close>取消</button>'}${c.error && !c.sourceClosed ? '<button class="agent-action" data-copy-fix>解决 Brief 冲突或重试保存</button>' : ''}`}</footer>`;
    if (detailsOpen) dialog.querySelector('details').open = true;
    if (previousFocus) dialog.querySelector(`[${previousFocus}]:not(:disabled)`)?.focus({ preventScroll: true });
    dialog.scrollTop = scrollTop;
    dialog.oncancel = event => { event.preventDefault(); if (!c.busy && !c.sourceClosed) closeCopyDialog(); };
    dialog.onkeydown = event => { event.stopPropagation(); };
    dialog.querySelector('[data-copy-name]')?.addEventListener('input', event => {
      c.name = event.target.value;
      dialog.querySelector('[data-copy-path]').textContent = copyTarget() || '请选择父目录';
      dialog.querySelector('[data-copy-submit]').disabled = !c.parent || !c.name.trim() || /[\\/\x00-\x1f]/.test(c.name) || ['.', '..'].includes(c.name);
    });
    dialog.querySelector('[data-copy-parent]')?.addEventListener('click', async () => {
      const path = await chooseDirectory('create-parent', '[data-copy-parent]');
      if (path) c.parent = path;
      else if (state.launcher.error) c.error = state.launcher.error;
      copyDialog(); dialog.querySelector('[data-copy-name]')?.focus();
    });
    dialog.querySelector('[data-copy-submit]')?.addEventListener('click', startProjectCopy);
    dialog.querySelector('[data-copy-check]')?.addEventListener('click', async () => { try { await followProjectCopy(c, await callHostTool('copy_project', { action: 'status', operationId: c.operationId })); } catch (error) { c.error = { message: error.message }; copyDialog(); } });
    dialog.querySelector('[data-copy-cancel]')?.addEventListener('click', async () => { await callHostTool('copy_project', { action: 'cancel', operationId: c.operationId }); });
    dialog.querySelector('[data-copy-close]')?.addEventListener('click', closeCopyDialog);
    dialog.querySelector('[data-copy-source]')?.addEventListener('click', () => reopenCopy(c.source.directory));
    dialog.querySelector('[data-copy-open]')?.addEventListener('click', () => reopenCopy(c.targetDirectory));
    dialog.querySelector('[data-copy-fix]')?.addEventListener('click', () => { closeCopyDialog(); if (state.brief.conflict) { state.brief.open = true; render(); } else { state.autosaveStopped = false; void saveProject(); void saveVideoBrief(); } });
    if (!dialog.open) { dialog.showModal(); dialog.querySelector('[data-copy-close], [data-copy-parent]')?.focus(); }
  }
  function closeCopyDialog() { document.getElementById('project-copy-dialog')?.remove(); projectCopy = null; document.querySelector('[data-copy-project]')?.focus(); schedulePoll(); }
  async function reopenCopy(path) {
    try {
      const response = await callHostTool('open_project', { projectDirectory: path });
      if (response.isError || response.structuredContent?.status !== 'valid') throw new Error(response.structuredContent?.error?.message ?? '无法打开项目');
      closeCopyDialog(); accept(response.structuredContent);
    } catch (error) { projectCopy.error = { message: error.message, path }; copyDialog(); }
  }
  async function startProjectCopy() {
    const c = projectCopy;
    if (!c || c.busy) return;
    const confirmed = c.error?.code === 'PROJECT_TEMPORARY_RESIDUE';
    c.operationId = null; c.busy = true; c.phase = 'preparing'; c.error = null; clearTimeout(pollTimer); clearTimeout(briefSaveTimer); copyDialog();
    try {
      if (!c.sourceClosed) {
        if (!await flushProjectBeforeAssetImport()) throw new Error('Scene 保存失败，请重试保存后再次确认复制。');
        await saveVideoBrief();
        if (state.brief.conflict || state.brief.version !== state.brief.savedVersion) throw new Error('Video Brief 尚未保存，请解决 Brief 冲突或重试保存后再次确认。');
      } else {
        const reopened = await callHostTool('open_project', { projectDirectory: c.source.directory });
        if (reopened.isError || reopened.structuredContent?.status !== 'valid') throw new Error(reopened.structuredContent?.error?.message ?? '无法重新打开来源');
        accept(reopened.structuredContent, false, true);
        clearTimeout(pollTimer);
        c.sourceClosed = false;
      }
      c.operationId = createUuid();
      let response = await callHostTool('copy_project', { action: 'start', operationId: c.operationId, projectDirectory: c.source.directory, projectId: c.source.projectId, targetDirectory: copyTarget(), confirmTemporaryCleanup: confirmed });
      if (response.isError) { c.operationId = null; throw new Error(response.structuredContent?.error?.message ?? '无法开始复制'); }
      await followProjectCopy(c, response);
    } catch (error) { c.busy = !!c.operationId; if (c.busy) c.phase = 'reconciling'; c.error = { message: error.message }; copyDialog(); }
  }
  async function followProjectCopy(c, response) {
      for (;;) {
        if (response.isError) throw new Error(response.structuredContent?.error?.message ?? '复制操作失败');
        const result = response.structuredContent;
        Object.assign(c, result);
        c.busy = result.status === 'running'; copyDialog();
        if (!c.busy) {
          if (result.status === 'opened') { const workspace = result.workspace; closeCopyDialog(); accept({ ...workspace, copyReceipt: { warning: result.cleanupWarning } }); state.inspectionOpen = true; render(); announce(`副本 ${workspace.project.folderName} 已打开：${workspace.project.directory}。项目身份独立，任务保持停止。${result.cleanupWarning ? ` ${result.cleanupWarning.message}（${result.cleanupWarning.path}）` : ""}`); }
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 350));
        response = await callHostTool('copy_project', { action: 'status', operationId: c.operationId });
      }
  }

  function showIdentityConflict(conflict) {
    identityConflict = conflict;
    let dialog = document.getElementById('project-identity-dialog');
    if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'project-identity-dialog'; dialog.className = 'project-copy-dialog'; document.body.append(dialog); }
    dialog.setAttribute('aria-labelledby', 'identity-title');
    dialog.innerHTML = `<h1 id="identity-title">两个路径具有相同 Project ID</h1><p>手工复制保留原身份，请明确选择本次要使用的项目。</p><dl><dt>当前工作区路径</dt><dd>${escapeHtml(conflict.currentDirectory)}</dd><dt>所选路径</dt><dd>${escapeHtml(conflict.selectedDirectory)}</dd></dl><div class="identity-actions"><button class="agent-action" data-identity="current">返回当前工作区</button><button class="agent-action" data-identity="selected">关闭当前工作区后打开所选路径</button><button class="agent-action" data-identity="convert">将所选副本转换为独立项目（生成新 ID）</button><button class="agent-action" data-identity="cancel">取消本次打开</button></div><p data-identity-feedback role="status"></p>`;
    dialog.querySelectorAll('[data-identity]').forEach(button => button.addEventListener('click', async () => {
      const choice = button.dataset.identity;
      if (choice === 'convert' && !button.dataset.confirmed) { button.dataset.confirmed = 'true'; button.textContent = '确认转换所选路径并生成新 ID'; dialog.querySelector('[data-identity-feedback]').textContent = `将改变 ${conflict.selectedDirectory} 的项目与任务身份，清除线程指针并保持停止。`; return; }
      dialog.querySelectorAll('button').forEach(item => { item.disabled = true; });
      try {
        const response = await callHostTool('open_project', { projectDirectory: conflict.selectedDirectory, identityChoice: choice });
        if (response.isError) throw new Error(response.structuredContent?.error?.message ?? '打开失败');
        if (response.structuredContent?.status === 'identity-conflict') { showIdentityConflict(response.structuredContent); return; }
        dialog.remove(); identityConflict = null; state.launcher.busy = false;
        if (response.structuredContent?.status === 'valid') accept(response.structuredContent); else render();
      } catch (error) { dialog.querySelector('[data-identity-feedback]').textContent = error.message; dialog.querySelectorAll('button').forEach(item => { item.disabled = false; }); }
    }));
    dialog.oncancel = event => { event.preventDefault(); dialog.querySelector('[data-identity="cancel"]').click(); };
    if (!dialog.open) dialog.showModal();
    dialog.onkeydown = event => event.stopPropagation();
    dialog.querySelector('[data-identity="cancel"]').focus();
  }

  function bind() {
    document.querySelector("[data-copy-project]")?.addEventListener("click", () => { projectCopy = { source: { ...state.result.project }, parent: "", name: `${state.result.project.folderName}-副本`, busy: false }; copyDialog(); }, { signal: bindings.signal });
    if (state.result?.status === "launcher") {
      bindLauncher();
      return;
    }
    document.querySelectorAll("[data-workspace]").forEach((tab) => tab.addEventListener("click", () => {
      if (state.result?.status === "valid") switchWorkspace(tab.dataset.workspace);
    }, { signal: bindings.signal }));
    document.querySelectorAll('[data-view-task]').forEach(button => button.addEventListener('click', () => switchWorkspace('agent'), { signal: bindings.signal }));
    document.querySelector('[data-continue-external]')?.addEventListener('click', continueExternal, { signal: bindings.signal });
    document.querySelectorAll('[data-todo-scene]').forEach(button => button.addEventListener('click', () => locateSuggestion(button.dataset.todoScene, button.dataset.todoField), { signal: bindings.signal }));
    document.querySelectorAll('[data-todo-copy]').forEach(button => button.addEventListener('click', async () => {
      const item = state.creationTask?.suggestions[Number(button.dataset.todoCopy)];
      try { await navigator.clipboard.writeText(item.content); announce('完整建议值已复制。'); } catch { announce('复制失败，请展开建议值并手工复制。'); }
    }, { signal: bindings.signal }));
    document.querySelectorAll('[data-task-action]').forEach(button => button.addEventListener('click', () => respondTask(button.dataset.taskAction), { signal: bindings.signal }));
    document.querySelector('[data-review-proposal]')?.addEventListener('click', () => { proposalView = state.creationTask.briefProposal; proposalTab = 'diff'; state.brief.open = true; state.focusTarget = '[data-proposal-tab="diff"]'; render(); }, { signal: bindings.signal });
    document.querySelectorAll('[data-proposal-tab]').forEach(button => button.addEventListener('click', () => { proposalTab = button.dataset.proposalTab; state.focusTarget = `[data-proposal-tab="${proposalTab}"]`; render(); }, { signal: bindings.signal }));
    document.querySelectorAll("[data-scene-suggestion]").forEach(button => button.addEventListener("click", () => switchWorkspace("table"), { signal: bindings.signal }));
    document.querySelectorAll("[data-workspace]").forEach((tab) => tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === "Home" ? "table" : event.key === "End" ? "agent" : tab.dataset.workspace === "table" ? "agent" : "table";
      document.querySelector(`[data-workspace="${target}"]`)?.focus();
    }, { signal: bindings.signal }));
    document.querySelector("[data-open-inspection]")?.addEventListener("click", () => {
      state.inspectionOpen = true;
      document.querySelector(".inspection")?.setAttribute("data-open", "true");
      document.querySelector("[data-open-inspection]")?.setAttribute("aria-expanded", "true");
      document.querySelector(".inspection [data-close-inspection]")?.focus();
    }, { signal: bindings.signal });
    document.querySelector('.composer-send')?.addEventListener('click', startCreation, { signal: bindings.signal });
    document.querySelector('[data-show-delivery]')?.addEventListener('click', () => { const region = document.querySelector('[data-program-delivery]'); region?.scrollIntoView({ block: 'start' }); const title = region?.querySelector('h2'); title?.setAttribute('tabindex', '-1'); title?.focus({ preventScroll: true }); }, { signal: bindings.signal });
    document.querySelector("[data-close-preview]")?.addEventListener("click", closeAssetPreview, { signal: bindings.signal });
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
    if (state.result?.status === "valid" && state.result.writable) bindTable();
    if (state.result?.status === "valid" && !state.result.writable) {
      document.querySelectorAll("[data-scene-id]").forEach((row) => row.addEventListener("click", () => {
        state.selected = row.dataset.sceneId;
        previewWorkbench.selectScene(state.selected);
        render();
      }, { signal: bindings.signal }));
      bindSceneScroll();
    }
  }

  function request(method, params, timeout = 15_000) {
    const id = rpcId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error("宿主请求超时，请重试。"));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }

  async function callHostTool(name, args) {
    if (recovery && name !== 'project_recovery') throw new Error('项目身份已失效，编辑已停止。');
    const response = typeof window.openai?.callTool === 'function'
      ? await window.openai.callTool(name, args) : await request('tools/call', { name, arguments: args });
    const content = response?.structuredContent ?? response;
    if (content?.status === 'identity-lost' || content?.error?.code === 'PROJECT_IDENTITY_LOST') freezeIdentity(content.error?.message ?? '项目目录、清单或租约已变化。');
    if (recovery && name !== 'project_recovery') throw new Error('项目身份已失效；迟到的结果不会改变恢复截面。');
    return response;
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
    if (directoryPicking) return null;
    const api = window.openai;
    const picker = api?.selectDirectory ?? api?.pickDirectory ?? api?.requestDirectoryPicker;
    if (typeof picker !== "function" && !hostReady) {
      state.launcher.error = { code: "HOST_DIRECTORY_PICKER_UNAVAILABLE", message: "当前插件宿主没有提供系统文件夹选择能力；Narracut 不会退化为网页文件浏览器。" };
      render();
      document.querySelector(trigger)?.focus();
      return null;
    }
    directoryPicking = true;
    document.querySelector(trigger)?.setAttribute('disabled', '');
    try {
      let selected;
      if (typeof picker === 'function') {
        selected = await picker.call(api, { purpose, title: purpose === "create-parent" ? "选择新项目的父目录" : "选择要打开的 Project VNext", canCreateDirectories: true });
      } else {
        const response = await request('tools/call', { name: 'select_project_directory', arguments: { purpose } }, 330_000);
        if (response?.isError || response?.structuredContent?.error) throw new Error(response?.structuredContent?.error?.message ?? '系统文件夹窗口无法打开。');
        selected = response?.structuredContent;
      }
      const path = directoryPath(selected);
      if (path === null) document.querySelector(trigger)?.focus();
      return path;
    } catch (error) {
      state.launcher.error = { code: "HOST_DIRECTORY_PICKER_FAILED", message: error?.message ?? "系统文件夹选择窗口无法打开，请重试。" };
      render();
      document.querySelector(trigger)?.focus();
      return null;
    } finally {
      directoryPicking = false;
      document.querySelector(trigger)?.removeAttribute('disabled');
      document.querySelector(trigger)?.focus();
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

  function lifecycleFailure(response, fallback, trigger, projectPath) {
    const error = response?.structuredContent?.error ?? { code: "PROJECT_OPERATION_FAILED", message: fallback };
    state.launcher.busy = false;
    state.launcher.stage = "ready";
    state.launcher.error = error;
    render();
    if (trigger === "[data-open-project]") {
      const dialog = document.createElement('dialog');
      dialog.className = 'project-copy-dialog';
      dialog.setAttribute('aria-labelledby', 'project-open-error-title');
      dialog.setAttribute('aria-describedby', 'project-open-error-reason');
      dialog.innerHTML = `<h1 id="project-open-error-title">无法打开项目</h1><p id="project-open-error-reason" class="copy-error">${escapeHtml(error.message ?? fallback)}</p><dl><dt>所选目录</dt><dd>${escapeHtml(projectPath ?? error.path ?? '')}</dd><dt>错误代码</dt><dd>${escapeHtml(error.code ?? 'PROJECT_OPEN_FAILED')}</dd></dl><footer><button class="agent-action" data-primary="true" data-open-again>重新选择文件夹</button><button class="agent-action" data-dismiss>关闭</button></footer>`;
      dialog.addEventListener('close', () => { dialog.remove(); document.querySelector(trigger)?.focus(); }, { once: true });
      dialog.querySelector('[data-dismiss]').addEventListener('click', () => dialog.close());
      dialog.querySelector('[data-open-again]').addEventListener('click', () => { dialog.close(); openFromLauncher(); });
      document.body.append(dialog);
      dialog.showModal();
      return;
    }
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
      if (response?.isError || response?.structuredContent?.status === "invalid") return lifecycleFailure(response, "项目无法打开，请核对目录后重试。", "[data-open-project]", path);
      if (response.structuredContent?.status === "identity-conflict") { showIdentityConflict(response.structuredContent); return; }
      accept(response.structuredContent, response.structuredContent?.project?.sceneCount === 0);
    } catch (error) {
      lifecycleFailure({ structuredContent: { error: { code: "PROJECT_OPEN_FAILED", message: error?.message ?? "项目无法打开，请重试。" } } }, "项目无法打开，请重试。", "[data-open-project]", path);
    }
  }

  function bindLauncher() {
    if (restoreLauncher) { restoreLauncher.mount(document.querySelector('[data-restore-root]')); return; }
    document.querySelector('[data-open-restore]')?.addEventListener('click', () => {
      restoreLauncher = window.NarracutRestore({ callTool: callHostTool, exit: () => { restoreLauncher = null; render(); document.querySelector('[data-open-restore]')?.focus(); }, openProject: async path => {
        const response = await callHostTool('open_project', { projectDirectory: path });
        if (response?.isError || response.structuredContent?.status !== 'valid') throw new Error(response.structuredContent?.error?.message ?? '打开未完成；恢复项目仍保留在已发布路径。');
        restoreLauncher = null; accept(response.structuredContent, response.structuredContent?.project?.sceneCount === 0);
      } });
      render();
    }, { signal: bindings.signal });
    document.querySelector("[data-pick-parent]")?.addEventListener("click", pickParent, { signal: bindings.signal });
    document.querySelector("[data-open-project]")?.addEventListener("click", openFromLauncher, { signal: bindings.signal });
    document.querySelector("[data-create-project]")?.addEventListener("click", () => createFromLauncher(false), { signal: bindings.signal });
    document.querySelector("[data-confirm-residue]")?.addEventListener("click", () => createFromLauncher(true), { signal: bindings.signal });
    document.querySelector(".name-field")?.addEventListener("input", (event) => {
      state.launcher.projectName = event.currentTarget.value;
      state.launcher.error = null;
      // 保留输入节点，避免打断输入法组合输入、选区和滚动位置。
      const finalPath = finalProjectPath();
      const verdict = launcherVerdict();
      const path = document.querySelector('[data-final-path]');
      path.textContent = finalPath || "选择位置并填写名称后显示";
      path.title = finalPath;
      const hint = document.querySelector('[data-path-verdict]');
      hint.textContent = verdict.copy;
      hint.dataset.valid = String(verdict.valid);
      document.querySelector('[data-create-project]').disabled = !verdict.valid || state.launcher.busy;
      document.querySelector('.launch-error')?.remove();
    }, { signal: bindings.signal });
  }

  function schedulePoll(delay = 500) {
    if (recovery) return;
    clearTimeout(pollTimer);
    if (!state.creationRecovery && (!state.creationTask || state.creationTask.status === 'terminated')) return;
    const project = state.result.project;
    pollTimer = setTimeout(async () => {
      try {
        const response = await callHostTool('get_creation_task', { projectDirectory: project.directory, projectId: project.projectId });
        if (state.result.project !== project) return;
        if (response?.isError) throw new Error(response.structuredContent?.error?.message ?? '无法读取任务');
        if (response.structuredContent?.candidate) { state.candidate = response.structuredContent.candidate; updateCandidate(); }
        state.creationRecovery = response.structuredContent?.creationRecovery ?? null;
        if (response.structuredContent?.creationTask && !response.structuredContent.creationTask.operation) state.taskOperation = null;
        applyCreation(response.structuredContent?.creationTask);
      } catch (error) { if (state.result?.project !== project) return; state.agentError = error.message; updateTaskRegion(); updateComposer(); schedulePoll(2000); }
    }, state.creationTask?.status === 'running' ? delay : Math.max(delay, 2000));
  }
  function applyCreation(task) {
    const changed = JSON.stringify(state.creationTask) !== JSON.stringify(task) || state.agentError !== null;
    state.agentError = null;
    const previousStatus = state.creationTask?.status, previousReason = state.creationTask?.reason;
    const change = task?.briefChange, brief = state.brief;
    if (change && change.id !== seenBriefChange && !brief.saveInFlight && !brief.conflict && brief.version === brief.savedVersion) {
      if (brief.local === change.base || brief.local === change.content) {
        pushBriefHistory(brief.undo, change.base); brief.redo = []; brief.editGroupOpen = false;
        brief.base = change.content; brief.local = change.content; brief.baselineRevision = change.revision;
        brief.version++; brief.savedVersion = brief.version; brief.status = 'saved';
        state.result.videoBrief = { content: change.content, revision: change.revision, state: 'saved' };
        if (state.result.currentRenderProgram) state.result.currentRenderProgram.briefReviewPending = state.result.currentRenderProgram.briefRevision !== change.revision;
        updateBriefIndicator();
        seenBriefChange = change.id;
      } else { state.agentError = 'Brief 保存回执与本地内容不同，请在 Brief 编辑器处理本地内容后继续。'; }
    }
    state.creationTask = task;
    if (task?.reason === 'BRIEF_SAVED' && change?.id === seenBriefChange) queueMicrotask(() => respondTask('ack-brief'));
    updateRecoveryRegion();
    if (!changed) { schedulePoll(); return; }
    updateTaskRegion();
    if (task?.preview) previewWorkbench.receive(task.preview);
    if (task?.deliveryId) void deliveryWorkbench.refresh();
    bindings.abort(); bindings = new AbortController(); bind(); updateComposer();
    if (previousStatus !== task?.status || previousReason !== task?.reason) document.getElementById('agent-status-announcer').textContent = task ? `${{running:'运行中',waiting:'等待用户',stopped:'已停止',terminated:'已终结'}[task.status]}。${task.pending ?? creationStages[task.stage]}` : '尚无任务';
    schedulePoll();
  }
  async function continueExternal() {
    if (state.externalBusy) return;
    state.externalBusy = true; updateTaskRegion();
    try {
      const project = state.result.project;
      const response = await callHostTool('continue_creation_task', { projectDirectory: project.directory, projectId: project.projectId, baseline: state.creationTask?.externalBaseline });
      if (response.isError) throw new Error(response.structuredContent?.error?.message ?? '继续失败，请重新检查候选');
      if (response.structuredContent?.candidate) state.candidate = response.structuredContent.candidate;
      applyCreation(response.structuredContent.creationTask);
    } catch (error) { state.agentError = error.message; }
    finally { state.externalBusy = false; updateTaskRegion(); bindings.abort(); bindings = new AbortController(); bind(); }
  }
  async function startCreation() {
    if (composing || state.agentBusy || !state.composerDraft.trim()) return;
    const project = state.result?.project;
    if (!project) return;
    const instruction = state.composerDraft, revision = state.composerRevision;
    state.agentBusy = true; state.agentError = null; updateComposer();
    updateTaskRegion();
    try {
      if (!await flushProjectBeforeAssetImport()) throw new Error('Scene 尚未安全保存，请先处理保存问题');
      if (state.brief.version !== state.brief.savedVersion || state.brief.saveInFlight || state.brief.conflict) throw new Error('Video Brief 尚未安全保存，请先处理后再开始创作');
      if (state.result?.project !== project) throw new Error('当前项目已变化，请在当前项目重试');
      const existing = state.creationTask && state.creationTask.status !== 'terminated';
      const response = await callHostTool(existing ? 'respond_creation_task' : 'start_creation_task', { projectDirectory: project.directory, projectId: project.projectId, instruction, ...(existing ? { action: 'message' } : { parentOrigin: location.origin }) });
      if (response?.isError || !response?.structuredContent?.creationTask) throw new Error(response?.structuredContent?.error?.message ?? '未收到任务创建成功回执');
      if (state.result?.project !== project) return;
      state.agentBusy = false;
      if (state.composerRevision === revision && !composing) { state.composerDraft = ''; document.getElementById('composer-draft').value = ''; }
      if (response.structuredContent?.candidate) { state.candidate = response.structuredContent.candidate; updateCandidate(); }
      applyCreation(response.structuredContent.creationTask);
      if (composing) state.creationFocusPending = true;
      else { switchWorkspace('agent'); document.getElementById('creation-task-title')?.focus(); }
    } catch (error) { if (state.result?.project !== project) return; state.agentBusy = false; state.agentError = error.message; updateComposer(); updateTaskRegion(); }
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

  function accept(result, focusEmpty = false, fromCopy = false) {
    if (recovery) return;
    if (result?.status === 'identity-conflict') { showIdentityConflict(result); return; }
    if (result?.status === 'open-cancelled') return;
    if (projectCopy?.busy && !fromCopy) return;
    assetPreviewRequest += 1;
    clearTimeout(briefSaveTimer);
    activeBriefSavePromise = null;
    const previousProjectId = state.result?.project?.projectId;
    state.result = result;
    state.candidate = result?.candidate ?? null;
    state.candidateBusy = false;
    state.candidateError = null;
    state.candidateConfirm = false;
    state.start = 0;
    proposalView = null; seenBriefChange = null;
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
      state.creationTask = result?.creationTask ?? null;
      state.creationRecovery = result?.creationRecovery ?? null; state.taskOperation = null; state.takeoverOpen = false; state.takeoverDraft = ''; state.takeoverError = ''; state.takeoverBusy = false; state.takeoverPending = null; state.takeoverBaseline = null; state.candidateUncertain = false;
      state.agentBusy = false;
      state.creationFocusPending = false;
      state.agentError = result?.creationError ?? null;
      clearTimeout(pollTimer);
      clearTimeout(speechPollTimer);
    }
    render();
    schedulePoll();
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
      if (content?.status === 'identity-lost' || content?.error?.code === 'PROJECT_IDENTITY_LOST') freezeIdentity(content.error?.message ?? '项目身份已变化。');
      if (recovery) return;
      if (content?.status === "candidate-state") { state.candidate = content.candidate; state.candidateError = null; updateCandidate(); }
      else if (content?.status === "candidate-failed" || (content?.status === "identity-lost" && content?.error)) {
        state.candidateError = content.error;
        if (content.status === "identity-lost") state.autosaveStopped = true;
        updateCandidate();
      }
      else if (content?.status !== 'valid' && content && ('creationTask' in content || 'creationRecovery' in content)) { if ('creationRecovery' in content) state.creationRecovery = content.creationRecovery; applyCreation(content.creationTask); }
      else accept(content, content?.operation === "created" && content?.project?.sceneCount === 0);
    }
  }, { passive: true });

  render();
  // 宿主收到视图就绪通知后才交付工具结果；初始化必须走请求应答通道。
  request('ui/initialize', {
    appInfo: { name: 'narracut-workbench', version: '0.1.0' },
    appCapabilities: {},
    protocolVersion: '2026-01-26',
  }).then(result => {
    if (result?.protocolVersion !== '2026-01-26') throw new Error('宿主返回了不支持的 MCP Apps 协议版本。');
    hostReady = true;
    window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
  }).catch(error => {
    if (state.result !== null) return;
    accept({ status: 'invalid', connection: { status: 'disconnected', readOnly: true }, error: {
      code: 'HOST_INITIALIZATION_FAILED', message: error.message,
    } });
  });
})();

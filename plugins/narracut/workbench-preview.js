/** 成片 Preview 宿主仅消费版本化消息；不读取 iframe DOM、Player 或 Bundle 全局对象。 */
function createPreviewWorkbench(call, getProject, candidateReady = () => {}, canViewExisting = () => false, callUpdate, canOperate = () => true, createUuid = () => crypto.randomUUID()) {
  let updateState, updateError = '', operationError = '', updateRequest = null, updatePolling = false, waitChoice = false, editGeneration = 0, lastInputKey, undoConfirmation = null, updateViewing = false, viewSerial = 0;
  const updateBusy = () => !!updateRequest || ['running', 'cancelling'].includes(updateState?.job?.status);
  function hideVideo() { for (const slot of slots.values()) { if (slot.playing) command(slot, 'PAUSE'); slot.playing = false; slot.iframe.hidden = true; slot.buildStale = true; } }
  async function updateCall(action, args = {}) {
    const result = await callUpdate(action, args), data = result?.structuredContent ?? result;
    if (result?.isError || data?.error) throw new Error(data?.error?.message ?? '视频更新失败');
    return data;
  }
  async function refreshUpdate() {
    if (!callUpdate || !region?.isConnected || updatePolling || !getProject() || isHidden() && !updateBusy()) return;
    updatePolling = true; const key = projectKey, generation = editGeneration;
    try {
      const data = await updateCall('status', { ...(updateRequest ? { requestId: updateRequest.requestId } : {}), ...(canOperate() ? { parentOrigin: location.origin } : {}) }); if (key !== projectKey) return;
      const previousPublication = updateState?.result?.requestId;
      updateState = data;
      if (data.result?.status === 'published' && data.result.requestId !== previousPublication && generation === editGeneration) waitChoice = false;
      if (updateRequest && data.requestStatus === 'not-started') { updateRequest = null; operationError = updateError || '本次操作未开始，请重新选择更新方式。'; }
      if (updateRequest && (data.restoration?.requestId === updateRequest.requestId || data.result?.requestId === updateRequest.requestId || data.job?.requestId === updateRequest.requestId && ['published', 'failed', 'cancelled'].includes(data.job.status))) {
        if (data.result?.requestId === updateRequest.requestId && data.result.status === 'published' && updateRequest.generation === editGeneration) waitChoice = false;
        updateRequest = null;
      }
      if (data.result?.status === 'undone') { waitChoice = true; hideVideo(); }
      if (data.job?.status === 'failed' || data.job?.status === 'cancelled') { waitChoice = true; hideVideo(); }
      if (updateBusy()) hideVideo();
      update();
      if (!updateBusy() && !waitChoice && canOperate() && data.hasDesign) void refreshUpdateView(data, key, generation);
      updateError = '';
    } catch (error) { if (key === projectKey) { viewSerial++; updateViewing = false; updateError = error.message; hideVideo(); } }
    finally { if (key === projectKey) { updatePolling = false; update(); } }
  }
  async function refreshUpdateView(data, key, generation) {
    if (updateViewing) return;
    updateViewing = true; const token = ++viewSerial;
    try {
      const view = await updateCall('view', { parentOrigin: location.origin });
      if (token !== viewSerial || key !== projectKey || generation !== editGeneration || waitChoice || updateBusy() || !canOperate() || !updateState?.hasDesign || updateState?.result?.requestId !== data.result?.requestId) return;
      if (view.preview && !view.preview.stale) {
        if (active?.instanceId !== view.preview.instanceId) { for (const slot of [...slots.values()]) dispose(slot); active = pending = null; receive(view.preview); }
        else { active.buildStale = false; active.stale = false; active.iframe.hidden = false; }
      } else hideVideo();
    } catch (error) {
      if (token === viewSerial && key === projectKey && !waitChoice && updateState?.result?.requestId === data.result?.requestId) { updateError = error.message; hideVideo(); }
    } finally {
      if (token === viewSerial && key === projectKey) { updateViewing = false; update(); }
    }
  }
  async function operateUpdate(action, operationId) {
    if (action === 'cancel' ? getProject()?.writable === false : !canOperate() || updateBusy()) return;
    const key = projectKey;
    if (action === 'cancel') {
      try { await updateCall('cancel', { requestId: updateRequest?.action === 'start' ? updateRequest.requestId : updateState?.job?.requestId ?? updateRequest?.requestId }); } catch (error) { updateError = error.message; }
      await refreshUpdate(); return;
    }
    hideVideo(); waitChoice = true; updateError = ''; operationError = '';
    undoConfirmation = null;
    updateRequest = { requestId: createUuid(), generation: editGeneration, action };
    const request = updateRequest; update();
    try {
      const result = await updateCall(action, { requestId: request.requestId, parentOrigin: location.origin, ...(action === 'undo' ? { operationId } : {}) });
      if (key !== projectKey) return;
      if (result.job) updateState = { ...updateState, job: result.job };
      if (result.status === 'undone') updateRequest = null;
    } catch (error) { if (key === projectKey) updateError = `正在核对${action === 'undo' ? '撤回' : '更新'}结果：${error.message}`; }
    finally { if (key === projectKey) { update(); await refreshUpdate(); } }
  }
  function renderUpdate() {
    if (!callUpdate || !region) return;
    const known = !!updateState, hasDesign = updateState?.hasDesign, running = updateBusy();
    const current = active?.ready && !active.stale && !active.buildStale && !waitChoice && !running && canOperate();
    const controls = find('.video-update');
    if (current) { if (find('.preview-position').nextElementSibling !== controls) find('.preview-position').after(controls); } else if (controls.nextElementSibling !== find('[data-preview-screen]')) region.insertBefore(controls, find('[data-preview-screen]'));
    find('[data-preview-title]').textContent = '完整视频';
    const restoring = updateState?.hasDesign && updateState?.restoration && !updateState.restoration.synced;
    const restoredReason = restoring ? running ? '画面设计已恢复，正在同步最新内容…' : updateState?.job?.status === 'cancelled' ? '画面设计已恢复，内容同步已取消。可重试同步。' : updateState?.job?.status === 'failed' ? '画面设计已恢复，但最新内容同步失败。请重试同步。' : '画面设计已恢复，尚未同步最新内容。' : '';
    const reason = updateError || operationError || (updateRequest?.action === 'undo' ? '正在恢复画面设计…' : '') || restoredReason || (running ? updateState?.job?.stage ?? '正在核对更新结果' : updateState?.job?.error) || (!known ? '正在读取视频状态' : !hasDesign ? '尚无画面设计' : waitChoice || !active || active.buildStale || active.stale ? '表格内容已变化，需要更新视频' : '视频已同步');
    find('[data-update-state]').textContent = reason;
    const start = find('[data-update-start]'); start.textContent = restoring && !running ? '重试同步' : '仅同步表格内容'; start.disabled = !known || !hasDesign || running || !canOperate();
    find('[data-update-cancel]').hidden = !['running', 'cancelling'].includes(updateState?.job?.status); find('[data-update-cancel]').disabled = !canOperate();
    find('[data-update-reconcile]').hidden = !updateError && !updateRequest;
    find('[data-update-note]').textContent = !hasDesign ? '请先在当前 Codex 对话中生成画面设计，再同步表格内容。' : !canOperate() ? '请先保存表格并恢复连接和控制权，再更新视频。' : '沿用现有画面设计，不自动修改独立标题、图表和动画。';
    const summary = document.querySelector('[data-review-summary]'); if (summary) summary.textContent = updateState?.revision?.summary ?? '在当前 Codex 对话中描述创作目标。';
    const undo = updateState?.undo, undoButton = find('[data-update-undo]');
    undoButton.hidden = !undo || !!undoConfirmation; undoButton.disabled = running || !canOperate();
    undoButton.textContent = undo?.previousRevisionId === null ? '撤回首次生成' : '撤回上次画面调整';
    find('[data-update-last]').textContent = undo ? `${undo.summary} · ${new Date(undo.at).toLocaleString()}` : updateState?.undoUnavailable ? '无法确认可撤回的画面创作' : updateState?.restoration ? '该步画面撤回已用完，不能重做。' : '暂无可撤回的画面创作';
    const confirmation = find('[data-update-confirmation]');
    confirmation.hidden = !undoConfirmation;
    find('[data-update-confirm-note]').textContent = undoConfirmation?.previousRevisionId === null ? '移除首次生成的画面设计，保留最新表格和 Speech，回到无设计状态。本次撤回后不能重做。' : '恢复调整前的画面设计，保留最新表格和 Speech，随后自动同步最新内容。本次撤回后不能重做。';
    find('[data-update-confirm]').disabled = running || !canOperate() || !undo || undo.requestId !== undoConfirmation?.requestId;
    find('[data-update-compatibility]').textContent = [updateState?.undoUnavailable, updateState?.compatibility].filter(Boolean).join('；');
    find('[data-update-evidence]').textContent = JSON.stringify(updateState?.job && updateState.job.status !== 'published' ? updateState.checks : updateState?.revision?.acceptance ?? updateState?.checks ?? {}, null, 2);
    const warnings = updateState?.revision?.acceptance?.warnings ?? [];
    find('[data-update-warnings]').textContent = warnings.join('；');
  }
  let region, projectKey, active, pending, busy = false, failure = '', requested = null, serial = 0;
  // 技术详情放入抽屉，播放器和控制节点始终保留在原宿主。
  let detailRoot;
  const find = selector => region.querySelector(selector) ?? detailRoot?.querySelector(selector);
  const slots = new Map();
  const buildStates = { current: '', candidate: '' };
  let deferredScene = null, sceneNotice = '', polling = false, comparisonTarget = null;
  const observed = new Map();
  const isHidden = () => document.hidden || document.getElementById('workspace-agent')?.hidden;
  const targetName = target => target === 'current' ? '当前修订' : '候选';
  function versionFor(target) {
    return [...slots.values()].filter(slot => slot.target === target && !slot.failed).at(-1);
  }
  function evidenceText(evidence, brief = false) {
    const status = { latest: '最新', stale: '已过期', unknown: '状态未知' }[evidence?.status] ?? '状态未知';
    return brief ? `${status} · ${{ reviewed: '已复核', pending: '待接受复核', unknown: '复核状态未知' }[evidence?.review] ?? '复核状态未知'}` : status;
  }
  function locateScene() {
    if (!deferredScene || isHidden() || !active?.ready) return;
    if (active.stale || active.buildStale) { deferredScene = null; sceneNotice = '正在查看的 Preview 已过期，不能用于定位；请切换最新候选。'; update(); return; }
    const id = deferredScene; deferredScene = null;
    const scene = active.input.scenes.find(item => item.id === id);
    if (!scene) { sceneNotice = '正在查看的版本不含所选 Scene，无法定位；请切换或构建对应版本。'; update(); return; }
    sceneNotice = ''; seek(scene.time.startFrame);
  }

  function command(slot, type, extra = {}) {
    if (slot && !slot.failed) slot.iframe.contentWindow?.postMessage({ version: 1, instanceId: slot.instanceId, token: slot.token, type, ...extra }, slot.origin);
  }
  function dispose(slot) {
    if (!slot) return;
    command(slot, 'PAUSE'); clearTimeout(slot.timeout); slot.iframe.remove(); slots.delete(slot.instanceId);
    void call('release', { instanceId: slot.instanceId }).catch(() => {});
  }
  function markFailed(slot, reason) {
    slot.failed = true; slot.ready = false; slot.iframe.remove(); clearTimeout(slot.timeout);
    failure = `${slot.label}：${reason}。请重新构建此版本。`;
    buildStates[slot.target] = '初始化失败';
    if (pending === slot) pending = null;
    if (active === slot) { active = null; requested = null; }
    dispose(slot); update();
  }
  function update() {
    if (!region?.isConnected) return;
    const slot = active, playable = slot?.ready && !slot.failed && !slot.stale && !slot.buildStale && !waitChoice && !updateBusy() && canOperate() && slot.input.scenes.length > 0;
    const frame = slot?.frame;
    find('[data-preview-title]').textContent = slot ? `正在查看：${slot.label}` : '成片 Preview';
    const compare = find('[data-preview-compare]');
    compare.textContent = slot?.target === 'current' ? '返回候选' : '对比当前';
    compare.disabled = !slot?.ready || busy;
    find('[data-preview-screen]').hidden = !slot || !!slot.stale || !!slot.buildStale || waitChoice || updateBusy() || !canOperate();
    if (!playable && slot?.playing) { command(slot, 'PAUSE'); slot.playing = false; }
    find('[data-preview-screen]').style.aspectRatio = slot ? `${slot.input.output.width} / ${slot.input.output.height}` : '16 / 9';
    const statusText = [failure, busy ? '正在构建目标版本，原画面保持不变' : '', requested ? `正在定位到第 ${requested.frame} 帧` : '', slot?.buffering ? '正在缓冲，保留当前画面' : '', sceneNotice, deferredScene ? '返回 Preview 后定位所选 Scene' : ''].filter(Boolean).join(' · ') || (slot?.ready ? (slot.input.scenes.length ? '预览已就绪' : '暂无可播放 Scene') : slot ? '正在初始化预览' : '尚无预览 · 构建当前版本或候选后检查成片');
    const status = find('[data-preview-state]'); if (status.textContent !== statusText) status.textContent = statusText;
    const freshness = find('[data-preview-freshness]');
    const freshnessText = slot?.stale || slot?.buildStale ? `${slot.target === 'candidate' ? '上一成功预览' : '当前修订预览'} · 已过期 · 不能用于接受` : '';
    if (freshness.textContent !== freshnessText) freshness.textContent = freshnessText;
    freshness.hidden = !freshnessText;
    find('.preview-controls').hidden = !slot || !!slot.ready && slot.input.scenes.length === 0;
    const button = find('[data-preview-switch]');
    button.hidden = !pending?.ready || pending === active || pending.failed;
    button.textContent = pending?.target === 'candidate' ? '新候选已就绪 · 切换查看' : `${pending?.label ?? '新版本'}已就绪 · 切换查看`;
    region.querySelectorAll('[data-playback]').forEach(node => { node.disabled = !playable; });
    find('[data-play]').textContent = slot?.playing ? '暂停' : '播放';
    const slider = find('[data-seek]'); slider.max = String(Math.max(0, (slot?.input.durationInFrames ?? 1) - 1));
    if (document.activeElement !== slider) slider.value = String(requested?.frame ?? frame ?? 0);
    const jump = find('[data-frame-input]'); jump.max = slider.max;
    if (document.activeElement !== jump) jump.value = String(requested?.frame ?? frame ?? 0);
    const scene = frame === undefined ? null : slot.input.scenes.find(scene => frame >= scene.time.startFrame && frame < scene.time.startFrame + scene.time.durationInFrames);
    find('[data-frame-output]').textContent = frame === undefined ? '尚无已提交帧' : `已提交帧 ${frame} · ${(frame / slot.input.output.fps).toFixed(2)} / ${(slot.input.durationInFrames / slot.input.output.fps).toFixed(2)} 秒`;
    find('[data-playing-scene]').textContent = scene ? `播放 Scene ${slot.input.scenes.indexOf(scene) + 1} · ${scene.time.source === 'draft' ? '草稿时间（Draft Duration）' : 'Speech 时间'}` : '暂无可播放 Scene';
    const versions = find('[data-preview-versions]');
    for (const target of ['current', 'candidate']) {
      const destination = versionFor(target);
      const version = active?.target === target && !active.failed ? active : destination;
      const panel = versions.querySelector(`[data-version="${target}"]`);
      const button = panel.querySelector('button');
      button.disabled = !destination?.ready || destination.failed || destination === active;
      button.setAttribute('aria-pressed', String(version === active));
      button.textContent = targetName(target) + (version === active ? destination !== active && destination?.ready ? ' · 切换新版' : ' · 正在查看' : destination?.ready ? ' · 切换查看' : '');
      panel.querySelector('[data-version-label]').textContent = version ? version.label + (version === active ? ' · 正在查看' : '') : '尚未构建';
      panel.querySelector('[data-version-state]').textContent = buildStates[target] || (version?.ready ? 'Preview 已就绪' : version ? '正在初始化' : '等待构建');
      for (const key of ['brief', 'input', 'media', 'environment']) panel.querySelector(`[data-evidence="${key}"]`).textContent = evidenceText(version?.freshness?.[key], key === 'brief');
      panel.querySelector('[data-version-eligibility]').textContent = version?.stale || version?.buildStale ? '上一成功预览 · 已过期 · 不能用于接受' : 'Preview 就绪不代表通过全部接受门禁';
    }
    find('[data-preview-details]').textContent = slot ? JSON.stringify({ identity: slot.identity, freshness: slot.freshness ?? null }, null, 2) : '尚未绑定';
    region.querySelectorAll('[data-build-preview]').forEach(node => { node.disabled = busy; });
    if (callUpdate) { find('.preview-versions').hidden = true; find('.preview-evidence').hidden = true; find('[data-preview-switch]').hidden = true; find('[data-preview-freshness]').hidden = true; find('[data-preview-state]').hidden = true; renderUpdate(); }
  }
  function switchTo(slot) {
    if (!slot?.ready || slot.failed || slot === active) return;
    command(active, 'PAUSE');
    if (active) { active.iframe.hidden = true; active.playing = false; }
    for (const previous of slots.values()) if (previous !== slot && previous.target === slot.target) dispose(previous);
    active = slot; requested = null; failure = ''; if (pending === slot) pending = null; slot.iframe.hidden = false;
    command(slot, 'VOLUME', { volume: Number(find('[data-volume]').value) });
    command(slot, 'MUTE', { muted: find('[data-mute]').getAttribute('aria-pressed') === 'true' });
    // 首次显示固定首帧；只有对应 FRAME 会更新确认位置。
    sceneNotice = ''; seek(0); locateScene(); update();
  }
  function seek(frame) {
    if (!active?.ready || !Number.isSafeInteger(frame) || frame < 0 || frame >= active.input.durationInFrames) return;
    command(active, 'PAUSE'); active.playing = false;
    requested = { frame, requestId: String(++serial) }; command(active, 'SEEK', requested); update();
  }
  function receive(descriptor, activateEmpty = true) {
    if (!region || slots.has(descriptor.instanceId)) return;
    // 查看副本显式指向原实例；相同内容的重新构建仍是新的验收证据。
    const sourceId = descriptor.sourceInstanceId ?? descriptor.instanceId;
    if ([...slots.values()].some(slot => (slot.sourceInstanceId ?? slot.instanceId) === sourceId)) return;
    const target = descriptor.target;
      if (descriptor.version !== 1 || new URL(descriptor.url).origin !== descriptor.origin || descriptor.origin === location.origin) throw new Error('Preview 来源或协议无效');
      // 活动画面始终保留；淘汰隐藏槽位，为新目标腾出唯一第二槽位。
      for (const slot of slots.values()) if (slot !== active) dispose(slot);
      const iframe = document.createElement('iframe');
      iframe.title = descriptor.label; iframe.sandbox = 'allow-scripts allow-same-origin'; iframe.referrerPolicy = 'no-referrer'; iframe.hidden = true;
      const slot = { ...descriptor, stale: Object.values(descriptor.freshness ?? {}).some(item => item.status !== 'latest'), iframe, ready: false, playing: false, frame: undefined };
      for (const previous of slots.values()) if (previous.target === target && (JSON.stringify(previous.identity) !== JSON.stringify(slot.identity) || (target === 'candidate' && previous.baseline !== slot.baseline))) previous.buildStale = true;
      slots.set(slot.instanceId, slot); pending = slot; buildStates[target] = '正在初始化';
      slot.timeout = setTimeout(() => markFailed(slot, '初始化超时'), 30000);
      iframe.src = slot.url; find('[data-preview-screen]').append(iframe);
      if (!active && activateEmpty) { active = slot; iframe.hidden = false; }
    update();
  }
  async function build(target) {
    if (busy) return;
    busy = true; buildStates[target] = '正在构建'; failure = ''; update(); const key = projectKey;
    try {
      const result = await call('build', { target, parentOrigin: location.origin });
      if (key !== projectKey) { const discarded = (result.structuredContent ?? result).preview; if (discarded) void call('release', { instanceId: discarded.instanceId }).catch(() => {}); return; }
      const data = result.structuredContent ?? result;
      if (data.error || !data.preview) throw new Error(data.error?.message ?? '构建未返回 Preview');
      const descriptor = data.preview;
      receive(descriptor, true);
    } catch (error) {
      if (key !== projectKey) return;
      failure = `${targetName(target)}构建失败：${error.message}`; buildStates[target] = '构建失败';
      for (const slot of slots.values()) if (slot.target === target) slot.buildStale = true;
    }
    finally { if (key === projectKey) { busy = false; update(); } }
  }
  async function compare() {
    const target = active?.target === 'current' ? 'candidate' : 'current';
    const existing = versionFor(target);
    if (existing?.ready) { switchTo(existing); return; }
    comparisonTarget = target;
    const key = projectKey;
    try {
      const result = await call('view', { target, parentOrigin: location.origin });
      if (key !== projectKey) return;
      const descriptor = (result.structuredContent ?? result).preview;
      if (descriptor) { receive(descriptor, true); return; }
      if (getProject()?.writable === false) { sceneNotice = '对应版本尚无可查看的 Preview，请在有写权的对话中准备。'; comparisonTarget = null; update(); return; }
      await build(target);
    } catch (error) { failure = error.message; update(); }
    finally { if (key === projectKey && !pending) comparisonTarget = null; }
  }
  window.addEventListener('message', event => {
    const m = event.data;
    if (!m || typeof m !== 'object') return;
    const slot = slots.get(m.instanceId);
    if (!slot || slot.failed || event.origin !== slot.origin || event.source !== slot.iframe.contentWindow || m.token !== slot.token) return;
    if (m.version !== 1) { markFailed(slot, '协议主版本不兼容'); return; }
    if (m.type === 'BOOT') { command(slot, 'INIT', { identity: slot.identity }); return; }
    if (m.type === 'READY') {
      if (JSON.stringify(m.identity) !== JSON.stringify(slot.identity)) { markFailed(slot, '预览身份不匹配'); return; }
      clearTimeout(slot.timeout); slot.ready = true; buildStates[slot.target] = 'Preview 已就绪';
      if (slot.target === 'candidate') candidateReady(slot.instanceId);
      command(slot, 'PAUSE');
      command(slot, 'VOLUME', { volume: Number(find('[data-volume]').value) });
      command(slot, 'MUTE', { muted: find('[data-mute]').getAttribute('aria-pressed') === 'true' });
      if (slot === active) { if (pending === slot) pending = null; locateScene(); }
      if (!active || comparisonTarget === slot.target) { comparisonTarget = null; switchTo(slot); }
    } else if (m.type === 'FRAME') {
      if (!slot.ready || !Number.isSafeInteger(m.frame) || m.frame < 0 || m.frame >= slot.input.durationInFrames) return;
      if (slot === active && requested && (m.requestId !== requested.requestId || m.frame !== requested.frame)) return;
      slot.frame = m.frame; if (slot === active && requested) requested = null;
    } else if (m.type === 'PLAYING') { slot.playing = true; if (slot !== active || document.hidden || document.getElementById('workspace-agent')?.hidden) command(slot, 'PAUSE'); }
    else if (m.type === 'PAUSED') slot.playing = false;
    else if (m.type === 'BUFFERING') slot.buffering = m.buffering === true;
    else if (m.type === 'ERROR') { markFailed(slot, `预览关闭（${String(m.code).slice(0, 100)}）`); return; }
    update();
  });
  function pauseHidden() { if (isHidden()) { command(active, 'PAUSE'); if (active) active.playing = false; update(); } else { locateScene(); if (callUpdate) void refreshUpdate(); } }
  document.addEventListener('visibilitychange', pauseHidden);
  setInterval(async () => {
    if (callUpdate) { void refreshUpdate(); return; }
    if (!region?.isConnected || isHidden() || polling || busy) return;
    polling = true;
    try {
      const key = projectKey;
      for (const target of canViewExisting() ? ['candidate', 'current'] : []) {
        // 更新候选保留活动画面；等待用户切换期间不让另一版本挤掉新候选。
        if (target === 'current' && pending && pending !== active) continue;
        try {
          const result = await call('view', { target, parentOrigin: location.origin });
          if (key !== projectKey) return;
          const descriptor = (result.structuredContent ?? result).preview;
          if (descriptor && observed.get(target) !== descriptor.instanceId) {
            observed.set(target, descriptor.instanceId); receive(descriptor, true);
          }
        } catch { /* 状态查询继续核对现有画面；不把短暂读取失败当作新版本。 */ }
      }
      for (const slot of slots.values()) {
        try {
          const result = await call('status', { instanceId: slot.instanceId }); const data = result.structuredContent ?? result;
          slot.stale = data.stale !== false || !!data.error;
          slot.freshness = data.freshness;
        } catch { slot.stale = true; slot.freshness = undefined; }
      }
      update();
    } finally { polling = false; }
  }, 4000);
  return {
    discarded() {
      for (const slot of [...slots.values()]) if (slot.target === 'candidate') {
        if (active === slot) { active = null; requested = null; }
        if (pending === slot) pending = null;
        dispose(slot);
      }
      buildStates.candidate = ''; update();
    },
    superseded() {
      for (const slot of slots.values()) if (slot.target === 'candidate') { slot.buildStale = true; slot.stale = true; }
      sceneNotice = '新目标已接管，旧证据需重新核对。'; update();
    },
    accepted(instanceId, revisionId) {
      for (const previous of slots.values()) if (previous.target === 'current' && previous.instanceId !== instanceId) { previous.label = previous.label.replace(/^当前/, '历史修订'); previous.buildStale = true; }
      const slot = slots.get(instanceId); if (!slot) { update(); return; }
      slot.target = 'current'; slot.revisionId = revisionId; slot.label = `当前 · ${revisionId.slice(0, 8)}`;
      slot.iframe.title = slot.label; update();
    },
    pauseHidden,
    blocked: updateBusy,
    inputsChanged(inputKey) {
      if (callUpdate) { if (inputKey && inputKey === lastInputKey) return; lastInputKey = inputKey; editGeneration++; waitChoice = true; hideVideo(); if (updateBusy()) void operateUpdate('cancel'); update(); return; }
      const changed = [...slots.values()].some(slot => !slot.buildStale);
      for (const slot of slots.values()) slot.buildStale = true;
      if (changed) update();
    },
    viewingRevision() { return active?.target === 'current' ? active.revisionId : undefined; },
    showCurrent(revisionId) {
      const slot = [...slots.values()].find(item => item.revisionId === revisionId && item.ready && !item.failed);
      if (slot) switchTo(slot);
      else { sceneNotice = `目标修订 ${revisionId.slice(0, 8)} 的 Preview 尚不可用，请在此构建并核对当前修订。`; update(); }
      region?.scrollIntoView({ block: 'start' }); const target = region?.querySelector('[data-preview-title]'); if (target) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
    },
    receive,
    candidateInstance() { return versionFor('candidate')?.instanceId; },
    showCandidate() { switchTo(versionFor('candidate')); },
    locateEvidence(location) {
      const slot = slots.get(location.instanceId);
      if (!slot?.ready || slot.failed) { sceneNotice = '对应 Preview 实例已不可用，请重新准备证据。'; update(); return; }
      deferredScene = null; switchTo(slot); seek(location.frame);
    },
    navigateFrame(location) {
      if (active?.instanceId !== location.instanceId) { sceneNotice = '此位置属于另一个 Preview 实例，请先显式切换对应版本。'; update(); return; }
      seek(location.frame);
    },
    selectScene(id) { deferredScene = id; sceneNotice = ''; locateScene(); update(); },
    mount(node) {
      const project = getProject();
      const key = project ? `${project.projectId}:${project.directory}` : undefined;
      if (key !== projectKey) { for (const slot of slots.values()) dispose(slot); active = pending = null; requested = null; failure = ''; busy = false; projectKey = key; deferredScene = null; sceneNotice = ''; buildStates.current = buildStates.candidate = ''; observed.clear(); comparisonTarget = null; updateState = undefined; updateRequest = null; undoConfirmation = null; updateViewing = false; viewSerial++; updateError = ''; operationError = ''; waitChoice = false; lastInputKey = undefined; editGeneration++; updatePolling = false; }
      if (node === region) { update(); return; }
      region = node; if (!region) return;
      region.innerHTML = `<header><h2 data-preview-title>成片 Preview</h2><div class="preview-versions"><button data-preview-compare disabled>对比当前</button><button data-build-preview="current">构建当前版本</button><button data-build-preview="candidate">构建候选</button></div></header><details class="preview-evidence"><summary>版本与输入新鲜度</summary><div class="preview-comparison" data-preview-versions aria-label="当前与候选状态对照">${['current', 'candidate'].map(target => `<section data-version="${target}" aria-label="${targetName(target)}状态"><button data-version-switch="${target}" aria-pressed="false">${targetName(target)}</button><span data-version-label></span><p data-version-state></p><dl>${[['brief','Brief'],['input','项目输入'],['media','Media Revision'],['environment','执行环境']].map(([key,label]) => `<div><dt>${label}</dt><dd data-evidence="${key}">状态未知</dd></div>`).join('')}</dl><p data-version-eligibility></p></section>`).join('')}</div></details><p data-preview-freshness role="status" hidden></p><p data-preview-state role="status" aria-live="polite"></p><button data-preview-switch hidden></button><div data-preview-screen></div><div class="preview-controls"><button data-play data-playback disabled>播放</button><button data-step="-1" data-playback disabled aria-label="上一帧">上一帧</button><button data-step="1" data-playback disabled aria-label="下一帧">下一帧</button><label class="preview-progress">进度<input type="range" min="0" max="0" value="0" data-seek data-playback disabled></label><label>帧号<input type="number" min="0" step="1" value="0" data-frame-input data-playback disabled></label><button data-jump data-playback disabled>跳转</button><label>音量<input type="range" min="0" max="1" step="0.05" value="1" data-volume data-playback disabled></label><button data-mute data-playback disabled aria-pressed="false">静音</button></div><div class="preview-position"><output data-frame-output>尚无已提交帧</output><span data-playing-scene>暂无可播放 Scene</span></div><details><summary>预览详情</summary><pre data-preview-details></pre></details>`;
      if (callUpdate) {
        const controls = document.createElement('section'); controls.className = 'video-update'; controls.setAttribute('aria-label', '视频更新');
        controls.innerHTML = '<h3>内容同步</h3><p data-update-state role="status" aria-live="polite"></p><div class="video-update-actions"><button data-update-start>仅同步表格内容</button><button data-update-cancel hidden>取消同步</button><button data-update-reconcile hidden>核对更新结果</button></div><p data-update-note></p><p>同步内容并调整画面：请在当前 Codex 对话提出要求。</p><p data-update-warnings></p><section class="video-update-last" aria-label="最近画面创作"><h3>最近画面创作</h3><p data-update-last></p><button data-update-undo hidden>撤回上次画面调整</button><div data-update-confirmation hidden><p data-update-confirm-note></p><div class="video-update-actions"><button data-update-confirm-cancel>取消</button><button data-update-confirm>确认撤回</button></div></div></section><details><summary>更新检查详情</summary><p data-update-compatibility></p><pre data-update-evidence></pre></details>';
        region.insertBefore(controls, find('[data-preview-screen]'));
        controls.querySelector('[data-update-start]').onclick = () => void operateUpdate('start');
        controls.querySelector('[data-update-cancel]').onclick = () => void operateUpdate('cancel');
        controls.querySelector('[data-update-undo]').onclick = () => { undoConfirmation = updateState?.undo; renderUpdate(); find('[data-update-confirm-cancel]').focus(); };
        controls.querySelector('[data-update-confirm-cancel]').onclick = () => { undoConfirmation = null; renderUpdate(); find('[data-update-undo]').focus(); };
        controls.querySelector('[data-update-confirm]').onclick = () => { if (undoConfirmation) void operateUpdate('undo', undoConfirmation.requestId); };
        controls.querySelector('[data-update-reconcile]').onclick = () => void refreshUpdate();
        queueMicrotask(() => void refreshUpdate());
      }
      region.append(find('.preview-evidence'));
      detailRoot = document.querySelector('[data-review-preview-details]');
      if (detailRoot) for (const details of region.querySelectorAll('details')) if (!details.closest('.video-update')) detailRoot.append(details);
      const handleClick = event => {
        const button = event.target.closest('button'); if (!button || button.disabled) return;
        if (button.hasAttribute('data-preview-compare')) void compare();
        if (button.dataset.buildPreview) void build(button.dataset.buildPreview);
        if (button.dataset.versionSwitch) switchTo(versionFor(button.dataset.versionSwitch));
        if (button.hasAttribute('data-preview-switch')) switchTo(pending);
        if (button.hasAttribute('data-play')) command(active, active?.playing ? 'PAUSE' : 'PLAY');
        if (button.dataset.step) seek(Math.min(active.input.durationInFrames - 1, Math.max(0, (requested?.frame ?? active?.frame ?? 0) + Number(button.dataset.step))));
        if (button.hasAttribute('data-jump')) { const input = find('[data-frame-input]'); if (input.reportValidity()) seek(Number(input.value)); }
        if (button.hasAttribute('data-mute')) { const muted = button.getAttribute('aria-pressed') !== 'true'; button.setAttribute('aria-pressed', String(muted)); command(active, 'MUTE', { muted }); }
      };
      region.addEventListener('click', handleClick);
      detailRoot?.addEventListener('click', handleClick);
      find('[data-seek]').addEventListener('input', event => seek(Number(event.target.value)));
      find('[data-volume]').addEventListener('input', event => command(active, 'VOLUME', { volume: Number(event.target.value) }));
      find('[data-frame-input]').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.reportValidity()) seek(Number(event.target.value)); });
      update();
    },
  };
}

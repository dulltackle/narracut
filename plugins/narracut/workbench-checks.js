/** 面板常驻，批次切换与状态刷新都不触碰 Preview 或候选操作节点。 */
function createChecksWorkbench(call, getProject, navigate) {
  let region, projectKey, data = { batches: [], gates: [] }, selected, busy = false, polling = false, error = '';
  const names = { preview: '候选 Preview', delivery: '候选交付', accept: '接受候选', render: '最终 Render' };
  const stages = { layout: '目录', manifest: 'Manifest', dependencies: '依赖与锁图', capsule: '执行胶囊', build: '类型、静态、Bundle 与 Runtime', static: '静态能力与确定性', typecheck: '类型', bundle: 'Bundle', composition: 'Composition', runtime: 'Runtime', evidence: '验收证据', render: '最终 Render' };
  const statusNames = { waiting: '等待', running: '运行', passed: '通过', issues: '有问题', 'not-run': '未运行' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const locationText = location => location.kind === 'file' ? location.path : location.kind === 'scene' ? `Scene ${location.sceneId}` : location.kind === 'frame' ? `第 ${location.frame} 帧 · 仅为时间导航上下文` : '整个 Render Program';
  function content(node, html) {
    if (node.dataset.content === html) return;
    const opened = [...node.querySelectorAll('details[open]')].map(item => item.dataset.key);
    const focused = node.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    node.innerHTML = html; node.dataset.content = html;
    for (const item of node.querySelectorAll('details')) item.open = opened.includes(item.dataset.key);
    if (focused) [...node.querySelectorAll('[data-focus]')].find(item => item.dataset.focus === focused)?.focus({ preventScroll: true });
  }
  function update() {
    if (!region?.isConnected) return;
    const latest = data.batches.at(-1), batch = data.batches.find(item => item.id === selected) ?? latest;
    const running = latest?.status === 'running';
    const start = region.querySelector('[data-check-start]'); start.disabled = busy || running; start.textContent = latest ? '重新检查' : '检查当前候选';
    const cancel = region.querySelector('[data-check-cancel]'); cancel.hidden = !running; cancel.disabled = busy;
    const status = region.querySelector('[data-check-status]');
    status.textContent = error || (busy ? '正在读取检查状态' : !latest ? '尚未检查 · 选择检查当前候选以收集诊断' : latest.status === 'cancelled' ? '检查已取消，结果不完整' : latest.status === 'running' ? '正在检查当前候选，独立阶段继续收集' : '检查已完成');
    const stale = region.querySelector('[data-check-stale]'); stale.hidden = !latest?.stale;
    stale.textContent = '整批结果已过期 · 旧结果仅供具名参考，请重新检查。正在查看的 Preview 保持不变。';
    const select = region.querySelector('[data-check-batch]');
    content(select, data.batches.map((item, index) => `<option value="${escape(item.id)}">${index === data.batches.length - 1 ? '最新批次' : '上一批次'} · ${escape(item.id.slice(0,8))}${item.stale ? ' · 已过期' : ''}</option>`).join(''));
    select.disabled = !data.batches.length; if (batch) select.value = batch.id;
    region.querySelector('[data-check-object]').textContent = batch ? `候选 ${batch.identity.program?.slice(7,19) ?? '身份未确认'} · 批次 ${batch.id.slice(0,8)}${batch.stale ? ' · 已过期，仅供参考' : ''}` : '检查对象：当前候选 Render Program';
    content(region.querySelector('[data-check-gates]'), (data.gates.length ? data.gates : Object.keys(names).map(operation => ({ operation, status: ['accept','render'].includes(operation) ? 'disabled' : 'blocked', reason: operation === 'render' ? '尚无已接受修订的验收记录' : '尚未检查当前候选', next: ['accept','render'].includes(operation) ? '此操作尚未启用' : '检查当前候选' }))).filter(gate => gate.operation !== 'render').map(gate => `<div class="check-gate"><strong>${names[gate.operation]}</strong><span class="program-check-mark" data-state="${gate.status}">${{ available: '可用', blocked: '受阻', disabled: '尚未启用' }[gate.status]}</span><div><p>${escape(gate.reason)}</p><p class="check-next">${escape(gate.next)}</p></div></div>`).join(''));
    const problems = batch?.diagnostics ?? [];
    content(region.querySelector('[data-check-problems]'), problems.length ? problems.map((item, index) => `<article class="check-problem"><header><strong>${escape(item.message)}</strong><span class="program-check-mark" data-state="${item.severity === 'warning' ? 'warning' : 'blocked'}">${item.severity === 'warning' ? '警告 · 不阻断' : '必须修复'}</span></header><p>${escape(stages[item.stage])} · <code>${escape(item.code)}</code></p><p>主位置：${escape(locationText(item.location))}</p><p>修复建议：${escape(item.suggestion)}</p><p>影响操作：${item.operations.length ? item.operations.map(key => names[key]).join('、') : '不阻断任何操作'}</p>${['scene','frame'].includes(item.location.kind) ? `<button data-check-location="${index}" data-focus="location-${index}">${item.location.kind === 'frame' ? '定位时间上下文' : '前往 Scene'}</button>` : ''}<details data-key="${escape(batch.id)}-${index}"><summary data-focus="detail-${index}">身份与相关位置</summary><pre>${escape(JSON.stringify(item.identity, null, 2))}</pre><p>${item.related?.length ? item.related.map(location => escape(locationText(location))).join('；') : '无已证明的相关位置'}</p>${item.externalCode ? `<p>外部工具代码：${escape(item.externalCode)}</p>` : ''}</details></article>`).join('') : `<p>${!batch ? '检查后在此展示已观察到的问题与修复建议。' : batch.status !== 'complete' ? '本批次尚未收集到诊断；检查不完整。' : '本批次没有内容诊断；操作条件以上方状态为准。'}</p>`);
    content(region.querySelector('[data-check-visual-warnings]'), (batch?.visualWarnings ?? []).map(warning => `<article class="check-problem"><header><strong>${escape(warning.message)}</strong><span class="program-check-mark" data-state="warning">主观建议 · 不阻断</span></header><p>${escape(warning.suggestion)}</p><p>${escape(locationText(warning.location))}</p><details data-key="visual-${escape(warning.id)}"><summary data-focus="visual-${escape(warning.id)}">警告身份</summary><pre>${escape(JSON.stringify(warning.identity, null, 2))}</pre></details></article>`).join('') + (batch?.warningsTruncated ? '<p class="check-notice">主观警告超过 100 条，尚未全部展示，不能用于交付。</p>' : ''));
    const truncated = region.querySelector('[data-check-truncated]'); truncated.hidden = !batch?.truncated; truncated.textContent = `RESULT_TRUNCATED · 仅展示前 ${problems.length} 条，另有 ${batch?.truncated ?? 0} 条未展示；修复后重新检查。`;
    content(region.querySelector('[data-check-stages]'), (batch?.stages ?? []).map(stage => `<div class="check-stage"><span>${escape(stages[stage.id])}</span><span class="program-check-mark" data-state="${stage.status}">${statusNames[stage.status]}</span><p>${escape(stage.reason)}</p></div>`).join(''));
    region.querySelector('[data-check-identity]').textContent = batch ? JSON.stringify(batch.identity, null, 2) : '尚未绑定';
  }
  async function operation(action, quiet = false) {
    if (!projectKey || (!quiet && busy) || (quiet && (polling || busy))) return;
    const key = projectKey;
    if (quiet) polling = true; else { busy = true; error = ''; update(); }
    try {
      const result = await call(action, action === 'cancel' ? { batchId: data.batches.at(-1)?.id } : {});
      if (key !== projectKey) return;
      const value = result.structuredContent ?? result;
      if (value.error) throw new Error(value.error.message);
      if (!Array.isArray(value.batches) || !Array.isArray(value.gates)) throw new Error('未返回有效检查状态，请重新检查。');
      data = value; error = ''; if (action === 'start') selected = data.batches.at(-1)?.id;
    } catch (failure) { if (key === projectKey) { error = failure.message; for (const batch of data.batches) batch.stale = true; data.gates = data.gates.map(gate => ({ ...gate, status: gate.status === 'disabled' ? 'disabled' : 'blocked', reason: '无法确认最新检查状态，请重试' })); } }
    finally { if (key === projectKey) { if (quiet) polling = false; else busy = false; update(); } }
  }
  setInterval(() => { if (!document.hidden && !document.getElementById('workspace-agent')?.hidden && data.batches.length) void operation('status', true); }, 2000);
  return { mount(node) {
    const project = getProject(), key = project ? `${project.projectId}:${project.directory}` : undefined;
    if (key !== projectKey) { projectKey = key; data = { batches: [], gates: [] }; selected = undefined; busy = polling = false; error = ''; }
    if (region === node) { update(); return; } region = node; if (!region) return;
    region.innerHTML = `<header class="checks-head"><h2>检查与操作状态</h2><div><button data-check-start>检查当前候选</button><button data-check-cancel hidden>取消检查</button></div></header><p data-check-object></p><p data-check-status role="status" aria-live="polite"></p><p data-check-stale class="check-notice" hidden></p><div data-check-gates aria-label="最新候选四类操作状态"></div><div class="checks-results-head"><h3>问题与修复建议</h3><label>查看批次<select data-check-batch aria-label="查看检查批次"></select></label></div><div data-check-problems></div><div data-check-visual-warnings></div><p data-check-truncated class="check-notice" hidden></p><details class="checks-details"><summary>阶段及身份详情</summary><div data-check-stages></div><pre data-check-identity></pre></details>`;
    region.addEventListener('click', event => { const button = event.target.closest('button'); if (!button || button.disabled) return; if (button.hasAttribute('data-check-start')) void operation('start'); if (button.hasAttribute('data-check-cancel')) void operation('cancel'); if (button.hasAttribute('data-check-location')) { const batch = data.batches.find(item => item.id === selected) ?? data.batches.at(-1); const item = batch?.diagnostics[Number(button.dataset.checkLocation)]; if (item) navigate(item.location); } });
    region.querySelector('[data-check-batch]').addEventListener('change', event => { selected = event.target.value; update(); }); update();
  } };
}

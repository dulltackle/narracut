/* 恢复启动台只持有待确认计划；持久操作由服务端统一校验和核对。 */
window.NarracutRestore = function ({ callTool, openProject, exit }) {
  const s = { step: 'materials', snapshotPath: '', sourcePath: '', parent: '', name: '', snapshot: null, plan: null, draft: undefined, briefResult: undefined, tab: 'base', error: null, busy: false, uncertain: false, operation: null, result: null, extracted: [], extractionTarget: '', component: '', cleanup: false };
  let root, timer, renderedStep;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const titles = { materials: '选择恢复材料', plan: '核对恢复计划', brief: '解决 Brief 冲突', target: '核对新路径并确认恢复', result: '恢复已完成', extract: '仅提取内容' };
  const labels = { dsl: '脚本 DSL', briefLocal: 'Brief LOCAL', briefBase: 'Brief BASE' };
  const phases = { checking: '正在重新验证恢复计划', copying: '复制来源', applying: '应用恢复内容', validating: '全量校验', publishing: '发布项目' };
  const button = (action, text, primary = false, disabled = false) => `<button type="button" class="launch-button" data-restore-action="${action}" ${primary ? 'data-primary="true"' : ''} ${disabled || s.busy || s.uncertain ? 'disabled' : ''}>${text}</button>`;
  const field = (key, label, placeholder = '') => `<label class="restore-field">${label}<input data-restore-field="${key}" value="${esc(s[key])}" placeholder="${esc(placeholder)}" spellcheck="false" ${s.busy || s.uncertain ? 'disabled' : ''}></label>`;
  const target = () => s.parent && s.name && !/[\\/\u0000-\u001f]/.test(s.name) && !['.', '..'].includes(s.name) ? `${s.parent.replace(/[\\/]$/, '')}/${s.name}` : '';
  async function call(action, extra = {}) {
    const response = await callTool('restore_project', { action, ...extra });
    if (response?.isError) throw Object.assign(new Error(response.structuredContent?.error?.message || '恢复操作失败。'), response.structuredContent?.error, { confirmedFailure: true });
    return response.structuredContent;
  }
  const materialArgs = () => ({ snapshotPath: s.snapshotPath, sourcePath: s.sourcePath, ...(s.briefResult === undefined ? {} : { briefResult: s.briefResult }) });
  function invalidate() { s.snapshot = null; s.plan = null; s.draft = undefined; s.briefResult = undefined; s.error = null; s.operation = null; s.result = null; s.component = ''; }
  function paths() {
    return `<dl class="restore-facts"><div><dt>恢复快照</dt><dd>${esc(s.snapshotPath)}</dd></div><div><dt>明确来源</dt><dd>${esc(s.sourcePath || '尚未选择')}</dd></div><div><dt>保留的 Project ID</dt><dd>${esc(s.snapshot?.projectId)}</dd></div></dl>`;
  }
  function summary() {
    const p = s.plan;
    return `<table class="restore-ledger"><caption>内容去向</caption><tbody><tr><th scope="row">脚本 DSL</th><td>${p.dsl.from === 'snapshot' ? '应用快照中的未保存脚本' : '沿用来源脚本'} · ${p.dsl.bytes.toLocaleString()} 字节</td></tr><tr><th scope="row">Video Brief</th><td>${p.brief.conflict ? '需要解决三方冲突' : p.brief.decision === 'resolved' ? '采用明确编辑的完整结果' : p.brief.decision === 'local' ? '应用未保存内容 LOCAL' : '沿用来源文件'}${p.brief.result !== undefined ? `<details><summary>查看完整 Brief 结果</summary><pre>${esc(p.brief.result || '（空 Brief）')}</pre></details>` : ''}</td></tr><tr><th scope="row">Render Program</th><td>当前修订、候选、历史及检查点保持来源状态与关系；不移动当前修订，不创建新修订。</td></tr><tr><th scope="row">Asset、Speech、离线依赖</th><td>来自完整持久来源；快照不包含这些内容。</td></tr><tr><th scope="row">Undo/Redo、Preview</th><td>不从快照恢复。输入变化后，Preview 与验收证据需重新核对。</td></tr></tbody></table>${p.rebuildManifest ? '<p class="restore-note">来源清单缺失或损坏，将在新项目中重建原身份清单。</p>' : ''}`;
  }
  function blockers() {
    return s.plan.blockers.length ? `<section class="restore-blockers" aria-label="全部阻断问题"><h2>尚不能完整恢复</h2><ul>${s.plan.blockers.map(p => `<li><strong>${esc(p.message)}</strong><code>${esc(p.path)}</code><p>${esc(p.next)}</p></li>`).join('')}</ul></section>` : '<p class="restore-verdict"><span aria-hidden="true">●</span> 全部检查已完成，可以完整恢复</p>';
  }
  function content() {
    if (s.step === 'materials') return `<p>先检查快照，再明确选择提供完整持久内容的来源项目。前两步只读，不取得租约、不修改目录。</p>${field('snapshotPath', '恢复快照文件路径', '/恢复目录/未保存编辑.narracut-recovery.json')}<div class="restore-actions">${button('pick-snapshot', '选择快照文件…')}${button('inspect', '检查快照', true, !s.snapshotPath)}</div>${s.snapshot ? `<section class="restore-materials"><h2>快照已通过校验</h2><p>封存时间：${esc(s.snapshot.capturedAt)}</p><p class="restore-path">${esc(s.snapshot.projectId)}</p><ul>${s.snapshot.payloads.map(item => `<li>${labels[item.component]} · ${item.bytes.toLocaleString()} 字节 ${button(`content-${item.component}`, '查看完整内容')}</li>`).join('')}</ul><p class="restore-note">原路径提示：${esc(s.snapshot.sourceHint)}。此提示不是身份，不会自动寻找替代目录。</p>${field('sourcePath', '来源项目目录', '/明确选择的来源项目')}<div class="restore-actions">${button('pick-source', '选择来源文件夹…')}${button('plan', '检查来源并生成计划', true, !s.sourcePath)}</div></section>` : ''}`;
    if (s.step === 'plan') return `${blockers()}${summary()}<div class="restore-actions">${s.plan.brief.conflict ? button('brief', '解决 Brief 冲突', true) : ''}${button('target', '核对新路径', true, !!s.plan.blockers.length)}${s.plan.blockers.some(p => p.code !== 'RECOVERY_BRIEF_RESOLUTION_REQUIRED') ? button('extract', '仅提取内容') : ''}${button('materials', '重新选择材料')}</div><details><summary>摘要、格式与逐项恢复基线</summary><pre>${esc(JSON.stringify({ snapshot: s.snapshot, program: s.plan.program, baseline: s.plan.baseline, planId: s.plan.planId }, null, 2))}</pre></details>`;
    if (s.step === 'brief') {
      const names = { base: '共同基线 BASE', local: '未保存内容 LOCAL', disk: '来源文件 DISK' };
      return `<p>三份证据只读。编辑完整结果后返回计划，此处不会写回来源目录。</p><div class="brief-evidence-tabs" role="tablist" aria-label="Brief 证据">${Object.entries(names).map(([key, name]) => `<button type="button" role="tab" aria-selected="${s.tab === key}" data-restore-tab="${key}">${name}</button>`).join('')}</div><div class="brief-evidence-grid">${Object.entries(names).map(([key, name]) => `<label class="brief-evidence" data-current="${s.tab === key}">${name}<textarea readonly>${esc(s.plan.brief[key] ?? '（快照未携带 BASE）')}</textarea></label>`).join('')}</div><label class="brief-merge">完整 Brief 结果<textarea data-restore-draft>${esc(s.draft ?? s.plan.brief.local ?? '')}</textarea></label><p>返回步骤会保留草稿；更换快照或来源后需要重新核对。</p><div class="restore-actions">${button('resolve', '采用此结果并返回恢复计划', true)}${button('back-plan', '返回恢复计划')}</div>`;
    }
    if (s.step === 'target') return `<p>保留原 Project ID，在不存在的新路径恢复完整项目。现有空文件夹也不能使用。</p>${field('parent', '目标父目录', '/恢复目录')}${button('pick-parent', '选择目标父文件夹…')}${field('name', '新文件夹名', '恢复项目')}<p class="restore-final-path"><strong>完整目标路径</strong><code data-restore-target>${esc(target() || '填写父目录和新文件夹名后显示')}</code></p>${paths()}${summary()}<div class="restore-actions">${button('recover', '恢复到新文件夹', true, !target() || !!s.plan.blockers.length)}${button('back-plan', '返回恢复计划')}</div>${s.error?.code === 'PROJECT_TEMPORARY_RESIDUE' ? `<p>仅当残留标记与本次恢复及目标匹配，才允许删除并从头重试。</p>${button('cleanup', '确认删除匹配残留并重新恢复')}` : ''}`;
    if (s.step === 'extract') return `<p>完整恢复被来源问题阻断。可以分别导出已验证的载荷，提取物是普通文件，不是可打开的项目。</p><label class="restore-field">选择提取内容<select data-restore-component ${s.busy || s.uncertain ? 'disabled' : ''}>${s.plan.payloads.map(key => `<option value="${key}" ${key === s.component ? 'selected' : ''}>${labels[key]}</option>`).join('')}</select></label>${field('extractionTarget', '项目外的新文件路径', '/抢救目录/内容.md')}<div class="restore-actions">${button('export', '提取到新文件', true, !s.extractionTarget)}${button('back-plan', '返回恢复计划')}</div><ul>${s.extracted.map(item => `<li>提取完成 · 普通文件<code>${esc(item.path)}</code>${item.cleanupWarning ? `<p>${esc(item.cleanupWarning.message)}</p><code>${esc(item.cleanupWarning.path)}</code>` : ''}</li>`).join('')}</ul><p>不自动导入、覆盖或合并；来源和恢复快照保持原样。</p>`;
    return `<p class="restore-verdict"><span aria-hidden="true">●</span> 完整项目已发布，快照保持原样。</p><code class="restore-final-path">${esc(s.result.projectDirectory)}</code>${s.result.cleanupWarning ? `<p>${esc(s.result.cleanupWarning.message)}</p><code>${esc(s.result.cleanupWarning.path)}</code>` : ''}<p>恢复没有运行 Agent，也不表示 Preview 或最终 Render 已完成。</p><div class="restore-actions">${button('open', '打开恢复项目', true)}${button('exit', '返回启动台')}</div>`;
  }
  function render(focus = renderedStep !== s.step) {
    if (!root?.isConnected) return;
    const scrollTop = root.scrollTop, active = document.activeElement;
    const selector = active?.dataset.restoreAction ? `[data-restore-action="${active.dataset.restoreAction}"]` : active?.dataset.restoreField ? `[data-restore-field="${active.dataset.restoreField}"]` : null;
    renderedStep = s.step;
    root.innerHTML = `<main class="restore-main"><section class="restore-paper"><nav class="restore-steps" aria-label="恢复步骤"><span ${s.step === 'materials' ? 'aria-current="step"' : ''}>1 材料</span><span ${['plan', 'brief', 'extract'].includes(s.step) ? 'aria-current="step"' : ''}>2 恢复计划</span><span ${s.step === 'target' ? 'aria-current="step"' : ''}>3 确认恢复</span></nav><h1 tabindex="-1">${titles[s.step]}</h1>${content()}<div class="restore-feedback" aria-live="polite" role="status">${s.uncertain ? '<p>正在核对恢复结果</p><button class="launch-button" data-restore-action="status">核对恢复结果</button>' : s.busy ? `<p>${phases[s.operation?.phase] || '正在检查，请稍候'}</p>${s.operation && s.operation.phase !== 'publishing' && s.step !== 'extract' ? '<button class="launch-button" data-restore-action="cancel">取消恢复</button>' : ''}` : ''}${s.error ? `<p class="restore-error">${esc(s.error.message)}</p>${s.error.path ? `<code>${esc(s.error.path)}</code>` : ''}` : ''}</div></section><aside class="restore-aside"><h2>恢复对象</h2>${paths()}<p>快照抢救未保存的编辑。素材、语音和 Render Program 仍需要来自完整来源。</p>${button('exit', '返回启动台', false, !!s.result)}<p>步骤间核对不会改动来源。最后一次确认才创建新项目。</p></aside></main>`;
    root.querySelectorAll('[data-restore-action]').forEach(node => node.addEventListener('click', () => action(node.dataset.restoreAction)));
    root.querySelectorAll('[data-restore-field]').forEach(node => node.addEventListener('input', () => {
      const key = node.dataset.restoreField; s[key] = node.value;
      if (key === 'snapshotPath') { invalidate(); root.querySelector('.restore-materials')?.remove(); }
      if (key === 'sourcePath') { s.plan = null; s.draft = undefined; s.briefResult = undefined; }
      if (['parent', 'name'].includes(key)) s.cleanup = false;
      if (['snapshotPath', 'sourcePath'].includes(key)) root.querySelector('.restore-aside .restore-facts').outerHTML = paths();
      const final = root.querySelector('[data-restore-target]'); if (final) final.textContent = target() || '填写父目录和新文件夹名后显示';
      for (const [name, enabled] of [['inspect', s.snapshotPath], ['plan', s.sourcePath], ['recover', target()], ['export', s.extractionTarget]]) { const button = root.querySelector(`[data-restore-action="${name}"]`); if (button) button.disabled = !enabled || s.busy || s.uncertain; }
    }));
    root.querySelector('[data-restore-draft]')?.addEventListener('input', event => { s.draft = event.target.value; });
    root.querySelector('[data-restore-component]')?.addEventListener('change', event => { s.component = event.target.value; });
    root.querySelectorAll('[data-restore-tab]').forEach(node => node.addEventListener('click', () => { s.tab = node.dataset.restoreTab; render(false); root.querySelector(`[data-restore-tab="${s.tab}"]`)?.focus(); }));
    if (focus) { root.scrollTop = 0; root.querySelector('h1')?.focus({ preventScroll: true }); }
    else { if (selector) root.querySelector(selector)?.focus({ preventScroll: true }); root.scrollTop = scrollTop; }
  }
  async function pick(kind) {
    const picker = kind === 'snapshot' ? window.openai?.selectFile : window.openai?.selectDirectory;
    if (!picker) throw new Error('当前宿主没有此选择能力，请填写明确的绝对路径。');
    const result = await picker.call(window.openai, { purpose: `recovery-${kind}` });
    const path = typeof result === 'string' ? result : result?.path;
    if (!path) return;
    if (kind === 'snapshot') { s.snapshotPath = path; invalidate(); }
    else if (kind === 'source') { s.sourcePath = path; s.plan = null; s.draft = undefined; s.briefResult = undefined; }
    else s.parent = path;
  }
  async function observe(status) {
    s.operation = { ...s.operation, ...status };
    if (status.status === 'completed') {
      s.busy = false; s.uncertain = false;
      if (status.result.kind === 'file') { s.extracted.push(status.result); s.operation = null; }
      else { s.result = status.result; s.step = 'result'; }
    } else if (status.status === 'uncertain') { s.busy = false; s.uncertain = true;
    } else if (status.status === 'failed') { s.busy = false; s.uncertain = false; s.error = status.error; s.operation = null;
      if (['RECOVERY_SOURCE_CHANGED_DURING_COPY', 'RECOVERY_BASELINE_MISMATCH'].includes(status.error?.code)) { s.step = 'materials'; s.plan = null; s.briefResult = undefined; } }
    else { s.busy = true; s.uncertain = false; timer = setTimeout(() => action('status'), 600); }
  }
  async function action(name) {
    if ((s.busy || s.uncertain) && !['status', 'cancel'].includes(name)) return;
    clearTimeout(timer); s.error = null;
    if (name === 'exit') { exit(); return; }
    if (['materials', 'brief', 'target', 'extract', 'back-plan'].includes(name)) {
      s.step = name === 'back-plan' ? 'plan' : name;
      if (name === 'extract' && !s.plan.payloads.includes(s.component)) s.component = s.plan.payloads[0];
      if (name === 'brief') s.draft ??= s.plan.brief.local ?? '';
      render(); return;
    }
    s.busy = true; render(false);
    try {
      if (name.startsWith('pick-')) await pick(name.slice(5));
      else if (name.startsWith('content-')) {
        const result = await call('content', { snapshotPath: s.snapshotPath, component: name.slice(8) });
        s.busy = false; render(false); const details = document.createElement('details'); details.open = true; const summary = document.createElement('summary'); summary.textContent = '完整载荷内容'; const pre = document.createElement('pre'); pre.textContent = result.content || '（空内容）'; details.append(summary, pre); root.querySelector('.restore-paper').append(details); return;
      } else if (name === 'inspect') { s.snapshot = await call('inspect', { snapshotPath: s.snapshotPath }); }
      else if (name === 'plan' || name === 'resolve') {
        if (name === 'resolve') {
          const content = s.draft ?? '';
          if (new TextEncoder().encode(content).length > 2 * 1024 * 1024 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(content)) throw new Error('Brief 结果必须是最多 2 MiB 的严格 UTF-8。');
          s.briefResult = content;
        }
        s.plan = await call('plan', materialArgs()); s.step = 'plan';
      } else if (['recover', 'cleanup', 'export'].includes(name)) {
        if (name === 'cleanup') s.cleanup = true;
        const args = name === 'export' ? { action: 'extract', snapshotPath: s.snapshotPath, sourcePath: s.sourcePath, component: s.component, targetPath: s.extractionTarget } : { action: 'recover', ...materialArgs(), targetPath: target(), planId: s.plan.planId, confirmTemporaryCleanup: s.cleanup };
        s.operation = { operationId: crypto.randomUUID(), phase: 'checking' };
        s.operation.request = { ...args, operationId: s.operation.operationId };
        await observe(await call(args.action, Object.fromEntries(Object.entries(s.operation.request).filter(([key]) => key !== 'action'))));
        render(); return;
      } else if (name === 'status' || name === 'cancel') {
        let status;
        try { status = await call(name, { operationId: s.operation.operationId }); }
        catch (error) {
          if (error.code !== 'RECOVERY_OPERATION_UNKNOWN' || name !== 'status') throw error;
          const { action: originalAction, ...request } = s.operation.request;
          status = await call(originalAction, request);
        }
        await observe(status); render(); return;
      } else if (name === 'open') await openProject(s.result.projectDirectory);
      s.busy = false; render();
    } catch (error) {
      s.busy = false; s.error = error;
      if (s.operation && !['open'].includes(name)) {
        if (error.confirmedFailure && !['status', 'cancel'].includes(name)) s.operation = null;
        else { s.uncertain = true; s.error = null; }
      }
      render();
    }
  }
  return { mount(element) { root = element; render(); } };
};

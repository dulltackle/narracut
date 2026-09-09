/** 常驻最终输出区；只更新文本与状态，不替换 Preview 或编辑节点。 */
function createRenderWorkbench(call, getProject, settled, preview, toTable, uuid) {
  let region, projectKey, source, prepared, job, outputPath = '', busy = false, polling = false, unknown, message = '';
  const active = () => job && ['running', 'cancelling'].includes(job.status);
  const stages = { preparing: '准备与校验', rebuilding: '正在离线重建已接受 Bundle', frames: '渲染帧', encoding: '编码', publishing: '验证并写入产物', completed: '产物已验证并发布' };
  function text(selector, value) { const node = region?.querySelector(selector); if (node && node.textContent !== String(value ?? '')) node.textContent = value ?? ''; }
  function update() {
    if (!region?.isConnected) return;
    const target = active() ? job.source : prepared ?? source;
    text('[data-render-source]', target ? `${target.revisionId.slice(0, 8)} · ${target.summary}` : '正在读取当前已接受版本');
    text('[data-render-accepted]', target?.accepted ? '已接受' : '尚未接受');
    text('[data-render-ready]', source?.ready ? 'Render 就绪' : 'Render 已阻断');
    text('[data-render-issues]', (source?.issues ?? []).map(issue => `${issue.message}${issue.location ? `（${issue.location.path ?? issue.location.sceneId ?? `帧 ${issue.location.frame}`}）` : ''}`).join('\n'));
    text('[data-render-location]', active() ? job.outputPath : outputPath || '尚未选择输出位置');
    text('[data-render-format]', target?.output ? `${(target.durationInFrames / target.output.fps).toFixed(2)} 秒 · ${target.output.width} × ${target.output.height} · ${target.output.fps} fps` : '画幅和帧率来自已接受状态');
    text('[data-render-details]', JSON.stringify(target?.details ?? {}, null, 2));
    const mismatch = !!target && preview.viewingRevision() !== target.revisionId;
    region.querySelector('[data-render-mismatch]').hidden = !mismatch;
    region.querySelector('[data-render-preparation]').hidden = !prepared && !active();
    const prepare = region.querySelector('[data-render-prepare]');
    prepare.disabled = busy || !!unknown || !!active() || !settled() || !source?.ready;
    prepare.hidden = !!prepared || !!active();
    region.querySelector('[data-render-start]').disabled = busy || !!unknown || !!active() || !settled() || !outputPath || !source?.ready || prepared?.key !== source?.key;
    region.querySelector('[data-render-start]').hidden = !!active();
    region.querySelector('[data-render-pick]').disabled = busy || !!unknown || !!active();
    region.querySelector('[data-render-cancel]').hidden = !active();
    region.querySelector('[data-render-cancel]').disabled = busy || job?.status === 'cancelling';
    region.querySelector('[data-render-reconcile]').hidden = !unknown;
    region.querySelector('[data-render-success]').hidden = job?.status !== 'succeeded';
    const needsTable = source?.issues?.some(issue => ['PROJECT_CONTENT_INVALID', 'RENDER_ZERO_SCENES', 'RENDER_EMPTY_NARRATION', 'RENDER_DRAFT_DURATION', 'RENDER_MEDIA_MISSING', 'RENDER_MEDIA_CHANGED'].includes(issue.code));
    region.querySelector('[data-render-table]').hidden = !needsTable;
    region.querySelector('[data-render-candidate]').hidden = !source?.issues?.length || !!needsTable;
    region.querySelector('[data-render-retry]').hidden = job?.status !== 'failed' || !job.retryable;
    region.querySelector('[data-render-retry]').disabled = busy || !!unknown || !settled();
    text('[data-render-success-path]', job?.status === 'succeeded' ? `${job.outputPath.split('/').at(-1)} · 来源修订 ${job.source.revisionId.slice(0, 8)}\n${job.outputPath}${job.projectUpdated ? '\n项目已更新，这是启动时状态的产物。' : ''}` : '');
    text('[data-render-feedback]', unknown ? '正在核对 Render 状态；核对前不会重复启动。' : !settled() ? '项目尚未保存、存在冲突或身份不可确认，请先完成保存。' : message || (job?.status === 'cancelled' ? '已取消，未生成完整产物' : job?.status === 'failed' ? `${job.retryable ? '已接受，Render 未完成' : '此状态已接受，但已阻断再次 Render'}：${job.error.message}` : active() ? (job.status === 'cancelling' ? '正在取消并清理产物…' : `${stages[job.stage]}${job.stage === 'frames' && Number.isInteger(job.renderedFrames) ? ` · ${job.renderedFrames} / ${job.source.durationInFrames} 帧` : ''}`) : job?.status === 'succeeded' ? '产物已验证并发布' : ''));
  }
  async function request(action, args = {}) {
    const key = projectKey, response = await call(action, args), value = response.structuredContent ?? response;
    if (key !== projectKey) throw new Error('项目已切换');
    if (value.error) throw Object.assign(new Error(value.error.message), { code: value.error.code });
    return value;
  }
  async function refresh() {
    if (polling || !region?.isConnected) return;
    polling = true;
    try {
      if (unknown) {
        const value = await request('result', { requestId: unknown });
        if (value.job) { job = value.job; unknown = null; }
        else if (value.status === 'not-started') { unknown = null; message = '未启动 Render，请重新准备。'; prepared = null; }
      }
      const value = await request('status'); source = value.source;
      if (value.jobs?.length) job = value.jobs.at(-1);
      if (prepared && prepared.key !== source?.key && !active()) { prepared = null; message = '接受状态或输入已变化，请重新准备最终 Render。'; }
    } catch (error) { if (active()) unknown = job.requestId; else message = error.message; }
    finally { polling = false; update(); }
  }
  async function action(kind) {
    if (busy) return; busy = true; message = ''; update();
    try {
      if (kind === 'prepare' || kind === 'retry') { await refresh(); if (!source?.ready || !settled()) throw new Error(source?.issues?.map(item => item.message).join('；') || '请先完成保存与验收。'); prepared = source; }
      if (kind === 'pick') {
        const api = window.openai, picker = api?.selectDirectory ?? api?.pickDirectory ?? api?.requestDirectoryPicker;
        if (typeof picker !== 'function') throw new Error('宿主不支持系统输出位置选择器，请在支持此能力的宿主中打开工作台。');
        const value = await picker.call(api, { purpose: 'render-output', title: '选择最终 Render 输出文件夹', canCreateDirectories: true });
        const path = typeof value === 'string' ? value : value?.path ?? value?.directoryPath ?? value?.directory;
        if (path) outputPath = `${path.replace(/\/$/, '')}/narracut-${prepared.revisionId.slice(0, 8)}-${uuid().slice(0, 8)}.mp4`;
      }
      if (kind === 'start') {
        if (!prepared || !settled()) throw new Error('请重新准备最终 Render。');
        unknown = uuid(); update();
        try { const value = await request('start', { requestId: unknown, key: prepared.key, outputPath }); job = value.job; unknown = null; }
        catch (error) { if (['RENDER_NOT_READY', 'RENDER_BUSY', 'RENDER_OUTPUT_FAILED'].includes(error.code)) { unknown = null; throw error; } await refresh(); }
      }
      if (kind === 'cancel') { const value = await request('cancel', { jobId: job.id }); job = value.job; }
      if (kind === 'reconcile') await refresh();
      if (kind === 'reveal') {
        const api = window.openai, reveal = api?.showItemInFolder ?? api?.revealFile;
        if (typeof reveal === 'function') await reveal.call(api, { path: job.outputPath });
        else { await navigator.clipboard.writeText(job.outputPath); message = '宿主不支持文件定位，已复制实际输出路径。'; }
      }
    } catch (error) { message = error.message; }
    finally { busy = false; update(); if (['prepare', 'retry'].includes(kind) && prepared) region.querySelector('[data-render-pick]').focus({ preventScroll: true }); }
  }
  document.addEventListener('input', update);
  setInterval(() => { if (region?.isConnected && !document.hidden) { update(); void refresh(); } }, 4000);
  return { mount(node) {
    const project = getProject(), key = project && `${project.projectId}:${project.directory}`;
    if (key !== projectKey) { projectKey = key; source = prepared = job = unknown = undefined; outputPath = message = ''; }
    if (region === node) { update(); return; } region = node; if (!region) return;
    region.innerHTML = `<header><div><h2>最终 Render</h2><p data-render-source></p><div class="render-status"><span data-render-accepted></span><span data-render-ready></span></div></div><button class="render-primary" data-render-prepare>准备最终 Render</button></header><p data-render-mismatch hidden>正在查看的 Preview 与本次输出来源不同。<button data-render-target>查看目标修订</button></p><section data-render-preparation hidden><p data-render-format></p><div class="render-output"><div><strong>输出位置</strong><p data-render-location></p></div><button data-render-pick>选择输出文件夹</button></div><button class="render-primary" data-render-start>开始 Render</button></section><p data-render-issues class="render-issues"></p><button data-render-table hidden>前往表格工作区处理</button><button data-render-candidate hidden>前往候选检查与验收</button><p data-render-feedback role="status" aria-live="polite"></p><div class="render-actions"><button data-render-cancel hidden>取消 Render</button><button data-render-retry hidden>重试 Render</button><button data-render-reconcile hidden>核对 Render 状态</button></div><section data-render-success hidden><p data-render-success-path></p><button data-render-reveal>在文件夹中显示 / 复制路径</button></section><details><summary>Render 详情</summary><pre data-render-details></pre></details>`;
    region.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || button.disabled) return;
      if (button.hasAttribute('data-render-table')) { toTable(source?.issues?.find(issue => issue.location)?.location); return; }
      if (button.hasAttribute('data-render-candidate')) { const target = document.querySelector('[data-candidate-region]'); if (target) { target.setAttribute('tabindex', '-1'); target.scrollIntoView({ block: 'start' }); target.focus({ preventScroll: true }); } return; }
      if (button.hasAttribute('data-render-target')) { preview.showCurrent((active() ? job.source : prepared ?? source).revisionId); return; }
      for (const kind of ['prepare', 'pick', 'start', 'cancel', 'retry', 'reconcile', 'reveal']) if (button.hasAttribute(`data-render-${kind}`)) void action(kind);
    });
    update(); void refresh();
  }};
}

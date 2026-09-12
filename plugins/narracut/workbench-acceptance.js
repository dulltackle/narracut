/** 接受确认与历史常驻；刷新只改相关节点，不重建 Preview、Scene 或 Composer。 */
function createAcceptanceWorkbench(call, getProject, settled, delivery, preview, changed) {
  let region, projectKey, confirmation, busy = false, checking = false, unresolved, message = '', cleanupPending = false, history = {}, poll = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  async function request(action, args = {}) {
    const key = projectKey, response = await call(action, args), value = response.structuredContent ?? response;
    if (key !== projectKey) throw new Error('项目已切换');
    if (value.error) throw Object.assign(new Error(value.error.message), { code: value.error.code });
    return value;
  }
  const visible = () => region?.isConnected && !document.hidden && !document.getElementById('workspace-agent')?.hidden;
  function notice(text) { message = text; update(); }
  function update() {
    if (!region?.isConnected) return;
    if (confirmation && !settled()) { confirmation = null; message = '项目输入正在变化，旧确认已失效；保存完成后请重新审阅。'; }
    region.querySelector('[data-accept-message]').textContent = message;
    region.querySelectorAll('[data-from-revision]').forEach(button => { button.disabled = busy || !history.revisions?.find(item => item.revisionId === button.dataset.fromRevision)?.valid; });
    region.querySelector('[data-accept-review]').disabled = busy || !!unresolved || !settled();
    region.querySelector('[data-accept-review]').hidden = !!confirmation;
    region.querySelector('[data-accept-confirm]').hidden = !confirmation;
    region.querySelector('[data-accept-submit]').disabled = busy || checking || !!unresolved || !settled();
    region.querySelector('[data-accept-cancel]').disabled = busy;
    region.querySelector('[data-accept-result]').hidden = !unresolved;
    region.querySelector('[data-accept-result]').disabled = busy;
    region.querySelector('[data-accept-cleanup]').hidden = !cleanupPending;
    region.querySelector('[data-accept-cleanup]').disabled = busy;
    region.querySelector('[data-current-revision]').textContent = history.current ? `当前修订 · ${history.current.slice(0,8)}` : '当前修订';
  }
  function renderConfirmation(value) {
    confirmation = value;
    region.querySelector('[data-accept-summary]').innerHTML = `<h3>接受完整候选</h3><p>${esc(value.summary)}</p><dl><div><dt>候选身份</dt><dd><code>${esc(value.record.identity.program)}</code></dd></div><div><dt>输入新鲜度</dt><dd>Brief、Scene、媒体和执行环境均对应最新状态</dd></div><div><dt>检查结论</dt><dd>${value.record.zeroScenes ? 'Manifest 与构建检查通过；零 Scene 不需运行期代表帧' : '必要检查与完整代表帧证据已通过'}</dd></div></dl><h4>全部非阻断警告</h4>${value.record.warnings.length ? `<ul>${value.record.warnings.map(text=>`<li>${esc(text)}</li>`).join('')}</ul>` : '<p>当前没有非阻断警告。</p>'}<p>接受后终结本次任务，删除 Agent 任务检查点；创建不可变修订、更新当前修订并消费整个候选及候选恢复检查点；不代表已完成最终 Render。</p>${value.willPrune ? '<p class="accept-warning">历史已满，最旧修订将自动移出最近 20 个修订。</p>' : ''}`;
    update(); region.querySelector('[data-accept-cancel]').focus({preventScroll:true});
  }
  async function success(value) {
    unresolved = null; confirmation = null; cleanupPending = value.cleanupPending || value.taskCleanupPending;
    if (value.revision.valid !== false && value.revision.current !== false) preview.accepted(value.revision.acceptance?.instanceId, value.revision.revisionId);
    notice(`${value.taskCleanupPending ? '候选已接受，任务收尾待完成' : cleanupPending ? '已接受，清理待重试' : '已接受'} · ${value.revision.revisionId.slice(0,8)} · ${value.revision.summary}${value.revision.valid === false ? '；请查看历史中的损坏原因，接受事实不会撤销。' : ''}`);
    await changed(value).catch(()=>notice('已接受；候选状态刷新失败，请重新检查完整性。')); await refreshHistory().catch(()=>{});
  }
  async function action(kind, args) {
    if (busy) return; busy = true; update();
    try {
      if (kind === 'review') { if (!settled()) throw new Error('请先完成项目输入保存。'); const value = await request('review'); renderConfirmation(value.confirmation); message = ''; }
      else if (kind === 'accept') {
        const reviewed = confirmation; if (!reviewed || !settled()) throw new Error('确认已失效，请重新审阅。');
        unresolved = { requestId: reviewed.requestId, baseline: reviewed.baseline, currentRevision: reviewed.currentRevision }; notice('提交前正在复核门禁');
        try { await success(await request('accept', { key: reviewed.key, requestId: reviewed.requestId, confirmed: true })); }
        catch (error) {
          if (['ACCEPTANCE_STALE','ACCEPTANCE_NOT_COMMITTED','ACCEPTANCE_NOT_READY','ACCEPTANCE_BLOCKED','ACCEPTANCE_CLEANUP_PENDING','ACCEPTANCE_CONFIRMATION_REQUIRED'].includes(error.code)) {
            unresolved = null; confirmation = null; notice(`未接受，当前修订与候选已保留。${error.message}`);
          } else { notice('正在核对接受结果'); await reconcile(); }
        }
      } else if (kind === 'result') { notice('正在核对接受结果'); await reconcile(); }
      else if (kind === 'cleanup') { const value = await request('cleanup'); cleanupPending = value.cleanupPending; notice(cleanupPending ? `已接受，清理待重试：${value.cleanupError}` : '已接受，清理完成'); }
      else if (kind === 'from-history') {
        if (delivery.view().delivery || getProject()?.hasCandidate) throw new Error('已有候选，请返回现有候选，先接受或明确放弃。');
        const value = await request(kind, args);
        if (value.status === 'candidate-created') { confirmation = null; region.querySelector('dialog').close(); await changed(); notice(`已从修订 ${args.revisionId.slice(0,8)} 创建候选 · 待针对最新输入检查、构建 Preview 和验收`); region.scrollIntoView({block:'start'}); }
      }
    } catch (error) { notice(unresolved ? '正在核对接受结果；连接恢复后点击“核对接受结果”，完成前不会再次提交。' : error.message); }
    finally { busy = false; update(); }
  }
  async function reconcile() {
    const value = await request('result', unresolved);
    if (value.status === 'accepted') await success(value);
    else if (value.status === 'not-committed') { unresolved = null; confirmation = null; notice('未接受，当前修订与候选已保留；请重新审阅后重试。'); }
    else throw new Error('结果未知');
  }
  async function refreshHistory() {
    const value = await request('history'); if (!value.revisions) return; history = value;
    if (value.cleanupPending) { cleanupPending = true; if (!message) message = value.taskCleanupPending ? '候选已接受，任务收尾待完成' : '已接受，清理待重试'; }
    const list = region.querySelector('[data-history-list]');
    const signature = JSON.stringify(value); if (list.dataset.signature === signature) { update(); return; }
    list.dataset.signature = signature;
    const expanded = new Set([...list.querySelectorAll('details[open][data-revision]')].map(node=>node.dataset.revision));
    const expandedRecords = new Set([...list.querySelectorAll('[data-revision] [data-record-details][open]')].map(node => node.closest('[data-revision]').dataset.revision));
    const html = value.revisions.map(item => `<details data-revision="${esc(item.revisionId)}" ${expanded.has(item.revisionId)?'open':''}><summary><strong>${esc(item.summary ?? '损坏的修订')}</strong><span>${esc(item.revisionId.slice(0,8))}${item.current?' · 当前':''}</span><small>${item.acceptedAt ? esc(new Date(item.acceptedAt).toLocaleString('zh-CN')) : '初始修订'} · ${esc(({candidate:'来自候选',starter:'初始程序'})[item.source] ?? item.source ?? '来源不可确认')}</small></summary>${item.valid ? `<p>${item.acceptance ? '这是接受时的检查事实，不能代表最新输入的验收；代表帧图片不随历史保留。' : '初始修订尚无用户验收记录。'}</p>${item.acceptance ? `<p>检查阶段：${esc(item.acceptance.stages?.map(stage=>`${stage.id}：${stage.status}`).join('；'))}</p><ul>${(item.acceptance.warnings??[]).map(warning=>`<li>${esc(warning)}</li>`).join('')}</ul>` : ''}<details data-record-details ${expandedRecords.has(item.revisionId)?'open':''}><summary>完整指纹、协议版本与验收记录</summary><pre>${esc(JSON.stringify(item,null,2))}</pre></details>` : `<p class="accept-warning">${esc(item.error)}。此项仍占历史名额，不能用于比较或回退。</p>`}<button data-from-revision="${esc(item.revisionId)}" ${!item.valid || busy?'disabled':''}>以此修订创建候选</button><p>将针对最新项目输入重新检查、构建 Preview 和验收，不直接切换当前修订。</p></details>`).join('');
    if (list.dataset.content !== html) { list.innerHTML = html; list.dataset.content = html; }
    update();
  }
  async function verifyConfirmation() {
    if (!confirmation || busy || poll) return;
    poll = checking = true; const original = confirmation; update();
    try { const value = await request('review'); if (confirmation === original && value.confirmation?.key !== original.key) { confirmation = null; notice('候选、输入或检查已变化，旧确认已失效；请重新审阅。'); } }
    catch { if (confirmation === original) { confirmation = null; notice('证据过期或无法复核，请重新准备证据后审阅。'); } }
    finally { poll = checking = false; update(); }
  }
  setInterval(()=>{if(visible()){update();void verifyConfirmation();}},2000);
  document.addEventListener('input',()=>{if(visible())update();});
  return { blocked: () => busy || !!unresolved, mount(node) {
    const project = getProject(), key = project && `${project.projectId}:${project.directory}`;
    if (key !== projectKey) { projectKey = key; confirmation = unresolved = undefined; message = ''; history = {}; busy = cleanupPending = false; }
    if (region === node) { update(); return; } region = node; if (!region) return;
    region.innerHTML = `<div class="accept-actions"><button data-accept-review>审阅并接受</button><span data-current-revision>当前修订</span><button data-open-history>修订历史</button></div><section data-accept-confirm hidden><div data-accept-summary></div><div class="accept-actions"><button data-accept-cancel>取消</button><button class="accept-primary" data-accept-submit>接受完整候选</button></div></section><p data-accept-message role="status" aria-live="polite"></p><button data-accept-result hidden>核对接受结果</button><button data-accept-cleanup hidden>重试清理</button><dialog class="revision-history" aria-labelledby="revision-history-title"><header><h2 id="revision-history-title">修订历史</h2><button data-close-history>关闭修订历史</button></header><p>最近 20 个，包含当前修订</p><p>已有候选时，请先接受或明确放弃，再从历史创建。</p><button data-return-candidate>返回现有候选</button><p data-history-message role="status"></p><div data-history-list></div></dialog>`;
    const dialog = region.querySelector('dialog');
    dialog.addEventListener('close',()=>region.querySelector('[data-open-history]').focus({preventScroll:true}));
    region.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.hasAttribute('data-accept-review'))void action('review');
      if(button.hasAttribute('data-accept-submit'))void action('accept');
      if(button.hasAttribute('data-accept-cancel')){confirmation=null;update();region.querySelector('[data-accept-review]').focus({preventScroll:true});}
      if(button.hasAttribute('data-accept-result'))void action('result');
      if(button.hasAttribute('data-accept-cleanup'))void action('cleanup');
      if(button.hasAttribute('data-open-history')){dialog.showModal();region.querySelector('[data-close-history]').focus();void refreshHistory().catch(error=>region.querySelector('[data-history-message]').textContent=error.message);}
      if(button.hasAttribute('data-close-history')||button.hasAttribute('data-return-candidate')){dialog.close();if(button.hasAttribute('data-return-candidate'))region.scrollIntoView({block:'start'});}
      if(button.dataset.fromRevision)void action('from-history',{revisionId:button.dataset.fromRevision}).then(()=>{region.querySelector('[data-history-message]').textContent=message;});
    });
    void refreshHistory().catch(()=>{}); update();
  }};
}

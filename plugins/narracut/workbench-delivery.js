/** 交付面板常驻；采集刷新、图片展开不操作用户播放器和表格选择。 */
function createDeliveryWorkbench(call, getProject, preview, navigateScene) {
  let region, projectKey, data = {}, busy = false, polling = false, error = '', page = 0, receipt = '', pictureGeneration = 0, queuedInstance, requestSerial = 0, appliedSerial = 0;
  const pictures = new Map();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const reasons = {'film-start':'全片首帧','film-end':'全片尾帧','scene-start':'开始','scene-middle':'中间','scene-end':'结束前','boundary-before':'边界前','boundary-after':'边界后',transition:'Transition 补点',motion:'运动补点'};
  const current = () => data.delivery;
  const visible = () => region?.isConnected && !document.hidden && !document.getElementById('workspace-agent')?.hidden;
  function content(node, html) {
    if (node.dataset.content === html) return;
    const focused = node.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    node.innerHTML = html; node.dataset.content = html;
    if (focused) [...node.querySelectorAll('[data-focus]')].find(item => item.dataset.focus === focused)?.focus({preventScroll:true});
  }
  function figure(point, label) {
    const state = point.status === 'failed' ? '采集失败' : point.observation ? '已检查' : point.status === 'captured' ? '已采集 · 待检查' : '待采集';
    return `<figure><figcaption>${escape(label)} · 帧 ${point.frame}<small>${(point.frame / (data.output?.fps || 30)).toFixed(2)} 秒 · ${state}</small></figcaption><button data-enlarge="${point.frame}" aria-label="放大帧 ${point.frame} 图像" aria-expanded="false" data-focus="image-${point.frame}" ${point.status !== 'captured' || current().stale ? 'disabled' : ''}><img data-frame-picture="${point.frame}" alt="帧 ${point.frame} 代表画面" hidden><span data-image-placeholder="${point.frame}">${point.status === 'captured' ? '正在读取图像' : state}</span><span class="delivery-zoom-label">放大图像</span></button>${point.error ? `<p class="delivery-notice">${escape(point.error)}</p>` : ''}${point.observation ? `<p>检查观察：${escape(point.observation)}</p>` : ''}<button data-evidence-seek="${point.frame}" data-focus="seek-${point.frame}" ${current().stale ? 'disabled' : ''}>在对应 Preview 定位</button></figure>`;
  }
  function frames() {
    const delivery = current(), target = region.querySelector('[data-delivery-frames]');
    if (!delivery || !region.querySelector('[data-evidence-details]').open) return;
    const sceneIds = [...new Set(delivery.frames.flatMap(point => point.reasons.map(reason => reason.sceneId).filter(Boolean)))];
    const pages = Math.max(1, Math.ceil(sceneIds.length / 4)); page = Math.min(page, pages - 1);
    const groups = sceneIds.slice(page * 4, page * 4 + 4).map(id => {
      const points = delivery.frames.filter(point => point.reasons.some(reason => reason.sceneId === id));
      const boundary = delivery.frames.flatMap(point => point.reasons).find(reason => reason.kind === 'boundary-before' && reason.boundary.startsWith(id + ':'))?.boundary;
      const pair = boundary ? delivery.frames.filter(point => point.reasons.some(reason => reason.boundary === boundary)) : [];
      return `<section class="delivery-scene"><h4 tabindex="-1" data-page-heading>Scene ${sceneIds.indexOf(id) + 1}<code>${escape(id)}</code></h4><div class="delivery-filmstrip">${points.map(point => figure(point, point.reasons.filter(reason => reason.sceneId === id).map(reason => reasons[reason.kind]).join(' / '))).join('')}</div>${pair.length ? `<div data-boundary><h5>与下一 Scene 的边界</h5><div class="delivery-boundary">${pair.map(point => figure(point, point.reasons.filter(reason => reason.boundary === boundary).map(reason => reasons[reason.kind]).join(' / '))).join('')}</div></div>` : ''}</section>`;
    }).join('');
    // 补点跟随时间所在 Scene 的页；与基础点重合时仍明确展示来源和理由。
    const selectedIds = sceneIds.slice(page * 4, page * 4 + 4);
    const starts = sceneIds.map(id => ({ id, frame: delivery.frames.find(point => point.reasons.some(reason => reason.sceneId === id && reason.kind === 'scene-start'))?.frame ?? 0 }));
    const supplements = delivery.frames.filter(point => point.reasons.some(reason => reason.source === 'agent') && selectedIds.includes(starts.filter(scene => scene.frame <= point.frame).at(-1)?.id));
    content(target, groups + (supplements.length ? `<section class="delivery-scene"><h4>补充关键点 · Agent</h4><div class="delivery-filmstrip">${supplements.map(point => figure(point, point.reasons.filter(reason => reason.source === 'agent').map(reason => `${reasons[reason.kind]}：${reason.reason}`).join('；'))).join('')}</div></section>` : '') + `<nav class="delivery-pages" aria-label="代表帧分页"><button data-page="-1" data-focus="page-previous" ${page === 0 ? 'disabled' : ''}>上一页</button><span role="status" aria-live="polite">第 ${page + 1} / ${pages} 页 · 共 ${sceneIds.length} 个 Scene</span><button data-page="1" data-focus="page-next" ${page + 1 >= pages ? 'disabled' : ''}>下一页</button></nav>`);
    void loadPictures();
  }
  async function loadPictures() {
    const delivery = current(), generation = pictureGeneration;
    if (!delivery || delivery.stale) return;
    const nodes = [...region.querySelectorAll('[data-frame-picture]')];
    for (const node of nodes) {
      const frame = Number(node.dataset.framePicture), point = delivery.frames.find(item => item.frame === frame);
      if (point?.status !== 'captured') continue;
      if (!pictures.has(frame)) {
        pictures.set(frame, null);
        try {
          const result = await call('image',{deliveryId:delivery.id,frame});
          if (generation !== pictureGeneration || delivery.id !== current()?.id) return;
          const value = result.structuredContent ?? result;
          const image = result.content?.find(item => item.type === 'image');
          if (value.error || !image || value.digest !== point.digest) throw new Error(value.error?.message ?? '图像身份不匹配');
          pictures.set(frame, `data:${image.mimeType};base64,${image.data}`);
        } catch (failure) { if (generation !== pictureGeneration) return; pictures.set(frame, {error:failure.message}); }
      }
      const picture = pictures.get(frame);
      for (const image of region.querySelectorAll(`[data-frame-picture="${frame}"]`)) {
        const placeholder = image.parentElement.querySelector('[data-image-placeholder]');
        if (typeof picture === 'string') { image.src = picture; image.hidden = false; placeholder.hidden = true; }
        else if (picture?.error) placeholder.textContent = `${picture.error} · 收起后重新展开可重试读取`;
      }
    }
  }
  function update() {
    if (!region?.isConnected) return;
    const delivery = current(), report = delivery?.report, batch = data.checks?.batches?.at(-1);
    const state = region.querySelector('[data-delivery-state]');
    state.textContent = error ? `身份未知 · ${error}` : delivery?.stale ? '已过期 · 请针对最新候选重新准备' : data.status === 'ready' ? '可交付 · 等待用户判断' : '尚未齐备';
    state.dataset.state = data.status === 'ready' && !error ? 'ready' : 'incomplete';
    content(region.querySelector('[data-delivery-summary]'), `<dl><div><dt>目标</dt><dd>${escape(report?.goal ?? '等待 Agent 提交本次目标')}</dd></div><div><dt>变更摘要</dt><dd>${escape(report?.summary ?? '等待 Agent 提交具体变更')}</dd></div><div><dt>候选身份</dt><dd>${escape(delivery ? delivery.binding.identity.program : '尚未绑定候选 Preview')}</dd></div><div><dt>输入新鲜度</dt><dd>${!delivery ? '尚未确认' : delivery.stale || error ? '已过期或无法确认 · 不可交付' : 'Brief、Scene、Asset、Speech、媒体与执行环境对应当前输入'}</dd></div><div><dt>检查结果</dt><dd>${!batch ? '尚未检查候选' : batch.stale ? '检查批次已过期' : batch.status === 'complete' ? '批次已完成 · 操作条件见检查面板' : '正在检查候选'}</dd></div></dl>`);
    const missing = [];
    if (!delivery) missing.push('先创建候选并构建候选 Preview，系统将在就绪后准备证据。');
    else {
      if (!report) missing.push('Agent 尚未提交目标、变更摘要、全部警告及 Scene 建议。');
      if (data.collecting) missing.push('系统正在采集代表帧；当前播放器保持原状态。');
      if (delivery.frames.some(point => point.status === 'failed')) missing.push('存在采集失败帧，请查看原因并重试失败项。');
      if (delivery.checked < delivery.frames.length) missing.push(`Agent 尚需检查 ${delivery.frames.length - delivery.checked} 帧；读取图像不等于完成检查。`);
      if (!batch || batch.status !== 'complete' || batch.stale || data.checks?.gates?.find(gate => gate.operation === 'preview')?.status === 'blocked') missing.push('请完成最新候选的必要检查，详情见“检查与操作状态”。');
      if (batch?.truncated || batch?.warningsTruncated) missing.push('检查结果或警告未完整展示，不能用于交付。');
    }
    content(region.querySelector('[data-delivery-missing]'), missing.map(message=>`<li>${escape(message)}</li>`).join(''));
    region.querySelector('[data-delivery-progress]').textContent = !delivery ? '基础覆盖等待 Preview 时间线' : delivery.zeroScenes ? '运行期代表帧不适用 · 以下展示 Manifest 与构建证据' : `基础覆盖 ${delivery.frames.filter(point=>point.reasons.some(reason=>reason.source==='system')).length} 帧 · 补充关键点 ${delivery.frames.filter(point=>point.reasons.some(reason=>reason.source==='agent')).length} 帧 · 已采集 ${delivery.captured} / ${delivery.frames.length} · 已检查 ${delivery.checked} / ${delivery.frames.length}`;
    content(region.querySelector('[data-delivery-warnings]'), `<h3>非阻断警告</h3>${(report?.warnings ?? []).map(warning=>`<p>${escape(warning)}</p>`).join('')}${(batch?.diagnostics ?? []).filter(item=>item.severity==='warning').map(item=>`<p>${escape(item.message)} · ${escape(item.suggestion)}</p>`).join('')}${(batch?.visualWarnings ?? []).map(item=>`<p>${escape(item.message)} · ${escape(item.suggestion)}</p>`).join('')}${!report ? '<p>等待 Agent 提交完整警告清单。</p>' : !report.warnings.length && !batch?.visualWarnings?.length && !batch?.diagnostics?.some(item=>item.severity==='warning') ? '<p>当前报告未提出非阻断警告。</p>' : ''}`);
    content(region.querySelector('[data-delivery-suggestions]'), `<h3>Scene 修改建议</h3>${report?.suggestions.length ? report.suggestions.map((item,index)=>`<article><strong>${escape(item.action)}</strong><code>Scene ID · ${escape(item.sceneId)}</code><p>${escape(item.observation)}</p><p>建议内容：${escape(item.content)}</p><p>理由：${escape(item.reason)}</p><button data-copy-suggestion="${index}" data-focus="copy-${index}">复制建议</button><button data-go-scene="${index}" data-focus="scene-${index}">前往表格工作区</button></article>`).join('') : `<p>${report ? '当前报告没有 Scene 修改建议。' : '等待 Agent 提交建议；建议不会直接修改 Scene。'}</p>`}`);
    const build = region.querySelector('[data-delivery-prepare]'); build.disabled = busy || data.collecting; build.textContent = delivery?.stale ? '为最新 Preview 重新准备' : '准备候选证据';
    region.querySelector('[data-delivery-retry]').hidden = !delivery?.frames.some(point=>point.status==='failed'); region.querySelector('[data-delivery-retry]').disabled = busy || data.collecting || delivery?.stale;
    content(region.querySelector('[data-full-plan]'), delivery ? `<p>证据 ${escape(delivery.id)} · Preview ${escape(delivery.binding.instanceId)}</p>${delivery.zeroScenes ? `<p>Manifest ${escape(batch?.stages?.find(stage=>stage.id==='manifest')?.status ?? '未检查')} · 构建 ${escape(batch?.stages?.find(stage=>stage.id==='build')?.status ?? '未检查')}</p><pre>${escape(JSON.stringify(delivery.binding,null,2))}</pre>` : `<ol>${delivery.frames.map(point=>`<li>帧 ${point.frame}：${point.reasons.map(reason=>escape(`${reasons[reason.kind]}${reason.sceneId ? ' · '+reason.sceneId : ''}${reason.boundary ? ' · '+reason.boundary : ''}${reason.reason ? ' · Agent：'+reason.reason : ''}`)).join('；')}</li>`).join('')}</ol>`}` : '等待完整计划。');
    region.querySelector('[data-delivery-build-proof]').hidden = !delivery?.zeroScenes;
    region.querySelector('[data-delivery-build-proof]').textContent = delivery?.zeroScenes ? `Manifest：${batch?.stages?.find(stage=>stage.id==='manifest')?.status === 'passed' ? '通过' : '尚未通过'} · 构建：${batch?.stages?.find(stage=>stage.id==='build')?.status === 'passed' ? '通过' : '尚未通过'} · Bundle ${delivery.binding.bundle}` : '';
    frames();
    const nextReceipt = `${delivery?.id}:${delivery?.reportRevision}:${batch?.id}:${data.warningsKey}`;
    if (visible() && report && !delivery.stale && !error && batch && batch.status === 'complete' && !batch.stale && !batch.truncated && !batch.warningsTruncated && receipt !== nextReceipt) {
      receipt = nextReceipt;
      void operation('displayed',{deliveryId:delivery.id,reportRevision:delivery.reportRevision,batchId:batch.id,warningsKey:data.warningsKey},true).catch(()=>{receipt='';});
    }
  }
  function focusRegion(selector) { const target = document.querySelector(selector); if (!target) return; target.tabIndex = -1; target.scrollIntoView({block:'start'}); target.focus({preventScroll:true}); }
  async function operation(action,args={},quiet=false) {
    if (!projectKey || (!quiet && busy) || (quiet && polling)) return;
    const key = projectKey, serial = ++requestSerial; if(quiet)polling=true;else busy=true;
    try {
      const result=await call(action,args), value=result.structuredContent??result;
      if(key!==projectKey || serial < appliedSerial)return;
      appliedSerial = serial;
      if(value.error)throw new Error(value.error.message);
      if(!Object.hasOwn(value,'delivery'))return;
      if(value.delivery?.id!==current()?.id){page=0;pictures.clear();pictureGeneration++;}
      data=value;error='';
    } catch(failure){if(key===projectKey){error=failure.message;receipt='';if(data.delivery)data.delivery.stale=true;}}
    finally{if(key===projectKey){if(quiet)polling=false;else busy=false;update();if(queuedInstance&&!busy){const instanceId=queuedInstance;queuedInstance=undefined;void operation('prepare',{instanceId});}}}
  }
  setInterval(()=>{if(visible() && (current() || preview.candidateInstance() || getProject()?.hasCandidate))void operation('status',{},true);},2000);
  return {
    candidateReady(instanceId){if(busy)queuedInstance=instanceId;else void operation('prepare',{instanceId});},
    mount(node){
      const project=getProject(),key=project?`${project.projectId}:${project.directory}`:undefined;
      if(key!==projectKey){projectKey=key;queuedInstance=undefined;data={};busy=polling=false;error=receipt='';page=0;pictures.clear();pictureGeneration++;}
      if(region===node){update();return;}region=node;if(!region)return;
      region.innerHTML='<header><h2>候选交付</h2><strong data-delivery-state role="status" aria-live="polite">尚未齐备</strong></header><div data-delivery-summary></div><ul data-delivery-missing></ul><div class="delivery-actions"><button data-delivery-preview>查看候选 Preview</button><button data-delivery-prepare>准备候选证据</button><button data-delivery-retry hidden>重试失败项</button><button data-delivery-checks>查看检查详情</button></div><p data-delivery-progress></p><p data-delivery-build-proof hidden></p><div class="delivery-report"><section data-delivery-warnings></section><section data-delivery-suggestions></section></div><details data-evidence-details><summary>展开代表帧证据</summary><div data-delivery-frames></div></details><details><summary>完整覆盖计划与身份</summary><div data-full-plan></div></details><p class="delivery-footnote">代表帧检查不记录用户观看范围，也不自动判定审美质量。接受候选与最终 Render 尚未启用。</p>';
      region.addEventListener('click',event=>{
        const button=event.target.closest('button');if(!button||button.disabled)return;
        if(button.hasAttribute('data-delivery-preview')){preview.showCandidate();focusRegion('[data-preview-state]');}
        if(button.hasAttribute('data-delivery-checks'))focusRegion('[data-program-checks]');
        if(button.hasAttribute('data-delivery-prepare')){const instanceId=preview.candidateInstance();if(instanceId)void operation('prepare',{instanceId});else{error='请先构建候选 Preview';update();}}
        if(button.hasAttribute('data-delivery-retry'))void operation('retry',{deliveryId:current().id});
        if(button.hasAttribute('data-evidence-seek')){preview.locateEvidence({instanceId:current().binding.instanceId,frame:Number(button.dataset.evidenceSeek)});focusRegion('[data-preview-state]');}
        if(button.hasAttribute('data-enlarge')){button.classList.toggle('delivery-enlarged');const enlarged=button.classList.contains('delivery-enlarged');button.setAttribute('aria-expanded',String(enlarged));button.setAttribute('aria-label',`${enlarged?'收起':'放大'}帧 ${button.dataset.enlarge} 图像`);button.querySelector('img').title=enlarged?'点击收起图像':'点击放大图像';button.querySelector('.delivery-zoom-label').textContent=enlarged?'收起图像':'放大图像';}
        if(button.dataset.page){page+=Number(button.dataset.page);pictures.clear();pictureGeneration++;frames();region.querySelector('[data-page-heading]')?.focus();}
        if(button.hasAttribute('data-go-scene'))navigateScene(current().report.suggestions[Number(button.dataset.goScene)].sceneId);
        if(button.hasAttribute('data-copy-suggestion')){const suggestion=current().report.suggestions[Number(button.dataset.copySuggestion)];void navigator.clipboard.writeText(`Scene ID: ${suggestion.sceneId}\n观察：${suggestion.observation}\n操作：${suggestion.action}\n内容：${suggestion.content}\n理由：${suggestion.reason}`).then(()=>{button.textContent='已复制';}).catch(()=>{button.textContent='复制失败，请选择文本复制';});}
      });
      region.querySelector('[data-evidence-details]').addEventListener('toggle',()=>{pictures.clear();pictureGeneration++;frames();});
      update();
    },
  };
}

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createNarracutRequestHandler } from './server';
import type { CodexHostAdapter } from './codex-host';

const URI = 'ui://narracut/workbench-v1.html';

/** 仅由当前对话启动的进程传入身份；不从浏览器参数或共享 MCP 进程环境推断。 */
export async function startWorkbenchPanel(options: { threadId?: string; codexHost?: CodexHostAdapter } = {}) {
  const threadId = options.threadId?.trim() || null;
  const handler = createNarracutRequestHandler({ conversation: threadId ? { threadId } : null, codexHost: options.codexHost });
  const conversation = threadId
    ? { status: 'bound', threadId, source: 'CODEX_THREAD_ID' }
    : { status: 'unavailable', threadId: null };
  const token = randomBytes(32).toString('hex');
  let origin = '';
  const prefix = `/${token}/`;
  const call = async (request: any) => {
    if (request.method !== 'tools/call') throw new Error('面板只接受工作台工具调用。');
    return handler(request);
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    try {
      // 校验 Host 防止 DNS rebinding；秘密路径与严格 Origin 防止其他网站调用本地写工具。
      if (req.headers.host !== new URL(origin).host || !req.url?.startsWith(prefix)) { res.writeHead(404).end(); return; }
      const route = req.url.slice(prefix.length);
      if (req.method === 'GET' && route === '') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(panelHtml()); return;
      }
      if (req.method === 'GET' && route === 'view') {
        const resource = await handler({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: URI } }) as any;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(resource.contents[0].text.replace('</head>', `${pickerBridge()}</head>`)); return;
      }
      if (req.method === 'GET' && route === 'state') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(await call({ id: 1, method: 'tools/call', params: { name: 'get_workbench', arguments: {} } }))); return;
      }
      if (req.method !== 'POST' || route !== 'rpc') { res.writeHead(404).end(); return; }
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') { res.writeHead(403).end(); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 256 * 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = await call(request);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : '工作台请求失败，请重试。' } }));
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) { await handler.dispose(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('本地面板未返回监听地址。');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}${prefix}`, conversation, status: 'prepared' as const,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await handler.dispose();
    },
  };
}

function pickerBridge() {
  return `<script>
(()=>{let id=0;const pending=new Map();
window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin)return;const m=event.data,entry=pending.get(m?.id);if(!entry)return;pending.delete(m.id);clearTimeout(entry.timer);const failure=m.error??(m.result?.isError?m.result.structuredContent?.error:null);if(failure)entry.reject(new Error(failure.message));else entry.resolve(m.result?.structuredContent);});
function pick(kind,options){return new Promise((resolve,reject)=>{const key='picker-'+(++id),project=kind==='directory'&&['create-parent','open-project'].includes(options?.purpose);const timer=setTimeout(()=>{pending.delete(key);reject(new Error('系统选择窗口超时，请重试。'));},330000);pending.set(key,{resolve,reject,timer});parent.postMessage({jsonrpc:'2.0',id:key,method:'tools/call',params:{name:project?'select_project_directory':'select_workbench_path',arguments:project?{purpose:options.purpose}:{kind}}},location.origin);});}
window.openai={selectDirectory:options=>pick('directory',options),selectFile:options=>pick('file',options),selectFiles:options=>pick('files',options)};
})();
</script>`;
}

function panelHtml() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Narracut 工作台</title>
<style>html,body{margin:0;height:100%;background:#090d0e;color:#f1f3eb;font-family:"Noto Sans SC",sans-serif}iframe{display:block;border:0;width:100%;height:100dvh}#feedback{position:fixed;inset:0;display:grid;place-content:center;padding:24px;background:#0d1213}#feedback[hidden]{display:none}h1{font-size:22px}p{max-width:65ch;line-height:1.75;overflow-wrap:anywhere}button{justify-self:start;min-height:44px;padding:8px 16px;border:1px solid #9dbcf0;border-radius:6px;background:#245da9;color:white;font-size:16px;cursor:pointer}button:focus-visible{outline:2px solid #9dbcf0;outline-offset:3px}</style>
<iframe title="Narracut 完整工作台" inert aria-hidden="true"></iframe><section id="feedback" role="status"><h1>正在连接工作台</h1><p id="reason">正在同步最新项目与任务状态…</p><button id="retry" hidden>重试显示工作台</button></section>
<script>
let frame=document.querySelector('iframe');
const feedback=document.getElementById('feedback'), reason=document.getElementById('reason'), retry=document.getElementById('retry');
let timer, generation=0, controller;
function failed(message){generation++;controller?.abort();clearTimeout(timer);frame.inert=true;frame.setAttribute('aria-hidden','true');feedback.hidden=false;feedback.querySelector('h1').textContent='工作台未能显示';reason.textContent=message+' 任务状态尚未核实，不能据此判断任务已停止。已保存的成果会保留；重试只重新读取工作台。';retry.hidden=false;}
function post(target,message){target.postMessage(message,location.origin);}
async function json(path,options,signal){const response=await fetch(path,{...options,signal,cache:'no-store'});const value=await response.json();if(!response.ok)throw new Error(value.error?.message??'本地工作台连接失败');return value;}
window.addEventListener('message',async event=>{
 if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
 const m=event.data;if(m?.jsonrpc!=='2.0')return;
 const attempt=generation,target=event.source,signal=controller.signal;
 if(signal.aborted)return;
 try {
  if(m.method==='ui/initialize')post(target,{jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'narracut-local-panel',version:'1'},hostCapabilities:{},hostContext:{}}});
  else if(m.method==='ui/notifications/initialized'){
   const result=await json('state',{},signal);if(attempt!==generation)return;if(result.isError)throw new Error(result.structuredContent?.error?.message??'项目状态读取失败');post(target,{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result});
  } else if(m.method==='ui/notifications/workbench-synchronized'){
   clearTimeout(timer);frame.inert=false;frame.removeAttribute('aria-hidden');feedback.hidden=true;
  } else if(m.method==='tools/call'){
   const response=await json('rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)},signal);
   if(attempt===generation)post(target,response);
  }
 } catch(error){if(attempt!==generation||signal.aborted)return;if(m.id!==undefined)post(target,{jsonrpc:'2.0',id:m.id,error:{code:-32000,message:error.message}});else failed(error.message);}
});
function connect(){
 generation++;controller?.abort();controller=new AbortController();
 retry.hidden=true;feedback.hidden=false;feedback.querySelector('h1').textContent='正在连接工作台';reason.textContent='正在同步最新项目与任务状态…';
 clearTimeout(timer);timer=setTimeout(()=>failed('连接超时，请检查本地面板服务是否仍在运行。'),15000);
 // 新浏览上下文隔离旧页面的消息、权限与 Preview；服务和任务继续运行。
 const next=document.createElement('iframe');next.title='Narracut 完整工作台';next.inert=true;next.setAttribute('aria-hidden','true');next.src='view';frame.replaceWith(next);frame=next;
}
retry.addEventListener('click',connect);connect();
</script></html>`;
}

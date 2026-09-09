/** 固定驱动在 preview 胶囊内重放实例字节；所有网络请求只允许从快照应答。 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { CAPSULE_BROWSER_ARGUMENTS } from './execution-capsule';
const request = JSON.parse(await readFile('/inputs/input/capture.json', 'utf8'));
const browser = spawn(process.env.NARRACUT_BROWSER!, [...CAPSULE_BROWSER_ARGUMENTS], { stdio: ['pipe','pipe','pipe','pipe','pipe'] });
browser.stdout?.resume(); browser.stderr?.resume();
const pipe = browser.stdio[3] as import('node:stream').Writable;
const output = browser.stdio[4] as import('node:stream').Readable;
let sequence = 0, wire = '';
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void }>();
let pageLoaded: (() => void) | undefined;
let requestFailure: unknown;
function command(method: string, params: object = {}, sessionId?: string): Promise<any> {
  return new Promise((resolve,reject) => { const id = ++sequence; pending.set(id, { resolve,reject }); pipe.write(JSON.stringify({ id,method,params,sessionId }) + '\0'); });
}
output.on('data', bytes => {
  wire += bytes.toString(); let cut;
  while ((cut = wire.indexOf('\0')) >= 0) {
    const message = JSON.parse(wire.slice(0, cut)); wire = wire.slice(cut + 1);
    const wait = pending.get(message.id);
    if (message.method === 'Page.loadEventFired') pageLoaded?.();
    if (wait) { pending.delete(message.id); message.error ? wait.reject(message.error) : wait.resolve(message.result); }
    else if (message.method === 'Fetch.requestPaused') void respond(message.params, message.sessionId).catch(error => {
      // 媒体 seek 可在应答前取消请求；失效 ID 不影响当前帧的就绪证明。
      if (error?.code === -32602 && error?.message === 'Invalid InterceptionId.') return;
      requestFailure = error;
    });
  }
});
const parentUrl = request.parentOrigin + '/__narracut_capture__';
const descriptor = request.descriptor;
const parentScript = `const d=${JSON.stringify(descriptor).replace(/</g, '\\u003c')};window.proof={ready:false,frame:null,error:null};const iframe=document.querySelector('iframe');function send(type,extra={}){iframe.contentWindow.postMessage({version:1,instanceId:d.instanceId,token:d.token,type,...extra},d.origin)}window.addEventListener('message',e=>{const m=e.data;if(e.source!==iframe.contentWindow||e.origin!==d.origin||m?.instanceId!==d.instanceId||m.token!==d.token)return;if(m.version!==1){proof.error='协议不兼容';return}if(m.type==='BOOT')send('INIT',{identity:d.identity});if(m.type==='READY'){if(JSON.stringify(m.identity)!==JSON.stringify(d.identity)){proof.error='身份不一致';return}proof.ready=true;send('MUTE',{muted:true});send('PAUSE')}if(m.type==='FRAME'&&m.requestId===proof.requestId&&m.frame===proof.requested)proof.frame=m.frame;if(m.type==='ERROR')proof.error=m.code});window.seek=frame=>{proof.frame=null;proof.requested=frame;proof.requestId=String(frame);send('SEEK',{frame,requestId:proof.requestId})};iframe.src=d.url;`;
async function respond(params: any, sessionId: string) {
  let bytes: Buffer | undefined, type = 'application/octet-stream';
  if (params.request.url === parentUrl) {
    bytes = Buffer.from(`<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts allow-same-origin"></iframe><script>${parentScript}</script>`); type = 'text/html';
  } else {
    const file = request.files[params.request.url];
    if (file) { bytes = await readFile('/inputs/' + file); type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : type; }
  }
  if (!bytes) { await command('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }, sessionId); return; }
  await command('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: type }], body: bytes.toString('base64') }, sessionId);
}
const results: Array<{ frame: number; error?: string; errorCode?: string }> = [];
function frameFailure(error: unknown) {
  return { error: (error as Error).message, errorCode: (error as any).code === 'RUNTIME_FRAME_FAILED' ? 'RUNTIME_FRAME_FAILED' : 'EVIDENCE_CAPTURE_FAILED' };
}
try {
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  await command('Page.enable', {}, sessionId);
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
  await command('Emulation.setDeviceMetricsOverride', { width: descriptor.input.output.width, height: descriptor.input.output.height, deviceScaleFactor: 1, mobile: false }, sessionId);
  const loaded = new Promise<void>(resolve => { pageLoaded = resolve; });
  await command('Page.navigate', { url: parentUrl }, sessionId);
  await loaded;
  async function evaluate(expression: string) {
    const value = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (value.exceptionDetails) {
      const description = value.exceptionDetails.exception?.description ?? '';
      throw Object.assign(new Error('帧执行或媒体就绪检查失败'), { code: /RUNTIME_FRAME_FAILED|STATIC_FORBIDDEN_CAPABILITY|STATIC_NONDETERMINISTIC_API/.test(description) ? 'RUNTIME_FRAME_FAILED' : 'EVIDENCE_CAPTURE_FAILED' });
    }
    return value.result.value;
  }
  async function wait(condition: string) {
    return evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+10000;function check(){if(window.proof?.error)return reject(new Error(proof.error));if(${condition})return resolve(true);if(Date.now()>end)return reject(new Error('等待帧提交超时'));setTimeout(check,10)}check()})`);
  }
  await wait('window.proof?.ready');
  for (const frame of request.frames) {
    try {
      await evaluate(`window.seek(${frame})`); await wait(`window.proof.frame===${frame}`);
      // 子帧文档内等待字体及图片解码；不会访问 Player 内部对象。
      const { frameTree } = await command('Page.getFrameTree', {}, sessionId);
      const child = frameTree.childFrames?.[0]?.frame.id;
      if (!child) throw new Error('Preview 文档未就绪');
      const { executionContextId } = await command('Page.createIsolatedWorld', { frameId: child, worldName: 'narracut-evidence' }, sessionId);
      const settled = await command('Runtime.evaluate', { contextId: executionContextId, expression: 'Promise.all([document.fonts.ready,...Array.from(document.images).map(img=>img.decode())]).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))', awaitPromise: true }, sessionId);
      if (settled.exceptionDetails) throw Object.assign(new Error('图片解码失败'), { code: 'RUNTIME_FRAME_FAILED' });
      await wait(`window.proof.frame===${frame}`);
      if (requestFailure) throw new Error(`快照请求失败：${JSON.stringify(requestFailure)}`);
      const image = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
      const png = Buffer.from(image.data, 'base64'); if (png.length > 8 * 1024 * 1024) throw new Error('单帧图像超过 8 MiB');
      await writeFile(`/output/${frame}.png`, png); results.push({ frame });
    } catch (error) { results.push({ frame, ...frameFailure(error) }); }
  }
  await writeFile('/output/result.json', JSON.stringify({ instanceId: descriptor.instanceId, identity: descriptor.identity, results }));
} catch (error) {
  for (const frame of request.frames) if (!results.some(item => item.frame === frame)) results.push({ frame, ...frameFailure(error) });
  await writeFile('/output/result.json', JSON.stringify({ instanceId: descriptor.instanceId, identity: descriptor.identity, results }));
} finally { browser.kill('SIGKILL'); process.exit(0); }

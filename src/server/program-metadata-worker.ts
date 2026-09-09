// 固定 CDP 驱动仅在 Metadata 胶囊运行，不能从项目配置加载。
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { CAPSULE_BROWSER_ARGUMENTS } from './execution-capsule';
const browser = spawn(process.env.NARRACUT_BROWSER!, [...CAPSULE_BROWSER_ARGUMENTS], { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] });
browser.stdout?.resume(); browser.stderr?.resume();
const input = browser.stdio[3] as import('node:stream').Writable;
const output = browser.stdio[4] as import('node:stream').Readable;
let sequence = 0, wire = '';
let loaded: (() => void) | undefined;
const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void }>();
output.on('data', bytes => {
  wire += bytes.toString(); let cut;
  while ((cut = wire.indexOf('\0')) >= 0) {
    const message = JSON.parse(wire.slice(0, cut)); wire = wire.slice(cut + 1);
    const pending = waiting.get(message.id);
    if (pending) { waiting.delete(message.id); message.error ? pending.reject(message.error) : pending.resolve(message.result); }
    else if (message.method === 'Fetch.requestPaused') void respond(message.params, message.sessionId).catch(error => {
      // 浏览器可以撤销初始化中的媒体请求，不再应答已失效的请求 ID。
      if (error?.code === -32602 && error?.message === 'Invalid InterceptionId.') return;
      process.exit(1);
    });
    else if (message.method === 'Page.loadEventFired') loaded?.();
  }
});
function command(method: string, params: object = {}, sessionId?: string): Promise<any> {
  return new Promise((resolve, reject) => { const id = ++sequence; waiting.set(id, { resolve, reject }); input.write(JSON.stringify({ id, method, params, sessionId }) + '\0'); });
}
async function respond(params: any, sessionId: string) {
  const url = new URL(params.request.url);
  if (url.href === 'https://narracut.invalid/metadata.html') {
    await command('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<!doctype html><meta charset="utf-8"><div id="root"></div>').toString('base64') }, sessionId); return;
  }
  const path = url.origin === 'https://narracut.invalid' && /^\/media\/[a-f0-9]{64}$/.test(url.pathname) ? url.pathname.slice(1) : undefined;
  const bytes = path ? await readFile('/inputs/' + path).catch(() => undefined) : undefined;
  if (!bytes) { await command('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }, sessionId); return; }
  await command('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, body: bytes.toString('base64') }, sessionId);
}
try {
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  await command('Page.enable', {}, sessionId);
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
  const navigation = new Promise<void>(resolve => { loaded = resolve; });
  await command('Page.navigate', { url: 'https://narracut.invalid/metadata.html' }, sessionId);
  await navigation;
  const bundle = await readFile('/inputs/bundle/bundle.js', 'utf8');
  const evaluated = await command('Runtime.evaluate', { expression: bundle }, sessionId);
  if (evaluated.exceptionDetails) throw new Error('RUNTIME_ENTRY_INVALID');
  const binding = JSON.parse(await readFile('/inputs/input/binding.json', 'utf8'));
  const result = await command('Runtime.evaluate', { expression: `new Promise((resolve,reject)=>{window.addEventListener('error',()=>reject(new Error('RUNTIME_FRAME_FAILED')));window.__narracutBind(${JSON.stringify(binding.input)},${JSON.stringify(binding.speech)});function check(){if(window.__narracutCheck)resolve(window.__narracutCheck);else setTimeout(check,10)}check()})`, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails || !result.result.value) throw new Error('RUNTIME_FRAME_FAILED');
  await writeFile('/output/metadata.json', JSON.stringify(result.result.value));
} catch {
  await writeFile('/output/metadata.json', JSON.stringify({ code: 'RUNTIME_METADATA_INVALID' }));
} finally { process.exit(0); }

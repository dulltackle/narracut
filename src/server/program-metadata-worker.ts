// 固定 CDP 驱动仅在 Metadata 胶囊运行，不能从项目配置加载。
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { CAPSULE_BROWSER_ARGUMENTS } from './execution-capsule';
const browser = spawn(process.env.NARRACUT_BROWSER!, [...CAPSULE_BROWSER_ARGUMENTS], { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] });
browser.stdout?.resume(); browser.stderr?.resume();
const input = browser.stdio[3] as import('node:stream').Writable;
const output = browser.stdio[4] as import('node:stream').Readable;
let sequence = 0, wire = '';
const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void }>();
output.on('data', bytes => {
  wire += bytes.toString(); let cut;
  while ((cut = wire.indexOf('\0')) >= 0) {
    const message = JSON.parse(wire.slice(0, cut)); wire = wire.slice(cut + 1);
    const pending = waiting.get(message.id);
    if (pending) { waiting.delete(message.id); message.error ? pending.reject(message.error) : pending.resolve(message.result); }
  }
});
function command(method: string, params: object = {}, sessionId?: string): Promise<any> {
  return new Promise((resolve, reject) => { const id = ++sequence; waiting.set(id, { resolve, reject }); input.write(JSON.stringify({ id, method, params, sessionId }) + '\0'); });
}
try {
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  await command('Page.enable', {}, sessionId);
  await command('Network.enable', {}, sessionId);
  await command('Network.setBlockedURLs', { urls: ['*'] }, sessionId);
  const { frameTree } = await command('Page.getFrameTree', {}, sessionId);
  await command('Page.setDocumentContent', { frameId: frameTree.frame.id, html: '<!doctype html><meta charset="utf-8"><div id="root"></div>' }, sessionId);
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

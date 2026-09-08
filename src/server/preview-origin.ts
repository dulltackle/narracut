import { createServer, type Server } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ProgramBundle, RuntimeSpeech } from './program-bundle';
import type { RenderProgramInputV1 } from '../runtime';

export const previewDigest = (value: Uint8Array | string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export type PreviewFreshness = {
  brief: { status: 'latest' | 'stale' | 'unknown'; review: 'reviewed' | 'pending' | 'unknown'; captured?: string; latest?: string; reviewed?: string };
  input: { status: 'latest' | 'stale' | 'unknown'; captured?: string; latest?: string };
  media: { status: 'latest' | 'stale' | 'unknown'; captured?: string; latest?: string };
  environment: { status: 'latest' | 'stale' | 'unknown'; captured?: string; latest?: string };
};
export type PreviewDescriptor = {
  version: 1; parentOrigin?: string; instanceId: string; token: string; url: string; origin: string;
  identity: { bundle: string; input: string; media: string; environment: string };
  freshness?: PreviewFreshness;
  input: RenderProgramInputV1; label: string; target: 'current' | 'candidate'; baseline: string;
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin";
/** 每个服务仅托管已认证 Bundle 的副本与固定媒体字节，无文件系统路由、API 或写接口。 */
export class PreviewOrigin {
  #server?: Server;
  #starting?: Promise<string>;
  #origin = '';
  #instances = new Map<string, Map<string, Buffer>>();
  origin(): Promise<string> {
    return this.#starting ??= new Promise((resolve, reject) => {
      this.#server = createServer((req, res) => {
        res.setHeader('Content-Security-Policy', CSP);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        if (req.headers.host !== new URL(this.#origin).host) { res.writeHead(403).end(); return; }
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
        const path = (req.url ?? '').split('?')[0];
        const match = /^\/([a-f0-9]{48})\/(index.html|bundle.js|bootstrap.js|media\/[a-f0-9]{64})$/.exec(path);
        const bytes = match && this.#instances.get(match[1])?.get(match[2]);
        if (!bytes) { res.writeHead(404).end(); return; }
        const type = match[2].endsWith('.html') ? 'text/html; charset=utf-8' : match[2].endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
        res.setHeader('Content-Type', type);
        // 固定媒体支持范围读取；浏览器无法借此访问可变项目文件。
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
        let start = 0, end = bytes.length - 1;
        if (range) {
          start = Number(range[1]); end = range[2] ? Number(range[2]) : end;
          if (start > end || end >= bytes.length) { res.writeHead(416).end(); return; }
          res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
        }
        res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Length', end - start + 1);
        res.end(req.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
      });
      this.#server.once('error', reject);
      this.#server.listen(0, '127.0.0.1', () => {
        this.#origin = `http://127.0.0.1:${(this.#server!.address() as { port: number }).port}`;
        this.#server!.unref(); resolve(this.#origin);
      });
    });
  }
  async publish(args: { bundle: ProgramBundle; input: RenderProgramInputV1; speech: readonly RuntimeSpeech[]; media: ReadonlyMap<string, Buffer>; parentOrigin: string; target: 'current' | 'candidate'; baseline: string; label: string; key: string }): Promise<PreviewDescriptor> {
    const origin = await this.origin();
    if (!/^https?:\/\//.test(args.parentOrigin) || new URL(args.parentOrigin).origin !== args.parentOrigin || args.parentOrigin === origin) throw new Error('Preview 需要可验证的跨 origin 宿主。');
    // Bundle 的 inputIdentity 采用文件集合指纹，复用与构建相同的编码。
    const bindingBytes = Buffer.from(JSON.stringify({ input: args.input, speech: args.speech }));
    const boundIdentity = previewDigest(Buffer.concat([Buffer.from(JSON.stringify(['binding', bindingBytes.length]) + '\n'), bindingBytes]));
    if (boundIdentity !== args.bundle.inputIdentity) throw new Error('Preview 输入与 Bundle 构建绑定不一致。');
    const identity = { bundle: args.bundle.identity, input: args.bundle.inputIdentity, media: previewDigest(JSON.stringify([...args.media].map(([path, bytes]) => [path, previewDigest(bytes)]).sort())), environment: args.bundle.environmentIdentity };
    const instanceId = randomUUID(), token = randomBytes(32).toString('hex');
    if (!/^[a-f0-9]{48}$/.test(args.key) || this.#instances.has(args.key)) throw new Error('Preview 实例不能重复绑定。');
    const files = new Map<string, Buffer>([['bundle.js', args.bundle.files().get('bundle.js')!]]);
    for (const [path, bytes] of args.media) {
      if (!/^media\/[a-f0-9]{64}$/.test(path) || path !== `media/${previewDigest(bytes).slice(7)}`) throw new Error('媒体路径无效。');
      files.set(path, Buffer.from(bytes));
    }
    for (const src of [...args.input.assets.filter(asset => asset.availability === 'available').map(asset => asset.src), ...args.speech.map(track => track.src)]) {
      if (!src || !files.has(src)) throw new Error('Preview 缺少绑定的不可变媒体。');
    }
    const binding = { instanceId, token, identity, parentOrigin: args.parentOrigin, input: args.input, speech: args.speech };
    files.set('bootstrap.js', Buffer.from(`window.dispatchEvent(new CustomEvent('narracut-preview-binding',{detail:${JSON.stringify(binding)}}));`));
    files.set('index.html', Buffer.from('<!doctype html><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#050707}#root{display:flex;align-items:center;justify-content:center}</style><div id="root"></div><script src="bundle.js"></script><script src="bootstrap.js"></script>'));
    this.#instances.set(args.key, files);
    return { version: 1, parentOrigin: args.parentOrigin, instanceId, token, identity, input: args.input, target: args.target, baseline: args.baseline, label: args.label, origin, url: `${origin}/${args.key}/index.html` };
  }
  snapshot(url: string) {
    const files = this.#instances.get(new URL(url).pathname.split('/')[1]);
    if (!files) throw new Error('Preview 实例已释放。');
    return new Map([...files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  }
  release(url: string) { const key = new URL(url).pathname.split('/')[1]; this.#instances.delete(key); }
  async close() { this.#instances.clear(); if (this.#server) { this.#server.closeAllConnections(); await new Promise<void>(resolve => this.#server!.close(() => resolve())); } }
}

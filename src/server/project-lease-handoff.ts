import { createServer, request } from 'node:http';

/** 租约令牌只用于同一用户本机工作台之间的交接，不接受项目路径或执行命令。 */
export async function listenForProjectHandoff(token: string, handoff: () => Promise<void>) {
  let pending: Promise<void> | null = null;
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/handoff' || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403).end(); return;
    }
    req.resume();
    pending ??= handoff().catch(error => { pending = null; throw error; });
    void pending.then(() => res.writeHead(204).end(), () => res.writeHead(409).end());
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.unref();
  return { port: (server.address() as { port: number }).port, close: () => { server.close(); } };
}

export async function requestProjectHandoff(port: number, token: string) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('线程连接结果待核对');
  await new Promise<void>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/handoff', method: 'POST', headers: { authorization: `Bearer ${token}` }, agent: false }, res => {
      res.resume();
      res.once('end', () => res.statusCode === 204 ? resolve() : reject(new Error('线程连接结果待核对')));
    });
    req.setTimeout(15_000, () => req.destroy(new Error('线程连接结果待核对')));
    req.on('error', reject); req.end();
  });
}

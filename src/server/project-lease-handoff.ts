import { createServer, request } from 'node:http';

/** 租约令牌只用于同一用户本机工作台之间的交接，不接受项目路径或执行命令。 */
export async function listenForProjectHandoff(token: string, handoff: () => Promise<void>, read?: (input: unknown) => Promise<unknown>) {
  let pending: Promise<void> | null = null;
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !['/handoff', '/read'].includes(req.url ?? '') || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403).end(); return;
    }
    if (req.url === '/read') {
      try {
        if (!read) throw new Error('当前租约不支持只读会话。');
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new Error('只读请求过大。'); chunks.push(chunk); }
        const result = await read(JSON.parse(Buffer.concat(chunks).toString()));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      } catch { res.writeHead(409).end(); }
      return;
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

export async function readProjectSession(port: number, token: string, input: unknown): Promise<any> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('项目控制权待核对。');
  const response = await fetch(`http://127.0.0.1:${port}/read`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('项目会话暂不可用，正在核对控制权。');
  return response.json();
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

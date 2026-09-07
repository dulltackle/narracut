import { afterEach, expect, test } from 'vitest';
import { PreviewOrigin } from '../src/server/preview-origin';
const services: PreviewOrigin[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.close())); });
test('只读来源拒绝未知 Host、写入与未授权文件，并发送隔离 CSP', async () => {
  const service = new PreviewOrigin(); services.push(service);
  const origin = await service.origin();
  const response = await fetch(origin, { method: 'POST' });
  expect(response.status).toBe(405);
  expect((await fetch(origin + '/api/project')).status).toBe(404);
  const csp = response.headers.get('content-security-policy')!;
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("form-action 'none'");
  expect(csp).toContain('sandbox allow-scripts allow-same-origin');
});

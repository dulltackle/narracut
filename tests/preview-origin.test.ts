import { afterEach, expect, test } from 'vitest';
import { PreviewOrigin, previewDigest } from '../src/server/preview-origin';
import type { ProgramBundle } from '../src/server/program-bundle';
import type { RenderProgramInputV1 } from '../src/runtime';
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

test.each([
  [Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3]), 'video/webm'],
  [Buffer.from('0000ftypisom'), 'video/mp4'],
])('摘要媒体路径的完整和范围响应保留视频类型：%s', async (bytes, mediaType) => {
  const service = new PreviewOrigin(); services.push(service);
  const path = `media/${previewDigest(bytes).slice(7)}`;
  const input: RenderProgramInputV1 = { apiVersion: 1, videoBrief: '', output: { width: 1920, height: 1080, fps: 30 }, durationInFrames: 150, scenes: [], assets: [{ id: 'video', path: 'assets/video', availability: 'available', src: path }] };
  const binding = Buffer.from(JSON.stringify({ input, speech: [] }));
  const inputIdentity = previewDigest(Buffer.concat([Buffer.from(JSON.stringify(['binding', binding.length]) + '\n'), binding]));
  // 这里只验证真实 HTTP 媒体路由；编译器不参与响应类型决策。
  const bundle = { identity: 'bundle', environmentIdentity: 'environment', inputIdentity, files: () => new Map([['bundle.js', Buffer.from('')]]) } as unknown as ProgramBundle;
  const descriptor = await service.publish({ bundle, input, speech: [], media: new Map([[path, bytes]]), parentOrigin: 'http://localhost:3000', target: 'candidate', baseline: 'baseline', label: '测试', key: 'a'.repeat(48) });
  const url = new URL(path, descriptor.url);
  const full = await fetch(url);
  expect(full.headers.get('content-type')).toBe(mediaType);
  expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
  const range = await fetch(url, { headers: { Range: 'bytes=1-3' } });
  expect(range.status).toBe(206);
  expect(range.headers.get('content-type')).toBe(mediaType);
  expect(Buffer.from(await range.arrayBuffer())).toEqual(bytes.subarray(1, 4));
});

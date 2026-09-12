import { DependencyError, integrityKey, verifyPackageBytes } from './dependency-integrity';
import type { DependencyPin } from './project-dependencies';
const REGISTRY = 'https://registry.npmjs.org';
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
const fail = (message: string): never => { throw new DependencyError('DEPENDENCY_SOURCE_UNSUPPORTED', message); };
function registryURL(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { return fail('依赖 URL 无效。'); }
  if (url.origin !== REGISTRY || url.username || url.password || url.search || url.hash) fail('依赖与重定向只能来自固定公共 npm registry，且不得携带凭据。');
  return url.href;
}
/** 唯一联网入口：不调用包管理器、不读取 npm 配置，也不执行项目代码。 */
export async function fetchRegistryPackage(pin: DependencyPin, cancellation?: AbortSignal) {
  const basename = pin.name.split('/').at(-1)!;
  let url = registryURL(`${REGISTRY}/${pin.name}/-/${basename}-${pin.version}.tgz`);
  const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(cancellation ? [cancellation] : [])]);
  for (let redirects = 0; redirects <= 4; redirects++) {
    let response: Response;
    try { response = await fetch(url, { redirect: 'manual', credentials: 'omit', headers: { accept: 'application/octet-stream' }, signal }); }
    catch { throw new DependencyError('DEPENDENCY_UNAVAILABLE', `依赖下载中断：${pin.name}@${pin.version}；请显式重试。`); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) fail('registry 重定向缺少目标。');
      url = registryURL(new URL(location!, url).href);
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new DependencyError('DEPENDENCY_UNAVAILABLE', `公共 npm 包下载失败：${pin.name}@${pin.version}。`); }
    if (response.url) registryURL(response.url);
    const reader = response.body.getReader();
    const chunks: Buffer[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > MAX_PACKAGE_BYTES) fail('依赖下载输出超过阶段上限 32 MiB。');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    const bytes = Buffer.concat(chunks);
    verifyPackageBytes(integrityKey(pin.integrity), bytes);
    return bytes;
  }
  return fail('依赖重定向次数超限。');
}

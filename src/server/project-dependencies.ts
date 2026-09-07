import { DependencyError, integrityKey, verifyPackageBytes } from './dependency-integrity';
export { DependencyError, integrityKey, verifyPackageBytes } from './dependency-integrity';
import { localExecutionCapsule } from './execution-capsule';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parse, stringify } from 'yaml';
import { valid, validRange, satisfies, rcompare } from 'semver';

export const RUNTIME_REMOTION_VERSION = '4.0.512';
export type DependencyPin = { name: string; version: string; integrity: string };
export type DependencyUpdate = { dependencies?: Record<string, string>; packages?: DependencyPin[] };
export type OfflinePackages = Map<string, Buffer>;
const fail = (message: string): never => { throw new DependencyError('DEPENDENCY_SOURCE_UNSUPPORTED', message); };
const nameValid = (name: unknown): name is string => typeof name === 'string' && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) && name.length <= 214;
const versionValid = (version: unknown): version is string => typeof version === 'string' && valid(version) === version;
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
function validatePin(pin: DependencyPin) {
  if (!record(pin) || Object.keys(pin).some(k => !['name', 'version', 'integrity'].includes(k)) ||
      !nameValid(pin.name) || !versionValid(pin.version)) fail('只允许公共 npm 包名、精确版本和完整性摘要；不接受来源或凭据字段。');
  integrityKey(pin.integrity);
  if ((pin.name === 'remotion' || pin.name.startsWith('@remotion/') || pin.name === '@narracut/runtime') && pin.version !== RUNTIME_REMOTION_VERSION) { throw new DependencyError('REMOTION_VERSION_MISMATCH', `全部 Remotion 包必须与 Runtime 精确同版 ${RUNTIME_REMOTION_VERSION}。`); }
}
async function download(pin: DependencyPin) {
  return (await localExecutionCapsule()).downloadPackage(pin);
}
/** 只解析 tar 数据，不落盘解包；链接、特殊文件与路径逃逸在安装前拒绝。 */
function packageManifest(bytes: Buffer, pin: DependencyPin, files?: Map<string, Buffer>): Record<string, any> {
  let tar: Buffer;
  try { tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }); }
  catch { return fail('依赖必须是有效且未超限的 gzip tar 包。'); }
  let manifest: Record<string, any> | undefined;
  const paths = new Set<string>();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const string = (start: number, length: number) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const octal = (start: number, length: number) => {
      const raw = string(start, length).trim();
      if (!/^[0-7]+$/.test(raw)) return fail('依赖 tar 数字字段无效。');
      return parseInt(raw, 8);
    };
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (octal(148, 8) !== checksum) fail('依赖 tar 校验和错误。');
    const size = octal(124, 12);
    const prefix = string(345, 155);
    const path = `${prefix ? prefix + '/' : ''}${string(0, 100)}`.replace(/\/$/, '');
    const type = header[156];
    if (![0, 48, 53].includes(type) || !path.startsWith('package') || (path !== 'package' && !path.startsWith('package/')) ||
        path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..' || p === 'node_modules') || paths.has(path) ||
        (type === 53 && size !== 0) || offset + 512 + size > tar.length) fail('依赖 tar 含不安全路径、链接、特殊文件或损坏条目。');
    paths.add(path);
    if (type !== 53 && path.startsWith("package/")) files?.set(path.slice(8), Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    if (path === 'package/package.json') {
      if (type === 53 || size > 1024 * 1024) fail('依赖包声明无效。');
      try { manifest = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString('utf8')); }
      catch { fail('依赖包声明不是有效 JSON。'); }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!record(manifest) || manifest.name !== pin.name || manifest.version !== pin.version) return fail('依赖 tar 内包名或版本与精确声明不符。');
  if (manifest.bundledDependencies?.length || manifest.bundleDependencies?.length) fail('不接受包内嵌套依赖；请为完整锁图提供精确包。');
  return manifest;
}

export async function coordinateDependencies(manifestBytes: Buffer, lockBytes: Buffer, stored: OfflinePackages, request: DependencyUpdate, retainedLocks: Buffer[] = [], retainedKeys: string[] = []) {
  if (Object.keys(request).some(key => !['action', 'baseline', 'dependencies', 'packages'].includes(key))) fail('依赖协调不接受自定义 registry、来源或凭据字段。');
  if (!record(request.dependencies) || !Array.isArray(request.packages) || request.packages.length > 256) fail('依赖协调必须提供依赖声明与精确包列表（最多 256 项）。');
  for (const [name, version] of Object.entries(request.dependencies!)) if (!nameValid(name) || !versionValid(version)) fail('只接受精确公共 npm 版本；拒绝版本范围、Git、URL、file 与私有来源。');
  const original = JSON.parse(manifestBytes.toString());
  const lock = parse(lockBytes.toString(), { maxAliasCount: 0 });
  if (!record(original) || !record(original.dependencies) || !record(lock) || !record(lock.packages)) fail('候选依赖声明或锁图无效。');
  const dependencies = { ...original.dependencies, ...request.dependencies } as Record<string, string>;
  const pins = new Map<string, DependencyPin>();
  for (const [key, value] of Object.entries(lock.packages) as [string, any][]) {
    const split = key.lastIndexOf('@');
    const pin = { name: key.slice(0, split), version: key.slice(split + 1), integrity: value?.resolution?.integrity };
    validatePin(pin);
    if (value.resolution.tarball || value.resolution.registry) fail('锁图不得指定自定义来源。');
    pins.set(`${pin.name}@${pin.version}`, pin);
  }
  const retained = [...pins.values()];
  const supplied = new Set<string>();
  for (const pin of request.packages!) {
    validatePin(pin);
    const id = `${pin.name}@${pin.version}`;
    if (supplied.has(id)) fail('精确包列表不能包含重复包名和版本。');
    supplied.add(id); pins.set(id, pin);
  }
  for (const [name, version] of Object.entries(dependencies)) {
    if (!nameValid(name) || !versionValid(version) || pins.get(`${name}@${version}`)?.version !== version) fail(`缺少 ${name}@${version} 的精确版本与完整性摘要。`);
  }
  const nextStore = new Map(stored);
  for (const bytes of retainedLocks) {
    const retainedLock = parse(bytes.toString(), { maxAliasCount: 0 });
    if (!record(retainedLock?.packages)) fail('保留状态的锁图无效。');
    for (const [id, value] of Object.entries(retainedLock.packages) as [string, any][]) {
      const split = id.lastIndexOf('@');
      const pin = { name: id.slice(0, split), version: id.slice(split + 1), integrity: value?.resolution?.integrity };
      validatePin(pin);
      if (Object.keys(value.resolution).some(key => key !== 'integrity')) fail('保留锁图包含不支持的依赖来源。');
      retained.push(pin);
    }
  }
  for (const pin of request.packages!) if (retainedKeys.includes(integrityKey(pin.integrity))) retained.push(pin);
  // 发布新候选前，先保证上一份候选、检查点及保留修订仍可离线重建。
  for (const pin of retained) {
    const key = integrityKey(pin.integrity);
    if (!nextStore.has(key)) {
      const bytes = await download(pin);
      packageManifest(bytes, pin);
      nextStore.set(key, bytes);
    }
  }
  const packages: Record<string, any> = Object.create(null);
  const snapshots: Record<string, any> = Object.create(null);
  const visited = new Set<string>();
  async function visit(pin: DependencyPin) {
    const packageId = `${pin.name}@${pin.version}`;
    if (visited.has(packageId)) return;
    if (visited.size >= 256) fail('依赖图超过协调阶段 256 包上限。');
    visited.add(packageId);
    const key = integrityKey(pin.integrity);
    let bytes = nextStore.get(key);
    if (bytes) verifyPackageBytes(key, bytes);
    else { bytes = await download(pin); nextStore.set(key, bytes); }
    const meta = packageManifest(bytes, pin);
    const edges: Record<string, string> = Object.create(null);
    const targets = new Map<string, DependencyPin>();
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      if (meta[field] !== undefined && !record(meta[field])) fail('依赖包的依赖字段无效。');
      for (const [dependency, range] of Object.entries(meta[field] ?? {})) {
        if (!nameValid(dependency) || typeof range !== 'string' || !validRange(range)) fail('传递依赖只能使用公共 npm semver 声明，不能包含私有来源或凭据。');
        const root = pins.get(`${dependency}@${dependencies[dependency]}`);
        const target = root && satisfies(root.version, range as string) ? root : [...pins.values()]
          .filter(p => p.name === dependency && satisfies(p.version, range as string)).sort((a, b) => rcompare(a.version, b.version))[0];
        const optionalPeer = field === 'peerDependencies' && meta.peerDependenciesMeta?.[dependency]?.optional === true;
        if (!target && optionalPeer) continue;
        if (!target || !satisfies(target.version, range as string)) fail(`请为传递依赖 ${dependency}（${range}）提供兼容的精确版本与摘要。`);
        edges[dependency] = target!.version; targets.set(dependency, target!);
      }
    }
    packages[packageId] = { resolution: { integrity: pin.integrity }, ...(meta.bin ? { hasBin: true } : {}) };
    snapshots[packageId] = Object.keys(edges).length ? { dependencies: edges } : {};
    for (const target of targets.values()) await visit(target);
  }
  for (const name of Object.keys(dependencies).sort()) await visit(pins.get(`${name}@${dependencies[name]}`)!);
  for (const name of supplied) if (!visited.has(name) && !retainedKeys.includes(integrityKey(pins.get(name)!.integrity))) fail(`提供的包 ${name} 未被候选依赖图引用。`);
  return {
    manifest: Buffer.from(JSON.stringify({ private: true, dependencies })),
    lock: Buffer.from(stringify({ lockfileVersion: '9.0', settings: { autoInstallPeers: true, excludeLinksFromLockfile: false }, importers: { '.': { dependencies: Object.fromEntries(Object.entries(dependencies).map(([name, version]) => [name, { specifier: version, version }])) } }, packages, snapshots })),
    store: nextStore,
  };
}

/** 安装器仅解包已校验字节，不执行包内代码。 */
export function unpackOfflinePackage(bytes: Buffer, pin: DependencyPin) {
  validatePin(pin);
  verifyPackageBytes(integrityKey(pin.integrity), bytes);
  const files = new Map<string, Buffer>();
  const manifest = packageManifest(bytes, pin, files);
  return { files, manifest };
}

/** 构建只消费现有精确锁图和离线包；不会协调、补包或联网。 */
export function readOfflineDependencyGraph(manifestBytes: Buffer, lockBytes: Buffer, store: ReadonlyMap<string, Buffer>) {
  const invalid = (message: string): never => { throw new DependencyError('DEPENDENCY_LOCK_INVALID', message); };
  let manifest: any, lock: any;
  try { manifest = JSON.parse(manifestBytes.toString()); lock = parse(lockBytes.toString(), { maxAliasCount: 0 }); }
  catch { return invalid('依赖声明或锁文件不可解析。'); }
  if (!record(manifest?.dependencies) || !record(lock?.packages) || !record(lock?.snapshots) || !record(lock?.importers?.['.']?.dependencies) || String(lock.lockfileVersion) !== '9.0') return invalid('依赖声明和完整锁图缺失。');
  if (Object.keys(manifest).some(k => !['private', 'dependencies'].includes(k)) || Object.keys(lock.importers).some(k => k !== '.')) return invalid('不支持项目安装脚本、自定义配置或多工作区锁图。');
  const pins = new Map<string, DependencyPin>();
  for (const [id, item] of Object.entries(lock.packages) as [string, any][]) {
    const split = id.lastIndexOf('@');
    const pin = { name: id.slice(0, split), version: id.slice(split + 1), integrity: item?.resolution?.integrity };
    validatePin(pin);
    if (!record(item?.resolution) || Object.keys(item.resolution).some(k => k !== 'integrity')) return invalid('锁图来源必须仅由公共包身份和完整性摘要决定。');
    pins.set(id, pin);
  }
  const roots: Record<string, string> = Object.create(null);
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    const entry = lock.importers['.'].dependencies[name];
    if (!nameValid(name) || !versionValid(version) || entry?.specifier !== version || entry.version !== version || !pins.has(`${name}@${version}`)) return invalid('依赖声明与根锁图不一致。');
    roots[name] = `${name}@${version}`;
  }
  if (Object.keys(lock.importers['.'].dependencies).length !== Object.keys(roots).length) return invalid('根锁图包含未声明依赖。');
  const graph = new Map<string, { pin: DependencyPin; bytes: Buffer; dependencies: Record<string, string> }>();
  function visit(id: string) {
    if (graph.has(id)) return;
    const pin = pins.get(id), snapshot = lock.snapshots[id];
    if (!pin || !record(snapshot) || Object.keys(snapshot).some(k => k !== 'dependencies') || (snapshot.dependencies !== undefined && !record(snapshot.dependencies))) return invalid('传递锁图不完整。');
    const bytes = store.get(integrityKey(pin.integrity));
    if (!bytes) throw new DependencyError('DEPENDENCY_UNAVAILABLE', `离线库缺少 ${id}；请显式协调依赖。`);
    const { manifest: meta } = unpackOfflinePackage(bytes, pin);
    const edges: Record<string, string> = Object.create(null);
    const required = { ...meta.dependencies, ...meta.optionalDependencies, ...meta.peerDependencies };
    for (const [name, range] of Object.entries(required)) {
      const version = snapshot.dependencies?.[name];
      if (version === undefined && meta.peerDependenciesMeta?.[name]?.optional === true && !meta.dependencies?.[name] && !meta.optionalDependencies?.[name]) continue;
      if (!nameValid(name) || !versionValid(version) || typeof range !== 'string' || !validRange(range) || !satisfies(version, range)) return invalid('传递依赖与包声明不一致。');
      edges[name] = `${name}@${version}`;
    }
    if (Object.keys(snapshot.dependencies ?? {}).some(name => !Object.hasOwn(edges, name))) return invalid('传递锁图含包未声明的依赖。');
    graph.set(id, { pin, bytes: Buffer.from(bytes), dependencies: edges });
    for (const target of Object.values(edges)) visit(target);
  }
  Object.values(roots).forEach(visit);
  if (graph.size !== pins.size || Object.keys(lock.snapshots).length !== graph.size) return invalid('锁图包含未引用包或多余快照。');
  return { roots, graph };
}

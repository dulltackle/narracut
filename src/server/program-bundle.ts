import { parseStrictJson } from './strict-json';
import type { OutputFormat } from '../runtime';

export class ProgramBuildError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export function checkProgramManifest(bytes: Uint8Array | undefined): { apiVersion: 1; output: OutputFormat; warnings: string[] } {
  let value: any;
  try {
    if (!bytes || bytes.byteLength > 65536) throw new Error();
    value = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
      maxDepth: 16, maxArrayItems: 1024, maxObjectFields: 1024, maxNodes: 4096,
      maxStringScalars: 65536, maxStringBytes: 65536, maxNumberBytes: 32,
    });
  } catch { throw new ProgramBuildError('MANIFEST_INVALID', 'program.json 必须是无重复字段的静态 UTF-8 JSON。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.apiVersion)) {
    throw new ProgramBuildError('MANIFEST_INVALID', 'Manifest 必须显式声明整数 apiVersion 和 Output Format。');
  }
  if (value.apiVersion !== 1) throw new ProgramBuildError('MANIFEST_API_UNSUPPORTED', '只支持 Render Program 协议主版本 1。');
  if (!value.output || !['width', 'height', 'fps'].every(key => Number.isSafeInteger(value.output[key]) && value.output[key] > 0)) {
    throw new ProgramBuildError('OUTPUT_FORMAT_INVALID', 'width、height、fps 必须显式声明为正安全整数。');
  }
  return { apiVersion: 1, output: Object.freeze({ width: value.output.width, height: value.output.height, fps: value.output.fps }),
    warnings: Object.keys(value).some(key => !['apiVersion', 'output'].includes(key)) || Object.keys(value.output).some(key => !['width', 'height', 'fps'].includes(key)) ? ['MANIFEST_UNKNOWN_FIELD'] : [] };
}

import { createHash } from 'node:crypto';
import { localExecutionCapsule } from './execution-capsule';
import { readOfflineDependencyGraph } from './project-dependencies';
import { programToolchain, bundleApplicationWorker } from './program-toolchain';
import { PROGRAM_ENTRY_CONTRACT, PROGRAM_RUNTIME_SOURCE, PROGRAM_SAFE_JSX, PROGRAM_SAFE_REMOTION } from './program-runtime-source';
import type { RenderProgramInputV1 } from '../runtime';

export type RuntimeSpeech = Readonly<{ sceneId: string; startFrame: number; durationInFrames: number; src: string }>;
export type ProgramBuildRequest = {
  program: ReadonlyMap<string, Uint8Array>;
  offline: ReadonlyMap<string, Buffer>;
  input: RenderProgramInputV1;
  speech: readonly RuntimeSpeech[];
  signal?: AbortSignal;
};
function fingerprint(files: ReadonlyMap<string, Uint8Array>) {
  const hash = createHash('sha256');
  for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    hash.update(JSON.stringify([path, bytes.byteLength]) + '\n'); hash.update(bytes);
  }
  return `sha256:${hash.digest('hex')}`;
}
/** Buffer 与 Map 不向外共享；成功之后不存在替换或原地修改 Bundle 的接口。 */
export type ProgramBundle = ImmutableProgramBundle;
class ImmutableProgramBundle {
  readonly identity: string;
  #files: Map<string, Buffer>;
  constructor(files: ReadonlyMap<string, Uint8Array>, readonly environmentIdentity: string, readonly programIdentity: string,
    readonly inputIdentity: string, readonly runtime: 'passed' | 'not-applicable', readonly warnings: readonly string[]) {
    this.#files = new Map([...files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
    this.identity = fingerprint(this.#files);
    this.warnings = Object.freeze([...warnings]);
    Object.freeze(this);
  }
  files(): ReadonlyMap<string, Buffer> { return new Map([...this.#files].map(([path, bytes]) => [path, Buffer.from(bytes)])); }
}
function checkBinding(input: RenderProgramInputV1, speech: readonly RuntimeSpeech[], output: OutputFormat) {
  const invalid = () => { throw new ProgramBuildError('RUNTIME_CONTRACT_VIOLATION', '输入、Scene 时间窗、Output Format 或权威 Speech 不一致。'); };
  if (input.apiVersion !== 1 || !['width', 'height', 'fps'].every(key => input.output[key as keyof OutputFormat] === output[key as keyof OutputFormat]) || !Array.isArray(input.scenes) || !Array.isArray(speech)) invalid();
  let frame = 0;
  const ids = new Set<string>();
  for (const scene of input.scenes) {
    if (ids.has(scene.id) || scene.time.startFrame !== frame || !Number.isSafeInteger(scene.time.durationInFrames) || scene.time.durationInFrames <= 0) invalid();
    ids.add(scene.id); frame += scene.time.durationInFrames;
    const tracks = speech.filter(track => track.sceneId === scene.id);
    if (scene.time.source === 'speech') {
      if (tracks.length !== 1 || tracks[0].startFrame !== scene.time.startFrame || tracks[0].durationInFrames !== scene.time.durationInFrames || !tracks[0].src) invalid();
    } else if (scene.time.source !== 'draft' || tracks.length) invalid();
  }
  if (!Number.isSafeInteger(frame) || frame !== input.durationInFrames || speech.some(track => !ids.has(track.sceneId))) invalid();
}

/** Preview 状态检查和构建共享完全相同的环境身份算法。 */
async function programEnvironment(capsuleIdentity: string, toolchain: Awaited<ReturnType<typeof programToolchain>>) {
  const runtimeFiles = { ...toolchain.files, 'source/entry.tsx': Buffer.from(PROGRAM_RUNTIME_SOURCE), 'source/entry-contract.ts': Buffer.from(PROGRAM_ENTRY_CONTRACT), 'source/safe-jsx.ts': Buffer.from(PROGRAM_SAFE_JSX), 'source/safe-remotion.ts': Buffer.from(PROGRAM_SAFE_REMOTION), 'launch.mjs': Buffer.from("process.env.ESBUILD_BINARY_PATH='/tmp/tools/esbuild';await import('./worker.mjs');") };
  const metadataDriver = await bundleApplicationWorker('metadata');
  const identity = fingerprint(new Map([...Object.entries(runtimeFiles), ['capsule', Buffer.from(capsuleIdentity)], ['metadata-worker', metadataDriver]]));
  return { runtimeFiles, metadataDriver, identity };
}
export async function programEnvironmentIdentity() {
  const capsule = await localExecutionCapsule();
  return (await programEnvironment(await capsule.certify(), await programToolchain())).identity;
}

/** 从不可变候选字节构建；返回前不发布任何 Bundle，调用方可保留上一成功对象。 */
export async function buildProgramBundle(request: ProgramBuildRequest): Promise<ProgramBundle> {
  // 在首个 await 前拍下全部输入，调用者后续编辑不能混入本次构建。
  const program = new Map([...request.program].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  const offline = new Map([...request.offline].map(([key, bytes]) => [key, Buffer.from(bytes)]));
  const binding = JSON.parse(JSON.stringify({ input: request.input, speech: request.speech }));
  const manifest = checkProgramManifest(program.get('program.json'));
  checkBinding(binding.input, binding.speech, manifest.output);
  for (const path of program.keys()) if (!/^(?:src\/|resources\/|program\.json$|package\.json$|pnpm-lock\.yaml$)/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..') || /[\\\0]/.test(path)) throw new ProgramBuildError('BUNDLE_FAILED', '候选包含不支持的路径或构建配置。');
  if (!program.has('src/RenderProgram.tsx')) throw new ProgramBuildError('RUNTIME_ENTRY_INVALID', '缺少固定入口 src/RenderProgram.tsx。');
  if (!program.has('package.json') || !program.has('pnpm-lock.yaml')) throw new ProgramBuildError('DEPENDENCY_LOCK_INVALID', '依赖声明或锁文件缺失。');
  const dependencies = readOfflineDependencyGraph(program.get('package.json')!, program.get('pnpm-lock.yaml')!, offline);
  const capsule = await localExecutionCapsule();
  const capsuleIdentity = await capsule.certify();
  const toolchain = await programToolchain();
  const pins = [...dependencies.graph];
  const index = new Map(pins.map(([id], index) => [id, index]));
  const packages = pins.map(([, item]) => ({ pin: item.pin, dependencies: Object.fromEntries(Object.entries(item.dependencies).map(([name, id]) => [name, index.get(id)!])) }));
  const roots = Object.fromEntries(Object.entries(dependencies.roots).map(([name, id]) => [name, index.get(id)!]));
  const failOutput = (files: ReadonlyMap<string, Buffer>) => {
    if (files.has('failure.json')) {
      const { code } = JSON.parse(files.get('failure.json')!.toString());
      const allowed = ['TYPECHECK_FAILED', 'BUNDLE_FAILED', 'DEPENDENCY_INSTALL_FAILED', 'STATIC_FORBIDDEN_CAPABILITY', 'STATIC_NONDETERMINISTIC_API'];
      throw new ProgramBuildError(allowed.includes(code) ? code : 'BUNDLE_FAILED', '候选检查未通过；请修复源码或依赖后重试。');
    }
    return true;
  };
  const installed = await capsule.run({ stage: 'install', entry: 'dependencies/worker.mjs', signal: request.signal, inputs: {
    'dependencies/worker.mjs': toolchain.files['worker.mjs'],
    'dependencies/config.json': Buffer.from(JSON.stringify({ stage: 'install', packages })),
    ...Object.fromEntries(pins.map(([, item], index) => [`dependencies/${index}.tgz`, item.bytes])),
  } }, files => failOutput(files) && [...files.keys()].every(path => /^packages\/\d+\//.test(path) && Number(path.split('/')[1]) < packages.length));
  const trustedFiles: string[] = [];
  // 核心 Runtime 包仅在字节与应用固定工具链一致时豁免项目静态策略；包名/版本本身不赋予信任。
  for (const [i, [, item]] of pins.entries()) {
    const fixed = toolchain.packages.get(item.pin.name);
    if (!fixed) continue;
    if (item.pin.version !== fixed.version) throw new ProgramBuildError('DEPENDENCY_LOCK_INVALID', '核心依赖必须与固定工具链版本一致。');
    const actual = [...installed].filter(([path]) => path.startsWith(`packages/${i}/`));
    for (const [path, bytes] of actual) {
      const relative = path.slice(`packages/${i}/`.length);
      if (relative.endsWith('.map')) continue;
      if (!fixed.files.get(relative)?.equals(bytes)) throw new ProgramBuildError('DEPENDENCY_INTEGRITY_FAILED', '核心依赖字节与固定 Runtime 不一致。');
      trustedFiles.push(`/tmp/work/${path}`);
    }
    if ([...fixed.files.keys()].some(path => !installed.has(`packages/${i}/${path}`))) throw new ProgramBuildError('DEPENDENCY_INTEGRITY_FAILED', '核心依赖缺少固定 Runtime 文件。');
  }
  const config = Buffer.from(JSON.stringify({ stage: 'build', packages, roots, trustedFiles }));
  const environment = await programEnvironment(capsuleIdentity, toolchain);
  const runtimeFiles = { ...environment.runtimeFiles, 'config.json': config };
  const { metadataDriver, identity: environmentIdentity } = environment;
  const bundle = await capsule.run({ stage: 'build', entry: 'runtime/launch.mjs', signal: request.signal, inputs: {
    ...Object.fromEntries([...program].map(([path, bytes]) => [`program/${path}`, bytes])),
    ...Object.fromEntries([...installed].map(([path, bytes]) => [`dependencies/${path}`, bytes])),
    ...Object.fromEntries(Object.entries(runtimeFiles).map(([path, bytes]) => [`runtime/${path}`, bytes])),
  } }, files => {
    failOutput(files);
    if (!files.has('bundle.js.map')) throw new ProgramBuildError('BUNDLE_SOURCEMAP_MISSING', '构建缺少完整 Source Map。');
    return files.size === 3 && files.has('bundle.js') && files.has('index.html') && JSON.parse(files.get('bundle.js.map')!.toString()).version === 3;
  });
  const metadata = await capsule.run({ stage: 'metadata', entry: 'bundle/metadata.mjs', signal: request.signal, inputs: {
    ...Object.fromEntries([...bundle].map(([path, bytes]) => [`bundle/${path}`, bytes])),
    'bundle/metadata.mjs': metadataDriver, 'input/binding.json': Buffer.from(JSON.stringify(binding)),
  } }, files => {
    if (files.size !== 1 || !files.has('metadata.json')) return false;
    const value = JSON.parse(files.get('metadata.json')!.toString());
    if (value.code) throw new ProgramBuildError('RUNTIME_METADATA_INVALID', '候选未通过离线 Runtime 检查。');
    const expected = { id: 'Narracut', ...manifest.output, durationInFrames: binding.input.durationInFrames, sceneCount: binding.input.scenes.length };
    if (JSON.stringify(value.metadata) !== JSON.stringify(expected) || value.runtime !== (binding.input.scenes.length ? 'passed' : 'not-applicable')) throw new ProgramBuildError('COMPOSITION_INVALID', 'Composition 与 Runtime 权威输入不一致。');
    return true;
  });
  return new ImmutableProgramBundle(bundle, environmentIdentity, fingerprint(program), fingerprint(new Map([['binding', Buffer.from(JSON.stringify(binding))]])),
    JSON.parse(metadata.get('metadata.json')!.toString()).runtime, manifest.warnings);
}

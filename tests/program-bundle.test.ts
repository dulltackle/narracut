import { expect, it } from 'vitest';
import { checkProgramManifest } from '../src/server/program-bundle';

it('执行源码前静态校验协议和整数格式，并保留未知字段警告', () => {
  for (const text of ['', 'export default {}', '{}', '{"apiVersion":1,"apiVersion":1,"output":{}}']) {
    expect(() => checkProgramManifest(Buffer.from(text))).toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
  }
  expect(() => checkProgramManifest(Buffer.from('{"apiVersion":2,"output":{}}'))).toThrowError(expect.objectContaining({ code: 'MANIFEST_API_UNSUPPORTED' }));
  expect(() => checkProgramManifest(Buffer.from('{"apiVersion":1,"output":{"width":1.2,"height":1080,"fps":30}}'))).toThrowError(expect.objectContaining({ code: 'OUTPUT_FORMAT_INVALID' }));
  expect(checkProgramManifest(Buffer.from('{"apiVersion":1,"output":{"width":1920,"height":1080,"fps":30},"future":true}'))).toEqual({
    apiVersion: 1, output: { width: 1920, height: 1080, fps: 30 }, warnings: ['MANIFEST_UNKNOWN_FIELD'],
  });
});

import { assertDeterministicModule } from '../src/server/program-static';
it('确定性检查拒绝别名、计算属性、动态执行和 Runtime 权威访问', () => {
  for (const source of [
    'const now = Date.now;', 'const r = Math.random; r();', 'const x = globalThis;',
    'const x = {}; x["con" + "structor"]("return window")();',
    'import {registerRoot as own} from "remotion";', 'import * as R from "remotion";',
    'import {useEffect as effect} from "react";', 'const x = process.env;',
    'setTimeout(()=>{}, 1);', 'const x = localStorage;', 'const x = import("thing");',
    'const x = fetch;', 'const x = performance.now();', 'const x = new Function("return 1");',
    'const x = document;', 'const x = {}; x.constructor;', 'const x = "https://example.com";',
  ]) expect(() => assertDeterministicModule(source)).toThrow();
  expect(() => assertDeterministicModule('import { random, useCurrentFrame } from "remotion"; export function RenderProgram(input) { const frame = useCurrentFrame(); return random("seed") + frame + input.durationInFrames; }')).not.toThrow();
});

import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { buildProgramBundle } from '../src/server/program-bundle';
import { fixture, archive } from './helpers/program-fixture';

it('真实离线胶囊构建、检查 Metadata，完整字节身份稳定且失败保留上一 Bundle', async () => {
  const request = await fixture();
  const first = await buildProgramBundle(request);
  expect(first.identity).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(first.environmentIdentity).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(first.runtime).toBe('passed');
  expect([...first.files().keys()].sort()).toEqual(['bundle.js', 'bundle.js.map', 'index.html']);
  first.files().get('bundle.js')!.fill(0);
  const second = await buildProgramBundle(request);
  expect(second.identity).toBe(first.identity);
  expect(second.files()).toEqual(first.files());
  request.program.set('src/RenderProgram.tsx', Buffer.from('export function RenderProgram(){return Date.now()}'));
  await expect(buildProgramBundle(request)).rejects.toMatchObject({ code: 'STATIC_NONDETERMINISTIC_API' });
  expect(first.files()).toEqual(second.files());
  request.program.set('src/RenderProgram.tsx', Buffer.from('export function RenderProgram(){const value: number = "bad"; return value;}'));
  await expect(buildProgramBundle(request)).rejects.toMatchObject({ code: 'TYPECHECK_FAILED' });
}, 120_000);

it('局部同名绑定不能把其他作用域的宿主能力伪装成已声明变量', () => {
  expect(() => assertDeterministicModule('function harmless(Object){return Object;} const x=Object.getPrototypeOf(harmless);')).toThrow();
  expect(() => assertDeterministicModule('const values=[];export function frame(){return values.push(1);}')).toThrow();
  expect(() => assertDeterministicModule('const m=Math;export function frame(){return m.random();}')).toThrow();
});

it('离线缺包、篡改包和不一致锁图均拒绝，不执行下载', async () => {
  const request = await fixture();
  const [key, bytes] = [...request.offline][0];
  request.offline.delete(key);
  await expect(buildProgramBundle(request)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  request.offline.set(key, Buffer.from('broken'));
  await expect(buildProgramBundle(request)).rejects.toMatchObject({ code: 'DEPENDENCY_INTEGRITY_FAILED' });
  request.offline.set(key, bytes);
  request.program.set('package.json', Buffer.from('{"private":true,"dependencies":{"react":"99.0.0"}}'));
  await expect(buildProgramBundle(request)).rejects.toMatchObject({ code: 'DEPENDENCY_LOCK_INVALID' });
});

it('零 Scene 不调用入口，非空项目的 Runtime 错误不发布 Bundle', async () => {
  const request = await fixture();
  request.program.set('src/RenderProgram.tsx', Buffer.from('export function RenderProgram(): never {throw "runtime failure";}'));
  await expect(buildProgramBundle(request)).rejects.toMatchObject({ code: 'RUNTIME_METADATA_INVALID' });
  const empty = await buildProgramBundle({ ...request, input: { ...request.input, scenes: [], durationInFrames: 0 } });
  expect(empty.runtime).toBe('not-applicable');
}, 90_000);

import { vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';

it('公开候选构建从项目离线库取包，并拒绝过期基线且不改变候选', async () => {
  const request = await fixture();
  const root = await mkdtemp(join(tmpdir(), 'bundle-project-'));
  const directory = join(root, 'project');
  await createProjectVNext(directory);
  const pointer = JSON.parse(await readFile(join(directory, '.narracut/current.json'), 'utf8'));
  const programDirectory = join(directory, '.narracut/revisions', pointer.revisionId, 'render-program');
  for (const [path, bytes] of request.program) await writeFile(join(programDirectory, path), bytes);
  const lock = parseYaml(request.program.get('pnpm-lock.yaml')!.toString());
  const urls = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(lock.packages) as [string, any][]) {
    const split = id.lastIndexOf('@'), name = id.slice(0, split), version = id.slice(split + 1);
    urls.set(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, request.offline.get(Buffer.from(value.resolution.integrity.slice(7), 'base64').toString('hex'))!);
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(new Uint8Array(urls.get(url)!))));
  const project = await openProjectVNext(directory);
  try {
    const created = await project.candidate({ action: 'create' });
    const saved = await project.candidate({ action: 'dependencies', baseline: created.baseline, dependencies: {}, packages: [] });
    const fetch = vi.fn(() => { throw new Error('构建不能联网'); }); vi.stubGlobal('fetch', fetch);
    const first = await project.buildCandidateBundle({ ...request, baseline: saved.baseline });
    expect(first.runtime).toBe('passed');
    expect(await project.candidate({ action: 'read' })).toEqual(saved);
    const changed = await project.candidate({ action: 'apply', baseline: saved.baseline, changes: [{ path: 'src/RenderProgram.tsx', content: 'export function RenderProgram(){return null;}' }] });
    await expect(project.buildCandidateBundle({ ...request, baseline: saved.baseline })).rejects.toMatchObject({ code: 'CANDIDATE_BASELINE_CONFLICT' });
    expect(await project.candidate({ action: 'read' })).toEqual(changed);
    expect(fetch).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); await project.release(); await rm(root, { recursive: true, force: true }); }
}, 90_000);

it('正则状态和 delete 不能让同一帧依赖执行历史', () => {
  expect(() => assertDeterministicModule('const re=/a/g;export function RenderProgram(){return String(re.test("a"));}')).toThrow();
  expect(() => assertDeterministicModule('const state={value:1};export function RenderProgram(){const value=state.value;delete state.value;return value;}')).toThrow();
});

it('旧式 getter/setter API 不能修改跨帧对象或共享内建对象', () => {
  for (const api of ['__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']) {
    expect(() => assertDeterministicModule(`const state={value:1};export function RenderProgram(){const previous=state.value;state.${api}("value",()=>previous+1);return previous;}`)).toThrow();
  }
});

it('第三方包入口不能通过 main 逃逸到 Runtime 私有实现', async () => {
  const request = await fixture();
  const bytes = archive(new Map([
    ['package.json', Buffer.from(JSON.stringify({ name: 'bundle-fixture', version: '1.0.0', main: '../../../runtime/node_modules/react-dom/index.js', types: 'index.d.ts' }))],
    ['index.d.ts', Buffer.from('export declare function twice(value: number): number;')],
  ]));
  const lock = parseYaml(request.program.get('pnpm-lock.yaml')!.toString());
  lock.packages['bundle-fixture@1.0.0'].resolution.integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  request.program.set('pnpm-lock.yaml', Buffer.from(stringify(lock)));
  request.offline.set(createHash('sha512').update(bytes).digest('hex'), bytes);
  await expect(buildProgramBundle(request)).rejects.toMatchObject({ code: 'STATIC_FORBIDDEN_CAPABILITY' });
}, 60_000);

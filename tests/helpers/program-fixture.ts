import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { stringify } from 'yaml';
import { programToolchain } from '../../src/server/program-toolchain';
import type { RenderProgramInputV1 } from '../../src/runtime';
export function archive(files: ReadonlyMap<string, Buffer>) {
  const chunks: Buffer[] = [];
  for (const [path, bytes] of files) {
    const header = Buffer.alloc(512); const name = `package/${path}`;
    const split = name.lastIndexOf('/');
    header.write(name.length <= 100 ? name : name.slice(split + 1), 0);
    if (name.length > 100) header.write(name.slice(0, split), 345);
    header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
export async function fixture() {
  const { packages: fixed } = await programToolchain();
  const packages: Record<string, any> = {}, snapshots: Record<string, any> = {}, offline = new Map<string, Buffer>();
  const versions = Object.fromEntries([...fixed].map(([name, value]) => [name, value.version]));
  for (const name of ['react', 'react-dom', 'scheduler', 'remotion']) {
    const meta = fixed.get(name)!; const bytes = archive(meta.files);
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    offline.set(createHash('sha512').update(bytes).digest('hex'), bytes);
    packages[`${name}@${meta.version}`] = { resolution: { integrity } };
    const manifest = JSON.parse(meta.files.get('package.json')!.toString());
    const dependencies = Object.fromEntries(Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).filter(key => versions[key]).map(key => [key, versions[key]]));
    snapshots[`${name}@${meta.version}`] = Object.keys(dependencies).length ? { dependencies } : {};
  }
  const dependencies = Object.fromEntries(['react', 'react-dom', 'remotion'].map(name => [name, versions[name]]));
  const helper = archive(new Map([
    ['package.json', Buffer.from(JSON.stringify({ name: 'bundle-fixture', version: '1.0.0', type: 'module', main: 'index.js', types: 'index.d.ts', scripts: {
      postinstall: 'node --input-type=module -e ' + JSON.stringify('import {writeFileSync} from "node:fs"; writeFileSync("index.js", "export function twice(value){return value * 2;}");'),
    } }))],
    ['index.js', Buffer.from('export function twice(){throw "安装脚本尚未执行";}')],
    ['index.d.ts', Buffer.from('export declare function twice(value: number): number;')],
  ]));
  offline.set(createHash('sha512').update(helper).digest('hex'), helper);
  packages['bundle-fixture@1.0.0'] = { resolution: { integrity: `sha512-${createHash('sha512').update(helper).digest('base64')}` } };
  snapshots['bundle-fixture@1.0.0'] = {};
  dependencies['bundle-fixture'] = '1.0.0';

  const program = new Map<string, Buffer>([
    ['program.json', Buffer.from(JSON.stringify({ apiVersion: 1, output: { width: 320, height: 240, fps: 30 } }))],
    ['package.json', Buffer.from(JSON.stringify({ private: true, dependencies }))],
    ['pnpm-lock.yaml', Buffer.from(stringify({ lockfileVersion: '9.0', importers: { '.': { dependencies: Object.fromEntries(Object.entries(dependencies).map(([name, version]) => [name, { specifier: version, version }])) } }, packages, snapshots }))],
    ['src/RenderProgram.tsx', Buffer.from('import {twice} from "bundle-fixture"; import {useCurrentFrame, useVideoConfig, random} from "remotion"; import type {RenderProgramInputV1} from "@narracut/runtime"; export function RenderProgram(input: RenderProgramInputV1) {const frame=useCurrentFrame();if(JSON.stringify(useVideoConfig()).includes("speech"))throw "Runtime props 不可公开";return <div>{input.videoBrief}{twice(frame)}{random("seed")}</div>;}')],
  ]);
  const input: RenderProgramInputV1 = { apiVersion: 1, videoBrief: '离线构建', output: { width: 320, height: 240, fps: 30 }, durationInFrames: 30,
    scenes: [{ id: 'scene', narration: '正文', assetIds: [], time: { startFrame: 0, durationInFrames: 30, source: 'draft' } }], assets: [] };
  return { program, offline, input, speech: [] };
}

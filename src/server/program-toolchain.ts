import { readFile, readdir } from 'node:fs/promises';
import { createRequire as createToolchainRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createToolchainRequire(import.meta.url);
const applicationRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
/** 只枚举应用固定包，项目无法传入宿主路径、构建插件或编译器。 */
export async function programToolchain() {
  const files: Record<string, Buffer> = Object.create(null);
  const packages = new Map<string, { version: string; files: Map<string, Buffer> }>();
  async function readTree(root: string, prefix: string, collected?: Map<string, Buffer>, relative = '') {
    for (const item of await readdir(join(root, relative), { withFileTypes: true })) {
      if (item.name === 'node_modules' || item.name.endsWith('.map')) continue;
      const path = relative ? `${relative}/${item.name}` : item.name;
      if (item.isDirectory()) await readTree(root, prefix, collected, path);
      else if (item.isFile()) { const bytes = await readFile(join(root, path)); files[`${prefix}/${path}`] = bytes; collected?.set(path, bytes); }
      else throw new Error('固定工具链内含不支持的链接。');
    }
  }
  for (const name of ['react', 'react-dom', 'scheduler', 'remotion', '@remotion/player', '@types/react', '@types/react-dom', 'csstype']) {
    const resolver = name === 'scheduler' ? createToolchainRequire(require.resolve('react-dom/package.json')) : name === 'csstype' ? createToolchainRequire(require.resolve('@types/react/package.json')) : require;
    const root = dirname(resolver.resolve(`${name}/package.json`));
    const collected = new Map<string, Buffer>();
    await readTree(root, `modules/${name}`, collected);
    packages.set(name, { version: JSON.parse(collected.get('package.json')!.toString()).version, files: collected });
  }
  const esbuildRequire = createToolchainRequire(require.resolve('esbuild/package.json'));
  files['toolchain/esbuild'] = await readFile(esbuildRequire.resolve(`@esbuild/${process.platform}-${process.arch}/bin/esbuild`));
  const tsRequire = createToolchainRequire(require.resolve('typescript/package.json'));
  const tsRoot = dirname(tsRequire.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`));
  await readTree(join(tsRoot, 'lib'), 'toolchain/tsc');
  files['modules/@narracut/runtime/index.ts'] = await readFile(join(applicationRoot, 'src/runtime/index.ts'));
  files['modules/@narracut/runtime/package.json'] = Buffer.from(JSON.stringify({ name: '@narracut/runtime', version: '4.0.512', main: 'index.ts', types: 'index.ts' }));
  files['worker.mjs'] = await bundleApplicationWorker('build');
  return { files, packages };
}

/** Node API 从固定应用包加载，避免插件单文件打包破坏 esbuild 的二进制寻址。 */
export async function bundleApplicationWorker(stage: 'build' | 'metadata') {
  const { build } = require('esbuild') as typeof import('esbuild');
  const worker = await build({ entryPoints: [join(applicationRoot, `src/server/program-${stage}-worker.ts`)],
    absWorkingDir: applicationRoot, bundle: true, platform: 'node', format: 'esm', write: false,
    banner: { js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);' } });
  return Buffer.from(worker.outputFiles[0].contents);
}

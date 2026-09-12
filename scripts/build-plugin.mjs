import { build } from 'esbuild';
import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const root = resolve('plugins/narracut');
const require = createRequire(import.meta.url);
const modules = join(root, 'node_modules');
// 原生模块不能塞进单个 JS 文件。复制已安装的精确依赖闭包，不下载或执行安装脚本。
await rm(modules, { recursive: true, force: true });
const copied = new Map();
async function copyPackage(name, resolver, optional = false) {
  let source;
  for (const directory of resolver.resolve.paths(name) ?? []) {
    try { source = await realpath(join(directory, name)); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!source) {
    if (optional) return;
    throw new Error(`插件缺少构建依赖：${name}`);
  }
  if (copied.has(name)) {
    if (copied.get(name) !== source) throw new Error(`插件运行依赖存在版本冲突：${name}`);
    return;
  }
  copied.set(name, source);
  const target = join(modules, name);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, dereference: true, filter: path => path === source || !path.slice(source.length + 1).split('/').includes('node_modules') });
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  const localRequire = createRequire(join(source, 'package.json'));
  for (const dependency of Object.keys(manifest.dependencies ?? {})) await copyPackage(dependency, localRequire);
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) await copyPackage(dependency, localRequire, true);
}
await copyPackage('sharp', require);
await build({ entryPoints: ['plugins/narracut/src/server.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(root, 'server.mjs'),
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
await build({ entryPoints: ['plugins/narracut/src/panel-entry.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(root, 'panel.mjs'),
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
// 兼容清单保留 Codex 的展示元数据；根清单启用可移植 MCP 配置解析。
const { interface: presentation, mcpServers, ...identity } = JSON.parse(await readFile(join(root, '.codex-plugin/plugin.json'), 'utf8'));
await writeFile(join(root, 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...identity }, null, 2) + '\n');
console.log(`插件构建完成：已打包 ${copied.size} 个原生运行依赖包（${process.platform}/${process.arch}）。`);

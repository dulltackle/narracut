// 仅由固定宿主编排器打包后送入执行胶囊；此文件不在宿主导入执行。
import { readFile, writeFile, mkdir, readdir, realpath, cp, chmod, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build, transform } from 'esbuild';
import { unpackOfflinePackage } from './project-dependencies';
import { assertDeterministicModule } from './program-static';

const exec = promisify(execFile);
const config = JSON.parse(await readFile('/inputs/' + (process.argv[1].includes('/dependencies/') ? 'dependencies' : 'runtime') + '/config.json', 'utf8'));
async function write(path: string, bytes: Uint8Array | string) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
async function walk(root: string, fn: (path: string, relative: string) => Promise<void>, prefix = '', skipModules = false) {
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (skipModules && item.name === 'node_modules') continue;
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) await walk(root, fn, relative, skipModules);
    else if (item.isFile()) await fn(join(root, relative), relative);
    else throw Object.assign(new Error('安装树包含链接或特殊文件。'), { code: 'DEPENDENCY_INSTALL_FAILED' });
  }
}
try {
  if (config.stage === 'install') {
    const manifests: any[] = [];
    for (const [index, item] of config.packages.entries()) {
      const { files, manifest } = unpackOfflinePackage(await readFile(`/inputs/dependencies/${index}.tgz`), item.pin);
      manifests.push(manifest);
      for (const [path, bytes] of files) await write(`/tmp/packages/${index}/${path}`, bytes);
    }
    for (const [index, item] of config.packages.entries()) {
      for (const [name, target] of Object.entries(item.dependencies)) {
        const path = `/tmp/packages/${index}/node_modules/${name}`;
        await mkdir(dirname(path), { recursive: true }); await symlink(`/tmp/packages/${target}`, path);
      }
    }
    const visited = new Set<number>();
    async function install(index: number) {
      if (visited.has(index)) return;
      visited.add(index);
      for (const dependency of Object.values(config.packages[index].dependencies)) await install(dependency as number);
      const root = `/tmp/packages/${index}`;
      // 生命周期脚本只能在安装胶囊里运行；脚本失败不发布任何安装树。
      for (const phase of ['preinstall', 'install', 'postinstall']) {
        const script = manifests[index].scripts?.[phase];
        if (script !== undefined) {
          if (typeof script !== 'string') throw new Error('安装脚本无效');
          await exec('/bin/sh', ['-c', script], { cwd: root, maxBuffer: 512 * 1024 });
        }
      }
    }
    for (const index of config.packages.keys()) await install(index);
    for (const index of config.packages.keys()) await walk(`/tmp/packages/${index}`, async (path, relative) => {
      await write(`/output/packages/${index}/${relative}`, await readFile(path));
    }, '', true);
  } else {
    await cp('/inputs/program', '/tmp/work/program', { recursive: true });
    await cp('/inputs/runtime/toolchain', '/tmp/tools', { recursive: true });
    await chmod('/tmp/tools/esbuild', 0o500); await chmod('/tmp/tools/tsc/tsc', 0o500);
    process.env.ESBUILD_BINARY_PATH = '/tmp/tools/esbuild';
    await cp('/inputs/dependencies/packages', '/tmp/work/packages', { recursive: true });
    const link = async (name: string, target: string, root: string) => {
      const path = join(root, 'node_modules', name); await mkdir(dirname(path), { recursive: true }); await symlink(target, path);
    };
    for (const [index, item] of config.packages.entries()) {
      for (const [name, target] of Object.entries(item.dependencies)) await link(name, `/tmp/work/packages/${target}`, `/tmp/work/packages/${index}`);
    }
    for (const [name, target] of Object.entries(config.roots)) await link(name, `/tmp/work/packages/${target}`, '/tmp/work/program');
    // 应用 Runtime 和类型声明是固定输入；项目不拥有这棵树。
    await cp('/inputs/runtime/modules', '/tmp/work/runtime/node_modules', { recursive: true });
    await cp('/inputs/runtime/source', '/tmp/work/runtime', { recursive: true });
    await link('@narracut/runtime', '/tmp/work/runtime/node_modules/@narracut/runtime', '/tmp/work/program');
    await link('@types', '/tmp/work/runtime/node_modules/@types', '/tmp/work/program');
    const sourceFiles: string[] = [];
    await walk('/tmp/work/program/src', async (path) => { if (/\.(?:tsx?|jsx?)$/.test(path)) sourceFiles.push(path); });
    // 全部源码参与类型检查，配置不从项目读取，防止插件或环境型配置介入。
    await write('/tmp/work/tsconfig.json', JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true,
      noEmit: true, skipLibCheck: true, types: [], lib: ['ES2022', 'DOM'],
    }, files: [...sourceFiles, '/tmp/work/runtime/entry-contract.ts'] }));
    try { await exec('/tmp/tools/tsc/tsc', ['--project', '/tmp/work/tsconfig.json'], { maxBuffer: 512 * 1024 }); }
    catch { throw Object.assign(new Error('Render Program 未通过固定类型检查。'), { code: 'TYPECHECK_FAILED' }); }
    const trusted = new Set(config.trustedFiles);
    for (const file of sourceFiles) {
      const result = await transform(await readFile(file, 'utf8'), { loader: file.endsWith('x') ? 'tsx' : 'ts', jsx: 'automatic', target: 'es2022' });
      assertDeterministicModule(result.code);
    }
    await build({ entryPoints: ['/tmp/work/runtime/entry.tsx'], outfile: '/output/bundle.js', bundle: true,
      platform: 'browser', format: 'iife', jsx: 'automatic', sourcemap: 'external', sourcesContent: true,
      define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
      plugins: [{ name: 'fixed-capabilities', setup(builder) {
        builder.onResolve({ filter: /^(?:react|react-dom|react\/jsx-runtime|remotion|@narracut\/runtime)$/ }, args => {
          if (args.path === '@narracut/runtime') return { path: '/tmp/work/runtime/node_modules/@narracut/runtime/index.ts' };
          const privileged = args.importer.startsWith('/tmp/work/runtime/') || trusted.has(args.importer);
          if (!privileged && args.path === 'react/jsx-runtime') return { path: '/tmp/work/runtime/safe-jsx.ts' };
          if (!privileged && args.path === 'remotion') return { path: '/tmp/work/runtime/safe-remotion.ts' };
          return { path: args.path === 'react/jsx-runtime' ? '/tmp/work/runtime/node_modules/react/jsx-runtime.js' : args.path === 'remotion' ? '/tmp/work/runtime/node_modules/remotion/dist/esm/index.mjs' : '/tmp/work/runtime/node_modules/' + args.path + '/index.js' };
        });
        builder.onResolve({ filter: /.*/ }, async args => {
          if (args.pluginData?.checked || args.importer.startsWith('/tmp/work/runtime/') || trusted.has(args.importer) || !args.importer) return;
          const importer = await realpath(args.importer);
          const packageIndex = importer.match(/^\/tmp\/work\/packages\/(\d+)\//)?.[1];
          const owner = packageIndex === undefined ? '/tmp/work/program' : `/tmp/work/packages/${packageIndex}`;
          let expected = owner;
          if (!args.path.startsWith('.')) {
            const edges = packageIndex === undefined ? config.roots : config.packages[Number(packageIndex)].dependencies;
            if (!Object.hasOwn(edges, args.path)) throw Object.assign(new Error('模块不在精确锁图内。'), { code: 'STATIC_FORBIDDEN_CAPABILITY' });
            expected = `/tmp/work/packages/${edges[args.path]}`;
          }
          const result = await builder.resolve(args.path, { importer: args.importer, resolveDir: args.resolveDir, kind: args.kind, pluginData: { checked: true } });
          if (result.errors.length) return result;
          const path = await realpath(result.path);
          if (!path.startsWith(expected + '/')) throw Object.assign(new Error('模块入口逃逸声明包边界。'), { code: 'STATIC_FORBIDDEN_CAPABILITY' });
          return { path };
        });
        builder.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
          const path = await import('node:fs/promises').then(fs => fs.realpath(args.path));
          if (!path.startsWith('/tmp/work/')) throw Object.assign(new Error('模块逃逸安装树。'), { code: 'STATIC_FORBIDDEN_CAPABILITY' });
          if (path.startsWith('/tmp/work/runtime/') || trusted.has(path)) return;
          const source = await readFile(path, 'utf8');
          const loader = /tsx$/.test(path) ? 'tsx' : /ts$/.test(path) ? 'ts' : /jsx$/.test(path) ? 'jsx' : 'js';
          const transformed = await transform(source, { loader, jsx: 'automatic', target: 'es2022' });
          assertDeterministicModule(transformed.code);
          return { contents: source, loader };
        });
      } }],
    });
    await write('/output/index.html', '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
  }
} catch (error: any) {
  // 结构化稳定代码，原始工具输出不外泄。失败不带任何部分构建产物。
  const { rm } = await import('node:fs/promises');
  for (const path of await readdir('/output')) await rm(join('/output', path), { recursive: true, force: true });
  const code = error?.code ?? error?.errors?.[0]?.detail?.code ?? (config.stage === 'install' ? 'DEPENDENCY_INSTALL_FAILED' : 'BUNDLE_FAILED');
  await write('/output/failure.json', JSON.stringify({ code }));
}

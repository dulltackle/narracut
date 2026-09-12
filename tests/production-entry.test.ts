import { build } from 'esbuild';
import { expect, it } from 'vitest';

it('CLI 与插件生产依赖图只包含 VNext，不重新连接旧 DSL、Preset 或固定 Composition', async () => {
  const result = await build({ entryPoints: ['src/server/cli.ts', 'plugins/narracut/src/server.ts'], outdir: '/tmp/narracut-entry-check', bundle: true, platform: 'node', format: 'esm', packages: 'external', metafile: true, write: false, logLevel: 'silent' });
  const paths = Object.keys(result.metafile!.inputs);
  expect(paths.some(path => path.endsWith('project-lifecycle.ts'))).toBe(true);
  expect(paths.filter(path => /project-schema-v[123]|text-presets|src\/client\/|src\/remotion\//.test(path))).toEqual([]);
});

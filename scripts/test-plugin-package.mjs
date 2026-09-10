import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkLauncher } from './test-installed-plugin.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'narracut-package-'));
try {
  const root = join(temporary, '插件 with spaces');
  await cp(resolve('plugins/narracut'), root, { recursive: true, dereference: true });
  // 单独验证安装目录的运行时；宿主的路径展开由 test-installed-plugin 检查。
  await checkLauncher({ command: process.execPath, args: [join(root, 'server.mjs')], cwd: temporary, env: { NODE_PATH: '', NODE_OPTIONS: '' } });
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { createRequire } from 'node:module';
    import assert from 'node:assert/strict';
    const sharp = createRequire(process.argv[1])('sharp');
    const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#123456' } }).png().toBuffer();
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 2); assert.equal(metadata.height, 3);
  `, join(root, 'server.mjs')], { cwd: temporary, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' }, stdio: 'pipe' });
  console.log('独立安装目录：启动器与 sharp 原生 PNG 编解码通过。');
} finally { await rm(temporary, { recursive: true, force: true }); }

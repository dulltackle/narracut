import { cp, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { checkLauncher } from './test-installed-plugin.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'narracut-package-'));
try {
  const root = join(temporary, '插件 with spaces');
  await cp(resolve('plugins/narracut'), root, { recursive: true, dereference: true });
  // 单独验证安装目录的运行时；宿主的路径展开由 test-installed-plugin 检查。
  await checkLauncher({ command: process.execPath, args: [join(root, 'server.mjs')], cwd: temporary, env: { NODE_PATH: '', NODE_OPTIONS: '' } });
  await access(join(root, 'skills/narracut-workbench/SKILL.md'));
  const panel = spawn(process.execPath, [join(root, 'panel.mjs')], { cwd: temporary, env: { ...process.env, CODEX_THREAD_ID: 'package-test-thread', NODE_PATH: '', NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = createInterface({ input: panel.stdout });
  const timeout = setTimeout(() => panel.kill('SIGKILL'), 10000);
  try {
    const descriptor = await new Promise((resolve, reject) => {
      lines.once('line', line => { try { resolve(JSON.parse(line)); } catch (error) { reject(error); } });
      panel.once('error', reject);
      panel.once('exit', () => reject(new Error('安装目录中的面板未能启动')));
    });
    assert.equal(descriptor.status, 'prepared');
    const response = await fetch(`${descriptor.url}view`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('data:font/woff2;base64,'));
    const state = await (await fetch(`${descriptor.url}state`)).json();
    assert.equal(state.structuredContent.conversation.threadId, 'package-test-thread');
    assert.equal(state.structuredContent.status, 'launcher');
  } finally {
    lines.close();
    if (panel.exitCode === null && panel.signalCode === null) { const done = once(panel, 'exit'); panel.kill('SIGTERM'); await done; }
    clearTimeout(timeout);
  }
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { createRequire } from 'node:module';
    import assert from 'node:assert/strict';
    const sharp = createRequire(process.argv[1])('sharp');
    const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#123456' } }).png().toBuffer();
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 2); assert.equal(metadata.height, 3);
  `, join(root, 'server.mjs')], { cwd: temporary, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' }, stdio: 'pipe' });
  console.log('独立安装目录：启动技能、面板资源与身份、启动器和 sharp 原生 PNG 编解码通过。');
} finally { await rm(temporary, { recursive: true, force: true }); }

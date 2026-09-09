import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { arch, release } from 'node:os';
import { rmSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire as createToolchainRequire } from 'node:module';

const exec = promisify(execFile);

/** 进程被信号终止或崩溃时 exit 钩子不会触发；启动时回收属主已消失的快照，避免 /tmp 累积。 */
async function reclaimOrphanSnapshots() {
  const parent = tmpdir();
  for (const name of await readdir(parent).catch(() => [] as string[])) {
    if (!name.startsWith('narracut-toolchain-')) continue;
    const directory = join(parent, name);
    const owner = Number(await readFile(join(directory, 'owner.pid'), 'utf8').catch(() => ''));
    // 读不到属主标记的目录（正在创建中，或属于其他用户）一律保留；只回收属主确已消失的快照。
    if (!Number.isInteger(owner) || owner <= 0) continue;
    try { process.kill(owner, 0); continue; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/** 只从应用安装工具链取文件；项目请求不能提供这些宿主路径。 */
export async function snapshotCapsuleToolchain() {
  await reclaimOrphanSnapshots();
  const root = await mkdtemp(join(tmpdir(), 'narracut-toolchain-'));
  const hashes = new Map<string, string>();
  const groups = new Map<string, Set<string>>();
  let group = 'node';
  async function add(source: string, destination: string, executable = false) {
    const target = join(root, destination);
    if (!groups.has(destination)) groups.set(destination, new Set());
    groups.get(destination)!.add(group);
    if (hashes.has(destination)) return;
    await mkdir(dirname(target), { recursive: true });
    await copyFile(await realpath(source), target);
    await chmod(target, executable ? 0o555 : 0o444);
    hashes.set(destination, createHash('sha256').update(await readFile(target)).digest('hex'));
  }
  async function libraries(binary: string) {
    const { stdout } = await exec('/usr/bin/ldd', [binary], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, maxBuffer: 1024 * 1024 });
    for (const match of stdout.matchAll(/(?:=>\s+|^\s*)(\/[^\s]+)\s+\(/gm)) await add(match[1], match[1], true);
    if (stdout.includes('not found')) throw new Error('工具链缺少动态库');
  }
  async function tree(source: string, destination: string) {
    for (const item of await readdir(source, { withFileTypes: true })) {
      const from = join(source, item.name), to = join(destination, item.name);
      if (item.isDirectory()) await tree(from, to);
      else if (item.isFile()) await add(from, to, !/\.(?:pak|dat|json|woff2|txt)$/.test(item.name));
      else throw new Error('工具链目录包含特殊文件或链接');
    }
  }
  try {
    await writeFile(join(root, 'owner.pid'), String(process.pid), { mode: 0o444 });
    await add(process.execPath, '/runtime/node', true);
    await libraries(process.execPath);
    group = 'shell';
    await add('/bin/sh', '/bin/sh', true);
    await libraries(await realpath('/bin/sh'));
    group = 'browser';
    const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const browser = join(applicationRoot, 'node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64');
    await tree(browser, '/runtime/browser');
    await libraries(join(browser, 'chrome-headless-shell'));
    for (const name of ['libEGL.so', 'libGLESv2.so', 'libvk_swiftshader.so', 'libvulkan.so.1']) await libraries(join(browser, name));
    await tree(join(applicationRoot, 'node_modules/@fontsource-variable/noto-sans-sc/files'), '/runtime/fonts');
    // Chromium 的 Linux 字体平台需要一个可由 fontconfig 解析的基础字体；字节进入指纹。
    await add('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/runtime/fonts/fallback.ttf');
    group = 'encoder';
    const require = createToolchainRequire(import.meta.url);
    const rendererRoot = dirname(require.resolve('@remotion/renderer/package.json'));
    const { getExecutableDir } = require(join(rendererRoot, 'dist/compositor/get-executable-path.js'));
    const binaries = getExecutableDir(false, 'error');
    for (const name of await readdir(binaries)) if (/\.so(?:\.|$)/.test(name)) await add(join(binaries, name), `/runtime/${name}`, true);
    for (const name of ['ffmpeg', 'ffprobe']) {
      await add(join(binaries, name), `/runtime/${name}`, true);
      await libraries(join(binaries, name));
    }
    for (const path of ['inputs', 'output', 'tmp', 'proc', 'dev/shm', 'etc/fonts']) await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, 'supervisor.mjs'), '', { mode: 0o444 });
    const fontConfig = '<!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/runtime/fonts</dir><cachedir>/tmp/font-cache</cachedir></fontconfig>';
    await writeFile(join(root, 'etc/fonts/fonts.conf'), fontConfig, { mode: 0o444 });
    hashes.set('/etc/fonts/fonts.conf', createHash('sha256').update(fontConfig).digest('hex'));
    groups.set('/etc/fonts/fonts.conf', new Set(['browser']));
    for (const path of ['/usr/bin/bwrap', '/usr/bin/systemd-run', '/usr/bin/systemctl']) hashes.set(path, createHash('sha256').update(await readFile(path)).digest('hex'));
    const cleanup = () => rmSync(root, { recursive: true, force: true });
    process.once('exit', cleanup);
    return { root, files: [...groups].map(([path, roles]) => ({ path, roles: [...roles] })),
      identity: createHash('sha256').update(JSON.stringify({ files: [...hashes].sort(), groups: [...groups].map(([path, groups]) => [path, [...groups]]), kernel: release(), arch: arch() })).digest('hex'),
      dispose: async () => { process.removeListener('exit', cleanup); await rm(root, { recursive: true, force: true }); } };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

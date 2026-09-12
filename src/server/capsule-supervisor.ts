/** 此程序由应用提供，输出仍按不可信数据校验；项目不获得宿主输出目录。 */
export const CAPSULE_SUPERVISOR = String.raw`
import { spawn } from 'node:child_process';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
const [entry, outputLimit, logLimit] = process.argv.slice(2);
const lines = createInterface({ input: process.stdin });
process.stdout.write('READY\n');
for await (const line of lines) {
  if (line === 'GO') break;
  if (line.startsWith('DOWNLOAD ')) {
    const bytes = Buffer.from(line.slice(9), 'base64');
    if (bytes.length > Number(outputLimit)) process.exit(73);
    await writeFile('/output/package.tgz', bytes);
    break;
  }
  process.exit(70);
}
lines.close();
// 普通限额临时文件，仅满足工具链对路径的要求；不挂载任何宿主设备。
await writeFile('/dev/null', '');
let logBytes = 0;
const child = spawn('/runtime/node', [entry], { cwd: '/output', env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end();
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
  logBytes += chunk.length;
  if (logBytes > Number(logLimit)) process.exit(73);
});
child.on('error', () => process.exit(70));
child.on('close', async code => {
  // Linux 的 kill(-1) 排除调用者和 namespace init；先终止其他进程再读取输出。
  try { process.kill(-1, 'SIGKILL'); } catch {}
  if (code !== 0) process.exit(code === null ? 73 : 71);
  const files = [];
  let size = 0;
  async function collect(path, depth = 0) {
    if (depth > 16) throw new Error();
    for (const name of await readdir('/output/' + path)) {
      const relative = path + name;
      const facts = await lstat('/output/' + relative);
      if (facts.isDirectory()) await collect(relative + '/', depth + 1);
      else {
        if (!facts.isFile() || facts.nlink !== 1 || files.length >= 1024) throw new Error();
        size += facts.size;
        if (size > Number(outputLimit)) throw new Error();
        const bytes = await readFile('/output/' + relative);
        if (bytes.length !== facts.size) throw new Error();
        files.push([relative, bytes.toString('base64')]);
      }
    }
  }
  try { await collect(''); process.stdout.write(JSON.stringify(files) + '\n'); }
  catch { process.exit(73); }
});
`;

export const CAPSULE_PROBE = String.raw`
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
const denied = [];
for (const path of ['/etc/passwd', '/home', '/run/docker.sock', '/dev/sda', '/sys/fs/cgroup/cgroup.procs']) {
  try { await readFile(path); throw new Error('宿主文件可读'); }
  catch (error) { if (!['ENOENT', 'EACCES', 'EISDIR'].includes(error.code)) throw error; denied.push(path); }
}
for (const path of ['/escape', '/inputs/program/main.mjs', '/runtime/node']) {
  try { await writeFile(path, 'escape'); throw new Error('只读边界失效'); }
  catch (error) { if (!['EROFS', 'EACCES'].includes(error.code)) throw error; }
}
for (const host of ['127.0.0.1', '169.254.169.254', '1.1.1.1']) {
  await new Promise((resolve, reject) => {
    const socket = connect({ host, port: 80 });
    socket.on('connect', () => { socket.destroy(); reject(new Error('网络隔离失效')); });
    socket.on('error', resolve);
    socket.setTimeout(500, () => { socket.destroy(); reject(new Error('网络边界未得到确定验证')); });
  });
}
const status = await readFile('/proc/self/status', 'utf8');
if (!/^CapEff:\s+0+$/m.test(status)) throw new Error('保留了 Linux capabilities');
if (process.env.TZ !== 'UTC' || process.env.LC_ALL !== 'C.UTF-8' || Object.keys(process.env).length !== 11 || process.env.PWD !== "/output") throw new Error('环境不固定');
await writeFile('/output/proof.json', JSON.stringify({ denied, isolated: true }));
`;

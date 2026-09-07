import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import { CAPSULE_PROBE, CAPSULE_SUPERVISOR } from './capsule-supervisor';
import { snapshotCapsuleToolchain } from './capsule-toolchain';
import { fetchRegistryPackage } from './capsule-registry';

export type CapsuleStage = 'download' | 'install' | 'build' | 'metadata' | 'preview' | 'render';
export type CapsuleRequest = {
  stage: CapsuleStage;
  inputs: Record<string, Uint8Array>;
  entry: string;
  signal?: AbortSignal;
};
export class CapsuleError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export const CAPSULE_BROWSER_ARGUMENTS = Object.freeze([
  '--no-sandbox', '--no-zygote', '--in-process-gpu', '--headless', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader', '--remote-debugging-pipe',
]);
const MiB = 1024 * 1024;
const exec = promisify(execFile);
const environment = Object.freeze({
  PWD: '/output', PATH: '/runtime:/bin', HOME: '/tmp/home', TMPDIR: '/tmp', TZ: 'UTC', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
  FONTCONFIG_FILE: '/etc/fonts/fonts.conf', NARRACUT_BROWSER: '/runtime/browser/chrome-headless-shell',
  NARRACUT_BROWSER_GL: 'swiftshader', VK_ICD_FILENAMES: '/runtime/browser/vk_swiftshader_icd.json',
});
type Limits = { memory: number; pids: number; disk: number; output: number; logs: number; wallMs: number };
const limits = (memory: number, disk: number, output: number, wallMs: number, pids = 64): Readonly<Limits> =>
  Object.freeze({ memory: memory * MiB, pids, disk: disk * MiB, output: output * MiB, logs: MiB, wallMs });
export const CAPSULE_POLICIES = Object.freeze({
  download: limits(256, 64, 32, 30_000), install: limits(512, 256, 128, 60_000),
  build: limits(1024, 256, 128, 120_000), metadata: limits(1024, 64, 4, 30_000, 256),
  preview: limits(1024, 128, 64, 120_000, 256), render: limits(2048, 512, 256, 300_000, 256),
});
const roles: Record<CapsuleStage, readonly string[]> = {
  download: ['dependencies'], install: ['dependencies'], build: ['program', 'runtime', 'dependencies'],
  metadata: ['bundle', 'input'], preview: ['bundle', 'input', 'media'], render: ['bundle', 'input', 'media'],
};
const safePath = (path: string) => path.length <= 512 && !path.includes('\\') && !path.includes('\0') &&
  path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
const failure = (code: string) => new CapsuleError(code, {
  CAPSULE_UNAVAILABLE: '认证执行胶囊不可用；请检查 Linux、bubblewrap、用户 systemd 与固定工具链。',
  CAPSULE_SELF_TEST_FAILED: '执行胶囊能力自检失败，已阻断项目代码执行。',
  CAPSULE_TIMEOUT: '执行胶囊达到墙钟上限，已销毁全部进程并丢弃输出。',
  CAPSULE_RESOURCE_EXCEEDED: '执行胶囊超出资源或输出边界，已销毁全部进程并丢弃输出。',
  CAPSULE_CANCELLED: '执行已取消，胶囊输出已丢弃。',
  CAPSULE_OUTPUT_INVALID: '胶囊输出未通过验证，已丢弃。',
  CAPSULE_EXECUTION_FAILED: '项目代码执行失败，胶囊输出已丢弃。',
}[code] ?? '执行胶囊请求不符合阶段能力约束。');
type Toolchain = Awaited<ReturnType<typeof snapshotCapsuleToolchain>>;

export class ExecutionCapsule {
  #toolchain?: Toolchain;
  #certification?: Promise<string>;

  /** 不接受项目提供的可执行文件、环境、挂载或后端；工具链只从应用安装位置生成。 */
  static async local() {
    if (process.platform !== 'linux') throw failure('CAPSULE_UNAVAILABLE');
    const capsule = new ExecutionCapsule();
    try { capsule.#toolchain = await snapshotCapsuleToolchain(); }
    catch { throw failure('CAPSULE_UNAVAILABLE'); }
    return capsule;
  }
  async dispose() {
    await this.#toolchain?.dispose();
    this.#toolchain = undefined;
    this.#certification = undefined;
  }
  async certify(): Promise<string> {
    if (!this.#toolchain) throw failure('CAPSULE_UNAVAILABLE');
    return this.#certification ??= this.#selfTest().catch(error => { this.#certification = undefined; throw error; });
  }
  /** 显式压力诊断：会真实触发 cgroup OOM，桌面可能显示内存通知；不在日常认证中调用。 */
  async diagnoseMemoryLimit(): Promise<void> {
    await this.certify();
    try {
      await this.#execute('build', {
        'program/main.mjs': Buffer.from('const held=[];setInterval(()=>held.push(Buffer.alloc(16*1024*1024,1)),5);'),
      }, 'program/main.mjs', undefined, undefined, limits(128, 2, 1, 3000, 32));
    } catch (error) {
      if (error instanceof CapsuleError && error.code === 'CAPSULE_RESOURCE_EXCEEDED') return;
      throw error;
    }
    throw failure('CAPSULE_SELF_TEST_FAILED');
  }
  async #selfTest() {
    try {
      for (const stage of Object.keys(CAPSULE_POLICIES) as CapsuleStage[]) {
        const files = await this.#execute(stage, { 'program/main.mjs': Buffer.from(CAPSULE_PROBE) }, 'program/main.mjs');
        const proof = JSON.parse(files.get('proof.json')?.toString() ?? 'null');
        if (proof?.isolated !== true || proof.denied.length !== 5) throw failure('CAPSULE_SELF_TEST_FAILED');
      }
      // 日常自检不主动制造 OOM，避免桌面误报整机内存不足。
      // 内存限额仍在每次执行前核验；内核 OOM 行为由显式 diagnoseMemoryLimit 诊断覆盖。
      const probeLimits: Limits = { memory: 128 * MiB, pids: 32, disk: 2 * MiB, output: MiB, logs: 4096, wallMs: 3000 };
      const probes: Array<[string, string | null]> = [
        ["import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';let n=0;function next(){const p=spawn('/bin/sh',['-c','read value']);p.once('spawn',()=>{if(++n>40)process.exit(2);next()});p.once('error',e=>{if(e.code!=='EAGAIN')process.exit(2);writeFileSync('/output/proof','limited');process.exit(0)})}next();", null],
        ["import{openSync,writeSync,writeFileSync}from'node:fs';const fd=openSync('/tmp/fill','w');try{for(let i=0;i<4;i++)writeSync(fd,Buffer.alloc(1024*1024,1));process.exit(2)}catch(e){if(e.code!=='ENOSPC')process.exit(2);writeFileSync('/output/proof','limited')}", null],
        ["process.stdout.write('x'.repeat(8192));setInterval(()=>{},100);", 'CAPSULE_RESOURCE_EXCEEDED'],
        ["import{spawn}from'node:child_process';spawn('/bin/sh',['-c','while :; do :; done'],{detached:true});setInterval(()=>{},100);", 'CAPSULE_TIMEOUT'],
      ];
      for (const [source, expected] of probes) {
        try {
          const output = await this.#execute('build', { 'program/main.mjs': Buffer.from(source) }, 'program/main.mjs', undefined, undefined, probeLimits);
          if (expected !== null || output.get('proof')?.toString() !== 'limited') throw failure('CAPSULE_SELF_TEST_FAILED');
        } catch (error) {
          if (!expected || !(error instanceof CapsuleError) || error.code !== expected) throw error;
        }
      }
      const browserProof = await this.#execute('metadata', { 'bundle/main.mjs': Buffer.from(`
        import{spawn}from'node:child_process';import{writeFileSync,readFileSync}from'node:fs';
        const p=spawn(process.env.NARRACUT_BROWSER,${JSON.stringify(CAPSULE_BROWSER_ARGUMENTS)},{stdio:['pipe','pipe','pipe','pipe','pipe']});
        p.stderr.resume();p.stdout.resume();p.on('error',()=>process.exit(2));
        let sequence=0,wire='';const waiting=new Map();
        p.stdio[4].on('data',b=>{wire+=b.toString();let cut;while((cut=wire.indexOf(String.fromCharCode(0)))>=0){const message=JSON.parse(wire.slice(0,cut));wire=wire.slice(cut+1);if(waiting.has(message.id)){const {resolve,reject}=waiting.get(message.id);waiting.delete(message.id);message.error?reject(new Error(JSON.stringify(message))):resolve(message.result)}}});
        function command(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});p.stdio[3].write(JSON.stringify({id,method,params,sessionId})+String.fromCharCode(0))})}
        await command('Browser.getVersion');
        const {targetId}=await command('Target.createTarget',{url:'about:blank'});
        const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
        await command('Page.enable',{},sessionId);
        const {frameTree}=await command('Page.getFrameTree',{},sessionId);
        await command('Page.setDocumentContent',{frameId:frameTree.frame.id,html:'<style>@font-face{font-family:fixed;src:url(data:font/woff2;base64,'+readFileSync('/runtime/fonts/noto-sans-sc-latin-wght-normal.woff2').toString('base64')+')}body{font-family:fixed}</style><p>capsule-browser</p>'},sessionId);
        const evaluated=await command('Runtime.evaluate',{expression:'document.fonts.ready.then(()=>document.body.innerText.includes("capsule-browser"))',awaitPromise:true},sessionId);
        if(evaluated.result.value!==true)throw new Error(JSON.stringify(evaluated));
        const shot=await command('Page.captureScreenshot',{format:'png'},sessionId);
        if(!shot.data)throw new Error(JSON.stringify(shot));writeFileSync('/output/browser','fixed');process.exit(0);
      `) }, 'bundle/main.mjs');
      if (browserProof.get('browser')?.toString() !== 'fixed') throw failure('CAPSULE_SELF_TEST_FAILED');
      return createHash('sha256').update(JSON.stringify({ protocol: 1, toolchain: this.#toolchain!.identity, environment, browserArguments: CAPSULE_BROWSER_ARGUMENTS, policies: CAPSULE_POLICIES, supervisor: CAPSULE_SUPERVISOR, probe: CAPSULE_PROBE, roles, backend: this.#execute.toString(), certification: this.#selfTest.toString() })).digest('hex');
    } catch (error) {
      if (error instanceof CapsuleError && error.code === 'CAPSULE_UNAVAILABLE') throw error;
      throw failure('CAPSULE_SELF_TEST_FAILED');
    }
  }
  async run(request: CapsuleRequest, validate: (output: ReadonlyMap<string, Buffer>) => boolean | Promise<boolean>): Promise<ReadonlyMap<string, Buffer>> {
    await this.certify();
    if (request.signal?.aborted) throw failure('CAPSULE_CANCELLED');
    if (!Object.hasOwn(CAPSULE_POLICIES, request.stage) || request.stage === 'download') throw failure('CAPSULE_REQUEST_INVALID');
    const entries = Object.entries(request.inputs);
    if (entries.length > 4096 || entries.some(([path, bytes]) => !safePath(path) || !roles[request.stage].includes(path.split('/')[0]) || !(bytes instanceof Uint8Array)) ||
        !Object.hasOwn(request.inputs, request.entry) || entries.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0) > CAPSULE_POLICIES[request.stage].disk) throw failure('CAPSULE_REQUEST_INVALID');
    // 调用者后续修改 Buffer 不会改变本次输入。
    const inputs = Object.fromEntries(entries.map(([path, bytes]) => [path, Buffer.from(bytes)]));
    const output = await this.#execute(request.stage, inputs, request.entry, request.signal);
    if (request.signal?.aborted) throw failure('CAPSULE_CANCELLED');
    if (!await validate(output)) throw failure('CAPSULE_OUTPUT_INVALID');
    if (request.signal?.aborted) throw failure('CAPSULE_CANCELLED');
    return output;
  }

  /** 下载阶段唯一宿主能力是固定 registry 的无凭据字节代理，不能运行调用者代码。 */
  async downloadPackage(pin: { name: string; version: string; integrity: string }, signal?: AbortSignal): Promise<Buffer> {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(pin.name) || pin.name.length > 214 ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pin.version) ||
        !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pin.integrity)) throw failure('CAPSULE_REQUEST_INVALID');
    await this.certify();
    if (signal?.aborted) throw failure('CAPSULE_CANCELLED');
    const source = `import {readFile} from 'node:fs/promises'; import {createHash} from 'node:crypto';
      if ('sha512-' + createHash('sha512').update(await readFile('/output/package.tgz')).digest('base64') !== ${JSON.stringify(pin.integrity)}) process.exit(71);`;
    const output = await this.#execute('download', { 'dependencies/verify.mjs': Buffer.from(source) }, 'dependencies/verify.mjs', signal,
      cancellation => fetchRegistryPackage(pin, cancellation));
    const bytes = output.get('package.tgz');
    if (signal?.aborted) throw failure('CAPSULE_CANCELLED');
    if (output.size !== 1 || !bytes || `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== pin.integrity) throw failure('CAPSULE_OUTPUT_INVALID');
    return bytes;
  }

  async #execute(stage: CapsuleStage, inputs: Record<string, Buffer>, entry: string, signal?: AbortSignal, download?: (signal: AbortSignal) => Promise<Buffer>, certificationLimits?: Limits): Promise<ReadonlyMap<string, Buffer>> {
    if (!this.#toolchain) throw failure('CAPSULE_UNAVAILABLE');
    const policy = certificationLimits ?? CAPSULE_POLICIES[stage];
    const directory = await mkdtemp(join(tmpdir(), 'narracut-capsule-'));
    const unit = `narracut-capsule-${randomUUID()}.service`;
    const controlEnv = { PATH: '/usr/bin:/bin', LC_ALL: 'C', XDG_RUNTIME_DIR: `/run/user/${process.getuid!()}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid!()}/bus` };
    const control = (...args: string[]) => exec('/usr/bin/systemctl', ['--user', ...args], { env: controlEnv, timeout: 5000, maxBuffer: 64 * 1024 });
    try {
      const inputRoot = join(directory, 'inputs');
      await mkdir(inputRoot);
      for (const [path, bytes] of Object.entries(inputs)) {
        const target = join(inputRoot, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes, { mode: 0o444 });
      }
      const supervisor = join(directory, 'supervisor.mjs');
      await writeFile(supervisor, CAPSULE_SUPERVISOR, { mode: 0o444 });
      const args = ['--user', '--quiet', '--wait', '--pipe', `--unit=${unit}`,
        '-p', `MemoryMax=${policy.memory}`, '-p', 'MemorySwapMax=0', '-p', `TasksMax=${policy.pids}`,
        '-p', `RuntimeMaxSec=${policy.wallMs / 1000}`, '-p', 'KillMode=control-group', '-p', 'TimeoutStopSec=1',
        '-p', 'SendSIGKILL=yes', '-p', 'OOMPolicy=kill', '-p', 'NoNewPrivileges=yes', '-p', 'KeyringMode=private',
        '/usr/bin/bwrap', '--unshare-all', '--unshare-user', '--unshare-cgroup', '--disable-userns', '--assert-userns-disabled',
        '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv', '--hostname', 'narracut',
        '--tmpfs', '/',
        ...this.#toolchain.files.filter(file => file.roles.includes('node') ||
          (['install', 'build'].includes(stage) && file.roles.includes('shell')) ||
          (['metadata', 'preview', 'render'].includes(stage) && file.roles.includes('browser')))
          .flatMap(file => ['--ro-bind', join(this.#toolchain!.root, file.path), file.path]),
        '--ro-bind', inputRoot, '/inputs', '--ro-bind', supervisor, '/supervisor.mjs',
        '--proc', '/proc', '--size', String(policy.disk), '--tmpfs', '/tmp',
        '--size', String(policy.output), '--tmpfs', '/output', '--size', String(MiB), '--tmpfs', '/dev', '--size', String(16 * MiB), '--tmpfs', '/dev/shm',
        ...Object.entries(environment).flatMap(([key, value]) => ['--setenv', key, value]),
        '--remount-ro', '/', '--chdir', '/output', '/runtime/node', '/supervisor.mjs', `/inputs/${entry}`, String(policy.output), String(policy.logs)];
      const child = spawn('/usr/bin/systemd-run', args, { env: controlEnv, stdio: ['pipe', 'pipe', 'pipe'] });
      let error: CapsuleError | undefined;
      let ready = false, bytes = 0, stderrBytes = 0;
      let wire = '';
      const decoder = new StringDecoder('utf8');
      const broker = new AbortController();
      let brokerError: unknown;
      let stopping: Promise<unknown> | undefined;
      const stop = (code: string) => {
        error ??= failure(code);
        broker.abort();
        return stopping ??= control('stop', unit).catch(() => undefined);
      };
      const abort = () => { void stop('CAPSULE_CANCELLED'); };
      signal?.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => { void stop('CAPSULE_TIMEOUT'); }, policy.wallMs + 5000);
      child.stdin.on('error', () => {});
      child.stderr.on('data', chunk => {
        stderrBytes += chunk.length;
        if (stderrBytes > policy.logs) void stop('CAPSULE_RESOURCE_EXCEEDED');
      });
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > policy.output * 1.4 + MiB) { void stop('CAPSULE_RESOURCE_EXCEEDED'); return; }
        wire += decoder.write(chunk);
        if (!ready && wire.includes('\n')) {
          ready = true;
          if (!wire.startsWith('READY\n')) { void stop('CAPSULE_SELF_TEST_FAILED'); return; }
          wire = wire.slice(6);
          void (async () => {
            try {
              const { stdout } = await control('show', unit, '--property=MemoryMax,MemorySwapMax,TasksMax,KillMode,NoNewPrivileges,RuntimeMaxUSec,SendSIGKILL,OOMPolicy');
              const properties = Object.fromEntries(stdout.trim().split('\n').map(line => line.split('=')));
              if (properties.MemoryMax !== String(policy.memory) || properties.MemorySwapMax !== '0' || properties.TasksMax !== String(policy.pids) ||
                  properties.KillMode !== 'control-group' || properties.NoNewPrivileges !== 'yes' || properties.SendSIGKILL !== 'yes' || properties.OOMPolicy !== 'kill' ||
                  properties.RuntimeMaxUSec !== `${policy.wallMs / 1000 % 60 === 0 ? policy.wallMs / 60000 + 'min' : policy.wallMs / 1000 + 's'}`) throw failure('CAPSULE_SELF_TEST_FAILED');
              if (error || signal?.aborted) { await control('stop', unit); error ??= failure('CAPSULE_CANCELLED'); }
              else if (download) {
                try { child.stdin.end(`DOWNLOAD ${(await download(broker.signal)).toString('base64')}\n`); }
                catch (cause) { brokerError = cause; await stop('CAPSULE_EXECUTION_FAILED'); }
              } else child.stdin.end('GO\n');
            } catch { await stop('CAPSULE_SELF_TEST_FAILED'); }
          })();
        }
      });
      let exitCode: number | null;
      try {
        exitCode = await new Promise<number | null>(resolve => {
          child.once('error', () => { error = failure('CAPSULE_UNAVAILABLE'); resolve(null); });
          child.once('close', resolve);
        });
        await stopping;
      } finally {
        clearTimeout(timeout);
        broker.abort();
        signal?.removeEventListener('abort', abort);
      }
      if (brokerError && error?.code === 'CAPSULE_EXECUTION_FAILED') throw brokerError;
      if (error) throw error;
      if (!ready) throw failure('CAPSULE_UNAVAILABLE');
      if (exitCode !== 0) {
        const { stdout } = await control('show', unit, '--property=Result').catch(() => ({ stdout: '' }));
        throw failure(stdout.includes('timeout') ? 'CAPSULE_TIMEOUT' : stdout.includes('oom-kill') || exitCode === 73 ? 'CAPSULE_RESOURCE_EXCEEDED' : 'CAPSULE_EXECUTION_FAILED');
      }
      wire += decoder.end();
      // systemd-run --wait 成功退出之后，整个 control group 已结束；此时才允许发布。
      try {
        const values: unknown = JSON.parse(wire);
        if (!Array.isArray(values) || values.length > 1024) throw new Error();
        const output = new Map<string, Buffer>(); let size = 0;
        for (const value of values) {
          if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || !safePath(value[0]) || typeof value[1] !== 'string' || output.has(value[0])) throw new Error();
          const data = Buffer.from(value[1], 'base64');
          if (data.toString('base64') !== value[1] || (size += data.length) > policy.output) throw new Error();
          output.set(value[0], data);
        }
        return output;
      } catch { throw failure('CAPSULE_OUTPUT_INVALID'); }
    } finally {
      await control('stop', unit).catch(() => undefined);
      await control('reset-failed', unit).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  }
}

let local: Promise<ExecutionCapsule> | undefined;
export function localExecutionCapsule() { return local ??= ExecutionCapsule.local().catch(error => { local = undefined; throw error; }); }

import { expect, it, vi } from 'vitest';
import { ExecutionCapsule } from '../src/server/execution-capsule';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { observeCapsuleServiceResults } from './helpers/capsule-service-results';

// 从 OS 观察实际子孙，不依赖胶囊返回的自报状态或某个后端的内部 unit 名。
async function liveMarkers(markers: string[]) {
  const names = await Promise.all((await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(async pid => {
    try { return (await readFile(`/proc/${pid}/comm`, 'utf8')).trim(); } catch { return ''; }
  }));
  return names.filter(name => markers.includes(name)).sort();
}
function descendants() {
  const id = randomUUID().replaceAll('-', '').slice(0, 8);
  const markers = [`nc74c${id}`, `nc74g${id}`];
  const grandchild = `process.title=${JSON.stringify(markers[1])};setInterval(()=>{},100);`;
  const child = `import{spawn}from'node:child_process';process.title=${JSON.stringify(markers[0])};spawn('/runtime/node',['--input-type=module','-e',${JSON.stringify(grandchild)}],{detached:true});setInterval(()=>{},100);`;
  const source = `import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';writeFileSync('/output/unfinished','discard');spawn('/runtime/node',['--input-type=module','-e',${JSON.stringify(child)}],{detached:true});setInterval(()=>{},100);`;
  return { markers, source: Buffer.from(source) };
}

it('没有认证工具链时，所有阶段稳定阻断且不执行输入代码', async () => {
  const capsule = new ExecutionCapsule();
  for (const stage of ['download', 'install', 'build', 'metadata', 'preview', 'render'] as const) {
    await expect(capsule.run({ stage, inputs: {}, entry: 'program/main.mjs' }, () => true))
      .rejects.toMatchObject({ code: 'CAPSULE_UNAVAILABLE' });
  }
});

it('真实胶囊认证通过后，只发布经过校验的阶段输出', async () => {
  const capsule = await ExecutionCapsule.local();
  try {
    const results = await observeCapsuleServiceResults(async () => {
      expect(await capsule.certify()).toMatch(/^[0-9a-f]{64}$/);
    });
    expect(results).toContain('success');
    expect(results).not.toContain('oom-kill');
    const result = await capsule.run({ stage: 'build', entry: 'program/main.mjs', inputs: {
      'program/main.mjs': Buffer.from("import {writeFile} from 'node:fs/promises'; await writeFile('/output/bundle.js', 'validated');"),
    } }, files => files.get('bundle.js')?.toString() === 'validated');
    expect(result.get('bundle.js')?.toString()).toBe('validated');
    const rejected = vi.fn(() => false);
    await expect(capsule.run({ stage: 'metadata', entry: 'bundle/main.mjs', inputs: {
      'bundle/main.mjs': Buffer.from("import {writeFile} from 'node:fs/promises'; await writeFile('/output/result', 'unverified');"),
    } }, rejected)).rejects.toMatchObject({ code: 'CAPSULE_OUTPUT_INVALID' });
    expect(rejected).toHaveBeenCalledTimes(1);
    const validate = vi.fn(() => true);
    await expect(capsule.run({ stage: 'render', entry: 'bundle/main.mjs', inputs: {
      'bundle/main.mjs': Buffer.from("import {symlink} from 'node:fs/promises'; await symlink('/runtime/node', '/output/escape');"),
    } }, validate)).rejects.toMatchObject({ code: 'CAPSULE_RESOURCE_EXCEEDED' });
    expect(validate).not.toHaveBeenCalled();
    for (const inputs of [{ 'program/main.mjs': Buffer.from('') }, { 'bundle/../secret': Buffer.from('') }] as Record<string, Buffer>[]) {
      await expect(capsule.run({ stage: 'preview', entry: Object.keys(inputs)[0], inputs }, validate))
        .rejects.toMatchObject({ code: 'CAPSULE_REQUEST_INVALID' });
    }
    const controller = new AbortController();
    const cancelFixture = descendants();
    const pending = capsule.run({ stage: 'install', entry: 'dependencies/main.mjs', signal: controller.signal, inputs: {
      'dependencies/main.mjs': cancelFixture.source,
    } }, validate);
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'CAPSULE_CANCELLED' });
    await expect.poll(() => liveMarkers(cancelFixture.markers), { timeout: 10_000 }).toEqual(cancelFixture.markers);
    controller.abort();
    await cancelled;
    await expect.poll(() => liveMarkers(cancelFixture.markers), { timeout: 5000 }).toEqual([]);
    const timeoutFixture = descendants();
    const timedOut = expect(capsule.run({ stage: 'metadata', entry: 'bundle/main.mjs', inputs: {
      'bundle/main.mjs': timeoutFixture.source,
    } }, validate)).rejects.toMatchObject({ code: 'CAPSULE_TIMEOUT' });
    await expect.poll(() => liveMarkers(timeoutFixture.markers), { timeout: 10_000 }).toEqual(timeoutFixture.markers);
    await timedOut;
    await expect.poll(() => liveMarkers(timeoutFixture.markers), { timeout: 5000 }).toEqual([]);
    expect(validate).not.toHaveBeenCalled();
  } finally { await capsule.dispose(); }
}, 60_000);

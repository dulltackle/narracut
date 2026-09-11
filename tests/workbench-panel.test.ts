import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openProjectVNext } from '../src/server/project-lifecycle';
import { fixture } from './helpers/program-fixture';
import { parse } from 'yaml';
import { runInNewContext } from 'node:vm';
import { startWorkbenchPanel } from '../plugins/narracut/src/workbench-panel';
import { createNarracutRequestHandler } from '../plugins/narracut/src/server';
import type { CodexHostAdapter, CodexHostEvent, StartCodexTurnInput } from '../plugins/narracut/src/codex-host';

class ConversationHost implements CodexHostAdapter {
  listeners = new Set<(event: CodexHostEvent) => void>();
  turns: Array<StartCodexTurnInput & { turnId: string }> = [];
  interrupted: string[] = [];
  failInterrupt = false;
  subscribe(listener: (event: CodexHostEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async createThread(): Promise<{ threadId: string }> { throw new Error('应复用已核实的当前对话。'); }
  async resumeThread(input: { threadId: string }) { return { threadId: input.threadId }; }
  async startTurn(input: StartCodexTurnInput) { const turnId = `turn-${this.turns.length}`; this.turns.push({ ...input, turnId }); return { turnId }; }
  async interruptTurn(input: { turnId: string }) { this.interrupted.push(input.turnId); if (this.failInterrupt) throw new Error('中断回执不明'); }
  async dispose() {}
  lateApply() {
    const turn = this.turns[0]!;
    for (const listener of this.listeners) listener({ type: 'turn-completed', threadId: turn.threadId, turnId: turn.turnId, status: 'completed', output: JSON.stringify({ verificationToken: turn.verificationToken, action: 'apply', changes: [{ path: 'resources/late.txt', content: '迟到写入' }], summary: '', divergence: '', warnings: [], suggestions: [], reviews: [] }) });
  }
}

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { try { for (const close of cleanup.splice(0).reverse()) await close(); } finally { vi.unstubAllEnvs(); } });

it('只读工作台可绑定既有 Preview 的不可变副本，禁止借预览启动新构建', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-view-preview-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const nativeFetch = globalThis.fetch;
  const source = await fixture();
  const urls = new Map<string, Buffer>();
  for (const [id, entry] of Object.entries(parse(source.program.get('pnpm-lock.yaml')!.toString()).packages) as [string, any][]) {
    const split = id.lastIndexOf('@'), name = id.slice(0, split), version = id.slice(split + 1);
    urls.set(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, source.offline.get(Buffer.from(entry.resolution.integrity.slice(7), 'base64').toString('hex'))!);
  }
  vi.stubGlobal('fetch', (url: string, init: any) => urls.has(String(url)) ? Promise.resolve(new Response(new Uint8Array(urls.get(String(url))!))) : nativeFetch(url, init));
  cleanup.push(async () => { vi.unstubAllGlobals(); });
  const first = createNarracutRequestHandler({ conversation: { threadId: 'preview-first' }, codexHost: new ConversationHost() }); cleanup.push(first.dispose);
  const second = createNarracutRequestHandler({ conversation: { threadId: 'preview-second' }, codexHost: new ConversationHost() }); cleanup.push(second.dispose);
  const call = async (handler: typeof first, name: string, args = {}) => await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any;
  const created = (await call(first, 'create_project', { projectDirectory: join(root, '项目') })).structuredContent;
  const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
  const revision = JSON.parse(await readFile(join(identity.projectDirectory, '.narracut/current.json'), 'utf8')).revisionId;
  for (const [path, bytes] of source.program) await writeFile(join(identity.projectDirectory, '.narracut/revisions', revision, 'render-program', path), bytes);
  const candidate = (await call(first, 'manage_project_candidate', { ...identity, action: 'create' })).structuredContent.candidate;
  expect((await call(first, 'coordinate_project_dependencies', { ...identity, baseline: candidate.baseline, dependencies: {}, packages: [] })).isError).not.toBe(true);
  const built = await call(first, 'project_preview', { ...identity, action: 'build', target: 'current', parentOrigin: 'http://localhost:12345' });
  expect(built.isError, JSON.stringify(built.structuredContent.error)).not.toBe(true);
  const original = built.structuredContent.preview;
  expect(original).toBeDefined();
  await call(second, 'open_project', identity);
  const copy = (await call(second, 'project_preview', { ...identity, action: 'view', target: 'current', parentOrigin: 'http://localhost:23456' })).structuredContent.preview;
  expect(copy.identity).toEqual(original.identity);
  expect(copy.instanceId).not.toBe(original.instanceId);
  expect(await (await nativeFetch(new URL('bundle.js', copy.url))).text()).toBe(await (await nativeFetch(new URL('bundle.js', original.url))).text());
  const bootstrap = await (await nativeFetch(new URL('bootstrap.js', copy.url))).text();
  let binding: any;
  runInNewContext(bootstrap, { window: { dispatchEvent: (event: any) => { binding = event.detail; } }, CustomEvent: class { detail: any; constructor(_name: string, options: any) { this.detail = options.detail; } } });
  expect(binding).toMatchObject({ parentOrigin: 'http://localhost:23456', instanceId: copy.instanceId, token: copy.token });
  expect((await call(second, 'project_preview', { ...identity, action: 'build', target: 'current', parentOrigin: 'http://localhost:23456' })).structuredContent.error.code).toBe('PROJECT_CONTROL_REQUIRED');
}, 60000);

it('独立进程经合法只读会话查看同一物理目录，接管仍受唯一写入租约约束', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-process-control-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  async function panel(thread: string) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/helpers/control-panel-process.ts', thread], { stdio: ['ignore', 'pipe', 'pipe'] });
    cleanup.push(async () => { if (child.exitCode !== null || child.signalCode !== null) return; const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; });
    const [data] = await once(child.stdout, 'data');
    return { ...JSON.parse(data.toString()), child } as { url: string; child: typeof child };
  }
  const first = await panel('process-first'), second = await panel('process-second');
  const call = async (panel: { url: string }, name: string, args = {}) => (await (await fetch(`${panel.url}rpc`, { method: 'POST', headers: { Origin: new URL(panel.url).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()).result;
  const created = (await call(first, 'create_project', { projectDirectory: join(root, '项目') })).structuredContent;
  const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
  expect((await call(second, 'open_project', identity)).structuredContent.writable).toBe(false);
  await expect(openProjectVNext(identity.projectDirectory)).rejects.toMatchObject({ code: 'PROJECT_IN_USE' });
  expect((await call(second, 'project_control', { ...identity, action: 'takeover' })).structuredContent.writable).toBe(true);
  expect((await call(first, 'get_workbench')).structuredContent.writable).toBe(false);
  await expect(openProjectVNext(identity.projectDirectory)).rejects.toMatchObject({ code: 'PROJECT_IN_USE' });
  const exited = once(second.child, 'exit'); second.child.kill('SIGKILL'); await exited;
  const third = await panel('process-third');
  expect((await call(third, 'open_project', identity)).structuredContent).toMatchObject({ writable: true, control: { ownerThreadId: 'process-third' } });
}, 20000);

it('双对话 MCP 桥在中断失败时保持双侧禁写，重试仅转移控制权且拒绝旧 Turn 结果', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-transfer-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = new ConversationHost();
  const first = createNarracutRequestHandler({ conversation: { threadId: 'first' }, codexHost: host }); cleanup.push(first.dispose);
  const second = createNarracutRequestHandler({ conversation: { threadId: 'second' }, codexHost: host }); cleanup.push(second.dispose);
  const call = async (handler: typeof first, name: string, args = {}) => await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any;
  const created = (await call(first, 'create_project', { projectDirectory: join(root, '项目') })).structuredContent;
  const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
  const started = await call(first, 'start_creation_task', { ...identity, instruction: '保留原任务' });
  await expect.poll(() => host.turns.length).toBe(1);
  expect(host.turns[0]!.threadId).toBe('first');
  await call(second, 'open_project', identity);
  await call(second, 'open_project', identity);
  expect(host.interrupted).toHaveLength(0);
  const before = (await call(second, 'get_creation_task', identity)).structuredContent.creationTask;
  expect(before.taskId).toBe(started.structuredContent.creationTask.taskId);
  host.failInterrupt = true;
  expect((await call(second, 'project_control', { ...identity, action: 'takeover' })).isError).toBe(true);
  for (const handler of [first, second]) expect((await call(handler, 'save_project_scenes', identity)).structuredContent.error.code).toBe('PROJECT_CONTROL_REQUIRED');
  host.failInterrupt = false;
  const result = (await call(second, 'project_control', { ...identity, action: 'takeover' })).structuredContent;
  expect(result.creationTask).toMatchObject({ taskId: before.taskId, instruction: '保留原任务', status: 'stopped' });
  expect(host.turns).toHaveLength(1);
  const candidate = (await call(second, 'manage_project_candidate', { ...identity, action: 'read' })).structuredContent.candidate;
  host.lateApply();
  expect((await call(second, 'manage_project_candidate', { ...identity, action: 'read' })).structuredContent.candidate.baseline).toBe(candidate.baseline);
  await call(first, 'respond_creation_task', { ...identity, action: 'continue' });
  await expect.poll(() => host.turns.length).toBe(2);
  expect(host.turns[1]!.threadId).toBe('first');
  expect((await call(first, 'get_creation_task', identity)).structuredContent.creationTask.taskId).toBe(before.taskId);
  expect((await call(second, 'get_workbench')).structuredContent.writable).toBe(false);
});

it('已失权会话的 Speech 执行即使迟到返回音频，也不能写入新控制者的项目', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-late-speech-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  let requested = false;
  const first = createNarracutRequestHandler({ conversation: { threadId: 'speech-first' }, codexHost: new ConversationHost(), ttsFetch: async () => { requested = true; return pending; }, probeSpeechDurationMs: async () => 1001 }); cleanup.push(first.dispose);
  const second = createNarracutRequestHandler({ conversation: { threadId: 'speech-second' }, codexHost: new ConversationHost() }); cleanup.push(second.dispose);
  const call = async (handler: typeof first, name: string, args = {}) => await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any;
  const created = (await call(first, 'create_project', { projectDirectory: join(root, '项目') })).structuredContent;
  const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
  const sceneId = '30000000-0000-4000-8000-000000000001';
  const saved = (await call(first, 'save_project_scenes', { ...identity, baselineRevision: created.projectRevision, project: { assets: [], scenes: [{ id: sceneId, narration: { text: '保留这段旁白' }, assetIds: [] }] } })).structuredContent;
  const configured = await call(first, 'save_project_tts_settings', { ...identity, baselineRevision: saved.projectRevision, config: { provider: 'tokendance', model: 'minimax-speech-2.8-turbo', voice: 'Chinese (Mandarin)_News_Anchor', speed: 1, volume: 1, pitch: 0 }, credentialAction: 'replace', apiKey: 'test-key', expectedAffectedSpeechCount: 0 });
  expect(configured.isError).not.toBe(true);
  await call(first, 'start_scene_speech', { ...identity, sceneId });
  await expect.poll(() => requested).toBe(true);
  await call(second, 'open_project', identity);
  expect((await call(second, 'project_control', { ...identity, action: 'takeover' })).structuredContent.writable).toBe(true);
  finish(new Response(JSON.stringify({ data: { audio: Buffer.from('late audio').toString('hex') }, extra_info: { audio_length: 1001, audio_format: 'mp3' }, base_resp: { status_code: 0 } })));
  // 关闭旧会话等待其全部执行收尾，再从公开新会话读取持久结果。
  await first.dispose();
  const state = (await call(second, 'get_workbench')).structuredContent;
  expect(state.projectDsl.scenes[0]).toMatchObject({ narration: { text: '保留这段旁白' } });
  expect(state.projectDsl.scenes[0].speech).toBeUndefined();
});

it('另一对话打开同一项目只读，公开写请求被拒绝，明确接管后双方权限更新', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-control-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const first = await startWorkbenchPanel({ threadId: 'control-first' }); cleanup.push(first.close);
  const second = await startWorkbenchPanel({ threadId: 'control-second' }); cleanup.push(second.close);
  const call = async (panel: typeof first, name: string, args = {}) => (await (await fetch(`${panel.url}rpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(panel.url).origin },
    body: JSON.stringify({ id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })).json()).result;
  const created = await call(first, 'create_project', { projectDirectory: join(root, '项目') });
  const project = created.structuredContent.project;
  const identity = { projectDirectory: project.directory, projectId: project.projectId };
  const opened = await call(second, 'open_project', { projectDirectory: project.directory });
  expect(opened.structuredContent).toMatchObject({ writable: false, control: { status: 'readonly', ownerThreadId: 'control-first' } });
  expect((await call(first, 'get_workbench')).structuredContent.writable).toBe(true);
  for (const [name, action] of [
    ['save_project_scenes', undefined], ['save_project_video_brief', undefined], ['import_project_asset', undefined],
    ['save_project_tts_settings', undefined], ['start_scene_speech', undefined], ['cancel_scene_speech_job', undefined],
    ['manage_project_candidate', 'create'], ['manage_project_candidate', 'apply'], ['manage_project_candidate', 'discard'],
    ['coordinate_project_dependencies', undefined], ['project_preview', 'build'], ['project_preview', 'release'],
    ['project_checks', 'start'], ['project_checks', 'cancel'], ['project_delivery', 'prepare'], ['project_delivery', 'review'],
    ['project_delivery_display', undefined], ['project_acceptance', 'accept'], ['project_acceptance', 'cleanup'],
    ['project_acceptance', 'from-history'], ['project_render', 'start'], ['project_render', 'cancel'], ['copy_project', 'start'],
    ['restore_project', 'recover'], ['project_recovery', 'seal'], ['respond_creation_task', 'takeover'],
  ]) expect((await call(second, name!, { ...identity, action })).structuredContent.error.code, name).toBe('PROJECT_CONTROL_REQUIRED');
  const transferred = await call(second, 'project_control', { ...identity, action: 'takeover' });
  expect(transferred.structuredContent).toMatchObject({ writable: true, control: { status: 'editable' }, creationTask: null });
  expect((await call(first, 'get_workbench')).structuredContent).toMatchObject({ writable: false, control: { ownerThreadId: 'control-second' } });
});

it('公开面板入口在同一对话中创建项目，重载只读取已就绪项目', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-panel-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const panel = await startWorkbenchPanel({ threadId: 'thread-panel-test' });
  cleanup.push(panel.close);
  const rpc = async (name: string, args = {}) => {
    const response = await fetch(`${panel.url}rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(panel.url).origin }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return (await response.json()).result;
  };
  expect((await fetch(panel.url)).status).toBe(200);
  const created = await rpc('create_project', { projectDirectory: join(root, '面板项目') });
  expect(created.isError).not.toBe(true);
  expect(created.structuredContent.conversation).toMatchObject({ status: 'bound', threadId: 'thread-panel-test' });
  const first = await (await fetch(`${panel.url}state`)).json();
  const second = await (await fetch(`${panel.url}state`)).json();
  expect(second.structuredContent.project.projectId).toBe(first.structuredContent.project.projectId);
  expect(second.structuredContent.operation).not.toBe('created');
});

it('对话身份缺失时，生产 MCP 入口与面板均拒绝伪造身份后的写操作', async () => {
  const handler = createNarracutRequestHandler({ conversation: null });
  cleanup.push(handler.dispose);
  const request = { jsonrpc: '2.0' as const, id: 1, method: 'tools/call', params: {
    name: 'create_project', arguments: { projectDirectory: '/tmp/不得创建的项目', threadId: 'forged' },
  } };
  expect(await handler(request)).toMatchObject({ isError: true, structuredContent: { error: { code: 'HOST_CONVERSATION_UNAVAILABLE' } } });
  const panel = await startWorkbenchPanel(); cleanup.push(panel.close);
  const response = await fetch(`${panel.url}rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(panel.url).origin }, body: JSON.stringify(request) });
  expect(await response.json()).toMatchObject({ result: { isError: true, structuredContent: { error: { code: 'HOST_CONVERSATION_UNAVAILABLE' } } } });
});

it('其他网站不能使用本地面板调用项目工具', async () => {
  const panel = await startWorkbenchPanel({ threadId: 'thread-panel-test' }); cleanup.push(panel.close);
  expect((await fetch(`${panel.url}rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: '{}' })).status).toBe(403);
  expect((await fetch(new URL('/rpc', panel.url))).status).toBe(404);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    get(panel.url, { headers: { Host: 'unrelated.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  expect(status).toBe(404);
});


it('生产当前对话通过公开创作步骤协议提交结果，停止后拒绝旧步骤且不启动独立 Codex', async () => {
  vi.stubEnv('NARRACUT_CODEX_COMMAND', '/不存在的独立-codex');
  const root = await mkdtemp(join(tmpdir(), 'narracut-direct-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const handler = createNarracutRequestHandler({ conversation: { threadId: 'desktop-active-writer' } }); cleanup.push(handler.dispose);
  const call = async (name: string, args = {}) => await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any;
  const created = (await call('create_project', { projectDirectory: join(root, '项目') })).structuredContent;
  const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
  const started = (await call('start_creation_task', { ...identity, instruction: '只审阅候选，等待用户决定' })).structuredContent;
  const task = { ...identity, taskId: started.creationTask.taskId };
  let step: any;
  await expect.poll(async () => {
    const result = await call('creation_step', { ...task, action: 'read' });
    step = result.structuredContent?.step;
    return Boolean(step);
  }).toBe(true);
  expect(step.prompt).toContain('只审阅候选，等待用户决定');
  const answer = { verificationToken: step.verificationToken, action: 'wait', changes: [], summary: '请确认成片风格', divergence: '', warnings: [], suggestions: [], reviews: [] };
  expect((await call('creation_step', { ...task, action: 'submit', stepId: step.stepId, answer })).isError).not.toBe(true);
  await expect.poll(async () => (await call('get_creation_task', identity)).structuredContent.creationTask.status).toBe('waiting');
  expect((await call('get_creation_task', identity)).structuredContent.creationTask).toMatchObject({ threadPointer: 'desktop-active-writer', reason: 'USER_DECISION_REQUIRED' });
  await call('respond_creation_task', { ...identity, action: 'continue' });
  await expect.poll(async () => { step = (await call('creation_step', { ...task, action: 'read' })).structuredContent?.step; return Boolean(step); }).toBe(true);
  await call('respond_creation_task', { ...identity, action: 'stop' });
  expect((await call('creation_step', { ...task, action: 'submit', stepId: step.stepId, answer: { ...answer, verificationToken: step.verificationToken } })).isError).toBe(true);
  expect((await call('get_creation_task', identity)).structuredContent.creationTask.status).toBe('stopped');
});


it('当前对话步骤隔离只读面板、接管前结果、错误 token 与另一任务身份', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-direct-control-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const first = createNarracutRequestHandler({ conversation: { threadId: 'direct-first' } }); cleanup.push(first.dispose);
  const second = createNarracutRequestHandler({ conversation: { threadId: 'direct-second' } }); cleanup.push(second.dispose);
  const call = async (handler: typeof first, name: string, args = {}) => await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any;
  const created = (await call(first, 'create_project', { projectDirectory: join(root, '项目') })).structuredContent;
  const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
  const started = (await call(first, 'start_creation_task', { ...identity, instruction: '保留候选，等待审阅' })).structuredContent;
  const task = { ...identity, taskId: started.creationTask.taskId };
  let step: any;
  await expect.poll(async () => { step = (await call(first, 'creation_step', { ...task, action: 'read' })).structuredContent?.step; return Boolean(step); }).toBe(true);
  const answer = { verificationToken: step.verificationToken, action: 'wait', changes: [], summary: '请审阅候选', divergence: '', warnings: [], suggestions: [], reviews: [] };
  expect((await call(first, 'creation_step', { ...task, action: 'submit', stepId: step.stepId, answer: { ...answer, verificationToken: '伪造' } })).isError).toBe(true);
  expect((await call(first, 'creation_step', { ...task, taskId: '00000000-0000-4000-8000-000000000000', action: 'read' })).isError).toBe(true);
  await call(second, 'open_project', identity);
  for (const action of ['read', 'submit']) expect((await call(second, 'creation_step', { ...task, action, ...(action === 'submit' ? { stepId: step.stepId, answer } : {}) })).structuredContent.error.code).toBe('PROJECT_CONTROL_REQUIRED');
  expect((await call(second, 'project_control', { ...identity, action: 'takeover' })).isError).not.toBe(true);
  expect((await call(first, 'creation_step', { ...task, action: 'submit', stepId: step.stepId, answer })).structuredContent.error.code).toBe('PROJECT_CONTROL_REQUIRED');
  expect((await call(second, 'creation_step', { ...task, action: 'submit', stepId: step.stepId, answer })).isError).toBe(true);
  await call(second, 'respond_creation_task', { ...identity, action: 'continue' });
  let next: any;
  await expect.poll(async () => { next = (await call(second, 'creation_step', { ...task, action: 'read' })).structuredContent?.step; return Boolean(next); }).toBe(true);
  expect(next.stepId).not.toBe(step.stepId);
  expect(next.threadId).toBe('direct-second');
  expect((await call(second, 'creation_step', { ...task, action: 'submit', stepId: next.stepId, answer: { ...answer, verificationToken: next.verificationToken } })).isError).not.toBe(true);
  await expect.poll(async () => (await call(second, 'get_creation_task', identity)).structuredContent.creationTask.status).toBe('waiting');
});

it('当前对话显式报告宿主中断，重启保留任务且旧步骤不能在新会话复活', async () => {
  const root = await mkdtemp(join(tmpdir(), 'narracut-direct-restart-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  let handler = createNarracutRequestHandler({ conversation: { threadId: 'restart-direct' } }); cleanup.push(() => handler.dispose());
  const call = async (name: string, args = {}) => await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any;
  const created = (await call('create_project', { projectDirectory: join(root, '项目') })).structuredContent;
  const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
  const started = (await call('start_creation_task', { ...identity, instruction: '检查中断边界' })).structuredContent;
  const task = { ...identity, taskId: started.creationTask.taskId };
  let step: any;
  await expect.poll(async () => { step = (await call('creation_step', { ...task, action: 'read' })).structuredContent?.step; return Boolean(step); }).toBe(true);
  const stopped = await call('creation_step', { ...task, action: 'interrupt', reason: 'CODEX_INTERRUPTED' });
  expect(stopped.structuredContent.creationTask).toMatchObject({ status: 'stopped', reason: 'CODEX_INTERRUPTED' });
  expect((await call('creation_step', { ...task, action: 'read' })).structuredContent.step).toBeNull();
  await handler.dispose();
  handler = createNarracutRequestHandler({ conversation: { threadId: 'restart-direct' } });
  expect((await call('open_project', identity)).structuredContent.creationTask).toMatchObject({ taskId: task.taskId, status: 'stopped', reason: 'APP_RESTARTED' });
  expect((await call('creation_step', { ...task, action: 'read' })).structuredContent.step).toBeNull();
  await call('respond_creation_task', { ...identity, action: 'continue' });
  expect((await call('creation_step', { ...task, action: 'submit', stepId: step.stepId, answer: { verificationToken: step.verificationToken, action: 'wait', changes: [], summary: '旧结果', divergence: '', warnings: [], suggestions: [], reviews: [] } })).isError).toBe(true);
});

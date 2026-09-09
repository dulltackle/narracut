import { parse } from 'yaml';
import { fixture } from './helpers/program-fixture';
import { expect, test, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProjectVNext } from '../src/server/project-lifecycle';
import { createNarracutRequestHandler } from '../plugins/narracut/src/server';
import type { CodexHostAdapter, CodexHostEvent, StartCodexTurnInput } from '../plugins/narracut/src/codex-host';
class Host implements CodexHostAdapter {
  listeners = new Set<(event: CodexHostEvent) => void>();
  turns: (StartCodexTurnInput & { turnId: string })[] = [];
  threads: unknown[] = [];
  subscribe(listener: (event: CodexHostEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async createThread(input: unknown) { this.threads.push(input); return { threadId: `thread-${this.threads.length}` }; }
  async resumeThread(): Promise<{ threadId: string }> { throw new Error('不得自动恢复'); }
  async startTurn(input: StartCodexTurnInput) { const turnId = `turn-${this.turns.length}`; this.turns.push({ ...input, turnId }); return { turnId }; }
  async interruptTurn() {}
  async dispose() {}
  complete(answer: Record<string, unknown>, index = this.turns.length - 1) {
    const turn = this.turns[index]!;
    for (const listener of this.listeners) listener({ type: 'turn-completed', threadId: turn.threadId, turnId: turn.turnId, status: 'completed', output: JSON.stringify({ verificationToken: turn.verificationToken, action: 'wait', changes: [], summary: '请在 Scene 表格确认旁白。', divergence: '', warnings: [], suggestions: [], reviews: [], ...answer }) });
  }
}
async function setup(sceneCount = 0, withProgram = false) {
  const root = await mkdtemp(join(tmpdir(), 'creation-task-')), projectDirectory = join(root, 'project');
  await createProjectVNext(projectDirectory);
  if (sceneCount || withProgram) {
    const request = await fixture();
    const revision = JSON.parse(await readFile(join(projectDirectory, '.narracut/current.json'), 'utf8')).revisionId;
    for (const [file, bytes] of request.program) await writeFile(join(projectDirectory, '.narracut/revisions', revision, 'render-program', file), bytes);
    const lock = parse(request.program.get('pnpm-lock.yaml')!.toString()); const urls = new Map<string, Buffer>();
    for (const [id, value] of Object.entries(lock.packages) as [string, any][]) { const split = id.lastIndexOf('@'), name = id.slice(0, split), version = id.slice(split + 1); urls.set(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, request.offline.get(Buffer.from(value.resolution.integrity.slice(7), 'base64').toString('hex'))!); }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(new Uint8Array(urls.get(url)!))));
  }
  if (sceneCount) await writeFile(join(projectDirectory, 'project.json'), JSON.stringify({ assets: [], scenes: [{ id: '30000000-0000-4000-8000-000000000001', narration: { text: '你好。' }, assetIds: [] }] }));
  const host = new Host(), handler = createNarracutRequestHandler({ codexHost: host });
  const call = async (name: string, args = {}) => await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { projectDirectory, projectId, ...args } } }) as any;
  const projectId = JSON.parse(await readFile(join(projectDirectory, 'narracut.json'), 'utf8')).projectId;
  await call('open_project');
  return { root, projectDirectory, projectId, host, handler, call, close: async () => { await handler.dispose(); await rm(root, { recursive: true, force: true }); vi.unstubAllGlobals(); } };
}
test('MCP 原文创建单任务、唯一写权、专用线程；等待用户与重启不自动动作', async () => {
  const app = await setup();
  try {
    const instruction = '  开场更安静\n保留“原文”与空格  ';
    const [first, duplicate] = await Promise.all([app.call('start_creation_task', { instruction }), app.call('start_creation_task', { instruction })]);
    expect(first.structuredContent.creationTask.instruction).toBe(instruction);
    expect(duplicate.isError).toBe(true);
    await expect.poll(() => app.host.turns.length).toBe(1);
    expect(app.host.threads).toEqual([{ projectDirectory: app.projectDirectory, purpose: 'creation' }]);
    expect(app.host.turns[0]!.prompt).toContain(JSON.stringify(instruction));
    const candidate = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    const blocked = await app.call('manage_project_candidate', { action: 'apply', baseline: candidate.baseline, changes: [{ path: 'resources/unauthorized.txt', content: '非法接管' }] });
    expect(blocked.isError).toBe(true);
    app.host.complete({});
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    app.host.complete({ action: 'apply', changes: [{ path: 'resources/late.txt', content: '迟到' }] });
    expect((await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate.baseline).toBe(candidate.baseline);
    const checkpoint = JSON.parse(await readFile(join(app.projectDirectory, '.narracut/agent-task.json'), 'utf8'));
    expect(Object.keys(checkpoint).sort()).toEqual(['candidateBaseline','inputIdentity','instruction','lastSafeStage','pending','projectId','reason','status','taskId','threadPointer'].sort());
    expect(checkpoint.instruction).toBe(instruction);
    await app.handler.dispose();
    const reopened = createNarracutRequestHandler({ codexHost: app.host });
    try {
      const response = await reopened({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_project', arguments: { projectDirectory: app.projectDirectory } } }) as any;
      expect(response.structuredContent.creationTask).toMatchObject({ taskId: checkpoint.taskId, status: 'stopped', reason: 'APP_RESTARTED', instruction });
      expect(app.host.turns).toHaveLength(1);
    } finally { await reopened.dispose(); }
  } finally { await app.close(); }
});
test('MCP 拒绝旧输入结果，保存用户原文且不覆盖候选或当前修订', async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '让标题更清晰' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    const before = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    const current = await readFile(join(app.projectDirectory, '.narracut/current.json'), 'utf8');
    await writeFile(join(app.projectDirectory, 'video.md'), '# 已变更的目标\n');
    app.host.complete({ action: 'apply', changes: [{ path: 'resources/stale.txt', content: '过期' }] });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('stopped');
    expect((await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate.baseline).toBe(before.baseline);
    expect(await readFile(join(app.projectDirectory, '.narracut/current.json'), 'utf8')).toBe(current);
  } finally { await app.close(); }
});
test('MCP 原子修改小批候选并运行检查；外部候选不能静默接管', async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '补充创作资源' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    const before = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    app.host.complete({ action: 'apply', changes: [{ path: 'resources/goal.txt', content: '保留 Scene 与 Speech 时间' }] });
    await expect.poll(async () => (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate.baseline).not.toBe(before.baseline);
    const after = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    expect(after.checkpoint.identity).toBe(before.candidate.identity);
    expect(await readFile(join(app.projectDirectory, after.candidate.path, 'resources/goal.txt'), 'utf8')).toBe('保留 Scene 与 Speech 时间');
    await expect.poll(() => app.host.turns.length, { timeout: 15000 }).toBe(2);
    expect(app.host.turns[1]!.prompt).toContain('候选检查');
    await writeFile(join(app.projectDirectory, after.candidate.path, 'resources/goal.txt'), '外部修改必须保留');
    app.host.complete({ action: 'apply', changes: [{ path: 'resources/goal.txt', content: '旧线程的覆盖' }] });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    expect((await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED');
    expect(await readFile(join(app.projectDirectory, after.candidate.path, 'resources/goal.txt'), 'utf8')).toBe('外部修改必须保留');
    const another = await app.call('start_creation_task', { instruction: '换目标' });
    expect(another.isError).toBe(true);
  } finally { await app.close(); }
}, 30000);

test('MCP 完整创作交付逐帧读取图像，草稿时间保留且永不自动接受', async () => {
  const app = await setup(1);
  try {
    const pointer = await readFile(join(app.projectDirectory, '.narracut/current.json'), 'utf8');
    await app.call('start_creation_task', { instruction: '检查开场，保留原有表现', parentOrigin: 'http://127.0.0.1:45678' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({ action: 'dependencies' });
    await expect.poll(() => app.host.turns.length, { timeout: 60000 }).toBe(2);
    app.host.complete({ action: 'deliver', summary: '保留开场表现并检查代表帧。' });
    await expect.poll(async () => {
      const state = (await app.call('get_creation_task')).structuredContent.creationTask;
      return state.status !== 'running' ? state.pending : app.host.turns.length;
    }, { timeout: 60000 }).toBe(3);
    const turn = app.host.turns[2]!;
    expect(turn.images?.length, turn.prompt).toBeGreaterThan(0);
    expect(turn.images?.every(image => image.startsWith('data:image/png;base64,'))).toBe(true);
    const refs = JSON.parse(turn.prompt.match(/按顺序对应：(\[.*\])。返回/)![1]!);
    app.host.complete({ action: 'deliver', summary: '保留开场表现并检查代表帧。', warnings: ['缺少 Speech，当前使用 Draft Duration。'], reviews: refs.map((ref: any) => ({ ...ref, observation: '画面文字可见，未越过画布边缘。' })) });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status, { timeout: 30000 }).toBe('waiting');
    const state = (await app.call('get_creation_task')).structuredContent.creationTask;
    expect(state.reason).toBe('CANDIDATE_READY');
    const delivery = (await app.call('project_delivery', { action: 'status' })).structuredContent.delivery;
    expect(delivery.stale).toBe(false);
    expect(delivery.checked).toBe(delivery.frames.length);
    expect(delivery.report.goal).toBe('检查开场，保留原有表现');
    expect(await readFile(join(app.projectDirectory, '.narracut/current.json'), 'utf8')).toBe(pointer);
  } finally { await app.close(); }
}, 90000);

test('MCP 零 Scene 可以交付，明确没有可播放 Scene；没有图像也不伪造帧检查', async () => {
  const app = await setup(0, true);
  try {
    await app.call('start_creation_task', { instruction: '准备空项目表现', parentOrigin: 'http://127.0.0.1:45678' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({ action: 'dependencies' });
    await expect.poll(() => app.host.turns.length, { timeout: 60000 }).toBe(2);
    app.host.complete({ action: 'deliver' });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status, { timeout: 60000 }).toBe('waiting');
    const task = (await app.call('get_creation_task')).structuredContent.creationTask;
    expect(task.reason, task.pending).toBe('CANDIDATE_READY');
    const delivery = (await app.call('project_delivery', { action: 'status' })).structuredContent.delivery;
    expect(delivery.zeroScenes).toBe(true);
    expect(delivery.frames).toEqual([]);
    expect(delivery.report.warnings).toContain('没有可播放 Scene；请在表格工作区添加 Scene。');
  } finally { await app.close(); }
}, 90000);

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
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('running');
    await expect.poll(() => app.host.turns.length).toBe(2);
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
    const external = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    await writeFile(join(app.projectDirectory, external.candidate.path, 'resources/goal.txt'), '再次外部修改');
    const staleResume = await app.call('continue_creation_task', { baseline: external.baseline });
    expect(staleResume.structuredContent.creationTask.status).toBe('waiting');
    const latest = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    const resumed = await app.call('continue_creation_task', { baseline: latest.baseline });
    expect(resumed.structuredContent.creationTask.status).toBe('running');
    expect(resumed.structuredContent.creationTask.taskId).toBe(staleResume.structuredContent.creationTask.taskId);
    expect(await readFile(join(app.projectDirectory, resumed.structuredContent.candidate.candidate.path, 'resources/goal.txt'), 'utf8')).toBe('再次外部修改');
    await expect.poll(() => app.host.turns.length).toBe(3);
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

test('同一任务自动读取连续 Brief 更新，旧 Turn 迟到与普通等待均不能取得写权', async () => {
  const app = await setup();
  try {
    const task = (await app.call('start_creation_task', { instruction: '跟随最新目标' })).structuredContent.creationTask;
    await expect.poll(() => app.host.turns.length).toBe(1);
    await writeFile(join(app.projectDirectory, 'video.md'), '# 第一版\n');
    await expect.poll(() => app.host.turns.length, { timeout: 10000 }).toBe(2);
    await writeFile(join(app.projectDirectory, 'video.md'), '# 第二版\n');
    await expect.poll(() => app.host.turns.length, { timeout: 10000 }).toBe(3);
    app.host.complete({ action: 'apply', changes: [{ path: 'resources/late.txt', content: '迟到' }] }, 0);
    app.host.complete({});
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    expect((await app.call('get_creation_task')).structuredContent.creationTask.taskId).toBe(task.taskId);
    await writeFile(join(app.projectDirectory, 'video.md'), '# 普通等待不恢复\n');
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(app.host.turns).toHaveLength(3);
    const candidate = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    await expect(readFile(join(app.projectDirectory, candidate.candidate.path, 'resources/late.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await app.close(); }
}, 30000);

test('等待 Scene 修改后自动继续同一任务', async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '需要一句旁白' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({ suggestions: [{ sceneId: '新增', observation: '没有旁白', action: '新增', content: '你好', reason: '需要开场' }] });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('SCENE_CHANGE_REQUIRED');
    await writeFile(join(app.projectDirectory, 'project.json'), JSON.stringify({ assets: [], scenes: [{ id: '30000000-0000-4000-8000-000000000001', narration: { text: '你好' }, assetIds: [] }] }));
    await expect.poll(() => app.host.turns.length, { timeout: 10000 }).toBe(2);
    expect(app.host.turns[1]!.prompt).toContain('你好');
  } finally { await app.close(); }
}, 20000);

for (const stage of ['check', 'preview', 'frames', 'deliver'] as const) {
  test(`在 ${stage} 阶段变化使旧证据失效并继续同一任务`, async () => {
    const { ProjectChecks } = await import('../src/server/project-checks');
    const { ProjectPreview } = await import('../src/server/project-preview');
    const { ProjectDelivery } = await import('../src/server/project-delivery');
    const app = await setup(0, true);
    const spies: Array<{ mockRestore(): void }> = [];
    try {
      const initial = (await app.call('start_creation_task', { instruction: '检查最新空项目', parentOrigin: 'http://127.0.0.1:45678' })).structuredContent.creationTask;
      await expect.poll(() => app.host.turns.length).toBe(1);
      app.host.complete({ action: 'dependencies' });
      await expect.poll(() => app.host.turns.length, { timeout: 60000 }).toBe(2);
      const change = () => writeFile(join(app.projectDirectory, 'video.md'), `# ${stage} 阶段的新目标\n`);
      if (stage === 'check') {
        const original = ProjectChecks.prototype.start;
        spies.push(vi.spyOn(ProjectChecks.prototype, 'start').mockImplementationOnce(async function (this: InstanceType<typeof ProjectChecks>, opened) { const result = await original.call(this, opened); await change(); return result; }));
      } else if (stage === 'preview') {
        const original = ProjectPreview.prototype.build;
        spies.push(vi.spyOn(ProjectPreview.prototype, 'build').mockImplementationOnce(async function (this: InstanceType<typeof ProjectPreview>, ...args) { const result = await original.apply(this, args); await change(); return result; }));
      } else {
        const original = ProjectDelivery.prototype.operate;
        let changed = false;
        spies.push(vi.spyOn(ProjectDelivery.prototype, 'operate').mockImplementation(async function (this: InstanceType<typeof ProjectDelivery>, opened, args) {
          if (!changed && args.action === (stage === 'frames' ? 'prepare' : 'describe')) { changed = true; await change(); }
          return original.call(this, opened, args);
        }));
      }
      app.host.complete({ action: 'deliver' });
      await expect.poll(() => app.host.turns.length, { timeout: 60000 }).toBe(3);
      const task = (await app.call('get_creation_task')).structuredContent.creationTask;
      expect(task).toMatchObject({ taskId: initial.taskId, status: 'running', preview: null, deliveryId: null });
      // 输入回退也不能让已经过期的检查和交付证据重新有效。
      await writeFile(join(app.projectDirectory, 'video.md'), '');
      // 交付公开接口同时返回检查批次，确认旧门禁不可用。
      const delivery = (await app.call('project_delivery', { action: 'status' })).structuredContent;
      expect(delivery.checks.batches.at(-1).stale).toBe(true);
      expect(delivery.delivery === null || delivery.delivery.stale).toBe(true);
    } finally { spies.forEach(spy => spy.mockRestore()); await app.close(); }
  }, 90000);
}

test('Asset 原位替换与 Speech 成功持久化均由同一任务读取最新输入', async () => {
  const { createHash } = await import('node:crypto');
  const app = await setup();
  const id = '30000000-0000-4000-8000-000000000001', assetId = '20000000-0000-4000-8000-000000000001';
  try {
    const project = { assets: [{ id: assetId, path: 'assets/reference.txt' }], scenes: [{ id, narration: { text: '你好' }, assetIds: [assetId] }] };
    await writeFile(join(app.projectDirectory, 'assets/reference.txt'), '第一份素材');
    await writeFile(join(app.projectDirectory, 'project.json'), JSON.stringify(project));
    const initial = (await app.call('start_creation_task', { instruction: '跟随媒体内容' })).structuredContent.creationTask;
    await expect.poll(() => app.host.turns.length).toBe(1);
    await writeFile(join(app.projectDirectory, 'assets/reference.txt'), '替换后的素材');
    await expect.poll(() => app.host.turns.length, { timeout: 10000 }).toBe(2);
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { writeProjectTtsConfig, probeSpeechDurationMs } = await import('../src/server/project-speech-vnext');
    const configured = await writeProjectTtsConfig(app.projectDirectory, { provider: 'tokendance', model: 'minimax-speech-2.8-turbo', voice: 'Chinese (Mandarin)_News_Anchor', speed: 1, volume: 1, pitch: 0 });
    const speechPath = `speech/${id}.mp3`, absolute = join(app.projectDirectory, speechPath);
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=32000:cl=mono', '-t', '1', '-c:a', 'libmp3lame', absolute]);
    const bytes = await readFile(absolute);
    const hash = (value: string | Buffer) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
    const speech = { path: speechPath, durationMs: await probeSpeechDurationMs(absolute), sourceTextHash: hash('你好'), ttsProfileId: configured.profileId, audioContentHash: hash(bytes) };
    await writeFile(join(app.projectDirectory, 'project.json'), JSON.stringify({ ...project, scenes: [{ ...project.scenes[0], speech }] }));
    await expect.poll(() => app.host.turns.length, { timeout: 10000 }).toBe(3);
    expect(app.host.turns[2]!.prompt).toContain('"source":"speech"');
    expect((await app.call('get_creation_task')).structuredContent.creationTask.taskId).toBe(initial.taskId);
  } finally { await app.close(); }
}, 30000);

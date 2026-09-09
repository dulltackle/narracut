import { parse } from 'yaml';
import { fixture } from './helpers/program-fixture';
import { expect, test, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProjectVNext } from '../src/server/project-lifecycle';
import { createNarracutRequestHandler } from '../plugins/narracut/src/server';
import { CodexThreadUnavailableError, type CodexHostAdapter, type CodexHostEvent, type StartCodexTurnInput } from '../plugins/narracut/src/codex-host';
class Host implements CodexHostAdapter {
  listeners = new Set<(event: CodexHostEvent) => void>();
  turns: (StartCodexTurnInput & { turnId: string })[] = [];
  threads: unknown[] = [];
  subscribe(listener: (event: CodexHostEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async createThread(input: unknown) { this.threads.push(input); return { threadId: `thread-${this.threads.length}` }; }
  async resumeThread(): Promise<{ threadId: string }> { throw new CodexThreadUnavailableError('thread-1'); }
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
    expect(Object.keys(checkpoint).sort()).toEqual(['candidateBaseline','inputIdentity','instruction','lastSafeStage','pending','suggestions','briefProposal','pendingMessage','projectId','reason','status','taskId','threadPointer','waitingReason','toolApproval'].sort());
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

test('必要 Scene 条件按保存事件核对：部分完成与无关修改不续跑，全部满足仅继续一次', async () => {
  const app = await setup(1);
  try {
    const started = (await app.call('start_creation_task', { instruction: '将开场旁白缩短到五字以内' })).structuredContent.creationTask;
    await expect.poll(() => app.host.turns.length).toBe(1);
    const sceneId = '30000000-0000-4000-8000-000000000001';
    app.host.complete({ suggestions: [{ sceneId, observation: '旁白需要调整', action: '编辑 Narration', content: '你好', reason: '开场紧凑', required: true, condition: { field: 'narration', minLength: 1, maxLength: 2, description: '旁白非空且不超过两字' } }] });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('SCENE_CHANGE_REQUIRED');
    const save = async (text: string) => {
      const { createHash } = await import('node:crypto');
      const baselineRevision = 'sha256:' + createHash('sha256').update(await readFile(join(app.projectDirectory, 'project.json'))).digest('hex');
      return app.call('save_project_scenes', { baselineRevision, project: { assets: [], scenes: [{ id: sceneId, narration: { text }, assetIds: [] }] } });
    };
    await save('这段旁白仍然太长了');
    expect((await app.call('get_creation_task')).structuredContent.creationTask.suggestions[0].satisfied).toBe(false);
    expect(app.host.turns).toHaveLength(1);
    await save('欢迎');
    await expect.poll(() => app.host.turns.length).toBe(2);
    expect((await app.call('get_creation_task')).structuredContent.creationTask.taskId).toBe(started.taskId);
    expect(app.host.turns[1]!.prompt).toContain('欢迎');
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

test('Brief 提案拒绝不续跑、接受核对基线，明确写入指令才允许直写', async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '整理视频的表现方向' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({ action: 'brief', brief: { content: '# 新方向\n安静。', purpose: '整理方向' } });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('BRIEF_REVIEW_REQUIRED');
    const proposal = (await app.call('get_creation_task')).structuredContent.creationTask.briefProposal;
    expect(await readFile(join(app.projectDirectory, 'video.md'), 'utf8')).toBe('');
    await writeFile(join(app.projectDirectory, 'video.md'), '用户的新内容');
    const stale = await app.call('respond_creation_task', { action: 'accept-brief', id: proposal.id });
    expect(stale.structuredContent.creationTask.briefProposal.status).toBe('stale');
    expect(await readFile(join(app.projectDirectory, 'video.md'), 'utf8')).toBe('用户的新内容');
    await app.call('respond_creation_task', { action: 'reject-brief', id: proposal.id });
    expect(app.host.turns).toHaveLength(1);
    await app.call('respond_creation_task', { action: 'continue' });
    await expect.poll(() => app.host.turns.length).toBe(2);
    app.host.complete({ action: 'brief', brief: { content: '# 已审核', purpose: '重拟方向' } });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.briefProposal?.status).toBe('review');
    const current = (await app.call('get_creation_task')).structuredContent.creationTask;
    await app.call('respond_creation_task', { action: 'accept-brief', id: current.briefProposal.id });
    expect(await readFile(join(app.projectDirectory, 'video.md'), 'utf8')).toBe('# 已审核');
  } finally { await app.close(); }
});

test('同一任务只追加确认的混合消息原文，讨论不追加，明确授权 Brief 写入形成完整撤销项', async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '准备开场' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({});
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    await app.call('respond_creation_task', { action: 'message', instruction: '现在怎么样？请将 Brief 改为安静风格。' });
    await expect.poll(() => app.host.turns.length).toBe(2);
    const finish = (answer: any) => {
      const turn = app.host.turns.at(-1)!;
      for (const listener of app.host.listeners) listener({ type: 'turn-completed', threadId: turn.threadId, turnId: turn.turnId, status: 'completed', output: JSON.stringify({ verificationToken: turn.verificationToken, ...answer }) });
    };
    finish({ kind: 'mixed', fragments: ['请将 Brief 改为安静风格。'], reply: '等待确认写入片段。', divergence: 'Brief 原文为空，本次采用安静风格。' });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('INSTRUCTION_CONFIRMATION_REQUIRED');
    let task = (await app.call('get_creation_task')).structuredContent.creationTask;
    expect(task.instruction).toBe('准备开场');
    await app.call('respond_creation_task', { action: 'confirm-message', id: task.pendingMessage.id });
    await expect.poll(() => app.host.turns.length).toBe(3);
    task = (await app.call('get_creation_task')).structuredContent.creationTask;
    expect(task.instruction).toBe('准备开场\n\n请将 Brief 改为安静风格。');
    app.host.complete({ action: 'brief', brief: { content: '安静风格。', purpose: '按原文写入 Brief' } });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('BRIEF_SAVED');
    task = (await app.call('get_creation_task')).structuredContent.creationTask;
    expect(task.briefChange).toMatchObject({ base: '', content: '安静风格。' });
    expect(await readFile(join(app.projectDirectory, 'video.md'), 'utf8')).toBe('安静风格。');
    await app.call('respond_creation_task', { action: 'ack-brief', id: task.briefProposal.id });
    await expect.poll(() => app.host.turns.length).toBe(4);
    app.host.complete({});
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    await app.call('respond_creation_task', { action: 'message', instruction: '谢谢，现在状态如何？' });
    await expect.poll(() => app.host.turns.length).toBe(5);
    finish({ kind: 'discussion', fragments: [], reply: '正在等待用户决定。', divergence: '' });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    expect((await app.call('get_creation_task')).structuredContent.creationTask.instruction).toBe(task.instruction);
  } finally { await app.close(); }
});

test('Scene 无关保存、失败保存、重排删除和停止均不误恢复', async () => {
  const app = await setup(1);
  try {
    const id = '30000000-0000-4000-8000-000000000001';
    await app.call('start_creation_task', { instruction: '旁白用两字开场' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({ suggestions: [{ sceneId: id, observation: '旁白过长', action: '缩短', content: '欢迎', reason: '紧凑', required: true, condition: { field: 'narration', maxLength: 2, description: '最多两字' } }] });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('SCENE_CHANGE_REQUIRED');
    const { createHash } = await import('node:crypto');
    const save = async (scenes: any[], failed = false) => {
      const baselineRevision = 'sha256:' + createHash('sha256').update(await readFile(join(app.projectDirectory, 'project.json'))).digest('hex');
      return app.call('save_project_scenes', { baselineRevision: failed ? 'sha256:' + '0'.repeat(64) : baselineRevision, project: { assets: [], scenes } });
    };
    const other = { id: '30000000-0000-4000-8000-000000000002', narration: { text: '其他 Scene' }, assetIds: [] };
    const target = { id, narration: { text: '你好。' }, assetIds: [] };
    await save([other, target]);
    await new Promise(resolve => setTimeout(resolve, 700)); expect(app.host.turns).toHaveLength(1);
    expect((await save([{ ...target, narration: { text: '欢迎' } }], true)).isError).toBe(true);
    await save([other]);
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.suggestions[0].missing).toBe(true);
    expect(app.host.turns).toHaveLength(1);
    await app.call('respond_creation_task', { action: 'stop' });
    await save([{ ...target, narration: { text: '欢迎' } }, other]);
    await new Promise(resolve => setTimeout(resolve, 700));
    expect((await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('stopped');
    expect(app.host.turns).toHaveLength(1);
  } finally { await app.close(); }
});

for (const instruction of ['请修改候选，保持 Brief 原文不变。', '先整理方案，等我批准后再更新 Brief。', '请解释如何修改 Brief', '请修改 Brief 前先给我看方案。', '请修改 Brief 的建议发给我。']) test(`未明确授权 Brief 直写：${instruction}`, async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({ action: 'brief', brief: { content: '不能直写', purpose: '整理提案' } });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('BRIEF_REVIEW_REQUIRED');
    const task = (await app.call('get_creation_task')).structuredContent.creationTask;
    expect((await app.call('get_creation_task', { action: 'accept-brief', id: task.briefProposal.id })).isError).toBe(true);
    expect(await readFile(join(app.projectDirectory, 'video.md'), 'utf8')).toBe('');
  } finally { await app.close(); }
});

test('分类期间选择仅作讨论会丢弃迟到创作结果', async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '原目标' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({});
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    await app.call('respond_creation_task', { action: 'message', instruction: '开场更短' });
    await expect.poll(() => app.host.turns.length).toBe(2);
    const task = (await app.call('get_creation_task')).structuredContent.creationTask;
    await app.call('respond_creation_task', { action: 'discuss-message', id: task.pendingMessage.id });
    const turn = app.host.turns.at(-1)!;
    for (const listener of app.host.listeners) listener({ type: 'turn-completed', threadId: turn.threadId, turnId: turn.turnId, status: 'completed', output: JSON.stringify({ verificationToken: turn.verificationToken, kind: 'creation', fragments: ['开场更短'], reply: '开始', divergence: '' }) });
    await new Promise(resolve => setTimeout(resolve, 700));
    expect((await app.call('get_creation_task')).structuredContent.creationTask).toMatchObject({ instruction: '原目标', status: 'waiting', pendingMessage: null });
    expect(app.host.turns).toHaveLength(2);
  } finally { await app.close(); }
});

test('必要 Asset 目标允许用户保存不同的可用替代素材', async () => {
  const app = await setup(1);
  try {
    const sceneId = '30000000-0000-4000-8000-000000000001', assetId = '20000000-0000-4000-8000-000000000001';
    await writeFile(join(app.root, 'alternative.txt'), '用户选择的替代素材');
    await app.call('start_creation_task', { instruction: '开场需要参考素材' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({ suggestions: [{ sceneId, observation: '尚无素材', action: '绑定 Asset', content: '建议选择主视觉素材', reason: '完成开场', required: true, condition: { field: 'asset', description: '绑定可用 Asset，可选其他合适素材', anyOf: [] } }] });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('SCENE_CHANGE_REQUIRED');
    const { createHash } = await import('node:crypto');
    const baselineRevision = 'sha256:' + createHash('sha256').update(await readFile(join(app.projectDirectory, 'project.json'))).digest('hex');
    const saved = await app.call('import_project_asset', { baselineRevision, sourcePath: join(app.root, 'alternative.txt'), targetSceneId: sceneId });
    expect(saved.isError, JSON.stringify(saved)).not.toBe(true);
    await expect.poll(() => app.host.turns.length).toBe(2);
    expect(app.host.turns[1]!.prompt).toContain('alternative.txt');
  } finally { await app.close(); }
});

test('可选 Scene 建议只展示，不阻断候选创作也不执行 Scene 修改', async () => {
  const app = await setup(1);
  try {
    const project = await readFile(join(app.projectDirectory, 'project.json'), 'utf8');
    await app.call('start_creation_task', { instruction: '调整开场表现' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({ suggestions: [{ sceneId: '30000000-0000-4000-8000-000000000001', observation: '可更简洁', action: '可选缩短', content: '欢迎', reason: '优化节奏', required: false }] });
    await expect.poll(() => app.host.turns.length).toBe(2);
    const task = (await app.call('get_creation_task')).structuredContent.creationTask;
    expect(task.status).toBe('running'); expect(task.suggestions[0].required).toBe(false);
    expect(await readFile(join(app.projectDirectory, 'project.json'), 'utf8')).toBe(project);
  } finally { await app.close(); }
});

test('混合消息仅作讨论后恢复原 Scene 等待，而非丢失待办', async () => {
  const app = await setup(1);
  try {
    await app.call('start_creation_task', { instruction: '旁白两字以内' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({ suggestions: [{ sceneId: '30000000-0000-4000-8000-000000000001', observation: '长', action: '缩短', content: '欢迎', reason: '紧凑', required: true, condition: { field: 'narration', maxLength: 2, description: '两字以内' } }] });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('SCENE_CHANGE_REQUIRED');
    await app.call('respond_creation_task', { action: 'message', instruction: '有建议吗？开场更短。' });
    await expect.poll(() => app.host.turns.length).toBe(2);
    const turn = app.host.turns.at(-1)!;
    for (const listener of app.host.listeners) listener({ type: 'turn-completed', threadId: turn.threadId, turnId: turn.turnId, status: 'completed', output: JSON.stringify({ verificationToken: turn.verificationToken, kind: 'mixed', fragments: ['开场更短。'], reply: '请确认片段', divergence: '' }) });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('INSTRUCTION_CONFIRMATION_REQUIRED');
    const task = (await app.call('get_creation_task')).structuredContent.creationTask;
    const result = await app.call('respond_creation_task', { action: 'discuss-message', id: task.pendingMessage.id });
    expect(result.structuredContent.creationTask).toMatchObject({ reason: 'SCENE_CHANGE_REQUIRED', status: 'waiting', instruction: '旁白两字以内', pendingMessage: null });
    expect(app.host.turns).toHaveLength(2);
  } finally { await app.close(); }
});

test('停止先撤销写权，回执待核对时禁止写入和重复操作；明确继续恢复原线程', async () => {
  const app = await setup();
  try {
    const started = (await app.call('start_creation_task', { instruction: '保留候选并继续' })).structuredContent.creationTask;
    await expect.poll(() => app.host.turns.length).toBe(1);
    const before = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    let release!: () => void;
    const interrupt = vi.spyOn(app.host, 'interruptTurn').mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const stop = app.call('respond_creation_task', { action: 'stop' });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.operation).toBe('stopping');
    expect((await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('running');
    expect((await app.call('respond_creation_task', { action: 'stop' })).isError).toBe(true);
    app.host.complete({ action: 'apply', changes: [{ path: 'resources/late.txt', content: '禁止迟到写入' }] });
    release();
    expect((await stop).structuredContent.creationTask).toMatchObject({ status: 'stopped', reason: 'USER_STOPPED', operation: null, taskId: started.taskId });
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect((await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate.baseline).toBe(before.baseline);
    const resume = vi.spyOn(app.host, 'resumeThread').mockResolvedValue({ threadId: 'thread-1' });
    const continued = await app.call('respond_creation_task', { action: 'continue' });
    expect(continued.structuredContent.creationTask.taskId).toBe(started.taskId);
    await expect.poll(() => app.host.turns.length).toBe(2);
    expect(resume).toHaveBeenCalledOnce(); expect(app.host.threads).toHaveLength(1);
    expect(app.host.turns[1]!.prompt).toContain('丢弃旧 Turn 未提交修改');
  } finally { await app.close(); }
});

test('停止回执失败保持待核对，重试后可恢复替代线程但 Task ID 不变', async () => {
  const app = await setup();
  try {
    const task = (await app.call('start_creation_task', { instruction: '恢复原任务' })).structuredContent.creationTask;
    await expect.poll(() => app.host.turns.length).toBe(1);
    vi.spyOn(app.host, 'interruptTurn').mockRejectedValueOnce(new Error('连接中断'));
    expect((await app.call('respond_creation_task', { action: 'stop' })).isError).toBe(true);
    expect((await app.call('get_creation_task')).structuredContent.creationTask).toMatchObject({ status: 'running', operation: 'stop-uncertain' });
    expect((await app.call('respond_creation_task', { action: 'continue' })).isError).toBe(true);
    expect((await app.call('respond_creation_task', { action: 'stop' })).structuredContent.creationTask.status).toBe('stopped');
    await app.call('respond_creation_task', { action: 'continue' });
    await expect.poll(() => app.host.turns.length).toBe(2);
    expect((await app.call('get_creation_task')).structuredContent.creationTask).toMatchObject({ taskId: task.taskId, replacementThread: true, threadPointer: 'thread-2' });
  } finally { await app.close(); }
});

test.each(['missing','corrupt','mismatch'])('检查点 %s 不损坏候选，明确接管校验基线、建立新任务并保留候选字节', async mode => {
  const app = await setup();
  let reopened: ReturnType<typeof createNarracutRequestHandler> | undefined;
  try {
    const task = (await app.call('start_creation_task', { instruction: '旧目标' })).structuredContent.creationTask;
    await expect.poll(() => app.host.turns.length).toBe(1);
    await app.call('respond_creation_task', { action: 'stop' });
    const candidate = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    const source = await readFile(join(app.projectDirectory, candidate.candidate.path, 'program.json'));
    const current = await readFile(join(app.projectDirectory, '.narracut/current.json'));
    await app.handler.dispose();
    const path = join(app.projectDirectory, '.narracut/agent-task.json');
    if (mode === 'missing') await rm(path);
    else if (mode === 'corrupt') await writeFile(path, '{');
    else { const checkpoint = JSON.parse(await readFile(path, 'utf8')); checkpoint.candidateBaseline = 'invalid'; await writeFile(path, JSON.stringify(checkpoint)); }
    reopened = createNarracutRequestHandler({ codexHost: app.host });
    const call = async (name: string, args = {}) => await reopened!({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { projectDirectory: app.projectDirectory, projectId: app.projectId, ...args } } }) as any;
    const opened = (await call('open_project')).structuredContent;
    expect(opened.creationRecovery).toMatchObject({ code: 'TASK_CHECKPOINT_INVALID', candidateBaseline: candidate.baseline });
    expect(app.host.turns).toHaveLength(1);
    expect((await call('respond_creation_task', { action: 'continue' })).isError).toBe(true);
    expect((await call('respond_creation_task', { action: 'takeover', instruction: '新目标', baseline: 'old' })).isError).toBe(true);
    expect(app.host.turns).toHaveLength(1);
    const adopted = (await call('respond_creation_task', { action: 'takeover', instruction: '  新目标\n保持原文  ', baseline: candidate.baseline })).structuredContent;
    expect(adopted.creationRecovery).toBeNull();
    expect(adopted.creationTask.taskId).not.toBe(task.taskId);
    expect(adopted.creationTask.instruction).toBe('  新目标\n保持原文  ');
    expect(adopted.candidate.baseline).toBe(candidate.baseline);
    expect(await readFile(join(app.projectDirectory, candidate.candidate.path, 'program.json'))).toEqual(source);
    expect(await readFile(join(app.projectDirectory, '.narracut/current.json'))).toEqual(current);
    await expect.poll(() => app.host.turns.length).toBe(2);
  } finally { await reopened?.dispose(); await app.close(); }
});

test('停止不绕过 Brief 审核，普通消息不能恢复创作；继续重新校验磁盘检查点', async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '更清楚的开场' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({ action: 'brief', brief: { content: '新 Brief', purpose: '待审核方向' } });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    await app.call('respond_creation_task', { action: 'stop' });
    expect((await app.call('respond_creation_task', { action: 'continue' })).isError).toBe(true);
    await app.call('respond_creation_task', { action: 'message', instruction: '目前进度如何？' });
    await expect.poll(() => app.host.turns.length).toBe(2);
    app.host.complete({ kind: 'discussion', fragments: [], reply: '候选和待审核 Brief 已保留', divergence: '' });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('stopped');
    expect(app.host.turns).toHaveLength(2);
    await writeFile(join(app.projectDirectory, '.narracut/agent-task.json'), '{}');
    expect((await app.call('respond_creation_task', { action: 'continue' })).isError).toBe(true);
    expect((await app.call('get_creation_task')).structuredContent.creationRecovery.code).toBe('TASK_CHECKPOINT_INVALID');
  } finally { await app.close(); }
});

test.each(['before','after'])('原子候选提交 %s 停止只承认已完成边界，重启后不自动恢复', async when => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '保存安全成果' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    const before = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    if (when === 'before') await app.call('respond_creation_task', { action: 'stop' });
    app.host.complete({ action: 'apply', changes: [{ path: 'resources/checkpoint.txt', content: '安全成果' }] });
    if (when === 'after') {
      await expect.poll(async () => (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate.baseline).not.toBe(before.baseline);
      await app.call('respond_creation_task', { action: 'stop' });
    }
    const candidate = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    const checkpoint = JSON.parse(await readFile(join(app.projectDirectory, '.narracut/agent-task.json'), 'utf8'));
    expect(checkpoint.status).toBe('stopped'); expect(checkpoint.candidateBaseline).toBe(candidate.baseline);
    expect(checkpoint.lastSafeStage).toBe(when === 'before' ? 'read' : 'modify');
    await app.handler.dispose();
    const reopened = createNarracutRequestHandler({ codexHost: app.host });
    const turns = app.host.turns.length;
    try {
      const result = await reopened({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_project', arguments: { projectDirectory: app.projectDirectory } } }) as any;
      expect(result.structuredContent.creationTask).toMatchObject({ status: 'stopped', reason: 'APP_RESTARTED', lastSafeStage: checkpoint.lastSafeStage });
      expect(result.structuredContent.creationRecovery).toBeNull(); expect(app.host.turns).toHaveLength(turns);
    } finally { await reopened.dispose(); }
  } finally { await app.close(); }
});

test.each(['discuss-message','edit-message'])('分类期间停止后 %s 保持已停止，必须明确继续', async action => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '原目标' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    await app.call('respond_creation_task', { action: 'message', instruction: '当前如何？' });
    await expect.poll(() => app.host.turns.length).toBe(2);
    const stopped = (await app.call('respond_creation_task', { action: 'stop' })).structuredContent.creationTask;
    const result = await app.call('respond_creation_task', { action, id: stopped.pendingMessage.id });
    expect(result.structuredContent.creationTask.status).toBe('stopped');
    expect(app.host.turns).toHaveLength(2);
  } finally { await app.close(); }
});

test('外部候选等待停止后也必须校验任务检查点，专用继续不能修复损坏检查点', async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '原目标' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    const candidate = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    const manifestPath = join(app.projectDirectory, candidate.candidate.path, 'program.json');
    await writeFile(manifestPath, (await readFile(manifestPath, 'utf8')) + '\n');
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED');
    const stopped = (await app.call('respond_creation_task', { action: 'stop' })).structuredContent.creationTask;
    await writeFile(join(app.projectDirectory, '.narracut/agent-task.json'), '{');
    expect((await app.call('continue_creation_task', { baseline: stopped.externalBaseline })).isError).toBe(true);
    expect(await readFile(join(app.projectDirectory, '.narracut/agent-task.json'), 'utf8')).toBe('{');
    expect(app.host.turns).toHaveLength(1);
  } finally { await app.close(); }
});

test('Codex 中断保留检查点与候选，迟到结果和状态读取不自动恢复', async () => {
  const app = await setup();
  try {
    const task = (await app.call('start_creation_task', { instruction: '保存开场' })).structuredContent.creationTask;
    await expect.poll(() => app.host.turns.length).toBe(1);
    const candidate = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    const turn = app.host.turns[0]!;
    for (const listener of app.host.listeners) listener({ type: 'turn-completed', threadId: turn.threadId, turnId: turn.turnId, status: 'interrupted' });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('CODEX_INTERRUPTED');
    app.host.complete({ action: 'apply', changes: [{ path: 'resources/late.txt', content: '未提交修改' }] });
    const stopped = (await app.call('get_creation_task')).structuredContent.creationTask;
    expect(stopped).toMatchObject({ status: 'stopped', taskId: task.taskId, candidateBaseline: candidate.baseline });
    expect((await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate.baseline).toBe(candidate.baseline);
    expect(app.host.turns).toHaveLength(1);
    expect(JSON.parse(await readFile(join(app.projectDirectory, '.narracut/agent-task.json'), 'utf8')).status).toBe('stopped');
  } finally { await app.close(); }
});

test('失效任务明确接管外部候选，只采用用户本次确认的基线并保留最新字节', async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '旧目标' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    await app.call('respond_creation_task', { action: 'stop' });
    const candidate = (await app.call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    const path = join(app.projectDirectory, candidate.candidate.path, 'program.json');
    const content = (await readFile(path, 'utf8')) + '\n'; await writeFile(path, content);
    expect((await app.call('respond_creation_task', { action: 'continue' })).isError).toBe(true);
    expect((await app.call('respond_creation_task', { action: 'takeover', baseline: candidate.baseline, instruction: '新目标' })).isError).toBe(true);
    const recovery = (await app.call('get_creation_task')).structuredContent.creationRecovery;
    const result = await app.call('respond_creation_task', { action: 'takeover', baseline: recovery.candidateBaseline, instruction: '新目标' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.candidate.status).toBe('saved');
    expect(await readFile(join(app.projectDirectory, result.structuredContent.candidate.candidate.path, 'program.json'), 'utf8')).toBe(content);
  } finally { await app.close(); }
});

test('无法识别的失效任务在用户放弃候选后清除恢复入口，允许开始新任务', async () => {
  const app = await setup();
  let reopened: ReturnType<typeof createNarracutRequestHandler> | undefined;
  try {
    await app.call('start_creation_task', { instruction: '旧任务' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    await app.call('respond_creation_task', { action: 'stop' });
    await app.handler.dispose();
    await writeFile(join(app.projectDirectory, '.narracut/agent-task.json'), '{');
    reopened = createNarracutRequestHandler({ codexHost: app.host });
    const call = async (name: string, args = {}) => await reopened!({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { projectDirectory: app.projectDirectory, projectId: app.projectId, ...args } } }) as any;
    const opened = (await call('open_project')).structuredContent;
    await call('manage_project_candidate', { action: 'discard', baseline: opened.candidate.baseline, confirmed: true });
    expect((await call('get_creation_task')).structuredContent.creationRecovery).toBeNull();
    expect((await call('start_creation_task', { instruction: '新任务' })).isError).not.toBe(true);
  } finally { await reopened?.dispose(); await app.close(); }
});

test('恢复遇到额度错误保留原线程与检查点，不创建替代线程或后台重试', async () => {
  const app = await setup();
  try {
    const task = (await app.call('start_creation_task', { instruction: '恢复时保留成果' })).structuredContent.creationTask;
    await expect.poll(() => app.host.turns.length).toBe(1);
    await app.call('respond_creation_task', { action: 'stop' });
    vi.spyOn(app.host, 'resumeThread').mockRejectedValue(Object.assign(new Error('额度受限'), { code: 'CODEX_USAGE_LIMIT' }));
    await app.call('respond_creation_task', { action: 'continue' });
    expect((await app.call('get_creation_task')).structuredContent.creationTask).toMatchObject({ taskId: task.taskId, status: 'stopped', reason: 'CODEX_USAGE_LIMIT', threadPointer: 'thread-1', replacementThread: false });
    expect(app.host.threads).toHaveLength(1);
    expect(app.host.turns).toHaveLength(1);
  } finally { await app.close(); }
});

test.each(['CODEX_USAGE_LIMIT', 'CODEX_AUTH_REQUIRED', 'CODEX_UNAVAILABLE', 'CODEX_INTERRUPTED'])('宿主以 %s 停止时即使项目输入变化也不后台重试', async reason => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '处理外部停止' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    await writeFile(join(app.projectDirectory, 'video.md'), '# 最新目标');
    const turn = app.host.turns[0]!;
    for (const listener of app.host.listeners) listener({ type: 'turn-completed', threadId: turn.threadId, turnId: turn.turnId, status: 'failed', error: reason });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe(reason);
    expect(app.host.turns).toHaveLength(1);
    expect((await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('stopped');
  } finally { await app.close(); }
});

test('另一工作台打开项目自动接管同一任务，旧端与迟到回调失去写权', async () => {
  const app = await setup();
  const host = new Host(), other = createNarracutRequestHandler({ codexHost: host });
  const call = async (name: string, args = {}) => await other({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: { projectDirectory: app.projectDirectory, projectId: app.projectId, ...args } } }) as any;
  try {
    const task = (await app.call('start_creation_task', { instruction: '跨线程继续同一目标' })).structuredContent.creationTask;
    await expect.poll(() => app.host.turns.length).toBe(1);
    const interrupted = vi.spyOn(app.host, 'interruptTurn');
    const opened = await call('open_project');
    expect(opened.isError).not.toBe(true);
    await expect.poll(() => host.turns.length).toBe(1);
    expect((await call('get_creation_task')).structuredContent.creationTask).toMatchObject({ taskId: task.taskId, status: 'running', transferred: false, connectionNotice: 'taken-over' });
    expect(interrupted).toHaveBeenCalledOnce();
    expect((await app.call('get_creation_task')).structuredContent.creationTask.transferred).toBe(true);
    expect((await app.call('respond_creation_task', { action: 'stop' })).isError).toBe(true);
    app.host.complete({ action: 'apply', changes: [{ path: 'resources/late.txt', content: '迟到写入' }] });
    host.complete({ action: 'wait' });
    await expect.poll(async () => (await call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    const candidate = (await call('manage_project_candidate', { action: 'read' })).structuredContent.candidate;
    await expect(readFile(join(app.projectDirectory, candidate.candidate.path, 'resources/late.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await other.dispose(); await app.close(); }
});

test('工具审批暂停 Agent，只有匹配批准恢复；主动停止后的批准不隐式运行', async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '等待具体工具批准' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    const turn = app.host.turns[0]!;
    const emit = (event: any) => { for (const listener of app.host.listeners) listener(event); };
    emit({ type: 'approval-required', threadId: turn.threadId, turnId: turn.turnId, approvalId: 'approval-1', summary: '读取当前候选源码' });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('TOOL_APPROVAL_REQUIRED');
    expect((await app.call('respond_creation_task', { action: 'continue' })).isError).toBe(true);
    emit({ type: 'approval-resolved', threadId: turn.threadId, turnId: turn.turnId, approvalId: 'wrong', approved: true });
    expect((await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    emit({ type: 'approval-resolved', threadId: turn.threadId, turnId: turn.turnId, approvalId: 'approval-1', approved: true });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('running');
    expect(app.host.turns).toHaveLength(1);
    emit({ type: 'approval-required', threadId: turn.threadId, turnId: turn.turnId, approvalId: 'approval-2', summary: '再次读取候选' });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    await app.call('respond_creation_task', { action: 'stop' });
    emit({ type: 'approval-resolved', threadId: turn.threadId, turnId: turn.turnId, approvalId: 'approval-2', approved: true });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.waitingReason).toBe(null);
    expect((await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('stopped');
    expect(app.host.turns).toHaveLength(1);
  } finally { await app.close(); }
});

test.each(['stopped', 'waiting'])('跨工作台接管保持 %s，不启动 Agent 或绕过待办', async status => {
  const app = await setup();
  const host = new Host(), other = createNarracutRequestHandler({ codexHost: host });
  try {
    await app.call('start_creation_task', { instruction: '保留等待与停止条件' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    if (status === 'stopped') await app.call('respond_creation_task', { action: 'stop' });
    else { app.host.complete({ action: 'wait' }); await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting'); }
    const result = await other({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_project', arguments: { projectDirectory: app.projectDirectory } } }) as any;
    expect(result.structuredContent.creationTask).toMatchObject({ status, reason: status === 'stopped' ? 'USER_STOPPED' : 'USER_DECISION_REQUIRED', connectionNotice: 'taken-over' });
    expect(host.turns).toHaveLength(0);
  } finally { await other.dispose(); await app.close(); }
});

test('交接中断回执不明不释放旧租约，重试交接后仅有一个新驱动', async () => {
  const app = await setup();
  const host = new Host(), other = createNarracutRequestHandler({ codexHost: host });
  const open = () => other({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_project', arguments: { projectDirectory: app.projectDirectory } } }) as Promise<any>;
  try {
    await app.call('start_creation_task', { instruction: '等待交接核对' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    vi.spyOn(app.host, 'interruptTurn').mockRejectedValueOnce(new Error('中断回执丢失'));
    const failed = await open();
    expect(failed.isError).toBe(true); expect(failed.structuredContent.error.message).toContain('线程连接结果待核对');
    expect(host.threads).toHaveLength(0);
    app.host.complete({ action: 'apply', changes: [{ path: 'resources/revoked.txt', content: '不应提交' }] });
    expect((await open()).isError).not.toBe(true);
    await expect.poll(() => host.turns.length).toBe(1);
    expect((await app.call('get_creation_task')).structuredContent.creationTask.transferred).toBe(true);
  } finally { await other.dispose(); await app.close(); }
});

test('连续三轮没有持久成果按固定 NO_PROGRESS 停止，明确继续后重新尝试', async () => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '产生持久成果' });
    for (let index = 0; index < 3; index++) {
      await expect.poll(() => app.host.turns.length).toBe(index + 1);
      app.host.complete({ action: 'apply', changes: [] });
    }
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('NO_PROGRESS');
    expect(app.host.turns).toHaveLength(3);
    vi.spyOn(app.host, 'resumeThread').mockResolvedValue({ threadId: 'thread-1' });
    await app.call('respond_creation_task', { action: 'continue' });
    await expect.poll(() => app.host.turns.length).toBe(4);
  } finally { await app.close(); }
});

test('必需 Scene 条件未满足时明确继续仍等待，不借恢复或改绑启动 Agent', async () => {
  const app = await setup(1);
  try {
    await app.call('start_creation_task', { instruction: '等待必要旁白修改' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    app.host.complete({ action: 'wait', suggestions: [{ sceneId: '30000000-0000-4000-8000-000000000001', action: '修改旁白', observation: '缺少结尾', content: '请补充结尾', reason: '需要结尾', required: true, condition: { field: 'narration', minLength: 1, maxLength: 4000, anyOf: ['感谢观看'], description: '旁白包含感谢观看' } }] });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.reason).toBe('SCENE_CHANGE_REQUIRED');
    await app.call('respond_creation_task', { action: 'stop' });
    await app.call('respond_creation_task', { action: 'continue' });
    expect((await app.call('get_creation_task')).structuredContent.creationTask).toMatchObject({ status: 'waiting', reason: 'SCENE_CHANGE_REQUIRED' });
    expect(app.host.turns).toHaveLength(1);
  } finally { await app.close(); }
});

test.each(['declined', 'failed', 'thread-lost'])('审批期间 %s 中断原驱动并清理失效等待', async eventKind => {
  const app = await setup();
  try {
    await app.call('start_creation_task', { instruction: '审批失败保留成果' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    const turn = app.host.turns[0]!, interrupt = vi.spyOn(app.host, 'interruptTurn');
    const emit = (event: any) => { for (const listener of app.host.listeners) listener(event); };
    emit({ type: 'approval-required', threadId: turn.threadId, turnId: turn.turnId, approvalId: 'approval', summary: '读取候选' });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('waiting');
    const event = eventKind === 'declined' ? { type: 'approval-resolved', approvalId: 'approval', approved: false } : eventKind === 'failed' ? { type: 'turn-completed', status: 'failed', error: 'CODEX_USAGE_LIMIT' } : { type: 'thread-unavailable' };
    emit({ ...event, threadId: turn.threadId, turnId: turn.turnId });
    await expect.poll(async () => (await app.call('get_creation_task')).structuredContent.creationTask.status).toBe('stopped');
    expect((await app.call('get_creation_task')).structuredContent.creationTask).toMatchObject({ reason: eventKind === 'failed' ? 'CODEX_USAGE_LIMIT' : eventKind === 'thread-lost' ? 'CODEX_THREAD_UNAVAILABLE' : 'CODEX_INTERRUPTED', toolApproval: null, waitingReason: null });
    expect(interrupt).toHaveBeenCalledWith({ threadId: turn.threadId, turnId: turn.turnId });
  } finally { await app.close(); }
});

test('停止任务的消息分类遇到跨工作台接管时保留停止与原文，不启动创作', async () => {
  const app = await setup(), host = new Host(), other = createNarracutRequestHandler({ codexHost: host });
  try {
    await app.call('start_creation_task', { instruction: '保留原目标' });
    await expect.poll(() => app.host.turns.length).toBe(1);
    await app.call('respond_creation_task', { action: 'stop' });
    await app.call('respond_creation_task', { action: 'message', instruction: '现在进展如何？' });
    await expect.poll(() => app.host.turns.length).toBe(2);
    const result = await other({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'open_project', arguments: { projectDirectory: app.projectDirectory } } }) as any;
    expect(result.structuredContent.creationTask).toMatchObject({ status: 'stopped', reason: 'USER_STOPPED', pendingMessage: { original: '现在进展如何？' } });
    expect(host.turns).toHaveLength(0);
  } finally { await other.dispose(); await app.close(); }
});

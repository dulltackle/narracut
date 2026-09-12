import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlledCreationHost } from '../helpers/controlled-creation-host';
import { startWorkbenchPanel } from '../../plugins/narracut/src/workbench-panel';

test('同步失败隔离旧页面，重试期间不显示旧权限，迟到响应不能覆盖新状态', async ({ page }) => {
  const panel = await startWorkbenchPanel({ threadId: 'reconnect-race' });
  let release!: () => void;
  let requests = 0;
  try {
    await page.route(`${panel.url}state`, async route => {
      requests++;
      if (requests === 1) {
        await new Promise<void>(resolve => { release = resolve; });
        await route.fulfill({ json: { structuredContent: { status: 'launcher' } } }).catch(() => {});
      } else await route.continue();
    });
    await page.clock.install();
    await page.goto(panel.url);
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByText('正在同步最新项目与任务状态…', { exact: true })).toBeVisible();
    await expect(page.locator('iframe')).toHaveAttribute('inert', '');
    await page.clock.fastForward(16000);
    await expect(page.locator('#feedback')).toContainText('任务状态尚未核实');
    await page.getByRole('button', { name: '重试显示工作台' }).click();
    await expect(page.frameLocator('iframe').getByRole('button', { name: '选择项目文件夹', exact: true })).toBeVisible();
    await expect(page.locator('#feedback')).toBeHidden();
    release();
    await expect(page.locator('iframe')).not.toHaveAttribute('inert');
    await expect(page.frameLocator('iframe').getByText('已关联当前对话 · 查看详情')).toBeVisible();
  } finally { release?.(); await page.close(); await panel.close(); }
});

test('销毁面板后同一任务提交持久成果，新页面同步且跨对话重开保持只读', async ({ page, context, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'panel-persist-'));
  const host = new ControlledCreationHost();
  const panel = await startWorkbenchPanel({ threadId: 'persist-owner', codexHost: host });
  const viewer = await startWorkbenchPanel({ threadId: 'persist-viewer' });
  const call = async (target: typeof panel, name: string, args = {}) => {
    const response = await request.post(`${target.url}rpc`, { headers: { Origin: new URL(target.url).origin }, data: { id: 1, method: 'tools/call', params: { name, arguments: args } } });
    const result = (await response.json()).result;
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return result.structuredContent;
  };
  let reopened, other;
  try {
    const created = await call(panel, 'create_project', { projectDirectory: join(root, '关闭期间创作') });
    const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
    const started = await call(panel, 'start_creation_task', { ...identity, instruction: '关闭面板后继续保存候选' });
    await expect.poll(() => host.turns.length).toBe(1);
    await page.goto(panel.url);
    await page.frameLocator('iframe').getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(page.frameLocator('iframe').getByText('关闭面板后，任务仍会继续。需保持应用与 Codex 任务运行。')).toBeVisible();
    await page.close();
    expect(host.interruptions).toBe(0);
    host.complete([{ path: 'resources/closed-panel.txt', content: '关闭期间的原子成果' }]);
    await expect.poll(async () => {
      const state = await call(panel, 'get_creation_task', identity);
      return state.creationTask.status === 'running' ? host.turns.length : state.creationTask;
    }, { timeout: 20000 }).toBe(2);
    const latest = await call(panel, 'get_workbench');
    expect(latest.creationTask).toMatchObject({ taskId: started.creationTask.taskId, status: 'running' });
    expect(latest.candidate.baseline).not.toBe(started.candidate.baseline);
    const candidatePath = join(identity.projectDirectory, latest.candidate.candidate.path, 'resources/closed-panel.txt');
    expect(await readFile(candidatePath, 'utf8')).toBe('关闭期间的原子成果');
    expect(JSON.parse(await readFile(join(identity.projectDirectory, '.narracut/agent-task.json'), 'utf8'))).toMatchObject({ taskId: started.creationTask.taskId, candidateBaseline: latest.candidate.baseline });
    reopened = await context.newPage();
    const synchronized = reopened.waitForResponse(`${panel.url}state`);
    await reopened.goto(panel.url);
    const incoming = (await (await synchronized).json()).structuredContent;
    expect(incoming.project.projectId).toBe(identity.projectId);
    expect(incoming.creationTask.taskId).toBe(started.creationTask.taskId);
    expect(incoming.candidate.baseline).toBe(latest.candidate.baseline);
    expect(incoming.control.status).toBe('editable');
    const app = reopened.frameLocator('iframe');
    await app.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(app.locator('[data-agent-content]')).toContainText('运行中');
    await app.getByText('当前创作指令与任务详情', { exact: true }).click();
    await expect(app.locator('[data-agent-content]')).toContainText(started.creationTask.taskId);
    await expect(app.getByText('当前对话可编辑', { exact: true })).toBeVisible();
    for (const width of [1440, 390]) {
      await reopened.setViewportSize({ width, height: 900 });
      expect(await app.locator('body').evaluate(body => body.scrollWidth <= innerWidth)).toBe(true);
      await reopened.screenshot({ path: `/tmp/narracut-98-running-${width}.png` });
    }
    await call(viewer, 'open_project', identity);
    other = await context.newPage(); await other.goto(viewer.url);
    const readonly = other.frameLocator('iframe');
    await expect(readonly.getByText('只读 · 项目由另一对话控制', { exact: true })).toBeVisible();
    await readonly.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(readonly.locator('[data-task-action="stop"]').first()).toBeDisabled();
    await expect(readonly.getByRole('button', { name: '放弃候选', exact: true })).toBeDisabled();
    expect((await call(panel, 'get_workbench')).control.status).toBe('editable');
    expect(host.turns).toHaveLength(2); expect(host.interruptions).toBe(0);
    // Codex 中断是停止事件；关闭页面并不是。
    host.interrupt();
    await expect.poll(async () => (await call(panel, 'get_creation_task', identity)).creationTask.reason).toBe('CODEX_INTERRUPTED');
    await reopened.close(); reopened = await context.newPage(); await reopened.goto(panel.url);
    await reopened.frameLocator('iframe').getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(reopened.frameLocator('iframe').locator('[data-agent-content]')).toContainText('已停止 · Codex 已中断');
    expect(await readFile(candidatePath, 'utf8')).toBe('关闭期间的原子成果');
    expect(host.turns).toHaveLength(2);
  } finally { await reopened?.close(); await other?.close(); await viewer.close(); await panel.close(); await rm(root, { recursive: true, force: true }); }
});

test('显式停止、服务退出与任务终结在新页面呈现各自结果，不自动继续', async ({ page, context, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'panel-lifecycle-'));
  const host = new ControlledCreationHost();
  let panel = await startWorkbenchPanel({ threadId: 'lifecycle-owner', codexHost: host });
  const call = async (name: string, args = {}) => {
    const response = await request.post(`${panel.url}rpc`, { headers: { Origin: new URL(panel.url).origin }, data: { id: 1, method: 'tools/call', params: { name, arguments: args } } });
    const result = (await response.json()).result; expect(result.isError, JSON.stringify(result)).not.toBe(true); return result.structuredContent;
  };
  let current = page;
  const reopen = async (label: string) => {
    await current.close(); current = await context.newPage(); await current.goto(panel.url);
    await current.frameLocator('iframe').getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(current.frameLocator('iframe').locator('[data-agent-content]')).toContainText(label);
  };
  try {
    const created = await call('create_project', { projectDirectory: join(root, '生命周期') });
    const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
    await reopen('尚无任务');
    const started = await call('start_creation_task', { ...identity, instruction: '核对停止边界' });
    await expect.poll(() => host.turns.length).toBe(1);
    await call('respond_creation_task', { ...identity, action: 'stop' });
    await reopen('已停止 · 你已停止任务');
    expect((await call('get_creation_task', identity)).creationTask.taskId).toBe(started.creationTask.taskId);
    expect(host.turns).toHaveLength(1);
    await call('respond_creation_task', { ...identity, action: 'continue' });
    await expect.poll(() => host.turns.length).toBe(2);
    await current.close(); await panel.close();
    panel = await startWorkbenchPanel({ threadId: 'lifecycle-owner', codexHost: host });
    const opened = await call('open_project', identity);
    expect(opened.creationTask).toMatchObject({ taskId: started.creationTask.taskId, status: 'stopped', reason: 'APP_RESTARTED' });
    await reopen('已停止 · 应用已重启');
    expect(host.turns).toHaveLength(2);
    await call('manage_project_candidate', { ...identity, action: 'discard', baseline: opened.candidate.baseline, confirmed: true });
    await reopen('已终结');
    const ended = await call('get_workbench');
    expect(ended.candidate.status).toBe('absent');
    expect(ended.creationTask).toMatchObject({ taskId: started.creationTask.taskId, status: 'terminated' });
    expect(host.turns).toHaveLength(2);
  } finally { await current.close(); await panel.close(); await rm(root, { recursive: true, force: true }); }
});

test('候选就绪重开直接呈现审阅状态，重试同步前没有可编辑内容', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'panel-ready-'));
  const host = new ControlledCreationHost();
  const panel = await startWorkbenchPanel({ threadId: 'ready-owner', codexHost: host });
  let release!: () => void;
  let reads = 0;
  const call = async (name: string, args = {}) => (await (await request.post(`${panel.url}rpc`, { headers: { Origin: new URL(panel.url).origin }, data: { id: 1, method: 'tools/call', params: { name, arguments: args } } })).json()).result.structuredContent;
  try {
    const created = await call('create_project', { projectDirectory: join(root, '候选就绪') });
    const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
    await call('start_creation_task', { ...identity, instruction: '展示已就绪候选' });
    await expect.poll(() => host.turns.length).toBe(1);
    await call('respond_creation_task', { ...identity, action: 'stop' });
    const snapshot = await call('get_workbench');
    // 仅核对就绪状态的呈现；交付门禁与真实候选就绪在 creation-task / candidate-delivery 套件验证。
    snapshot.creationTask = { ...snapshot.creationTask, status: 'waiting', reason: 'CANDIDATE_READY', pending: '候选已就绪，请审阅。' };
    const observed: string[] = [];
    await page.route(`${panel.url}rpc`, async route => {
      const input = route.request().postDataJSON(); observed.push(input.params.name);
      if (input.params.name === 'get_creation_task') return route.fulfill({ json: { id: input.id, result: { structuredContent: { creationTask: snapshot.creationTask, candidate: snapshot.candidate } } } });
      return route.continue();
    });
    await page.route(`${panel.url}state`, async route => {
      if (++reads === 1) return route.fulfill({ status: 503, json: { error: { message: '测试：最新状态读取失败' } } });
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: { structuredContent: snapshot } });
    });
    await page.goto(panel.url);
    await expect(page.locator('#feedback')).toContainText('任务状态尚未核实');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `/tmp/narracut-98-failure-${width}.png` });
      expect(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole('button', { name: '重试显示工作台' }).click();
    await expect.poll(() => reads).toBe(2);
    await expect(page.getByText('正在同步最新项目与任务状态…', { exact: true })).toBeVisible();
    await expect(page.locator('iframe')).toHaveAttribute('inert', '');
    await expect(page.frameLocator('iframe').getByText('当前对话可编辑', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: '/tmp/narracut-98-sync-390.png' });
    release();
    const app = page.frameLocator('iframe');
    await app.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(app.locator('[data-agent-content]')).toContainText('候选已就绪');
    await expect(app.locator('[data-final-render]')).toBeVisible();
    expect(observed.some(name => ['start_creation_task', 'respond_creation_task', 'open_project', 'project_control'].includes(name))).toBe(false);
    expect(host.turns).toHaveLength(1);
  } finally { release?.(); await page.close(); await panel.close(); await rm(root, { recursive: true, force: true }); }
});

test('编辑中断连保留原页面与内容，重连核对后手动重试写入原 Scene', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'panel-edit-reconnect-'));
  const panel = await startWorkbenchPanel({ threadId: 'edit-reconnect' });
  const call = async (name: string, args = {}) => (await (await request.post(`${panel.url}rpc`, {
    headers: { Origin: new URL(panel.url).origin }, data: { id: 1, method: 'tools/call', params: { name, arguments: args } },
  })).json()).result.structuredContent;
  try {
    const created = await call('create_project', { projectDirectory: join(root, '断连编辑') });
    await page.goto(panel.url);
    const app = page.frameLocator('iframe');
    await app.getByRole('button', { name: '新增第一个 Scene' }).click();
    const editor = app.getByRole('textbox', { name: 'Scene 01 Narration' });
    await editor.fill('已经保存'); await editor.blur();
    await expect.poll(async () => (await call('get_workbench')).scenes[0]?.narration).toBe('已经保存');
    const id = (await call('get_workbench')).scenes[0].id;
    await editor.fill('断连期间保留的完整旁白');
    await page.route(`${panel.url}rpc`, route => {
      if (route.request().postDataJSON().params.name === 'get_workbench') return route.fulfill({ status: 503, json: { error: { message: '测试：连接暂时中断' } } });
      return route.continue();
    });
    await expect(app.getByRole('region', { name: '保存与连接状态' })).toContainText('最后确认状态');
    await expect(editor).toHaveValue('断连期间保留的完整旁白');
    await expect(editor).toHaveJSProperty('readOnly', true);
    await app.getByRole('tab', { name: 'Agent 工作区' }).click();
    await app.getByRole('tab', { name: '表格工作区' }).click();
    await expect(editor).toHaveValue('断连期间保留的完整旁白');
    await page.unroute(`${panel.url}rpc`);
    await app.getByRole('button', { name: '重新连接', exact: true }).click();
    await expect(app.getByRole('button', { name: '重试保存', exact: true })).toBeEnabled();
    expect((await call('get_workbench')).scenes[0].narration).toBe('已经保存');
    await app.getByRole('button', { name: '重试保存', exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(created.project.directory, 'project.json'), 'utf8')).scenes[0]).toMatchObject({ id, narration: { text: '断连期间保留的完整旁白' } });
  } finally { await page.close(); await panel.close(); await rm(root, { recursive: true, force: true }); }
});

import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorkbenchPanel } from '../../plugins/narracut/src/workbench-panel';

test('公开工作台只提供候选审阅，停止任务不出现继续或新目标创作入口', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'candidate-review-'));
  const panel = await startWorkbenchPanel({ threadId: 'review-conversation' });
  const call = async (name: string, args = {}) => (await (await page.request.post(`${panel.url}rpc`, {
    headers: { Origin: new URL(panel.url).origin }, data: { id: 1, method: 'tools/call', params: { name, arguments: args } },
  })).json()).result;
  try {
    const result = await call('create_project', { projectDirectory: join(root, '候选审阅') });
    const identity = { projectDirectory: result.structuredContent.project.directory, projectId: result.structuredContent.project.projectId };
    await call('start_creation_task', { ...identity, instruction: '保留暗房视觉，检查候选。' });
    await page.goto(panel.url);
    const app = page.frameLocator('iframe');
    await app.getByRole('tab', { name: 'Agent 工作区' }).click();
    if (!await app.getByRole('button', { name: '关闭审阅详情' }).isVisible()) await app.getByRole('button', { name: '审阅详情', exact: true }).click();
    // 生产接入现在能够运行；通过用户停止入口建立本场景的已停止状态。
    await expect(app.locator('[data-agent-content]')).toContainText('运行中');
    await app.getByRole('button', { name: '停止任务', exact: true }).click();
    await expect(app.locator('[data-agent-content]')).toContainText('已停止');
    await expect(app.locator('[data-preview-screen]')).toBeHidden();
    await page.screenshot({ path: '/tmp/review-stopped-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/review-stopped-mobile.png' });
    await expect(app.getByRole('textbox', { name: 'Composer', exact: true })).toHaveCount(0);
    await expect(app.getByRole('button', { name: /继续任务|开始创作|新目标接管|开始新任务/ })).toHaveCount(0);
    await expect(app.locator('[data-agent-content]')).toContainText('当前 Codex 对话');
  } finally { await page.close(); await panel.close(); await rm(root, { recursive: true, force: true }); }
});

test('公开面板只读禁用候选决策，服务端拒绝接受和放弃，切换保留 Scene', async ({ page, context }) => {
  const root = await mkdtemp(join(tmpdir(), 'candidate-review-control-'));
  const owner = await startWorkbenchPanel({ threadId: 'review-owner' });
  const viewer = await startWorkbenchPanel({ threadId: 'review-viewer' });
  const other = await context.newPage();
  const call = async (panel: typeof owner, name: string, args = {}) => (await (await page.request.post(`${panel.url}rpc`, {
    headers: { Origin: new URL(panel.url).origin }, data: { id: 1, method: 'tools/call', params: { name, arguments: args } },
  })).json()).result;
  try {
    const created = (await call(owner, 'create_project', { projectDirectory: join(root, '只读候选') })).structuredContent;
    const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
    await call(owner, 'manage_project_candidate', { ...identity, action: 'create' });
    await page.goto(owner.url);
    const app = page.frameLocator('iframe');
    await app.getByRole('button', { name: '新增第一个 Scene' }).click();
    await app.getByRole('textbox', { name: 'Scene 01 Narration' }).fill('保留 Scene 内容');
    await app.getByRole('textbox', { name: 'Scene 01 Narration' }).blur();
    await expect.poll(async () => (await call(owner, 'get_workbench')).structuredContent.scenes[0]?.narration).toBe('保留 Scene 内容');
    await call(viewer, 'open_project', identity); await other.goto(viewer.url);
    const readonly = other.frameLocator('iframe');
    await readonly.getByRole('tab', { name: 'Agent 工作区' }).click();
    if (!await readonly.getByRole('button', { name: '关闭审阅详情' }).isVisible()) await readonly.getByRole('button', { name: '审阅详情', exact: true }).click();
    await expect(readonly.getByRole('button', { name: '审阅并接受', exact: true })).toBeDisabled();
    await expect(readonly.getByRole('button', { name: '放弃候选', exact: true })).toBeDisabled();
    for (const [name, args] of [['project_acceptance', { action: 'review' }], ['manage_project_candidate', { action: 'discard' }]] as const) {
      const denied = await call(viewer, name, { ...identity, ...args });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent.error.code).toBe('PROJECT_CONTROL_REQUIRED');
    }
    await app.getByRole('tab', { name: 'Agent 工作区' }).click();
    if (!await app.getByRole('button', { name: '关闭审阅详情' }).isVisible()) await app.getByRole('button', { name: '审阅详情', exact: true }).click();
    await expect(app.getByRole('button', { name: '放弃候选', exact: true })).toBeEnabled();
    await app.getByRole('tab', { name: '表格工作区' }).click();
    await expect(app.locator('[data-scene-row]').first()).toHaveAttribute('data-selected', 'true');
    await expect(app.getByRole('textbox', { name: 'Scene 01 Narration' })).toHaveValue('保留 Scene 内容');
    await app.getByRole('tab', { name: 'Agent 工作区' }).click();
    if (!await app.getByRole('button', { name: '关闭审阅详情' }).isVisible()) await app.getByRole('button', { name: '审阅详情', exact: true }).click();
    await app.getByRole('button', { name: '放弃候选', exact: true }).click();
    await expect(app.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await app.getByRole('button', { name: '放弃候选并终结任务', exact: true }).click();
    await expect(app.locator('.candidate-save')).toContainText('尚无候选');
    expect((await call(owner, 'get_workbench')).structuredContent.scenes[0].narration).toBe('保留 Scene 内容');
  } finally { await page.close(); await other.close(); await viewer.close(); await owner.close(); await rm(root, { recursive: true, force: true }); }
});

test('停止与放弃回执丢失时只查询结果，保留或消费真实持久成果', async ({ page }) => {
  const { readFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'decision-receipts-'));
  const panel = await startWorkbenchPanel({ threadId: 'decision-receipts' });
  const call = async (name: string, args = {}) => (await (await page.request.post(`${panel.url}rpc`, {
    headers: { Origin: new URL(panel.url).origin }, data: { id: 1, method: 'tools/call', params: { name, arguments: args } },
  })).json()).result;
  let stopWrites = 0, discardWrites = 0, blockReads = false, rejectDiscard = true;
  try {
    const created = (await call('create_project', { projectDirectory: join(root, 'project') })).structuredContent;
    const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
    const task = (await call('start_creation_task', { ...identity, instruction: '保留候选，等待审阅' })).structuredContent.creationTask;
    const original = await readFile(join(identity.projectDirectory, '.narracut/current.json'));
    await page.goto(panel.url);
    await page.route(`${panel.url}rpc`, async route => {
      const request = route.request().postDataJSON(), { name, arguments: args } = request.params;
      const fail = () => route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { isError: true, structuredContent: { error: { code: 'RESPONSE_LOST', message: '注入回执丢失' } } } } });
      if (blockReads && (name === 'get_creation_task' || name === 'manage_project_candidate' && args.action === 'read')) return fail();
      if (name === 'respond_creation_task' && args.action === 'stop') {
        stopWrites++; await route.fetch(); blockReads = true; return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { structuredContent: { creationTask: {} } } } });
      }
      if (name === 'manage_project_candidate' && args.action === 'discard') {
        discardWrites++;
        if (!rejectDiscard) await route.fetch();
        blockReads = true; return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { structuredContent: { candidate: {} } } } });
      }
      return route.continue();
    });
    const app = page.frameLocator('iframe');
    await app.getByRole('tab', { name: 'Agent 工作区' }).click();
    await app.getByRole('button', { name: '审阅详情', exact: true }).click();
    await app.getByRole('button', { name: '停止任务', exact: true }).click();
    await expect(app.getByRole('button', { name: '重新核对停止结果' })).toBeVisible();
    await app.getByRole('button', { name: '重新核对停止结果' }).click();
    await expect(app.getByRole('button', { name: '放弃候选', exact: true })).toBeDisabled();
    const checkpoint = JSON.parse(await readFile(join(identity.projectDirectory, '.narracut/agent-task.json'), 'utf8'));
    expect(checkpoint).toMatchObject({ taskId: task.taskId, status: 'stopped', reason: 'USER_STOPPED' });
    const candidate = (await call('manage_project_candidate', { ...identity, action: 'read' })).structuredContent.candidate;
    expect(candidate.status).toBe('saved');
    expect(stopWrites).toBe(1);
    blockReads = false;
    await expect(app.getByRole('button', { name: '放弃候选', exact: true })).toBeEnabled({ timeout: 10000 });
    await app.getByRole('button', { name: '放弃候选', exact: true }).click();
    await expect(app.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(app.getByRole('button', { name: '放弃候选', exact: true })).toBeFocused();
    expect(await readFile(join(identity.projectDirectory, '.narracut/agent-task.json'), 'utf8')).toBe(JSON.stringify(checkpoint));
    await app.getByRole('button', { name: '放弃候选', exact: true }).click();
    await app.getByRole('button', { name: '放弃候选并终结任务', exact: true }).click();
    await expect(app.getByRole('button', { name: '核对操作结果', exact: true })).toBeVisible();
    await app.getByRole('button', { name: '核对操作结果', exact: true }).click();
    expect(discardWrites).toBe(1);
    blockReads = false;
    await expect(app.locator('[data-candidate-region]')).toContainText('候选仍存在', { timeout: 10000 });
    expect((await call('manage_project_candidate', { ...identity, action: 'read' })).structuredContent.candidate).toEqual(candidate);
    rejectDiscard = false;
    await app.getByRole('button', { name: '放弃候选', exact: true }).click();
    await app.getByRole('button', { name: '放弃候选并终结任务', exact: true }).click();
    await expect(app.getByRole('button', { name: '核对操作结果', exact: true })).toBeVisible();
    blockReads = false;
    await expect(app.getByRole('button', { name: '核对操作结果', exact: true })).toHaveCount(0, { timeout: 10000 });
    await expect(app.locator('.candidate-save')).toContainText('尚无候选');
    expect(await readFile(join(identity.projectDirectory, '.narracut/current.json'))).toEqual(original);
    await expect(readFile(join(identity.projectDirectory, '.narracut/agent-task.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(discardWrites).toBe(2);
    expect(stopWrites).toBe(1);
  } finally { await page.close(); await panel.close(); await rm(root, { recursive: true, force: true }); }
});

test('放弃回执不明期间撤销写权，旧面板仍能只读核对且不再提交', async ({ page }) => {
  const { readFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'decision-control-'));
  const owner = await startWorkbenchPanel({ threadId: 'decision-owner' });
  const next = await startWorkbenchPanel({ threadId: 'decision-next' });
  const call = async (panel: typeof owner, name: string, args = {}) => (await (await page.request.post(`${panel.url}rpc`, {
    headers: { Origin: new URL(panel.url).origin }, data: { id: 1, method: 'tools/call', params: { name, arguments: args } },
  })).json()).result;
  let blockReads = true, writes = 0;
  try {
    const created = (await call(owner, 'create_project', { projectDirectory: join(root, 'project') })).structuredContent;
    const identity = { projectDirectory: created.project.directory, projectId: created.project.projectId };
    const candidate = (await call(owner, 'manage_project_candidate', { ...identity, action: 'create' })).structuredContent.candidate;
    const original = await readFile(join(identity.projectDirectory, '.narracut/current.json'));
    await page.goto(owner.url);
    await page.route(`${owner.url}rpc`, async route => {
      const request = route.request().postDataJSON(), { name, arguments: args } = request.params;
      if (name === 'manage_project_candidate' && (args.action === 'discard' || blockReads && args.action === 'read')) {
        if (args.action === 'discard') writes++;
        return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { isError: true, structuredContent: { error: { code: 'RESPONSE_LOST', message: '注入回执不明' } } } } });
      }
      return route.continue();
    });
    const app = page.frameLocator('iframe');
    await app.getByRole('tab', { name: 'Agent 工作区' }).click();
    await app.getByRole('button', { name: '审阅详情', exact: true }).click();
    await app.getByRole('button', { name: '放弃候选', exact: true }).click();
    await app.getByRole('button', { name: '放弃候选并终结任务', exact: true }).click();
    await expect(app.getByRole('button', { name: '核对操作结果', exact: true })).toBeVisible();
    await call(next, 'open_project', identity);
    expect((await call(next, 'project_control', { ...identity, action: 'takeover' })).isError).not.toBe(true);
    await expect(app.getByText('只读 · 项目由另一对话控制', { exact: true })).toBeVisible();
    blockReads = false;
    await app.getByRole('button', { name: '核对操作结果', exact: true }).click();
    await expect(app.getByRole('button', { name: '核对操作结果', exact: true })).toHaveCount(0, { timeout: 10000 });
    await expect(app.getByRole('button', { name: '放弃候选', exact: true })).toBeDisabled();
    expect((await call(next, 'manage_project_candidate', { ...identity, action: 'read' })).structuredContent.candidate).toEqual(candidate);
    expect(await readFile(join(identity.projectDirectory, '.narracut/current.json'))).toEqual(original);
    expect(writes).toBe(1);
  } finally { await page.close(); await next.close(); await owner.close(); await rm(root, { recursive: true, force: true }); }
});

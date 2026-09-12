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
    await expect(readonly.getByRole('button', { name: '审阅并接受', exact: true })).toBeDisabled();
    await expect(readonly.getByRole('button', { name: '放弃候选', exact: true })).toBeDisabled();
    for (const [name, args] of [['project_acceptance', { action: 'review' }], ['manage_project_candidate', { action: 'discard' }]] as const) {
      const denied = await call(viewer, name, { ...identity, ...args });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent.error.code).toBe('PROJECT_CONTROL_REQUIRED');
    }
    await app.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(app.getByRole('button', { name: '放弃候选', exact: true })).toBeEnabled();
    await app.getByRole('tab', { name: '表格工作区' }).click();
    await expect(app.locator('[data-scene-row]').first()).toHaveAttribute('data-selected', 'true');
    await expect(app.getByRole('textbox', { name: 'Scene 01 Narration' })).toHaveValue('保留 Scene 内容');
    await app.getByRole('tab', { name: 'Agent 工作区' }).click();
    await app.getByRole('button', { name: '放弃候选', exact: true }).click();
    await expect(app.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await app.getByRole('button', { name: '放弃候选并终结任务', exact: true }).click();
    await expect(app.locator('.candidate-save')).toContainText('尚无候选');
    expect((await call(owner, 'get_workbench')).structuredContent.scenes[0].narration).toBe('保留 Scene 内容');
  } finally { await page.close(); await other.close(); await viewer.close(); await owner.close(); await rm(root, { recursive: true, force: true }); }
});

import { expect, test } from '@playwright/test';
import { mkdtemp, rm, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { startWorkbenchPanel } from '../../plugins/narracut/src/workbench-panel';

test('公开页面只读预览真实 Asset，缺失文件可解除，绑定保存到原目标 Scene', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'scene-asset-'));
  const panel = await startWorkbenchPanel({ threadId: 'scene-asset-owner' });
  const directory = join(root, '同行检查');
  const call = async (name: string, args = {}) => {
    const response = await page.request.post(`${panel.url}rpc`, { headers: { Origin: new URL(panel.url).origin }, data: { id: 1, method: 'tools/call', params: { name, arguments: args } } });
    const result = (await response.json()).result;
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return result.structuredContent;
  };
  const disk = async () => JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'));
  try {
    const created = await call('create_project', { projectDirectory: directory });
    const identity = { projectDirectory: directory, projectId: created.project.projectId };
    const scenes = [1, 2].map(index => ({ id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`, narration: { text: `第${index}句` }, assetIds: [] }));
    const saved = await call('save_project_scenes', { ...identity, baselineRevision: created.projectRevision, project: { assets: [], scenes } });
    const filename = '用于检查文件全名与尾部版本的长名称'.repeat(4) + '-最终版本.png';
    const source = join(root, filename);
    await sharp({ create: { width: 32, height: 24, channels: 3, background: '#315e9a' } }).png().toFile(source);
    await call('import_project_asset', { ...identity, baselineRevision: saved.projectRevision, sourcePath: source, targetSceneId: scenes[1]!.id });
    await page.setViewportSize({ width: 902, height: 667 });
    await page.goto(panel.url);
    const app = page.frameLocator('iframe');
    const selected = app.getByRole('button', { name: 'Scene 01：第1句' });
    await selected.click();
    const entry = app.getByRole('button', { name: /第 02 个 Scene 的 Asset/ });
    await entry.click();
    await expect(app.getByRole('heading', { name: 'Scene 02 · Asset' })).toBeVisible();
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await app.getByRole('button', { name: `预览 ${filename}`, exact: true }).click();
    const preview = app.getByRole('dialog', { name: 'Asset 只读预览' });
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.getByRole('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(32);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();
    const imported = (await disk()).assets[0];
    await unlink(join(directory, imported.path));
    await page.reload();
    await entry.click();
    await expect(app.getByText('文件不可用', { exact: true })).toBeVisible();
    await expect(app.getByRole('button', { name: `预览 ${filename}`, exact: true })).toBeDisabled();
    for (const viewport of [{ width: 902, height: 667 }, { width: 960, height: 640 }, { width: 1200, height: 720 }, { width: 430, height: 667 }]) {
      await page.setViewportSize(viewport);
      const unlinkButton = app.getByRole('button', { name: `解除 ${filename} 引用`, exact: true });
      await unlinkButton.scrollIntoViewIfNeeded();
      const box = (await unlinkButton.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: `/tmp/issue111-asset-${viewport.width}.png` });
    }
    await app.getByRole('button', { name: `解除 ${filename} 引用`, exact: true }).click();
    await expect.poll(async () => (await disk()).scenes[1].assetIds).toEqual([]);
    await expect(app.getByText('尚未绑定 Asset', { exact: true })).toBeVisible();
    expect((await disk()).assets).toEqual([imported]);
    // 恢复真实源文件，再从已有登记绑定，登记身份不变。
    await sharp(source).toFile(join(directory, imported.path));
    await page.reload(); await entry.click();
    await app.getByRole('button', { name: '添加已有 Asset', exact: true }).click();
    await app.getByRole('button', { name: `添加 ${filename}`, exact: true }).click();
    await expect.poll(async () => (await disk()).scenes[1].assetIds).toEqual([imported.id]);
    expect((await disk()).scenes[0].assetIds).toEqual([]);
    expect(await readFile(source)).toEqual(await readFile(join(directory, imported.path)));
  } finally { await page.close(); await panel.close(); await rm(root, { recursive: true, force: true }); }
});

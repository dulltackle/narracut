import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, access, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNarracutRequestHandler } from '../../plugins/narracut/src/server';
import { populatePortableProject } from '../helpers/portable-project';
import { installAppToolBridge } from '../helpers/workbench-fixture';
import { compareVisualFrames } from '../support/visual-comparison';

// 与认证胶囊使用同一软件图形后端，避免宿主 GPU 色彩转换差异。
test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--in-process-gpu'] } });

test('插件工作台：关闭移动后断网同步、精确 Preview 与同 Bundle 最终 Render', async ({ page }, info) => {
  test.setTimeout(600000);
  const root = await mkdtemp(join(tmpdir(), 'portable-vnext-'));
  let directory = join(root, '原项目'), projectId: string;
  let handler = createNarracutRequestHandler({ conversation: { threadId: 'portable-creation' } });
  let lastPreview: any;
  let stepImageCount = 0;
  const raw = async (name: string, args: any) => { const result = await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any; if (name === 'creation_step') stepImageCount = result.content?.filter((item: any) => item.type === 'image').length ?? 0; if (name === 'project_video_update' && args.action === 'view') lastPreview = result.structuredContent?.preview; return result; };
  const call = async (name: string, args: any = {}) => {
    const result = await raw(name, { projectDirectory: directory, projectId, ...args });
    expect(result.isError, JSON.stringify(result)).not.toBe(true); return result.structuredContent;
  };
  const originalFetch = globalThis.fetch;
  let networkAttempts = 0;
  const server = createServer();
  try {
    await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/server/cli.ts', 'create', directory]);
    projectId = JSON.parse(await readFile(join(directory, 'narracut.json'), 'utf8')).projectId;
    const fixture = await populatePortableProject(directory);
    // 仅准备期提供本地归档；安装、构建、采帧及编码始终使用真实执行胶囊。
    globalThis.fetch = async (input) => { const bytes = fixture.urls.get(String(input)); if (!bytes) throw new Error(`未声明来源 ${input}`); return new Response(new Uint8Array(bytes)); };
    await call('open_project');
    const resource = await handler({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } }) as any;
    server.on('request', (_req, res) => { res.setHeader('content-type', 'text/html'); res.end(resource.contents[0].text); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.goto(origin); await installAppToolBridge(page, raw);
    await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), await call('open_project'));
    await page.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(page.getByRole('textbox', { name: 'Composer', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /开始创作|继续任务|新目标接管/ })).toHaveCount(0);
    // 当前对话通过公开工具发起，工作台承载后续审阅与明确接受。
    const started = await call('start_creation_task', { instruction: '检查三幕素材与叠化，保留已生成 Speech。', parentOrigin: origin });
    const taskId = started.creationTask.taskId;
    for (const action of ['dependencies', 'apply', 'deliver']) {
      let step: any;
      await expect.poll(async () => { step = (await call('creation_step', { taskId, action: 'read' })).step; return Boolean(step); }, { timeout: 120000 }).toBe(true);
      expect(step.threadId).toBe('portable-creation');
      await call('creation_step', { taskId, action: 'submit', stepId: step.stepId, answer: {
        verificationToken: step.verificationToken, action,
        changes: action === 'apply' ? [{ path: 'resources/palette.json', content: '["#152f38","#463b20","#28483a"]' }] : [],
        summary: '三幕已准备好，请检查候选。', divergence: '', warnings: [], suggestions: [], reviews: [],
      } });
    }
    // 可控 Agent 通过真实工具图像通道逐批回交观察；视觉正确性由后面的逐帧对照另行验证。
    for (let batch = 0; batch < 4; batch++) {
      let step: any;
      await expect.poll(async () => {
        const result = await call('creation_step', { taskId, action: 'read' }); step = result.step;
        return Boolean(step) || result.creationTask.status === 'waiting';
      }, { timeout: 120000 }).toBe(true);
      if (!step) break;
      const evidence = (await call('project_delivery', { action: 'status' })).delivery;
      const frames = evidence.frames.filter((frame: any) => !frame.observation).slice(0, 12);
      expect(stepImageCount).toBe(frames.length);
      expect(stepImageCount).toBeGreaterThan(0);
      await call('creation_step', { taskId, action: 'submit', stepId: step.stepId, answer: {
        verificationToken: step.verificationToken, action: 'deliver', changes: [], summary: '三幕候选已交付', divergence: '', warnings: [], suggestions: [],
        reviews: frames.map((frame: any) => ({ frame: frame.frame, digest: frame.digest, observation: '自动化协议替身：该帧交由后续逐帧对照验证。' })),
      } });
    }
    await expect.poll(async () => (await call('get_creation_task')).creationTask.reason).toBe('CANDIDATE_READY');
    const candidateBeforeMove = (await call('manage_project_candidate', { action: 'read' })).candidate;
    const lockBeforeMove = await readFile(join(directory, candidateBeforeMove.candidate.path, 'pnpm-lock.yaml'));
    // 构造存量已接受项目；旧接受仅用于兼容准备，新页面不再提供接受入口。
    const delivered = await call('project_delivery', { action: 'status' });
    await call('project_delivery_display', { deliveryId: delivered.delivery.id, reportRevision: delivered.delivery.reportRevision, batchId: delivered.checks.batches.at(-1).id, warningsKey: delivered.warningsKey });
    const confirmation = (await call('project_acceptance', { action: 'review' })).confirmation;
    await call('project_acceptance', { ...confirmation, action: 'accept', confirmed: true });
    // 关闭服务销毁全部内存缓存与安装树，然后移动完整项目，旧绝对路径消失。
    await handler.dispose();
    const previous = directory;
    directory = join(root, '移动后很长的项目目录-保持身份-离线验收'); await rename(previous, directory);
    await expect(access(previous)).rejects.toThrow();
    globalThis.fetch = async () => { networkAttempts++; throw new Error('离线验收禁止网络'); };
    handler = createNarracutRequestHandler({ conversation: { threadId: 'portable-creation' } });
    await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/server/cli.ts', 'open', directory]);
    const reopened = await call('open_project');
    expect(reopened.project.projectId).toBe(projectId);
    await page.reload(); await page.evaluate(() => { (window as any).openai = { callTool: (name: string, args: any) => (window as any).handleNarracutAppTool(name, args) }; });
    await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), reopened);
    await page.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(page.getByRole('button', { name: '仅同步表格内容', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '仅同步表格内容', exact: true }).click();
    await expect(page.locator('[data-update-state]')).toContainText('视频已同步', { timeout: 180000 });
    const preview = (await call('project_video_update', { action: 'view', parentOrigin: origin })).preview;
    expect(preview.stale).toBe(false);
    const published = await call('project_video_update', { action: 'status' });
    expect(published.undo).toBeNull();
    const samples = published.revision.acceptance.frames;
    const images = new Map<number, string>();
    const player = page.locator('[data-preview-screen] iframe:not([hidden])');
    await expect(player).toBeVisible();
    await player.evaluate((node: HTMLIFrameElement) => { node.style.cssText = 'position:fixed;top:0;left:0;width:320px;height:240px;z-index:9999'; });
    for (const sample of samples) {
      await page.getByLabel('帧号', { exact: true }).fill(String(sample.frame));
      await page.getByRole('button', { name: '跳转', exact: true }).click();
      await expect(page.locator('[data-frame-output]')).toContainText(`已提交帧 ${sample.frame}`);
      const browserImage = info.outputPath(`browser-${sample.frame}.png`); await player.screenshot({ path: browserImage });
      images.set(sample.frame, browserImage);
    }
    await player.evaluate((node: HTMLIFrameElement) => { node.style.cssText = ''; });
    const renderRegion = page.getByRole('region', { name: '最终 Render', exact: true });
    await page.evaluate(path => { (window as any).openai.selectDirectory = async () => ({ path }); }, root);
    await renderRegion.getByRole('button', { name: '输出视频', exact: true }).click();
    await renderRegion.getByRole('button', { name: '选择输出文件夹' }).click();
    await renderRegion.getByRole('button', { name: '开始输出', exact: true }).click();
    let render: any;
    await expect.poll(async () => { render = await call('project_render', { action: 'status' }); return render.jobs.at(-1)?.status; }, { timeout: 240000 }).toBe('succeeded');
    expect(render.source.details.bundle).toBe(preview.identity.bundle);
    expect(render.jobs.at(-1).source.details).toEqual(render.source.details);
    for (const [frame, path] of images) {
      const output = info.outputPath(`render-${frame}.png`);
      await promisify(execFile)('ffmpeg', ['-v', 'error', '-i', render.jobs.at(-1).outputPath, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', output]);
      await compareVisualFrames(path, output, { sceneId: 'portable', frame, channelThreshold: 30, maxDifferentPixelRatio: 0.012, artifactDirectory: info.outputDir });
    }
    await player.evaluate((node: HTMLIFrameElement) => { node.style.cssText = ''; });
    await page.screenshot({ path: info.outputPath('portable-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('portable-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(networkAttempts).toBe(0);
    const current = JSON.parse(await readFile(join(directory, '.narracut/current.json'), 'utf8')).revisionId;
    expect(await readFile(join(directory, '.narracut/revisions', current, 'render-program/pnpm-lock.yaml'))).toEqual(lockBeforeMove);
    await cp(render.jobs.at(-1).outputPath, info.outputPath('final.mp4'));
    await handler.dispose();
    await cp(directory, info.outputPath('project'), { recursive: true });
    await writeFile(info.outputPath('evidence.json'), JSON.stringify({ projectId, movedFrom: previous, directory, input: preview.input, identity: preview.identity, render: render.jobs.at(-1), frames: [...images.keys()], networkAttempts }, null, 2));
  } finally { globalThis.fetch = originalFetch; await handler.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

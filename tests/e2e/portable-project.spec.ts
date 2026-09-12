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

test('插件工作台：关闭移动后断网重建、精确 Preview、接受与同 Bundle 最终 Render', async ({ page }, info) => {
  test.setTimeout(600000);
  const root = await mkdtemp(join(tmpdir(), 'portable-vnext-'));
  let directory = join(root, '原项目'), projectId: string;
  let handler = createNarracutRequestHandler({ conversation: { threadId: 'portable-creation' } });
  let lastPreview: any;
  let stepImageCount = 0;
  const raw = async (name: string, args: any) => { const result = await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any; if (name === 'creation_step') stepImageCount = result.content?.filter((item: any) => item.type === 'image').length ?? 0; if (name === 'project_preview' && args.action === 'build') lastPreview = result.structuredContent?.preview; return result; };
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
    await expect(page.locator('[data-preview-state]')).toContainText('尚无预览');
    expect((await call('get_creation_task')).creationTask).toMatchObject({ taskId, status: 'stopped', reason: 'APP_RESTARTED' });
    expect((await call('creation_step', { taskId, action: 'read' })).step).toBeNull();
    await page.getByRole('button', { name: '构建候选', exact: true }).click();
    await expect.poll(async () => { const state = await page.locator('[data-preview-state]').textContent(); if (state?.includes('失败')) throw new Error(state); return page.locator('[data-frame-output]').textContent(); }, { timeout: 120000 }).toContain('已提交帧 0');
    // 从公开工具状态取得同一候选的实例，再通过公开交付工具审阅完整证据。
    const checks = await call('project_checks', { action: 'start' });
    const preview = lastPreview;
    const boundaries = preview.input.scenes.slice(1).map((scene: any) => scene.time.startFrame);
    const supplements = boundaries.flatMap((frame: number) => [{ frame: frame - 2, source: 'transition', reason: '叠化中段' }, { frame: frame + 2, source: 'motion', reason: '边界后运动' }]);
    await call('project_delivery', { action: 'prepare', instanceId: preview.instanceId, supplements });
    let delivery: any;
    await expect.poll(async () => { delivery = await call('project_delivery', { action: 'status' }); return !delivery.collecting && delivery.checks.batches.at(-1)?.status === 'complete'; }, { timeout: 180000 }).toBe(true);
    const samples = delivery.delivery.frames;
    const images = new Map<number, string>();
    const player = page.locator('[data-preview-screen] iframe:not([hidden])');
    await player.evaluate((node: HTMLIFrameElement) => { node.style.cssText = 'position:fixed;top:0;left:0;width:320px;height:240px;z-index:9999'; });
    for (const sample of samples) {
      expect(sample.digest, JSON.stringify(sample)).toBeTruthy();
      await page.getByLabel('帧号', { exact: true }).fill(String(sample.frame));
      await page.getByRole('button', { name: '跳转', exact: true }).click();
      await expect(page.locator('[data-frame-output]')).toContainText(`已提交帧 ${sample.frame}`);
      const browserImage = info.outputPath(`browser-${sample.frame}.png`); await player.screenshot({ path: browserImage });
      const result = await raw('project_delivery', { projectDirectory: directory, projectId, action: 'image', deliveryId: delivery.delivery.id, frame: sample.frame });
      const image = result.content.find((item: any) => item.type === 'image');
      const path = info.outputPath(`preview-${sample.frame}.png`); await writeFile(path, Buffer.from(image.data, 'base64')); images.set(sample.frame, path);
      await compareVisualFrames(browserImage, path, { sceneId: 'portable-browser', frame: sample.frame, channelThreshold: 30, maxDifferentPixelRatio: 0.012, artifactDirectory: info.outputDir });
    }
    for (let start = 0; start < samples.length; start += 12) await call('project_delivery', { action: 'review', deliveryId: delivery.delivery.id, reviews: samples.slice(start, start + 12).map((sample: any) => ({ frame: sample.frame, digest: sample.digest, observation: '三幕素材、叠化和 seeded 运动代表帧已读取，将与最终输出逐帧比较。' })) });
    const goal = '离线可移动短片：' + '保持旁白与 Scene 顺序，以画面变化呈现三个段落。'.repeat(16);
    const suggestions = [
      { sceneId: preview.input.scenes[1].id, observation: '第二幕信息密集', action: '精简 Narration', content: '留下最重要的一句话', reason: '给画面留出阅读时间' },
      { sceneId: preview.input.scenes[2].id, observation: '第三幕还有调整空间', action: '核对结尾旁白', content: '保留可复制的建议值', reason: '供用户参考' },
    ];
    await call('project_delivery', { action: 'describe', deliveryId: delivery.delivery.id, report: { goal, summary: '三幕素材与跨 Scene 叠化', warnings: ['草稿节奏需要结合成片判断。'], suggestions } });
    await expect(page.locator('[data-delivery-summary]')).toContainText(goal);
    await expect(page.locator('[data-delivery-warnings]')).toContainText('草稿节奏需要结合成片判断。');
    await expect(page.locator('[data-delivery-suggestions] article')).toHaveCount(2);
    await expect(page.locator('[data-go-scene="1"]')).toBeEnabled();
    const beforeSuggestion = (await call('get_workbench')).projectDsl;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('[data-copy-suggestion="0"]').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(suggestions[0].content);
    await page.locator('[data-go-scene="0"]').click();
    await expect(page.getByRole('textbox', { name: 'Scene 02 Narration' })).toHaveValue(beforeSuggestion.scenes[1].narration.text);
    expect((await call('get_workbench')).projectDsl).toEqual(beforeSuggestion);
    await page.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(page.locator('[data-preview-title]')).toContainText('候选');
    await page.getByRole('button', { name: '对比当前', exact: true }).click();
    await expect(page.locator('[data-preview-title]')).toContainText('正在查看：当前', { timeout: 120000 });
    await expect(page.locator('[data-preview-screen] iframe')).toHaveCount(2);
    await expect(page.locator('[data-preview-screen] iframe:not([hidden])')).toHaveCount(1);
    await page.getByRole('tab', { name: '表格工作区' }).click();
    await page.getByRole('tab', { name: 'Agent 工作区' }).click();
    await expect(page.locator('[data-preview-title]')).toContainText('正在查看：当前');
    await page.getByRole('button', { name: '返回候选', exact: true }).click();
    await expect(page.locator('[data-preview-title]')).toContainText('正在查看：候选');
    // 完整候选报告在实际面板宽度下可读。
    await player.evaluate((node: HTMLIFrameElement) => { node.style.cssText = ''; });
    await page.locator('#workspace-agent').evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath('review-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('review-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    // 等待工作台实际展示报告并提交展示回执，随后由用户明确接受。
    await expect(page.locator('[data-delivery-state]')).toHaveText('可交付 · 等待用户判断', { timeout: 30000 });
    await page.getByRole('button', { name: '审阅并接受', exact: true }).click();
    await expect(page.getByRole('button', { name: '接受完整候选', exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: '接受完整候选', exact: true }).click();
    await expect(page.locator('[data-accept-message]')).toContainText('已接受', { timeout: 30000 });
    const renderRegion = page.getByRole('region', { name: '最终 Render', exact: true });
    await page.evaluate(path => { (window as any).openai.selectDirectory = async () => ({ path }); }, root);
    await renderRegion.getByRole('button', { name: '准备最终 Render', exact: true }).click();
    await renderRegion.getByRole('button', { name: '选择输出文件夹' }).click();
    await renderRegion.getByRole('button', { name: '开始 Render', exact: true }).click();
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

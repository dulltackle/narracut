import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { handleRequest } from '../../plugins/narracut/src/server';
import { installAppToolBridge, validResult } from '../helpers/workbench-fixture';
let host: Server, origin: string;
test.beforeAll(async()=>{
  const resource = await handleRequest({jsonrpc:'2.0',id:1,method:'resources/read',params:{uri:'ui://narracut/workbench-v1.html'}}) as any;
  host=createServer((_req,res)=>res.end(resource.contents[0].text));await new Promise<void>(resolve=>host.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(host.address() as any).port}`;
});
test.afterAll(async()=>{host.closeAllConnections();await new Promise<void>(resolve=>host.close(()=>resolve()));});
test('整体验收确认、过期与结果核对；历史详情保持焦点、Scene 选择和响应式布局',async({page})=>{
  const currentId='10000000-0000-4000-8000-000000000001', newId='10000000-0000-4000-8000-000000000002';
  const record={protocolVersion:1,checkerVersion:1,identity:{program:'sha256:'+'a'.repeat(64)},bundle:'sha256:'+'b'.repeat(64),instanceId:'preview',stages:[{id:'manifest',status:'passed'},{id:'build',status:'passed'}],warnings:['开场停留时间较短，请结合成片判断节奏。'],frames:[],zeroScenes:true};
  let key='initial', accepted=false, submits=0, results=0, cleanup=true, fromHistory=0;
  const revision=()=>({revisionId:accepted?newId:currentId,summary:'调整标题位置，保留 Scene 顺序',acceptedAt:'2026-09-08T00:00:00.000Z',source:'candidate',valid:true,current:true,acceptance:record});
  await page.goto(origin);
  await installAppToolBridge(page,(name,args)=>{
    if(name==='project_delivery')return {structuredContent:{delivery:null,checks:{batches:[{id:'reviewable',status:'complete',hardOperations:[]}],gates:[{operation:'accept',status:'blocked',reason:'仍须用户明确整体接受候选'}]}}};
    if(name==='project_acceptance'){
      if(args.action==='history')return {structuredContent:{current:revision().revisionId,limit:20,revisions:[revision(),{revisionId:'10000000-0000-4000-8000-000000000003',valid:false,current:false,error:'完整树指纹不符'}]}};
      if(args.action==='review')return {structuredContent:{confirmation:{key,requestId:'10000000-0000-4000-8000-000000000004',record,summary:'调整标题位置，保留 Scene 顺序',willPrune:true}}};
      if(args.action==='accept'){submits++;accepted=true;return {structuredContent:{status:'accepted'}};}
      if(args.action==='result'){results++;if(results===1)return {structuredContent:{status:'accepted'}};if(results===2)return {isError:true,structuredContent:{error:{code:'DISCONNECTED',message:'连接中断'}}};return {structuredContent:{status:'accepted',revision:revision(),cleanupPending:cleanup}};}
      if(args.action==='cleanup'){cleanup=false;return {structuredContent:{cleanupPending:false}};}
      if(args.action==='from-history'){fromHistory++;return {structuredContent:{error:{code:'CANDIDATE_ALREADY_EXISTS',message:'已有候选，请先接受或明确放弃'}}};}
    }
    if(name==='manage_project_candidate')return {structuredContent:{candidate:{status:accepted?'absent':'saved',candidate:accepted?null:{identity:'program'},baseline:'baseline'}}};
    if(name==='project_delivery')return {structuredContent:{delivery:null,status:'incomplete',checks:{batches:[],gates:[]}}};
    return {structuredContent:{}};
  });
  await page.evaluate(result=>window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:result}},'*'),{...validResult(),candidate:{status:'saved',candidate:{identity:'program'},baseline:'baseline'}});
  await page.getByRole('tab',{name:'Agent 工作区'}).click();
  const selectedScene = await page.locator('[data-scene-row][data-selected="true"]').getAttribute('data-scene-id');
  await expect(page.getByRole('textbox', { name: 'Composer', exact: true })).toHaveCount(0);
  await page.getByRole('button',{name:'审阅并接受',exact:true}).click();
  await expect(page.locator('[data-accept-confirm]')).toBeVisible();
  await expect(page.locator('[data-accept-confirm]')).toContainText('最旧修订将自动移出');
  await expect(page.locator('[data-accept-confirm]')).toContainText(record.warnings[0]);
  key='changed';
  await expect(page.locator('[data-accept-message]')).toContainText('旧确认已失效',{timeout:10000});
  expect(submits).toBe(0);
  await page.getByRole('button',{name:'审阅并接受',exact:true}).click();
  await mkdir('.impeccable/review',{recursive:true});
  await page.locator('[data-accept-confirm]').scrollIntoViewIfNeeded();
  await page.screenshot({path:'.impeccable/review/acceptance-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'接受完整候选',exact:true}).click();
  await expect(page.locator('[data-accept-message]')).toContainText('已接受，清理待重试',{timeout:12000});
  expect(submits).toBe(1);expect(results).toBe(3);
  await page.getByRole('button',{name:'重试清理',exact:true}).click();
  await expect(page.locator('[data-accept-message]')).toContainText('清理完成');
  await page.getByRole('button',{name:'修订历史',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'修订历史'});
  await expect(dialog).toBeVisible();await expect(page.getByRole('button',{name:'关闭修订历史'})).toBeFocused();
  await dialog.locator('[data-revision] summary').first().click();
  await expect(dialog).toContainText('不能代表最新输入');
  await dialog.locator('[data-record-details] summary').click();
  await expect(dialog.locator('pre')).toContainText('protocolVersion');
  await dialog.locator('[data-revision] summary').last().click();
  await expect(dialog.locator('[data-from-revision]').last()).toBeDisabled();
  await dialog.evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:'.impeccable/review/history-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await dialog.evaluate(el=>el.getBoundingClientRect().width)).toBe(390);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await dialog.evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:'.impeccable/review/history-mobile.png',fullPage:true});
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'修订历史',exact:true})).toBeFocused();
  await expect(page.locator('[data-scene-row][data-selected="true"]')).toHaveAttribute('data-scene-id', selectedScene!);
  await page.getByRole('button',{name:'修订历史',exact:true}).click();
  await expect(dialog.locator('[data-record-details]')).toHaveAttribute('open','');
  await dialog.locator('[data-from-revision]').first().click();
  await expect(dialog.locator('[data-history-message]')).toContainText('已有候选');
  expect(fromHistory).toBe(1);
});

// 协议故障联动真实项目存储；检查报告为确定性夹具，不作为媒体执行证据。
for (const width of [902, 960, 1200]) test(`接受提交前失败与提交后收尾失败保留持久事实 · ${width}`, async ({ page }) => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { createProjectVNext, openProjectVNext } = await import('../../src/server/project-lifecycle');
  const root = await mkdtemp(join(tmpdir(), 'decision-113-'));
  const directory = join(root, 'project');
  await createProjectVNext(directory);
  const opened = await openProjectVNext(directory);
  let phase = 'before', requestId = '10000000-0000-4000-8000-000000000113';
  let submissions = 0, queries = 0;
  try {
    const first = await opened.candidate({ action: 'create' });
    const candidate = await opened.candidate({ action: 'apply', baseline: first.baseline, changes: [{ path: 'resources/proof.txt', content: '完整候选成果' }] });
    const original = await readFile(join(directory, '.narracut/current.json'));
    const record = { identity: { program: candidate.candidate!.identity }, warnings: ['草稿时长不能用于最终 Render'], stages: [], zeroScenes: true };
    await page.setViewportSize({ width, height: width === 902 ? 667 : width === 960 ? 640 : 720 });
    await page.goto(origin);
    await installAppToolBridge(page, async (name, args) => {
      if (name === 'manage_project_candidate') return { structuredContent: { candidate: await opened.candidate({ action: 'read' }) } };
      if (name === 'project_render') {
        const history = await opened.programTransaction(manager => manager.history());
        const revision = history.revisions.find(item => item.current)!;
        return { structuredContent: { source: { revisionId: revision.revisionId, summary: revision.summary, accepted: revision.source === 'candidate', ready: false, issues: [{ code: 'RENDER_ZERO_SCENES', message: '零 Scene 项目不能最终 Render' }] } } };
      }
      if (name !== 'project_acceptance') return { structuredContent: {} };
      const history = await opened.programTransaction(manager => manager.history());
      if (args.action === 'history') return { structuredContent: history };
      if (args.action === 'review') return { structuredContent: { confirmation: { key: candidate.baseline, baseline: candidate.baseline, currentRevision: history.current, requestId, record, summary: '完整候选成果' } } };
      if (args.action === 'accept') {
        submissions++;
        if (phase === 'before') return { isError: true, structuredContent: { error: { code: 'ACCEPTANCE_NOT_COMMITTED', message: '注入提交前失败' } } };
        await opened.programTransaction(manager => manager.accept({ baseline: candidate.baseline, summary: '完整候选成果', source: 'candidate', acceptance: record, requestId }, async () => {}));
        return { isError: true, structuredContent: { error: { code: 'RESPONSE_LOST', message: '提交成功后回执丢失' } } };
      }
      if (args.action === 'result') {
        queries++;
        if (phase === 'offline') throw new Error('注入断连');
        const revision = history.revisions.find(item => item.requestId === args.requestId);
        return { structuredContent: revision ? { status: 'accepted', revision, taskCleanupPending: true } : { status: 'unknown' } };
      }
      if (args.action === 'cleanup') return { structuredContent: { ...await opened.programTransaction(manager => manager.cleanupAcceptance()), taskCleanupPending: false } };
      return { structuredContent: {} };
    });
    await page.evaluate(result => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: result } }, '*'), { ...validResult(0), candidate });
    await page.getByRole('tab', { name: 'Agent 工作区' }).click();
    await page.getByRole('button', { name: '审阅并接受', exact: true }).click();
    await expect(page.locator('[data-accept-confirm]')).toContainText('终结本次任务');
    await expect(page.locator('[data-accept-confirm]')).toContainText('当前修订');
    await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: '审阅并接受', exact: true })).toBeFocused();
    expect(await opened.candidate({ action: 'read' })).toEqual(candidate);
    await page.getByRole('button', { name: '审阅并接受', exact: true }).click();
    await page.getByRole('button', { name: '接受完整候选', exact: true }).click();
    await expect(page.locator('[data-accept-message]')).toContainText('未接受');
    expect(await readFile(join(directory, '.narracut/current.json'))).toEqual(original);
    expect(await opened.candidate({ action: 'read' })).toEqual(candidate);
    phase = 'offline';
    requestId = '10000000-0000-4000-8000-000000000114';
    await page.getByRole('button', { name: '审阅并接受', exact: true }).click();
    await page.getByRole('button', { name: '接受完整候选', exact: true }).click();
    await expect(page.locator('[data-accept-message]')).toContainText('正在核对接受结果');
    await expect(page.getByRole('button', { name: '审阅并接受', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '核对接受结果', exact: true }).click();
    await page.getByRole('button', { name: '修订历史', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '修订历史' })).toContainText('完整候选成果');
    await page.keyboard.press('Escape');
    expect(submissions).toBe(2);
    expect((await opened.candidate({ action: 'read' })).status).toBe('absent');
    const accepted = await readFile(join(directory, '.narracut/current.json'));
    expect(accepted).not.toEqual(original);
    phase = 'connected';
    await expect(page.locator('[data-accept-message]')).toContainText('候选已接受，任务收尾待完成', { timeout: 10000 });
    await expect(page.locator('[data-accept-message]')).toContainText('最终 Render 尚需独立发起');
    await mkdir('docs/acceptance/issue113', { recursive: true });
    await expect(page.locator('[data-render-accepted]')).toHaveText('已接受', { timeout: 10000 });
    await page.screenshot({ path: `docs/acceptance/issue113/accepted-cleanup-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '重试清理', exact: true }).click();
    await expect(page.locator('[data-accept-message]')).toContainText('清理完成');
    expect(await readFile(join(directory, '.narracut/current.json'))).toEqual(accepted);
    expect(submissions).toBe(2);
    expect(queries).toBeGreaterThan(1);
  } finally { await page.close(); await opened.release(); await rm(root, { recursive: true, force: true }); }
});

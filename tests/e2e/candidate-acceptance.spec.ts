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
test('整体验收确认、过期与结果核对；历史详情保持焦点、草稿和响应式布局',async({page})=>{
  const currentId='10000000-0000-4000-8000-000000000001', newId='10000000-0000-4000-8000-000000000002';
  const record={protocolVersion:1,checkerVersion:1,identity:{program:'sha256:'+'a'.repeat(64)},bundle:'sha256:'+'b'.repeat(64),instanceId:'preview',stages:[{id:'manifest',status:'passed'},{id:'build',status:'passed'}],warnings:['开场停留时间较短，请结合成片判断节奏。'],frames:[],zeroScenes:true};
  let key='initial', accepted=false, submits=0, results=0, cleanup=true, fromHistory=0;
  const revision=()=>({revisionId:accepted?newId:currentId,summary:'调整标题位置，保留 Scene 顺序',acceptedAt:'2026-09-08T00:00:00.000Z',source:'candidate',valid:true,current:true,acceptance:record});
  await page.goto(origin);
  await installAppToolBridge(page,(name,args)=>{
    if(name==='project_acceptance'){
      if(args.action==='history')return {structuredContent:{current:revision().revisionId,limit:20,revisions:[revision(),{revisionId:'10000000-0000-4000-8000-000000000003',valid:false,current:false,error:'完整树指纹不符'}]}};
      if(args.action==='review')return {structuredContent:{confirmation:{key,requestId:'10000000-0000-4000-8000-000000000004',record,summary:'调整标题位置，保留 Scene 顺序',willPrune:true}}};
      if(args.action==='accept'){submits++;accepted=true;return {isError:true,structuredContent:{error:{code:'RESPONSE_LOST',message:'响应丢失'}}};}
      if(args.action==='result'){results++;return {structuredContent:{status:'accepted',revision:revision(),cleanupPending:cleanup}};}
      if(args.action==='cleanup'){cleanup=false;return {structuredContent:{cleanupPending:false}};}
      if(args.action==='from-history'){fromHistory++;return {structuredContent:{error:{code:'CANDIDATE_ALREADY_EXISTS',message:'已有候选，请先接受或明确放弃'}}};}
    }
    if(name==='manage_project_candidate')return {structuredContent:{candidate:{status:accepted?'absent':'saved',candidate:accepted?null:{identity:'program'},baseline:'baseline'}}};
    if(name==='project_delivery')return {structuredContent:{delivery:null,status:'incomplete',checks:{batches:[],gates:[]}}};
    return {structuredContent:{}};
  });
  await page.evaluate(result=>window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:result}},'*'),{...validResult(),candidate:{status:'saved',candidate:{identity:'program'},baseline:'baseline'}});
  await page.getByRole('tab',{name:'Agent 工作区'}).click();
  const composer=page.locator('textarea').filter({visible:true}).last();
  await composer.fill('保留我的创作草稿');
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
  await expect(page.locator('[data-accept-message]')).toContainText('已接受，清理待重试');
  expect(submits).toBe(1);expect(results).toBe(1);
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
  await expect(composer).toHaveValue('保留我的创作草稿');
  await page.getByRole('button',{name:'修订历史',exact:true}).click();
  await expect(dialog.locator('[data-record-details]')).toHaveAttribute('open','');
  await dialog.locator('[data-from-revision]').first().click();
  await expect(dialog.locator('[data-history-message]')).toContainText('已有候选');
  expect(fromHistory).toBe(1);
});

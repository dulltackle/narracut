import { test, expect, type Page } from '@playwright/test';
import { createNarracutRequestHandler, handleRequest } from '../../plugins/narracut/src/server';
import { installAppToolBridge } from '../helpers/workbench-fixture';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { probeSpeechDurationMs } from '../../src/server/project-speech-vnext';

async function load(page: Page, content: any) {
  const resource: any = await handleRequest({jsonrpc:'2.0',id:1,method:'resources/read',params:{uri:'ui://narracut/workbench-v1.html'}});
  await page.setContent(resource.contents[0].text);
  await page.evaluate(structuredContent => window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent}}, '*'), content);
}

test('首次配置取消不落盘，保存失败可重试，成功只继续原 Scene', async ({page}) => {
  const parent = await mkdtemp(join(tmpdir(), 'narracut-116-'));
  const root = join(parent,'声音配置');
  const handler = createNarracutRequestHandler();
  const call = async (name:string,args:any):Promise<any> => handler({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
  const starts:string[]=[]; let fail=true;
  try {
    let initial = (await call('create_project',{projectDirectory:root})).structuredContent;
    initial = (await call('save_project_scenes',{projectDirectory:root,projectId:initial.project.projectId,baselineRevision:initial.projectRevision,project:{...initial.projectDsl,scenes:[1,2].map(i=>({id:`30000000-0000-4000-8000-00000000000${i}`,narration:{text:`第${i}句旁白`},assetIds:[]}))}})).structuredContent;
    initial = (await call('get_workbench',{})).structuredContent;
    await load(page,initial);
    await installAppToolBridge(page, async(name,args)=>{
      if(name==='save_project_tts_settings' && fail) return {isError:true,structuredContent:{status:'tts-save-failed',error:{message:'磁盘暂时不可写'}}};
      if(name==='start_scene_speech') { starts.push(args.sceneId); return {isError:true,structuredContent:{error:{message:'合成服务暂时不可用'}}}; }
      return call(name,args);
    });
    const entry=page.getByRole('button',{name:'生成 Speech · Scene 02',exact:true});
    await entry.click();
    await expect(page.getByText('整部视频共用此声音',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'保存并生成此句',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'关闭项目 TTS 配置'}).click();
    await expect(entry).toBeFocused(); expect(starts).toEqual([]);
    expect((await call('get_workbench',{})).structuredContent.tts.status).not.toBe('configured');
    await entry.click(); await page.getByLabel('TokenDance API Key',{exact:true}).fill('fixture-key');
    await page.getByRole('button',{name:'保存并生成此句',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('磁盘暂时不可写');
    await expect(page.getByLabel('TokenDance API Key',{exact:true})).toHaveValue('fixture-key');
    fail=false; await page.getByRole('button',{name:'保存并生成此句',exact:true}).click();
    await expect.poll(()=>starts).toEqual(['30000000-0000-4000-8000-000000000002']);
    expect((await call('get_workbench',{})).structuredContent.tts.status).toBe('configured');
    expect(JSON.parse(await readFile(join(root,'project.json'),'utf8')).scenes.every((s:any)=>!s.speech)).toBe(true);
    await expect(page.getByRole('button',{name:'重试生成 Speech · Scene 02',exact:true})).toBeVisible();
  } finally { await handler.dispose(); await rm(parent,{recursive:true,force:true}); }
});

async function projectFixture(beforeSynthesis?:()=>Promise<void>) {
  const parent=await mkdtemp(join(tmpdir(),'narracut-116-'));
  const root=join(parent,'项目');
  let providerCalls=0;
  const audio = execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-ar','32000','-ac','1','-b:a','128k','-f','mp3','pipe:1']);
  const audioPath=join(parent,'明确标记的正弦波测试音频.mp3');await writeFile(audioPath,audio);
  const audioLength=await probeSpeechDurationMs(audioPath);
  const handler=createNarracutRequestHandler({ttsFetch:async()=>{providerCalls++;await beforeSynthesis?.();return new Response(JSON.stringify({data:{audio:audio.toString('hex')},extra_info:{audio_length:audioLength,audio_format:'mp3'},base_resp:{status_code:0,status_msg:'success'}}));}});
  const call=async(name:string,args:any={}):Promise<any>=>handler({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
  let initial=(await call('create_project',{projectDirectory:root})).structuredContent;
  const scenes=[1,2].map(i=>({id:`30000000-0000-4000-8000-00000000000${i}`,narration:{text:`第${i}句旁白`},assetIds:[]}));
  await call('save_project_scenes',{projectDirectory:root,projectId:initial.project.projectId,baselineRevision:initial.projectRevision,project:{...initial.projectDsl,scenes}});
  initial=(await call('get_workbench')).structuredContent;
  return {root,initial,call,providerCalls:()=>providerCalls,dispose:async()=>{await handler.dispose();await rm(parent,{recursive:true,force:true});}};
}

for(const change of ['text','delete','empty','readonly']) {
  test(`保存配置后原句 ${change} 时不隐式生成，持久目标保持准确`,async({page})=>{
    const f=await projectFixture(); let saved=false; const starts:any[]=[];
    try {
      await load(page,f.initial);
      await installAppToolBridge(page,async(name,args)=>{
        if(name==='start_scene_speech') starts.push(args);
        if(name==='save_project_tts_settings') {
          const response=await f.call(name,args); saved=true;
          const current=(await f.call('get_workbench')).structuredContent;
          const project=structuredClone(current.projectDsl);
          if(change==='delete') project.scenes.splice(1,1);
          if(change==='text') project.scenes[1].narration.text='已修改的最新旁白';
          if(change==='empty') project.scenes[1].narration.text='';
          if(change!=='readonly') await f.call('save_project_scenes',{projectDirectory:f.root,projectId:current.project.projectId,baselineRevision:current.projectRevision,project});
          return response;
        }
        const response=await f.call(name,args);
        if(name==='get_workbench' && saved && change==='readonly') response.structuredContent.writable=false;
        return response;
      });
      await page.getByRole('button',{name:'生成 Speech · Scene 02',exact:true}).click();
      await page.getByLabel('TokenDance API Key',{exact:true}).fill('fixture-key');
      await page.getByRole('button',{name:'保存并生成此句',exact:true}).click();
      await expect(page.getByText('声音配置已保存',{exact:true})).toBeVisible();
      if(change==='text') {
        await expect(page.getByText('已修改的最新旁白',{exact:true}).last()).toBeVisible();
        expect(starts).toEqual([]);
        await page.getByRole('button',{name:'生成最新内容'}).click();
        await expect.poll(()=>starts.length).toBe(1);
        expect(starts[0]).toMatchObject({sceneId:f.initial.projectDsl.scenes[1].id,expectedNarration:'已修改的最新旁白'});
        await expect.poll(async()=>JSON.parse(await readFile(join(f.root,'project.json'),'utf8')).scenes[1].speech?.path).toBe(`speech/${starts[0].sceneId}.mp3`);
      } else {
        await expect(page.getByRole('alert')).toContainText(change==='delete'?'已删除':change==='empty'?'已变空':'写权已变化');
        expect(starts).toEqual([]); expect(f.providerCalls()).toBe(0);
      }
    } finally {await f.dispose();}
  });
}

test('声音变更确认取消保留 Speech；仅凭据变更不失效；回执丢失核对同一次保存与生成',async({page})=>{
  const f=await projectFixture(); let loseSave=true; let loseStart=true; const saveIds:string[]=[]; const startIds:string[]=[];
  try {
    await load(page,f.initial);
    await installAppToolBridge(page,async(name,args)=>{
      const result=await f.call(name,args);
      if(name==='save_project_tts_settings') {saveIds.push(args.operationId);if(loseSave){loseSave=false;throw new Error('连接中断，保存回执丢失');}}
      if(name==='start_scene_speech') {startIds.push(args.operationId);if(loseStart){loseStart=false;return {structuredContent:{}};}}
      return result;
    });
    await page.getByRole('button',{name:'生成 Speech · Scene 01',exact:true}).click();
    await page.getByLabel('TokenDance API Key',{exact:true}).fill('fixture-key');
    await page.getByRole('button',{name:'保存并生成此句',exact:true}).click();
    await expect(page.getByRole('button',{name:'核对保存结果'})).toBeVisible();
    await page.getByRole('button',{name:'核对保存结果'}).click();
    await page.getByRole('button',{name:'重试生成 Speech · Scene 01',exact:true}).click();
    await expect.poll(()=>f.providerCalls()).toBe(1);
    expect(new Set(saveIds).size).toBe(1);expect(new Set(startIds).size).toBe(1);
    await expect.poll(async()=>JSON.parse(await readFile(join(f.root,'project.json'),'utf8')).scenes[0].speech?.path).toBe(`speech/${f.initial.projectDsl.scenes[0].id}.mp3`);
    // 等待页面也完成同一持久结果的核对。
    await expect(page.getByRole('button',{name:'重新生成 Speech · Scene 01',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'声音配置',exact:true}).click();
    await page.getByLabel('TTS 语速',{exact:true}).fill('1.2');
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await expect(page.getByRole('button',{name:'返回修改'})).toBeFocused();
    await expect(page.getByText('将使 1 条 Speech 失效')).toBeVisible();
    await page.getByText('查看受影响 Scene').click();
    await expect(page.getByRole('alertdialog')).toContainText('第1句旁白');
    await page.getByRole('button',{name:'返回修改'}).click();
    expect(JSON.parse(await readFile(join(f.root,'tts.json'),'utf8')).speed).toBe(1);
    expect(JSON.parse(await readFile(join(f.root,'project.json'),'utf8')).scenes[0].speech).toBeDefined();
    await page.getByLabel('TTS 语速',{exact:true}).fill('1');
    await page.getByLabel('TokenDance API Key',{exact:true}).fill('replacement-fixture');
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await expect(page.getByRole('button',{name:'声音配置',exact:true})).toBeFocused();
    expect(JSON.parse(await readFile(join(f.root,'project.json'),'utf8')).scenes[0].speech).toBeDefined();
    await page.getByRole('button',{name:'声音配置',exact:true}).click();
    await page.getByLabel('TTS 语速',{exact:true}).fill('1.2');
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await page.getByRole('button',{name:'确认更改'}).click();
    await expect.poll(async()=>JSON.parse(await readFile(join(f.root,'project.json'),'utf8')).scenes[0].speech).toBeUndefined();
    expect(JSON.parse(await readFile(join(f.root,'tts.json'),'utf8')).speed).toBe(1.2);
  } finally {await f.dispose();}
});

test('确认后影响范围变化必须重读重确认，旧配置的迟到合成不写入',async({page})=>{
  let hold=false;let release!:()=>void; const gate=new Promise<void>(r=>release=r);
  const f=await projectFixture(async()=>{if(hold)await gate;});
  const config={provider:'tokendance',model:'minimax-speech-2.8-turbo',voice:'Chinese (Mandarin)_News_Anchor',speed:1,volume:1,pitch:0};
  try {
    await f.call('save_project_tts_settings',{projectDirectory:f.root,projectId:f.initial.project.projectId,baselineRevision:f.initial.projectRevision,config,credentialAction:'replace',apiKey:'fixture',expectedAffectedSpeechCount:0});
    const first=(await f.call('start_scene_speech',{projectDirectory:f.root,projectId:f.initial.project.projectId,sceneId:f.initial.projectDsl.scenes[0].id})).structuredContent.speechJob;
    await expect.poll(async()=>(await f.call('get_scene_speech_job',{jobId:first.id})).structuredContent.speechJob).toMatchObject({status:'succeeded'});
    const initial=(await f.call('get_workbench')).structuredContent;
    await load(page,initial);
    await installAppToolBridge(page,(name,args)=>f.call(name,args));
    await page.getByRole('button',{name:'声音配置',exact:true}).click();
    await page.getByLabel('TTS 语速',{exact:true}).fill('1.2');
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await expect(page.getByText('将使 1 条 Speech 失效')).toBeVisible();
    const second=(await f.call('start_scene_speech',{projectDirectory:f.root,projectId:initial.project.projectId,sceneId:initial.projectDsl.scenes[1].id})).structuredContent.speechJob;
    await expect.poll(async()=>(await f.call('get_scene_speech_job',{jobId:second.id})).structuredContent.speechJob).toMatchObject({status:'succeeded'});
    await page.getByRole('button',{name:'确认更改'}).click();
    await expect(page.getByRole('alert')).toContainText('外部修改');
    expect(JSON.parse(await readFile(join(f.root,'tts.json'),'utf8')).speed).toBe(1);
    await page.getByRole('button',{name:'读取最新项目并保留 TTS 输入'}).click();
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await expect(page.getByText('将使 2 条 Speech 失效')).toBeVisible();
    hold=true;
    const late=(await f.call('start_scene_speech',{projectDirectory:f.root,projectId:initial.project.projectId,sceneId:initial.projectDsl.scenes[0].id})).structuredContent.speechJob;
    await expect.poll(()=>f.providerCalls()).toBe(3);
    await page.getByRole('button',{name:'确认更改'}).click();
    await expect.poll(async()=>JSON.parse(await readFile(join(f.root,'tts.json'),'utf8')).speed).toBe(1.2);
    release();
    await expect.poll(async()=>(await f.call('get_scene_speech_job',{jobId:late.id})).structuredContent.speechJob.status).toBe('cancelled');
    expect(JSON.parse(await readFile(join(f.root,'project.json'),'utf8')).scenes.every((s:any)=>!s.speech)).toBe(true);
  } finally {release();await f.dispose();}
});

for(const viewport of [{width:902,height:667},{width:960,height:640},{width:1200,height:720},{width:430,height:860}]) {
  test(`声音配置 ${viewport.width}px 加载失败重试、键盘、只读与返回焦点`,async({page})=>{
    const f=await projectFixture();let fail=true;
    try {
      await page.setViewportSize(viewport);await load(page,f.initial);
      await installAppToolBridge(page,async(name,args)=>{
        if(name==='get_workbench' && fail)throw new Error('配置读取暂时失败');
        return f.call(name,args);
      });
      const entry=page.getByRole('button',{name:'声音配置',exact:true});await entry.click();
      await expect(page.getByRole('alert')).toContainText('配置读取暂时失败');
      await expect(page.getByRole('button',{name:'保存配置',exact:true})).toBeDisabled();
      fail=false; await page.getByRole('button',{name:'重新读取声音配置'}).click();
      await expect(page.getByLabel('TTS 语速',{exact:true})).toBeEnabled();
      const save=page.getByRole('button',{name:'保存配置',exact:true});
      await save.focus();await page.keyboard.press('Tab');
      await expect(page.getByRole('button',{name:'关闭项目 TTS 配置'})).toBeFocused();
      await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport();
      const box=(await save.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);expect(box.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({path:`/tmp/issue116-actions-${viewport.width}.png`});
      await page.getByRole('button',{name:'关闭项目 TTS 配置'}).scrollIntoViewIfNeeded();
      await page.screenshot({path:`/tmp/issue116-${viewport.width}.png`});
      await page.keyboard.press('Escape');await expect(entry).toBeFocused();
      const current=(await f.call('get_workbench')).structuredContent;current.writable=false;
      await page.evaluate(structuredContent=>window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent}},'*'),current);
      await entry.click();await expect(page.getByText('当前只读，声音配置可以查看，不能保存或生成。')).toBeVisible();
      await expect(save).toBeDisabled();await page.keyboard.press('Escape');await expect(entry).toBeFocused();
    } finally {await f.dispose();}
  });
}

test('生成回执期间失权，恢复写权后核对原请求且不重复合成',async({page})=>{
  const f=await projectFixture();let release!:()=>void;const gate=new Promise<void>(r=>release=r);let starts=0;
  try {
    await load(page,f.initial);
    await installAppToolBridge(page,async(name,args)=>{
      const response=await f.call(name,args);
      if(name==='start_scene_speech'){starts++;if(starts===1)await gate;}
      return response;
    });
    await page.getByRole('button',{name:'生成 Speech · Scene 01',exact:true}).click();
    await page.getByLabel('TokenDance API Key',{exact:true}).fill('fixture-key');
    await page.getByRole('button',{name:'保存并生成此句',exact:true}).click();
    await expect.poll(()=>starts).toBe(1);
    const current=(await f.call('get_workbench')).structuredContent;current.writable=false;
    await page.evaluate(structuredContent=>window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent}},'*'),current);
    release();
    await expect(page.getByRole('region',{name:'Scene 只读接触印样'})).toContainText('生成失败');
    await expect(page.getByRole('button',{name:'重试生成 Speech · Scene 01',exact:true})).toHaveCount(0);
    const restored=(await f.call('get_workbench')).structuredContent;
    await page.evaluate(structuredContent=>window.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent}},'*'),restored);
    await page.getByRole('button',{name:'重试生成 Speech · Scene 01',exact:true}).click();
    await expect.poll(()=>starts).toBe(2);
    await expect(page.getByRole('button',{name:'重新生成 Speech · Scene 01',exact:true})).toBeVisible();
    expect(f.providerCalls()).toBe(1);
  } finally {release();await f.dispose();}
});

test('会话生成超过 128 次仍可继续，已淘汰回执不会重启旧请求',async()=>{
  const f=await projectFixture();
  try {
    const config={provider:'tokendance',model:'minimax-speech-2.8-turbo',voice:'Chinese (Mandarin)_News_Anchor',speed:1,volume:1,pitch:0};
    await f.call('save_project_tts_settings',{projectDirectory:f.root,projectId:f.initial.project.projectId,baselineRevision:f.initial.projectRevision,config,credentialAction:'replace',apiKey:'fixture',expectedAffectedSpeechCount:0});
    const args={projectDirectory:f.root,projectId:f.initial.project.projectId,sceneId:f.initial.projectDsl.scenes[0].id};
    const changed=await f.call('start_scene_speech',{...args,expectedNarration:'过期旁白',operationId:'changed-text'});
    expect(changed.structuredContent.error.code).toBe('SPEECH_NARRATION_CHANGED');
    for(let i=0;i<130;i++) {
      const response=await f.call('start_scene_speech',{...args,operationId:`attempt-${i}`});
      expect(response.isError).not.toBe(true);
      await f.call('cancel_scene_speech_job',{jobId:response.structuredContent.speechJob.id});
    }
    const old=await f.call('start_scene_speech',{...args,operationId:'attempt-0'});
    expect(old.isError).toBe(true);expect(f.providerCalls()).toBe(0);
  } finally {await f.dispose();}
});

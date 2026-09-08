import { expect, test, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';
import { fixture } from './helpers/program-fixture';
import { createProjectVNext, openProjectVNext } from '../src/server/project-lifecycle';
import { ProjectPreview } from '../src/server/project-preview';
import { ProjectChecks } from '../src/server/project-checks';
import { ProjectDelivery } from '../src/server/project-delivery';
test('完整服务协议从准确实例采集到单独检查、警告展示与交付；变更立即关闭交付门禁', async () => {
  const root=await mkdtemp(join(tmpdir(),'delivery-')), directory=join(root,'project');
  await createProjectVNext(directory); const request=await fixture();
  const revision=JSON.parse(await readFile(join(directory,'.narracut/current.json'),'utf8')).revisionId;
  for(const [file,bytes] of request.program)await writeFile(join(directory,'.narracut/revisions',revision,'render-program',file),bytes);
  const lock=parse(request.program.get('pnpm-lock.yaml')!.toString()); const urls=new Map<string,Buffer>();
  for(const [id,value] of Object.entries(lock.packages) as [string,any][]){const split=id.lastIndexOf('@'),name=id.slice(0,split),version=id.slice(split+1);urls.set(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,request.offline.get(Buffer.from(value.resolution.integrity.slice(7),'base64').toString('hex'))!);}
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(new Uint8Array(urls.get(url)!))));
  const opened=await openProjectVNext(directory), preview=new ProjectPreview(), checks=new ProjectChecks(preview), delivery=new ProjectDelivery(preview,checks);
  try {
    await writeFile(join(directory,'project.json'),JSON.stringify({assets:[],scenes:[{id:'30000000-0000-4000-8000-000000000001',narration:{text:'测试旁白'},assetIds:[]}]}));
    const candidate=await opened.candidate({action:'create'});
    await opened.candidate({action:'dependencies',baseline:candidate.baseline,dependencies:{},packages:[]});
    const descriptor=await preview.build(opened,'candidate','http://127.0.0.1:45678');
    await checks.start(opened);
    await delivery.operate(opened,{action:'prepare',instanceId:descriptor.instanceId});
    let state=await delivery.status(opened);
    for(let attempt=0;attempt<100 && (state.collecting || state.checks.batches.at(-1)?.status==='running');attempt++){await new Promise(resolve=>setTimeout(resolve,100));state=await delivery.status(opened);}
    expect(state.delivery?.captured).toBe(3);expect(state.delivery?.checked).toBe(0);
    expect(state.checks.gates.find(gate=>gate.operation==='delivery')?.status).toBe('blocked');
    const id=state.delivery!.id;
    const frame=state.delivery!.frames[0];
    await expect(delivery.operate(opened,{action:'review',deliveryId:id,reviews:[{frame:frame.frame,digest:frame.digest,observation:'尚未读取图像'}]})).rejects.toThrow('读取');
    for(const frame of state.delivery!.frames){const image=await delivery.operate(opened,{action:'image',deliveryId:id,frame:frame.frame});expect(image).toMatchObject({binding:{instanceId:descriptor.instanceId},digest:frame.digest});}
    await delivery.operate(opened,{action:'review',deliveryId:id,reviews:state.delivery!.frames.map(frame=>({frame:frame.frame,digest:frame.digest,observation:'文字可见，画面未遮挡'}))});
    await delivery.operate(opened,{action:'describe',deliveryId:id,report:{goal:'验证完整候选',summary:'调整成片表现',warnings:['节奏需由用户判断'],suggestions:[]}});
    state=await delivery.status(opened);
    await delivery.operate(opened,{action:'displayed',deliveryId:id,reportRevision:state.delivery!.reportRevision,batchId:state.checks.batches.at(-1)!.id,warningsKey:state.warningsKey});
    state=await delivery.status(opened);expect(state.status).toBe('ready');
    expect(state.checks.gates.map(gate=>gate.status)).toEqual(['available','available','disabled','disabled']);
    await checks.start(opened);
    state=await delivery.status(opened);
    for(let attempt=0;attempt<100 && state.checks.batches.at(-1)?.status==='running';attempt++){await new Promise(resolve=>setTimeout(resolve,100));state=await delivery.status(opened);}
    expect(state.status).toBe('incomplete');
    expect(state.checks.gates.find(gate=>gate.operation==='delivery')?.status).toBe('blocked');
    await delivery.operate(opened,{action:'displayed',deliveryId:id,reportRevision:state.delivery!.reportRevision,batchId:state.checks.batches.at(-1)!.id,warningsKey:state.warningsKey});
    expect((await delivery.status(opened)).status).toBe('ready');
    await writeFile(join(directory,'video.md'),'新的要求');
    state=await delivery.status(opened);expect(state.status).toBe('stale');
    await expect(delivery.operate(opened,{action:'review',deliveryId:id,reviews:[]})).rejects.toThrow('过期');
    await writeFile(join(directory,'project.json'),JSON.stringify({assets:[],scenes:[]}));
    const empty=await preview.build(opened,'candidate','http://127.0.0.1:45678');
    await checks.start(opened);await delivery.operate(opened,{action:'prepare',instanceId:empty.instanceId});
    state=await delivery.status(opened);
    for(let attempt=0;attempt<100 && state.checks.batches.at(-1)?.status==='running';attempt++){await new Promise(resolve=>setTimeout(resolve,100));state=await delivery.status(opened);}
    expect(state.delivery?.zeroScenes).toBe(true);expect(state.delivery?.frames).toEqual([]);expect(state.collecting).toBe(false);
    expect(state.checks.batches.at(-1)?.stages.filter(stage=>['manifest','build'].includes(stage.id)).every(stage=>stage.status==='passed')).toBe(true);
    await delivery.operate(opened,{action:'describe',deliveryId:state.delivery!.id,report:{goal:'建立空项目程序',summary:'保留有效 Manifest 与构建',warnings:[],suggestions:[]}});
    state=await delivery.status(opened);
    await delivery.operate(opened,{action:'displayed',deliveryId:state.delivery!.id,reportRevision:state.delivery!.reportRevision,batchId:state.checks.batches.at(-1)!.id,warningsKey:state.warningsKey});
    expect((await delivery.status(opened)).status).toBe('ready');
  }finally{delivery.clear();checks.clear();await preview.close();await opened.release();vi.unstubAllGlobals();await rm(root,{recursive:true,force:true});}
},120000);

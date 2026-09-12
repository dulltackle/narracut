import { expect, test } from 'vitest';
import { ProjectDelivery } from '../src/server/project-delivery';
import { gateOperations, type BatchView } from '../src/shared/program-checks';
import type { ProjectPreview } from '../src/server/project-preview';
import type { ProjectChecks } from '../src/server/project-checks';
import type { OpenedProjectVNext } from '../src/server/project-lifecycle';
const opened = {} as OpenedProjectVNext;
function service() {
  const identity={project:'p',program:'program',baseline:'baseline',brief:'brief',input:'input',media:'media',environment:'environment'};
  const binding={instanceId:'preview',bundle:'bundle',identity};
  const batch:BatchView={version:1,id:'batch',identity,status:'running',stale:false,stages:[{id:'manifest',status:'running',reason:''}],diagnostics:[],truncated:0,total:0,hardOperations:[],visualWarnings:[],warningsTruncated:0};
  const preview={latestCandidate:()=>binding.instanceId,evidenceSnapshot:()=>({binding,descriptor:{input:{scenes:[],durationInFrames:0,output:{width:320,height:180,fps:30}}}}),status:async()=>({stale:false})};
  const checks: any={status:async()=>({batches:[structuredClone(batch)],gates:gateOperations(batch,identity,checks.evidence?.(identity,batch))})};
  const delivery=new ProjectDelivery(preview as unknown as ProjectPreview,checks as ProjectChecks);
  return {delivery,batch,preview};
}
test('运行批次的空警告展示不覆盖完成后新增警告', async()=>{
  const {delivery,batch}=service();
  await delivery.operate(opened,{action:'prepare',instanceId:'preview'});
  const id=(await delivery.status(opened)).delivery!.id;
  await delivery.operate(opened,{action:'describe',deliveryId:id,report:{goal:'目标',summary:'变更',warnings:[],suggestions:[]}});
  await delivery.operate(opened,{action:'displayed',deliveryId:id,reportRevision:1,batchId:'batch',warningsKey:(await delivery.status(opened)).warningsKey});
  batch.status='complete';batch.stages[0].status='passed';batch.visualWarnings=[{id:'new',identity:batch.identity,message:'后来才产生的警告',suggestion:'检查画面',location:{kind:'project'}}];
  expect((await delivery.status(opened)).status).toBe('incomplete');
  await delivery.operate(opened,{action:'displayed',deliveryId:id,reportRevision:1,batchId:'batch',warningsKey:(await delivery.status(opened)).warningsKey});
  expect((await delivery.status(opened)).status).toBe('ready');
  batch.visualWarnings.push({...batch.visualWarnings[0],id:'changed',message:'新的警告内容'});
  expect((await delivery.status(opened)).status).toBe('incomplete');
});
test('新鲜度读取期间同实例换套，旧交付操作必须被拒绝',async()=>{
  const {delivery,preview}=service();
  await delivery.operate(opened,{action:'prepare',instanceId:'preview'});
  const id=(await delivery.status(opened)).delivery!.id;
  let release!:()=>void, entered!:()=>void;
  const waiting=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
  let first=true;
  preview.status=async()=>{if(first){first=false;entered();await waiting;}return {stale:false};};
  const old=delivery.operate(opened,{action:'describe',deliveryId:id,report:{goal:'旧目标',summary:'旧变更',warnings:[],suggestions:[]}});
  const rejected=expect(old).rejects.toThrow('过期');
  await started;await delivery.operate(opened,{action:'prepare',instanceId:'preview',supplements:[]});release();
  await rejected;expect((await delivery.status(opened)).delivery!.report).toBeNull();
});

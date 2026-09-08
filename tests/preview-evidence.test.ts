import { expect, test } from 'vitest';
import { buildProgramBundle } from '../src/server/program-bundle';
import { PreviewOrigin } from '../src/server/preview-origin';
import { capturePreviewFrames } from '../src/server/preview-evidence';
import { fixture } from './helpers/program-fixture';
test('胶囊重放准确 Preview，等待提交帧后输出不同 PNG；实例绑定保持一致', async () => {
  const request = await fixture();
  request.program.set('src/RenderProgram.tsx', Buffer.from('import {AbsoluteFill,useCurrentFrame} from "remotion";export function RenderProgram(){return <AbsoluteFill style={{backgroundColor:useCurrentFrame()===0?"red":"blue"}}/>}'));
  request.input = { ...request.input, videoBrief: '</script><script>window.injected=true</script>', scenes: request.input.scenes.map(scene => ({ ...scene, narration: '</script><script>throw new Error(\"不得执行\")</script>' })) };
  const source = new PreviewOrigin();
  try {
    const bundle = await buildProgramBundle(request);
    const descriptor = await source.publish({ ...request, bundle, media: new Map(), parentOrigin: 'http://127.0.0.1:43210', target: 'candidate', baseline: 'test', label: '候选', key: 'a'.repeat(48) });
    const result = await capturePreviewFrames(descriptor, source.snapshot(descriptor.url), [0, 29]);
    expect(result.map(item => item.frame)).toEqual([0,29]);
    expect(result.every(item => item.image && !item.error)).toBe(true);
    expect(result[0].image?.equals(result[1].image!)).toBe(false);
  } finally { await source.close(); }
}, 120000);
test('中间帧运行失败保留之前成功图像，不用错误画面伪造证据', async () => {
  const request=await fixture();
  request.program.set('src/RenderProgram.tsx',Buffer.from('import {AbsoluteFill,useCurrentFrame} from "remotion";export function RenderProgram(){if(useCurrentFrame()===15)throw "坏帧";return <AbsoluteFill style={{backgroundColor:"green"}}/>}'));
  const source=new PreviewOrigin();
  try {
    const bundle=await buildProgramBundle(request);
    const descriptor=await source.publish({...request,bundle,media:new Map(),parentOrigin:'http://127.0.0.1:43210',target:'candidate',baseline:'test',label:'候选',key:'b'.repeat(48)});
    const result=await capturePreviewFrames(descriptor,source.snapshot(descriptor.url),[0,15,29]);
    expect(result[0].image).toBeDefined();expect(result[0].error).toBeUndefined();
    expect(result[1].error).toBeTruthy();expect(result[1].image).toBeUndefined();
    expect(result[2].error).toBeTruthy();expect(result[2].image).toBeUndefined();
  }finally{await source.close();}
},120000);

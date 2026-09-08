import { createRequire as createEvidenceRequire } from 'node:module';
const sharp = createEvidenceRequire(import.meta.url)('sharp') as typeof import('sharp').default;
import { localExecutionCapsule } from './execution-capsule';
import { bundleApplicationWorker } from './program-toolchain';
import { programEnvironmentIdentity } from './program-bundle';
import type { PreviewDescriptor } from './preview-origin';
export type CapturedFrame = { frame: number; image?: Buffer; error?: string };
/** 有界分批驱动。实例字节完全复用；不连接工作台，也不操作用户浏览器。 */
export async function capturePreviewFrames(descriptor: PreviewDescriptor, files: ReadonlyMap<string, Buffer>, frames: number[], signal?: AbortSignal): Promise<CapturedFrame[]> {
  if (!descriptor.parentOrigin || frames.length < 1 || frames.length > 12 || new Set(frames).size !== frames.length || frames.some(frame => !Number.isSafeInteger(frame) || frame < 0 || frame >= descriptor.input.durationInFrames)) throw new Error('采集请求需包含准确实例及 1–12 个有效帧。');
  const { width,height } = descriptor.input.output;
  if (width > 4096 || height > 4096 || width * height > 8294400) throw new Error('采集输出超过 4096 边长或 8294400 像素上限。');
  if (await programEnvironmentIdentity() !== descriptor.identity.environment) throw new Error('执行环境已变化，不能采集旧 Preview。');
  const inputs: Record<string, Buffer> = { 'bundle/driver.mjs': await bundleApplicationWorker('evidence') };
  const urls: Record<string,string> = {};
  for (const [path, bytes] of files) {
    const target = path.startsWith('media/') ? path : `bundle/${path}`;
    inputs[target] = bytes; urls[new URL(path, descriptor.url).href] = target;
  }
  inputs['input/capture.json'] = Buffer.from(JSON.stringify({ descriptor, frames, files: urls, parentOrigin: descriptor.parentOrigin }));
  const capsule = await localExecutionCapsule();
  const output = await capsule.run({ stage: 'preview', entry: 'bundle/driver.mjs', inputs, signal }, async values => {
    const report = JSON.parse(values.get('result.json')?.toString() ?? 'null');
    if (report?.instanceId !== descriptor.instanceId || JSON.stringify(report.identity) !== JSON.stringify(descriptor.identity) || JSON.stringify(report.results?.map((item: CapturedFrame) => item.frame)) !== JSON.stringify(frames)) return false;
    if ([...values.keys()].some(name => name !== 'result.json' && !frames.some(frame => name === `${frame}.png`))) return false;
    for (const result of report.results) if (!result.error) {
      const png = values.get(`${result.frame}.png`); if (!png || png.length > 8 * 1024 * 1024) return false;
      const metadata = await sharp(png).metadata(); if (metadata.format !== 'png' || metadata.width !== width || metadata.height !== height) return false;
    }
    return true;
  });
  if (await programEnvironmentIdentity() !== descriptor.identity.environment) throw new Error('采集期间执行环境发生变化，结果已丢弃。');
  const report = JSON.parse(output.get('result.json')!.toString());
  return report.results.map((item: CapturedFrame) => ({ ...item, image: item.error ? undefined : output.get(`${item.frame}.png`) }));
}

import type { PreviewDescriptor } from './preview-origin';
import type { RuntimeSpeech } from './program-bundle';
import { capturePreviewFrames } from './preview-evidence';
import { localExecutionCapsule } from './execution-capsule';
import { bundleApplicationWorker } from './program-toolchain';

export class FinalRenderError extends Error {
  constructor(readonly code: string, message: string, readonly location?: { frame?: number; path?: string; sceneId?: string }) { super(message); }
}
export type RenderProgress = { stage: 'frames' | 'encoding'; renderedFrames?: number };
/** 视觉帧复用 Preview Bridge，音轨来自同一 Runtime 的只读 Speech 绑定。 */
export async function renderAcceptedProgram(descriptor: PreviewDescriptor, files: ReadonlyMap<string, Buffer>, speech: readonly RuntimeSpeech[], signal: AbortSignal, progress: (value: RenderProgress) => void): Promise<Buffer> {
  const capsule = await localExecutionCapsule(), driver = await bundleApplicationWorker('encode');
  const segments: Buffer[] = [];
  let segmentBytes = 0;
  async function encode(config: object, media: Record<string, Buffer>, final: boolean) {
    const output = await capsule.run({ stage: 'render', entry: 'bundle/encode.mjs', signal, inputs: {
      'bundle/encode.mjs': driver, 'input/encode.json': Buffer.from(JSON.stringify(config)), ...media,
    } }, values => {
      const failure = values.get('failure.json');
      if (failure) throw new FinalRenderError('RENDER_ENCODE_FAILED', '编码或音轨验证失败；恢复编码器与媒体解码条件后可重试。');
      if (!final) return values.size === 1 && (values.get('segment.mkv')?.length ?? 0) > 0;
      const verified = JSON.parse(values.get('verified.json')?.toString() ?? 'null');
      return values.size === 2 && (values.get('out.mp4')?.length ?? 0) > 0 && verified?.frames === descriptor.input.durationInFrames && JSON.stringify(verified.output) === JSON.stringify(descriptor.input.output);
    });
    return output.get(final ? 'out.mp4' : 'segment.mkv')!;
  }
  for (let start = 0; start < descriptor.input.durationInFrames; start += 12) {
    signal.throwIfAborted();
    const frames = Array.from({ length: Math.min(12, descriptor.input.durationInFrames - start) }, (_, index) => start + index);
    progress({ stage: 'frames', renderedFrames: start });
    const captured = await capturePreviewFrames(descriptor, files, frames, signal, 'render');
    const failed = captured.find(item => item.error || !item.image);
    if (failed) throw new FinalRenderError(failed.errorCode === 'RUNTIME_FRAME_FAILED' ? 'RENDER_FRAME_FAILED' : 'CAPSULE_EXECUTION_FAILED', failed.errorCode === 'RUNTIME_FRAME_FAILED' ? '此帧内容执行失败，请修复候选并重新验收。' : `帧采集操作失败；恢复浏览器或执行胶囊条件后可重试。${failed.error?.slice(0, 256) ?? ''}`, { frame: failed.frame });
    const segment = await encode({ mode: 'segment', fps: descriptor.input.output.fps, frames: frames.length }, Object.fromEntries(captured.map((item, i) => [`media/${i}.png`, item.image!])), false);
    segmentBytes += segment.length;
    if (segmentBytes > 256 * 1024 * 1024) throw new FinalRenderError('CAPSULE_RESOURCE_EXCEEDED', '无损帧段超过单次执行内存预算，未生成完整产物。');
    segments.push(segment); progress({ stage: 'frames', renderedFrames: start + frames.length });
  }
  progress({ stage: 'encoding' });
  const media: Record<string, Buffer> = Object.fromEntries(segments.map((bytes, index) => [`media/${index}.mkv`, bytes]));
  for (const track of speech) {
    const bytes = files.get(track.src);
    if (!bytes) throw new FinalRenderError('RENDER_MEDIA_CHANGED', 'Speech 字节缺失，请恢复原字节后重新检查。');
    media[track.src] = bytes;
  }
  return encode({ mode: 'final', output: descriptor.input.output, frames: descriptor.input.durationInFrames, segments: segments.length, speech }, media, true);
}

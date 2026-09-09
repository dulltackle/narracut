/** 固定编码驱动只读取胶囊输入；项目不能指定命令、过滤器或输出路径。 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const config = JSON.parse(await readFile('/inputs/input/encode.json', 'utf8'));
try {
  const args = ['-v', 'error', '-nostdin', '-n'];
  if (config.mode === 'segment') {
    args.push('-framerate', String(config.fps), '-i', '/inputs/media/%d.png', '-frames:v', String(config.frames), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-crf', '0', '/output/segment.mkv');
    await exec('/runtime/ffmpeg', args, { maxBuffer: 1048576 });
  } else {
    await writeFile('/tmp/segments.txt', Array.from({ length: config.segments }, (_, i) => `file '/inputs/media/${i}.mkv'`).join('\n'));
    args.push('-f', 'concat', '-safe', '0', '-i', '/tmp/segments.txt');
    const filters: string[] = [];
    for (const [index, track] of config.speech.entries()) {
      args.push('-i', `/inputs/${track.src}`);
      const duration = track.durationInFrames / config.output.fps;
      filters.push(`[${index + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`);
    }
    filters.push(config.speech.map((_: unknown, index: number) => `[a${index}]`).join('') + `concat=n=${config.speech.length}:v=0:a=1[audio]`);
    args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[audio]', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-crf', '18', '-c:a', 'aac', '-ar', '48000', '-t', String(config.frames / config.output.fps), '-movflags', '+faststart', '/output/out.mp4');
    await exec('/runtime/ffmpeg', args, { maxBuffer: 1048576 });
    const { stdout } = await exec('/runtime/ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', '/output/out.mp4'], { maxBuffer: 1048576 });
    const streams = JSON.parse(stdout).streams;
    const video = streams.find((stream: any) => stream.codec_type === 'video');
    if (!video || video.width !== config.output.width || video.height !== config.output.height || Number(video.nb_read_frames) !== config.frames || video.avg_frame_rate !== `${config.output.fps}/1` || !streams.some((stream: any) => stream.codec_type === 'audio')) throw new Error('产物帧数、画幅、帧率或 Speech 音轨验证失败');
    await writeFile('/output/verified.json', JSON.stringify({ frames: config.frames, output: config.output }));
  }
} catch (error) {
  await writeFile('/output/failure.json', JSON.stringify({ code: 'RENDER_ENCODE_FAILED', message: (error as Error).message.slice(0, 1000) }));
}

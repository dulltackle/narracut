/** 基础覆盖不截断；补点仅追加理由，同一帧只采集一次。帧号采用从零开始的半开时间窗。 */
export type SupplementalFrame = { frame: number; source: 'transition' | 'motion'; reason: string };
export type FrameReason = { kind: string; sceneId?: string; boundary?: string; reason?: string; source: 'system' | 'agent' };
export type PlannedFrame = { frame: number; reasons: FrameReason[] };
type Timeline = { durationInFrames: number; scenes: readonly { id: string; time: { startFrame: number; durationInFrames: number } }[] };
export function representativePlan(input: Timeline, supplemental: SupplementalFrame[] = []): PlannedFrame[] {
  const points = new Map<number, FrameReason[]>();
  function add(frame: number, reason: FrameReason) {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= input.durationInFrames) throw new Error('代表帧必须位于完整视频时间范围内。');
    const reasons = points.get(frame) ?? [];
    if (!reasons.some(item => JSON.stringify(item) === JSON.stringify(reason))) reasons.push(reason);
    points.set(frame, reasons);
  }
  if (input.scenes.length) {
    add(0, { kind: 'film-start', source: 'system' });
    add(input.durationInFrames - 1, { kind: 'film-end', source: 'system' });
    for (const [index, scene] of input.scenes.entries()) {
      const start = scene.time.startFrame, end = start + scene.time.durationInFrames - 1;
      for (const [frame, kind] of [[start, 'scene-start'], [start + Math.floor((scene.time.durationInFrames - 1) / 2), 'scene-middle'], [end, 'scene-end']] as const) add(frame, { kind, sceneId: scene.id, source: 'system' });
      if (index) {
        const boundary = `${input.scenes[index - 1].id}:${scene.id}`;
        add(start - 1, { kind: 'boundary-before', boundary, source: 'system' });
        add(start, { kind: 'boundary-after', boundary, source: 'system' });
      }
    }
  }
  for (const point of supplemental) {
    if (!['transition','motion'].includes(point.source) || typeof point.reason !== 'string' || !point.reason.trim() || point.reason.length > 2000) throw new Error('补充关键点需要来源与具体理由。');
    add(point.frame, { kind: point.source, reason: point.reason, source: 'agent' });
  }
  return [...points].sort(([a], [b]) => a - b).map(([frame, reasons]) => ({ frame, reasons }));
}

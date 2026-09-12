import { expect, test } from 'vitest';
import { representativePlan } from '../src/shared/representative-frames';
const input = { durationInFrames: 8, scenes: [
  { id: 'first', time: { startFrame: 0, durationInFrames: 3 } },
  { id: 'second', time: { startFrame: 3, durationInFrames: 5 } },
] };
test('计划确定性覆盖首尾、Scene 三点与边界两侧，同帧保留所有理由', () => {
  const plan = representativePlan(input, [{ frame: 4, source: 'transition', reason: '叠化峰值' }]);
  expect(plan.map(p => p.frame)).toEqual([0, 1, 2, 3, 4, 5, 7]);
  expect(plan.find(p => p.frame === 2)?.reasons).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'scene-end', sceneId: 'first' }),
    expect.objectContaining({ kind: 'boundary-before', boundary: 'first:second' }),
  ]));
  expect(plan.find(p => p.frame === 3)?.reasons).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'boundary-after', boundary: 'first:second' }),
  ]));
  expect(plan.find(p => p.frame === 4)?.reasons).toContainEqual({ kind: 'transition', reason: '叠化峰值', source: 'agent' });
  expect(representativePlan(input)).toEqual(representativePlan(input));
});
test('零 Scene 不伪造首帧；单帧 Scene 合并三点，大量 Scene 不静默截断', () => {
  expect(representativePlan({ durationInFrames: 0, scenes: [] })).toEqual([]);
  const single = representativePlan({ durationInFrames: 1, scenes: [{ id: 'one', time: { startFrame: 0, durationInFrames: 1 } }] });
  expect(single).toHaveLength(1); expect(single[0].reasons).toHaveLength(5);
  const many = representativePlan({ durationInFrames: 6000, scenes: Array.from({ length: 2000 }, (_, i) => ({ id: String(i), time: { startFrame: i * 3, durationInFrames: 3 } })) });
  expect(many).toHaveLength(6000); expect(many.at(-1)?.frame).toBe(5999);
  expect(() => representativePlan(input, [{ frame: 8, source: 'motion', reason: '越界' }])).toThrow();
});

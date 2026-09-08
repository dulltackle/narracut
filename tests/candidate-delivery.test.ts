import { expect, test } from 'vitest';
import { CandidateDelivery } from '../src/shared/candidate-delivery';
const identity = { project: 'p', program: 'program', baseline: 'baseline', brief: 'brief', input: 'input', media: 'media', environment: 'environment' };
const binding = { instanceId: 'preview-1', bundle: 'bundle', identity };
const input = { durationInFrames: 1, scenes: [{ id: 'scene', time: { startFrame: 0, durationInFrames: 1 } }] };
test('采集不等于检查，检查必须引用准确实例、帧和图像摘要，完整报告及警告展示后才齐备', () => {
  const delivery = new CandidateDelivery('delivery-1', binding, input);
  delivery.capture(0, 'sha256:image');
  expect(delivery.view().checked).toBe(0);
  expect(() => delivery.review(0, 'wrong', '已检查画面')).toThrow();
  delivery.review(0, 'sha256:image', '文字完整，未发现遮挡');
  expect(delivery.evidence().representativeFrames).toBe(true);
  expect(delivery.complete()).toBe(false);
  delivery.describe({ goal: '改善字幕', summary: '调整字幕位置', warnings: ['需用户判断节奏'], suggestions: [{ sceneId: 'scene', observation: '旁白过长', action: '缩短旁白', content: '建议保留关键句', reason: '便于理解' }] });
  expect(delivery.complete()).toBe(false);
  delivery.displayWarnings(delivery.view().reportRevision);
  expect(delivery.complete()).toBe(true);
  expect(delivery.evidence()).toMatchObject({ identity, instanceId: 'preview-1', bundle: 'bundle', explicitAcceptance: false });
});
test.each(Object.keys(identity))('完整状态中的 %s 变化使整套交付不可逆失效，不能混入后到结果', key => {
  const delivery = new CandidateDelivery('delivery', binding, input); delivery.capture(0, 'image');
  delivery.invalidate({ ...binding, identity: { ...identity, [key]: 'changed' } });
  expect(delivery.view().stale).toBe(true);
  expect(() => delivery.capture(0, 'late')).toThrow('过期');
  delivery.invalidate(binding); expect(delivery.view().stale).toBe(true);
});
test('同字节新 Preview 也使旧交付失效；失败项可重试但须重新检查', () => {
  const delivery = new CandidateDelivery('delivery', binding, input);
  delivery.fail(0, '媒体未就绪'); expect(delivery.view().frames[0].error).toBe('媒体未就绪');
  delivery.capture(0, 'first'); delivery.review(0, 'first', '已检查'); delivery.capture(0, 'second');
  expect(delivery.view().checked).toBe(0);
  delivery.invalidate({ ...binding, instanceId: 'preview-2' }); expect(delivery.complete()).toBe(false);
});
test('零 Scene 以构建绑定及完整报告交付；没有运行期帧', () => {
  const delivery = new CandidateDelivery('empty', binding, { durationInFrames: 0, scenes: [] });
  expect(delivery.view().frames).toEqual([]); expect(delivery.evidence().zeroScenes).toBe(true);
  delivery.describe({ goal: '建立程序', summary: '补齐 Manifest', warnings: [], suggestions: [] });
  delivery.displayWarnings(0); expect(delivery.complete()).toBe(false);
  delivery.displayWarnings(1); expect(delivery.complete()).toBe(true);
});

import { expect, test } from 'vitest';
import { CheckBatch, diagnostic, gateOperations, normalizeDiagnostics, type CheckIdentity } from '../src/shared/program-checks';
const identity: CheckIdentity = { project: 'project', program: 'program', baseline: 'baseline', brief: 'brief', input: 'input', media: 'media', environment: 'environment' };
test('检查图保留独立阶段事实，下游未运行；取消不生成诊断', async () => {
  const batch = new CheckBatch('batch', identity, [
    { id: 'manifest', dependencies: [], run: async () => [diagnostic('MANIFEST_INVALID', identity)] },
    { id: 'dependencies', dependencies: [], run: async () => [diagnostic('DEPENDENCY_UNAVAILABLE', identity)] },
    { id: 'bundle', dependencies: ['manifest', 'dependencies'], run: async () => [] },
  ]);
  await batch.run();
  expect(batch.view().stages.map(s => s.status)).toEqual(['issues', 'issues', 'not-run']);
  expect(batch.view().diagnostics.map(d => d.code)).toEqual(['MANIFEST_INVALID', 'DEPENDENCY_UNAVAILABLE']);
  const cancelled = new CheckBatch('cancel', identity, [{ id: 'bundle', dependencies: [], run: signal => new Promise(resolve => signal.addEventListener('abort', () => resolve([diagnostic('BUNDLE_FAILED', identity)]))) }]);
  const running = cancelled.run(); cancelled.cancel(); await running;
  expect(cancelled.view()).toMatchObject({ status: 'cancelled', diagnostics: [] });
  expect(gateOperations(cancelled.view(), null)[0].reason).toBe('检查已取消，结果不完整');
});
test('四类门禁各自判断，候选失败不影响已接受修订的 Render；草稿和零 Scene 允许 Preview', async () => {
  const batch = new CheckBatch('ok', identity, [{ id: 'bundle', dependencies: [], run: async () => [] }]); await batch.run();
  const evidence = { identity, bundle: 'bundle', instanceId: 'instance', previewReady: true, representativeFrames: false, warningsDisplayed: true, explicitAcceptance: false, zeroScenes: false };
  const accepted = { identity, bundle: 'accepted-bundle', currentBundle: 'accepted-bundle', recordFresh: true, renderReady: true, preflight: true, blocked: false };
  const enabled = { preview: true, delivery: true, accept: true, render: true };
  expect(gateOperations(batch.view(), identity, evidence, accepted, enabled).map(g => g.status)).toEqual(['available','blocked','blocked','available']);
  expect(gateOperations(batch.view(), identity, { ...evidence, zeroScenes: true, instanceId: null, previewReady: false }, accepted, enabled).map(g => g.status)).toEqual(['available','available','blocked','available']);
  expect(gateOperations(batch.view(), identity, { ...evidence, representativeFrames: true, explicitAcceptance: true }, accepted, enabled).map(g => g.status)).toEqual(['available','available','available','available']);
  batch.invalidate({ ...identity, program: 'changed' });
  expect(gateOperations(batch.view(), identity, evidence, accepted, enabled).map(g => g.status)).toEqual(['blocked','blocked','blocked','available']);
  expect(gateOperations(batch.view(), identity).at(-1)?.status).toBe('disabled');
});
test('任一身份变化整批永久过期；不同身份的结果拒绝拼接', async () => {
  for (const key of Object.keys(identity)) {
    const batch = new CheckBatch(key, identity, [{ id: 'manifest', dependencies: [], run: async () => [diagnostic('MANIFEST_INVALID', identity)] }]);
    await batch.run(); batch.invalidate({ ...identity, [key]: 'changed' }); batch.invalidate(identity);
    expect(batch.view().stale).toBe(true); expect(batch.view().diagnostics[0].identity).toEqual(identity);
  }
  const batch = new CheckBatch('mixed', identity, [{ id: 'manifest', dependencies: [], run: async () => [diagnostic('MANIFEST_INVALID', { ...identity, program: 'new' })] }]);
  await batch.run(); expect(batch.view()).toMatchObject({ stale: true, diagnostics: [], stages: [{ status: 'not-run' }] });
});
test('排序、完整字段去重与 100 条截断稳定，截断不能隐藏硬阻断', async () => {
  const values = Array.from({ length: 110 }, (_, index) => diagnostic('MANIFEST_UNKNOWN_FIELD', identity, { kind: 'file', path: `program-${String(index).padStart(3,'0')}.json` }));
  values.push(diagnostic('RUNTIME_FRAME_FAILED', identity, { kind: 'frame', frame: 8, instanceId: 'p' }));
  expect(normalizeDiagnostics([...values].reverse().concat(values))).toEqual(normalizeDiagnostics(values));
  const batch = new CheckBatch('many', identity, [{ id: 'runtime', dependencies: [], run: async () => values }]); await batch.run();
  expect(batch.view()).toMatchObject({ truncated: 11, total: 111, hardOperations: ['preview','delivery','accept'] });
  expect(batch.view().diagnostics).toHaveLength(100);
  expect(gateOperations(batch.view(), identity)[0].status).toBe('blocked');
  expect(values.at(-1)?.location).toEqual({ kind: 'frame', frame: 8, instanceId: 'p' });
});
test('稳定代码目录完整且每个代码有阶段、身份、建议与可证明主位置', async () => {
  const { diagnosticCatalog } = await import('../src/shared/program-checks');
  const codes = 'LAYOUT_INVALID LAYOUT_REQUIRED_PATH_MISSING LAYOUT_PATH_ESCAPE LAYOUT_FORBIDDEN_ARTIFACT MANIFEST_INVALID MANIFEST_API_UNSUPPORTED OUTPUT_FORMAT_INVALID MANIFEST_UNKNOWN_FIELD DEPENDENCY_MANIFEST_INVALID DEPENDENCY_LOCK_INVALID DEPENDENCY_LOCK_OUT_OF_SYNC DEPENDENCY_SOURCE_UNSUPPORTED DEPENDENCY_INTEGRITY_FAILED DEPENDENCY_UNAVAILABLE REMOTION_VERSION_MISMATCH DEPENDENCY_INSTALL_FAILED STATIC_FORBIDDEN_CAPABILITY STATIC_NONDETERMINISTIC_API STATIC_DEPRECATED_API TYPECHECK_FAILED BUNDLE_FAILED BUNDLE_SOURCEMAP_MISSING COMPOSITION_INVALID BUNDLE_FINGERPRINT_MISMATCH CAPSULE_UNAVAILABLE CAPSULE_SELF_TEST_FAILED CAPSULE_TIMEOUT CAPSULE_RESOURCE_EXCEEDED CAPSULE_RESOURCE_NEAR_LIMIT RUNTIME_ENTRY_INVALID RUNTIME_METADATA_INVALID RUNTIME_BRIDGE_FAILED RUNTIME_FRAME_FAILED RUNTIME_CONTRACT_VIOLATION RUNTIME_EXTERNAL_ACCESS_BLOCKED EVIDENCE_PLAN_INCOMPLETE EVIDENCE_CAPTURE_FAILED EVIDENCE_IDENTITY_MISMATCH RENDER_MEDIA_CHANGED RENDER_FRAME_FAILED RENDER_ENCODE_FAILED RENDER_OUTPUT_FAILED RESULT_TRUNCATED'.split(' ');
  expect(Object.keys(diagnosticCatalog).sort()).toEqual(codes.sort());
  for (const code of codes) {
    const fact = diagnostic(code, identity);
    expect(fact.identity).toEqual(identity); expect(fact.location).toEqual({ kind: 'project' });
    expect(fact.message.length).toBeGreaterThan(0); expect(fact.suggestion.length).toBeGreaterThan(0);
    if (fact.severity === 'warning') expect(fact.operations).toEqual([]);
    else expect(fact.operations.length).toBeGreaterThan(0);
  }
});
test('证据阶段缺失不阻断 Preview，但阻断交付与接受', async () => {
  const batch = new CheckBatch('evidence', identity, [
    { id: 'bundle', dependencies: [], run: async () => [] },
    { id: 'evidence', dependencies: ['bundle'], run: async () => [diagnostic('EVIDENCE_PLAN_INCOMPLETE', identity)] },
  ]); await batch.run();
  expect(gateOperations(batch.view(), identity).map(item => item.status)).toEqual(['available','blocked','disabled','disabled']);
});
test('主观视觉建议独立于诊断且不阻断，交付前必须实际展示', async () => {
  const batch = new CheckBatch('visual', identity, [{ id: 'bundle', dependencies: [], run: async () => [] }], [{ id: 'pacing', identity, message: '节奏可能偏快', suggestion: '由用户判断停留时间', location: { kind: 'project' } }]); await batch.run();
  expect(batch.view().diagnostics).toEqual([]); expect(batch.view().hardOperations).toEqual([]);
  const evidence = { identity, bundle: 'b', instanceId: 'p', previewReady: true, representativeFrames: true, warningsDisplayed: false, explicitAcceptance: false, zeroScenes: false };
  expect(gateOperations(batch.view(), identity, evidence).map(item => item.status)).toEqual(['available','blocked','disabled','disabled']);
  expect(gateOperations(batch.view(), identity, { ...evidence, warningsDisplayed: true })[1].status).toBe('available');
});

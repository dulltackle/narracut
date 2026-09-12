import { expect, it } from 'vitest';
import { ExecutionCapsule } from '../src/server/execution-capsule';
import { observeCapsuleServiceResults } from './helpers/capsule-service-results';

// 仅由 test:capsule:oom 显式开启，日常测试不得故意触发桌面内存通知。
it.skipIf(process.env.NARRACUT_TEST_CAPSULE_OOM !== '1')('内存压力诊断真实触发内核 OOM，并正确识别资源超限', async () => {
  const capsule = await ExecutionCapsule.local();
  try {
    await capsule.certify();
    const results = await observeCapsuleServiceResults(() => capsule.diagnoseMemoryLimit());
    // 同时检查 OS 证据，避免只有 supervisor 的 exit 73 就误判内存隔离已验证。
    expect(results).toContain('oom-kill');
  } finally { await capsule.dispose(); }
}, 30_000);

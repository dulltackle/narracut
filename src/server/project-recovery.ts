import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, open, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';
import { identity, readTree, regular, syncDirectory } from './project-candidate';
import { parseStrictJson } from './strict-json';

export const recoveryHash = (bytes: string | Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const fingerprint = z.object({ path: z.string(), fingerprint: digest.nullable(), bindings: z.record(z.string(), digest.nullable()).optional() }).strict();
const component = z.object({ bytes: z.number().int().nonnegative(), sha256: digest, base64: z.string() }).strict();
const baseline = z.object({ projectId: z.uuid(), dsl: z.array(fingerprint).min(1).max(2), brief: z.array(fingerprint).min(1).max(2), current: z.array(fingerprint).min(1).max(2), candidate: z.array(fingerprint).min(1).max(2) }).strict();
const cutSchema = z.object({ recoveryCutId: z.uuid(), capturedAt: z.iso.datetime(), sourcePath: z.string(), projectId: z.uuid(), sourceFormatVersion: z.literal(1), baseline, payload: z.object({ dsl: component.optional(), briefLocal: component.optional(), briefBase: component.optional() }).strict() }).strict();
const envelopeSchema = cutSchema.extend({ kind: z.literal('narracut-recovery'), snapshotFormatVersion: z.literal(1), snapshotId: z.uuid(), exportedAt: z.iso.datetime(), sha256: digest }).strict();
export type RecoveryCut = z.infer<typeof cutSchema>;
export type RecoveryBaseline = z.infer<typeof baseline>;
export type RecoveryCommit = (path: string, bytes: Buffer, committed: boolean) => void;
export type RecoveryDraft = { dsl?: string; briefLocal?: string; briefBase?: string };
const encode = (text: string) => { const bytes = Buffer.from(text); if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== text) throw new Error('恢复内容必须是严格 UTF-8。'); return { bytes: bytes.length, sha256: recoveryHash(bytes), base64: bytes.toString('base64') }; };
export async function recoveryBaseline(root: string, projectId: string, previous?: RecoveryBaseline): Promise<RecoveryBaseline> {
  const read = async (path: string, optional = false) => {
    try { return [{ path, fingerprint: recoveryHash(await regular(join(root, path), 32 * 1024 * 1024)) }]; }
    catch (error) { if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return [{ path, fingerprint: null }]; throw error; }
  };
  const current = await read('.narracut/current.json'), candidate = await read('.narracut/candidate.json', true);
  const bind = async (entries: RecoveryBaseline['current'], old: RecoveryBaseline['current'] | undefined) => {
    if (old?.length === 1 && old[0].fingerprint === entries[0].fingerprint) return old;
    if (entries[0].fingerprint === null) return [{ ...entries[0], bindings: { candidate: null, checkpoint: null, dependencies: null } }];
    const bytes = await regular(join(root, entries[0].path));
    if (recoveryHash(bytes) !== entries[0].fingerprint) throw new Error('读取恢复基线时发生并发修改。');
    const bindings = recoveryBindings(entries[0].path, bytes);
    if (entries[0].path.endsWith('/current.json') && !Object.keys(bindings).length) {
      const pointer = JSON.parse(bytes.toString());
      if (!/^[0-9a-f-]{36}$/i.test(pointer.revisionId)) throw new Error('当前修订身份无效。');
      const path = `.narracut/revisions/${pointer.revisionId}`;
      bindings[`${path}/revision.json`] = recoveryHash(await regular(join(root, path, 'revision.json')));
      bindings[`${path}/render-program`] = identity(await readTree(join(root, path, 'render-program')));
    }
    return [{ ...entries[0], bindings }];
  };
  return { projectId, dsl: await read('project.json'), brief: await read('video.md'), current: await bind(current, previous?.current), candidate: await bind(candidate, previous?.candidate) };
}
/** 原子指针的精确字节指纹之外，逐项记录它所绑定的持久对象；不携带对象载荷。 */
export function recoveryBindings(path: string, bytes: Buffer): Record<string, string | null> {
  const value = JSON.parse(bytes.toString()), bindings: Record<string, string | null> = {};
  if (path.endsWith('/current.json')) {
    for (const ref of value.history ?? []) {
      bindings[`.narracut/revisions/${ref.revisionId}/revision.json`] = ref.metadata;
      bindings[`.narracut/revisions/${ref.revisionId}/render-program`] = ref.program;
    }
  } else if (path.endsWith('/candidate.json')) {
    bindings[value.candidate?.path ?? 'candidate'] = value.candidate?.identity ?? null;
    bindings[value.checkpoint?.path ?? 'checkpoint'] = value.checkpoint?.identity ?? null;
    bindings[value.offline ?? 'dependencies'] = value.offlineIdentity ?? null;
  }
  return bindings;
}
export function sealRecovery(sourcePath: string, projectId: string, baseline: RecoveryBaseline, draft: RecoveryDraft): RecoveryCut | null {
  const payload: RecoveryCut['payload'] = {};
  if (draft.dsl !== undefined && !(baseline.dsl.length === 1 && baseline.dsl[0].fingerprint === recoveryHash(draft.dsl!))) payload.dsl = encode(draft.dsl);
  if (draft.briefLocal !== undefined && !(baseline.brief.length === 1 && baseline.brief[0].fingerprint === recoveryHash(draft.briefLocal!))) {
    payload.briefLocal = encode(draft.briefLocal);
    if (draft.briefBase !== undefined && baseline.brief.some(item => item.fingerprint !== recoveryHash(draft.briefBase!))) payload.briefBase = encode(draft.briefBase);
  }
  if (!payload.dsl && !payload.briefLocal) return null;
  const cut = cutSchema.parse({ recoveryCutId: randomUUID(), capturedAt: new Date().toISOString(), sourcePath, projectId, sourceFormatVersion: 1, baseline: structuredClone(baseline), payload });
  validateRecovery(envelope(cut));
  return cut;
}
function envelope(cut: RecoveryCut) {
  const body = { ...cut, kind: 'narracut-recovery' as const, snapshotFormatVersion: 1 as const, snapshotId: randomUUID(), exportedAt: new Date().toISOString() };
  return JSON.stringify({ ...body, sha256: recoveryHash(JSON.stringify(body)) });
}
export function validateRecovery(text: string) {
  if (Buffer.byteLength(text) > 52 * 1024 * 1024) throw new Error('恢复快照超过大小上限。');
  // 编码载荷不接受 JSON 转义，即使解码后碰巧得到有效 Base64。
  if (/"base64"\s*:\s*"[^"\n]*\\/.test(text)) throw new Error('恢复载荷不能包含 JSON 转义。');
  const raw = parseStrictJson(text, { maxDepth: 12, maxArrayItems: 64, maxObjectFields: 1024, maxNodes: 2048, maxStringScalars: 52 * 1024 * 1024, maxStringBytes: 52 * 1024 * 1024, maxNumberBytes: 32 }) as Record<string, unknown>;
  const value = envelopeSchema.parse(raw);
  const { sha256, ...body } = raw;
  if (recoveryHash(JSON.stringify(body)) !== sha256 || !isAbsolute(value.sourcePath) || value.projectId !== value.baseline.projectId || !value.payload.dsl && !value.payload.briefLocal || value.payload.briefBase && !value.payload.briefLocal) throw new Error('恢复信封内容或摘要无效。');
  const paths = { dsl: 'project.json', brief: 'video.md', current: '.narracut/current.json', candidate: '.narracut/candidate.json' };
  for (const [key, path] of Object.entries(paths)) {
    const entries = value.baseline[key as keyof typeof paths];
    if (entries.some(item => item.path !== path || key !== 'candidate' && item.fingerprint === null || ['dsl', 'brief'].includes(key) && item.bindings !== undefined)) throw new Error('逐项恢复基线与组件不匹配。');
    for (const item of entries) {
      if (key === 'current') {
        const bindings = item.bindings;
        if (!bindings || !Object.keys(bindings).length || Object.keys(bindings).length > 40 || Object.entries(bindings).some(([path, digest]) => digest === null || !/^\.narracut\/revisions\/[0-9a-f-]{36}\/(revision\.json|render-program)$/.test(path))) throw new Error('当前修订与历史缺少精确身份绑定。');
        for (const path of Object.keys(bindings)) {
          const sibling = path.endsWith('/revision.json') ? path.replace(/revision\.json$/, 'render-program') : path.replace(/render-program$/, 'revision.json');
          if (!(sibling in bindings)) throw new Error('历史修订的程序与元数据绑定不完整。');
        }
      }
      if (key === 'candidate') {
        const bindings = item.bindings;
        const entries = Object.entries(bindings ?? {});
        const roles = entries.map(([path, digest]) => {
          if (['candidate', 'checkpoint', 'dependencies'].includes(path) && digest === null) return path;
          if (/^\.narracut\/candidate-[0-9a-f-]{36}\/(candidate|checkpoint|dependencies)$/.test(path) && digest !== null) return path.split('/').at(-1);
          throw new Error('候选、恢复检查点或依赖基线无效。');
        });
        if (entries.length !== 3 || new Set(roles).size !== 3 || item.fingerprint === null && entries.some(([, digest]) => digest !== null)) throw new Error('候选、恢复检查点与依赖绑定不完整。');
      }
    }
  }
  const encodedLiterals = [...text.matchAll(/"base64"\s*:\s*"([^"\\]*)"/g)].map(match => match[1]);
  if (encodedLiterals.length !== Object.keys(value.payload).length || Object.values(value.payload).some(item => !encodedLiterals.includes(item.base64))) throw new Error('恢复载荷必须使用未转义的规范 Base64 字面量。');
  for (const [key, item] of Object.entries(value.payload)) {
    const max = key === 'dsl' ? 32 * 1024 * 1024 : 2 * 1024 * 1024;
    if (item.bytes > max || item.base64.length !== 4 * Math.ceil(item.bytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.base64)) throw new Error('恢复载荷编码或长度无效。');
    const bytes = Buffer.from(item.base64, 'base64');
    if (bytes.toString('base64') !== item.base64 || bytes.length !== item.bytes || recoveryHash(bytes) !== item.sha256) throw new Error('恢复载荷摘要无效。');
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  return value;
}
const inside = (root: string, path: string) => { const rel = relative(root, path); return !rel || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
/** 导出记录属于会话：丢失响应后以同一操作 ID 核对，不重新发布。 */
export class RecoveryExportUncertain extends Error {
  constructor(readonly path: string, readonly snapshotId: string, readonly sha256: string) { super('导出已进入提交阶段，正在核对持久结果。'); }
}
export class RecoveryExports {
  #operations = new Map<string, { target: string; cutId: string; result: Promise<{ path: string; snapshotId: string }> }>();
  async run(cut: RecoveryCut, target: string, operationId: string, rootIdentity?: { dev: number; ino: number }) {
    z.uuid().parse(operationId);
    const previous = this.#operations.get(operationId);
    if (previous) { if (previous.target !== target || previous.cutId !== cut.recoveryCutId) throw new Error('导出操作 ID 与目标不匹配。'); return previous.result; }
    const result = this.#publish(structuredClone(cut), target, rootIdentity);
    this.#operations.set(operationId, { target, cutId: cut.recoveryCutId, result });
    return result;
  }
  async status(operationId: string) {
    const operation = this.#operations.get(operationId);
    if (!operation) throw new Error('尚未收到该导出请求；可以重试原操作。');
    try { return await operation.result; }
    catch (error) {
      if (!(error instanceof RecoveryExportUncertain)) throw error;
      try {
        const value = validateRecovery((await regular(error.path, 52 * 1024 * 1024)).toString('utf8'));
        if (value.snapshotId !== error.snapshotId || value.sha256 !== error.sha256) throw error;
        await syncDirectory(dirname(error.path));
        return { path: error.path, snapshotId: error.snapshotId };
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('导出文件不存在，未确认保存；请重新导出。');
        throw error;
      }
    }
  }
  async #publish(cut: RecoveryCut, target: string, rootIdentity?: { dev: number; ino: number }) {
    if (!isAbsolute(target) || !target.endsWith('.narracut-recovery.json')) throw new Error('请选择项目外的新 .narracut-recovery.json 文件。');
    const parent = await realpath(dirname(target));
    const source = await realpath(cut.sourcePath).catch(() => cut.sourcePath);
    if (inside(cut.sourcePath, parent) || inside(source, parent)) throw new Error('恢复快照必须位于项目目录之外。');
    if (rootIdentity) {
      for (let ancestor = parent; ; ancestor = dirname(ancestor)) {
        const facts = await lstat(ancestor);
        if (facts.dev === rootIdentity.dev && facts.ino === rootIdentity.ino) throw new Error('恢复快照不能写入已移动的原项目目录。');
        if (dirname(ancestor) === ancestor) break;
      }
    }
    const parentHandle = await open(parent, 'r');
    const parentFacts = await parentHandle.stat();
    const anchored = process.platform === 'win32' ? parent : `/dev/fd/${parentHandle.fd}`;
    const publishedPath = join(parent, basename(target));
    const path = join(anchored, basename(target));
    const verifyParent = async () => {
      const current = await lstat(parent);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== parentFacts.dev || current.ino !== parentFacts.ino) throw new Error('导出目录已变化，请选择稳定的目录后重试。');
    };
    try {
    await verifyParent();
    try { await lstat(path); throw new Error('目标已存在，请选择新文件。'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = join(anchored, `.recovery-${randomUUID()}.tmp`);
    const bytes = envelope(cut), verified = validateRecovery(bytes);
    let publishing = false;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.chmod(0o600); await handle.sync(); } finally { await handle.close(); }
      validateRecovery((await regular(temporary, 52 * 1024 * 1024)).toString('utf8'));
      // Node 的 rename 会覆盖并发目标。用同文件系统 link 原子发布新名称，
      // 再移除临时名称，实现不覆盖的更名语义；目标从不可见直接变为完整快照。
      await verifyParent();
      publishing = true;
      await link(temporary, path);
      await rm(temporary);
      await parentHandle.sync();
      const persisted = validateRecovery((await regular(path, 52 * 1024 * 1024)).toString('utf8'));
      if (persisted.snapshotId !== verified.snapshotId || persisted.sha256 !== verified.sha256) throw new Error('导出结果尚不能确认；请保留目标文件。');
      return { path: publishedPath, snapshotId: persisted.snapshotId };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('目标已存在，请选择新文件。');
      if (publishing) throw new RecoveryExportUncertain(publishedPath, verified.snapshotId, verified.sha256);
      throw error;
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    } finally { await parentHandle.close(); }
  }
}

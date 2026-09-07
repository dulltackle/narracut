import type { OutputFormat } from '../runtime';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import type { OpenedProjectVNext } from './project-lifecycle';
import { inspectProjectVNext } from './project-vnext-inspection';
import { checkProgramManifest, programEnvironmentIdentity, type RuntimeSpeech } from './program-bundle';
import { createRenderProgramInput } from './render-program-input';
import { PreviewOrigin, previewDigest, type PreviewFreshness, type PreviewDescriptor } from './preview-origin';

/** 不跟随链接，且在读取前后核对普通文件身份；保留的媒体是字节副本。 */
async function snapshotFile(root: string, path: string, limit: number) {
  const full = join(root, path), resolved = await realpath(full), rel = relative(await realpath(root), resolved);
  if (rel.startsWith('..') || isAbsolute(rel) || (await lstat(full)).isSymbolicLink()) throw new Error('Preview 文件越过项目边界。');
  const expected = await lstat(resolved);
  const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.dev !== expected.dev || before.ino !== expected.ino || await realpath(full) !== resolved || before.size > limit) throw new Error('Preview 文件不可用或超过内存上限。');
    const bytes = await file.readFile(); const after = await file.stat();
    if (await realpath(full) !== resolved || bytes.length > limit || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Preview 读取期间媒体发生变化。');
    return bytes;
  } finally { await file.close(); }
}
export class ProjectPreview {
  readonly source = new PreviewOrigin();
  #active = new Map<string, { descriptor: PreviewDescriptor; brief: string; input: string; revision: string; sourceIdentity: string }>();
  async #observe(opened: OpenedProjectVNext, output: OutputFormat) {
    const root = opened.inspection.projectDirectory;
    const state = await inspectProjectVNext(root);
    if (state.manifest.projectId !== opened.inspection.manifest.projectId) throw new Error('项目身份失效，请重新打开。');
    const media = new Map<string, Buffer>(), assetSources = new Map<string, string>();
    let total = 0;
    async function add(path: string) {
      const bytes = await snapshotFile(root, path, 256 * 1024 * 1024);
      total += bytes.length; if (total > 512 * 1024 * 1024) throw new Error('Preview 媒体超过 512 MiB，请缩小素材后重试。');
      const key = `media/${previewDigest(bytes).slice(7)}`; media.set(key, bytes); return key;
    }
    const referenced = new Set(state.project.scenes.flatMap(scene => scene.assetIds));
    for (const asset of state.assetStates) if (referenced.has(asset.id) && asset.status === 'available') assetSources.set(asset.id, await add(asset.path));
    const input = createRenderProgramInput(state, output, assetSources);
    const speech: RuntimeSpeech[] = [];
    for (const scene of input.scenes) if (scene.time.source === 'speech') {
      const source = state.project.scenes.find(item => item.id === scene.id)!.speech!;
      speech.push({ sceneId: scene.id, startFrame: scene.time.startFrame, durationInFrames: scene.time.durationInFrames, src: await add(source.path) });
    }
    return { state, input, speech, media };
  }
  async capture(opened: OpenedProjectVNext, target: 'current' | 'candidate') {
    const candidate = await opened.candidate({ action: 'read' });
    const source = await opened.readPreviewSource(target);
    const manifest = source.manifest;
    const { state, input, speech, media } = await this.#observe(opened, checkProgramManifest(manifest).output);
    const signature = previewDigest(JSON.stringify([state.projectRevision, state.videoBriefRevision, target === 'candidate' ? candidate.baseline : source.revision, source.identity, manifest.toString(), [...media.keys()].sort(), input, speech]));
    return { input, speech, media, signature, brief: state.videoBriefRevision, projectInput: previewDigest(JSON.stringify([state.projectRevision, input, speech])), baseline: candidate.baseline, sourceIdentity: source.identity, revision: source.revision, candidate };
  }
  async build(opened: OpenedProjectVNext, target: 'current' | 'candidate', parentOrigin: string) {
    if (this.#active.size >= 4) throw new Error('Preview 实例已达上限，请关闭隐藏实例后重试。');
    const before = await this.capture(opened, target);
    const bundle = await opened.buildCandidateBundle({ input: before.input, speech: before.speech, baseline: before.baseline, sourceIdentity: before.sourceIdentity, target });
    const after = await this.capture(opened, target);
    if (before.signature !== after.signature) throw new Error('构建期间输入或媒体已变化，请重试。');
    const descriptor = await this.source.publish({ ...before, bundle, target, parentOrigin, key: randomBytes(24).toString('hex'), label: target === 'candidate' ? `候选 · ${before.candidate.candidate!.identity.slice(7, 15)}` : `当前 · ${before.revision.slice(0, 8)}` });
    this.#active.set(descriptor.instanceId, { descriptor, brief: before.brief, input: before.projectInput, revision: before.revision, sourceIdentity: before.sourceIdentity });
    descriptor.freshness = (await this.status(opened, descriptor.instanceId)).freshness;
    return descriptor;
  }
  async status(opened: OpenedProjectVNext, instanceId: string) {
    const unknown = (): PreviewFreshness => ({ brief: { status: 'unknown', review: 'unknown' }, input: { status: 'unknown' }, media: { status: 'unknown' }, environment: { status: 'unknown' } });
    const entry = this.#active.get(instanceId); if (!entry) return { stale: true, freshness: unknown() };
    const freshness = unknown();
    const compare = (captured: string, latest: string) => ({ status: captured === latest ? 'latest' as const : 'stale' as const, captured, latest });
    let sourceStale = true;
    try {
      const { state, media, input, speech } = await this.#observe(opened, entry.descriptor.input.output);
      if (state.manifest.projectId !== opened.inspection.manifest.projectId) throw new Error('项目身份失效');
      freshness.brief = { ...compare(entry.brief, state.videoBriefRevision), review: 'unknown' };
      freshness.input = compare(entry.input, previewDigest(JSON.stringify([state.projectRevision, input, speech])));
      const mediaIdentity = previewDigest(JSON.stringify([...media].map(([path, bytes]) => [path, previewDigest(bytes)]).sort()));
      freshness.media = compare(entry.descriptor.identity.media, mediaIdentity);
      const metadata = JSON.parse((await snapshotFile(state.projectDirectory, `.narracut/revisions/${entry.revision}/revision.json`, 16384)).toString());
      const reviewed = metadata.revisionId === entry.revision && /^sha256:[0-9a-f]{64}$/.test(metadata.briefFingerprint) ? metadata.briefFingerprint : undefined;
      // 候选没有接受证据；当前修订的 Brief 复核只认对应修订的持久指纹。
      freshness.brief.review = entry.descriptor.target === 'candidate' ? 'pending' : reviewed ? (reviewed === state.videoBriefRevision && entry.brief === reviewed ? 'reviewed' : 'pending') : 'unknown';
      freshness.brief.reviewed = reviewed;
    } catch { /* 无法证明的分项保留 unknown。 */ }
    try {
      const source = await opened.readPreviewSource(entry.descriptor.target);
      sourceStale = source.identity !== entry.sourceIdentity || (entry.descriptor.target === 'current' ? source.revision !== entry.revision : source.baseline !== entry.descriptor.baseline);
    } catch { /* 源码不完整时保留旧画面，不能冒充最新成功结果。 */ }
    try { freshness.environment = compare(entry.descriptor.identity.environment, await programEnvironmentIdentity()); }
    catch { /* 执行环境无法认证时不声称最新。 */ }
    return { stale: sourceStale || Object.values(freshness).some(item => item.status !== 'latest'), freshness };
  }
  release(instanceId: string) { const entry = this.#active.get(instanceId); if (entry) this.source.release(entry.descriptor.url); this.#active.delete(instanceId); }
  clear() { for (const entry of this.#active.values()) this.source.release(entry.descriptor.url); this.#active.clear(); }
  async close() { this.clear(); await this.source.close(); }
}

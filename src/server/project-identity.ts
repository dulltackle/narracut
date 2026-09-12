import { endedTaskReason } from './project-revisions';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rename, rm } from 'node:fs/promises';
import { regular, writeBytes, syncDirectory } from './project-candidate';

const markerName = 'identity-transition.json';
export function copiedTask(bytes: Buffer, oldId: string, newId: string, detached = false): Buffer | null {
  const task = JSON.parse(bytes.toString());
  if (task.projectId !== oldId || typeof task.taskId !== 'string') throw new Error('任务检查点项目身份无效。');
  if (task.status === 'terminated') return null;
  if (!['running', 'waiting', 'stopped'].includes(task.status) || !detached && task.status !== 'stopped') throw new Error('来源任务尚未安全停止。');
  return Buffer.from(JSON.stringify({ ...task, projectId: newId, taskId: randomUUID(), status: 'stopped', reason: 'PROJECT_COPIED', threadPointer: null, inputIdentity: null, toolApproval: null, pendingMessage: null, ...(task.waitingReason === 'TOOL_APPROVAL_REQUIRED' || task.reason === 'TOOL_APPROVAL_REQUIRED' ? { waitingReason: null, pending: null } : {}) }));
}
async function optional(path: string) {
  try { return await regular(path, 20_000_000); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
/** 清单是身份转换提交点；同目录事务记录只供提交后的任务检查点收尾，不形成外部索引。 */
export async function finishIdentityTransition(root: string, projectId: string) {
  const marker = join(root, '.narracut', markerName);
  const bytes = await optional(marker);
  if (!bytes) return;
  const transition = JSON.parse(bytes.toString());
  if (transition.version !== 1 || typeof transition.oldId !== 'string' || typeof transition.newId !== 'string' || !(transition.task === null || typeof transition.task === 'string')) throw new Error('身份转换记录损坏。');
  if (projectId === transition.newId) {
    const path = join(root, '.narracut', 'agent-task.json');
    if (transition.task === null) await rm(path, { force: true });
    else {
      const task = JSON.parse(transition.task);
      if (task.projectId !== projectId || task.status !== 'stopped' || task.threadPointer !== null) throw new Error('身份转换任务记录无效。');
      const temporary = join(root, '.narracut', `.task-${randomUUID()}`);
      await writeBytes(temporary, Buffer.from(transition.task));
      await rename(temporary, path);
    }
    await syncDirectory(join(root, '.narracut'));
  } else if (projectId !== transition.oldId) throw new Error('身份转换记录与项目不匹配。');
  await rm(marker);
}
export async function changeProjectIdentity(root: string, oldId: string, assertWritable: () => Promise<void>) {
  const newId = randomUUID(), internal = join(root, '.narracut');
  const checkpoint = await optional(join(internal, 'agent-task.json'));
  const task = checkpoint && !await endedTaskReason(root) ? copiedTask(checkpoint, oldId, newId, true)?.toString() ?? null : null;
  const marker = join(internal, markerName);
  await writeBytes(marker, Buffer.from(JSON.stringify({ version: 1, oldId, newId, task })));
  await syncDirectory(internal);
  const temporary = join(root, `.narracut.json.${randomUUID()}.tmp`);
  try {
    await writeBytes(temporary, Buffer.from(JSON.stringify({ kind: 'narracut-project', formatVersion: 1, projectId: newId })));
    await assertWritable();
    await rename(temporary, join(root, 'narracut.json'));
    await syncDirectory(root);
    await finishIdentityTransition(root, newId);
    return newId;
  } finally { await rm(temporary, { force: true }); }
}

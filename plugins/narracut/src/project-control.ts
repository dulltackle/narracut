import { AsyncLocalStorage } from 'node:async_hooks';

/** 请求携带的权限代次在存储提交点再次核对；撤权后不能补交旧请求。 */
export const projectWriteContext = new AsyncLocalStorage<() => void>();
export function assertProjectRequestAccess() { projectWriteContext.getStore()?.(); }

/** 默认拒写。只有确认不启动执行、不修改项目或共享审阅状态的操作允许代理。 */
export function isProjectRead(name: string, args: any = {}) {
  if (['get_workbench', 'inspect_project', 'read_project_asset_preview', 'get_scene_speech_job', 'get_creation_task'].includes(name)) return true;
  const actions: Record<string, string[]> = {
    manage_project_candidate: ['read'], project_preview: ['status', 'view'], project_checks: ['status'],
    project_delivery: ['status', 'image'], project_acceptance: ['history', 'result'],
    project_render: ['status', 'result'],
  };
  return actions[name]?.includes(args?.action) === true;
}

export function controlFailure(message = '项目由另一对话控制。请在当前 Codex 对话中输入“接管此项目”。') {
  return { isError: true, structuredContent: { error: { code: 'PROJECT_CONTROL_REQUIRED', message } }, content: [] };
}

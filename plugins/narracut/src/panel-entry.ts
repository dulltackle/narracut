import { startWorkbenchPanel } from './workbench-panel';

const [action, directory, ...extra] = process.argv.slice(2);
if ((action !== undefined && !['--open', '--create'].includes(action)) || (action && !directory) || extra.length) {
  throw new Error('用法：node panel.mjs [--open 项目绝对目录 | --create 不存在的项目绝对目录]');
}
// 必须从当前对话的 Shell 启动，不能把共享 MCP 服务的环境当成当前调用身份。
const panel = await startWorkbenchPanel({ threadId: process.env.CODEX_THREAD_ID });
let project;
if (action) {
  try {
    const response = await fetch(`${panel.url}rpc`, {
      method: 'POST', headers: { Origin: new URL(panel.url).origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: action === '--create' ? 'create_project' : 'open_project', arguments: { projectDirectory: directory },
      } }),
    });
    const reply = await response.json();
    const result = reply.result?.structuredContent;
    project = result ? { status: result.status, operation: result.operation, project: result.project, error: result.error } : reply;
  } catch (error) { project = { error: { message: (error as Error).message } }; }
}
console.log(JSON.stringify({ status: panel.status, url: panel.url, conversation: panel.conversation, project,
  next: '使用 open_in_codex：placement=right，target.type=browser，target.url=上述 url，省略 threadId。仅当宿主确认打开且页面可用后报告展示成功；失败时在当前对话报告具体原因并重试同一 url，不重建项目。',
}));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void panel.close().then(() => process.exit(0)); });

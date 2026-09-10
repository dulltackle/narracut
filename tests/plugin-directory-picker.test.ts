import { afterEach, expect, it, vi } from 'vitest';
import { selectProjectDirectory } from '../plugins/narracut/src/directory-picker';
import { handleRequest } from '../plugins/narracut/src/server';

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), execFile: run }));
afterEach(() => vi.resetAllMocks());

it('工作台专用工具返回系统选择的中文和空格路径，不要求已有项目', async () => {
  run.mockImplementation((_command, _args, _options, callback) => callback(null, '/tmp/中文 项目\n', ''));
  const tools: any = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  expect(tools.tools.find((tool: any) => tool.name === 'select_project_directory')._meta.ui.visibility).toEqual(['app']);
  const result: any = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'select_project_directory', arguments: { purpose: 'create-parent' } } });
  expect(result.structuredContent).toEqual({ path: '/tmp/中文 项目' });
  expect(result.isError).not.toBe(true);
  expect(run.mock.calls[0]![2]).not.toHaveProperty('shell');
});

it('取消系统窗口返回空选择，不触发项目操作', async () => {
  run.mockImplementation((_command, _args, _options, callback) => callback(null, '', ''));
  expect(await selectProjectDirectory({ purpose: 'open-project' })).toEqual({ path: null });
});

it.skipIf(process.platform !== 'linux')('Zenity 取消退出码不当作失败', async () => {
  run.mockImplementation((_command, _args, _options, callback) => callback({ code: 1 }, '', 'Gtk-Message: 非致命提示'));
  expect(await selectProjectDirectory({ purpose: 'open-project' })).toEqual({ path: null });
});

it('参数与系统返回路径必须有效，错误不泄露子进程输出', async () => {
  await expect(selectProjectDirectory({ purpose: 'open-project', path: '/tmp' })).rejects.toThrow('用途无效');
  expect(run).not.toHaveBeenCalled();
  run.mockImplementation((_command, _args, _options, callback) => callback(null, 'relative/path\n', ''));
  await expect(selectProjectDirectory({ purpose: 'open-project' })).rejects.toThrow('目录路径无效');
  run.mockImplementation((_command, _args, _options, callback) => callback({ code: 'ENOENT' }, '', '不应展示的环境信息'));
  const result: any = await handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'select_project_directory', arguments: { purpose: 'open-project' } } });
  expect(result.isError).toBe(true);
  expect(result.structuredContent.error.message).toContain('选择器不可用');
  expect(JSON.stringify(result)).not.toContain('不应展示');
});

it('一次只允许一个系统窗口，完成后可以重新选择', async () => {
  let finish!: (...args: unknown[]) => void;
  run.mockImplementation((_command, _args, _options, callback) => { finish = callback; });
  const first = selectProjectDirectory({ purpose: 'open-project' });
  await expect(selectProjectDirectory({ purpose: 'create-parent' })).rejects.toThrow('已有文件夹选择窗口');
  finish(null, '', '');
  await first;
  run.mockImplementation((_command, _args, _options, callback) => callback(null, '/tmp\n', ''));
  expect(await selectProjectDirectory({ purpose: 'create-parent' })).toEqual({ path: '/tmp' });
});

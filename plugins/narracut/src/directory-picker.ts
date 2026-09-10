import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';

let picking = false;

/** 仅响应工作台点击；只返回用户在系统窗口中选定的目录，不扫描或写入项目。 */
export async function selectProjectDirectory(input: unknown): Promise<{ path: string | null }> {
  const args = input as { purpose?: unknown } | null;
  if (!args || Array.isArray(args) || Object.keys(args).some(key => key !== 'purpose') ||
      !['create-parent', 'open-project'].includes(String(args.purpose))) {
    throw new Error('目录选择用途无效。');
  }
  if (picking) throw new Error('已有文件夹选择窗口，请先完成或取消选择。');
  const title = args.purpose === 'create-parent' ? '选择新项目的父目录' : '选择要打开的 Project VNext';
  const paths = await selectPaths('directory', title);
  return { path: paths[0] ?? null };
}

/** 工作台统一选择能力；标题与原生命令由固定种类决定，不插入请求文本。 */
export async function selectWorkbenchPath(input: unknown): Promise<{ path: string | null } | { paths: string[] }> {
  const args = input as { kind?: unknown } | null;
  if (!args || Array.isArray(args) || Object.keys(args).some(key => key !== 'kind') || !['directory', 'file', 'files'].includes(String(args.kind))) throw new Error('文件选择种类无效。');
  const kind = args.kind as 'directory' | 'file' | 'files';
  const paths = await selectPaths(kind, kind === 'directory' ? '选择 Narracut 文件夹' : '选择 Narracut 文件');
  return kind === 'files' ? { paths } : { path: paths[0] ?? null };
}

async function selectPaths(kind: 'directory' | 'file' | 'files', title: string): Promise<string[]> {
  if (picking) throw new Error('已有文件夹选择窗口，请先完成或取消选择。');
  const multiple = kind === 'files';
  const separator = '\x1f';
  // 固定可执行文件与参数，不经过 Shell，也不执行项目内程序。
  let command: string;
  let parameters: string[];
  if (process.platform === 'linux') {
    command = 'zenity';
    parameters = ['--file-selection', ...(kind === 'directory' ? ['--directory'] : []), ...(multiple ? ['--multiple', `--separator=${separator}`] : []), `--title=${title}`];
  } else if (process.platform === 'darwin') {
    command = '/usr/bin/osascript';
    parameters = ['-e', multiple
      ? `try\nset chosen to choose file with prompt "${title}" with multiple selections allowed\nset output to ""\nrepeat with itemPath in chosen\nset output to output & POSIX path of itemPath & ASCII character 31\nend repeat\nreturn output\non error number -128\nreturn ""\nend try`
      : `try\nPOSIX path of (choose ${kind === 'directory' ? 'folder' : 'file'} with prompt "${title}")\non error number -128\nreturn ""\nend try`];
  } else if (process.platform === 'win32') {
    command = 'powershell.exe';
    parameters = ['-NoProfile', '-NonInteractive', '-STA', '-Command',
      kind === 'directory'
        ? `Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = '${title}'; try { if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($picker.SelectedPath) } } finally { $picker.Dispose() }`
        : `Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $picker = New-Object System.Windows.Forms.OpenFileDialog; $picker.Title = '${title}'; $picker.Multiselect = $${multiple ? 'true' : 'false'}; try { if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine(($picker.FileNames -join [char]31)) } } finally { $picker.Dispose() }`];
  } else {
    throw new Error('当前系统不支持本地文件夹窗口；请在对话中明确提供项目绝对路径。');
  }
  picking = true;
  try {
    return await new Promise<string[]>((resolve, reject) => {
      execFile(command, parameters, { encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
        if (error) {
          // GTK 的非致命警告也会写 stderr；取消由 Zenity 退出码判断。
          if (process.platform === 'linux' && error.code === 1) return resolve([]);
          return reject(new Error((error as NodeJS.ErrnoException).code === 'ENOENT'
            ? '系统文件夹选择器不可用；Linux 需要 Zenity。也可在对话中明确提供项目绝对路径。'
            : '系统文件夹窗口未能完成选择，请重试。'));
        }
        const selected = stdout.replace(/\r?\n$/u, '');
        if (!selected) return resolve([]);
        const paths = multiple ? selected.replace(/\x1f$/u, '').split(separator) : [selected];
        if (paths.some(path => !isAbsolute(path) || /[\x00\r\n\x1f]/u.test(path))) return reject(new Error('系统窗口返回的目录路径无效。'));
        resolve(paths);
      });
    });
  } finally {
    picking = false;
  }
}

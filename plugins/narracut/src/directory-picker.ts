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
  // 固定可执行文件与参数，不经过 Shell，也不执行项目内程序。
  let command: string;
  let parameters: string[];
  if (process.platform === 'linux') {
    command = 'zenity';
    parameters = ['--file-selection', '--directory', `--title=${title}`];
  } else if (process.platform === 'darwin') {
    command = '/usr/bin/osascript';
    parameters = ['-e', `try\nPOSIX path of (choose folder with prompt "${title}")\non error number -128\nreturn ""\nend try`];
  } else if (process.platform === 'win32') {
    command = 'powershell.exe';
    parameters = ['-NoProfile', '-NonInteractive', '-STA', '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = '${title}'; try { if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($picker.SelectedPath) } } finally { $picker.Dispose() }`];
  } else {
    throw new Error('当前系统不支持本地文件夹窗口；请在对话中明确提供项目绝对路径。');
  }
  picking = true;
  try {
    const path = await new Promise<string | null>((resolve, reject) => {
      execFile(command, parameters, { encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
        if (error) {
          // GTK 的非致命警告也会写 stderr；取消由 Zenity 退出码判断。
          if (process.platform === 'linux' && error.code === 1) return resolve(null);
          return reject(new Error((error as NodeJS.ErrnoException).code === 'ENOENT'
            ? '系统文件夹选择器不可用；Linux 需要 Zenity。也可在对话中明确提供项目绝对路径。'
            : '系统文件夹窗口未能完成选择，请重试。'));
        }
        const selected = stdout.replace(/\r?\n$/u, '');
        if (!selected) return resolve(null);
        if (!isAbsolute(selected) || /[\x00\r\n]/u.test(selected)) return reject(new Error('系统窗口返回的目录路径无效。'));
        resolve(selected);
      });
    });
    return { path };
  } finally {
    picking = false;
  }
}

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function checkLauncher({ command, args, cwd, env }) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.setEncoding('utf8').on('data', chunk => output += chunk);
  child.stderr.setEncoding('utf8').on('data', chunk => errors += chunk);
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
    child.stdin.on('error', () => {});
    child.stdin.end([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'installed-plugin-test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'show_launcher', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'ui://narracut/workbench-v1.html' } },
    ].map(message => JSON.stringify(message)).join('\n') + '\n');
    assert.equal(await done, 0, errors);
    assert.ok(output.trim(), 'MCP 进程退出但没有返回响应');
    const responses = output.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(responses.find(item => item.id === 1)?.result?.serverInfo?.name, 'narracut');
    assert.ok(responses.find(item => item.id === 2)?.result?.tools?.some(tool => tool.name === 'show_launcher'));
    assert.equal(responses.find(item => item.id === 3)?.result?.structuredContent?.status, 'launcher');
    const resource = responses.find(item => item.id === 4)?.result?.contents?.[0];
    assert.equal(resource?.mimeType, 'text/html;profile=mcp-app');
    assert.ok(resource?.text?.includes('data:font/woff2;base64,'), '工作台应包含打包字体');
    console.log('MCP 握手、工具发现、启动器调用与工作台资源读取通过。');
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 使用 Codex 自己解析后的启动参数，防止测试替宿主展开路径而掩盖错误。
  const servers = JSON.parse(execFileSync(process.env.CODEX_BIN || 'codex', ['mcp', 'list', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const server = servers.find(item => item.name === 'narracut' || item.name.endsWith('__narracut'));
  assert.ok(server?.enabled, 'Codex 未启用 Narracut MCP');
  await checkLauncher(server.transport);
}

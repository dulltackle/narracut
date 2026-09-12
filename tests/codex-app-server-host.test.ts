import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CodexAppServerHost } from "../plugins/narracut/src/codex-app-server-host";

function fakeServerSource(marker: string, mode: "reject" | "timeout"): string {
  return `
import { writeFileSync } from "node:fs";
const marker = ${JSON.stringify(marker)};
const mode = ${JSON.stringify(mode)};
process.on("SIGTERM", () => {
  writeFileSync(marker, "terminated");
  process.exit(0);
});
if (mode === "reject") {
  process.stdout.write(JSON.stringify({ id: 1, error: { code: -32000, message: "rejected" } }) + "\\n");
  process.stdin.resume();
} else {
  process.stdin.resume();
}
setInterval(() => {}, 1_000);
`;
}

async function waitForFile(path: string): Promise<void> {
  await expect.poll(async () => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }, { timeout: 2_000 }).toBe(true);
}

async function fakeServer(mode: "reject" | "timeout") {
  const directory = await mkdtemp(join(tmpdir(), "narracut-codex-host-"));
  const script = join(directory, "server.mjs");
  const marker = join(directory, "terminated.txt");
  await writeFile(script, fakeServerSource(marker, mode), "utf8");
  return { script, marker };
}

describe("Codex App Server 宿主适配器", () => {
  it("initialize 被拒绝时终止对应子进程并允许安全释放", async () => {
    const fake = await fakeServer("reject");
    const host = new CodexAppServerHost({
      command: process.execPath,
      commandArgs: [fake.script],
      requestTimeoutMs: 2_000,
    });

    await expect(host.createThread({ projectDirectory: "/work/project" })).rejects.toThrow(
      "initialize 失败：rejected",
    );
    await waitForFile(fake.marker);
    await host.dispose();
  });

  it("请求无响应时在有界时间内失败并终止挂起子进程", async () => {
    const fake = await fakeServer("timeout");
    const host = new CodexAppServerHost({
      command: process.execPath,
      commandArgs: [fake.script],
      requestTimeoutMs: 50,
    });

    await expect(host.createThread({ projectDirectory: "/work/project" })).rejects.toThrow(
      "initialize 超过 50ms 未响应",
    );
    await waitForFile(fake.marker);
    await host.dispose();
  });
});

it.each([
  ['usageLimitExceeded', 'CODEX_USAGE_LIMIT'],
  ['unauthorized', 'CODEX_AUTH_REQUIRED'],
  ['serverOverloaded', 'CODEX_UNAVAILABLE'],
])('宿主保留结构化错误 %s，恢复失败不会误报线程丢失', async (codexErrorInfo, reason) => {
  const directory = await mkdtemp(join(tmpdir(), 'narracut-host-error-'));
  const script = join(directory, 'server.mjs');
  await writeFile(script, `import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line); if (!m.id) return;
  process.stdout.write(JSON.stringify(m.method === 'thread/resume' ? { id:m.id,error:{code:-32000,message:'服务拒绝',data:{codexErrorInfo:${JSON.stringify(codexErrorInfo)}}}} : {id:m.id,result:{}})+'\\n');
});
setInterval(() => {}, 1000);`);
  const host = new CodexAppServerHost({ command: 'node', commandArgs: [script] });
  try { await expect(host.resumeThread({ threadId: 'original', projectDirectory: directory })).rejects.toMatchObject({ code: reason }); }
  finally { await host.dispose(); }
});

it('工具批准等待宿主确认回执，再恢复匹配的 Turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'narracut-host-approval-')), script = join(directory, 'server.mjs');
  await writeFile(script, `import {createInterface} from 'node:readline';
const send = m => process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 if(m.id===90 && m.result) { send({method:'serverRequest/resolved',params:{threadId:'thread',requestId:90}}); return; }
 if(!m.id) return;
 if(m.method==='initialize') send({id:m.id,result:{}});
 if(m.method==='thread/start') send({id:m.id,result:{thread:{id:'thread'}}});
 if(m.method==='turn/start') {send({id:m.id,result:{turn:{id:'turn'}}});send({id:90,method:'item/commandExecution/requestApproval',params:{threadId:'thread',turnId:'turn',command:'读取候选源码'}});}
}); setInterval(()=>{},1000);`);
  const host = new CodexAppServerHost({ command: 'node', commandArgs: [script] });
  const events: any[] = []; host.subscribe(event => events.push(event));
  try {
    await host.createThread({ projectDirectory: directory, purpose: 'creation' });
    await host.startTurn({ threadId: 'thread', projectDirectory: directory, prompt: '读取', verificationToken: 'token', outputSchema: {} });
    await expect.poll(() => events[0]?.type).toBe('approval-required');
    expect(events).toHaveLength(1);
    await host.resolveApproval(events[0].approvalId, true);
    await expect.poll(() => events[1]?.type).toBe('approval-resolved');
    expect(events[1]).toMatchObject({ approved: true, approvalId: events[0].approvalId, threadId: 'thread', turnId: 'turn' });
    await expect(host.resolveApproval(events[0].approvalId, true)).rejects.toThrow('工具审批已过期');
  } finally { await host.dispose(); }
});

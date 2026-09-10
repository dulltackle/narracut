# 交接文档：narracut 执行胶囊 OOM 诊断与工具链泄漏修复

> **状态：历史交接，已于 2026-09-10 UTC 核对后续状态。** 工具链回收修复已进入 `20e8f89`；未解决事项见[胶囊维护事项](../../capsule-maintenance.md)。下文环境、临时路径、行号及会话授权只记录原会话，不作为当前操作指令。

- 日期：2026-09-07
- 仓库：`/home/forclaw/code/narracut`，分支 `develop`，基线 commit `71341ea`
- 状态：诊断已完成；泄漏修复已随 `20e8f89` 提交；重复自检问题**未修**

---

## 1. 起因与诊断结论

用户看到 GNOME 通知「设备内存接近占满。一个应用程序使用了大量内存，已被强制停止」。

**结论：与系统内存无关。** 是 narracut 自己的沙箱限额被**故意**触发。

- 内核日志为 `constraint=CONSTRAINT_MEMCG`，`oom_memcg=/user.slice/.../narracut-capsule-*.service`，属 cgroup 级 OOM
- 当时整机 13Gi 只用 5.3Gi，4Gi swap 用量 0B，PSI 内存压力全 0
- `systemd-oomd` 自身从未 kill 过任何进程（仅有启动日志）
- 触发者是 `src/server/execution-capsule.ts:93` 的第 3 号自检探针（内存炸弹），期望结果就是 `CAPSULE_RESOURCE_EXCEEDED`；自检额度 `probeLimits` 见 `:87`（128MiB + `MemorySwapMax=0`）
- 被杀进程 `anon-rss` 约 117.8MiB，精确逼近 128MiB 上限

gnome-shell 只认 systemd unit 的 `Result=oom-kill` 信号，不区分是整机内存耗尽还是单个 cgroup 的自设限额，故文案有误导性。

### 探针能否移除（已评估：不建议）

五个探针的覆盖分工：

| 探针 | 验证 | 判定路径 |
|---|---|---|
| 1 fork 炸弹 | `TasksMax` | 程序自证 EAGAIN |
| 2 写满 /tmp | tmpfs `--size` | 程序自证 ENOSPC |
| **3 内存炸弹** | **`MemoryMax`** | **`Result=oom-kill`** ← 唯一覆盖 |
| 4 日志超限 | `policy.logs` | supervisor `exit 73`（`src/server/capsule-supervisor.ts:27`） |
| 5 detached 死循环 | `RuntimeMaxSec` + `KillMode=control-group` | `Result=timeout` |

移除探针 3 会使 `src/server/execution-capsule.ts:253` 中 `stdout.includes('oom-kill')` 分支失去唯一覆盖（`exitCode === 73` 半边有探针 4 兜底）。

注意：`MemoryMax` 是否被正确设置有独立且更强的保障 —— `src/server/execution-capsule.ts:225-228` 在**每次执行**（不限自检）都会复查 unit 属性。探针 3 额外证明的是「设上去之后内核真的执行、且失败被正确翻译」，属性复查覆盖不了这一层。

---

## 2. 重复自检的根因（**未修**）

那次跑测试触发了 **4 次**完整自检（4 个独立的 `ExecutionCapsule` 实例）。

根因是两层缓存作用域不匹配：

- `#certification` 缓存挂在**实例**上（`src/server/execution-capsule.ts:76`）
- 保证单实例的 `local` 是**模块级**变量（`src/server/execution-capsule.ts:281`）
- vitest 默认并行跑测试文件，每个文件有独立模块注册表，`local` 退化成「每测试文件一个」

铁证：两个 toolchain 实例时间窗重叠（05:45:31–38 与 05:45:36–43 并发），单进程内的 `local ??=` 不可能产生并发两份。
另有 `tests/execution-capsule.test.ts:31` 直接调 `ExecutionCapsule.local()` 绕过单例，贡献其中一次。

**建议修法**：自检结果只取决于工具链内容（`certify()` 返回的就是 identity 哈希），把认证结果按 identity 哈希做**跨进程缓存**（落 `XDG_CACHE_HOME`），同机同工具链只自检一次。退而求其次可用 vitest `globalSetup`；`fileParallelism: false` 会明显拖慢，不推荐。

---

## 3. 已完成的修复：工具链目录泄漏

### 问题

`/tmp` 累积了 6 个 `narracut-toolchain-*`，每个 352M，共 2.1G。

**注意别走弯路**：清理钩子本来就有（`process.once('exit', cleanup)`，现位于 `src/server/capsule-toolchain.ts:82`）。问题是它只在正常退出时触发；vitest worker 与 playwright 拉起的 dev server 收尾时被信号终止，钩子不跑。加信号处理器解决不了 SIGKILL/崩溃，且会侵入宿主应用的信号语义。

### 改法

当时改动只在 `src/server/capsule-toolchain.ts`，+17 行，后随 `20e8f89` 提交：

- `reclaimOrphanSnapshots()`（`:14`），在 `snapshotCapsuleToolchain()` 开头调用（`:30`）
- 快照建好后写属主 PID 到 `root/owner.pid`（`:59`）
- 扫 `tmpdir()`，`process.kill(pid, 0)` 探活，**仅 `ESRCH` 才删**

判定刻意保守，误判方向永远是漏删而非误删：读不到 `owner.pid` 一律保留（覆盖「刚 mkdtemp 还没写标记」的并发窗口，以及他人 0700 目录读不了的情况）；`EPERM`（进程在但非本用户）同样保留。

`owner.pid` 不经过 `add()`，因此不进 `hashes`/`groups`，不影响 `identity` 哈希，也不会被 bwrap 挂进沙箱。

### 验证记录

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| `tests/execution-capsule.test.ts` | 2 passed（真实胶囊，15 个 capsule） |
| 回收判定三类：属主已死 / 存活 / 无标记 | 已回收 / 保留 / 保留，全对（手工构造验证） |
| 全量单测（改动后） | 42 passed, 1 failed |
| 全量单测（`git stash` 回原始代码对照） | 42 passed, **同一个** 1 failed |

**已排除的假阳性**：`tests/codex-app-server-host.test.ts` 的 `waitForFile` 超时。单独跑 265ms 通过，对 capsule/toolchain 引用数为 0，**原始代码上同样失败** —— 并发负载下的 flaky，与本次改动无关。不要重复调查。

改动已从 stash 恢复，并与备份 `diff -q` 校验一致。备份留在：
`/tmp/claude-1000/-home-forclaw-tmp/45e7e186-0c67-4cff-8462-a8d2941ecfd4/scratchpad/capsule-toolchain.ts.patched`

---

## 4. 原会话待办及后续状态

按优先级：

1. **提交改动（已完成）** —— `src/server/capsule-toolchain.ts` 回收修复已随 `20e8f89` 提交。
2. **回收逻辑缺自动化测试** —— 目前只有手工验证。三类判定（属主已死/存活/无标记）值得补进 `tests/execution-capsule.test.ts` 或新测试文件。
3. **修重复自检**（见第 2 节）—— 用户在会话结束时被问到是否继续，尚未答复。
4. **删掉验证时构造的两个目录** —— 它们按设计会被永久保留，需手动清：
   `rm -rf /tmp/narracut-toolchain-ALIVE /tmp/narracut-toolchain-NOMARK`
5. **187 个测试临时目录**（162M，可选）—— 清理时**必须限定只删目录**，`/tmp/narracut-*` 通配会误伤 `narracut-77-*.json/.log/.md` 等用户主动保留的分析文件：
   `find /tmp -maxdepth 1 -type d -name 'narracut-*' -not -name '*toolchain*' -exec rm -rf {} +`

---

## 5. 环境约束（重要）

- **用户不授权 agent 执行 `rm`。** 本会话两次 `rm` 均被权限拒绝。删除操作请把命令交给用户，提示他们在输入框用 `!` 前缀自行执行。
- 沟通、文档、commit message 一律中文（`~/.claude/CLAUDE.md`）。
- 全量单测约 50s 墙钟；`tests/execution-capsule.test.ts` 单跑约 37s，会真实创建 capsule 并**弹出那条 GNOME 内存通知**（属预期）。
- 相关历史产物：`/tmp/narracut-77-full-test.log`（05:56 的完整测试日志，含 playwright 部分 119 passed / 1 failed）。

---

## 6. Suggested skills

下一个 agent 视任务调用：

- **`code-review`** —— 原会话建议提交前审查 `capsule-toolchain.ts` 改动；该改动现已提交。这段代码在删文件，值得一次针对性复核（尤其并发窗口与 pid 复用边界）。
- **`tdd`** —— 给回收逻辑补自动化测试（待办 2），三类判定场景清晰，适合测试先行。
- **`diagnosing-bugs`** —— 仅当要处理 `tests/codex-app-server-host.test.ts` 那个 flaky。注意它与本次改动无关，已用 stash 对照排除。
- **`codebase-design`** —— 若着手修重复自检（待办 3）。认证结果跨进程缓存涉及 `ExecutionCapsule` 的缓存作用域与生命周期接口，是模块边界问题。
- **`security-review`** —— 可选。改动触及沙箱工具链的文件生命周期，虽不改变隔离语义，但涉及跨进程的 `/tmp` 目录删除判定。

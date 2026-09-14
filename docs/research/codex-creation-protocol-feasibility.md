# Codex 通过 Narracut 创作协议执行的可行性

研究日期：2026-09-13（America/Los_Angeles）。源码基线：`6a8178b08f9abaa6ce2d7dbd77b707c3baff8f84`。本研究只核查资料、源码及定向协议测试，不实施 #123，也不重做真实宿主创作验收。

## 结论

**可行，而且“当前 Codex Agent 领取步骤、提交画面修改、检查并交付”的关键路径已有真实执行记录。** Narracut 可以以自己持有的任务状态和发布结果驱动 UI；无需监听 Codex 对话文字来判断开始或完成。依据是现有生产协议及 2026-09-11 的真实宿主验收，而非仅凭 SDK 支持工具调用作推测。该验收到达 `waiting / CANDIDATE_READY`，尚不等于 #123 要求的首次生成／调整后直接发布已经完成。[创作协议实现](../../plugins/narracut/src/creation-task.ts)、[真实复验记录](../current-conversation-acceptance.md#当前-agent-直接驱动复验2026-09-11)、[脱敏宿主证据](../evidence/issue-99-direct-agent-host-20260911.json)

需要同时保留三项边界：

- **协议可以观察业务操作，不能观察任意 Codex 活动。** 自由编辑文件、在对话里说“完成”、模型正在思考，都不是 Narracut 的完成证据。[当前对话适配器](../../plugins/narracut/src/current-conversation-host.ts)、[任务步骤实现](../../plugins/narracut/src/creation-task.ts)
- **当前协议不会自动唤醒已结束的 Agent Turn。** `startTurn` 只保存待领取步骤；用户在当前对话发送指令后，由正在运行的 Agent 消费它。[当前对话适配器](../../plugins/narracut/src/current-conversation-host.ts)
- **突然停止、退出或失联不一定能立即同步。** 只有仍能调用工具且已观察到中断的 Agent 可以显式报告；当前通道没有桌面原生生命周期订阅，服务重启恢复为已停止也不能替代该能力。[工作台技能](../../plugins/narracut/skills/narracut-workbench/SKILL.md#在本对话执行创作步骤)、[验收缺口](../current-conversation-acceptance.md#剩余真实验收缺口)

## 官方能力与本项目接入方式

官方 OpenAI 文档将 Skill 定义为包含指令、资源及可选脚本的工作流程；支持明确调用或按描述选择。Codex 的 MCP 支持工具、上下文和服务级 `instructions`。这支持“把协议操作写成技能，让当前 Agent 调用”的总体方式，但不会保证任何自然语言请求都必然触发正确技能。[官方 Skills 文档](https://learn.chatgpt.com/docs/build-skills)、[官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

Narracut 目前的具体通道是：已核实当前对话身份 → 启动绑定该对话的面板服务 → 当前 Agent 经 Shell 向该面板的秘密 URL 发出 JSON RPC `tools/call`。`creation_step`、`start_creation_task` 等工具标记为 `visibility: ['app']`，不能假定一定出现在模型的原生 MCP 工具列表；技能已经明确规定上述面板 RPC 路径。它使用生产请求处理器，并非另建一个可任意改写项目的旁路。[工作台技能](../../plugins/narracut/skills/narracut-workbench/SKILL.md)、[工具定义与处理器](../../plugins/narracut/src/server.ts)、[面板 RPC](../../plugins/narracut/src/workbench-panel.ts)

这条路径依赖当前宿主允许启动本地服务、访问该服务、核实当前对话并调用相应工具。身份必须来自已核实的当前对话；秘密面板 URL 不能放入共享文档或把其他对话的会话拿来复用。服务端同时校验秘密路径、Host、Origin、项目身份及控制权。[面板 RPC](../../plugins/narracut/src/workbench-panel.ts)、[服务端控制权检查](../../plugins/narracut/src/server.ts)

官方 App Server 确实提供 `turn/started`、`turn/completed` 和 `item/*` 等通知，适合接入其传输连接的自建客户端。但这不证明现有 Narracut 面板已经连接到桌面正在使用的 App Server，或可直接订阅其当前对话。现有生产适配器中 `submit` 发出的 `turn-completed` 是 Narracut 内部事件，不能当作桌面宿主的完成通知。旧方案另起 App Server 恢复活跃桌面对话时，真实验收曾遇到 `already has an active writer`；修复后生产路径不再这样做。[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server#events)、[当前对话适配器](../../plugins/narracut/src/current-conversation-host.ts)、[首轮真实宿主记录](../current-conversation-acceptance.md#真实宿主证据)

## 当前生产协议实际如何工作

1. 用户在当前 Codex 对话明确发起或继续创作。Agent 读取工作台最新项目、任务与控制权，调用 `start_creation_task` 或同任务继续操作。创建任务与继续既有任务不能混淆。[工作台技能](../../plugins/narracut/skills/narracut-workbench/SKILL.md#在当前对话创作)
2. Agent 调用 `creation_step/read` 领取带有 `taskId`、`stepId`、`verificationToken`、提示及输出 schema 的步骤。服务在检查／构建时可能暂时没有步骤；Agent 持续读取直到等待用户或停止。[任务实现](../../plugins/narracut/src/creation-task.ts)
3. Agent 将候选修改作为结构化 `answer` 提交，由 Narracut 校验、原子落盘并推进检查。Agent 不直接改写项目候选文件。服务拒绝旧任务、旧步骤、错误 token、schema 错误和失权请求。[工作台技能](../../plugins/narracut/skills/narracut-workbench/SKILL.md#在本对话执行创作步骤)、[任务实现](../../plugins/narracut/src/creation-task.ts)、[协议测试](../../tests/workbench-panel.test.ts)
4. `receipt: received` 只代表接收结果，修改、检查及构建随后沿队列执行。Agent 必须继续读取持久结果，不能收到回执就宣布视频更新完成。[`CreationTask.step`](../../plugins/narracut/src/creation-task.ts)
5. 服务准备代表帧并交给 Agent 实际查看。现有流程最终到达 `CANDIDATE_READY`；#123 仍需接上符合最新输入与检查门禁的完整视频发布及一步撤回。[任务实现](../../plugins/narracut/src/creation-task.ts)、[ADR-0013](../adr/0013-single-design-latest-preview-and-update-undo.md)

这里的“通过协议修改”不是 Codex 必须让 Narracut 逐次观察键盘或文件编辑动作，而是 **Narracut 拥有任务、步骤、写入与结果发布；Codex 提供每一步所需的结构化创作结果。** 因而服务能知道自己正在处理哪个步骤、是否收到有效修改、检查是否通过，进而给 UI 提供确定的业务状态。[当前对话适配器](../../plugins/narracut/src/current-conversation-host.ts)、[任务实现](../../plugins/narracut/src/creation-task.ts)

## UI 可以准确说什么

| 观察到的事实 | 可以展示 | 不应据此推断 |
| --- | --- | --- |
| 只复制了指令 | 已复制，等待在当前对话发送 | Codex 已经开始执行 |
| 已登记运行任务、发出待处理步骤 | 等待 Agent 返回结果 | Agent 已读取步骤、仍在执行或正在修改某一文件 |
| 服务进入修改、检查或预览阶段 | 正在保存修改／检查／准备预览 | 模型的实时内部进度或百分比 |
| 收到 `receipt: received` | 已收到该步骤结果，继续处理 | 修改已经持久保存、视频已成功 |
| 全部必要证据有效且发布成功 | 更新完成，可查看新视频 | 最终输出已经完成 |
| 已确认任务停止 | 已停止，保留成果及恢复入口 | Codex 模型回合也已停止 |
| 已确认错误 | 显示具体失败原因与恢复入口 | 未核对便认为全部在途操作已经结束 |
| RPC 失联 | 连接中断／状态待核对，展示最后确认状态 | 自动宣称取消、成功或获得接管权 |
| RPC 正常但待处理步骤没有新结果 | 等待 Agent 返回结果 | Codex 仍在执行，或连接已经中断 |

前四行取自现有任务实现及技能；“发布成功”一行是 #123 应实现的结果判定，遵循 ADR-0013，不能当作当前已实现能力。`stage: modify` 在服务处理 `apply/dependencies` 答案后设置，不等价于模型生成修改答案时的即时状态。[任务实现](../../plugins/narracut/src/creation-task.ts)、[工作台技能](../../plugins/narracut/skills/narracut-workbench/SKILL.md)、[ADR-0013](../adr/0013-single-design-latest-preview-and-update-undo.md)

当前工作台已有 `get_creation_task` 轮询：运行任务默认以约 500ms 延迟调度，非运行任务至少 2 秒，网络与检查耗时另计。**无任务或任务已终结时该轮询会返回。** 面板桥的 `/state` 推送只发生在初始化／重新连接等路径，因此“打开工作台时没有任务，随后从 Codex 对话发起第一轮”的主动发现仍需补齐；不能凭现有轮询就承诺首次任务自动显示。[工作台轮询](../../plugins/narracut/workbench.js)、[面板桥](../../plugins/narracut/src/workbench-panel.ts)

## 访谈确认：等待结果与宿主停止

用户已确认：**Codex 突然停止时，可以接受 Narracut 暂时显示“等待 Agent 返回结果”。** 本决定接受当前宿主状态观测边界，不要求以立即获知 Codex 停止作为本方案的交付前提；它不是新增的任务稳定状态，也不等于“等待用户”。术语见 [Agent 创作任务状态](../../CONTEXT.md)。

源码补查确认：`CurrentConversationHost.read()` 不登记读取时间或心跳；任务的定期观察只核对候选及输入变化，没有针对 Agent 静默的超时停止。因此当前实现不能承诺等待会在固定时限内自动结束，不能凭静默将任务改为已停止。等待时长、提示升级或超时策略尚未由本决定规定。[当前对话适配器](../../plugins/narracut/src/current-conversation-host.ts)、[任务观察](../../plugins/narracut/src/creation-task.ts)

用户在 Narracut 停止任务时，现有协议先撤销步骤提交资格，再核对在途工作并保存停止状态；其 `interruptTurn` 只清除待处理步骤，不停止桌面 Codex 模型回合。取消后的迟到结果不能发布、核对完成前不能开始下一轮，仍按 #123 的既有约束实施；接受等待文案不放宽这些边界。[任务停止与提交校验](../../plugins/narracut/src/creation-task.ts)、[当前对话适配器](../../plugins/narracut/src/current-conversation-host.ts)、[#123](https://github.com/dulltackle/narracut/issues/123)

## 证据强度

| 证据 | 已证明 | 尚未证明 |
| --- | --- | --- |
| 官方 Skills、MCP、App Server 文档 | 工作流程及工具接入可用；App Server 有相应事件协议 | Narracut 当前桌面接入已订阅宿主事件 |
| 生产源码 | 任务／步骤交换、结构化写入、检查、轮询与控制权边界已经存在 | 真实模型每次都会遵循工作流程 |
| 2026-09-11 真实当前 Agent 复验 | 领取步骤、原子提交修改、同任务继续、实际查看代表帧，达到 `waiting / CANDIDATE_READY` | #123 直接发布、最终 Render、原生停止／退出、已结束 Turn 自动唤醒、真实双对话全部通过 |
| 确定性协议／端到端测试 | 可重复验证协议竞态、失权、错误答案及产物处理 | 模型自主行为或完整桌面宿主体验 |

真实复验包含首轮失败、胶囊超时后继续、画面和字体问题的实际发现及后续修正，不能只摘最终成功状态而隐去范围。原验收明确保留未完成场景；本研究没有把这些历史记录重新标为本轮测试。[真实复验](../current-conversation-acceptance.md#当前-agent-直接驱动复验2026-09-11)、[真实证据](../evidence/issue-99-direct-agent-host-20260911.json)、[自动化证据](../evidence/issue-99-direct-agent-automation-20260911.json)

本轮主代理执行定向协议复验：

```sh
pnpm exec vitest run tests/workbench-panel.test.ts --maxWorkers=1 -t '生产当前对话通过公开创作步骤协议|当前对话步骤隔离|当前对话显式报告宿主中断'
```

结果：**3 条通过、8 条未选中，耗时 1.73 秒**。首次默认沙箱全文件运行失败，其中存在明确的 `listen EPERM`，另有任务身份缺失／超时；不能把所有失败都认定为相同原因。取得回环服务执行权限后只复跑上述三条，未修改断言。它们证明当前生产 RPC 的步骤执行、隔离和显式中断路径，不能证明真实模型行为或完整 UI 联动。[本轮所用测试](../../tests/workbench-panel.test.ts)

## 对 #123 的判断

**可以继续采用“复制指令 → 当前对话发送 → 当前 Agent 持续驱动协议”的方案。** 本轮主代理读取的 [#123 正文及评论](https://github.com/dulltackle/narracut/issues/123)已明确采用手动交接；其中宿主探针记录未证明 `ui/message` 自动唤醒，这不阻碍正在运行的 Agent 调用创作协议。

建议把剩余工作集中在三处：**首次任务发现、检查后的直接发布与撤回、未确认中断时的状态核对与恢复**。指令应明确使用现有工作台技能并核对最新项目及原任务；UI 以服务确认的业务结果更新。真实当前对话的手动发送、修改、发布与 UI 联动仍须单独验收，不用确定性测试替代。这是从现有证据得出的实施建议，不声明 #123 已完成。[工作台技能](../../plugins/narracut/skills/narracut-workbench/SKILL.md)、[ADR-0013](../adr/0013-single-design-latest-preview-and-update-undo.md)、[验收缺口](../current-conversation-acceptance.md#剩余真实验收缺口)

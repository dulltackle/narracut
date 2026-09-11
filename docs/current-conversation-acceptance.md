# 当前对话完整流程验收（#99）

验收日期：2026-09-11，分支 `develop`。前置 #96、#97、#98 已关闭。首轮产品基线为 `8486795`，验收记录提交为 `872c684`；下方首轮记录保持原始结果。后续按用户确认修复当前对话创作接入，见文末“当前 Agent 直接驱动复验”，未改持久化格式或 Runtime。

**结论：真实 Codex 完整创作流程尚未通过，#99 保持开启。** 首轮的 `active writer` 接入阻塞已通过当前 Agent 工具协议修复，真实候选修改、检查、Preview 与代表帧审阅已完成并交付；用户接受和真实最终 Render 仍须补齐。自动化与真实宿主证据分别记录，历史 App Server 专用线程测试不证明当前对话或桌面右侧位置。

## 可重复的自动化入口

先运行 `pnpm build:plugin`，再运行 `pnpm test:e2e:public`。公开配置收录 4 个文件、20 个场景，沿用既有公开产品边界，不另建替代产品流程。系统目录选择与 Codex 驱动使用可控边界替身；普通验收不依赖公网、真实账号额度或模型随机结果。

| 边界 | 可执行证据 | 能证明的范围 |
| --- | --- | --- |
| 完整候选与最终输出 | `tests/e2e/portable-project.spec.ts` | 当前对话工具发起、候选修改、离线重建、代表帧、明确接受、同 Bundle 最终 Render 与帧比较；Codex 为替身，文件选择由测试提供 |
| 候选审阅 | `tests/e2e/candidate-review.spec.ts` | 无 Composer 或创作按钮；只读接受/放弃拒绝；Scene 状态保留 |
| 公开面板与故障 | `tests/e2e/workbench-panel.spec.ts` | 创建/打开、Scene 保存重载、权限与草稿、失败原因、重试、系统选择桥接 |
| 页面关闭与重开 | `tests/e2e/panel-reconnect.spec.ts` | 页面销毁期间同任务持久提交、重开同步、只读查看、停止/重启/中断、迟到状态隔离；就绪呈现分支使用状态夹具 |
| 接管与迟到写入 | `tests/workbench-panel.test.ts`、`tests/project-control-race.test.ts` | 公开请求、进程租约、旧 Turn/Speech 迟到结果和最后提交点撤权 |
| 顺序任务与明确继续 | `tests/creation-task.test.ts` | 独立任务检查点与候选、旧任务结果拒绝、同任务恢复、跨对话继续、重启停止 |

上述测试边界来自 Project VNext §17 及 #99 的验收要求。没有添加模型调用测试或以内部实现断言替代公开入口。

### 首轮运行

| 执行 | 结果与限制 |
| --- | --- |
| `pnpm typecheck` | 变更前后均通过 |
| 定向 Vitest：`workbench-panel`、`project-control-race`、`creation-task` | 3 文件、81 条通过；公开请求和可控宿主边界 |
| 定向 Playwright：`workbench-panel`、`panel-reconnect`、`candidate-review` | 18 通过、1 失败，失败详情见下；没有记为全绿 |
| 失败单场景 `--grep '公开面板通过启动器打开' --repeat-each 5` | 5 次通过；未复现不等于已修复 |
| 完整 `pnpm test` | schema 19 条和插件打包/stdio 验证通过；单元 328 通过、4 失败、2 环境限定跳过；命令退出 1，未执行到 E2E |
| 4 个失败文件使用 `--maxWorkers=1` 复验 | `project-copy`、`project-restore`、`codex-app-server-host`、`creation-task` 共 97 条通过；未修改超时阈值或测试断言 |
| 完整 `pnpm test:e2e` | 85 条通过（4.5 分钟），包含完整可移动项目、代表帧和最终 Render |
| 公开配置 `--list` | 4 文件、20 场景；配置枚举不计为场景通过 |
| 文档与脱敏证据校验 | 5 份 Markdown 本地链接存在；结构化身份与停止状态一致；无秘密面板 URL |

首次默认沙箱拒绝回环端口（`listen EPERM`）；随后使用获准的执行环境，未关闭 Narracut 执行胶囊。定向 Vitest 的失败尝试和成功重跑曾写入同一临时日志，记录保留两段结果，不把失败部分隐去；以成功进程退出码及 81 条通过摘要核对。

**待跟进的间歇性失败：** 公开面板“打开项目并保留编辑和审阅入口”在输入 Scene 后轮询 `/state`，收到 `status: identity-lost`，错误为 `PROJECT_IDENTITY_LOST`、`project.json 在检查期间被替换；请停止外部修改后重试。`，继而测试访问缺失的 `scenes[0]` 报错。Playwright trace 中可见这一真实服务响应。5 次独立复跑通过，但读状态与本服务原子保存竞争仍是待验证假设，本轮未改产品身份校验或将该错误吞为成功。

完整单元失败分别是复制与恢复离线依赖场景的 30 秒超时、创作检查等待下一 Turn 的 15 秒超时，以及宿主挂起子进程测试等待文件的 2 秒超时。限制并发后通过支持资源竞争的可能性，但尚未建立确定性根因；默认完整命令本轮没有一次全绿记录。

持久保存的原始失败/复验摘要与日志 SHA-256 见[自动化运行记录](evidence/issue-99-automation-20260911.json)。

原始运行日志：`/tmp/narracut-99-full.log`、`/tmp/narracut-99-recheck.log`、`/tmp/narracut-99-ui.log`、`/tmp/narracut-99-save-repro.log`、`/tmp/narracut-99-e2e-full.log`。临时 trace 可能被后续 Playwright 重跑覆盖；失败响应和结论已摘录于本文，临时路径不承诺长期留存。

## 真实宿主证据

环境：Linux x64；安装包元数据 `26.903.61454`（品牌字段 `chatgpt`，prod）；随包 CLI `0.153.4`；Node `22.23.2`；pnpm `11.7.0`。版本来自 `/usr/lib/chatgpt/resources/linux-package-metadata.json` 和 `codex --version`，不是把 CLI 版本当作桌面版本。使用本仓库 `pnpm build:plugin` 产物。

脱敏结构化证据见 [宿主实测快照](evidence/issue-99-host-20260911.json)，包含对话/项目/任务身份、打开回执、实际 DSL、停止检查点及 SHA-256，不包含秘密面板 URL。测试项目保留于 `/tmp/narracut-issue99-desktop-20260911`；临时目录不是永久证据存储。页面截图见本次 #99 对话中的 CUA 工具记录，只包含内置浏览器视口。

| 步骤 | 观察 | 判断 |
| --- | --- | --- |
| 读取 `CODEX_THREAD_ID`，用 `read_thread` 核对请求和工作目录 | 对应当前 #99 请求及本仓库 | 当前面板来源身份已核实 |
| `panel.mjs --create` 创建验收项目 | `valid`，0 Scene；当前对话绑定 | 服务与项目创建通过 |
| `open_in_codex(right, browser)`，省略 threadId | 返回 `queued` 及同一对话 ID；随后用户明确确认“已在当前对话右侧显示” | 右侧位置有用户确认；回执本身不作为展示完成证据 |
| CUA 直接连接内置浏览器并打开同一 URL | 工作台、项目名、当前对话可编辑状态可见 | 真实内置浏览器页面可用，不是完整桌面位置证据 |
| 在表格新增 Scene、输入文稿、等待保存后重载 | 文稿“这是第 99 号验收项目的 Scene。”保留；磁盘 DSL 一致 | 页面编辑与持久保存通过；首次未等保存即重载的尝试不计通过 |
| 当前对话经公开 RPC 发起最小验收创作 | 创建 Task ID 后实际停止为 `CODEX_INTERRUPTED`；检查点的 threadPointer、lastSafeStage 为空 | 创作未成功；独立宿主探针定位至 `thread/resume` 拒绝：`already has an active writer` |
| 切换 Agent 工作区查看真实状态 | 显示“已停止 · Codex 已中断”、候选保留、当前对话继续提示；无聊天输入/创作按钮；最终 Render 被阻断 | 停止呈现与门禁可见；尚无交付、接受或成片证据 |

额外最小探针直接调用生产 `CodexAppServerHost.resumeThread`，仅恢复上述已核实对话、不启动 Turn，得到 `CODEX_INTERRUPTED`：`thread/resume 失败：thread 01a08f7d-51ee-7102-81e9-61c2d1e32459 already has an active writer`。探针随即 dispose。该结果定位到独立 App Server 与当前活跃桌面对话的写权冲突；没有通过创建专用线程、停止当前用户任务或调整宿主配置绕过。

未手工补写候选或伪造 Speech 来绕过此次失败，未运行 App Server 专用线程 live 测试替代当前对话验收。

## 尚未完成的真实场景

1. 包含 Codex 外层位置的截图/录像尚缺；当前对话右侧实际展示已有用户明确确认。
2. 当前对话创作成功、候选审阅、用户明确接受及最终 Render；须先解决独立 App Server 恢复当前桌面对话时的 active writer 冲突，再补齐可验收项目内容。
3. 用 Codex 面板自身关闭入口关闭期间，真实创作继续产生持久成果，随后重开显示同一任务最新成果。
4. 两个真实 Codex 对话的只读查看、明确接管以及新旧面板权限变化；合成 threadId 与双浏览器页面不算真实双对话。
5. 真实顺序任务、当前对话明确继续，以及 Codex 应用重启/用户中断后保持停止；不能将服务重启或浏览器 reload 称为应用重启。
6. 宿主层打开失败原因、用户重试与没有外部浏览器跳转；HTTP 503 自动化只证明页面层失败路径。

复验按[工作台面板的真实桌面步骤](workbench-panel.md#真实桌面关闭重开复验步骤)执行，并逐步记录版本、环境、Project ID、Task ID、候选 baseline、操作与结果。每项未执行场景保留缺口；不得因自动化通过而整条勾选同时要求真实桌面的验收标准。

## 现行文档一致性

| 文档 | 核对结果 |
| --- | --- |
| `docs/spec/project-vnext.md` | §17、§19 明确当前对话右侧、仅审阅、打开只读、明确接管、重开同步与旧请求拒绝 |
| `PRODUCT.md` | 创作使用 Codex 当前对话；面板不提供创作输入；关闭不停止，打开不接管 |
| `CONTEXT.md` | Codex 创作线程、Agent 工作区、任务恢复均使用当前对话；“Composer”指 Codex 当前对话输入 |
| ADR-0008 / ADR-0010 | 当前对话与候选审阅；同对话顺序任务、单一写权、检查点恢复和面板生命周期边界一致 |

旧补充收口记录曾将工作台 Composer、专用线程和打开即接管列为通过，且链接旧测试行号；现已归入 `docs/archive/qa/`，原入口仅保留当前/历史导航，避免旧行为继续作为现行验收依据。上述规范与术语已由前置票更新，本轮未改写其领域决策。

## 独立审查

按 implement 要求由一个只读子代理执行 open-code-review-delegate，覆盖本轮 8 个变更文件，无中高风险发现。已采纳采集阶段标注建议，将宿主创建回执与编辑后 DSL 分开；增量证据审查核对原始日志摘要与 SHA-256 一致。全套 E2E 最终结果随后以运行日志补入。


## 当前 Agent 直接驱动复验（2026-09-11）

用户确认第 6 条文档核对结果，并指定可使用 `fixtures/clips`。随后明确批准以当前 Agent 直接调用创作工具的方式修复接入。第 5、6、7 条已在 issue 勾选；第 1–4 条仍保持未勾选。

修复以 `872c684` 为基线：生产面板改用 `CurrentConversationHost`，通过 `creation_step/read`、`submit` 和 `interrupt` 交换步骤、结构化结果与已观察到的中断；沿用原有 CreationTask、候选门禁、任务检查点和项目提交屏障。参数/schema/token 错误不消费当前步骤；旧 task/step、停止后结果与只读面板请求均拒绝。独立 App Server 仅用于固定宿主探针。实现和限制见 [工作台面板](workbench-panel.md#当前-agent-直接驱动创作99-修复)。

### 本轮自动化

- TDD：公开 RPC 新测试在实现前因 `creation_step` 不存在失败；实现后在独立 Codex 可执行文件不存在的条件下通过，证明生产创作不依赖另起模型进程。
- 定向公开 RPC、CreationTask 与项目控制权回归：83 条通过；随后增加显式宿主中断报告与重启隔离测试。
- 改造既有可移动项目 E2E：使用生产工具协议与确定性 Agent 答案完成依赖、候选修改、检查、代表帧图像传递及候选就绪，再移动重开、明确接受和最终 Render；单场景完整通过（2.4 分钟）。模型答案为测试替身，视觉由既有逐帧对照另行验证。
- `pnpm test`：schema 19 条、插件打包/stdio 通过；单元 332 通过、3 失败、2 环境跳过。失败为创作检查等待超时、恢复离线依赖超时，以及复制返回 `identity-lost`；原命令退出 1，未运行到 E2E，不记为全绿。
- 失败的 3 个文件使用单 worker 复验：85 条通过（132.92 秒），未修改断言或放宽超时。复制身份失效未在复验中重现，不宣称根因已修复。
- 补跑完整 E2E：84 通过、1 失败（5.3 分钟）；新协议的可移动项目全链路通过。候选审阅测试过去依赖接入失败自动停止，实际现在正常运行，单独复验确认同样失败。改为点击真实“停止任务”按钮建立场景前提后，该文件 2 条通过（3.8 秒）。只修改测试前提，保留无创作输入/按钮和已停止断言；不是同一次完整运行全绿。

### 本轮真实宿主

使用同一已核实当前任务 `01a08f7d-51ee-7102-81e9-61c2d1e32459`，在独立临时目录 `/tmp/narracut-99-current-agent-clips` 创建项目。`open_in_codex` 返回 queued；本轮尚未再次取得外层位置确认，不借用上一面板的位置确认作为新面板证据。

通过真实内置浏览器新增并保存 Scene，从 `fixtures/clips/script.md` 取用原文“从球囊连接管套装中取出连接管”；通过公开 RPC 导入 `fixtures/clips/2.mp4` 并绑定该 Scene。原始素材保持不变，未操作系统文件选择窗口，因此不计作原生选择窗口验收。

真实浏览器重载后确认原文、素材绑定和已保存候选均保留，Agent 工作区无 Composer 或创作按钮；没有执行接受。

当前 Agent 成功读取步骤，并通过 `creation_step/submit` 原子提交候选 `src/RenderProgram.tsx`。实际检查进入 `check` 安全阶段，报告缺少离线依赖。这证明首轮未能完成的当前线程绑定与候选修改已经越过；并非以受控模型替身冒充真实创作。

第一次补齐依赖后任务停止。使用生产依赖协调函数在项目外做只读最小探针，得到 `CAPSULE_TIMEOUT`：执行胶囊达到墙钟上限，输出被丢弃。随后并发负载降低时，当前对话明确继续同一任务并重试成功；未修改胶囊限制，未证明首轮超时的确切根因。再按静态检查将不被允许的布局属性改为可用写法，必要检查全部通过。

第一轮实际查看帧 0、74、149 时，发现 MP4 画面未显示、中文使用默认字体出现缺字；没有提交虚假的通过观察。通过公开导入工具加入用户目录中已有 `fixtures/clips/输卵管通液/assets/2.webm`，任务自动作废旧输入下步骤并读取新输入。候选改用 WebM，并关闭可选字幕，Scene 原文不变。第二轮三个代表帧均实际查看，画面显示主体及不同动作位置，按帧号与 digest 提交观察。

最终真实任务到达 `waiting / CANDIDATE_READY`，`lastSafeStage=deliver`，交付 ID 为 `e5af0163-265b-422b-b9a4-ba12428e6bb4`。交付明确列出无 Speech、MP4 首轮不显示、默认中文字体缺字及本次不显示字幕的警告；没有自动接受。此项目仍只有 Draft Duration，最终 Render 未执行。用户原始 MP4 和 WebM 均未修改；其导入副本逐字节摘要一致。

### 剩余真实验收缺口

原生桌面停止/退出事件订阅、已经结束的 Agent Turn 在 Scene 待办满足后自动唤醒、真实双对话及原生面板关闭/重开仍未完成。工具协议中显式报告中断、步骤撤权和服务重启停止已有覆盖，但不等于能自动观测桌面宿主事件；规范要求保留，不以文档降低要求或宣称 #99 完整通过。

只读审查按 implement 要求执行 open-code-review-delegate：源码、生成包、测试、技能/说明与证据累计 13 文件全部审查，覆盖率 100%，未发现实质问题。

本轮脱敏真实证据见 [当前 Agent 宿主记录](evidence/issue-99-direct-agent-host-20260911.json)。秘密面板 URL、步骤 token 和图像传输原文不进入仓库。

本轮自动化结果与原始日志摘要见 [当前 Agent 自动化记录](evidence/issue-99-direct-agent-automation-20260911.json)。

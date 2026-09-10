# 当前 Codex 对话的工作台面板

## 能力依据与入口

2026-09-10 的当前会话实际提供 `mcp__codex_app__open_in_codex`：`placement: "right"` 配合 `target: {type: "browser", url}`，省略 `threadId` 时由宿主定位调用对话。插件通过 `skills/narracut-workbench/SKILL.md` 使用该宿主工具，启动 `panel.mjs` 并打开其本地 URL。没有该工具时，在当前对话显示能力不足，等待重试。

当前对话 Shell 的 `CODEX_THREAD_ID` 为 `01a08ab9-8932-7f43-a960-eabfc9646c5c`；本轮用宿主 `read_thread` 核对了相同 ID、工作目录及 #93 请求。启动技能要求每次从当前对话核对来源，再把环境身份绑定到该面板进程。浏览器请求参数不能改变绑定；共享 stdio MCP 进程不借用其启动环境猜测当前调用者。

[OpenAI 插件概览](https://learn.chatgpt.com/docs/plugins)说明插件可以组合技能、MCP 与可选 UI；[UI 参考](https://developers.openai.com/plugins/reference)描述的是 UI 运行时接口，本轮未从中找到能保证 Codex 当前对话右侧位置与对话 ID 的契约。因此此入口使用会话中实际提供的宿主工具，不新增私有调用，也不把 MCP display mode、返回 HTML 或 UI 握手解释成桌面位置证据。

## 运行边界

- `panel.mjs` 监听随机回环端口，以随机秘密路径承载外壳、原有工作台资源和工具转发。校验 Host、Origin、JSON 内容类型，关闭缓存与 referrer，秘密 URL 不进入文档或 issue。
- 外壳复用原工作台的 MCP Apps 握手与工具操作；项目创建、打开、Scene 保存、Asset、Preview、接受与最终 Render 仍走同一项目服务与门禁。
- 面板向既有 UI 注入自有文件选择适配器，将 `selectDirectory`、`selectFile`、`selectFiles` 转发到本地系统选择工具；覆盖启动器、Asset 导入、Render 选址及恢复/LOCAL 导出。原生命令由固定种类生成，未执行用户提供的标题或 Shell。
- `get_workbench` 读取本次会话最新项目与任务状态。关闭页面不会释放项目或终结任务，重新打开相同 URL 不重新创建项目。用户结束进程才释放服务资源。
- 创建或打开的持久结果与面板展示独立。`prepared` 表示服务就绪，宿主 `queued` 表示请求排队，两者都不表示已显示。服务失败的原因在当前对话报告；页面加载失败保留“重试显示工作台”，只重新读取当前会话。
- 没有可核实对话时，生产 stdio 入口与面板拒绝项目写工具；提供只读检查与具体原因。仅内部测试调用可不配置对话上下文。既有表格编辑和渲染条件仍由原服务执行。
- 项目名保持可见，路径、项目 ID 与对话 ID 收进详情；面板使用当前对话 Composer，底部仅保留说明。Scene 表格首开，窄面板保留检查抽屉、Asset 管理与 Agent 审阅入口。

跨对话写权转移及创作任务迁入当前 Codex Thread 是父 #92 的其他工作，不由此面板入口实现。共享 stdio 无法确认调用对话时必须走能力不足路径，不能绕过身份检查继续写入。

## 本轮验收记录

环境：Linux x64、Node 22.23.2、本地仓库构建产物；未将旧安装缓存当作新实现。宿主工具可调用，原生桌面截图能力不可用（CUA 枚举超时）。

| 检查 | 证据与边界 |
| --- | --- |
| 当前对话身份 | Shell 与 `read_thread` 对应相同 ID、目录、#93 请求 |
| 真实宿主面板打开 | `open_in_codex(right, browser)` 返回 `queued` 与上述当前对话 ID；尚未观察到实际右侧位置，不能判定通过 |
| 真实入口临时项目 | `panel.mjs --create` 在 `/tmp/narracut-issue93-desktop-20260910` 创建项目，返回 `valid`；项目 ID 为 `88163d56-2674-458d-abcc-0bd6f8ab77c9` |
| 公开入口自动化 | `tests/workbench-panel.test.ts` 验证创建、刷新、未知身份拦截与其他网站请求拒绝；`tests/e2e/workbench-panel.spec.ts` 用真实 HTTP 与项目服务验证启动器创建/打开、Scene 保存重载、Asset 导入绑定、Preview/Render 入口、错误与重试；系统选择结果由宿主边界模拟，Render 选址用已就绪的服务状态夹具 |
| 响应式视觉 | Chromium 下 1440、680、390 × 900 截图核对接触表、项目身份、底部说明和无横向溢出；这些是测试浏览器截图，不能替代 Codex 桌面截图 |

#93 的真实桌面位置验收仍待完成，因此本记录不宣称本票完整通过。补验时需在当前任务实际显示面板，核对项目名、展开的对话身份与右侧位置，并记录宿主环境及可追溯截图；真实目录选择与取消也应在目标桌面核对。

本轮执行完整 `pnpm test`：格式检查 19 条、单元 311 条通过（2 条环境限定用例跳过）、端到端 86 条通过。独立代码审查发现的文件选择器缺口和身份失效重载错误已修复，并补充定向测试；新增面板产物另在仓库外的中文空格路径验证启动、资源及绑定身份。全套中的实际 Preview、接受、同 Bundle 最终 Render 回归不等同于真实 Codex 桌面位置验收。

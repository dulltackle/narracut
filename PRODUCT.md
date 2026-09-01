# Product

<!-- impeccable:product-schema 1 -->

## Platform

Narracut 当前以本地 Codex 插件承载 Project VNext 的 Operate 工作台。插件通过 MCP 暴露只读工具和内嵌 Web UI Resource；项目内容留在用户明确指定的本地目录中。

## Users

Narracut 面向希望让 AI 承担更多视频制作工作的内容创作者与开发者。他们需要先确认项目身份、Scene 内容和固定控制文件是否可信，再逐步进入 Agent 创作、Preview 审核与最终 Render，而不是从传统多轨时间线开始。

当前交付服务于已经拥有 Project VNext 目录、需要在 Codex 中快速检查项目的人。医疗或临床设备演示只是内容场景之一，产品不绑定单一行业。

## Product Purpose

Narracut 以脚本和 Scene 为内容骨架，让 AI 创作独立的 Render Program，并让用户能够检查、理解和最终验收完整视频状态。产品长期承诺是：AI 可以提高制作速度，但 Scene 内容、时间权威、项目身份与用户接受边界必须保持清楚。

当前插件表面的承诺更窄：用户确认连接与 Project VNext 身份，扫描 Scene、Narration、Asset 引用、Speech 状态和固定控制文件，然后停在明确的只读边界。它不把尚未实现的编辑、生成或播放能力伪装成可用功能。

## Positioning

Narracut 不是传统视频编辑器，也不是在通用 IDE 三栏里堆叠媒体工具。Scene 是稳定、可扫描的内容与时间单位；Project DSL 保存最小内容事实，Render Program 独占成片表现，Narration 与 Speech 决定时间。

当前表格工作区把 Scene 表现为接触印样中的连续校片行：Narration 是主内容，Asset 只呈现身份、相对路径或缺失占位，不以缩略图画廊主导阅读。Agent 工作区与 Composer 已保留稳定位置，但在本次交付中只显示诚实的禁用外壳。

## Operating Context

- 用户在 Codex 中连接本地 Narracut MCP；`health_check` 只确认服务与只读能力边界。
- `inspect_project` 只接受用户明确给出的 Project VNext 绝对目录，不负责浏览或选择目录。
- MCP 同时返回结构化检查结果与内嵌工作台；模型和用户看到同一项目身份、检查结论与错误语义。
- 工作台顶部持续显示项目文件夹、Project ID 和连接文字；表格工作区与 Agent 工作区共享所选 Scene，禁用 Composer 固定在底部。
- 桌面端同时显示 Scene 接触表与项目检查；移动端保留 Project ID 和连接文字，并把项目检查收进可打开的抽屉。
- 字体与两张纸张/胶片 raster 由插件资源以内嵌 data URI 提供；工作台运行时不依赖公网资源。

## Capabilities and Constraints

- 当前只有连接检查与项目检查两个工具；工具均声明只读、幂等、非破坏且不访问开放世界。
- 项目检查读取并校验 `narracut.json`、`project.json` 与 `video.md`，返回项目身份、Scene 顺序、Narration、Asset ID/路径引用、Speech 可用性与 Duration 信息。
- Asset 在当前工作台只显示数量、相对路径或未绑定占位；不读取或展示 Asset 预览，不提供文件选择器或导入。
- 点击或键盘激活 Scene 行才改变选择；焦点移动本身不得隐式选择 Scene。
- 失败状态向模型和工作台返回相同的稳定错误与有界诊断，并明确说明目录未被修改。
- 当前交付不写文件，不执行 Shell，不访问网络，也不提供 Scene 编辑、TTS、Asset 导入、Preview、Render、候选管理或 Agent 创作任务。
- Composer 必须保持可见且禁用，并通过 `aria-describedby` 解释“当前交付只支持只读检查”。
- Project VNext 是对 V1–V3、封闭 Visual Type、Text Preset、固定 Composition 与独立浏览器工作台的破坏性替代；不兼容、不迁移，也不只读打开 Legacy Project。

以下是仍然有效的稳定领域承诺，而不是当前只读工作台已经提供的操作能力：

- 项目是可整体移动的目录，Project ID 在移动后保持稳定；持久引用使用项目相对路径。
- Scene 是有序且身份稳定的内容与时间单位；修改或重排不改变身份，复制会创建新身份。
- Narration 是 Scene 的旁白文本；匹配当前文本和合成配置的 Speech 是 Duration 的直接来源。
- 缺少 Speech 时只能使用明确标记、不落盘的 Draft Duration；它可以支持草稿 Preview，但不能用于最终 Render。
- Asset 是项目 `assets/` 下登记的普通文件；DSL 只持久化稳定 ID 与项目相对路径，不把运行时媒体事实写成第二份权威。
- Render Program 只负责成片表现，不能改写 Scene 内容、顺序、时间窗或权威 Speech。
- 候选 Preview 与最终 Render 必须绑定同一不可变 Bundle、输入、媒体修订与执行环境身份。

## Brand Commitments

- 产品名为 **Narracut**。
- 面向开发者和创作者的正式术语以 `CONTEXT.md` 为准，尤其是 Project VNext、Scene、Narration、Asset、Speech、Duration、Draft Duration、Video Brief、Render Program、Preview 与 Render。
- 产品表达必须明确区分“当前可用”“只读外壳”“后续能力”和“规范性长期方向”，不虚构自动化程度、客户、性能数据或行业背书。
- 高频 Operate 表面优先让项目身份、内容权威、状态与下一步可扫描；视觉个性不能牺牲中文可读性、键盘操作或错误恢复信息。

## Evidence on Hand

- `docs/spec/project-vnext.md`：Project VNext 唯一规范性产品行为、持久格式、协议、门禁与错误语义来源。
- `CONTEXT.md`：领域术语、内容与表现权威、时间模型、Asset、Speech、Preview 与 Render 的稳定定义。
- `plugins/narracut/src/server.ts`：当前只读 MCP 工具、结构化输出、UI Resource 与内嵌本地材料的实现。
- `plugins/narracut/workbench.html`：当前双工作区外壳、Scene 接触表、项目检查、移动端抽屉和禁用 Composer 的实现。
- `tests/narracut-plugin.test.ts`、`tests/project-vnext-inspection.test.ts` 与 `tests/e2e/plugin-workbench.spec.ts`：当前插件契约、只读检查与工作台行为证据。
- 当前没有已确认的客户证言、公开案例、性能基准、商业数据或行业背书；产品界面不得自行编造。

## Product Principles

1. **Scene 先于时间线。** 内容检查、Agent 创作与渲染都围绕稳定 Scene 和项目级完整视频状态组织。
2. **身份与权威必须可见。** Project ID、固定控制文件、Scene 内容、Speech 时间与 Render Program 表现不能被混成含糊的“项目状态”。
3. **边界必须诚实。** 只读就是只读；禁用能力持续可见并解释原因，不用装饰性控件暗示写入、Preview 或生成已经可用。
4. **用户明确指定范围。** 当前检查只触及用户给出的目录，不浏览其他路径、不访问网络、不产生隐藏副本。
5. **AI 结果必须可检查、可诊断、由用户接受。** Agent 不绕过硬约束，也不自动接受候选或替用户作主观视觉判断。
6. **Preview 必须代表 Render。** 当后续能力进入产品时，预览和最终产物必须绑定同一套不可变执行身份。

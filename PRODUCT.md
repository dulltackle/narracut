# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Narracut 当前以本地 Codex 插件承载 Project VNext 启动器与 Operate 工作台。插件通过 MCP 暴露受控工具和内嵌 Web UI Resource；项目内容留在用户明确指定的本地目录中。

## Users

Narracut 面向希望让 AI 承担更多视频制作工作的内容创作者与开发者。他们需要先确认项目身份、Scene 内容和固定控制文件是否可信，再逐步进入 Agent 创作、Preview 审核与最终 Render，而不是从传统多轨时间线开始。

当前交付服务于希望从空项目开始，或已经拥有 Project VNext 目录并需要在 Codex 中整理脚本 Scene 的人。医疗或临床设备演示只是内容场景之一，产品不绑定单一行业。

## Product Purpose

Narracut 以脚本和 Scene 为内容骨架，让 AI 创作独立的 Render Program，并让用户能够检查、理解和最终验收完整视频状态。产品长期承诺是：AI 可以提高制作速度，但 Scene 内容、时间权威、项目身份与用户接受边界必须保持清楚。

当前插件表面的承诺更窄：用户先通过启动器原子创建空 Project VNext，或严格打开已有有效项目，再在表格工作区编辑 Scene、导入任意普通文件为 Asset，并管理每个 Scene 的有序 Asset 引用。自动保存、Undo/Redo、逐文件导入状态、冲突与身份失效使写入边界可观察；已登记 Asset 可做宿主内只读预览。Speech、Agent、Render Program 与 Composer 仍不获得 Scene 写能力，预览也不改变选择、顺序或 Player 状态。

## Positioning

Narracut 不是传统视频编辑器，也不是在通用 IDE 三栏里堆叠媒体工具。Scene 是稳定、可扫描的内容与时间单位；Project DSL 保存最小内容事实，Render Program 独占成片表现，Narration 与 Speech 决定时间。

当前表格工作区把 Scene 表现为接触印样中的连续剪接行：Narration 是可原位编辑的主内容，Asset 列保持紧凑摘要，具体引用在右侧检查子视图管理，不以缩略图画廊主导阅读。接触表上沿的操作轨承载新增、复制、重排、删除、Undo/Redo 与项目级保存状态；Asset 子视图承载导入、添加已有登记、排序、解除引用与只读预览。Agent 工作区继续提供固定、只读的 Codex 创作线程宿主验证；Composer 保留稳定位置并诚实禁用。

## Operating Context

- 用户在 Codex 中连接本地 Narracut MCP；`health_check` 确认服务、启动器与工作台能力边界。
- 无项目参数时，启动器只通过宿主提供的系统文件夹选择窗口选择父目录或已有项目；宿主不支持时显示稳定错误，不回退到浏览器文件选择器。
- Asset 导入只接受宿主系统文件选择窗口返回的绝对路径；宿主不支持时显示稳定错误，不回退到网页上传。多选按原选择顺序逐文件处理。
- 创建只写入不存在的新目标，先在固定同级临时目录生成并完整校验，再原子发布；打开只接受严格有效的当前 Project VNext，并取得物理目录独占租约。
- `inspect_project` 只接受用户明确给出的 Project VNext 绝对目录，不负责浏览或选择目录。
- MCP 同时返回结构化检查结果与内嵌工作台；模型和用户看到同一项目身份、检查结论与错误语义。
- Agent 宿主验证由工作台自动创建或恢复专用 Codex 线程；用户不选择 Thread，也不输入 Thread ID。线程失效时继续操作会自动绑定替代线程。
- 工作台顶部持续显示项目文件夹、Project ID 和连接文字；表格工作区与 Agent 工作区共享所选 Scene、编辑内容、受 `24 MiB` 内存预算约束的 Scene 撤销历史和串行保存队列，禁用 Composer 固定在底部。
- 桌面端同时显示 Scene 接触表与项目检查；移动端保留 Project ID 和连接文字，并把项目检查收进可打开的抽屉。
- 字体与两张纸张/胶片 raster 由插件资源以内嵌 data URI 提供；工作台运行时不依赖公网资源。

## Capabilities and Constraints

- 当前共有十二个工具：连接检查、启动器、项目创建、项目打开、项目检查、仅 app 可见的 Scene 保存、Asset 导入和 Asset 预览，以及宿主验证的开始、状态读取、停止、继续。写入只接受持有当前项目租约的工作台，并以 Project ID 与磁盘基线摘要拒绝身份变化或外部冲突；Agent 看不到这些 app 专用入口。
- 项目检查读取并校验 `narracut.json`、`project.json` 与 `video.md`，返回项目身份、Scene 顺序、Narration、Asset ID/路径引用、Asset 可用性、Speech 可用性与 Duration 信息。文件不可用是不阻塞打开的运行时警告，与登记表中不存在 ID 的悬空引用分开呈现，且不自动删除引用。
- Asset 导入逐文件把普通文件字节原样复制到项目 `assets/` 下，再以唯一 ID/路径登记；不修改或就地登记源，不覆盖同名文件，明确拒绝目录、符号链接、特殊文件和项目控制文件。每个文件的复制与 DSL 提交是原子的，批次不做整体回滚。
- Scene 可有最多 256 个有序且唯一的 Asset 引用；项目最多登记 1,000 个 Asset。导入时的原目标 Scene 只是绑定提案：成功前切换选择不会改目标，原目标被删除或达到上限时 Asset 保持已登记但暂未绑定。
- 已知图像、音频、视频和 PDF 可在独立只读层中尽力预览；未知格式、过大载荷或宿主不可安全内联时显示已确认的文件事实和通用状态，不改变 Scene 选择、Player 或引用顺序。
- 点击或键盘激活 Scene 行才改变选择；焦点移动本身不得隐式选择 Scene。
- 失败状态向模型和工作台返回相同的稳定错误与有界诊断，并明确说明目录未被修改。
- 表格工作区可新增、编辑、复制、重排和删除最多 1,000 个 Scene，并为其添加、重排和解除 Asset 引用；修改 Narration 立即移除失效 Speech，复制生成新 Scene ID 且不复制 Speech。Asset 删除/重命名/转码/裁切、Speech 生成、Render、候选管理和自由 Agent 创作任务不在当前交付内。
- Scene 写入在客户端提交前和服务端落盘前独立执行严格结构、一致性、资源与身份验证；原子提交前失败保留旧持久字节和合法内存修改，外部冲突与身份失效停止自动写入。
- Composer 必须保持可见且禁用，并通过 `aria-describedby` 在表格工作区说明“Composer 不编辑 Scene，请使用接触表”，在 Agent 工作区说明完整创作指令尚未启用。
- 每个临时宿主验证任务同一时刻只有一个当前线程驱动；停止、重绑或线程失效会先撤销旧驱动写权，迟到回调只能产生有界诊断。
- 持久检查点只包含任务 ID、状态、停止原因与可失效线程指针，不保存对话副本、推理、工具日志或未提交修改。
- Project VNext 是对 V1–V3、封闭 Visual Type、Text Preset、固定 Composition 与独立浏览器工作台的破坏性替代；不兼容、不迁移，也不只读打开 Legacy Project。

以下是继续约束当前表格工作区和后续能力的稳定领域承诺：

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
- `src/server/project-lifecycle.ts`、`src/server/project-vnext-inspection.ts` 与 `src/server/project-asset-preview.ts`：项目租约内的 Asset 复制/登记、运行时可用性检查与安全只读预览实现。
- `plugins/narracut/src/server.ts`、`plugins/narracut/src/codex-host.ts` 与 `plugins/narracut/src/codex-app-server-host.ts`：MCP 工具、Asset app-only 工具、宿主状态机、Codex app-server 适配器、结构化输出与 UI Resource 的实现。
- `plugins/narracut/workbench.html` 与 `plugins/narracut/workbench.js`：当前双工作区外壳、Scene 接触表、Asset 子视图/预览层、Agent 宿主验证、移动端抽屉和禁用 Composer 的实现。
- `tests/project-lifecycle.test.ts`、`tests/narracut-plugin.test.ts`、`tests/project-vnext-inspection.test.ts` 与 `tests/e2e/plugin-workbench.spec.ts`：Asset 字节导入、安全拒绝、插件契约、可用性状态、引用管理、预览与响应式工作台行为证据。`tests/codex-host-validation.test.ts` 和 `tests/narracut-codex-host.live.test.ts` 继续覆盖宿主验证。
- 当前没有已确认的客户证言、公开案例、性能基准、商业数据或行业背书；产品界面不得自行编造。

## Product Principles

1. **Scene 先于时间线。** 内容检查、Agent 创作与渲染都围绕稳定 Scene 和项目级完整视频状态组织。
2. **身份与权威必须可见。** Project ID、固定控制文件、Scene 内容、Speech 时间与 Render Program 表现不能被混成含糊的“项目状态”。
3. **边界必须诚实。** 只读就是只读；禁用能力持续可见并解释原因，不用装饰性控件暗示写入、Preview 或生成已经可用。
4. **用户明确指定范围。** 检查只触及用户给出的项目目录；Asset 导入只读取用户在系统窗口明确选择的源文件，并为项目产生可见副本。不浏览其他路径，不访问网络。
5. **AI 结果必须可检查、可诊断、由用户接受。** Agent 不绕过硬约束，也不自动接受候选或替用户作主观视觉判断。
6. **Preview 必须代表 Render。** 当后续能力进入产品时，预览和最终产物必须绑定同一套不可变执行身份。

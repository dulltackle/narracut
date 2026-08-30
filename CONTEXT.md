# narracut

以**脚本句子**为编辑单位的视频生成工具。用户编辑的是脚本及其对应视觉，不是时间线。

## Language

### 工作区

**表格工作区**：
以逐 Scene 表格检查和管理 Narration、Asset、Speech 等项目内容的工作区。
_Avoid_: 表格模式

**Agent 工作区**：
用户与 Agent 围绕 Video Brief 和现有 Scene 内容共同塑造成片表现的工作区；Agent 不写 Scene 内容，需要修改时只提出建议，由用户回到表格工作区手工完成。
_Avoid_: Agent 模式、聊天模式

**Agent 创作任务**：
用户明确发起的一次有边界的自主创作循环；Agent 在任务内持续读取最新输入、修改候选 Render Program、运行快速检查、构建候选 Preview 并检查时间线代表点，直到候选就绪、需要用户决策或用户停止，不作为脱离任务的后台创作进程。任务期间相关项目输入变化时，Agent 自动作废过期执行结果、读取最新值并继续，不要求用户确认这次追赶；切换工作区不停止任务。
_Avoid_: 后台 Agent、常驻 Agent

**当前创作指令**：
用户发起或继续 Agent 创作任务时明确表达的本次意图；在成片表现上它优先于 Video Brief 和现有 Render Program，但不能推翻 Scene 内容、时间、Speech、确定性或其他系统硬约束。Agent 必须指出它与 Video Brief 的实质分歧，不得据此静默修改 Brief。
_Avoid_: 临时 Prompt、隐式 Brief 修改

**候选 Render Program**：
一次 Agent 创作任务从当前 Render Program 派生的隔离工作版本；它是 Agent、人工或外部工具修改 Render Program 的唯一可写对象，每个项目同时最多只有一个。每批成功修改都原子持久化；停止或应用重启后候选以停止状态保留，外部工具在任务期间改变候选会使旧结果失效并暂停任务，只有明确放弃才删除，只有用户明确接受后才成为新的当前 Render Program。
_Avoid_: 草稿分支、临时补丁

**Render Program 修订**：
用户明确接受候选后形成的一份完整、不可变 Render Program；它有稳定身份，并关联完整程序树指纹、前一当前修订、接受时核对的 Video Brief 与项目输入指纹，以及接受时间、来源和一行变更摘要，而不复制项目输入或 Agent 对话。Agent、人工或外部工具都不能继续改写修订，观察到的字节变化属于损坏而不是新版本。
_Avoid_: 备份、可变版本

**当前 Render Program**：
项目唯一生效的 Render Program，由单一当前指向关系选定一个 Render Program 修订；接受候选只原子改变这一关系，不改写既有修订。
_Avoid_: 当前源码目录、工作树

**Render Program 历史**：
随项目保存、由最近 20 个已接受 Render Program 修订（包含当前修订）组成的限量历史；接受新候选后，超过数量边界的最旧修订自动删除，损坏但非当前的修订在自然裁剪前仍占一个名额且不可用于比较或回退。
_Avoid_: 无限历史、外部备份

**候选恢复检查点**：
紧邻当前候选、只用于存储完整性失败恢复的上一份完整候选状态；它不参与 Preview，也不是第二个候选，每批成功修改都会换代，接受或放弃候选时随候选删除。
_Avoid_: 候选历史、第二候选、自动保存版本

**Render Program 回退**：
从一个仍被保留的历史修订创建新候选，再针对最新项目输入完成检查、Preview 和用户接受；它不直接改变当前指向关系，已有候选必须先接受或放弃。
_Avoid_: 指针回滚、直接恢复

**Render Program 接受**：
用户把已经对应最新项目输入并通过阻断检查的完整候选提交为新修订的原子动作；提交点同时选定新当前修订并消费候选，此前失败保留旧当前与候选，此后的历史裁剪和遗留文件清理不撤销接受。
_Avoid_: 发布、逐文件覆盖、局部接受

**Render Program 存储完整性失败**：
Render Program 的文件不可读、修订元数据损坏、应有文件缺失、完整树指纹不符或当前指向关系不一致，以致系统不能信任持久字节的状态；源码、Manifest、类型或构建诊断不属于存储完整性失败。
_Avoid_: 编译失败、构建失败、普通诊断

**候选 Preview**：
最新候选 Render Program 通过构建后产生的不可变 Preview 产物；最新源码检查失败时，上一份成功产物可以继续显示，但必须明确标记为过期。Agent 在交付前检查整条时间线的代表帧、Scene 边界、Transition、运动片段和诊断；用户可以在当前版本与候选 Preview 间比较，只有与最新候选和最新项目输入完全对应、通过阻断检查的版本才能被接受，零 Scene 时允许以 Manifest 与构建检查代替运行期 Preview。
_Avoid_: 实时源码预览、自动发布

**Preview 实例**：
一次把不可变 Remotion Bundle、Render Program Input、Asset 与权威 Speech 的 Media Revision 以及执行环境共同锁定的只读 Preview 执行。实例只接受一次初始绑定；其中任一身份变化都会使旧实例过期并产生新实例，旧实例可以继续显示，但不能冒充新输入或用于接受候选。
_Avoid_: 可变 Preview 会话、热替换输入、实时源码执行

**候选交付**：
Agent 认为候选 Render Program 就绪时提交给用户判断的完整结果，包含目标与变更摘要、输入新鲜度、检查结果、候选 Preview、非阻断警告和 Scene 修改建议。用户只能整体接受候选，也可以要求继续修改、停止或放弃；Agent 不自动接受。
_Avoid_: 自动发布、局部接受

**Scene 修改建议**：
Agent 针对稳定 Scene ID 提出的不可执行结构化建议，记录当前观察、建议操作、建议值、理由和相关 Scene；它可以把用户带回表格工作区并提供可复制内容，但不能直接或一键修改 Scene。普通优化建议不阻断 Agent 创作任务；若建议所指修改是完成目标的前置条件，任务等待用户在表格工作区修改，随后自动读取新内容并继续。
_Avoid_: Scene Patch、自动修复

**Video Brief**：
人与 Agent 共享、保存于自由格式 `video.md` 的项目级创作意图；当前不规定固定章节、front matter、字段或其他文档结构。它可以提及任何创作信息，但不作为逐 Scene 内容的权威来源，也不是可执行程序；“Brief 待复核”表示当前已接受 Render Program 尚未根据 `video.md` 的最新字节版本完成复核，只有接受明确基于该版本制作的候选 Render Program 才能清除。
_Avoid_: Prompt、Agent 日志、Render Plan

**Render Program**：
随项目保存、由 Agent 持续创作的 Remotion 程序；它在完整项目时间线上使用只读 Scene 内容和时间窗塑造成片表现，但不拥有或改写 Scene 内容、Composition 骨架或权威 Speech 音轨。它可以按稳定 Scene ID 分支、让视觉层和 Transition 跨越 Scene 边界，并保存自己的文字、参数与结构；颜色、字体、Logo 用法、画面文字、版式、运动、音乐、音效及其他非 Speech 成片表现都只由 Render Program 决定。
_Avoid_: Visual Type、Render Plan、临时代码

**Render Program Entry**：
Render Program 在固定源码位置提供的命名项目级 React 入口，只接收一个完整 Render Program Input；它不注册 Remotion Root 或 Composition。没有 Scene 时 Runtime 不调用 Render Program Entry，而是显示工作区空状态。
_Avoid_: Remotion Entry Point、Composition Root、动态入口

**Render Program Runtime**：
Narracut 拥有的 Render Program 执行边界；它向 Render Program 提供只读项目内容与时间线，并独占 Composition 骨架、Scene 顺序、Duration、项目总时长和权威 Speech 音轨。Render Program Runtime 允许成片表现跨越 Scene 边界，但不允许 Render Program 替换或移动权威 Speech。
_Avoid_: Render Program Host、Agent Runtime

**Preview Bridge**：
Render Program Runtime 注入同一不可变 Remotion Bundle 的最小 Player 壳与版本化宿主消息接口；宿主工作区通过它控制 Preview，但不导入项目源码，也不把 Remotion Studio、Player Ref 或 Bundle 内部全局变量当作产品接口。Preview Bridge 只承载预览控制与观察，不向 Render Program 暴露 Narracut 写能力。
_Avoid_: Remotion Studio 嵌入、宿主 Player、远程项目模块

**Render Program Input**：
Render Program Runtime 为一次 Preview 或 Render 生成的完整、只读、有协议主版本的专用输入值，而不是 DSL 的副本；它既使用深只读类型也在运行时深冻结，作为 Render Program Entry 的唯一参数，且不暴露 Preview/Render 模式。它包含当次原始 Video Brief、项目总帧数、Output Format、带 Narration、Asset ID 和 Scene Time Window 的有序 Scene，以及至少被一个 Scene 引用的 Asset；每个 Scene Time Window 明确标记来自 Speech 或 Draft Duration。每个可用 Asset 带稳定 ID、项目相对路径和 Runtime 生成的读取地址；文件不可用的已引用 Asset 仍保留 ID 与相对路径并明确标记为不可用，但没有读取地址。Render Program Input 不公开 Project ID、Speech 文件地址、`sourceTextHash` 或 `ttsProfileId`，也不在执行期间从 `project.json` 或实时项目 API 补读。项目内容变化会产生新的 Render Program Input，已经开始的执行继续使用原值。
_Avoid_: Runtime Snapshot、Render Plan、实时项目状态

**Output Format**：
Render Program 声明、Render Program Runtime 校验并用于创建 Composition 的画布宽度、画布高度与帧率。它属于成片表现，不进入 DSL，并且在一次 Preview 或 Render 中保持不变。
_Avoid_: Project Format、画布配置

**Render Program Manifest**：
Render Program 中由 Runtime 在执行源码前读取和校验的静态声明；它必须声明 Render Program Input 的协议主版本，以及由整数画布宽度、画布高度和帧率组成的 Output Format，不使用隐藏默认值或可执行函数动态计算。它属于 Render Program，不进入 DSL 或项目清单；Runtime 对不支持的协议主版本明确拒绝，同一主版本可以增加可选字段，但不能删除字段或改变既有含义，Render Program 必须忽略未知字段。
_Avoid_: 项目清单、动态配置

**Program Resource**：
Render Program 源码或锁定依赖携带、只服务于表现实现的字体、Shader、纹理或其他资源；它属于 Render Program，不进入 Asset 登记表。用户导入并作为 Scene 源材料使用的文件不是 Program Resource，必须登记为 Asset 并由 Scene 引用。
_Avoid_: 用 Program Resource 隐藏 Scene Asset

**Render Program 执行胶囊**：
Narracut 用于运行任何可能执行项目代码之阶段的认证隔离环境；安装、构建、Metadata、Preview 与 Render 只能在其中按阶段取得最小能力，胶囊不可用时这些操作失败关闭。
_Avoid_: Render Worker、容器、受信项目模式

**执行环境指纹**：
稳定标识一套认证 Render Program 执行胶囊及其 Runtime、工具链和确定性配置的组合；每个已接受修订关联一个执行环境指纹，指纹变化只能经新候选重新验收，不能静默改变既有修订的执行环境。
_Avoid_: 应用版本、最新环境、自动升级标记

**离线依赖库**：
随项目保存并移动、按 registry 完整性摘要寻址的依赖包派生存储，覆盖候选、候选恢复检查点及全部保留修订；它不属于 Render Program 修订，也不包含安装树、Bundle 或 Preview。
_Avoid_: node_modules、宿主缓存、依赖备份

**Asset Revision**：
Render Program Runtime 对 Asset 当前文件内容的运行时观察，用于识别原位替换，但不是持久化版本或历史副本。变化会使当前 Preview 的 Render Program Input 失效；Render 期间发生变化会使该次 Render 失败，防止一项产物混用变化前后的内容。
_Avoid_: Asset Version、Asset Snapshot

### 结构

**Scene**：
脚本里的一句话及其可用源 Asset。整个项目就是一串有序的 Scene，它既是编辑单位也是渲染单位；每个 Scene 持有稳定身份、Narration、可选 Speech 与零到多个有序 Asset 引用。重排或修改内容不改变其身份，复制则创建一个新的 Scene。
_Avoid_: 片段、Clip、行

**Narration**：
一个 Scene 的旁白文本，以及由它生成的 TTS 语音。它是 Scene 时长的主人。
_Avoid_: 台词、配音、解说

**Asset**：
由应用登记、位于项目根 `assets/` 下并可被 Scene 引用的任意格式普通文件；DSL 只保存稳定 `id` 与项目相对 `path`，两者在项目内分别唯一，不持久化 kind、MIME、尺寸、编码或其他运行时文件事实。Asset 不是项目外的导入源文件，不得是目录、符号链接或项目控制文件。Asset 属于项目而不隶属于任一 Scene，可以暂不被引用；每个 Scene 保存一组有序且不重复的 Asset 引用，每个引用都必须指向登记表中的 Asset，且不记录角色或表现参数。Render Program 可以跨 Scene 使用任何已被至少一个 Scene 引用的 Asset，但不能使用完全未绑定的 Asset。移动路径或原位替换内容不会自然变成另一个 Asset。
_Avoid_: 素材文件、媒体、Media

**Asset 预览**：
对一个 Scene 当前引用且登记表中存在的 Asset 本体的只读检查，不包含 Subtitle 或其他成片表现，也不改变当前 Scene 选择或 Player 状态。表格工作区对已知格式提供尽力预览，对未知格式显示通用文件信息；磁盘文件不可用时仍保留检查入口并明确显示不可用状态，悬空 Asset ID 则没有可预览对象。
_Avoid_: Scene 预览、成片预览

**导入源**：
用户交给导入流程、但尚未成为 Asset 的外部文件。Narracut 永不修改导入源；它逐字节复制进项目的 `assets/` 后才登记为 Asset。DSL 不记录导入源的路径或它与 Asset 的来源关系；即使导入源已经位于项目文件夹内，系统仍另行复制并登记 Asset。

**匹配提案**：
用户声明某个导入源成功生成 Asset 后应绑定到哪个 Scene 的意图。Job 成功前它不是 Asset 绑定；只有 Asset 实际产生后，匹配提案才可能兑现为 Scene 对 Asset 的引用。

**Speech**：
一个 Scene 的当前 Narration 文本经 TTS 生成、且仍与当前文本和合成配置匹配的音频文件，存放在项目文件夹内，是 Duration 的直接来源。Scene 为它保存项目相对 `path`、`durationMs`、`sourceTextHash` 与 `ttsProfileId`；Narration 或合成配置变化后，该 Scene 不再拥有 Speech，不保留 Stale Speech 状态。
_Avoid_: 语音、配音文件、音频

### 视觉

**Subtitle**：
Render Program 根据 Narration 派生的旁白文字表现，不单独存储为 Scene 内容。是否显示以及如何显示完全由 Render Program 决定。
_Avoid_: Caption、字幕（在中文讨论里指代不清时使用 Subtitle）

### 时间

**Duration**：
一个 Scene 在成片中占用的整帧时长，由完整 Speech 的实际时长向上量化得到；不裁剪 Speech 的首尾近静音、不加 Padding，也不允许手动覆盖。Asset 在这个时间窗内如何出现完全由 Render Program 决定；缺失 Asset 不改变 Duration。

**Draft Duration**：
Scene 缺少 Speech 时由 Render Program Runtime 提供、并在 Render Program Input 中明确标记的临时时长估算。它不是 Duration，不落入 DSL，只能用于草稿 Preview，不能用于最终渲染。

**Scene Time Window**：
一个 Scene 在项目全局帧轴上的半开区间，由整数 `startFrame` 与 `durationInFrames` 表示；结束帧等于两者之和且不属于该 Scene。Render Program 可以让成片表现跨越 Scene Time Window，但不能改变窗口本身。
_Avoid_: 毫秒窗口、浮点时间段

**Transition**：
相邻 Scene 视觉在边界附近的衔接方式。Transition 完全由 Render Program 定义，不作为逐 Scene 内容字段；它不得改变 Speech 时间窗或项目总时长。

### 产物

**项目**：
一个可整体移动且具有有效项目清单的文件夹，包含 `project.json`（即 DSL）、`video.md`、Render Program、该项目的 Asset、Speech 与渲染产物；不符合当前格式的文件夹不是项目。项目内的持久引用都相对项目根，不依赖文件夹当前所在的绝对路径。

项目不持久化显示名称；界面使用项目文件夹名作为位置相关的显示标签。创作标题属于 Video Brief 或 Render Program，不是项目身份或 DSL 元数据。

**项目清单**：
项目根的 `narracut.json`，是应用判断一个文件夹是否为项目及其 Project ID 的唯一身份依据；其中的 `formatVersion` 同时决定项目目录布局与 DSL Schema，`project.json` 不再保存独立版本号。缺失、损坏、标识错误或格式版本不受支持的清单均表示该文件夹不是项目。
_Avoid_: 项目标记、版本文件

**Project ID**：
创建项目时生成并写入项目清单的稳定 UUID；移动项目不改变它，正式复制项目时生成新的 ID。手工复制整个文件夹会保留 ID，因此得到的是同一项目的副本。
_Avoid_: 文件夹 ID、路径 ID

**项目写入租约**：
同一物理项目目录在任一时刻只授予一个 Narracut 进程的独占写入资格；另一进程不能进入该目录的工作区，崩溃遗留资格只有在确认原持有进程不存在后才能回收。
_Avoid_: Project ID 锁、外部编辑锁

**正式复制**：
由 Narracut 明确创建的完整项目副本；副本获得新的 Project ID，因此是独立项目。手工复制文件夹不是正式复制，它保留原 Project ID。
_Avoid_: 手工复制、另存为

**恢复快照**：
项目身份失效时，从工作区未保存内存状态导出到项目外的单文件恢复资产；它只能以原 Project ID 重建项目，不能合并到不同 Project ID 的项目。
_Avoid_: 渲染快照、备份

**DSL**：
`project.json` 的内容，只描述表格工作区拥有的项目内容，不保存独立版本号，也不描述项目身份、显示名称或完整成片表现；它的 Schema 由项目清单的 `formatVersion` 决定。Render Program 是成片表现的独立权威来源。DSL 要求可序列化、可版本升级、可校验，Agent 只能读取而不能写入。
_Avoid_: 配置、Schema（Schema 专指校验用的 Zod 定义）

**渲染快照**：
发起一次渲染时冻结下来的那一份 DSL 副本。渲染只读它，因此渲染期间可以继续编辑而不影响成片。它与产出的 MP4 存放在同一个目录里。
_Avoid_: Snapshot、备份

**Preview = Render**：
本项目的核心约束：编辑器里的实时预览与最终渲染出的 MP4 必须逐帧一致。所有技术选择都受它约束。

**Render-ready**：
项目至少有一个 Scene，且每个 Scene 都具备非空 Narration 和仍与当前文本及合成配置匹配的 Speech；Scene 不需要 Asset。DSL 可以在零 Scene、空 Narration、缺 Speech、空 Asset 引用或存在未绑定 Asset 时保持结构合法；这种项目可以保存和草稿预览，但不能发起最终渲染。Render Program 的编译与运行诊断构成独立的最终渲染门槛。

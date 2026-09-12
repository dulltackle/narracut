# narracut

以**脚本句子**为编辑单位的视频生成工具。用户编辑的是脚本及其对应视觉，不是时间线。

本文件只定义词义与核心区别。具体行为统一查阅 [Project VNext 规范](docs/spec/project-vnext.md)：项目与 Scene 格式见第 3–5 节，Runtime 输入见第 6 节，候选与任务状态机见第 7–8 节，执行与验收见第 9–12 节，项目生命周期与恢复见第 13–14 节。

## Language

### 工作区

**表格工作区**：
以逐 Scene 表格检查和管理 Narration、Asset、Speech 等项目内容的工作区。
_Avoid_: 表格模式

**Agent 工作区**：
用于查看 Agent 创作任务状态、比较当前与候选 Preview、审阅候选交付并接受或放弃候选的工作区；不提供聊天输入或发起创作功能，创作对话使用 Codex 当前对话。
_Avoid_: Agent 模式、聊天模式

**Agent 创作任务**：
用户明确发起、围绕候选 Render Program 形成并审阅成片的一次自主创作循环；停止保留继续同一任务的可能，终结结束该任务。
_Avoid_: 后台 Agent、常驻 Agent

**Codex 创作线程**：
承载 Agent 创作任务的当前 Codex 对话；一个任务只有一个线程拥有写权，同一对话可顺序承载多个任务。线程记录不是随项目移动的权威状态。
_Avoid_: 项目聊天记录、永久项目线程、Render Program 历史

**Agent 任务检查点**：
随项目保存、用于停止后继续同一 Agent 创作任务的单一最小状态；它关联当前创作指令、持久成果与可失效的线程指针，不是对话或任务历史。
_Avoid_: Agent 对话备份、任务事件日志、第二份 Render Program 历史

**Agent 创作任务状态**：
任务的四种稳定状态：运行中、等待用户、已停止和已终结；状态与具体原因分别表达，等待用户期间没有后台 Agent 动作。
_Avoid_: 每原因一种状态、自由文本状态、后台等待

**Agent 任务恢复**：
用户在当前 Codex 对话明确继续已停止任务，依据最后安全的任务检查点、候选与最新项目内容恢复创作；不从聊天记录或模型内存推断状态。
_Avoid_: 进程恢复、模型内存恢复、从聊天记录猜测任务状态

**当前创作指令**：
用户对本次 Agent 创作任务明确表达的创作意图，由初始要求和后续明确修订的原文组成；成片表现上优先于 Video Brief 与既有 Render Program，但受系统硬约束限制。
_Avoid_: 临时 Prompt、隐式 Brief 修改

**候选 Render Program**：
从当前 Render Program 派生的隔离工作版本，是 Agent、人工和外部工具修改程序的唯一可写对象；每个项目同时最多一个，用户明确接受后才成为当前修订。
_Avoid_: 草稿分支、临时补丁

**Render Program 修订**：
用户明确接受候选后形成的完整、不可变 Render Program，具有稳定身份并关联接受时的程序与输入证据；字节被改写属于损坏，不是新修订。
_Avoid_: 备份、可变版本

**当前 Render Program**：
项目唯一生效的 Render Program，由单一当前指向关系选定一个 Render Program 修订；接受候选只原子改变这一关系，不改写既有修订。
_Avoid_: 当前源码目录、工作树

**Render Program 历史**：
随项目保存的限量已接受修订集合，包含当前修订；它保留可审核和重新验收的程序版本，不是无限历史或项目备份。
_Avoid_: 无限历史、外部备份

**候选恢复检查点**：
只用于候选存储完整性恢复的上一份完整候选状态；不参与 Preview，也不是第二候选或候选历史。
_Avoid_: 候选历史、第二候选、自动保存版本

**Render Program 回退**：
从保留的有效历史修订创建新候选，再依据最新项目输入重新检查和接受的操作。
_Avoid_: 指针回滚、直接恢复

**Render Program 接受**：
用户将对应最新输入并通过阻断检查的完整候选视频状态原子提交为新修订的动作；接受对象包含 Preview 所代表的成片，不只是源码。
_Avoid_: 发布、逐文件覆盖、局部接受

**Render Program 存储完整性失败**：
Render Program 的文件不可读、修订元数据损坏、应有文件缺失、完整树指纹不符或当前指向关系不一致，以致系统不能信任持久字节的状态；源码、Manifest、类型或构建诊断不属于存储完整性失败。
_Avoid_: 编译失败、构建失败、普通诊断

**Render Program 诊断**：
对特定程序、输入与执行环境下已观察事实的稳定结构化描述；它提供可证明的问题位置与修复信息，不直接决定操作是否可用，也不替用户作审美判断。
_Avoid_: 门禁结果、验收结论、自动审美评分

**Render Program 门禁**：
根据最新诊断与验收证据，分别判断候选 Preview、交付、接受和最终 Render 是否可用的规则；系统硬约束的阻断不可覆盖。
_Avoid_: 诊断、统一错误级别、仍然继续

**非阻断警告**：
不违反系统硬约束、但可能影响成片质量或维护性的已知问题；候选交付必须明确展示，用户可以通过接受整个候选一并接受，不需要逐条确认。
_Avoid_: 可忽略的错误、可覆盖的阻断

**Render Program 验收证据**：
与完整候选视频状态绑定的检查结果、诊断、候选 Preview 身份和代表帧证据；它证明 Render Program 门禁所需事实已经准备好，但不证明用户观看了多少内容，也不替用户作视觉判断。证据所绑定的 Render Program、项目输入、Media Revision 或执行环境任一身份变化都会使它过期。
_Avoid_: 用户观看记录、自动验收、审美评分

**Render Program 验收记录**：
接受时随修订保存的精简、不可变检查记录，关联完整视频状态与验收结果；不保存 Bundle、完整日志或代表帧图片，也不证明用户观看范围。
_Avoid_: Bundle 缓存、Preview 录屏、用户观看记录

**Render Program Bundle**：
固定工具链在特定执行环境中构建的不可变派生产物，以完整字节指纹标识；它是 Preview 与最终 Render 共用的执行产物，不属于修订或可移动项目内容。
_Avoid_: 源码目录、Render Program 修订、可变开发服务器

**Render Program 检查批次**：
绑定同一程序、项目输入与执行环境身份的一组分阶段检查结果；身份变化使整批过期，不能混用新旧结果。
_Avoid_: 单一错误、跨版本诊断集合、失败即全局停止

**候选 Preview**：
候选 Render Program 成功构建后产生的不可变预览产物；旧成功产物可供查看，但过期结果不能作为最新候选的接受依据。
_Avoid_: 实时源码预览、自动发布

**Preview 实例**：
锁定不可变 Bundle、Render Program Input、媒体版本与执行环境的一次只读 Preview 执行；身份变化后，旧实例不再代表新状态。
_Avoid_: 可变 Preview 会话、热替换输入、实时源码执行

**候选交付**：
Agent 将候选成片及目标、变更和检查证据交给用户判断的完整结果；候选由用户整体接受，Agent 不自动接受。
_Avoid_: 自动发布、局部接受

**Scene 修改建议**：
Agent 针对稳定 Scene ID 提出的不可执行结构化建议；内容修改由用户在表格工作区完成。
_Avoid_: Scene Patch、自动修复

**Video Brief**：
人与 Agent 共享的自由格式项目级创作意图，不是逐 Scene 内容权威或可执行程序；“Brief 待复核”表示当前修订尚未基于最新版 Brief 完成复核。
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
Runtime 为一次执行提供的完整、不可变、只读项目内容与时间线投影，是 Render Program Entry 的唯一输入；它不是 DSL 副本，也不暴露实时项目状态或宿主能力。
_Avoid_: Runtime Snapshot、Render Plan、实时项目状态

**Output Format**：
Render Program 声明、Render Program Runtime 校验并用于创建 Composition 的画布宽度、画布高度与帧率。它属于成片表现，不进入 DSL，并且在一次 Preview 或 Render 中保持不变。
_Avoid_: Project Format、画布配置

**Render Program Manifest**：
Render Program 在执行源码前可读取和校验的静态声明，包含输入协议主版本与 Output Format；它属于程序，不是项目清单。
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
由应用登记、可被 Scene 引用的项目内普通文件，具有稳定身份和项目相对路径；它属于项目而非某个 Scene，路径或内容变化不自然产生新身份。
_Avoid_: 素材文件、媒体、Media

**Asset 预览**：
对 Scene 引用的 Asset 本体进行的只读检查；它不包含 Subtitle 或其他成片表现，也不改变 Scene 选择或 Player 状态。
_Avoid_: Scene 预览、成片预览

**导入源**：
用户交给导入流程、尚未成为 Asset 的外部文件；它保持原样，复制进项目并登记后产生独立 Asset。

**匹配提案**：
用户声明某个导入源成功生成 Asset 后应绑定到哪个 Scene 的意图。Job 成功前它不是 Asset 绑定；只有 Asset 实际产生后，匹配提案才可能兑现为 Scene 对 Asset 的引用。

**Speech**：
当前 Narration 经 TTS 生成、仍与文本、合成配置及已提交音频内容匹配的项目内音频，是 Duration 的直接来源；文本或配置改变后不保留 Stale Speech。
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
项目根用于判定项目有效性及 Project ID 的唯一身份文件；其中的格式版本同时决定目录布局和 DSL Schema。
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

**恢复截面**：
项目身份失效后冻结内存编辑、与在途原子提交对账而封存的一致状态；它包含未安全落盘的用户成果与持久基线，不含未提交 Agent 修改。
_Avoid_: 实时恢复状态、Agent 工作副本

**恢复基线**：
恢复截面绑定原项目持久内容的逐项身份与精确字节证据，用于核验恢复来源；它不是单一项目校验和。
_Avoid_: 项目备份、单一项目校验和

**恢复来源**：
用户明确指定、仍可读取且逐项匹配恢复基线的持久项目内容目录；原路径只提供定位提示，不证明身份。
_Avoid_: 最近项目、自动发现的副本、备份目录

**恢复快照**：
从恢复截面导出的项目外单文件增量资产，携带未落盘的 DSL、Video Brief 与必要校验证据；恢复仍依赖匹配的持久来源，它不是完整项目备份。
_Avoid_: 渲染快照、备份

**恢复计划**：
快照与来源通过只读验证后形成的待确认差异视图，说明将恢复的内容、保持的状态及阻断问题；它不创建或修改目标项目。
_Avoid_: 恢复预览项目、部分恢复结果

**项目恢复**：
用恢复快照与精确匹配的来源，在新路径原子重建原 Project ID 并应用用户未落盘成果的有限操作；全有或全无，不合并既有项目，也不创建 Render Program 修订。
_Avoid_: 合并项目、正式复制、续传恢复

**恢复载荷导出**：
完整项目恢复被来源问题阻断时，将独立验证通过的 DSL 或 Brief 载荷抢救为项目外普通文件的操作；导出物不是项目，也不能自动覆盖或合并到项目。
_Avoid_: 部分项目恢复、自动导入、损坏数据提取

**DSL**：
表格工作区拥有的可序列化项目内容，由项目格式决定 Schema；它不拥有项目身份或成片表现，Agent 只能读取。
_Avoid_: 配置、Schema（Schema 专指校验用的 Zod 定义）

**渲染快照**：
发起一次渲染时冻结下来的那一份 DSL 副本。渲染只读它，因此渲染期间可以继续编辑而不影响成片。它与产出的 MP4 存放在同一个目录里。
_Avoid_: Snapshot、备份

**Preview = Render**：
本项目的核心约束：编辑器里的实时预览与最终渲染出的 MP4 必须逐帧一致。所有技术选择都受它约束。

**Render-ready**：
项目具备最终 Render 所需 Scene 内容的状态：至少一个 Scene，且各自具有非空 Narration 和匹配的 Speech，Asset 非必需；程序检查另有独立门禁。
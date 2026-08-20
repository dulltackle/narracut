# narracut

以**脚本句子**为编辑单位的视频生成工具。用户编辑的是脚本及其对应视觉，不是时间线。

## Language

### 结构

**Scene**：
脚本里的一句话及其对应的一段视觉。整个项目就是一串有序的 Scene，它既是编辑单位也是渲染单位；重排或修改内容不改变其身份，复制则创建一个新的 Scene。
_Avoid_: 片段、Clip、行

**Narration**：
一个 Scene 的旁白文本，以及由它生成的 TTS 语音。它是 Scene 时长的主人。
_Avoid_: 台词、配音、解说

**Visual**：
一个 Scene 的画面部分。由一个 Visual Type 加上该 type 的内容字段构成。

**Visual Type**：
Visual 的有限种类，只有 `Card`、`Image` 和 `Video`。用户不能自由编写渲染组件，只能在这个封闭清单里选；Image 和 Video 可以带有 Caption。

**Card**：
不依赖 Asset、由系统根据 Text Block 生成画面的 Visual。Card 可以出现在项目的任意位置，用于标题、章节页、总结、引用或其他文字画面，但不记录这些业务用途。

**Asset**：
由导入源在本机规范化后进入项目、可被多个 Scene 或 Project Theme 引用的静态图片或实拍视频，显式区分为 `image` 与 `video` 两种 kind；它不是项目外的导入源文件。Asset 属于项目而不隶属于任一 Scene，可以暂不被引用；移动路径或原位替换内容不会自然变成另一个 Asset。静态图片和视频都全程留在本机，V1 中视频 Asset 不含音轨。
_Avoid_: 素材文件、媒体、Media

**Asset 预览**：
对一个 Scene 当前引用且登记表中存在的 Asset 本体的只读检查，不包含所属 Scene 的 Caption、Subtitle 或其他成片表现，也不改变当前 Scene 选择或 Player 状态。预览按 Asset 自身的 kind 呈现；磁盘文件不可用时仍保留检查入口并明确显示不可用状态，悬空 Asset ID 则没有可预览对象。
_Avoid_: Scene 预览、成片预览

**导入源**：
用户交给导入流程、但尚未成为 Asset 的外部文件。Narracut 永不修改导入源，也不额外把原件副本保存进项目；DSL 不记录导入源的路径或它与 Asset 的来源关系。即使导入源已经位于项目文件夹内，系统仍另行生成规范化 Asset。

**匹配提案**：
用户声明某个导入源成功生成 Asset 后应绑定到哪个 Scene 的意图。Job 成功前它不是 Asset 绑定；只有 Asset 实际产生后，匹配提案才可能兑现为 Scene 对 Asset 的引用。

**视频 Asset 规范**：
V1 的视频导入源只接受 MP4/MOV 容器中的单路 H.264 或 HEVC 视频：8/10-bit、4:2:0、逐行 SDR；允许旋转元数据，拒绝 HDR、Alpha、隔行和多视频轨，源音轨不进入 Asset。导入后唯一合法的视频 Asset 为 1920×1080、30fps CFR、方形像素、BT.709 limited-range、8-bit `yuv420p` 的 H.264 High@4.1 MP4，无音轨和元数据。非 16:9 画面完整 `contain` 于暖黑 `#2A2226` 背景；低分辨率可放大但产生 warning，不裁切或拉伸。

**Speech**：
一个 Scene 的当前 Narration 文本经 TTS 生成、且仍与当前文本和合成配置匹配的音频文件，存放在项目文件夹内，是 Duration 的直接来源。Narration 或合成配置变化后，该 Scene 不再拥有 Speech；V1 不保留 Stale Speech 状态。
_Avoid_: 语音、配音文件、音频

### 视觉

**Text Block**：
由标签、标题、正文和列表组成的文字信息块，其中至少一项有内容。Card 使用完整的 Text Block，Caption 只使用其中的正文。

**Caption**：
Image 或 Video 里叠加在 Asset 画面上的可选 Text Block。Caption 不对文字的业务语义分类，在所属 Scene 的完整 Duration 内显示，并且可以与 Subtitle 同时出现；没有正文时，该 Visual 不拥有 Caption。
_Avoid_: 标注、Overlay、注释

**Text Style**：
Card 与 Caption 中 Text Block 的纯视觉与版面预设，不表达文字的业务语义，也不绑定 Visual Type。每个 Text Style 都支持标签、标题、正文和列表，并从 Project Theme 取得字体与颜色；没有单独选择 Text Style 的 Scene 跟随项目默认值，单独选择的 Scene 保持自己的 Text Style。Subtitle 不使用 Text Style。
_Avoid_: Caption Type、Caption Kind、Caption Style

**Text Motion**：
Card 与 Caption 中 Text Block 在 Scene 开始时的出现方式，不表达文字的业务语义，也不绑定 Visual Type；Text Block 一直保留到 Cut，不单独退场。没有单独选择 Text Motion 的 Scene 跟随项目默认值，单独选择的 Scene 保持自己的 Text Motion；任意 Text Style 都可以搭配任意 Text Motion。Subtitle 不使用 Text Motion。
_Avoid_: Caption Animation、Caption Motion

**Subtitle**：
画面底部逐句显示的旁白文字，内容直接取自 Narration 文本，不单独存储。与 Caption 是两个不同的东西，两者可以同时出现。
_Avoid_: 字幕（在中文讨论里指代不清时用 Subtitle 或 Caption 明确区分）

**Project Theme**：
项目中所有 Scene 共享的整体视觉语言，包括字体、颜色、Logo 以及 Card、Caption 和 Subtitle 的默认表现。作者只选择一个品牌强调色、一款可稳定渲染的字体和一个可选 Logo；Project Theme 提供默认 Text Style 与 Text Motion，但不对项目内容或 Text Block 的业务语义分类。
_Avoid_: 品牌轨、临床轨

**安全区**：
画布四边各 80px 的内缩边界，所有文字与叠加物都不越过它。

### 时间

**Duration**：
一个 Scene 在成片中占用的整帧时长，由完整 Speech 的实际时长向上量化得到；V1 不裁剪 Speech 的首尾近静音、不加 Padding，也不允许手动覆盖。视频 Asset 长了截断、短了冻最后一帧；静态图片在整个 Duration 内保持显示；缺失必需的 Asset 不改变 Duration。

**Draft Duration**：
Scene 缺少 Speech 时用于编辑器预览的临时时长估算。它不是 Duration，不落入 DSL，也不能用于最终渲染。

**冻帧**：
视频 Asset 短于 Duration 时，画面停在最后一帧直到 Scene 结束。

**静态图片**：
`kind = image` 的 Asset，没有自身时长，在所属 Scene 的整个 Duration 内保持静止。

**Cut**：
Scene 之间唯一的转场方式——硬切，无过渡。V1 不存在其他转场。

### 产物

**项目**：
一个可整体移动的文件夹，包含 `project.json`（即 DSL）、该项目的 Asset、Speech 与渲染产物。项目内的持久引用都相对项目根，不依赖文件夹当前所在的绝对路径。

**DSL**：
`project.json` 的内容，描述整个视频的完整结构。它是系统的核心数据资产，要求可序列化、可版本升级、可 AI 生成、可校验。
_Avoid_: 配置、Schema（Schema 专指校验用的 Zod 定义）

**渲染快照**：
发起一次渲染时冻结下来的那一份 DSL 副本。渲染只读它，因此渲染期间可以继续编辑而不影响成片。它与产出的 MP4 存放在同一个目录里。
_Avoid_: Snapshot、备份

**Preview = Render**：
本项目的核心约束：编辑器里的实时预览与最终渲染出的 MP4 必须逐帧一致。所有技术选择都受它约束。

**Render-ready**：
项目已经具备最终渲染所需的全部有效 Narration、Visual、Asset 与 Speech 的状态。DSL 可以结构合法但尚未 Render-ready；这种项目可以保存和草稿预览，但不能发起最终渲染。

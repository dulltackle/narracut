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
Visual 的有限种类。V1 只有六个：`Title`、`Image`、`Image+Caption`、`Video`、`Video+Caption`、`EndCard`。用户不能自由编写渲染组件，只能在这个封闭清单里选。

**Asset**：
由导入源在本机规范化后进入项目、可被 Scene 引用的静态图片或实拍视频，显式区分为 `image` 与 `video` 两种 kind；它不是项目外的导入源文件。Asset 有稳定身份，移动路径或原位替换内容不会自然变成另一个 Asset；静态图片和视频都全程留在本机，V1 中视频 Asset 不含音轨。
_Avoid_: 素材文件、媒体、Media

**导入源**：
用户交给导入流程、但尚未成为 Asset 的外部文件。Narracut 永不修改导入源，也不额外把原件副本保存进项目；DSL 不记录导入源的路径或它与 Asset 的来源关系。即使导入源已经位于项目文件夹内，系统仍另行生成规范化 Asset。

**视频 Asset 规范**：
V1 的视频导入源只接受 MP4/MOV 容器中的单路 H.264 或 HEVC 视频：8/10-bit、4:2:0、逐行 SDR；允许旋转元数据，拒绝 HDR、Alpha、隔行和多视频轨，源音轨不进入 Asset。导入后唯一合法的视频 Asset 为 1920×1080、30fps CFR、方形像素、BT.709 limited-range、8-bit `yuv420p` 的 H.264 High@4.1 MP4，无音轨和元数据。非 16:9 画面完整 `contain` 于暖黑 `#2A2226` 背景；低分辨率可放大但产生 warning，不裁切或拉伸。

**Speech**：
一个 Scene 的当前 Narration 文本经 TTS 生成、且仍与当前文本和合成配置匹配的音频文件，存放在项目文件夹内，是 Duration 的直接来源。Narration 或合成配置变化后，该 Scene 不再拥有 Speech；V1 不保留 Stale Speech 状态。
_Avoid_: 语音、配音文件、音频

### 视觉

**Caption**：
`Image+Caption` 或 `Video+Caption` 里叠加在 Asset 画面上的信息块。只有两种语义：**Step**（步骤序号 + 步骤名）和 **Alert**（警示）。固定版面，不含坐标。
_Avoid_: 标注、Overlay、注释

**Subtitle**：
画面底部逐句显示的旁白文字，内容直接取自 Narration 文本，不单独存储。与 Caption 是两个不同的东西，两者可以同时出现。
_Avoid_: 字幕（在中文讨论里指代不清时用 Subtitle 或 Caption 明确区分）

**品牌轨 / 临床轨**：
配色的两套体系，按背景是否由系统完全控制分工。品牌轨（粉）用于 Title 与 EndCard，临床轨（蓝）用于叠在图片或实拍视频 Asset 上的 Caption 与 Subtitle。

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
一个文件夹，里面有一份 `project.json`（即 DSL）和该项目的全部 Asset。整体移动不会失效——DSL 只存相对项目根的相对路径。

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

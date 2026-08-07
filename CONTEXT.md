# narracut

以**脚本句子**为编辑单位的视频生成工具。用户编辑的是脚本及其对应视觉，不是时间线。

## Language

### 结构

**Scene**：
脚本里的一句话及其对应的一段视觉。整个项目就是一串有序的 Scene，它既是编辑单位也是渲染单位。
_Avoid_: 片段、Clip、行

**Narration**：
一个 Scene 的旁白文本，以及由它生成的 TTS 语音。它是 Scene 时长的主人。
_Avoid_: 台词、配音、解说

**Visual**：
一个 Scene 的画面部分。由一个 Visual Type 加上该 type 的内容字段构成。

**Visual Type**：
Visual 的有限种类。V1 只有四个：`Title`、`Video`、`Video+Caption`、`EndCard`。用户不能自由编写渲染组件，只能在这个封闭清单里选。

**Asset**：
用户提供的实拍视频文件。每个 Scene 一个独立文件，拍摄时即按句分镜。V1 中 Asset 的音轨一律静音。
_Avoid_: 素材文件、媒体、Media

### 视觉

**Caption**：
`Video+Caption` 里叠加在实拍画面上的信息块。只有两种语义：**Step**（步骤序号 + 步骤名）和 **Alert**（警示）。固定版面，不含坐标。
_Avoid_: 标注、Overlay、注释

**Subtitle**：
画面底部逐句显示的旁白文字，内容直接取自 Narration 文本，不单独存储。与 Caption 是两个不同的东西，两者可以同时出现。
_Avoid_: 字幕（在中文讨论里指代不清时用 Subtitle 或 Caption 明确区分）

**品牌轨 / 临床轨**：
配色的两套体系，按画面有没有 Asset 分工。品牌轨（粉）用于 Title 与 EndCard，临床轨（蓝）用于叠在实拍上的 Caption 与 Subtitle。

**安全区**：
画布四边各 80px 的内缩边界，所有文字与叠加物都不越过它。

### 时间

**Duration**：
一个 Scene 的时长。由 Narration 的语音时长决定——Asset 长了截断、短了冻最后一帧。精确定义见 [10 — 时间模型定稿](https://github.com/dulltackle/narracut/issues/10)。

**冻帧**：
Asset 短于 Duration 时，画面停在最后一帧直到 Scene 结束。

**Cut**：
Scene 之间唯一的转场方式——硬切，无过渡。V1 不存在其他转场。

### 产物

**项目**：
一个文件夹，里面有一份 `project.json`（即 DSL）和该项目的全部 Asset。整体移动不会失效——DSL 只存相对项目根的相对路径。

**DSL**：
`project.json` 的内容，描述整个视频的完整结构。它是系统的核心数据资产，要求可序列化、可版本升级、可 AI 生成、可校验。
_Avoid_: 配置、Schema（Schema 专指校验用的 Zod 定义）

**Preview = Render**：
本项目的核心约束：编辑器里的实时预览与最终渲染出的 MP4 必须逐帧一致。所有技术选择都受它约束。

# 分离 Scene 内容与 Render Program 表现权威

> **状态：已接受。** 这是 [ADR-0008](./0008-project-vnext-normative-architecture.md) 的内容/表现边界 ADR。

## Decision

表格工作区独占 Scene、Narration、Asset、Speech 与顺序的写入。Agent、Render Program 和 Preview Bridge 只能读取 Runtime 投影；需要改变 Scene 时，Agent 只能给出 Scene 修改建议。

Project DSL 只保存有序 Asset 登记表与有序 Scene。Video Brief 保存自由创作意图。Render Program 独占视觉、文字、字体、Logo、版式、运动、Transition、音乐、音效、Subtitle 与 Asset 播放方式。Narracut Runtime 独占 Composition、Scene Time Window、总帧数和权威 Speech。

## Considered Options

- **保留 Visual Type 与 Text Preset 作为 Agent 可选参数**——被否。封闭枚举继续限制表现，并把内容用途与实现能力写进 DSL。
- **让 Render Program 复制 Scene 内容以获得自治**——被否。副本会在 Scene 编辑后过期，形成第二份 Narration/Asset/Speech 权威。
- **让 Agent 直接改 Scene**——被否。用户无法在表格工作区保持内容决定权。
- **只读 Runtime 投影 + Scene 修改建议**——采用。表现可以跨 Scene，但内容、Speech 与时间契约不分叉。

## Consequences

- 本 ADR 替代 ADR-0003 的“前端内存持有整个 DSL 权威”、ADR-0005 的封闭 Visual Type 和 ADR-0006 的版本化 Text Preset。
- ADR-0004 的 Speech 驱动 Duration 与逐 Scene 向上量化继续有效；其中固定 Asset 截断/冻帧属于 Legacy 表现，不再是 Runtime 结果。
- Runtime 输入不公开 Project ID、Speech 地址、派生元数据、执行模式、文件系统或实时项目 API。
- 未被 Scene 引用的 Asset 不进入输入；Program Resource 不能绕过 Asset 内容边界。

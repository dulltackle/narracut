# Product

> **Legacy 产品说明。** 本文件描述 Project DSL V3 与独立浏览器工作台，仅保留用于理解现有实现；Project VNext 不兼容、不迁移、也不以只读方式打开该产品形态。当前规范见 [`docs/spec/project-vnext.md`](./docs/spec/project-vnext.md)。

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Narracut 面向希望充分利用 AI 能力、尽可能自动化制作“类口播”视频的内容制作者。医疗或临床设备演示只是其中一类内容场景，产品将扩展到更多题材，而不是被限定为医疗垂直工具。

## Product Purpose

Narracut 让内容制作者从脚本出发组织旁白与画面，减少传统时间线编辑中的手工拆分、对齐和重复制作工作。产品目标是在保留内容可检查、可编辑和可稳定渲染的前提下，让 AI 承担尽可能多的视频制作流程。

成功意味着：创作者可以把脚本可靠地转化为结构化项目，快速补齐对应视觉与旁白，并得到与编辑预览一致的成片。

## Positioning

Narracut 不是在传统时间线上附加 AI 功能，而是把脚本句子对应的 Scene 作为编辑与渲染的基本单位。项目由可校验、可升级、可由 AI 生成的 DSL 描述；Narration、Visual、Speech 和最终时长围绕同一个 Scene 组织，从数据模型上支持自动化生产。

## Operating Context

- 产品当前以本地单用户工具运行：一条命令启动 Node 服务，并在浏览器中打开工作台。
- 一个项目是可整体移动的文件夹，包含 `project.json`、Asset、Speech 和渲染产物；持久引用均相对项目根。
- 创作者在脚本表中逐 Scene 编辑 Narration、选择 Visual Type、绑定 Asset、检查 Speech 和预览结果，而不是直接操作多轨时间线。
- AI 可以生成或辅助生成 Project DSL；结构校验、内部一致性校验与 Render-ready 检查负责阻止无效项目进入最终渲染。

## Capabilities and Constraints

- Scene 是稳定的编辑与渲染单位；重排或修改不改变其身份，复制会创建新的 Scene。
- 当前 Project DSL V3 的 Visual Type 是封闭清单：`Card`、`Image`、`Video`；Image 与 Video 可带 Caption，文字表现由版本化 Preset 控制。
- Narration 对应的 Speech 是 Scene Duration 的唯一主人；缺少 Speech 时只能使用不落盘的 Draft Duration 预览。
- Scene 之间仅使用硬切；视频长于 Duration 时截断，短于 Duration 时冻住最后一帧。
- Preview 与最终 Render 必须逐帧一致，这是技术选择的核心约束。
- Asset、Speech 和项目数据保留在本机；项目不依赖当前机器上的绝对路径。
- Node 服务只代理文件系统和外部能力，不理解 DSL；前端内存持有编辑期的权威副本。
- 当前面向中文工作流，TTS profile ID 为 `narracut-mandarin-news-v1`；未来支持哪些语言、内容类型与 AI 提供商仍是开放决定。

## Brand Commitments

- 产品名为 **Narracut**。
- 面向开发者与创作者的核心术语以 `CONTEXT.md` 为准，包括 Scene、Narration、Visual、Asset、Speech、Duration、Project DSL 和 Render-ready；避免用传统时间线编辑术语模糊这些概念。
- 产品表达应诚实区分已完成能力、草稿能力和未来能力，不虚构自动化程度、客户、效果数据或行业背书。

## Evidence on Hand

- `CONTEXT.md`：领域语言、时间模型、Asset 规范和 Preview = Render 约束。
- `docs/spec/project-v3.md`、`docs/spec/text-presentation-presets-v1.md`、`docs/spec/project.example.json` 与 `docs/spec/project.ai-example.json`：当前 DSL 与文字表现规格、真实文案示例和 AI 结构化草稿验收样本。
- `docs/adr/`：本地项目寻址、浏览器运行形态、前后端边界和 Speech 驱动时长的已确认架构决策。
- `src/client/` 与 `src/server/`：现有本地工作台、项目读写、校验、草稿编辑和媒体探测实现。
- 当前没有已确认的客户证言、公开案例、性能基准、商业数据或行业背书；未来界面不得自行编造。

## Product Principles

1. **脚本优先于时间线。** 自动化、编辑和渲染都围绕脚本句子及其 Scene 展开。
2. **AI 输出必须可理解、可修改、可校验。** AI 提升制作速度，但不能绕过结构与 Render-ready 约束。
3. **预览就是成片。** 编辑器反馈必须对最终渲染具有逐帧可信度。
4. **本地数据由创作者掌控。** 项目应能整体移动、长期保存，并避免隐藏的外部副本或机器绑定路径。
5. **面向多类内容扩展。** 医疗内容是场景之一，产品模型与体验不应把 Narracut 固化为单一行业工具。

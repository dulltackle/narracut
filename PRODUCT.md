# Narracut 产品记录

<!-- impeccable:product-schema 1 -->

## Platform

web

## 用户

面向以脚本组织视频的创作者。用户以 Scene 检查和编辑叙事内容，通过 Agent 创作任务调整成片表现，再审阅候选并明确接受。

## 产品目的

以脚本句子为编辑单位生成视频。用户编辑脚本及对应视觉，在表格工作区管理 Scene，在 Agent 工作区围绕 Video Brief 和现有内容塑造成片。

## 产品机制与使用环境

- 工作台通过 Narracut Codex 插件使用本地 Project VNext 项目；领域术语以 `CONTEXT.md` 为准。
- 表格工作区承载 Narration、Asset、Speech 等 Scene 内容的检查与编辑；Agent 工作区承载创作任务、候选交付和 Preview 审阅。
- Render Program 决定成片表现；Runtime 拥有 Scene 顺序、时间窗、Composition 骨架和权威 Speech 音轨。
- 当前创作指令表达任务目标；Video Brief 是项目级创作意图，不是逐 Scene 内容或任务对话记录。

## 能力与约束

- Agent 不写 Scene 内容，需要修改时提供建议，由用户回到表格工作区操作。
- 每个项目同时最多保留一个候选 Render Program。候选是程序的可写对象，已接受修订不可变。
- 用户明确接受完整候选后才创建新修订并切换当前修订；接受受最新输入和阻断检查约束，不代表已经完成最终 Render。
- 普通停止、应用重启或 Codex 中断保留候选与最小任务检查点；恢复需要用户明确继续。切换工作区不停止任务。
- 接受候选、放弃候选或以新目标明确接管候选才终结旧任务。新目标接管保留候选字节，创建新任务 ID 和当前创作指令，并建立单一写权。
- 任务检查点服务于继续同一任务；候选恢复检查点服务于候选存储完整性恢复，两者不是任务或候选历史。
- Render Program 历史保留最近 20 个已接受修订，包含当前修订；从历史回退先创建候选，再重新验收。

## 产品原则

- 脚本内容和成片表现拥有明确的编辑边界。
- 用户控制候选何时生效、删除或改由新目标继续创作。
- 状态反馈以已核对的持久结果为依据，明确区分运行停止和任务终结。
- Preview、检查和接受证据必须对应明确的程序与输入身份；旧结果不能冒充最新结果。

## 已有依据

- `CONTEXT.md`：领域词汇与编辑边界。
- `plugins/narracut/workbench.html`、`plugins/narracut/workbench.js`：既有工作台。
- `DESIGN.md`：现有视觉体系。

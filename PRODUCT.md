# Narracut 产品记录

<!-- impeccable:product-schema 1 -->

## Platform

web

## 用户

面向以脚本组织视频的创作者。用户以 Scene 检查和编辑叙事内容，通过 Agent 创作任务调整成片表现，再审阅候选并明确接受。

## 产品目的

以脚本句子为编辑单位生成视频。用户编辑脚本及对应视觉，在表格工作区管理 Scene，在 Codex 当前对话中围绕 Video Brief 和现有内容塑造成片，在 Agent 工作区审阅候选。

## 产品机制与使用环境

工作台通过 Narracut Codex 插件在当前对话右侧打开，使用可移动的本地项目。表格工作区管理 Scene 内容，Codex 当前对话承载创作，Agent 工作区负责候选审阅。

Render Program 塑造成片表现，Runtime 保持 Scene 时间与权威 Speech。详细写权、任务生命周期、候选接受和历史规则统一见 [Project VNext 规范第 2、7、8 节](docs/spec/project-vnext.md)。

## 产品原则

- 脚本内容和成片表现拥有明确的编辑边界。
- 用户控制候选何时生效、删除或改由新目标继续创作。
- 状态反馈以已核对的持久结果为依据，明确区分运行停止和任务终结。
- 当前对话始终是创作入口；界面明确表达控制权、只读状态和可执行的失败恢复路径。
- Preview、检查和接受证据必须对应明确的程序与输入身份；旧结果不能冒充最新结果。

## 已有依据

- `CONTEXT.md`：领域词汇与编辑边界。
- `plugins/narracut/workbench.html`、`plugins/narracut/workbench.js`：既有工作台。
- `DESIGN.md`：现有视觉体系。

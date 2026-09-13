# 文档入口

实现或调整产品行为时，先读 [Project VNext 规范](spec/project-vnext.md)；术语见 [CONTEXT.md](../CONTEXT.md)，决策原因见 [现行 ADR](adr/)。

| 需要了解的内容 | 入口 |
| --- | --- |
| 产品与视觉约定 | [PRODUCT.md](../PRODUCT.md)、[DESIGN.md](../DESIGN.md) |
| 已确认、待实现的交互设计参考（非生产验收） | [项目入口与导航](design-references/prototype-navigation-light/README.md)、[候选审阅与输出](design-references/prototype-review-light/README.md) |
| 执行隔离与依赖操作 | [执行胶囊](execution-capsule.md)、[依赖协调](dependency-coordination.md) |
| 候选操作与代表帧交付 | [候选管理](agents/candidate-management.md)、[代表帧](representative-frames.md) |
| 项目恢复与载荷抢救 | [恢复操作](agents/project-recovery.md) |
| Bundle、Preview Bridge 与最终输出实现 | [Bundle](../src/server/program-bundle.ts)、[Runtime Bridge](../src/server/program-runtime-source.ts)、[Preview 来源](../src/server/preview-origin.ts)、[Render 服务](../src/server/project-render.ts)、[Render 界面](../plugins/narracut/workbench-render.js) |
| 本地插件构建、安装与启动验证 | [插件打包](plugin-packaging.md) |
| 当前对话右侧工作台与展示重试 | [工作台面板](workbench-panel.md) |
| 首次 Speech 配置、原句续生成与声音变更确认 | [#116 验收记录](acceptance/issue116/README.md) |
| 分组项目工具栏、Brief 编辑、外部冲突与持久验证 | [#115 验收记录](acceptance/issue115/README.md) |
| 独立视频输出、阻断定位与真实产物 | [#114 验收记录](acceptance/issue114/README.md) |
| 候选决策、回执核对与接受收尾 | [#113 验收记录](acceptance/issue113/README.md) |
| 视频主面、候选审阅抽屉与真实媒体播放 | [#112 验收记录](acceptance/issue112/README.md) |
| 同行 Asset 检查、Speech 原因及生成状态 | [#111 验收记录](acceptance/issue111/README.md) |
| Scene 编排、菜单键盘操作与持久验证 | [#110 验收记录](acceptance/issue110/README.md) |
| 浅色工作台、连续编辑与断连验证 | [#109 验收记录](acceptance/issue109/README.md) |
| 自动化入口与真实宿主验收范围 | [公开流程验证](#公开流程验证)、[当前对话完整流程验收](current-conversation-acceptance.md) |
| 胶囊专项诊断与维护缺口 | [内存诊断](execution-capsule.md#内存诊断)、[维护事项](execution-capsule.md#维护事项) |
| 追溯旧架构、研究依据或原会话证据 | [历史追溯](#历史追溯) |

操作指南保留调用步骤与使用限制，实现细节查代码和测试。验收记录只证明所列基线和执行范围；历史资料用于追溯，不补充当前规范。

## 公开流程验证

先运行 `pnpm build:plugin`，再运行 `pnpm test:e2e:public`。真实执行需要[执行胶囊环境](execution-capsule.md#入口与认证)、固定 Chromium、ffmpeg 和 pnpm 工具链；环境不足时不能以宿主执行替代胶囊。

[可移动项目测试](../tests/e2e/portable-project.spec.ts)通过生产 `creation_step` 协议与确定性 Agent 答案，验证候选、关闭移动后断网重建、明确接受及同 Bundle 最终 Render。夹具与视觉比较分别见[项目夹具](../tests/helpers/portable-project.ts)和[帧比较](../tests/support/visual-comparison.ts)。公开套件范围由[测试配置](../playwright.public.config.ts)维护；真实宿主未完成场景见[当前验收记录](current-conversation-acceptance.md)。

## 历史追溯

旧规格、旧 ADR、调研、QA 与会话交接已从工作树移除，原始内容保留在 Git 提交 `7d62fa9a729bd53ba45146c7065fc58db7cfb13d` 的 `docs/archive/` 下。仅追溯历史时读取；当前行为以现行规范为准。

在仓库根目录查看原归档索引，再按索引路径读取文件：

```sh
git show 7d62fa9a729bd53ba45146c7065fc58db7cfb13d:docs/archive/README.md
git show 7d62fa9a729bd53ba45146c7065fc58db7cfb13d:docs/archive/handoffs/narracut-capsule-handoff-2026-09-07.md
```

旧 schema、示例和校验脚本依赖当时源码；复现实验须使用匹配的历史版本，不能将归档脚本接回当前验收。

本次移除的 Bundle、Preview Bridge、最终 Render 界面和可移动项目说明，以及精简前的操作指南、工作台历史验收，保留在提交 `61e7b87636ce428ec0698301accf4ebeeaec514d` 的原路径。需要原始过程或说明时读取，例如：

```sh
git show 61e7b87636ce428ec0698301accf4ebeeaec514d:docs/workbench-panel.md
git show 61e7b87636ce428ec0698301accf4ebeeaec514d:docs/portable-project-acceptance.md
```

# 文档入口

实现或调整产品行为时，先读 [Project VNext 规范](spec/project-vnext.md)；术语见 [CONTEXT.md](../CONTEXT.md)，决策原因见 [现行 ADR](adr/)。

| 需要了解的内容 | 入口 |
| --- | --- |
| 产品与视觉约定 | [PRODUCT.md](../PRODUCT.md)、[DESIGN.md](../DESIGN.md) |
| 执行隔离、依赖与构建 | [执行胶囊](execution-capsule.md)、[依赖协调](dependency-coordination.md)、[Bundle](program-bundle.md) |
| Preview、交付与输出 | [Preview Bridge](preview-bridge.md)、[代表帧](representative-frames.md)、[最终 Render](final-render-ui.md) |
| 本地插件构建、安装与启动验证 | [插件打包](plugin-packaging.md) |
| 当前对话右侧工作台与展示重试 | [工作台面板](workbench-panel.md) |
| 当前实现验收范围 | [可移动项目验收](portable-project-acceptance.md)、[当前对话完整流程验收](current-conversation-acceptance.md) |
| 胶囊专项诊断与维护缺口 | [内存诊断](execution-capsule.md#内存诊断)、[维护事项](execution-capsule.md#维护事项) |
| 追溯旧架构、研究依据或原会话证据 | [历史追溯](#历史追溯) |

验收记录只证明所列基线和执行范围；模块说明维护当前接口与约束。历史资料用于追溯，不补充当前规范。

## 历史追溯

旧规格、旧 ADR、调研、QA 与会话交接已从工作树移除，原始内容保留在 Git 提交 `7d62fa9a729bd53ba45146c7065fc58db7cfb13d` 的 `docs/archive/` 下。仅追溯历史时读取；当前行为以现行规范为准。

在仓库根目录查看原归档索引，再按索引路径读取文件：

```sh
git show 7d62fa9a729bd53ba45146c7065fc58db7cfb13d:docs/archive/README.md
git show 7d62fa9a729bd53ba45146c7065fc58db7cfb13d:docs/archive/handoffs/narracut-capsule-handoff-2026-09-07.md
```

旧 schema、示例和校验脚本依赖当时源码；复现实验须使用匹配的历史版本，不能将归档脚本接回当前验收。

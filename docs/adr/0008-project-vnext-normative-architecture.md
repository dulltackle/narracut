# 采用 Project VNext 与 Agent 驱动的 Render Program

> **状态：已接受。** 产品行为以 [`project-vnext.md`](../spec/project-vnext.md) 为唯一规范性来源；本 ADR 只记录总领取舍。

Narracut 需要让 Scene 内容保持稳定权威，同时让 Agent 用项目级 Render Program 自由塑造成片，并在项目移动、重启、外部编辑与失败恢复后保持可审核、可复现和失败关闭。封闭 Visual Type、Text Preset、固定 Composition 与独立浏览器工作台无法同时提供这些能力。

## Decision

Project VNext 采用一次破坏性架构切换：

- Codex 插件承载共享表格工作区与 Agent 工作区；
- 严格项目清单、最小 Project DSL 和自由 Video Brief 共同构成内容侧持久边界；
- Render Program、候选、不可变修订和验收记录构成表现侧持久边界；
- Narracut Runtime 独占 Composition、Scene 时间与 Speech，隔离执行不可信项目代码；
- 项目生命周期以身份、写入租约、原子提交和项目外恢复快照失败关闭。

四个稳定边界分别由 [ADR-0009](./0009-separate-scene-content-and-render-program-authority.md)、[ADR-0010](./0010-use-one-candidate-and-immutable-render-program-revisions.md)、[ADR-0011](./0011-run-preview-and-render-from-one-isolated-bundle.md) 与 [ADR-0012](./0012-use-strict-identity-atomic-lifecycle-and-external-recovery.md) 记录。

格式、接口、状态机、门禁、错误语义、资源限制和测试 seam 全部集中在 Project VNext 规范。领域上下文只定义词义，ADR 只解释为什么。

## Considered Options

- **继续演进 Project DSL V3**——被否。把更多表现字段加入 DSL 会继续扩大内容与表现耦合，也无法容纳任意项目级 Remotion 编排。
- **长期并行维护 V3 与 VNext**——被否。双架构会把兼容、迁移和测试矩阵变成持续产品承诺。
- **让 Agent 直接改 Scene 与 Render Program**——被否。它会分裂内容权威，并使用户无法判断一次接受究竟改变了内容还是表现。
- **Project VNext 破坏性替代**——采用。只正向识别当前格式，不打开、不迁移、不只读兼容 Legacy Project。

## Consequences

- [`project-v1.md`](../spec/project-v1.md)、[`project-v2.md`](../spec/project-v2.md)、[`project-v3.md`](../spec/project-v3.md) 与文字 Preset 规格全部降为 Legacy。
- 旧 ADR 覆盖关系固定如下：

  | 旧 ADR | VNext 状态 | 直接替代者 |
  | --- | --- | --- |
  | ADR-0001 | 整体替代 | ADR-0011 |
  | ADR-0002 | 整体替代 | ADR-0008 |
  | ADR-0003 | 整体替代 | ADR-0008 |
  | ADR-0004 | Speech 逐 Scene 向上量化继续有效；固定 Asset 截断/冻帧后果被替代 | ADR-0009 |
  | ADR-0005 | 整体替代 | ADR-0009 |
  | ADR-0006 | 整体替代 | ADR-0009 |
  | ADR-0007 | 整体替代 | ADR-0008 |
- 现有代码仍是 Legacy 实现；文档状态不暗示 VNext 已实现，也不授权任何兼容或迁移路径。
- 后续实现必须以公开工作台/CLI 到持久项目与最终 Render 的边界作为主要验收 seam。

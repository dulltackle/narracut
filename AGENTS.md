## Agent 协作入口

### Issue tracker

Issues 位于 [`dulltackle/narracut`](https://github.com/dulltackle/narracut)。处理工单时读 `docs/agents/issue-tracker.md`。

### Triage labels

五种角色直接使用同名标签：`needs-triage`（待评估）、`needs-info`（待补充信息）、`ready-for-agent`（规格完整，可交给 Agent）、`ready-for-human`（需人工实现）、`wontfix`（不处理）。

### Domain docs

本仓库为单一领域上下文。探索代码前读根目录 `CONTEXT.md` 和 `docs/adr/` 中相关决策；命名遵循术语及其 Avoid 约定，建议与现行 ADR 冲突时明确说明。缺失的领域概念在实际确认后更新，文档缺失时继续工作。

查找现行规范、模块说明或验收记录时，读 `docs/README.md`；追溯旧架构或历史证据时，按其中“历史追溯”读取 Git 历史。领域阅读与标签约定集中维护于本文件，技能初始化时也沿用此处。

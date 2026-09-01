# 以严格身份和原子操作管理项目生命周期与恢复

> **状态：已接受。** 这是 [ADR-0008](./0008-project-vnext-normative-architecture.md) 的项目生命周期/恢复边界 ADR。

## Decision

Project VNext 用严格清单和稳定 Project ID 识别项目。创建、正式复制、恢复和接受都在同级临时位置完成并经全量复核后原子发布；同一物理目录只有一个 Narracut 进程拥有项目写入租约，每次写入重新检查项目身份。

正式复制生成新 Project ID；手工复制保留 ID，只有当前进程同时遇到相同 ID 时提示，不建立全机路径索引。

运行期身份丢失时立即冻结输入、撤销写权并封存恢复截面。只有脏 DSL 或 Video Brief LOCAL 可以导出到项目外严格恢复信封；恢复必须以用户明确指定且逐项匹配基线的来源，在不存在的新路径全有或全无地重建原 Project ID。

## Considered Options

- **打开时自动补建或迁移清单**——被否。普通目录、Legacy Project 或损坏项目会被意外改写。
- **把内存成果直接覆盖回相似目录**——被否。路径相同不证明项目身份和持久基线相同。
- **恢复快照复制完整项目**——被否。它会成为第二份备份权威，并需要复制 Render Program、Asset、Speech 与依赖。
- **扫描全机寻找同 Project ID 的副本**——被否。会建立隐藏路径索引和“首选副本”语义。
- **严格身份 + 增量快照 + 明确来源恢复**——采用。

## Consequences

- 本 ADR 替代 ADR-0002 的启动参数/最近项目打开方式、ADR-0003 的无并发整份写入假设和 ADR-0007 的服务拓扑身份边界。
- create、copy、recover 目标必须不存在；inspect、dry-run 与 recovery extract 保持只读且不取得写入租约。
- 恢复快照不包含 Render Program、Asset、Speech、依赖、Preview、诊断或聊天；成功后也不消费或删除。
- 完整恢复不可行时只能独立导出已验证的 DSL 或 Brief 载荷，导出物不是项目且不能自动覆盖。
- 所有入口共同使用严格 UTF-8、严格 JSON、资源上限、Schema 与一致性验证，并返回稳定错误语义。

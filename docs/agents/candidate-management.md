# 唯一候选操作

直接调用 `manage_project_candidate` 时使用本指南。当前对话创作任务按[插件工作台技能](../../plugins/narracut/skills/narracut-workbench/SKILL.md)驱动；候选与修订的产品约束见[规范第 7 节](../spec/project-vnext.md#7-候选修订与历史)。

每次调用携带 `projectDirectory`、`projectId` 和 `action`：

1. `read`：读取当前候选路径与 `baseline`。每批操作前重新读取，路径不能跨批次缓存；完整性通过不代表类型、构建或 Preview 检查通过。
2. `create`：没有候选时，从当前修订创建唯一候选；已有候选时先核对其内容。
3. `apply`：携带刚读取的 `baseline` 和 `changes: [{path, content}]`。路径相对候选，UTF-8 文本表示写入，`null` 表示删除；允许修改 `program.json`、`src/`、`resources/`。该协议不负责二进制资源写入；依赖文件使用[依赖协调](../dependency-coordination.md)。
4. `discard`：只有用户明确放弃时，携带最新 `baseline` 与 `confirmed: true`，删除候选及恢复检查点。停止任务与关闭工作区保留候选。

遇到外部修改或基线失效时，重新读取并让用户核对，保留外部字节；完整性损坏时先修复并重新检查，或由用户明确放弃。不要通过重试旧批次覆盖变化。

工具字段见[插件协议声明](../../plugins/narracut/src/server.ts)；持久化实现与回归见[候选管理器](../../src/server/project-candidate.ts)和[候选测试](../../tests/project-candidate.test.ts)。

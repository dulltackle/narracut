# 胶囊维护事项

2026-09-10 UTC 对照代码核对，来源为[历史交接](archive/handoffs/narracut-capsule-handoff-2026-09-07.md)。工具链孤儿目录回收已随 `20e8f89` 提交；以下两项仍需后续处理，本次文档整理不修改实现。

- **重复认证的缓存作用域**：[ExecutionCapsule.certify()](../src/server/execution-capsule.ts) 仍在实例上缓存认证 Promise，独立测试进程不能共享。原记录提出按执行环境身份建立跨进程缓存；这仍是待评估方案，尚未决定或实现。
- **孤儿目录回收的自动化覆盖**：[reclaimOrphanSnapshots()](../src/server/capsule-toolchain.ts) 已实现；当前测试未专门覆盖属主已死、属主存活和缺失 owner 标记三类回收判定。原会话仅记录手工验证。

原记录中的临时目录清理命令、测试耗时及并发失败只属于当时环境；若处理相关问题，应重新确认当前状态。

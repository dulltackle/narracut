# 恢复快照操作

恢复快照不是完整备份。必须明确指定仍可读取、逐项基线匹配的来源目录；恢复只发布到不存在的新路径并保留原 Project ID。快照、来源目录和原修订均不被覆盖，恢复不会自动运行 Agent。

## 启动台

“从恢复快照创建”依次检查快照、检查明确来源、显示恢复计划，并在必要时解决 Brief BASE／LOCAL／DISK 冲突。编辑完整 Brief 结果只更新计划。填写目标父目录与新文件夹名后，“恢复到新文件夹”才开始复制和发布。

执行期间按真实阶段展示复制、应用恢复内容、全量校验和发布；可在发布前取消。来源变化会使计划失效，要求重新检查。丢失回执时使用原操作 ID 核对，不能重复创建。成功后打开失败不会撤销已经完成的恢复。

来源问题阻断完整恢复时，可分别把有效的 DSL、Brief LOCAL、Brief BASE 提取成项目外的新普通文件。提取物不是项目；损坏或不兼容快照不能提取。

## CLI

```bash
pnpm start recovery inspect /恢复/未保存.narracut-recovery.json
pnpm start recovery dry-run /恢复/未保存.narracut-recovery.json /明确来源
pnpm start recover /恢复/未保存.narracut-recovery.json /明确来源 /新项目 --plan 'sha256:上一步的计划摘要'
```

存在 Brief 冲突时，准备完整结果文件，并在 `dry-run` 和 `recover` 两步都传入 `--brief-result /完整结果.md`。空文件表示明确采用空 Brief。任何来源或结果变化都需要重新生成计划摘要。

`recover` 默认完成后退出，只有 `--open` 才打开工作区。目标同级 `.目标名.narracut-tmp` 残留只有标记与恢复操作及目标匹配时，才能通过 `--confirm-cleanup` 明确确认清理并从头重试；不匹配残留不会删除。

```bash
pnpm start recovery extract /恢复/未保存.narracut-recovery.json /受阻来源 briefLocal /抢救/完整目标.md
```

提取组件名为 `dsl`、`briefLocal` 或 `briefBase`；不存在的组件、已存在的目标文件及项目内目标均拒绝。

## 服务契约

`project-restore.ts` 提供只读 `inspectRecovery`、`planRecovery`，有限操作 `recoverProject`、`extractRecovery`，以及宿主 `RecoveryOperations`。所有入口复用严格信封与 DSL 校验；DSL 上限 10 MiB，Brief 上限 2 MiB，恢复信封上限 20,622,000 字节，另执行严格 UTF-8／JSON／Base64 和元数据预算。

`restore_project` 是工作台专用工具，支持 `inspect`、`plan`、按需读取 `content`、`recover`、`extract`、`status`、`cancel`。恢复和提取请求必须包含新的 UUID `operationId`；重复提交相同 ID 只返回同一结果，不能更换参数。进程内状态为 `running`、`completed`、`failed`、`uncertain`。结果不明时只允许核对原操作。

操作级稳定代码补充：`RECOVERY_OPERATION_UNKNOWN` 表示当前进程尚未收到该 ID，可重发原请求；`RECOVERY_EXTRACTION_UNAVAILABLE` 表示来源未阻断完整恢复；`RECOVERY_PAYLOAD_MISSING` 表示快照未携带所选组件。其余快照、来源、资源和发布诊断遵循 `docs/spec/project-vnext.md`。操作回执只在当前进程内保留，不创建项目外操作日志。

# 唯一候选管理

本实现对应 #71。入口是已打开项目租约中的 `manage_project_candidate`；Agent、工作台和受控工具共享同一份候选。当前修订不获得写入口。真实 Agent 创作任务联动由 #87 承接，检查、Preview、接受与恢复替换不在此入口内。

## 工具协议

每次调用携带 `projectDirectory`、`projectId` 和 `action`：

- `read`：读取当前来源修订、候选与恢复检查点路径、完整树身份和 `baseline`。完整性检查不执行项目代码，不代表类型、构建或 Preview 检查通过。
- `create`：没有候选时，从当前修订复制完整程序树。并发请求由项目共享保存队列串行化，后续创建返回 `CANDIDATE_ALREADY_EXISTS`。
- `apply`：携带读取所得 `baseline` 和 `changes: [{ path, content }]`。路径相对候选程序树，内容是 UTF-8 文本，`null` 删除文件；允许修改 `program.json`、`src/`、`resources/`。`package.json` 与锁文件只可由后续依赖协调入口修改。
- `discard`：携带当前 `baseline` 和 `confirmed: true`，明确删除候选及恢复检查点；工作台默认聚焦取消。停止宿主验证、关闭项目与工作区切换均不调用此操作。

普通文件批次最多 256 项；完整程序树最多 4,096 项、24 层、32 MiB。资源既有二进制字节完整复制并参与摘要，当前文本修改协议不对二进制资源转码。拒绝路径越界、重复修改、符号链接、硬链接、特殊文件，以及 `node_modules`、`bundle` 和 `.cache`。

## 持久化与提交点

`.narracut/candidate.json` 是唯一候选权威指针，包含来源修订和候选/检查点树引用。引用路径为 `.narracut/candidate-<UUID>/candidate` 与同批次的 `checkpoint`，全部为项目相对路径，可随项目移动。外部工具应每次读取入口返回的候选路径，不能缓存跨批次路径。

批次先写入新的代目录，候选包含完整新树，检查点包含上一份完整候选。文件和目录同步完成后，再次核对项目身份、候选/检查点基线及当前修订。最后通过一次 `rename` 发布指针，使候选和检查点同时生效。提交前失败清理本批临时目录，原指针与原树不变；提交后清理上一代失败不撤销已经发布的批次。

完整树身份对排序后的相对路径、文件/目录类型和文件字节 SHA-256 计算摘要，包括空目录；候选与检查点均独立拥有身份。合法候选树外部字节变化返回 `external-change` / `EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED`，拒绝旧批次，保留外部字节。目录结构损坏、链接或检查点摘要不符返回 `integrity-failed` / `CANDIDATE_INTEGRITY_FAILED`，不自动恢复。用户可以外部修复后重新检查，或明确放弃。

界面把候选持久化、完整性和后续程序检查分开呈现；候选变化只更新候选状态区与检查栏摘要，不重建 Composer。放弃需要独立确认，状态轮询期间不打断该确认。

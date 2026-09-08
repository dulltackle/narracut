# 代表帧证据与候选交付

工作台在候选 Preview READY 后自动准备代表帧；也可以为最新实例重新准备、重试失败项。采集和状态刷新不向用户播放器发命令，不改变所选 Scene、正在查看的版本或 Composer 草稿。只有“在对应 Preview 定位”显式切换准确实例、暂停并发送 SEEK，位置仍等待对应 FRAME 确认。

## 计划与绑定

协议 v1 使用从零开始的整数帧和半开 Scene 时间窗。基础计划包含全片首尾、每个 Scene 的开始、中间（`start + floor((duration - 1) / 2)`）、结束前及边界两侧。相同帧合并采集并保留所有理由，最终按帧号升序排列。Agent 可以提交带来源（`transition` 或 `motion`）和具体理由的补点；重新准备包含补点的新套件时不沿用旧套件检查。基础计划不截断。

整套证据包含随机交付 ID、准确 Preview 实例 ID、Bundle 摘要以及 Project、Program、基线、Brief、项目输入、媒体字节、执行环境身份。图像结果额外绑定帧号与 SHA-256。新实例即使字节相同也不能继承旧交付；身份变化、无法认证或实例释放使旧套件不可逆失效，异步结果提交前再次核对。状态、报告与 PNG 都是会话派生产物，不写入可移动项目；停止服务后可重新生成。

## 独立采集与资源边界

采集复用准确 Preview 的固定 HTML、bootstrap、Bundle 和媒体副本，在 `preview` 执行胶囊内运行独立 Chromium。固定 CDP 驱动只从快照应答请求，网络隔离仍由胶囊保证；它不连接用户工作台。通过原始 Bridge 校验来源、实例、token、identity、requestId 与帧号，等待布局提交、媒体缓冲恢复、字体和图片解码后截图。图像返回宿主时再次核对实例、完整帧列表、PNG 格式和输出尺寸。采集驱动字节参与执行环境指纹。

每批串行最多 12 帧；沿用 preview 胶囊 1 GiB 内存、128 MiB 输入/磁盘、64 MiB 输出和 120 秒墙钟上限。单张 PNG 不超过 8 MiB，整套缓存不超过 64 MiB，输出每边不超过 4096 且总像素不超过 8294400。超限或执行失败明确保留失败原因，不静默截断完整计划或替换成低分辨率证据。已经成功提交的图像保留，身份一致时只重试未成功项。UI 每页显示四个 Scene，边界帧保持成对；图片默认不加载，展开后按页读取，完整文本计划始终可查。

## 系统与 Agent 协议

`project_delivery` 对当前打开项目执行以下操作：

- `status`：读取完整计划、采集与检查进度、报告、检查批次及门禁；从返回的 `delivery.id` 和 `binding.instanceId` 获取准确身份。
- `prepare`：提供 `instanceId`，可附加 `supplements: [{frame, source, reason}]`。不含补点且实例未变时幂等读取既有套件。
- `image`：提供 `deliveryId`、`frame`，返回 MCP PNG 图像块与包含完整绑定、帧号、摘要的结构化元数据。
- `review`：先读取图像，再提供 `deliveryId` 和最多 12 项 `reviews: [{frame, digest, observation}]`。必须逐帧写出实际观察，摘要必须对应已读取图像；下载或获取图像本身不会标成已检查。
- `describe`：提供 `deliveryId` 和 `report: {goal, summary, warnings, suggestions}`。每条 Scene 建议包含 `sceneId`、`observation`、`action`、`content`、`reason`；Scene ID 必须存在于对应 Preview，建议不可执行。目标、摘要与建议不得臆造，警告需完整列出。
- `retry`：提供 `deliveryId`，只补采集未成功项；成功检查与采集不会被重置。

`project_delivery_display` 只对 app 暴露。工作台实际展开报告警告与对应检查批次的警告后，提交交付 ID、报告版本、已完成批次 ID 和完整警告内容摘要；报告换版、检查换批或警告内容变化会撤销旧展示确认。Agent 工具不接受 `displayed` 操作。检查或警告截断时不能确认完整展示。

候选可交付需要最新必要检查通过、准确 Preview 证据新鲜、全部计划帧已采集并单独检查、完整目标/变更报告及全部警告已展示。零 Scene 不生成伪首帧，界面直接显示“运行期代表帧不适用”和对应 Manifest、构建结果与 Bundle 身份。接受候选及最终 Render 保持禁用。代表帧不表示用户完整观看，也不产生自动审美评分；审美判断属于用户。

验证覆盖 `representative-frames.test.ts`、`candidate-delivery.test.ts`、`preview-evidence.test.ts`、`project-delivery.test.ts` 和工作台端到端测试。真实采集测试需要认证胶囊、本机监听与 Chromium。

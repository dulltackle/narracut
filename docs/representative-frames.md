# 代表帧检查与候选交付

直接调用 `project_delivery` 时使用本指南；当前对话创作步骤按[插件工作台技能](../plugins/narracut/skills/narracut-workbench/SKILL.md)执行。覆盖范围与验收门禁见[规范第 11 节](spec/project-vnext.md#11-检查诊断门禁与验收证据)。

## 准备与检查

每次调用携带当前项目的 `projectDirectory` 和 `projectId`，按以下顺序操作：

1. `status`：读取完整计划、进度与门禁，从 `delivery.id` 和 `binding.instanceId` 取得准确身份。
2. `prepare`：为最新 Preview 提供 `instanceId`；需要补充 Transition 或运动关键点时，传 `supplements: [{frame, source, reason}]`，`source` 为 `transition` 或 `motion`，帧号从零开始，理由必须具体。工作台会在候选 Preview READY 后自动准备；不含补点且实例未变时可复用既有套件。
3. `image`：提供 `deliveryId`、`frame`，读取 MCP PNG 图像及绑定身份、帧号、摘要。
4. `review`：实际查看图像后，提供 `deliveryId` 和最多 12 项 `reviews: [{frame, digest, observation}]`。逐帧写出实际观察，摘要对应刚查看的图像；仅获取图像不算检查完成。
5. `describe`：提供 `deliveryId` 和 `report: {goal, summary, warnings, suggestions}`。目标、摘要与警告依据实际结果；每条 Scene 建议包含 `sceneId`、`observation`、`action`、`content`、`reason`，Scene ID 必须存在于对应 Preview。建议由用户在表格中手动应用。
6. 再次读取 `status`，核对全部计划帧已检查、完整报告与警告已展示、必要检查和交付门禁通过。交付后由用户整体接受或放弃。

## 重试与证据失效

采集失败时，`retry` 携带 `deliveryId`，只补采未成功项。新 Preview 实例、输入变化或补点形成的新套件需要重新核对并检查，不能沿用旧套件的观察；服务停止后证据需重新生成。超限时按诊断处理，不能截断计划或降低图像分辨率冒充完整证据。零 Scene 没有代表帧，不伪造首帧。

采集和状态刷新不操作用户播放器；需要定位时使用工作台“在对应 Preview 定位”，等待对应 FRAME 回执。

警告展示确认由工作台专用的 `project_delivery_display` 完成。Agent 不代填展示确认；报告、检查批次或警告变化后需重新展示。代表帧检查不证明用户完整观看，也不授权自动接受或 Render。

算法见[代表帧计划](../src/shared/representative-frames.ts)，采集与交付见[证据采集](../src/server/preview-evidence.ts)和[交付服务](../src/server/project-delivery.ts)；协议字段见[插件声明](../plugins/narracut/src/server.ts)，回归入口见[交付测试](../tests/project-delivery.test.ts)。

# Project VNext 补充验收收口记录

验收日期：2026-09-10 UTC（本地 2026-09-09）。产品代码基线：`84d58ea8afc0b2576eadcf9332f59ec713409b69`。

本次核对 #60 的 31 个子任务；124 条主验收标准已完成。对 #82、#84、#85、#86、#89 遗留的 44 条补充验收，逐条建立下方证据映射。新增测试仅补强并发继续与真实 Preview 连续性，没有修改产品实现。

## 本次执行结果

| 验证 | 结果 |
| --- | --- |
| `pnpm test:codex-host:real` | 1/1 通过，真实 Codex App Server 创建专用只读线程并回传身份校验后的结构化结果 |
| `pnpm test:capsule:oom` | 1/1 通过，真实内核 `oom-kill`，并非仅检查 supervisor 退出码 |
| `pnpm exec vitest run tests/creation-task.test.ts tests/project-recovery.test.ts tests/project-recovery-faults.test.ts tests/plugin-recovery.test.ts tests/codex-host-validation.test.ts tests/codex-app-server-host.test.ts` | 87/87 通过（补强用例加入前） |
| `pnpm exec vitest run tests/creation-task.test.ts -t '并发重复继续'` | 新增 1/1 通过；59 项被名称过滤，未计入本次通过数 |
| `pnpm exec playwright test tests/e2e/plugin-workbench.spec.ts tests/e2e/project-recovery.spec.ts` | 63/63 通过 |
| `pnpm exec playwright test tests/e2e/program-preview.spec.ts` | 原有 5/5 通过 |
| `pnpm exec playwright test tests/e2e/program-preview.spec.ts --grep '任务状态变化'` | 新增桌面、窄屏 2/2 通过 |
| `pnpm typecheck` | 通过 |

以上覆盖 160 项不同测试；额外恢复页截图复跑不重复计数。工作台截图与恢复页截图按 1440 / 390px 检查。Preview 连续性使用真实 Bundle、只读 Bridge 与已提交帧反馈；任务生命周期的故障穷举使用可控宿主协议替身，真实宿主成功路径另由独立测试证明。

第一次在 Codex 文件系统／进程沙箱内运行时，真实宿主与 OOM 测试失败；获得所需执行权限后分别在 14.29s、6.81s 内通过。没有关闭 Narracut 的执行胶囊或改为宿主直接执行项目代码。新增 Preview 测试首次误将 `project_acceptance` / `project_render` 的只读查询计作写入；已将断言限定为 `accept` / `start`，两种宽度复跑均通过。

这是本次补充验收的范围，不宣称重新执行了全部 31 票的历史验收。完整可移动项目闭环沿用 #91 的提交 `2adde67` 与 [可移动项目验收说明](portable-project-acceptance.md)，依赖执行链路沿用 #73 的提交 `84d58ea`；本次没有改动这些产品路径。

## 逐项证据

编号保持各 Issue 原补充清单顺序。每条均已核对相关测试断言；多个链接共同覆盖一条中的服务、持久化、UI 与 Preview 要求。

### #82：从 Composer 发起最小 Agent 创作任务

1. **通过**：一次提交只创建一项任务；提交期间重复操作不会重复创建任务。

   证据：[MCP 原文创建单任务](../tests/creation-task.test.ts#L43)；[Composer 创建任务保留精确原文](../tests/e2e/plugin-workbench.spec.ts#L1277)。

2. **通过**：提交失败不丢失原文；成功后保留精确原文，且不清空等待回执期间的新输入。

   证据：[Composer 创建任务保留精确原文](../tests/e2e/plugin-workbench.spec.ts#L1277)；[Composer 失败保留原文可重试](../tests/e2e/plugin-workbench.spec.ts#L1302)。

3. **通过**：从表格工作区提交成功后自动切到 Agent 工作区并聚焦任务标题，所选 Scene 和正在查看的 Preview 保持不变。

   证据：[Composer 创建任务保留精确原文](../tests/e2e/plugin-workbench.spec.ts#L1277)；[Composer 创建回执与任务刷新](../tests/e2e/program-preview.spec.ts#L195)。

4. **通过**：只有当前驱动能原子提交候选；迟到或失去写权的结果不能成为当前成果。

   证据：[MCP 原文创建单任务](../tests/creation-task.test.ts#L43)；[MCP 拒绝旧输入结果](../tests/creation-task.test.ts#L76)；[另一工作台打开项目自动接管](../tests/creation-task.test.ts#L727)。

5. **通过**：交付证据绑定一致的完整状态身份；旧证据不得冒充最新结果。

   证据：[MCP 完整创作交付逐帧](../tests/creation-task.test.ts#L124)；[在 ${stage} 阶段变化使旧证据失效](../tests/creation-task.test.ts#L228)。

6. **通过**：候选就绪进入等待用户，全过程不自动接受，不自动替换或播放当前 Preview，不触发最终 Render。

   证据：[MCP 完整创作交付逐帧](../tests/creation-task.test.ts#L124)；[Composer 创建回执与任务刷新](../tests/e2e/program-preview.spec.ts#L195)。

7. **通过**：项目仅保存最小任务检查点及已独立持久化成果引用，不保存对话、推理、日志、模型、token、活动时长或任务历史。

   证据：[MCP 原文创建单任务](../tests/creation-task.test.ts#L43)。

8. **通过**：工作区切换及任务刷新不打断 Composer 中文输入、选区或 Preview；窄屏与键盘操作保持可用。

   证据：[Composer 失败保留原文可重试](../tests/e2e/plugin-workbench.spec.ts#L1302)；[双工作区共享多行草稿](../tests/e2e/plugin-workbench.spec.ts#L1351)；[工作区标签支持手动键盘激活](../tests/e2e/plugin-workbench.spec.ts#L1401)；[任务状态变化及 Scene 建议重排删除](../tests/e2e/program-preview.spec.ts#L224)。


### #84：让 Agent 以 Scene 建议和 Brief 提案等待用户

1. **通过**：Scene 建议按稳定 Scene ID 定位；重排、删除不会错误定位到其他 Scene，定位不改变 Preview 播放位置。

   证据：[Scene 待办按稳定 ID 定位](../tests/e2e/plugin-workbench.spec.ts#L1556)；[Scene 无关保存、失败保存、重排删除](../tests/creation-task.test.ts#L359)；[任务状态变化及 Scene 建议重排删除](../tests/e2e/program-preview.spec.ts#L224)。

2. **通过**：必要条件满足后，同一任务仅续跑一次；无关修改、部分完成或保存失败不误触发继续，剩余事项明确可见。

   证据：[必要 Scene 条件按保存事件核对](../tests/creation-task.test.ts#L204)；[Scene 无关保存、失败保存、重排删除](../tests/creation-task.test.ts#L359)；[任务待办与 Brief 审核在](../tests/e2e/plugin-workbench.spec.ts#L1583)。

3. **通过**：等待期间没有后台 Agent 动作；已停止任务不会因为 Scene 修改而自动恢复。

   证据：[Scene 无关保存、失败保存、重排删除](../tests/creation-task.test.ts#L359)；[跨工作台接管保持 %s](../tests/creation-task.test.ts#L775)。

4. **通过**：Brief 提案同时提供统一 diff 与完整结果；接受前核对基线，过期提案不能覆盖最新 Brief。

   证据：[Brief 提案拒绝不续跑](../tests/creation-task.test.ts#L296)；[Scene 待办按稳定 ID 定位](../tests/e2e/plugin-workbench.spec.ts#L1556)。

5. **通过**：拒绝 Brief 提案保留原 Brief；仅在明确选择“按当前创作指令继续”后续跑。

   证据：[Brief 提案拒绝不续跑](../tests/creation-task.test.ts#L296)。

6. **通过**：仅明确授权的创作指令允许 Brief 直写，并形成独立、可撤销的完整历史项。

   证据：[Brief 提案拒绝不续跑](../tests/creation-task.test.ts#L296)；[同一任务只追加确认的混合消息原文](../tests/creation-task.test.ts#L321)；[任务待办与 Brief 审核在](../tests/e2e/plugin-workbench.spec.ts#L1583)。

7. **通过**：混合消息只追加用户确认的精确原文片段；问题、状态询问、审批答复和闲聊不追加。

   证据：[同一任务只追加确认的混合消息原文](../tests/creation-task.test.ts#L321)；[Composer 同任务混合消息确认精确片段](../tests/e2e/plugin-workbench.spec.ts#L1617)。

8. **通过**：当前创作指令与 Brief 的实质分歧明确展示，不静默改写 Brief。

   证据：[Composer 同任务混合消息确认精确片段](../tests/e2e/plugin-workbench.spec.ts#L1617)。

9. **通过**：工作区切换、任务刷新和自动续跑保留 Composer 中文输入、选区、草稿与 Preview 连续性；窄屏和键盘操作可用。

   证据：[任务待办与 Brief 审核在](../tests/e2e/plugin-workbench.spec.ts#L1583)；[工作区标签支持手动键盘激活](../tests/e2e/plugin-workbench.spec.ts#L1401)；[任务状态变化及 Scene 建议重排删除](../tests/e2e/program-preview.spec.ts#L224)。

10. **通过**：所有流程均不自动接受候选，也不新增聊天历史或任务历史。

   证据：[MCP 原文创建单任务](../tests/creation-task.test.ts#L43)；[MCP 完整创作交付逐帧](../tests/creation-task.test.ts#L124)；[任务状态变化及 Scene 建议重排删除](../tests/e2e/program-preview.spec.ts#L224)。


### #85：停止并从最小检查点继续 Agent 创作任务

1. **通过**：两个工作区均可停止；运行中与等待用户均能明确停止，重复点击不产生重复操作。

   证据：[停止与恢复在两个工作区可操作](../tests/e2e/plugin-workbench.spec.ts#L1647)；[停止先撤销写权](../tests/creation-task.test.ts#L471)。

2. **通过**：原子提交前后停止均正确核对持久成果；确认停止前撤销旧驱动写权，迟到结果不能修改候选。

   证据：[停止先撤销写权](../tests/creation-task.test.ts#L471)；[原子候选提交 %s 停止](../tests/creation-task.test.ts#L567)。

3. **通过**：停止回执不明时明确显示待核对，不提前宣告已停止。

   证据：[停止回执失败保持待核对](../tests/creation-task.test.ts#L497)；[停止与恢复在两个工作区可操作](../tests/e2e/plugin-workbench.spec.ts#L1647)。

4. **通过**：应用重启、重新连接、工作区切换或普通消息不自动恢复创作。

   证据：[MCP 原文创建单任务](../tests/creation-task.test.ts#L43)；[停止不绕过 Brief 审核](../tests/creation-task.test.ts#L547)；[分类期间停止后 %s](../tests/creation-task.test.ts#L594)。

5. **通过**：明确继续优先恢复原线程；替代线程仍属于同一 Task ID，用户无需选择线程。

   证据：[停止先撤销写权](../tests/creation-task.test.ts#L471)；[停止回执失败保持待核对](../tests/creation-task.test.ts#L497)；[并发重复继续只恢复一个驱动](../tests/creation-task.test.ts#L680)。

6. **通过**：仅承认已完成的原子安全边界；未提交修改、工具调用和中间判断丢弃，缺失或过期证据按需重跑。

   证据：[原子候选提交 %s 停止](../tests/creation-task.test.ts#L567)；[停止先撤销写权](../tests/creation-task.test.ts#L471)；[在 ${stage} 阶段变化使旧证据失效](../tests/creation-task.test.ts#L228)。

7. **通过**：通用继续不绕过待审批、用户判断或外部候选确认。

   证据：[停止不绕过 Brief 审核](../tests/creation-task.test.ts#L547)；[外部候选等待停止后也必须校验](../tests/creation-task.test.ts#L608)；[工具审批暂停 Agent](../tests/creation-task.test.ts#L750)；[必需 Scene 条件未满足](../tests/creation-task.test.ts#L823)。

8. **通过**：检查点缺失、损坏或与候选不一致时，原任务不可恢复，候选及其他项目内容保持安全；不能把任务检查点失效表述为候选损坏。

   证据：[检查点 %s 不损坏候选](../tests/creation-task.test.ts#L513)；[检查点失效内联接管](../tests/e2e/plugin-workbench.spec.ts#L1687)。

9. **通过**：内联接管明确展示新目标与候选，提交后建立新任务并保留候选字节；失败保留输入，候选变化要求再次明确提交。

   证据：[检查点 %s 不损坏候选](../tests/creation-task.test.ts#L513)；[失效任务明确接管外部候选](../tests/creation-task.test.ts#L643)；[检查点失效内联接管](../tests/e2e/plugin-workbench.spec.ts#L1687)。

10. **通过**：桌面、窄屏与键盘操作可用；任务刷新不打断 Composer 输入、Scene 选择、焦点或正在查看的 Preview。

   证据：[停止与恢复在两个工作区可操作](../tests/e2e/plugin-workbench.spec.ts#L1647)；[检查点失效内联接管](../tests/e2e/plugin-workbench.spec.ts#L1687)；[任务状态变化及 Scene 建议重排删除](../tests/e2e/program-preview.spec.ts#L224)。


### #86：改绑 Codex 创作线程并处理外部停止原因

1. **通过**：重复继续不会创建多个驱动。

   证据：[并发重复继续只恢复一个驱动](../tests/creation-task.test.ts#L680)；[自动跟进保留 Composer 与 Scene](../tests/e2e/plugin-workbench.spec.ts#L1520)。

2. **通过**：跨线程竞争和迟到回调不能提交；旧端任务操作禁用，并持续显示转移提示。

   证据：[另一工作台打开项目自动接管](../tests/creation-task.test.ts#L727)；[交接中断回执不明](../tests/creation-task.test.ts#L789)；[外部停止指引与线程转移](../tests/e2e/plugin-workbench.spec.ts#L1724)。

3. **通过**：替代线程保持同一 Task ID，从检查点、候选和最新项目内容重新开始。

   证据：[停止回执失败保持待核对](../tests/creation-task.test.ts#L497)；[并发重复继续只恢复一个驱动](../tests/creation-task.test.ts#L680)。

4. **通过**：恢复失败保留成果并显示实际原因；回执不明时不提前宣告接管成功。

   证据：[恢复遇到额度错误保留原线程](../tests/creation-task.test.ts#L699)；[交接中断回执不明](../tests/creation-task.test.ts#L789)。

5. **通过**：外部停止原因与恢复指引直接可见，表格提示条同步原因；不做后台重试或增加项目级预算。

   证据：[宿主以 %s 停止时](../tests/creation-task.test.ts#L713)；[连续三轮没有持久成果](../tests/creation-task.test.ts#L807)；[外部停止指引与线程转移](../tests/e2e/plugin-workbench.spec.ts#L1724)。

6. **通过**：等待期间没有后台 Agent 动作；批准或满足 Scene 条件按既定状态机继续，不能绕过明确判断或主动停止。

   证据：[工具审批暂停 Agent](../tests/creation-task.test.ts#L750)；[跨工作台接管保持 %s](../tests/creation-task.test.ts#L775)；[必需 Scene 条件未满足](../tests/creation-task.test.ts#L823)。

7. **通过**：桌面、窄屏与键盘操作可用；状态刷新保留 Composer 草稿、中文输入、Scene 选择、焦点和正在查看的 Preview。

   证据：[外部停止指引与线程转移](../tests/e2e/plugin-workbench.spec.ts#L1724)；[工作区标签支持手动键盘激活](../tests/e2e/plugin-workbench.spec.ts#L1401)；[任务状态变化及 Scene 建议重排删除](../tests/e2e/program-preview.spec.ts#L224)。


### #89：身份失效时封存并导出恢复快照

1. **通过**：DSL 单独未保存、Brief 单独未保存、两者同时未保存及 Brief 三方冲突时，清单与实际导出载荷一致；只有冲突所需时携带 BASE。

   证据：[恢复页冻结背景](../tests/e2e/project-recovery.spec.ts#L13)；[恢复清单与载荷一致](../tests/e2e/project-recovery.spec.ts#L57)；[已确认保存不导出](../tests/project-recovery.test.ts#L54)；[连续本地保存](../tests/project-recovery.test.ts#L84)。

2. **通过**：对账覆盖在途 DSL、Brief 与候选提交；正确区分确认成功、未提交及结果暂不可读，不丢失尚未安全落盘的用户成果，不携带未提交 Agent 修改。

   证据：[在途 ${component} 提交后](../tests/project-recovery-faults.test.ts#L23)；[原子提交结果暂不可读](../tests/project-recovery-faults.test.ts#L49)；[接受后候选清理的原子提交](../tests/project-recovery-faults.test.ts#L102)。

3. **通过**：无脏 DSL 或 Brief LOCAL 时不给出可创建快照的操作，并提供返回启动器入口。

   证据：[恢复清单与载荷一致](../tests/e2e/project-recovery.spec.ts#L57)；[已确认保存不导出](../tests/project-recovery.test.ts#L54)。

4. **通过**：冻结后输入与写操作均不可继续；迟到的提交回执、任务结果和状态通知不能改写已封存截面或解除阻断。

   证据：[恢复页冻结背景](../tests/e2e/project-recovery.spec.ts#L13)；[在途 ${component} 提交后](../tests/project-recovery-faults.test.ts#L23)；[插件统一阻断新工具调用](../tests/plugin-recovery.test.ts#L8)。

5. **通过**：覆盖无目录选择能力、用户取消选择、目标在项目内、符号链接解析后在项目内、目标已存在、路径不可访问及导出写入或校验失败；说明原因并保留可抢救内容。

   证据：[恢复页冻结背景](../tests/e2e/project-recovery.spec.ts#L13)；[恢复清单与载荷一致](../tests/e2e/project-recovery.spec.ts#L57)；[清单短暂消失](../tests/project-recovery.test.ts#L16)；[不可访问或不存在的目录](../tests/project-recovery.test.ts#L92)；[导出进入提交阶段后回执不明](../tests/project-recovery-faults.test.ts#L63)。

6. **通过**：导出结果不明时可核对且不重复提交；确认成功后展示准确路径，不能把请求已发送表现为导出成功。

   证据：[恢复页冻结背景](../tests/e2e/project-recovery.spec.ts#L13)；[导出进入提交阶段后回执不明](../tests/project-recovery-faults.test.ts#L63)；[原子发布实际成功但回执丢失](../tests/project-recovery-faults.test.ts#L79)。

7. **通过**：重复导出保持同一恢复截面的基线与载荷，生成新的快照身份；既有快照保持原样。

   证据：[清单短暂消失](../tests/project-recovery.test.ts#L16)。

8. **通过**：未导出离开时确认内存改动丢失的后果；取消离开后仍可导出；成功导出或无可导出改动时直接返回启动器。

   证据：[恢复页冻结背景](../tests/e2e/project-recovery.spec.ts#L13)；[恢复清单与载荷一致](../tests/e2e/project-recovery.spec.ts#L57)。

9. **通过**：桌面与窄屏下内容清单、长路径、错误与操作均可达；键盘不能进入被冻结的背景，Esc 和遮罩不能关闭阻断，状态播报不抢焦点。

   证据：[恢复页冻结背景](../tests/e2e/project-recovery.spec.ts#L13)。


## GitHub 持久记录

- [#60 验收记录](https://github.com/dulltackle/narracut/issues/60#issuecomment-5612691030)
- [#82 验收记录](https://github.com/dulltackle/narracut/issues/82#issuecomment-5612683893)
- [#84 验收记录](https://github.com/dulltackle/narracut/issues/84#issuecomment-5612685207)
- [#85 验收记录](https://github.com/dulltackle/narracut/issues/85#issuecomment-5612686332)
- [#86 验收记录](https://github.com/dulltackle/narracut/issues/86#issuecomment-5612687446)
- [#89 验收记录](https://github.com/dulltackle/narracut/issues/89#issuecomment-5612688797)
- [#64 验收记录](https://github.com/dulltackle/narracut/issues/64#issuecomment-5612689635)
- [#74 验收记录](https://github.com/dulltackle/narracut/issues/74#issuecomment-5612689926)
- [#91 验收记录](https://github.com/dulltackle/narracut/issues/91#issuecomment-5612690451)

回读确认：31 个子任务全部以 completed 关闭，168 条验收条目已勾选，0 条未勾选。新增测试及本文已随提交 `3940981` 保存；父票评论另存新增测试补丁。

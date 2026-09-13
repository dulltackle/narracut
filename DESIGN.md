---
name: Narracut
description: 浅色连续 Scene 编辑台，以脚本内容和可核对状态组织工作。
colors:
  paper: "#fff"
  ink: "#171717"
  content-ink: "#262626"
  muted: "#626262"
  line: "#e3e3e3"
  panel: "#fafafa"
  control: "#f5f5f5"
  primary: "#242424"
  tab-selected: "#f3f3f3"
  tab-indicator: "#262626"
  focus-blue: "#315e9a"
  selection: "#dce7f4"
  green: "#28743a"
  amber: "#895211"
  editor-line: "#9a9a9a"
typography:
  ui-base:
    fontFamily: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif'
    fontSize: "16px"
    fontWeight: 400
  body:
    fontFamily: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  brand:
    fontFamily: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif'
    fontSize: "17px"
    fontWeight: 800
    letterSpacing: "0"
  label:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  scene-number:
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  detail:
    fontFamily: "ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
rounded:
  flat: "0"
  control: "6px"
  editor: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  cell: "12px"
  stage: "16px"
  tab: "20px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
  narration-editor:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.editor}"
    padding: "6px"
    width: "100%"
  workspace-tab-selected:
    backgroundColor: "{colors.tab-selected}"
    textColor: "{colors.ink}"
    padding: "0 20px"
  scene-row-selected:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    rounded: "{rounded.flat}"
  shared-feedback:
    textColor: "{colors.muted}"
    padding: "6px 16px"
  speech-reason-popover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "16px"
    width: "min(330px,calc(100vw - 16px))"
  review-drawer:
    backgroundColor: "{colors.paper}"
    width: "min(560px,100%)"
  acceptance-confirm:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.content-ink}"
    padding: "20px"
  acceptance-feedback:
    textColor: "{colors.content-ink}"
---

# Design System: Narracut

## Overview

**Creative North Star: "浅色连续 Scene 编辑台"** 白色工作面、近黑正文、灰色辅助信息、轻边框与深色主按钮共同服务密集的脚本编辑。Narration 是主阅读列，Asset 与 Speech 与其保持同行，状态与操作贴近对应内容。

本记录刷新已过时的“暗房接触印样台”体系。#109 已移除表格的暗色框体、纸张与胶片纹理、背光和装饰边码。Agent 工作区、启动器及宿主连接反馈的基础色已迁移到浅色；其具体布局仍沿现有模块。#112 已将候选审阅改为视频主面与按需右侧抽屉；第 3 批单行分组导航及项目入口重排仍以后续工单为准。

依据为 `plugins/narracut/workbench.html` 最终 CSS 层叠、`plugins/narracut/workbench.js` 与 `plugins/narracut/src/workbench-panel.ts`。方向参考 `docs/design-references/prototype-navigation-light/README.md` 及其 `evidence/final-workbench-902.png`，但原型不是生产行为依据。基础编辑页面证据见 [#109 验收记录](docs/acceptance/issue109/README.md)，包括 [902px 桌面](docs/acceptance/issue109/issue109-902.png)、[430px 窄屏](docs/acceptance/issue109/issue109-430.png)及[横滚到 Speech](docs/acceptance/issue109/issue109-430-speech.png)。页面自动化与这些截图不等于真实 Codex 宿主、系统窗口及端到端后端验收。

本次刷新使用当前工作台资源与只读协议夹具，在 Chromium 的 902px 与 430px 视口提取计算样式并查看页面截图；同时对照 #112 的窄屏审阅抽屉和 [#113 接受收尾截图](docs/acceptance/issue113/accepted-cleanup-902.png)。#113 截图使用零 Scene 协议夹具，不是实际成片。此轮核对覆盖样式与文档一致性，不新增真实宿主或媒体执行验收。组件示例与叙述同步保存在 `.impeccable/design.json`；其中色阶是供面板展示的派生 OKLCH 色阶，不是生产调色板。

**Key Characteristics:**

- 连续表格优先，避免每个 Scene 独立成卡。
- 内容按长度展开，选择、编辑与保存反馈可核对。
- 表格全宽使用可用空间；项目检查按需打开抽屉。
- 创作入口仍是 Codex 当前对话；Agent 工作区用于任务状态与候选审阅。

## Colors

### Primary

主色是深灰 `primary`，用于新增 Scene 等主要操作；基础文字使用 `ink`，Narration 阅读态及接受区域使用 `content-ink`，辅助文字使用 `muted`。

### Neutral

`paper` 覆盖主工作面，`panel` 用于表头和底部指引等轻微分层，`line` 用于结构分隔。选中 Scene 用 `control`，当前工作区用 `tab-selected` 与底部 `tab-indicator` 同时标记。

### 功能色

`focus-blue` 保留键盘焦点功能，文本选择使用 `selection`；绿色和琥珀用于成功、连接或需处理的语义，不再承担暗房装饰。颜色不能独自表达状态，继续配合文字、图标或形状。旧模块中的历史变量名和局部色值不自动成为新品牌规范；新增表面使用上述已确认基础。

## Typography

页面基础字体使用中文 UI sans 字体栈，默认 16px、400 字重；`typography.body` 专指 Narration 阅读及编辑角色，为 14px、400 字重、1.65 行高，不是 body 元素的默认字号。表头 12px、500 字重，Scene 序号 13px。状态摘要 12px；Speech 时长等细节为 11px 的 `ui-monospace, monospace`，500 字重、1.35 行高。工作区标签为 14px、650 字重。正文保持自然中文阅读，不用展示字或等宽体排 Narration。

顶部品牌已改为同一 UI 字体栈的 17px 标识。项目机器身份仍可使用现有等宽标签；Agent 与启动器中保留的标题尺度只描述现有模块，不作为新页面的统一展示字要求。

## Layout

工作台占据宿主提供的 `100dvh` 内容区。当前顶部仍由项目身份栏、可选控制权区域、共享反馈和工作区标签逐层排列，底部保留当前对话指引。普通项目身份栏高 56px，标签层 44px；窄屏身份栏高 92px。不要把已确认原型中的单行导航写成当前实现。

表格使用单列全宽工作区，桌面内边距 `12px 16px`。Scene 表头与内容共享 `64px minmax(220px,1fr) 150px 190px` 列定义；短内容行最小高度 52px，长 Narration 和编辑框随内容增高，不以两行截断或强制单行挤压。

在 `max-width:700px` 时，工作面内边距为 8px，列定义为 `48px minmax(220px,1fr) 140px 190px`，最小表格宽度 598px。保留 Scene、Narration、Asset、Speech 四列，通过内容区横向滚动访问右侧列；表头由滚动事件同步位移。430px 截图右侧 Speech 未在初始视口出现，表示可横滚，不表示列被隐藏。窄屏工具栏与 Speech 操作最小触控高度为 44px。

项目检查在所有尺寸均按需打开右侧抽屉，宽 `min(90vw,380px)`，不常驻占用表格宽度。Agent 审阅抽屉覆盖工作区右侧，宽 `min(560px,100%)`，正文独立滚动；窄屏占满工作区宽度，顶部关闭入口保持可见。视频容器最终高度为 `clamp(180px,calc(100dvh - 430px),480px)`；桌面内边距 16px，窄屏为 `12px 8px`。这里描述宿主视频容器，实际画面保留自身比例。启动器仍使用既有模块。

修订历史是独立的原生模态 dialog，从视口右侧展开，宽 `min(600px,100vw)`、高 `100dvh`，内边距 24px；在 680px 及以下改为全宽、20px 内边距。它不同于覆盖工作区的审阅抽屉。工作台还保留 900px 顶栏压缩、980px Scene 工具栏菜单以及启动器 760px 的局部断点；这些不是一套统一的全局响应式尺度。

## Elevation & Depth

主工作面以白底、浅灰分层与细分隔线建立层级，表格框、选中 Scene 和主要审阅面板无投影。工具栏 Scene 菜单使用 `0 8px 24px #00000014`；右键／Shift+F10 上下文菜单与 Speech 原因浮层使用 `0 8px 24px #00000024`。项目检查和候选审阅抽屉均使用 `-12px 8px 36px #00000014`，表达覆盖工作面的叠加关系。

键盘焦点一般使用 `focus-blue` 的 2px 描边、2px 外偏移，不依赖发光。接受区域与修订历史的局部高优先级规则仍使用 `#9dbcf0` 的 2px 描边、3px 外偏移；宿主连接反馈按钮也沿用此浅蓝描边。这是现存局部样式，不是替换全局焦点色的新约定。修订历史通过 `rgba(3,5,5,.7)` 背景遮罩表达模态关系，不沿用审阅抽屉的投影。Scene 表格已关闭旧灯箱动画及纹理；不要恢复材料首现效果。启动器忙碌圆点仍有 1 秒 `ease-in-out` 往返亮度脉冲；这是局部等待反馈，当前没有统一的过渡时长或缓动体系。

## Shapes

连续表格采用平直边界与逐行细线，去除列间强分割、选中三角与印章。常规 Scene 操作按钮使用 6px 圆角，密集行内操作紧邻状态。Narration 文本框保留 2px 圆角。Speech 原因浮层与 Scene 上下文菜单采用 6px 圆角，分别使用 16px 与 8px 内边距。控件圆角不意味着每条 Scene 或每段审阅内容都需要卡片容器。

## Components

### 按钮与工作区导航

新增 Scene 等主按钮为深底白字，悬停时保持深底白字；次按钮白底近黑字与轻描边。桌面 Scene 工具按钮最小高度 32px、内边距 `4px 10px`；窄屏提升到 44px，其中主要操作内边距为 `0 9px`，撤销／重做为 `4px 8px`。Scene 操作按钮继承 `.76rem`、700 字重，禁用透明度为 `.46`；其他通用按钮禁用透明度为 `.5`。工作区标签当前仍独立成行，选中态同时有浅灰背景、深字与底部线；焦点保持可见。

Scene 上下文菜单宽 `min(248px,calc(100vw - 16px))`，最高为视口高度减 16px，超长菜单内部滚动。菜单项桌面最小高度 36px、窄屏 44px，悬停以浅灰底突出；选择态与键盘焦点独立表达。

### Narration 原位编辑

Narration 点击或编辑入口进入原位文本框；文本框以 `scrollHeight` 自动调高，保留换行并允许长词换行。桌面编辑入口在行悬停或键盘焦点时显示，窄屏持续显示。离开文本框触发保存；输入法组合期间推迟保存与渲染，在组合结束后处理最终输入，避免覆盖中文候选。旧的放大编辑入口与帮助条在此布局隐藏。

### Scene、Asset 与 Speech

每个 Scene 的稳定身份、Narration、Asset 摘要与 Speech 同行。Asset 入口无论单个或多个文件都先打开右侧临时管理面板；管理目标独立于所选 Scene。只读预览 Asset 本体，打开、预览与关闭保持原 Scene 选择和 Player 观看位置，关闭回到同行入口。长文件名在表格省略、在面板完整换行；未绑定与文件缺失分别说明，缺失文件仍可解除引用。Speech 状态与时长组成同行摘要，生成／重新生成等操作相邻。生成 Speech 使用麦克风图标，重新生成使用循环箭头；按钮的可访问名称与提示包含动作和 Scene 序号，生成中提供文字“取消”按钮。失败、失效与限制原因通过摘要另一侧的问题图标打开浮层，不新增原因行；支持点击、Enter／空格打开，点击外部或 Escape 关闭并返回问题图标。普通失败直接重试，无需确认。生成阶段刷新保留浮层焦点；成功后原因消失时自动收起，浮层内焦点返回同行生成操作。Narration 修改立即显示待生成，空 Narration 禁止生成；断连仅显示最后确认状态。状态配合文字与标记；Draft Duration 明确是草稿估算，只用于 Preview，缺少匹配 Speech 阻断最终 Render。

上述 Asset 与 Speech 行为及四档页面证据见 [#111 验收记录](docs/acceptance/issue111/README.md)。

表格工作区独占 Scene 内容写入。Agent 的 Scene 修改建议不能直接改写 Scene；内容与 Render Program 的表现权威遵循 `CONTEXT.md` 和 ADR-0009。

### 共享保存与连接反馈

共享反馈位于顶部项目区域下方、工作区标签上方，因此在表格与 Agent 工作区均可见。它显示已保存、待保存、保存中或失败，以及断线后的只读说明；按状态提供重试保存、返回编辑与重新连接。返回编辑定位最近编辑的 Scene；原 Scene 删除时回到可用位置并说明。失败原因持续显示；断连时保留原页面内容并说明任务仅为最后确认状态，重连核对身份与写权后才恢复编辑。本地草稿只在原页面存活期间保留，不承诺关闭页面后的恢复。不要把本地草稿说成已经持久化。

### Agent 审阅与当前对话

Agent 工作区以视频为主面，播放区之后是单句变更摘要、审阅详情和接受入口；过期状态、硬阻断与非阻断警告直接展示。右侧抽屉组织变更摘要、检查证据和 Scene 建议，完整覆盖计划、Preview 版本身份与创作指令按需展开；原有最终 Render 保持独立。打开抽屉不额外暂停播放，关闭后焦点返回入口，Tab 在抽屉内循环。切换工作区保留选择和版本状态，仅暂停隐藏播放器，不停止任务。底部指引说明在当前 Codex 对话表达创作目标，工作台不提供第二个聊天输入或发起创作入口。

Preview 保持画面比例，版本必须显式切换，新候选就绪只提示。Scene 建议仅复制或定位到表格手工编辑；目标删除时禁用定位并解释，复制仍可用。返回候选审阅保留抽屉阅读位置与同一 Preview 实例的帧，视频保持暂停；输入变化立即标记旧 Preview 过期，新实例从自己的首帧开始，不套用旧视频位置。页面与真实媒体证据见 [#112 验收记录](docs/acceptance/issue112/README.md)。候选由用户整体接受；接受完成不代表最终 Render 已完成。代表帧证据不记录用户观看范围，也不替代审美判断。遵循 ADR-0010 与产品规范，不因视觉迁移改变门禁或历史回退语义。

### 候选决策与修订历史

接受确认在视频下方的决策区原位展开，白底、深灰细边框、20px 内边距，680px 及以下收为 16px；依次呈现变更摘要、候选身份、输入新鲜度、检查结论、全部非阻断警告和接受后果。读取完成后焦点落在“取消”，取消返回“审阅并接受”。确认按钮沿用白底、蓝色边框，不能把 Scene 深底主按钮的样式笼统套用于所有主要操作。

决策区内接受操作组的按钮最小高度为 36px，内边距 `8px 16px`；区域内的结果查询、清理按钮仍为 44px。结果以常驻文字和相邻恢复按钮表达，通过 `role="status"` 与 `aria-live="polite"` 通告。回执不明时显示“正在核对接受结果”，保留只读查看与手动核对，禁用重复或冲突提交。确认已接受但收尾未完成时，明确显示“候选已接受，任务收尾待完成”及“重试清理”；清理失败不撤销接受事实，最终 Render 仍需独立发起。

修订历史入口在只读状态可用；打开聚焦关闭按钮，关闭后焦点返回入口。修订条目先显示摘要、短身份、时间与来源，检查详情及完整指纹按需展开，长身份和记录允许换行。损坏修订显示原因并禁用创建候选；已有候选时提示先接受或明确放弃。交互及页面证据见 [#113 验收记录](docs/acceptance/issue113/README.md)。

## Do's and Don'ts

### Do

- 让 Narration 主导阅读，维持四列连续表格与按内容增长的行高。
- 同时用文字和视觉标记表达状态，并让键盘焦点与恢复操作可达。
- 保持两个工作区共享保存反馈，明确本地草稿与持久结果的区别。
- 新增表面复用白底、近黑字、灰色辅助、轻边框和深色主按钮。
- 区分当前实现、已确认原型与待实施工单，说明截图和宿主验收的边界。

### Don't

- 恢复暗房框体、纸张胶片纹理、背光表格或装饰印章。
- 把窄屏表格改为隐藏 Asset／Speech 列，或用固定行高截断长 Narration。
- 以常驻检查侧栏挤占 Scene 主编辑区。
- 把第 3 批导航及项目入口方案描述为已经交付。
- 用短暂成功提示覆盖过期 Preview，或把接受候选等同最终输出完成。

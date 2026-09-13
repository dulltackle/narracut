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
  focus-blue: "#315e9a"
  selection: "#dce7f4"
  green: "#28743a"
  amber: "#895211"
  editor-line: "#9a9a9a"
  control-line: "#d5d5d5"
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
  workspace-label:
    fontSize: "13px"
    fontWeight: 400
  brief-body:
    fontFamily: '"Noto Sans SC", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.75
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
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.workspace-label}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
  brief-editor:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.content-ink}"
    typography: "{typography.brief-body}"
    rounded: "{rounded.editor}"
    padding: "16px"
    width: "100%"
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

本记录刷新已过时的“暗房接触印样台”体系。#109 已移除表格的暗色框体、纸张与胶片纹理、背光和装饰边码。Agent 工作区、启动器及宿主连接反馈的基础色已迁移到浅色；其具体布局仍沿现有模块。#112 已将候选审阅改为视频主面与按需右侧抽屉；#115 已将项目入口、分段工作区、项目工具与独立关闭入口组成分组顶栏，并以居中弹窗编辑 Video Brief。

依据为 `plugins/narracut/workbench.html` 最终 CSS 层叠、`plugins/narracut/workbench.js` 与 `plugins/narracut/src/workbench-panel.ts`。方向参考 `docs/design-references/prototype-navigation-light/README.md` 及其 `evidence/final-workbench-902.png`，但原型不是生产行为依据。基础编辑页面证据见 [#109 验收记录](docs/acceptance/issue109/README.md)，包括 [902px 桌面](docs/acceptance/issue109/issue109-902.png)、[430px 窄屏](docs/acceptance/issue109/issue109-430.png)及[横滚到 Speech](docs/acceptance/issue109/issue109-430-speech.png)。页面自动化与这些截图不等于真实 Codex 宿主、系统窗口及端到端后端验收。

本次刷新（2026-09-13）保留现有设计方向，核对当前工作台资源的最终 CSS 层叠，并通过 Chromium 协议夹具检查 902×667 与 430×860 视口的导航、表格、Brief 与冲突界面。计算样式确认工作区标签为 13px、400 字重，桌面最小高度 30px、窄屏 44px，选中态为白底轻投影。此次未执行真实 Codex 宿主、系统窗口或媒体输出验收；既有行为证据仍以各验收记录为准。

组件示例与叙述同步保存在 `.impeccable/design.json`，已更新分段导航、901px 导航断点和 Brief 编辑框。其派生 OKLCH 色阶仅供设计面板展示，不是生产调色板；组件片段展示外观与 CSS 状态，不执行真实保存、导航或候选接受。文件结构遵循 [DESIGN.md 格式](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md)，前置令牌记录规范值，正文说明应用范围。

#115 页面证据见 [902px 分组顶栏](docs/acceptance/issue115/toolbar-902.png)、[430px 分行顶栏](docs/acceptance/issue115/toolbar-430.png)、[长 Brief 弹窗](docs/acceptance/issue115/brief-902.png)、[窄屏冲突比较](docs/acceptance/issue115/conflict-430.png)与 [measurements.json](docs/acceptance/issue115/measurements.json)。这些截图和尺寸来自协议夹具；实际文件保存、再次冲突与导出行为由 `tests/e2e/brief-navigation.spec.ts` 验证，不代表真实 Codex 宿主验收。

**Key Characteristics:**

- 连续表格优先，避免每个 Scene 独立成卡。
- 内容按长度展开，选择、编辑与保存反馈可核对。
- 表格全宽使用可用空间；项目检查按需打开抽屉。
- 创作入口仍是 Codex 当前对话；Agent 工作区用于任务状态与候选审阅。

## Colors

### Primary

主色是深灰 `primary`，用于新增 Scene 等主要操作；基础文字使用 `ink`，Narration 阅读态及接受区域使用 `content-ink`，辅助文字使用 `muted`。

### Neutral

`paper` 覆盖主工作面，`panel` 用于表头和底部指引等轻微分层，`line` 用于结构分隔，`control-line` 用于项目工具、项目信息与 Brief 控件描边。选中 Scene 用 `control`，分段工作区容器用 `tab-selected`，当前工作区用白色按钮面与轻投影标记。

### 功能色

`focus-blue` 保留键盘焦点功能，文本选择使用 `selection`；绿色和琥珀用于成功、连接或需处理的语义，不再承担暗房装饰。颜色不能独自表达状态，继续配合文字、图标或形状。旧模块中的历史变量名和局部色值不自动成为新品牌规范；新增表面使用上述已确认基础。

## Typography

页面基础字体使用中文 UI sans 字体栈，默认 16px、400 字重；`typography.body` 专指 Narration 阅读及编辑角色，为 14px、400 字重、1.65 行高，不是 body 元素的默认字号。表头 12px、500 字重，Scene 序号 13px。状态摘要 12px；Speech 时长等细节为 11px 的 `ui-monospace, monospace`，500 字重、1.35 行高。分组顶栏按钮与工作区标签为 13px、400 字重，项目名称为 650 字重。Brief 正文使用 `brief-body`：14px、400 字重、1.75 行高，独立于 Narration 的正文角色。正文保持自然中文阅读，不用展示字或等宽体排 Narration。

Operate 顶部以项目名称作为入口，不再显示独立品牌标识。项目机器身份仍可使用现有等宽标签；Agent 与启动器中保留的标题尺度只描述现有模块，不作为新页面的统一展示字要求。

## Layout

工作台占据宿主提供的 `100dvh` 内容区。902px 及以上使用最小高 56px 的单行分组顶栏，依次为项目文件夹入口、表格／Agent 分段工作区、创作说明／声音配置／程序历史／项目检查工具和独立关闭项目入口；工具组与关闭组以细竖线分隔。901px 及以下分为项目与关闭、工作区、项目工具三行，工具可换行，按钮最小高度 44px。共享反馈位于顶栏及可选控制权区域之后，底部保留当前对话指引。

表格使用单列全宽工作区，桌面内边距 `12px 16px`。Scene 表头与内容共享 `64px minmax(220px,1fr) 150px 190px` 列定义；短内容行最小高度 52px，长 Narration 和编辑框随内容增高，不以两行截断或强制单行挤压。

在 `max-width:700px` 时，工作面内边距为 8px，列定义为 `48px minmax(220px,1fr) 140px 190px`，最小表格宽度 598px。保留 Scene、Narration、Asset、Speech 四列，通过内容区横向滚动访问右侧列；表头由滚动事件同步位移。430px 截图右侧 Speech 未在初始视口出现，表示可横滚，不表示列被隐藏。窄屏工具栏与 Speech 操作最小触控高度为 44px。

项目检查在所有尺寸均按需打开右侧抽屉，宽 `min(90vw,380px)`，不常驻占用表格宽度。Agent 审阅抽屉覆盖工作区右侧，宽 `min(560px,100%)`，正文独立滚动；窄屏占满工作区宽度，顶部关闭入口保持可见。视频容器最终高度为 `clamp(180px,calc(100dvh - 430px),480px)`；桌面内边距 16px，窄屏为 `12px 8px`。这里描述宿主视频容器，实际画面保留自身比例。启动器仍使用既有模块。

修订历史是独立的原生模态 dialog，从视口右侧展开，宽 `min(600px,100vw)`、高 `100dvh`，内边距 24px；在 680px 及以下改为全宽、20px 内边距。它不同于覆盖工作区的审阅抽屉。工作台还保留 980px Scene 工具栏菜单以及启动器 760px 的局部断点；这些不是一套统一的全局响应式尺度。

## Elevation & Depth

主工作面以白底、浅灰分层与细分隔线建立层级，表格框、选中 Scene 和主要审阅面板无投影。工具栏 Scene 菜单使用 `0 8px 24px #00000014`；右键／Shift+F10 上下文菜单与 Speech 原因浮层使用 `0 8px 24px #00000024`。项目检查和候选审阅抽屉均使用 `-12px 8px 36px #00000014`，表达覆盖工作面的叠加关系。

分段工作区的选中按钮使用 `0 1px 3px #00000018` 轻投影。项目详情与 Brief 弹窗以 `#17171766` 背景遮罩表达模态关系，Brief 主面不使用投影。

键盘焦点一般使用 `focus-blue` 的 2px 描边、2px 外偏移，不依赖发光。接受区域与修订历史的局部高优先级规则仍使用 `#9dbcf0` 的 2px 描边、3px 外偏移；宿主连接反馈按钮也沿用此浅蓝描边。这是现存局部样式，不是替换全局焦点色的新约定。修订历史通过 `rgba(3,5,5,.7)` 背景遮罩表达模态关系，不沿用审阅抽屉的投影。Scene 表格已关闭旧灯箱动画及纹理；不要恢复材料首现效果。启动器忙碌圆点仍有 1 秒 `ease-in-out` 往返亮度脉冲；这是局部等待反馈，当前没有统一的过渡时长或缓动体系。

## Shapes

连续表格采用平直边界与逐行细线，去除列间强分割、选中三角与印章。常规 Scene 操作按钮使用 6px 圆角，密集行内操作紧邻状态。Narration 文本框保留 2px 圆角。Speech 原因浮层与 Scene 上下文菜单采用 6px 圆角，分别使用 16px 与 8px 内边距。控件圆角不意味着每条 Scene 或每段审阅内容都需要卡片容器。

## Components

### 按钮与工作区导航

新增 Scene 等主按钮为深底白字，悬停时保持深底白字；次按钮白底近黑字与轻描边。桌面 Scene 工具按钮最小高度 32px、内边距 `4px 10px`；窄屏提升到 44px，其中主要操作内边距为 `0 9px`，撤销／重做为 `4px 8px`。Scene 操作按钮继承 `.76rem`、700 字重，禁用透明度为 `.46`；其他通用按钮禁用透明度为 `.5`。工作区使用浅灰分段容器，选中按钮为白底深字与轻投影，不显示底部指示线；容器内边距桌面为 3px、901px 及以下为 2px，标签间距为 2px。桌面普通项目工具最小高度 34px，标签最小高度 30px；901px 及以下均为 44px。未选中标签透明底、深灰字，悬停变浅灰底；选中标签始终保持白底轻投影，焦点描边独立可见。项目名称是可点击的文件夹入口，弹窗显示项目文件夹名、路径、完整 Project ID 及可用时的对话详情，长目录自然换行。关闭项目入口与其他工具分组，使用浅暖底色和棕色文字。

Scene 上下文菜单宽 `min(248px,calc(100vw - 16px))`，最高为视口高度减 16px，超长菜单内部滚动。菜单项桌面最小高度 36px、窄屏 44px，悬停以浅灰底突出；选择态与键盘焦点独立表达。

### Narration 原位编辑

Narration 点击或编辑入口进入原位文本框；文本框以 `scrollHeight` 自动调高，保留换行并允许长词换行。桌面编辑入口在行悬停或键盘焦点时显示，窄屏持续显示。离开文本框触发保存；输入法组合期间推迟保存与渲染，在组合结束后处理最终输入，避免覆盖中文候选。旧的放大编辑入口与帮助条在此布局隐藏。

### Scene、Asset 与 Speech

每个 Scene 的稳定身份、Narration、Asset 摘要与 Speech 同行。Asset 入口无论单个或多个文件都先打开右侧临时管理面板；管理目标独立于所选 Scene。只读预览 Asset 本体，打开、预览与关闭保持原 Scene 选择和 Player 观看位置，关闭回到同行入口。长文件名在表格省略、在面板完整换行；未绑定与文件缺失分别说明，缺失文件仍可解除引用。Speech 状态与时长组成同行摘要，生成／重新生成等操作相邻。生成 Speech 使用麦克风图标，重新生成使用循环箭头；按钮的可访问名称与提示包含动作和 Scene 序号，生成中提供文字“取消”按钮。失败、失效与限制原因通过摘要另一侧的问题图标打开浮层，不新增原因行；支持点击、Enter／空格打开，点击外部或 Escape 关闭并返回问题图标。普通失败直接重试，无需确认。生成阶段刷新保留浮层焦点；成功后原因消失时自动收起，浮层内焦点返回同行生成操作。Narration 修改立即显示待生成，空 Narration 禁止生成；断连仅显示最后确认状态。状态配合文字与标记；Draft Duration 明确是草稿估算，只用于 Preview，缺少匹配 Speech 阻断最终 Render。

上述 Asset 与 Speech 行为及四档页面证据见 [#111 验收记录](docs/acceptance/issue111/README.md)。

表格工作区独占 Scene 内容写入。Agent 的 Scene 修改建议不能直接改写 Scene；内容与 Render Program 的表现权威遵循 `CONTEXT.md` 和 ADR-0009。

### 项目声音配置

顶部“声音配置”与首次 Scene 生成共用右侧表单，先说明整部视频共用此声音。面板宽 `min(560px,100vw)`，白底、细边框、14px 正文，独立滚动；700px 及以下使用全宽。表单控件与动作至少 44px 高，主按钮沿用深灰底白字，键盘焦点清楚。

首次入口展示原句摘要与“保存并生成此句”；顶部入口只保存配置。保存后再次核对持久原句，文本变化停在最新文字和“生成最新内容”，删除、变空或失权说明原因，不替换目标。已有输出配置变化在同面板列出受影响 Speech 数量、可展开 Scene 清单与失效后果，默认聚焦“返回修改”；仅凭据变更不触发音频失效。加载、保存与回执核对分别反馈，失败保留输入；关闭返回实际入口，Tab 在面板内循环。

页面与持久验证及真实合成缺口见 [#116 验收记录](docs/acceptance/issue116/README.md)。

### 共享保存与连接反馈

共享反馈位于分组顶栏及可选控制权区域下方，因此在表格与 Agent 工作区均可见。它显示已保存、待保存、保存中或失败，以及断线后的只读说明；按状态提供重试保存、返回编辑与重新连接。返回编辑定位最近编辑的 Scene；原 Scene 删除时回到可用位置并说明。失败原因持续显示；断连时保留原页面内容并说明任务仅为最后确认状态，重连核对身份与写权后才恢复编辑。本地草稿只在原页面存活期间保留，不承诺关闭页面后的恢复。不要把本地草稿说成已经持久化。Brief 状态与 Scene 保存、连接状态同区显示；Brief 失败、未保存或冲突时保留返回编辑／处理冲突入口，普通失败提供显式重试。关闭 Brief 后失败不抢回焦点或自动重开弹窗。

### Video Brief 与外部冲突

创作说明打开居中的原生模态 dialog，宽 `min(1000px,calc(100vw - 32px))`、高 `min(760px,calc(100dvh - 40px))`，白底、6px 圆角，正文区域独立滚动；700px 及以下距离视口四边 8px，操作最小高度 44px。原始 Markdown 使用 `brief-body`，白底深灰正文、灰色细描边和 2px 圆角；正文框内边距桌面为 16px、700px 及以下为 12px，长文本可滚动。冲突证据框使用 `panel` 浅灰底与 `control-line` 描边，仍保留 16px 内边距；合并框保持白底。合并保存主按钮使用深灰底白字，悬停切换为 `ink` 底色，与 Scene 主按钮保持原色的悬停规则不同。打开聚焦编辑框，Tab 保持在弹窗内；关闭或 Escape 返回入口，重新打开保留编辑位置。

普通编辑离开编辑框或关闭弹窗时保存，组合输入结束后再处理保存和关闭；保留原始换行、撤销与重做。失败保留本地文字并要求显式重试。只读、失权与断连时保留查看，禁止写入；保存回执不能覆盖之后的新输入。

外部冲突在同一弹窗内处理：桌面并排显示只读 LOCAL 与 DISK，BASE 按需展开；700px 及以下以标签切换 LOCAL／DISK，BASE 仍独立展开。下方编辑完整 Markdown 合并结果，只有点击“保存合并结果”才提交；再次冲突保留三方证据与合并草稿。导出本地内容不解除冲突；“放弃本地，采用磁盘内容”先原位确认，默认聚焦取消，确认后载入所展示的 DISK，不改写磁盘。普通离开保存不能绕过冲突处理。

### Agent 审阅与当前对话

Agent 工作区以视频为主面，播放区之后是单句变更摘要、审阅详情和接受入口；过期状态、硬阻断与非阻断警告直接展示。右侧抽屉组织变更摘要、检查证据和 Scene 建议，完整覆盖计划、Preview 版本身份与创作指令按需展开；原有最终 Render 保持独立。打开抽屉不额外暂停播放，关闭后焦点返回入口，Tab 在抽屉内循环。切换工作区保留选择和版本状态，仅暂停隐藏播放器，不停止任务。底部指引说明在当前 Codex 对话表达创作目标，工作台不提供第二个聊天输入或发起创作入口。

Preview 保持画面比例，版本必须显式切换，新候选就绪只提示。Scene 建议仅复制或定位到表格手工编辑；目标删除时禁用定位并解释，复制仍可用。返回候选审阅保留抽屉阅读位置与同一 Preview 实例的帧，视频保持暂停；输入变化立即标记旧 Preview 过期，新实例从自己的首帧开始，不套用旧视频位置。页面与真实媒体证据见 [#112 验收记录](docs/acceptance/issue112/README.md)。候选由用户整体接受；接受完成不代表最终 Render 已完成。代表帧证据不记录用户观看范围，也不替代审美判断。遵循 ADR-0010 与产品规范，不因视觉迁移改变门禁或历史回退语义。

### 候选决策与修订历史

接受确认在视频下方的决策区原位展开，白底、深灰细边框、20px 内边距，680px 及以下收为 16px；依次呈现变更摘要、候选身份、输入新鲜度、检查结论、全部非阻断警告和接受后果。读取完成后焦点落在“取消”，取消返回“审阅并接受”。确认按钮沿用白底、蓝色边框，不能把 Scene 深底主按钮的样式笼统套用于所有主要操作。

决策区内接受操作组的按钮最小高度为 36px，内边距 `8px 16px`；区域内的结果查询、清理按钮仍为 44px。结果以常驻文字和相邻恢复按钮表达，通过 `role="status"` 与 `aria-live="polite"` 通告。回执不明时显示“正在核对接受结果”，保留只读查看与手动核对，禁用重复或冲突提交。确认已接受但收尾未完成时，明确显示“候选已接受，任务收尾待完成”及“重试清理”；清理失败不撤销接受事实，最终 Render 仍需独立发起。

修订历史入口在只读状态可用；打开聚焦关闭按钮，关闭后焦点返回入口。修订条目先显示摘要、短身份、时间与来源，检查详情及完整指纹按需展开，长身份和记录允许换行。损坏修订显示原因并禁用创建候选；已有候选时提示先接受或明确放弃。交互及页面证据见 [#113 验收记录](docs/acceptance/issue113/README.md)。

### 接受后的独立视频输出

视频下方的输出区显示“已接受，尚未输出”和独立“输出视频”入口。点击原位展开来源、时长、画幅、帧率与系统文件夹选择，用户另行点击“开始输出”；收起返回入口焦点。输出区沿用白底、深字、轻顶部分隔线与深色主按钮，正文 14px、1.65 行高，问题说明使用琥珀色并配完整文字。长路径自然换行，详情按需展开，窄屏操作保持至少 44px。

阻断问题逐项提供 Scene 或文件引用定位，缺 Speech 说明生成后需要重新验收。只读和断连禁止启动，保留查看、核对与复制已有路径。进度来自真实执行阶段与已完成帧数；未知回执继续核对且禁止重复启动。成功显示实际路径和来源修订，文件定位与复制路径为独立按钮。页面与真实产物证据边界见 [#114 验收记录](docs/acceptance/issue114/README.md)。

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
- 用短暂成功提示覆盖过期 Preview，或把接受候选等同最终输出完成。

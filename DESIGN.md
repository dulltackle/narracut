---
name: Narracut VNext Workbench
description: 以暗房接触印样组织 Scene 编辑、Agent 创作、候选审阅与成片输出的工作台。
colors:
  darkroom: "#090d0e"
  shell: "#101516"
  film: "#050707"
  stage: "#111718"
  panel: "#0d1213"
  control: "#151b1c"
  line: "#303738"
  separator: "#364041"
  paper: "#f1f3eb"
  paper-hover: "#e4e8df"
  paper-selected: "#fafbf5"
  ink: "#171b1b"
  muted: "#909997"
  proof-blue: "#4e88df"
  proof-blue-deep: "#245da9"
  readonly-amber: "#d89a3d"
  connected-green: "#67c477"
  focus-blue: "#9dbcf0"
  high-contrast-white: "#ffffff"
  asset-divider: "#343d3e"
  preview-frame: "#485152"
  preview-control-line: "#4a5556"
  blue-control-hover: "#6f8db8"
  preview-label: "#7f8a87"
  asset-muted: "#8f9996"
  preview-muted: "#909a97"
  asset-path-muted: "#919b98"
  asset-search-label: "#9aa4a1"
  preview-copy: "#aab3b0"
  import-ledger-copy: "#b7c0bd"
  preview-code: "#c0c8c5"
  preview-value: "#c8cecb"
  asset-fact-value: "#c8cfcc"
  asset-warning-copy: "#d0b07d"
  asset-capacity-copy: "#d7b57f"
  asset-control-copy: "#d7ddda"
  asset-field-copy: "#e1e5e2"
  project-asset-title: "#e2e6e3"
  asset-title: "#e3e7e4"
  preview-title: "#eef1ed"
  asset-hover-tint: "rgba(78,136,223,.035)"
  preview-scrim: "rgba(3,5,5,.9)"
typography:
  display:
    fontFamily: '"Narracut Display", sans-serif'
    fontSize: "clamp(1.45rem, 2.1vw, 2rem)"
    fontWeight: 800
    letterSpacing: "-0.035em"
    fontVariation: '"wdth" 75, "wght" 800'
  headline:
    fontFamily: '"Narracut Display", sans-serif'
    fontSize: "1.8rem"
    fontWeight: 720
    lineHeight: 1
    fontVariation: '"wdth" 75'
  title:
    fontFamily: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif'
    fontSize: "clamp(0.9rem, 1.18vw, 1.13rem)"
    fontWeight: 680
    lineHeight: 1.65
  body:
    fontFamily: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif'
    fontSize: "0.79rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "ui-monospace, monospace"
    fontSize: "0.62rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.07em"
  control:
    fontFamily: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif'
    fontSize: "0.96rem"
    fontWeight: 650
rounded:
  micro: "2px"
  control: "6px"
  field: "7px"
  compact-panel: "8px"
  frame: "9px"
  circle: "50%"
spacing:
  xs: "8px"
  sm: "12px"
  md: "14px"
  lg: "16px"
  panel: "20px"
  copy: "22px"
  frame: "24px"
components:
  workspace-tab:
    backgroundColor: "transparent"
    textColor: "#959d9a"
    typography: "{typography.control}"
    rounded: "0"
    padding: "0 28px"
    height: "54px"
  workspace-tab-selected:
    backgroundColor: "rgba(78, 136, 223, 0.08)"
    textColor: "#ffffff"
    typography: "{typography.control}"
    rounded: "0"
    padding: "0 28px"
    height: "54px"
  contact-frame:
    backgroundColor: "{colors.film}"
    textColor: "{colors.readonly-amber}"
    rounded: "{rounded.frame}"
    padding: "0 24px"
  contact-sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "0"
  scene-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "0"
    padding: "0"
    height: "112px"
  scene-row-selected:
    backgroundColor: "{colors.paper-selected}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "0"
    padding: "0"
    height: "112px"
  agent-panel:
    backgroundColor: "{colors.panel}"
    textColor: "#d5dbd8"
    rounded: "{rounded.frame}"
    padding: "0"
  status-running:
    backgroundColor: "{colors.proof-blue}"
    rounded: "{rounded.circle}"
    size: "10px"
  status-success:
    backgroundColor: "{colors.connected-green}"
    rounded: "{rounded.circle}"
    size: "10px"
  status-stopped:
    backgroundColor: "transparent"
    textColor: "{colors.readonly-amber}"
    rounded: "{rounded.micro}"
    size: "10px"
  agent-action-primary:
    backgroundColor: "{colors.proof-blue-deep}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
  agent-action-stop:
    backgroundColor: "{colors.control}"
    textColor: "#e1b36c"
    rounded: "{rounded.control}"
  agent-action-disabled:
    backgroundColor: "#111617"
    textColor: "#68716f"
    rounded: "{rounded.control}"
  composer-draft:
    backgroundColor: "{colors.control}"
    textColor: "{colors.paper}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
    height: "64px"
  composer-send:
    backgroundColor: "{colors.proof-blue-deep}"
    textColor: "{colors.high-contrast-white}"
    rounded: "{rounded.control}"
    width: "104px"
  delivery-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.paper}"
    padding: "24px"
  brief-editor:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.micro}"
    padding: "24px"

---

# Design System: Narracut VNext Workbench

## Overview

**Creative North Star: "暗房接触印样台"**

Narracut 的工作台是一座数字暗房：深黑框体压低环境噪声，一张背光纸面把有序 Scene 排成可快速扫描的接触印样。项目身份先于工具，Narration 先于缩略图，校片状态先于装饰；蓝色套准线、琥珀边码和纸张/胶片纹理构成既有视觉识别。

触感来自材料与结构。Scene 表格以连续纸面承载密集编辑，检查面板使用暗色侧台；Agent 创作指令、候选、检查、交付与最终 Render 沿暗色纵向工作面排列，以标题、分隔线、状态和下一步操作组织信息。Composer 固定在底部，输入框下方紧邻会话说明与编辑边界。Preview 保留画面比例，详细身份和证据收进可展开区域。

本次刷新依据 `plugins/narracut/workbench.html` 的最终 CSS 层叠、`workbench.js` 及 Preview、检查、交付、接受和 Render 模块；桌面与移动端表格已用当前构建截图核对。本文记录已实现的视觉约定，产品规则以 PRODUCT.md 与项目规范为准，不把旧阶段的功能禁用状态固化为设计禁令。

**Key Characteristics:**

- 深色外壳包围暖白接触表，Scene 内容拥有最高亮度。
- Narration、Asset 摘要和 Speech 状态采用稳定列与连续行，编辑入口贴近内容。
- 项目检查在窄屏转为抽屉；移动端保留 Narration 与 Speech，Asset 从检查入口管理。
- Agent 以当前创作指令和下一步操作为中心，技术身份折叠，沿用状态台而非聊天气泡。
- 候选审阅以版本标记、过期提示、检查结果和代表帧证据建立层级；接受与最终输出各有明确操作区。
- 蓝色、绿色与琥珀配合文字、轮廓和形状表达选择、进度与需要处理的状态。
- 自托管窄体展示字、中文 UI sans 与等宽标签分别承担身份、内容和机器事实。
- 本地内嵌纸张与胶片材料、受减少动态效果偏好控制的灯箱首现动效维持材料感。

## Colors

调色板在近黑暗房与低彩度纸面之间建立强明度反差，蓝色负责校片选择，琥珀和绿色只承担窄而明确的状态语义。

### Primary

- **校片蓝** (`proof-blue`): 选中 Scene 的内描边、当前工作区下划线与 Agent 运行状态及可用操作反馈；它是操作反馈，不是大面积品牌填充。
- **深校片蓝** (`proof-blue-deep`): Scene 边码、选择三角、纸面校片记号，以及创作、接受、Render 等主要操作的实色底。

### Secondary

- **只读琥珀** (`readonly-amber`): 胶片边码、只读标签、诊断代码、停止与不可用状态；稀少使用让边界保持可信。
- **连接绿** (`connected-green`): 连接正常、控制文件有效、Speech 可用与检查通过等肯定状态。

### Neutral

- **暗房黑** (`darkroom`): 应用最外层画布。
- **机身黑** (`shell`): 工作台框体与稳定结构面。
- **胶片黑** (`film`): 接触表外框，让边码与纸面亮度成立。
- **舞台黑** (`stage`): 主工作区地面与 Agent 结果凭证单元。
- **状态台黑** (`panel`): 项目检查、空/错误面与 Agent 创作框体。
- **控件黑** (`control`): 休止态按钮、抽屉控件与锁定器件。
- **结构线** (`line`): 暗色区域的边界与分隔。
- **状态分隔** (`separator`): Agent 标题、任务、结果与操作区之间的结构分隔。
- **背光纸白** (`paper`): Scene 接触表的主阅读面。
- **纸面悬停** (`paper-hover`): 可激活 Scene 行的指针反馈。
- **选中纸白** (`paper-selected`): 被校片线框住的当前 Scene。
- **纸面墨色** (`ink`): Narration、Scene 编号与纸面主要信息。
- **暗房灰** (`muted`): 未激活标签、次级状态与低优先级元数据。
- **Asset 信息阶** (`asset-*` / `preview-*`): Asset 面板与预览层的结构线、事实文字、路径和警告使用已提取的低彩度灰阶；这些色阶不进入接触表纸面主内容。

### Named Rules

**The Proofing Blue Rule.** 校片蓝用于当前工作区、焦点、显式选择、运行状态与主要操作；选中状态还必须拥有线框、位置标记或文字语义。

**The Amber Boundary Rule.** 琥珀只说明胶片边码、只读边界与需要注意的诊断，不把整块面板染成警告色。

**The Lit Content Rule.** 最高亮度留给 Scene 内容纸面；暗房中的导航、检查和 Composer 不得与接触表争夺亮度。

**The Status Shape Rule.** 任务状态必须同时有文字与形状：蓝色实心圆点是运行，绿色实心圆点是连接或成功，琥珀方形轮廓是停止或不可用。

## Typography

**Display Font:** Narracut Display（自托管 Ubuntu Sans 可变窄体子集，回退到 sans-serif）

**Body Font:** Noto Sans SC（回退到 Source Han Sans SC、Microsoft YaHei、sans-serif）

**Label/Mono Font:** ui-monospace（回退到 monospace）

**Character:** 展示字像胶片盒与校片章上的工业窄体，用于品牌、Scene 编号、校片边码、只读标签及部分面板标题。中文 UI sans 承担叙事阅读，等宽体承担 Project ID、路径、表头、时长与机器状态；三者不能互换成装饰。

### Hierarchy

- **Display** (800, responsive clamp, tight tracking): 只用于 Narracut 品牌字样。
- **Headline** (720, compact line-height): 用于 Scene 大编号及同等级校片标记。
- **Title** (680, responsive clamp, generous line-height): Scene Narration 主内容，最多两行时仍保持稳定扫描节奏。
- **Body** (400, compact UI size): 项目检查、说明、空状态与次级正文。
- **Label** (700, uppercase where Latin, tracked): Scene 表头、Asset/Speech 标签与胶片边码。
- **Control** (650): 工作区标签及同等级的明确操作文字。

### Named Rules

**The Three Voices Rule.** 展示字负责身份与校片，中文 UI sans 负责内容，等宽体负责机器事实；不要用展示字排中文长文，也不要用等宽体承担 Narration。

## Layout

工作台占满视口（`100dvh`），按项目身份、工作区导航、可滚动工作面、Composer 四段排列。桌面行高依次为 `68px / 54px / minmax(0,1fr) / 138px`；移动端为 `92px / 50px / minmax(0,1fr) / 164px`。内容区域独立滚动，底部输入与反馈保留在壳体内。

桌面项目检查宽 `320px`，在 `900px` 以下收为 `280px`；`700px` 以下改为右侧抽屉（`min(88vw,360px)`），TTS 子视图为 `min(94vw,390px)`。Project ID 移到身份栏第二行，文件夹图标隐藏，项目名和连接文字保留。

Scene 行高采用 `112px`。最终桌面列为 `80px / minmax(240px,1fr) / 150px / 154px`；`900px` 以下为 `70px / minmax(220px,1fr) / 120px / 146px`；`700px` 以下隐藏 Asset 列，保留 `52px / minmax(156px,1fr) / 138px` 的编号、Narration 与 Speech。行内编辑和 Speech 动作各自留位。操作轨在 `980px` 以下将次级动作收进菜单。

外工作面使用紧凑间距，内容、检查与覆盖层逐级增加留白，常用间距以 frontmatter 的 spacing 为准。Agent 创作采用纵向任务与审阅分区；旧宿主验证分区仍有 `900px` 的双列转单列样式，但不是当前创作任务的布局模板。交付代表帧桌面三列、移动端单列，Scene 边界对照保留两列。

启动页沿用胶片框中的步骤纸面与侧边入口，在 `760px` 以下顺序叠放。Brief 编辑层桌面最大 `1120px × 820px`，窄屏近全屏；修订历史从右侧覆盖，最大宽 `600px`，`680px` 以下全宽。

**The Persistent Composer Rule.** 尺寸变化可以压缩标签和操作排布，但输入、状态说明和发送入口保持可达。

## Elevation & Depth

系统通过灯箱明度、内嵌暗边和少量结构阴影建立深度。胶片框使用重环境阴影压入暗房；纸面使用柔和背光与内阴影模拟光箱玻璃；Agent 创作台与常驻导航、检查栏一样依赖色阶和分隔线，不为任务或结果制造漂浮卡片。项目检查抽屉、独立媒体/Brief 编辑层和修订历史构成明确的覆盖层。

### Shadow Vocabulary

- **状态台压暗** (`0 18px 54px rgba(0,0,0,.32), inset 0 1px rgba(255,255,255,.035)`): 用于 Agent 整体框体，不逐项套用。
- **媒体覆盖层** (`0 28px 80px rgba(0,0,0,.7)`): 用于 Asset 预览；Brief 编辑层使用同形阴影，透明度为 `.72`。

- **胶片压暗** (`0 26px 70px rgba(0,0,0,.58), inset 0 1px rgba(255,255,255,.045), inset 0 0 0 5px rgba(0,0,0,.18)`): 只用于整张接触印样框。
- **纸面背光** (`0 0 34px rgba(241,243,235,.34), inset 0 0 36px rgba(68,76,72,.14)`): 只用于背光接触表。
- **键盘焦点** (`0 0 0 5px rgba(78,136,223,.24)`): 与 `2px` 可见轮廓共同出现，不能代替轮廓。
- **移动检查抽屉** (`-18px 0 45px rgba(0,0,0,.48)`): 仅在窄屏项目检查打开时出现。

接触表在允许动效时以 `420ms`、`cubic-bezier(.16,1,.3,1)` 从稍暗状态亮起；`prefers-reduced-motion` 下完全不播放。动画以 `both` 保留结束态；结束背光为 `0 0 22px rgba(241,243,235,.28), inset 0 0 28px rgba(68,76,72,.1)`，与无动画的静态背光不同。系统没有装饰性持续动画。

**The One Lightbox Rule.** 每个工作区最多有一个背光主面；不要把普通面板、按钮或提示也做成发光玻璃。

## Shapes

形状语言接近切割纸张与机械框体。Scene 行、标签和大部分结构保持直角；文件夹图标与“停止/不可用”指示使用紧凑 `2px` 圆角，抽屉与 Agent 操作按钮使用 `6px`，Composer 字段使用 `7px`，整张胶片框和状态面使用 `9px`。运行、连接与成功指示是圆形；选中 Scene 的小边码使用轻微旋转和不规则椭圆圈记，作为人工校片痕迹。

**The Cut Edge Rule.** 圆角用于可触控控件和整张材料框，不用于把每条 Scene、每项检查或每段文字包成卡片。

## Components

### Buttons

操作按钮保持机械式紧凑轮廓。暗面次级按钮使用控件黑、结构描边与小圆角，主操作使用深校片蓝和白字；Agent 停止操作使用琥珀文字。通用 Agent 操作最小高度为 `44px`、最小宽度为 `126px`；这是最小尺寸，不是固定高度。悬停提高边框或背景明度，禁用同时降低明度并改变指针。

纸面 Scene 工具使用浅底深字；桌面操作轨最小高度 `40px`，移动端增至 `44px`。Speech 动作保持至少 `44px` 的宽高。不同按钮族的禁用透明度与悬停样式按所在表面保留，不强行合并成一套数值。

### Inputs / Fields

Composer 使用暗色多行输入、细边框与 field 圆角；右侧发送按钮宽度见 frontmatter。空草稿或操作不可用时禁用，有效输入可显示“开始创作”或“发送”，下方说明承担错误、会话范围与编辑边界反馈。

Narration 采用纸面原位编辑。Video Brief 原始 Markdown 使用暖白大编辑面、墨色等宽正文和校片蓝光标；冲突证据桌面并列，移动端以选项切换证据、顺序安排决策按钮。新目标接管使用独立内联表单，普通任务与无法恢复的任务沿用同一表单。文本框采用暗面、control 圆角、`16px` 字号、`12px` 内边距与 `110px` 最小高度，可纵向调整；说明文字限宽 `70ch`，长目标和候选路径允许折行。打开时聚焦目标输入，状态更新保留输入全文与焦点；取消后返回接管入口。`700px` 以下提交和取消按钮纵向排列。

全局输入和按钮的键盘焦点使用 `2px` 蓝色轮廓、`3px` 偏移及外圈；较新的检查、交付和接受区域使用 focus-blue，部分取消外圈。焦点与选中状态分别表达。

### Navigation

工作区标签是连续直角分区：默认灰字，选中用白字、浅蓝底和底部校片线。移动端标签均分剩余空间，项目检查入口与其同排。侧台通过返回按钮在检查、Asset 和 TTS 间转换；覆盖层提供明确关闭入口。

### Cards / Containers

Scene 使用连续行与列分隔，不逐行浮起。胶片框、Agent 框体和覆盖层采用 frame 圆角；候选、检查、交付与 Render 区域主要靠暗色面、标题和细分隔线建立层级。长路径和身份值允许折行，技术详情使用原生折叠结构。

### Scene 接触印样

Narration 为主阅读列，通常限制两行；编号以窄体显示。选择使用内描边（`3px`）、左侧三角和圈记边码；键盘聚焦不代替选择。Asset 用文件名、引用数量和异常标识提供摘要；Speech 用状态形状、文字、实际时长及贴近单元格的动作展示生成状态。

### 创作、Preview 与交付

当前创作指令以原文、任务状态和可用操作组织，较长原文与技术身份可展开。停止、等待批准、继续和接管以对应文字说明动作后果，不靠单一状态颜色传达。

Preview 采用暗色完整比例舞台，当前修订与候选以具名按钮和“正在查看”文字区分；过期提示独立于临时操作反馈。候选检查、交付摘要、代表帧、接受确认与最终 Render 各自成段。代表帧可放大，修订历史使用右侧抽屉，已完成输出以位置与操作呈现。接受成功不能用视觉反馈冒充 Render 已完成。

### 候选决策与结果核对

接受、放弃和新目标接管分别提供明确入口与后果说明。接受的内联确认摘要说明任务终结；修订已提交但收尾未完成时显示“候选已接受，任务收尾待完成”，并保留清理入口。

放弃使用全屏暗面确认层，标题和确认按钮都写明“放弃候选并终结任务”，说明删除范围及当前修订保留；初始焦点落在“取消”。接管表单把新目标、候选对象和旧证据需重新核对的说明放在提交按钮之前，不借用底部 Composer 承担确认。

操作回执不明时，状态文字持续说明“正在核对操作结果”，提供显式核对按钮；接受、放弃与接管的其他提交入口互斥禁用，避免用户重复操作。接管后保留正在观看的 Preview，并独立标明旧证据过期；放弃确认成功后清除候选 Preview。新任务启动失败使用“已停止”及失败原因反馈，不把已完成的接管表现为旧任务恢复。

## Do's and Don'ts

### Do:

- **Do** 让 Narration 占据纸面主阅读列，让项目身份、连接文字和 Composer 在窄屏继续可达。
- **Do** 用校片线、形状、文字及程序化状态共同表达选择、任务和检查结果。
- **Do** 区分纸面编辑控件与暗面审阅控件，复用已有小圆角和结构描边。
- **Do** 保持 Preview 的完整比例，过期提示和正在查看版本各自可见。
- **Do** 让技术身份、完整证据与历史详情可展开，主面优先显示用户要处理的内容和下一步。
- **Do** 尊重 `prefers-reduced-motion`，将材料动效限制在有界首现反馈。

### Don't:

- **Don't** 把连续接触表改成缩略图优先画廊、多轨时间线或通用 IDE 三栏。
- **Don't** 用颜色作为选择、连接、有效或不可用的唯一信号。
- **Don't** 把旧阶段的“发送尚未启用”或“只读验证”作为当前创作界面的固定文案。
- **Don't** 用每项独立阴影、大量圆角卡片或聊天气泡替换当前的状态与审阅分区。
- **Don't** 用短暂成功提示遮盖 Preview 的过期状态，或把接受完成表现为最终 Render 完成。
- **Don't** 引入霓虹 AI、玻璃拟态或渐变品牌面，稀释暗房与接触印样的材料逻辑。

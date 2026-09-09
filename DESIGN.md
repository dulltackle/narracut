---
name: Narracut VNext Workbench
description: 以暗房接触印样组织 Project VNext Scene 剪接、Asset 引用、Asset 只读预览、成片 Preview 与 Codex 宿主验证的 Operate 工作台。
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
  scale:
    micro: "0.55rem"
    machine-small: "0.58rem"
    machine: "0.62rem"
    metadata: "0.66rem"
    fact: "0.68rem"
    helper: "0.7rem"
    action: "0.72rem"
    compact: "0.79rem"
    item: "0.84rem"
    body: "1rem"
    section: "1.08rem"
    result-title: "1.1rem"
    strong: "1.25rem"
    mobile-title: "1.3rem"
    panel-title: "1.35rem"
    empty-title: "1.4rem"
    state-title: "1.55rem"
    brand: "1.65rem"
    empty-title-max: "2.4rem"
    agent-title-max: "2.75rem"
    state-title-max: "2.8rem"
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
    textColor: "{colors.muted}"
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
    backgroundColor: "{colors.paper}"
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
    padding: "0 18px"
    height: "44px"
  agent-action-stop:
    backgroundColor: "{colors.control}"
    textColor: "#e1b36c"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  agent-action-disabled:
    backgroundColor: "#111617"
    textColor: "#68716f"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  composer-draft:
    backgroundColor: "{colors.control}"
    textColor: "{colors.paper}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
    height: "64px"
---

# Design System: Narracut VNext Workbench

## Overview

**Creative North Star: "暗房接触印样台"**

Narracut 的高频 Operate 表面是一座数字暗房：深黑框体压低环境噪声，一张背光纸面把有序 Scene 排成可快速扫描的接触印样。项目身份先于工具，Narration 先于缩略图，校片状态先于装饰；蓝色套准线、琥珀边码和真实纸张/胶片纹理让界面属于影像创作者的世界，而不是通用 IDE 或 SaaS 后台。

这套系统的触感来自材料与结构，不来自拟物控件堆叠。接触表是表格工作区的主工作面，项目检查是窄侧台；Agent 工作区以克制的单任务 Codex 宿主验证状态台和成片 Preview 主区延续暗房世界，任务与结果保持工业仪表感，成片保留完整比例，不模仿聊天。Composer 是固定在灯箱下沿的多行批注槽，可记录会话草稿，发送按钮保持禁用并说明创作发送尚未启用。

当前交付把表格工作区扩展为可编辑剪接台：操作轨、原位 Narration 编辑、Asset 子视图和保存状态明确哪些内容正在改变。Asset 列继续只做摘要，导入、有序引用和只读预览在既有项目检查层与独立预览层中完成，不抢占接触表主面。Speech 单元格以文字与形状展示生成阶段，并提供单 Scene 生成、重试或取消；项目 TTS 输出契约在右侧检查台的子视图中配置，移动端沿用抽屉。Video Brief 从项目检查进入独立的原始 Markdown 编辑层，拥有与 Scene 分离的历史、保存状态和冲突决策。Agent、Render Program 与 Composer 不改写 Scene 的边界仍持续可见。Agent 状态台只展示当前任务、连接、有界结果与可用操作，不展示 Render Program 源码、对话或日志历史；成片 Preview 在独立主区展示具名当前版本与候选，并明确正在查看的版本。

**Key Characteristics:**

- 黑色暗房外壳包围背光暖白接触表，主内容拥有最高亮度与面积。
- Scene 是连续校片行；Narration 居主列，Asset 仅显示身份、路径或占位。
- Asset 引用管理复用项目检查侧台；内容预览仅在独立只读层中出现，关闭后回到原操作位置。
- Speech 动作用紧凑的校片控件贴在接触表行内；成功状态显示实际时长，项目检查同时显示半开帧窗口与 Render 就绪性。
- TTS 配置复用右侧检查台，不建立新的全局设置页；凭据缺失、会话存储限制和输出规格在同一决策点说明。
- 蓝色校片线同时配合三角指示与圈记边码表达选择，不只依赖颜色。
- Agent 工作区的宿主验证保持单任务：桌面任务/结果双列，窄屏顺序叠放，不出现对话气泡。
- 成片 Preview 以具名版本、正在查看标记、独立过期提示与明确切换保留用户对画面的控制；技术身份收进详情。
- 状态同时使用文字与形状：蓝色圆点表示运行，绿色圆点表示连接或成功，琥珀方形表示停止或不可用。
- 自托管窄体展示字、中文 UI sans 与等宽标签构成三种受控声音。
- 纸张与胶片 raster 由插件以内嵌 data URI 提供，界面不依赖网络材料。

## Colors

调色板在近黑暗房与低彩度纸面之间建立强明度反差，蓝色负责校片选择，琥珀和绿色只承担窄而明确的状态语义。

### Primary

- **校片蓝** (`proof-blue`): 选中 Scene 的内描边、当前工作区下划线与 Agent 运行状态；它是操作反馈，不是大面积品牌填充。
- **深校片蓝** (`proof-blue-deep`): Scene 边码、选择三角和纸面上的次级校片记号。

### Secondary

- **只读琥珀** (`readonly-amber`): 胶片边码、只读标签、诊断代码、停止与不可用状态；稀少使用让边界保持可信。
- **连接绿** (`connected-green`): 连接正常、控制文件有效、Speech 可用与宿主验证成功等肯定状态。

### Neutral

- **暗房黑** (`darkroom`): 应用最外层画布。
- **机身黑** (`shell`): 工作台框体与稳定结构面。
- **胶片黑** (`film`): 接触表外框，让边码与纸面亮度成立。
- **舞台黑** (`stage`): 主工作区地面与 Agent 结果凭证单元。
- **状态台黑** (`panel`): 项目检查、空/错误面与 Agent 验证框体。
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

**The Proofing Blue Rule.** 校片蓝只表示当前工作区、焦点或显式选择；选中状态还必须拥有线框、位置标记或文字语义。

**The Amber Boundary Rule.** 琥珀只说明胶片边码、只读边界与需要注意的诊断，不把整块面板染成警告色。

**The Lit Content Rule.** 最高亮度留给 Scene 内容纸面；暗房中的导航、检查和 Composer 不得与接触表争夺亮度。

**The Status Shape Rule.** 任务状态必须同时有文字与形状：蓝色实心圆点是运行，绿色实心圆点是连接或成功，琥珀方形轮廓是停止或不可用。

## Typography

**Display Font:** Narracut Display（自托管 Ubuntu Sans 可变窄体子集，回退到 sans-serif）

**Body Font:** Noto Sans SC（回退到 Source Han Sans SC、Microsoft YaHei、sans-serif）

**Label/Mono Font:** ui-monospace（回退到 monospace）

**Character:** 展示字像胶片盒与校片章上的工业窄体，只出现在品牌、Scene 编号、校片边码和只读标签。中文 UI sans 承担叙事阅读，等宽体承担 Project ID、路径、表头、时长与机器状态；三者不能互换成装饰。

### Hierarchy

- **Display** (800, responsive clamp, tight tracking): 只用于 Narracut 品牌字样。
- **Headline** (720, compact line-height): 用于 Scene 大编号及同等级校片标记。
- **Title** (680, responsive clamp, generous line-height): Scene Narration 主内容，最多两行时仍保持稳定扫描节奏。
- **Body** (400, compact UI size): 项目检查、说明、空状态与次级正文。
- **Label** (700, uppercase where Latin, tracked): Scene 表头、Asset/Speech 标签与胶片边码。
- **Control** (650): 工作区标签及同等级的明确操作文字。

### Named Rules

**The Three Voices Rule.** 展示字负责身份与校片，中文 UI sans 负责内容，等宽体负责机器事实；不要用展示字排中文长文，也不要用等宽体承担 Narration。

## Elevation & Depth

系统通过灯箱明度、内嵌暗边和少量结构阴影建立深度。胶片框使用重环境阴影压入暗房；纸面使用柔和背光与内阴影模拟光箱玻璃；Agent 验证台与常驻导航、检查栏一样依赖色阶和分隔线，不为任务或结果制造漂浮卡片。移动端项目检查是唯一明显横向悬浮层。

### Shadow Vocabulary

- **胶片压暗** (`0 26px 70px rgba(0,0,0,.58), inset 0 1px rgba(255,255,255,.045), inset 0 0 0 5px rgba(0,0,0,.18)`): 只用于整张接触印样框。
- **纸面背光** (`0 0 34px rgba(241,243,235,.34), inset 0 0 36px rgba(68,76,72,.14)`): 只用于背光接触表。
- **键盘焦点** (`0 0 0 5px rgba(78,136,223,.24)`): 与 `2px` 可见轮廓共同出现，不能代替轮廓。
- **移动检查抽屉** (`-18px 0 45px rgba(0,0,0,.48)`): 仅在窄屏项目检查打开时出现。

接触表在允许动效时以 `420ms`、`cubic-bezier(.16,1,.3,1)` 从稍暗状态亮起；`prefers-reduced-motion` 下完全不播放。除这一处首现材料反馈外，系统没有装饰性持续动画。

**The One Lightbox Rule.** 每个工作区最多有一个背光主面；不要把普通面板、按钮或提示也做成发光玻璃。

## Shapes

形状语言接近切割纸张与机械框体。Scene 行、标签和大部分结构保持直角；文件夹图标与“停止/不可用”指示使用紧凑 `2px` 圆角，抽屉与 Agent 操作按钮使用 `6px`，Composer 字段使用 `7px`，整张胶片框和状态面使用 `9px`。运行、连接与成功指示是圆形；选中 Scene 的小边码使用轻微旋转和不规则椭圆圈记，作为人工校片痕迹。

**The Cut Edge Rule.** 圆角用于可触控控件和整张材料框，不用于把每条 Scene、每项检查或每段文字包成卡片。

## Do's and Don'ts

### Do:

- **Do** 让项目身份先于工作区工具，并在移动端继续展示 Project ID 与连接文字。
- **Do** 让 Narration 成为每条 Scene 的视觉主内容；Asset 只显示 identity、path 或 placeholder。
- **Do** 用蓝色线框、位置标记和程序化状态共同表达选择，让焦点与选择保持独立。
- **Do** 把琥珀限制在胶片边码、只读与诊断提醒，把绿色限制在真实有效状态。
- **Do** 保持项目检查在桌面端为窄侧栏、移动端为抽屉，并让 Composer 在所有尺寸下可见。
- **Do** 以内嵌本地字体与 raster 建立材料感，同时尊重 `prefers-reduced-motion`。
- **Do** 把 Agent 宿主验证保持为单任务状态台，并在桌面双列、窄屏单列之间保留状态、结果与操作顺序。
- **Do** 用文字与形状共同表达 Agent 状态，且只在有界状态变化时更新可见面板与隐藏播报。

### Don't:

- **Don't** 把接触表改成缩略图优先画廊、多轨时间线或通用 IDE 三栏。
- **Don't** 让表格工作区以外的 Agent、Preview、Render Program、Composer 或桥接层获得 Scene 写入口；不要加入 Asset 删除/重命名/转码/裁切、TTS、Render 或 Legacy 项目入口。
- **Don't** 用颜色作为选择、连接、有效或只读状态的唯一信号。
- **Don't** 让键盘焦点自动选中 Scene，或在工作区切换时丢失所选 Scene、历史、保存队列与会话草稿。
- **Don't** 隐藏 Composer、禁用草稿输入或启用尚未接入的发送；会话保留范围与发送禁用原因必须同时可见且可被辅助技术读取。
- **Don't** 把 Agent 工作区做成聊天，或展示 Render Program 源码、对话、推理、工具日志与历史。
- **Don't** 自动替换正在查看的 Preview、用临时反馈覆盖过期提醒，或在 `FRAME` 确认前更新已提交时间与播放 Scene。
- **Don't** 用 Agent 状态或验证结果暗示 Scene、Render Program 或任何项目文件已被写入。
- **Don't** 引入霓虹 AI、玻璃拟态、渐变品牌面或大量圆角卡片，稀释暗房与接触印样的材料逻辑。

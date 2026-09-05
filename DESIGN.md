---
name: Narracut VNext Workbench
description: 以暗房接触印样组织 Project VNext Scene 剪接、Asset 引用、只读预览与 Codex 宿主验证的 Operate 工作台。
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

这套系统的触感来自材料与结构，不来自拟物控件堆叠。接触表是表格工作区的主工作面，项目检查是窄侧台；Agent 工作区则是一块克制的单任务 Codex 宿主验证状态台，以任务与结果并置的工业仪表感延续暗房世界，不模仿聊天。Composer 是固定在灯箱下沿的多行批注槽，可记录会话草稿，发送按钮保持禁用并说明创作发送尚未启用。

当前交付把表格工作区扩展为可编辑剪接台：操作轨、原位 Narration 编辑、Asset 子视图和保存状态明确哪些内容正在改变。Asset 列继续只做摘要，导入、有序引用和只读预览在既有项目检查层与独立预览层中完成，不抢占接触表主面。Speech 单元格以文字与形状展示生成阶段，并提供单 Scene 生成、重试或取消；项目 TTS 输出契约在右侧检查台的子视图中配置，移动端沿用抽屉。Video Brief 从项目检查进入独立的原始 Markdown 编辑层，拥有与 Scene 分离的历史、保存状态和冲突决策。Agent、Render Program 与 Composer 不改写 Scene 的边界仍持续可见。Agent 状态台只展示当前任务、连接、有界结果与可用操作，不展示候选 Render Program、对话或日志历史。

**Key Characteristics:**

- 黑色暗房外壳包围背光暖白接触表，主内容拥有最高亮度与面积。
- Scene 是连续校片行；Narration 居主列，Asset 仅显示身份、路径或占位。
- Asset 引用管理复用项目检查侧台；内容预览仅在独立只读层中出现，关闭后回到原操作位置。
- Speech 动作用紧凑的校片控件贴在接触表行内；成功状态显示实际时长，项目检查同时显示半开帧窗口与 Render 就绪性。
- TTS 配置复用右侧检查台，不建立新的全局设置页；凭据缺失、会话存储限制和输出规格在同一决策点说明。
- 蓝色校片线同时配合三角指示与圈记边码表达选择，不只依赖颜色。
- Agent 工作区是单任务验证台：桌面任务/结果双列，窄屏顺序叠放，不出现对话气泡。
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

## Layout

首屏采用四层固定结构：项目身份栏（`68px`）、工作区标签（`54px`）、可伸缩主工作区、底部 Composer（桌面 `138px`、窄屏 `164px`）。主工作区是接触表与 `320px` 项目检查的两列布局；舞台内边距为 `14px`，胶片框左右内边距为 `24px`。接触表上沿增加 `56px` Scene 操作轨。Scene 行仍固定为 `112px` 高，桌面列依次为 Scene、Narration、Asset、Speech，Narration 获得唯一弹性主列；原位多行编辑器在行内滚动，不改变虚拟列表节奏。

在 Agent 工作区，桌面主面以 `.82fr / 1.18fr` 并置“临时任务状态”与“验证结果”，底部操作栏固定承载开始验证、停止和继续。在 `900px` 以下，项目检查收窄到 `280px`，Scene/Speech 最右列隐藏，Agent 的任务与结果改为单列；在 `700px` 以下，Project ID 移到独立第二行，连接文字继续可见，项目检查改为从右侧打开的抽屉，Composer 仍固定在底部。移动端接触表保留 Scene、Narration 与 Asset 三列并允许横向内容自然裁切；Agent 工作区以单一纵向滚动容器承载标题、任务状态、验证结果、操作按钮和成片 Preview 占位；内层舞台与状态台自然展开，避免多层滚动截断内容。

键盘焦点只表示下一次操作位置，不能自动改变所选 Scene。Scene 行通过显式激活改变选择；移动端抽屉按钮以 `aria-expanded` 表达状态，打开时焦点进入关闭按钮，关闭后回到抽屉入口。Composer 通过 `aria-describedby` 说明会话保留范围与发送未接入原因。Asset 预览是 `aria-modal` 对话层，Tab 焦点不离开该层，Escape 和关闭按钮都停止媒体并把焦点还给原预览按钮。

**The Identity Before Tools Rule.** 所有尺寸都保留文件夹、Project ID 与连接文字的稳定位置；不要为了节省空间把身份藏进菜单。

**The Contact Sheet Dominance Rule.** 在承载 Scene 检查的表面，接触表始终是面积与亮度的主角，检查栏只提供上下文，不扩张成同权三栏 IDE。

**The One Task Stack Rule.** Agent 工作区只为一个当前宿主验证任务编排状态、结果与操作；窄屏改变排布而不增加导航或历史层级。

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

## Components

### Project Identity Rail

顶部身份栏以深色分格承载品牌、文件夹、完整 Project ID 与连接状态。Project ID 使用等宽体并在超长时省略中段；移动端把它移到第二行而不是隐藏。连接状态同时使用绿色灯和“连接正常”文字。

### Workspace Tabs

标签是稳定双工作区切换，不是胶囊筛选。默认态使用暗房灰；当前态使用白字、底部 `3px` 校片蓝线和极淡蓝色底。按钮最小高度不低于 `44px`，键盘焦点使用可见蓝色轮廓与光环。标签通过 `aria-controls` 对应两个常驻 `tabpanel`，用 `hidden` 切换可见性；方向键及 Home/End 只移动焦点，Enter/Space 或点击才激活。切换保留所选 Scene、Scene 历史、保存队列和 Composer 输入节点，不把焦点移动当成选择或播放命令。

### Contact Sheet

胶片框包含顶部/底部边码、背光纸面和校片角标。纸面表头固定为等宽大写标签；真实纸张与胶片 raster 只增强触感，不削弱边界、文字对比或滚动性能。两张 raster 和展示字体由 MCP Resource 转换为 data URI，禁止运行时网络请求。

### Scene Action Rail

操作轨是接触表的一部分，不是全局应用栏。桌面左侧保留“新增 Scene”，中部承载复制、上下移动、移动到位置与删除，右侧固定 Undo、Redo 与文字/形状并用的保存状态。窄屏只直接保留新增、Undo/Redo 和保存状态，其余动作收进清楚命名的“Scene 操作”面板；长距离移动始终提供数字位置输入，不依赖精细拖拽。Undo/Redo 快照共享受控历史语义，并以 `24 MiB` 内存预算淘汰最旧步骤，不能因合法的 `10 MiB` 项目上限放大为无界内存占用。

### Scene Rows

Scene 行是签名组件：大号 Scene 编号、独立拖拽手柄、校片边码、最多两行 Narration、Asset identity/path/placeholder 与 Speech 状态按固定列对齐。默认纸面、悬停纸面和选中纸面保持同一材料；选中态叠加 `3px` 蓝色内框、左侧蓝色三角与圈记边码。行容器使用分组语义，Scene 选择按钮与拖拽、编辑、展开控件保持同级，避免嵌套交互角色吞掉读屏语义。选择不自动开始编辑；“编辑 Narration”把主列原位切换为固定高度多行编辑器，并提供展开编辑。Scene 列表使用固定行高虚拟窗口，不能把固定 `112px` 节奏改成内容高度瀑布流。

### Project Inspection

检查栏是暗色窄侧台，以点、文字和状态词同时表达控制文件有效性。当前 Scene 显示 Narration 与 Scene ID、Asset 数量、Speech 状态；“管理项目 Asset”和 Scene Asset 单元格在同一侧台中进入子视图，不新增第三列。Agent 工作区复用只读项目检查，不暴露 Scene、Asset、TTS 或 Video Brief 写入口；修改建议通过“前往表格工作区修改 Scene”返回接触表手工处理。窄屏时它成为可关闭抽屉，并保留最小 `44px` 关闭目标。

### Video Brief Editor

Video Brief 是从项目检查进入的专注原始 Markdown 编辑层，不提供预览、富文本、表单字段或格式化工具。标题栏只承载独立 Undo/Redo、保存状态与关闭；编辑内容在停顿或失焦后串行保存，关闭不清空本地内容与历史，也不改变当前 Scene。所有尺寸都使用单列纸面编辑器，触控目标不低于 `44px`。

外部改动发生时，编辑层必须同时保留 BASE、LOCAL 与 DISK：桌面并排展示三份只读证据，窄屏用具名标签切换；合并结果保持可编辑。出口严格限制为“提交合并结果”“放弃 LOCAL 并载入 DISK”“导出 LOCAL”，不提供强制覆盖。Brief 字节变化后，Agent 状态台以琥珀方形和文字标记当前 Render Program 待复核，并明确既有 Preview 不会被隐式替换。

### Asset Reference Panel

Scene Asset 面板以 Scene 编号、截断 ID、引用计数和“导入并绑定 / 添加已有 Asset”开始。引用列表按 Scene 顺序显示文件名、项目相对路径、可用状态、预览、上下移动、数字位置和解除引用。错误状态使用琶珀方形与文字，不仅依赖颜色。项目 Asset 视图以相对路径搜索，只显示有界的前 100 项并标记当前引用、已绑定和暂未绑定。

### Asset Preview

只读预览层以暗房黑遮罩和单一媒体舞台覆盖工作台；图像与视频使用 `contain` 而不裁切，音频/视频保持原生控件且默认暂停。文件名、项目路径和大小是稳定事实栏；未知格式、文件不可用与悬空 ID 分别用明确文字呈现。移动端尺寸近乎满屏，但仍保留明确关闭操作。

### Agent Host Validation

Agent 工作区是单任务 Codex 宿主验证状态台，不是聊天界面。顶部只说明固定、只读的宿主任务和协议边界；中部桌面端以任务/结果双列呈现，在 `900px` 以下转为单列。只显示当前任务身份、线程连接、所选 Scene、有界验证结果与最小诊断；不展示候选 Render Program、预览、对话、推理、工具日志或历史列表。界面必须明说验证不会修改项目内容。状态台之后的成片 Preview 区域只显示播放位置与候选新鲜度尚未接入的占位说明，不呈现真实成片媒体或审核结果，也不与独立 Asset 只读预览混淆。

### Agent Status Ledger

状态台以紧凑分隔行展示任务状态、线程连接、当前 Scene、Task ID 与 Thread。每个可变状态同时提供简短文字和符合“蓝圆运行、绿圆连接/成功、琥珀方形停止/不可用”的形状。状态刷新应先比对有界状态，无变化时不重绘；变化时仅更新 Agent 任务区域，保留 Scene 编辑器、Composer 输入节点与只读媒体宿主；独立隐藏的 `role="status"` / `aria-live="polite"` 区域只播报简短状态与细节，不复读整个面板。

### Agent Validation Actions

底部操作栏只包含“开始验证”、“停止”和“继续”，按任务状态启用唯一可用的下一步。开始与继续使用深校片蓝实心按钮，停止使用控件黑与琥珀文字，禁用态降低对比并保留标签。所有按钮最小高度为 `44px`；在 `700px` 以下改为纵向、通栏排列。

### Composer Draft

Composer 始终固定在底部，以同一个原生多行 `textarea` 承载本次会话草稿；高度 `64px`、内边距 `8px 12px`，沿用暗色控件面与纸白文字。输入、选区、粘贴和中文组合输入不因工作区切换或 Agent 刷新中断。发送按钮保持原生 `disabled`；两条可见说明持续表达“草稿仅保留在本次会话，创作发送尚未启用”和“Composer 不编辑 Scene，请使用接触表”，通过 `aria-describedby` 与输入及发送边界建立关联。草稿不落盘，也不触发项目写入或 Agent 调用。

### Empty, Loading, and Invalid States

状态面沿用暗房框体与 `9px` 圆角，不切换到通用白卡。可写空项目的主操作是“新增第一个 Scene”；只读检查仍明确显示零 Scene。加载态使用三条静态骨架；无效项目展示稳定错误代码与有界诊断，并重复说明 Narracut 未修改目录。保存失败提供重试且保留合法内存修改；冲突和身份失效停止自动保存，并用文字、方形状态记号与颜色共同表达。

## Do's and Don'ts

### Do:

- **Do** 让项目身份先于工作区工具，并在移动端继续展示 Project ID 与连接文字。
- **Do** 让 Narration 成为每条 Scene 的视觉主内容；Asset 只显示 identity、path 或 placeholder。
- **Do** 用蓝色线框、位置标记和程序化状态共同表达选择，让焦点与选择保持独立。
- **Do** 把琥珀限制在胶片边码、只读与诊断提醒，把绿色限制在真实有效状态。
- **Do** 保持项目检查在桌面端为窄侧栏、移动端为抽屉，并让 Composer 在所有尺寸下可见。
- **Do** 以内嵌本地字体与 raster 建立材料感，同时尊重 `prefers-reduced-motion`。
- **Do** 把 Agent 工作区保持为单任务状态台，并在桌面双列、窄屏单列之间保留状态、结果与操作顺序。
- **Do** 用文字与形状共同表达 Agent 状态，且只在有界状态变化时更新可见面板与隐藏播报。

### Don't:

- **Don't** 把接触表改成缩略图优先画廊、多轨时间线或通用 IDE 三栏。
- **Don't** 让表格工作区以外的 Agent、Preview、Render Program、Composer 或桥接层获得 Scene 写入口；不要加入 Asset 删除/重命名/转码/裁切、TTS、Render 或 Legacy 项目入口。
- **Don't** 用颜色作为选择、连接、有效或只读状态的唯一信号。
- **Don't** 让键盘焦点自动选中 Scene，或在工作区切换时丢失所选 Scene、历史、保存队列与会话草稿。
- **Don't** 隐藏 Composer、禁用草稿输入或启用尚未接入的发送；会话保留范围与发送禁用原因必须同时可见且可被辅助技术读取。
- **Don't** 把 Agent 工作区做成聊天，或展示候选 Render Program、预览、对话、推理、工具日志与历史。
- **Don't** 用 Agent 状态或验证结果暗示 Scene、Render Program 或任何项目文件已被写入。
- **Don't** 引入霓虹 AI、玻璃拟态、渐变品牌面或大量圆角卡片，稀释暗房与接触印样的材料逻辑。

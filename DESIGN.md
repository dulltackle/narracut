---
name: Narracut
description: 以冷静、精密的本地工作台组织 AI 驱动的类口播视频制作。
colors:
  canvas: "#f6f8fb"
  surface: "#ffffff"
  surface-mint: "#eef8f6"
  ink: "#0f172a"
  ink-secondary: "#334155"
  muted: "#64748b"
  border: "#dbe4ee"
  border-soft: "#edf2f7"
  accent: "#00a3a6"
  accent-hover: "#008f92"
  success: "#15803d"
  warning: "#b45309"
  danger: "#e11d48"
typography:
  display:
    fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif'
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.55
    letterSpacing: "normal"
  headline:
    fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif'
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.55
    letterSpacing: "normal"
  title:
    fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif'
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.55
    letterSpacing: "normal"
  body:
    fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: '"SF Mono", ui-monospace, Menlo, monospace'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.55
    letterSpacing: "normal"
  control:
    fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif'
    fontSize: "12px"
    fontWeight: 650
    lineHeight: 1.55
    letterSpacing: "normal"
rounded:
  micro: "8px"
  sm: "12px"
  md: "18px"
  lg: "28px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-mint}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  filter-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "12px"
    height: "44px"
  pane:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0"
---

# Design System: Narracut

> **Legacy 设计说明。** 本文件描述固定脚本表、Player 与 Inspector 的独立浏览器工作台，仅服务现有 V3 实现；Project VNext 的 Codex 插件双工作区不继承兼容、迁移或只读打开承诺。当前产品边界见 [`docs/spec/project-vnext.md`](./docs/spec/project-vnext.md)。

## Overview

**Creative North Star: "精密叙事台"**

Narracut 的界面是一张为脚本、画面和 Speech 精确装配而设的工作台。冷纸灰承托纯净工作面，墨蓝黑建立清晰的信息骨架，自动化青绿只在需要行动与聚焦的位置出现；整体克制、可靠、精密、平静。

系统以高密度但有秩序的操作空间为主，而不是营销式展示空间。边框、轻微色调差和稳定的网格帮助创作者同时掌握脚本表、Player 与 Inspector；圆润的组件削弱传统专业软件的生硬感，但不牺牲状态辨识和工作效率。它明确避免炫技式 AI 科幻感，也避免传统专业剪辑软件的视觉噪声。

**Key Characteristics:**

- 冷灰白工作面、墨蓝黑信息骨架与稀少的青绿色行动信号。
- 脚本表优先的高密度布局，Player 与 Inspector 作为并列工作上下文。
- 中文正文与等宽元数据组成双重信息声音。
- 圆润、稳健、直接的控件，以及清楚但克制的状态反馈。
- 分层为主、悬浮为辅；常驻界面保持平整，临时层才获得明显深度。

## Colors

调色板以低彩度冷中性色建立持续工作的安静背景，用自动化青绿标识行动与聚焦，并用独立语义色表达状态。

### Primary

- **自动化青绿** (`#00a3a6`)：用于主按钮、焦点轮廓、进度与少量关键引导，是系统唯一的品牌行动色。
- **深自动化青绿** (`#008f92`)：只用于自动化青绿控件的悬停状态，保持同一色相内的反馈。

### Neutral

- **墨蓝黑** (`#0f172a`)：正文、高优先级标题、品牌标记和关键控制的主墨色。
- **石板蓝灰** (`#334155`)：次级正文、字段标签和较低层级的操作信息。
- **元数据灰** (`#64748b`)：路径、时间码、表头、辅助说明和未激活状态。
- **冷纸灰** (`#f6f8fb`)：应用画布与控件分组的底层背景。
- **纯净工作面** (`#ffffff`)：面板、表格行、输入框和按钮的默认表面。
- **薄荷雾面** (`#eef8f6`)：选中行、温和悬停和与自动化青绿相关的轻量强调表面。
- **冷界线** (`#dbe4ee`)：面板、输入框、按钮和结构分区的主边界。
- **柔界线** (`#edf2f7`)：表格行与低优先级分隔线，避免高密度区域产生噪声。

### Semantic Status

- **完成绿** (`#15803d`)：已保存、已完成和成功状态。
- **提醒琥珀** (`#b45309`)：可继续工作但需要注意的提示与只读警告。
- **阻断玫红** (`#e11d48`)：保存失败、文件缺失与阻断性错误。

### Named Rules

**The One Accent Rule.** 自动化青绿只用于行动、焦点和进度；不要把它铺成大面积背景或装饰色。

**The Semantic Status Rule.** 绿、琥珀和玫红只表达状态含义，不承担品牌装饰或布局分区。

## Typography

**Display Font:** Microsoft YaHei（回退到 微软雅黑、sans-serif）  
**Body Font:** Microsoft YaHei（回退到 微软雅黑、sans-serif）  
**Label/Mono Font:** SF Mono（回退到 ui-monospace、Menlo、monospace）

**Character:** 中文无衬线体保持高密度工作区的清晰和稳定；等宽字体把路径、编号、表头、时间与技术状态从叙事内容中分离出来。系统不使用装饰性展示字体。

### Hierarchy

- **Display** (700, 32px, line-height 1.55): 加载、错误等居中状态页的主标题。
- **Headline** (700, 28px, line-height 1.55): 空状态的主要引导标题。
- **Title** (700, 16px, line-height 1.55): 面板标题与对话框局部标题。
- **Body** (400, 14px, line-height 1.55): Narration、正文和主要界面文字。
- **Label** (600, 12px, line-height 1.55): 表头、路径、编号、时间码和紧凑元数据；默认使用等宽字体。
- **Control** (650, 12px, line-height 1.55): 紧凑按钮、字段标签和 Inspector 控件内容。

### Named Rules

**The Dual Voice Rule.** 叙事内容使用中文无衬线体，结构与机器状态使用等宽体；不要用更多字体制造层级。

## Layout

应用当前是最小宽度 `1180px` 的桌面 Web 工作台，不在窄屏上重排，而是保留完整操作结构并允许画布滚动。顶部栏固定为 `64px` 高；主体以 `12px` 外边距和 `12px` 间距组成不对称网格：脚本表占左侧并跨越两行，右侧上下分别是 Player 与 Inspector。列宽使用约 `1.46fr / 0.78fr`，行高使用约 `0.9fr / 1.1fr`。

布局采用紧凑的 `4 / 8 / 12 / 16px` 基础节奏，`20 / 24 / 28 / 32px` 只用于对话框、状态页和更大区块。主要控件最小高度为 `44px`；表格行高为 `88px`，面板头高为 `54px`。密度来自稳定的表格和并列上下文，而不是压缩触控目标。

**The Workspace First Rule.** 新功能优先进入脚本表、Player、Inspector 或任务抽屉的既有职责，不为单一功能轻易增加新的顶层导航或独立画布。

## Elevation & Depth

系统采用“分层为主，悬浮为辅”的混合策略。常驻面板依靠白色工作面、冷界线和一圈同色细描边与背景分离，顶部栏保持无阴影；Player 画布、对话框、抽屉和关键状态卡使用统一的环境阴影，明确表示它们脱离了常驻工作平面。

### Shadow Vocabulary

- **环境悬浮** (`0 20px 50px rgba(15, 23, 42, 0.1)`): 用于 Player 预览画布、Popover、Modal、任务抽屉与居中状态卡。
- **结构描边** (`0 0 0 1px #dbe4ee`): 用于常驻 Pane，在不制造悬浮感的前提下强化边界。
- **焦点光环** (`0 0 0 4px rgba(0, 163, 166, 0.24)`): 仅与焦点轮廓一起出现，表达键盘操作位置。

### Named Rules

**The Flat-by-Default Rule.** 常驻工作面保持平整；只有真正覆盖、浮出或承载预览内容的元素才能使用环境阴影。

## Shapes

系统通过逐级圆角表达层级：紧凑图标与行内控件使用 `8px`，输入框、预览画布和状态标签使用温和的 `12px`，常驻面板与抽屉使用 `18px`，对话框和大型状态卡使用 `28px`。主要按钮、过滤器、计数器和进度轨使用 `9999px` 胶囊形；播放按钮是完整圆形。Caption 的 `4px` 圆角和左侧硬边是面向视频画布的功能性例外。

**The Radius Hierarchy Rule.** 圆角大小随容器层级增加；不要随机混用圆角，也不要把常驻大面板做成胶囊形。

## Components

### Buttons

- **Shape:** 主要与次要按钮采用胶囊形（`9999px`），最小高度 `44px`，水平内边距 `16px`；图标按钮固定为 `44 × 44px`。
- **Primary:** 自动化青绿背景、白色文字和同色边框；用于当前上下文中唯一的主要动作。
- **Hover / Focus:** 主按钮悬停变为深自动化青绿；所有按钮用 `2px` 青绿色轮廓与 `4px` 半透明焦点光环；按下时仅下移 `1px`。
- **Secondary / Ghost:** 白色表面与冷界线，悬停时进入薄荷雾面；文本按钮移除可见边框但保留相同高度。

### Chips

- **Style:** 过滤器外层使用冷纸灰胶囊底，内部选项保持 `44px` 高；选中项为纯净工作面、墨蓝黑文字和一圈冷界线。
- **State:** 未选中项使用元数据灰，不用自动化青绿填充，以免与主动作竞争。

### Cards / Containers

- **Corner Style:** 常驻 Pane 使用 `18px`，大型状态卡和对话框使用 `28px`。
- **Background:** 主体为纯净工作面，面板头使用接近白色的冷调分层面。
- **Shadow Strategy:** 常驻 Pane 只用结构描边；浮层和预览引用环境悬浮阴影。
- **Border:** `1px` 冷界线；内部低优先级分隔采用柔界线。
- **Internal Padding:** 面板头和 Inspector 通常为 `16px`；对话框为 `24–32px`。

### Inputs / Fields

- **Style:** 白色背景、`1px` 冷界线和 `12px` 圆角；Inspector 输入使用 `12px` 内边距，Narration 行内编辑器静止时边框透明。
- **Focus:** 青绿色 `2px` 轮廓、`1px` offset 和统一焦点光环。
- **Error / Disabled:** 禁用控件降低到 `0.45` 透明度；错误内容使用阻断玫红及浅玫红状态面。

### Navigation

顶部栏是 `64px` 高的三段网格：左侧项目身份与保存状态，中间历史操作，右侧任务与渲染动作。背景接近不透明白色，底部只保留一条冷界线；项目路径使用等宽小字并截断，不通过阴影制造层级。

### Scene Table

Scene 表是系统的签名组件。表头固定、使用 `12px` 等宽元数据；行高 `88px`，Narration 占据最大列宽。悬停进入冷纸灰，选中进入薄荷雾面并在首列增加 `3px` 墨蓝黑内侧标记。状态、Asset 和 Speech 以紧凑的主次两行信息呈现。

Scene 序号同时是明确的“选择并跳转预览”按钮：指针或键盘激活后更新编辑上下文，并把 Player 跳到该 Scene 起点。键盘焦点只表示下一次操作的位置，不能在单纯获得焦点时改变选中 Scene、Inspector 上下文或播放位置。

### Player

Player 是紧凑、低噪声的项目级预览器，不扩展成完整时间线。它始终同时标明“选中 Scene”和“正在播放 Scene”：前者决定 Inspector 的编辑上下文，后者由当前播放帧决定；播放跨过 Scene 边界时不得擅自改选中项。

预览画面严格保持 `16:9`，在可用舞台空间内等比缩放，不拉伸、不裁成其他比例；沿用 `12px` 圆角、深墨蓝预览底和环境阴影。播放按钮使用墨蓝黑圆形，项目时间码使用等宽字体；预览区域内部的 Caption 与 Subtitle 遵循视频输出规范，而不是复用编辑器面板样式。

Draft、Speech 缺失、资源加载和阻断错误必须在 Player 上下文内可见，但用紧凑状态块或画布内状态页控制噪声。关键状态同时使用图标、文字与程序化语义，不只依赖颜色；可见状态文字不得小于 `12px`。Draft 明确说明仅供预览，阻断错误则给出直接原因与恢复方向。

## Do's and Don'ts

### Do:

- **Do** 保留脚本表优先、Player 与 Inspector 并列的工作台结构。
- **Do** 用自动化青绿标识主要动作、焦点与进度，并让它在每个视图中保持稀少。
- **Do** 用等宽字体区分路径、编号、时间码、表头和机器状态。
- **Do** 保持 `44px` 最小操作高度，并通过 `8 / 12 / 16px` 节奏组织高密度界面。
- **Do** 用边框和色调建立常驻层次，只在浮层、预览与关键状态卡上使用环境阴影。
- **Do** 区分 Scene 的编辑选择与 Player 的播放位置，并让键盘用户通过显式 Scene 序号按钮执行选择和跳转。

### Don't:

- **Don't** 引入霓虹渐变、发光装饰或炫技式 AI 科幻视觉。
- **Don't** 模仿传统多轨剪辑器，把 Scene 工作流重新视觉化为复杂时间线。
- **Don't** 用多个高彩度品牌色争夺注意力，或把状态色当作装饰色。
- **Don't** 给每个面板和控件增加阴影；常驻工作面必须保持平整。
- **Don't** 为了“简洁”隐藏关键的 Asset、Speech、状态或 Render-ready 上下文。
- **Don't** 让焦点移动隐式切换 Scene，也不要把 Player 扩展成多轨或完整时间线。

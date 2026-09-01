---
name: Narracut VNext Workbench
description: 以暗房接触印样组织 Project VNext Scene 检查的只读 Codex 插件工作台。
colors:
  darkroom: "#090d0e"
  shell: "#101516"
  film: "#050707"
  line: "#303738"
  paper: "#f1f3eb"
  paper-hover: "#e4e8df"
  paper-selected: "#fafbf5"
  ink: "#171b1b"
  muted: "#909997"
  proof-blue: "#4e88df"
  proof-blue-deep: "#245da9"
  readonly-amber: "#d89a3d"
  connected-green: "#67c477"
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
  composer-disabled:
    backgroundColor: "#171d1f"
    textColor: "#a7afac"
    rounded: "{rounded.field}"
    padding: "0 18px"
    height: "48px"
---

# Design System: Narracut VNext Workbench

## Overview

**Creative North Star: "暗房接触印样台"**

Narracut 的高频 Operate 表面是一座数字暗房：深黑框体压低环境噪声，一张背光纸面把有序 Scene 排成可快速扫描的接触印样。项目身份先于工具，Narration 先于缩略图，校片状态先于装饰；蓝色套准线、琥珀边码和真实纸张/胶片纹理让界面属于影像创作者的世界，而不是通用 IDE 或 SaaS 后台。

这套系统的触感来自材料与结构，不来自拟物控件堆叠。接触表是主工作面，项目检查是窄侧台，Composer 是固定在灯箱下沿的批注槽。当前只读交付把不可用能力留在可见位置并解释原因；视觉不能暗示文件选择、编辑、Asset Preview、TTS、Render 或 Agent 创作已经可用。

**Key Characteristics:**

- 黑色暗房外壳包围背光暖白接触表，主内容拥有最高亮度与面积。
- Scene 是连续校片行；Narration 居主列，Asset 仅显示身份、路径或占位。
- 蓝色校片线同时配合三角指示与圈记边码表达选择，不只依赖颜色。
- 琥珀只用于胶片边码、只读与诊断提示；绿色只用于明确的有效与连接状态。
- 自托管窄体展示字、中文 UI sans 与等宽标签构成三种受控声音。
- 纸张与胶片 raster 由插件以内嵌 data URI 提供，界面不依赖网络材料。

## Colors

调色板在近黑暗房与低彩度纸面之间建立强明度反差，蓝色负责校片选择，琥珀和绿色只承担窄而明确的状态语义。

### Primary

- **校片蓝** (`proof-blue`): 选中 Scene 的内描边、当前工作区下划线与高优先级检查状态；它是操作反馈，不是大面积品牌填充。
- **深校片蓝** (`proof-blue-deep`): Scene 边码、选择三角和纸面上的次级校片记号。

### Secondary

- **只读琥珀** (`readonly-amber`): 胶片边码、只读标签与诊断代码；稀少使用让边界保持可信。
- **连接绿** (`connected-green`): 连接正常、控制文件有效与 Speech 可用等肯定状态。

### Neutral

- **暗房黑** (`darkroom`): 应用最外层画布。
- **机身黑** (`shell`): 工作台框体与稳定结构面。
- **胶片黑** (`film`): 接触表外框，让边码与纸面亮度成立。
- **结构线** (`line`): 暗色区域的边界与分隔。
- **背光纸白** (`paper`): Scene 接触表的主阅读面。
- **纸面悬停** (`paper-hover`): 可激活 Scene 行的指针反馈。
- **选中纸白** (`paper-selected`): 被校片线框住的当前 Scene。
- **纸面墨色** (`ink`): Narration、Scene 编号与纸面主要信息。
- **暗房灰** (`muted`): 未激活标签、次级状态与低优先级元数据。

### Named Rules

**The Proofing Blue Rule.** 校片蓝只表示当前工作区、焦点或显式选择；选中状态还必须拥有线框、位置标记或文字语义。

**The Amber Boundary Rule.** 琥珀只说明胶片边码、只读边界与需要注意的诊断，不把整块面板染成警告色。

**The Lit Content Rule.** 最高亮度留给 Scene 内容纸面；暗房中的导航、检查和 Composer 不得与接触表争夺亮度。

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

首屏采用四层固定结构：项目身份栏（`68px`）、工作区标签（`54px`）、可伸缩主工作区、底部 Composer（`102px`）。主工作区是接触表与 `320px` 项目检查的两列布局；舞台内边距为 `14px`，胶片框左右内边距为 `24px`。Scene 行固定为 `112px` 高，桌面列依次为 Scene、Narration、Asset、Speech，Narration 获得唯一弹性主列。

在 `900px` 以下，项目检查收窄到 `280px`，Scene/Speech 最右列隐藏；在 `700px` 以下，Project ID 移到独立第二行，连接文字继续可见，项目检查改为从右侧打开的抽屉，Composer 仍固定在底部。移动端接触表保留 Scene、Narration 与 Asset 三列并允许横向内容自然裁切；它不退化成卡片流或缩略图画廊。

键盘焦点只表示下一次操作位置，不能自动改变所选 Scene。Scene 行通过显式激活改变选择；移动端抽屉按钮以 `aria-expanded` 表达状态，Composer 通过 `aria-describedby` 解释禁用原因。

**The Identity Before Tools Rule.** 所有尺寸都保留文件夹、Project ID 与连接文字的稳定位置；不要为了节省空间把身份藏进菜单。

**The Contact Sheet Dominance Rule.** 在承载 Scene 检查的表面，接触表始终是面积与亮度的主角，检查栏只提供上下文，不扩张成同权三栏 IDE。

## Elevation & Depth

系统通过灯箱明度、内嵌暗边和少量结构阴影建立深度。胶片框使用重环境阴影压入暗房；纸面使用柔和背光与内阴影模拟光箱玻璃；常驻导航和检查栏依赖边线而不是漂浮卡片。移动端项目检查是唯一明显横向悬浮层。

### Shadow Vocabulary

- **胶片压暗** (`0 26px 70px rgba(0,0,0,.58), inset 0 1px rgba(255,255,255,.045), inset 0 0 0 5px rgba(0,0,0,.18)`): 只用于整张接触印样框。
- **纸面背光** (`0 0 34px rgba(241,243,235,.34), inset 0 0 36px rgba(68,76,72,.14)`): 只用于背光接触表。
- **键盘焦点** (`0 0 0 5px rgba(78,136,223,.24)`): 与 `2px` 可见轮廓共同出现，不能代替轮廓。
- **移动检查抽屉** (`-18px 0 45px rgba(0,0,0,.48)`): 仅在窄屏项目检查打开时出现。

接触表在允许动效时以 `420ms`、`cubic-bezier(.16,1,.3,1)` 从稍暗状态亮起；`prefers-reduced-motion` 下完全不播放。除这一处首现材料反馈外，系统没有装饰性持续动画。

**The One Lightbox Rule.** 每个工作区最多有一个背光主面；不要把普通面板、按钮或提示也做成发光玻璃。

## Shapes

形状语言接近切割纸张与机械框体。Scene 行、标签和大部分结构保持直角；文件夹图标使用紧凑 `2px` 圆角，抽屉按钮使用 `6px`，Composer 字段使用 `7px`，整张胶片框和状态面使用 `9px`。连接灯是圆形；选中 Scene 的小边码使用轻微旋转和不规则椭圆圈记，作为人工校片痕迹。

**The Cut Edge Rule.** 圆角用于可触控控件和整张材料框，不用于把每条 Scene、每项检查或每段文字包成卡片。

## Components

### Project Identity Rail

顶部身份栏以深色分格承载品牌、文件夹、完整 Project ID 与连接状态。Project ID 使用等宽体并在超长时省略中段；移动端把它移到第二行而不是隐藏。连接状态同时使用绿色灯和“连接正常”文字。

### Workspace Tabs

标签是稳定双工作区切换，不是胶囊筛选。默认态使用暗房灰；当前态使用白字、底部 `3px` 校片蓝线和极淡蓝色底。按钮最小高度不低于 `44px`，键盘焦点使用可见蓝色轮廓与光环。

### Contact Sheet

胶片框包含顶部/底部边码、背光纸面和校片角标。纸面表头固定为等宽大写标签；真实纸张与胶片 raster 只增强触感，不削弱边界、文字对比或滚动性能。两张 raster 和展示字体由 MCP Resource 转换为 data URI，禁止运行时网络请求。

### Scene Rows

Scene 行是签名组件：大号 Scene 编号、校片边码、最多两行 Narration、Asset identity/path/placeholder 与 Speech 状态按固定列对齐。默认纸面、悬停纸面和选中纸面保持同一材料；选中态叠加 `3px` 蓝色内框、左侧蓝色三角与圈记边码。Scene 列表使用固定行高虚拟窗口，不能把固定 `112px` 节奏改成内容高度瀑布流。

### Project Inspection

检查栏是暗色窄侧台，以点、文字和状态词同时表达控制文件有效性。当前 Scene 显示 Narration 与 Scene ID、Asset 数量、Speech 状态；只读段落以琥珀展示标签、以灰色正文解释影响。窄屏时它成为可关闭抽屉，并保留最小 `44px` 关闭目标。

### Disabled Composer

Composer 始终固定在底部。输入框保持原生 `disabled`，可见文案说明后续启用，第二行明确“当前交付只支持只读检查”，并通过 `aria-describedby` 与输入建立程序化关联。锁形图标辅助表达状态，但不能替代文字。

### Empty, Loading, and Invalid States

状态面沿用暗房框体与 `9px` 圆角，不切换到通用白卡。空项目明确显示零 Scene 仍可只读检查；加载态使用三条静态骨架；无效项目展示稳定错误代码与有界诊断，并重复说明 Narracut 未修改目录。

## Do's and Don'ts

### Do:

- **Do** 让项目身份先于工作区工具，并在移动端继续展示 Project ID 与连接文字。
- **Do** 让 Narration 成为每条 Scene 的视觉主内容；Asset 只显示 identity、path 或 placeholder。
- **Do** 用蓝色线框、位置标记和程序化状态共同表达选择，让焦点与选择保持独立。
- **Do** 把琥珀限制在胶片边码、只读与诊断提醒，把绿色限制在真实有效状态。
- **Do** 保持项目检查在桌面端为窄侧栏、移动端为抽屉，并让 Composer 在所有尺寸下可见。
- **Do** 以内嵌本地字体与 raster 建立材料感，同时尊重 `prefers-reduced-motion`。

### Don't:

- **Don't** 把接触表改成缩略图优先画廊、多轨时间线或通用 IDE 三栏。
- **Don't** 在当前只读表面加入写操作、文件选择器、Asset Preview、TTS、Render、导入或 Legacy 项目入口。
- **Don't** 用颜色作为选择、连接、有效或只读状态的唯一信号。
- **Don't** 让键盘焦点自动选中 Scene，或在工作区切换时丢失所选 Scene。
- **Don't** 隐藏或启用 Composer；禁用原因必须同时可见且可被辅助技术读取。
- **Don't** 引入霓虹 AI、玻璃拟态、渐变品牌面或大量圆角卡片，稀释暗房与接触印样的材料逻辑。

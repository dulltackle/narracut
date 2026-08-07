# 03 — Visual Type 四件套的视觉定稿

Type: prototype
Status: open
Blocked by: —

## Question

`Title` / `Video` / `Video+Caption` / `EndCard` 这四个 Visual Type 分别长什么样？

用 `/prototype` 出 1920×1080 静态帧给用户挑，一轮一轮收敛。每个 type 要定的：

- **Title**（开场/章节标题板，无素材）：构图、字号层级、要不要副标题、背景是纯色/渐变/还是模糊的素材帧。
- **Video**（全屏实拍 + 字幕）：字幕位置、字号、描边还是底衬、安全区、单行还是可两行、超长句怎么办。
- **Video+Caption**（实拍上叠加步骤标题或重点提示）：叠加物放哪、多大、支持几种（步骤序号？警示？参数标注？）。**关键问题：叠加物和底部字幕会不会打架**——两者同时出现时的版面关系必须一起定，不能各定各的。
- **EndCard**（结尾）：放什么内容。

同时产出 **design token 第一版**：字体族（中文字体是硬约束，参见 02 号票第 6 条）、字号阶梯、主色/强调色/警示色、间距阶梯、圆角、动效时长与缓动曲线。

V1 不做主题切换，但渲染器内部**必须**按 token 组织——现在把颜色字号硬写进组件，将来抽 Theme 就得重写全部组件。

## 约束

- 场景是中文仪器操作演示，观感要求「清楚」优先于「炫」。
- 只有 Cut，所以 Scene 之间是硬切——每个 type 的入场动效要能在硬切下自然成立。
- 素材是实拍画面，叠加的文字必须在各种画面亮度下都可读。

## 产出

静态帧图片 + `.scratch/video-script-v1/research/design-tokens.md`，结论回填本票 `## Answer`。
定下来的字段清单（比如 Title 有 headline/subheadline，Video+Caption 有 caption 文本和类型）要写清楚，06 号票的 DSL schema 直接依赖它。

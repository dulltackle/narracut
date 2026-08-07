# 视频脚本表格生成器 PRD

**项目代号：Video Script**
**产品形态：Web SaaS**
**核心技术方向：Remotion + Video DSL**

---

# 1. 产品概述

## 1.1 产品定义

Video Script 是一个以“脚本句子”为基本编辑单位的视频生成工具。

用户无需操作传统视频编辑器中的复杂时间线，而是在一个脚本表格中，为每一句旁白定义：

* 旁白内容
* 句子时长
* 画面内容
* 图片 / 视频素材
* 布局
* 动画
* 转场

系统将这些结构化数据保存为统一的 Video DSL，并通过 Remotion 实时预览及最终渲染为视频。

核心产品理念：

> 用户编辑的不是“时间线”，而是“脚本及其对应视觉”。

---

# 2. 背景与问题

传统视频制作通常采用 Timeline 驱动的编辑模型。

用户需要理解：

* 视频轨道
* 音频轨道
* 图层
* Trim
* Ripple Edit
* Keyframe
* Transition
* Clip
* Timeline Zoom
* Snap

对于大量以“解说 + 配套视觉”为核心的视频，这种编辑模型过于复杂。

典型视频包括：

* AI 产品介绍
* SaaS 产品 Demo
* 新闻解说
* 知识视频
* 财经内容
* 商业分析
* 产品发布视频
* 数据报告
* 教程
* 社交媒体短视频

此类视频通常天然具有以下结构：

> 一句话旁白 → 一个核心视觉表达。

例如：

| 旁白               | 对应视觉            |
| ---------------- | --------------- |
| AI 正在改变软件开发      | 大标题 + AI 图形     |
| 过去完成这个任务需要 3 个小时 | 3 Hours 数据动画    |
| 现在只需要 10 分钟      | 10 Minutes 对比动画 |
| 效率提升超过 18 倍      | 18× Metric 动画   |

因此，可以用“脚本表格”取代传统 Timeline，显著降低视频制作门槛。

---

# 3. 产品目标

## 3.1 V1 核心目标

让用户可以：

1. 创建一个视频项目。
2. 将视频拆解为一句一句脚本。
3. 为每一句脚本定义视觉。
4. 在右侧实时预览完整视频。
5. 点击任意脚本行，快速定位到对应画面。
6. 调整素材、视觉类型、布局和动画。
7. 最终稳定渲染出 MP4 视频。

V1 的核心价值验证是：

> 用户是否愿意通过“脚本表格”而不是传统 Timeline 完成一条完整视频。

---

# 4. 非目标

V1 不计划成为 Premiere、CapCut 或剪映的替代品。

以下能力不属于 V1：

* 专业多轨 Timeline
* 任意视频轨道编辑
* Keyframe 编辑器
* 多机位剪辑
* 专业音频混音
* 色彩校正
* Mask
* Chroma Key
* Motion Tracking
* 专业 VFX
* After Effects 式自由合成
* 任意 Layer 拖拽式编辑
* Frame-level 微调

V1 应避免过早进入传统视频编辑器的复杂度。

---

# 5. 目标用户

## 5.1 核心用户

### 内容创作者

制作：

* YouTube 视频
* Bilibili 视频
* TikTok / Reels
* 知识视频
* 商业解说

核心诉求：

> 快速将脚本转化成视觉完整的视频。

---

### 产品营销团队

制作：

* 产品发布视频
* SaaS Demo
* 功能介绍
* 产品更新
* Campaign 视频

核心诉求：

> 让营销人员基于产品素材快速组合出品牌一致的视频。

---

### AI 内容团队

批量制作：

* 新闻
* 财经
* 科技
* 教育
* 榜单
* 数据报告

核心诉求：

> 视频结构必须标准化、可自动化、可规模化生成。

---

### 企业内容团队

制作：

* 培训
* 内部沟通
* 数据汇报
* 产品介绍
* 客户案例

核心诉求：

> 非专业视频编辑人员也能制作统一风格的视频。

---

# 6. 核心产品模型

系统整体分为三层。

```text
用户编辑层
Script Table
      ↓
数据层
Video DSL
      ↓
执行层
Remotion Renderer
```

其中：

## Script Table

用户真正操作的产品。

## Video DSL

整个项目的唯一 Source of Truth。

## Remotion

负责：

* 实时 Preview
* Scene Rendering
* Animation
* Composition
* 最终视频输出

Remotion 代码不是用户项目数据。

---

# 7. 核心用户流程

## 7.1 创建视频

用户进入 Dashboard。

点击：

**New Video**

设置：

* Project Name
* Aspect Ratio
* Resolution
* FPS
* Theme

V1 默认：

* 16:9
* 1920 × 1080
* 30 FPS

后续支持：

* 9:16
* 1:1

---

# 8. 主编辑器

主编辑器采用左右布局。

```text
┌──────────────────────────────────────────────────┐
│ Toolbar                                          │
├─────────────────────────┬────────────────────────┤
│ Script Table            │ Video Preview          │
│                         │                        │
│ 01 旁白                 │                        │
│    Visual               │                        │
│                         │                        │
│ 02 旁白                 │                        │
│    Visual               │                        │
│                         │                        │
│ 03 旁白                 │                        │
│    Visual               │                        │
├─────────────────────────┴────────────────────────┤
│ Render                                           │
└──────────────────────────────────────────────────┘
```

建议默认宽度：

左侧约 55%。

右侧约 45%。

---

# 9. Script Table

## 9.1 基础字段

每一行代表一个 Scene。

V1 必须包含：

| 字段             | 类型     | 说明       |
| -------------- | ------ | -------- |
| #              | Number | Scene 顺序 |
| Narration      | Text   | 旁白文本     |
| Duration       | Number | Scene 时长 |
| Visual Type    | Select | 视觉类型     |
| Visual Content | Text   | 画面主要内容   |
| Asset          | Media  | 图片 / 视频  |
| Layout         | Select | 布局模板     |
| Motion         | Select | 动效       |
| Transition     | Select | 转场       |

---

# 10. Scene 编辑

点击某一行后，进入选中状态。

右侧 Preview 自动跳转至：

```text
scene.startTime
```

用户可展开 Scene Inspector。

Inspector 包括：

### Content

* Narration
* Headline
* Subheadline
* Body
* Value
* Label

### Visual

* Visual Type
* Asset
* Background
* Icon

### Layout

* Layout Preset
* Alignment
* Media Position

### Motion

* Entrance
* Emphasis
* Exit
* Transition

### Timing

* Duration
* Start Padding
* End Padding

---

# 11. Visual Type

V1 不允许用户自由写任意 Remotion 组件。

平台提供有限的 Visual Type。

建议 V1 首批支持：

### Hero

适合：

* 开场
* 核心观点
* 产品标题

---

### Kinetic Text

适合：

* 重要句子
* 强调关键词
* 情绪表达

---

### Image

单图片展示。

---

### Video

单视频素材展示。

---

### B-Roll

背景视频 + 字幕 / 标题。

---

### Screen Demo

产品截图、录屏或 UI Demo。

---

### Metric

例如：

* 10×
* +237%
* $1.2M
* 99.9%

---

### Comparison

例如：

```text
Before       After
3 Hours      10 Minutes
```

---

### Quote

人物引用或观点。

---

### Chart

V1 可先支持：

* Bar
* Line
* Pie

---

### End Card

结尾 CTA。

---

# 12. Layout Preset

每个 Visual Type 可以拥有有限 Layout。

例如 Image：

* Full Screen
* Left Media
* Right Media
* Center Card
* Background Image

Metric：

* Center
* Left
* Right
* Metric + Description

Screen Demo：

* Browser Frame
* Floating Window
* Full Screen
* Device Mockup

原则：

> Layout 是有限状态，而不是自由 Canvas。

---

# 13. Motion Preset

V1 使用 Preset，而不是 Keyframe Editor。

建议支持：

### Entrance

* None
* Fade
* Fade Up
* Fade Down
* Slide Left
* Slide Right
* Scale In
* Spring In

### Emphasis

* None
* Pulse
* Scale
* Highlight
* Number Count

### Exit

* None
* Fade
* Scale Out
* Slide

---

# 14. Transition

Scene 之间 V1 支持：

* Cut
* Cross Fade
* Slide
* Wipe
* Zoom

默认：

```text
Cut
```

---

# 15. Video DSL

Video DSL 是系统最核心的数据资产。

所有编辑操作最终转换为 DSL。

建议采用 JSON Schema + TypeScript + Zod。

---

# 16. DSL 设计原则

DSL 必须：

### 与 Remotion 解耦

禁止在 DSL 中出现：

```text
React Component Name
CSS Code
JS Code
Remotion API
```

例如不应该保存：

```json
{
  "component": "MetricSceneV3"
}
```

应该保存：

```json
{
  "visual": {
    "type": "metric"
  }
}
```

具体由哪个 React Component 渲染，应由 Renderer 决定。

---

### 可版本升级

DSL 必须包含：

```text
version
```

例如：

```json
{
  "version": "1.0"
}
```

未来可以迁移：

```text
1.0 → 1.1 → 2.0
```

---

### 可序列化

整个项目必须能够：

```text
JSON.stringify(project)
```

并完整恢复。

---

### 可 AI 生成

LLM 应能够输出合法 DSL。

---

### 可验证

所有 DSL 在保存或渲染之前必须通过 Schema Validation。

---

# 17. Remotion Renderer

Renderer 负责：

```text
Video DSL
     ↓
Scene Renderer
     ↓
Remotion Components
     ↓
Composition
```

---

# 18. Scene 时间计算

Scene 默认顺序播放。

例如：

```text
Scene 1: 4s
Scene 2: 6s
Scene 3: 3s
```

则：

```text
Scene 1
0 → 4

Scene 2
4 → 10

Scene 3
10 → 13
```

系统自动计算：

```ts
startTime
startFrame
durationInFrames
```

这些字段建议运行时计算，不作为用户主要维护字段。

避免数据不一致。

---

# 19. Preview

使用：

```text
@remotion/player
```

提供实时预览。

Preview 必须支持：

* Play
* Pause
* Seek
* Restart
* Current Time
* Total Duration

---

# 20. Script ↔ Preview 联动

这是 V1 最重要交互之一。

## Table → Preview

点击任意 Scene：

```text
Scene
 ↓
calculateStartFrame()
 ↓
Player.seekTo()
```

播放器自动跳转。

---

## Preview → Table

播放器播放到某 Scene 时：

对应 Script Row 自动 Highlight。

例如：

```text
00:23.5
```

属于 Scene 6，则：

```text
Scene 6 Active
```

用户始终知道：

> 当前看到的画面对应哪句话。

---

# 21. 编辑实时预览

用户修改：

```text
Visual Type
```

例如：

```text
Image
↓
Metric
```

Preview 应在合理延迟内刷新。

用户修改：

```text
Headline
```

应即时反映。

目标体验：

> 编辑脚本表格就像编辑视频本身。

---

# 22. Asset Management

V1 支持上传：

* PNG
* JPG
* WebP
* MP4
* WebM
* WAV
* MP3

素材上传后进入 Project Asset Library。

每个 Asset 应保存：

* URL
* Type
* Dimensions
* Duration
* File Size
* Created At

---

# 23. Asset Picker

用户点击 Asset：

打开 Asset Picker。

支持：

* Upload
* Recent
* Project Assets

V1 不需要建设复杂 DAM 系统。

---

# 24. Narration

用户输入旁白文本后，可点击按钮将旁白交给 TTS 模型转化为语音，并自动将音频时长填入 Scene 的 Duration 字段。

流程：

```text
输入旁白
   ↓
点击 Generate Voice
   ↓
TTS 模型生成语音
   ↓
音频时长自动回填 Duration
   ↓
Scene Timing 自动更新
```

## 使用步骤

1. 用户在 Narration 字段输入旁白文本。
2. 点击 Scene 行内的「生成语音」按钮。
3. 系统调用 TTS 模型生成音频并绑定到该 Scene。
4. 根据音频时长自动更新 Scene 的 Duration 字段。
5. 后续修改旁白文本后，可再次点击生成，时长随之更新。

## 设计要点

* 未生成语音前，Duration 由用户手动填写。
* 生成语音后，Duration 自动以音频时长为准，避免音画不同步。
* 生成期间显示加载状态，生成完成后展示试听入口，用户可试听确认。
* 用户仍可手动覆盖 Duration（如留白或加转场），手动修改后以用户输入为准。

---

# 25. TTS

TTS 是 V1 核心能力，作为 Narration 的语音生成通道。

支持流程：

```text
Narration Text
 ↓
Generate Voice（点击按钮触发）
 ↓
TTS
 ↓
Audio
 ↓
Duration（自动回填）
 ↓
Scene Timing
```

未来可支持：

* Voice
* Speed
* Language
* Emotion

---

# 26. 字幕

V1 可提供基础字幕。

字幕直接使用：

```text
Narration.text
```

字幕位置：

* Bottom
* Center

字幕 Style：

* Default
* Highlight

第一版不需要逐字 Karaoke。

逐字字幕放入 P1。

---

# 27. Undo / Redo

编辑器必须支持：

```text
Undo
Redo
```

至少覆盖：

* 文本修改
* Visual Type
* Layout
* Motion
* Asset
* Scene 新增
* Scene 删除
* Scene 排序

建议以 DSL Patch 或状态快照实现。

---

# 28. Scene 操作

每行支持：

* Add Above
* Add Below
* Duplicate
* Delete
* Move Up
* Move Down

建议支持 Drag & Drop 排序。

Scene 顺序即视频顺序。

---

# 29. 自动保存

所有 DSL 修改自动保存。

显示状态：

```text
Saving...
Saved
Error
```

建议 debounce：

```text
500–1000ms
```

---

# 30. Render

用户点击：

**Render Video**

系统创建 Render Job。

状态：

```text
Queued
Rendering
Completed
Failed
```

完成后显示：

* Preview
* Download
* File Size
* Duration
* Resolution

---

# 31. Render Architecture

建议：

```text
Frontend
   ↓
Create Render Job
   ↓
Backend
   ↓
Queue
   ↓
Remotion Renderer
   ↓
Object Storage
   ↓
MP4
```

渲染不应阻塞 Web Request。

---

# 32. Render Snapshot

每次 Render 必须保存当时 DSL Snapshot。

例如：

```text
project_version
render_snapshot
```

这样用户编辑项目后，历史 Render 仍然可以准确追溯。

---

# 33. Render History

V1 建议保留最近 Render。

字段：

* Created At
* Resolution
* Duration
* Status
* Download

---

# 34. Error Handling

渲染失败时必须告诉用户具体 Scene。

例如：

```text
Render Failed

Scene 12
Asset could not be loaded.
```

而不是只显示：

```text
Render failed.
```

建议 Error Model：

```ts
{
  sceneId,
  errorCode,
  message
}
```

---

# 35. 空状态

新项目默认创建示例 Scene：

```text
Welcome to Video Script
```

并显示：

```text
Add your first scene
```

避免用户面对完全空白页面。

---

# 36. AI 能力

V1 核心编辑体验不依赖 AI。

但是 DSL 必须从第一天就设计成 AI Friendly。

P1 可以加入：

**Generate Visual**

用户选择一行：

```text
Narration:
Our revenue increased by 237%.
```

AI 输出：

```json
{
  "visual": {
    "type": "metric",
    "headline": "Revenue Growth",
    "value": "+237%"
  },
  "layout": {
    "preset": "center"
  },
  "motion": {
    "entrance": "scale-in",
    "emphasis": "number-count"
  }
}
```

AI 不直接生成 React。

---

# 37. AI Visual Suggestion

未来按钮：

```text
✨ Suggest Visual
```

AI 可以提供 3 个方案：

```text
A
Metric
+237%

B
Bar Chart
Revenue Growth

C
Comparison
Previous Year vs Current Year
```

用户选择一个。

这样 AI 是：

> Video Director

而不是：

> Runtime Code Generator

---

# 38. 推荐技术架构

Frontend：

```text
Next.js
React
TypeScript
```

表格：

```text
TanStack Table
```

状态：

```text
Zustand
```

Schema：

```text
Zod
```

Preview：

```text
@remotion/player
```

Renderer：

```text
Remotion
```

Backend：

```text
Node.js
```

Database：

```text
PostgreSQL
```

Storage：

```text
S3 / R2 compatible storage
```

Queue：

```text
Redis Queue
或
Cloud Queue
```

---

# 39. V1 成功标准

如果 Beta 用户能够在不学习 Timeline 的情况下：

1. 创建一条 1–3 分钟视频；
2. 使用 10–30 个 Scene；
3. 为每句话设置视觉；
4. 使用 Preview 调整；
5. 成功 Render；

则产品核心假设成立。

---

# 40. V1 功能优先级

## P0 — 必须上线

* Project 创建
* Script Table
* Scene CRUD
* Scene 排序
* Narration
* Duration
* Visual Type
* Visual Content
* Asset
* Layout Preset
* Motion Preset
* Transition
* Video DSL
* DSL Validation
* Remotion Renderer
* Remotion Player
* Table → Preview Seek
* Preview → Table Active Scene
* TTS（旁白转语音 + Duration 自动回填）
* Auto Save
* Undo / Redo
* Asset Upload
* MP4 Render
* Render Status
* Download

---

## P1 — 上线后增强

* 字幕
* AI Visual Suggestion
* AI Script → Scenes
* Word Timestamp
* Render History
* Theme Presets
* Brand Kit
* Stock Asset Search
* Basic Charts

---

## P2 — 后续版本

* Collaborative Editing
* Comments
* AI Rewrite Scene
* AI Generate Image
* AI Generate Video
* Template Marketplace
* Advanced Timeline
* Audio Waveform
* Multiple Audio Tracks
* Keyframes
* Custom Scene Components
* Plugin System

---

# 41. 关键产品原则

## 原则一

**Sentence First**

所有编辑围绕句子。

---

## 原则二

**Structured, not Free-form**

优先结构化选项，不开放无限自由度。

---

## 原则三

**Preview = Render**

Preview 和最终 Render 必须使用同一 Renderer。

避免：

```text
预览一种效果
导出另一种效果
```

---

## 原则四

**DSL First**

所有产品能力围绕 DSL。

---

## 原则五

**AI edits DSL**

AI 修改 DSL，而不是直接修改 Remotion Runtime Code。

---

## 原则六

**Progressive Complexity**

V1：

```text
Script Table
```

未来：

```text
Script Table
+
Simple Timeline
```

再未来：

```text
Advanced Timeline
```

不要第一天复制 Premiere。

---

# 42. 核心验收场景

## Case 1

用户创建项目。

添加：

```text
10 Scenes
```

为每 Scene 输入 Narration。

成功保存。

---

## Case 2

用户将 Scene 3：

```text
Visual Type
Image
```

修改为：

```text
Metric
```

右侧 Preview 正确刷新。

---

## Case 3

点击 Scene 7。

Player 自动跳到 Scene 7 的第一帧。

---

## Case 4

播放器播放到 Scene 8。

Script Table 自动 Highlight Scene 8。

---

## Case 5

用户拖动 Scene 10 到 Scene 4。

时间计算自动更新。

Preview 顺序立即变化。

---

## Case 6

用户上传图片。

图片出现在 Asset Library。

绑定 Scene 后 Preview 正常显示。

---

## Case 7

用户点击 Render。

系统创建 Render Job。

完成后可以下载 MP4。

---

## Case 8

用户 Render 后继续编辑。

旧 Render 保持不变。

新 Render 使用新的 DSL Snapshot。

---

# 43. 产品长期愿景

长期目标不是：

> 做一个更简单的 Premiere。

而是：

> 建立一种新的 Script-native Video Creation 工作流。

传统视频：

```text
Timeline
↓
Video
```

本产品：

```text
Idea
↓
Script
↓
Visual Plan
↓
Video DSL
↓
Video
```

未来 AI 可以参与：

```text
Idea
 ↓
AI Script
 ↓
AI Visual Director
 ↓
Human Review
 ↓
Video DSL
 ↓
Renderer
 ↓
Video
```

用户主要做：

```text
判断
修改
选择
审核
```

而不是：

```text
拖轨道
打关键帧
调整图层
```

---

# 44. 最终产品定位

一句话：

> **一个以脚本为中心、通过表格定义每一句视觉内容的视频生成器。**

产品核心竞争力不应该是 Remotion。

Remotion 是基础设施。

真正长期形成壁垒的是：

```text
Video DSL
+
Scene Library
+
Video Design System
+
AI Visual Director
+
Script-based Editing UX
```

其中最重要的是：

> **Video DSL 是系统的核心资产，Script Table 是用户的核心界面，Remotion 是稳定的执行引擎。**

---

# 45. V1 最终范围总结

V1 只需要完成一个闭环：

```text
创建项目
   ↓
输入脚本
   ↓
拆分 Scene
   ↓
定义每句视觉
   ↓
选择素材
   ↓
选择 Layout / Motion
   ↓
实时 Preview
   ↓
调整
   ↓
Render
   ↓
MP4
```

只要这个闭环足够流畅，就已经形成一个清晰、独立且具有差异化的视频创作产品。

# 内置文字表现 Preset V1

> **Legacy，已被 [ADR-0008](../adr/0008-project-vnext-normative-architecture.md) 与 [`project-vnext.md`](./project-vnext.md) 替代。** 本文件只冻结 Project DSL V3 的旧表现，不属于当前规范；Project VNext 不兼容或自动迁移 Text Preset，也不继承固定 Composition。

本文件冻结 `@1` Preset 的视觉和时间语义。改变现有 ID 的任意数值会破坏旧项目的确定性；需要调整时必须发布新版本 ID。

## 固定输出与安全边界

- Composition：1920×1080、30fps、Scene 间 `cut`。
- 可见内容安全边距：四边 80px。
- Text Block 使用显式 `border-box` 盒模型；以下宽高都包含内边距，确保 Player 与独立 Renderer bundle 不受宿主 CSS 影响。超出高度时可等比缩小，最低为 70%；仍溢出则阻止最终渲染。
- Subtitle 独立固定在底部安全区，不受以下 Style 或 Motion 影响。
- Logo 固定在右上安全区，不参与 Scene Text Block 布局。

## Project Theme

| ID | 默认 Style | 默认 Motion | 强调色 | 字体 |
| --- | --- | --- | --- | --- |
| `narracut/default@1` | `narracut/panel@1` | `narracut/fade@1` | `#00A3A6` | `narracut/noto-sans-cjk-sc@1` |

## Text Style

所有尺寸均为 1920×1080 Composition 中的像素；字号依次为 label / title / body / item。

| ID | 名称 | x, y | 宽 × 最大高 | 内边距 / 圆角 | 对齐 | 字号 | 面板底色 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `narracut/panel@1` | 均衡面板 | 80, 80 | 960 × 680 | 64 / 28 | 左 | 34 / 76 / 44 / 40 | `rgba(15,23,42,.90)` |
| `narracut/lower-third@1` | 下部标题 | 80, 560 | 1160 × 260 | 48 / 16 | 左 | 34 / 64 / 40 / 36 | `rgba(15,23,42,.92)` |
| `narracut/spotlight@1` | 聚焦 | 180, 160 | 1560 × 620 | 72 / 28 | 中 | 40 / 104 / 48 / 42 | `rgba(15,23,42,.72)` |

每个 Style 都必须呈现 label、title、body 与 items；字段缺省时不保留空占位。20px 的字段间距随安全缩放比例变化。

## Text Motion

除 `none` 外，进场固定为 320ms，使用 `cubic-bezier(0.22, 1, 0.36, 1)`。在短 Scene 中，进场帧数不超过 Scene 总帧数的 25%。Text Block 进入后保持到 Cut，不单独退场。

| ID | 名称 | 初始透明度 | 初始位移 |
| --- | --- | --- | --- |
| `narracut/fade@1` | 淡入 | 0 | 0, 0 |
| `narracut/none@1` | 无进场 | 1 | 0, 0 |
| `narracut/rise@1` | 向上进入 | 0 | 0, +16px |
| `narracut/slide@1` | 横向进入 | 0 | -48px, 0 |

## 字体

`narracut/noto-sans-cjk-sc@1` 对应随应用自托管的 Noto Sans SC Variable（`@fontsource-variable/noto-sans-sc` 5.3.0），渲染使用 400、700、900 三个字重。Composition 在字体完成加载前保持 Remotion 渲染句柄；加载为空或失败时通过明确错误取消渲染，而不是等待通用超时。结构校验使用同一字体包发布的 Unicode ranges 对可见文字做码位检查，不覆盖字符以 warning 和 `U+XXXX` 定位。

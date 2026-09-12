# Codex 浅色视觉基准与右侧面板约束

研究对应[研究 Codex 浅色视觉基准与右侧面板约束](https://github.com/dulltackle/narracut/issues/102)，属于[Narracut 浅色工作台与交互改版决策地图](https://github.com/dulltackle/narracut/issues/101)。采集日期：2026-09-12 UTC；本地代码基线：`1e2955bb66a0644a9db00f047754c9ef1b0ba346`。仅调查事实，建议未经用户接受，不是已落地 DESIGN.md。

## 可交给原型的结论

以官方 Codex 浅色外观示例作为可追溯参照：白色内容表面、近黑文字、低对比中性边界、轻量图标与圆角控件。用户要求对齐视觉语言，而非复制宿主布局；Scene 内容仍由表格工作区编辑，创作输入仍在当前 Codex 对话。原型可以开始，但必须将模拟内容视口与真实宿主尺寸区分开。[官方外观设置](https://learn.chatgpt.com/docs/reference/settings#appearance)、[官方演示海报](https://learn.chatgpt.com/images/codex/video-posters/data-analysis-fraud-spike.webp)、[地图 Notes](https://github.com/dulltackle/narracut/issues/101)、[内容权威 ADR](https://github.com/dulltackle/narracut/blob/1e2955bb66a0644a9db00f047754c9ef1b0ba346/docs/adr/0009-separate-scene-content-and-render-program-authority.md)。

## 证据等级与观测限制

- **当前宿主实测值：暂无。** 本轮先查 `/opt`、桌面入口及本地 Codex 可访问资源，未取得可归属于当前 Codex 桌面应用的 UI 源码；其他应用的包不作替代。原生桌面控制未开放；内置浏览器返回不可用，Chrome 官方页观察超时。它们仅说明本轮采集路径的限制，不证明用户的工作台无法运行。
- **官方公开证据：可用。** 实际下载并查看下列两张公开演示海报；另读取官方 Settings 页面正文与其中外观示例 HTML。文档 URL 从 `developers.openai.com/codex/app/settings` 重定向至 ChatGPT Learn，示例仍显示 Codex 名称。网页演示组件属于官方说明资料，不等于当前安装版本的生产 CSS。
- **不推断版本。** 海报未标桌面应用版本，画面中的模型标签不能用作应用版本号；未获得当前宿主版本、缩放、DPR、字体自定义、面板拖拽位置或实际内容视口。下文不提供虚构的宿主固定宽度。

| 已实际查看的一手视觉证据 | 可见事实及边界 |
| --- | --- |
| [数据分析演示海报](https://learn.chatgpt.com/images/codex/video-posters/data-analysis-fraud-spike.webp) | 原图 1600×900。白色主画布、近黑无衬线标题、灰色线性工具图标、浅灰项目选择器、细边界圆角输入区域与附件标签。右下角深色区域为外部文件窗口，不能用来推断 Codex 面板或选中状态。 |
| [主动协作演示海报](https://learn.chatgpt.com/images/codex/video-posters/proactive-teammate-v2.webp) | 原图 1600×900。白底输入区域、轻边界和微弱阴影、灰色辅助动作、近黑圆形提交按钮；彩色 app 标签承担识别作用。只作视觉语法参照，不据此要求 Narracut 新增聊天框。 |

海报由[官方桌面应用入口](https://developers.openai.com/codex/app) HTML 中的 `video` 海报地址取得；保存的是公开来源及内容摘要，未采集或发布用户对话、账户资料或秘密工作台 URL。

## 官方示例值与未验证值

以下是 **官方外观设置示例值**，不是当前宿主观测值，也不是已经批准的 Narracut tokens。[来源：Settings / Appearance](https://learn.chatgpt.com/docs/reference/settings#appearance)。

| 项目 | 官方示例证据 | 使用边界 |
| --- | --- | --- |
| 基础颜色 | 背景 `#FFFFFF`、前景 `#0D0D0D`、强调色 `#0285FF` | 可作为浅色参照；用户能自定义，不能声称每个 Codex 窗口都相同。 |
| 字体与字号 | UI 字号 `14 px`；字体字段以 `-apple-system, BlinkM…` 开头；代码字体另设 | 未验证完整字体栈或中文最终字体，不能凭字段截断内容补全。 |
| 表面与边界 | 官方示例 HTML：白色设置表面，边界黑色约 `6.5%` 不透明度；示例表面圆角 `11 px` | 这是文档插图的构造数值，不证明生产组件统一使用它们。 |
| 辅助文字与选中项 | 示例辅助文字 `#626262`；选中的主题选项具有 `#F3F3F3` 背景与深色文字 | 只验证示例中的主题选择；不代表表格行、文本选区或键盘焦点。 |
| 常见控件与空间 | 示例字体字段高度 `31 px`、圆角 `11 px`；主题选择项高度 `28 px` | 插图会缩放，不把它们直接作为点击目标或全局间距规范。 |
| 菜单、焦点、禁用、错误 | 本次没有真实交互态证据 | 圆角、间距、焦点环与状态颜色的生产确值仍未知。 |

## 宿主嵌入与浅色边界

1. **当前生产入口是本地页面加内部 iframe。** 面板服务监听 loopback 动态端口；外层 HTML 创建宽度 `100%`、高度 `100dvh` 的工作台 iframe。宿主通过 browser 类型面板承载外层页面。业务 iframe 的尺寸来自当前浏览器内容区域，不能从操作系统屏幕宽度直接得出。[面板实现](https://github.com/dulltackle/narracut/blob/1e2955bb66a0644a9db00f047754c9ef1b0ba346/plugins/narracut/src/workbench-panel.ts)。
2. **请求右侧不等于证明右侧已显示。** 当前插件技能要求 `open_in_codex` 使用 `placement: right`，省略其他对话 ID。`prepared` 仅服务就绪，`queued` 仅展示排队；位置需要实际观察或用户确认。[工作台技能](https://github.com/dulltackle/narracut/blob/1e2955bb66a0644a9db00f047754c9ef1b0ba346/plugins/narracut/skills/narracut-workbench/SKILL.md)、[面板验收说明](https://github.com/dulltackle/narracut/blob/1e2955bb66a0644a9db00f047754c9ef1b0ba346/docs/workbench-panel.md)。
3. **没有已证实的像素宽度保证。** 本次可调用的 `open_in_codex` 工具只有位置和目标信息，没有面板宽高参数；官方 Browser 文档说明可在对话中预览本地应用，但未给固定内容宽度。原图 1600×900 也不是面板尺寸。[官方 Browser](https://learn.chatgpt.com/docs/browser)、本轮宿主工具声明、上述面板实现。
4. **宿主有固定浅色能力。** 官方设置提供 Light 选项以及颜色、UI/代码字体自定义；本轮没有修改用户宿主设置。这个能力不等于网站自动继承宿主 tokens。[官方 Settings](https://learn.chatgpt.com/docs/reference/settings#appearance)。
5. **Narracut 当前自行定义主题。** 工作台带 `color-scheme: dark` 元信息并内置暗色 CSS；外层连接／重试页面也自行绘制暗色背景。本次所查生产入口没有主题同步桥，因此只替换表格 CSS 会留下深色加载壳。浅色实现应覆盖这两层；主题消息订阅不是现有能力。[工作台 HTML](https://github.com/dulltackle/narracut/blob/1e2955bb66a0644a9db00f047754c9ef1b0ba346/plugins/narracut/workbench.html)、[面板实现](https://github.com/dulltackle/narracut/blob/1e2955bb66a0644a9db00f047754c9ef1b0ba346/plugins/narracut/src/workbench-panel.ts)。

## Narracut 原型建议值（待用户判断）

这些是研究者依据以上证据提出的试验起点，不是 Codex 原值或已决事项：

- 原型内容视口先采用 `1200×720 CSS px`，再用 `960×640 CSS px` 检查压缩状态；两个数字只标示模拟条件。“宽横屏”是用户使用场景，不能被偷换成宿主保证。进入真实面板后再记录内容视口、缩放及版本。
- 尝试白色背景、`#0D0D0D` 正文、`#626262` 次要文字、`#F3F3F3` 选中背景，沿用轻量线性图标。蓝色只作为适量动作／状态线索；不要给所有按钮涂蓝。
- UI 基准尝试 `14 px`，Narration 编辑区尝试 `15–16 px`、行高 `1.5`；中文字体必须实看。间距尝试 `4 / 8 / 12 / 16 / 24 px`，常用编辑按钮尝试 `32–36 px` 高；这些均为原型建议。
- 键盘焦点必须与 Scene 选择及文字选区分开测试；暂用清晰 `2 px` 焦点轮廓验证可见性，不宣称复刻 Codex 焦点。保留完整 Scene 内容权威，避免在工作台再造宿主聊天与导航外壳。

后续 Scene 原型票的判断重点：编辑内容是否占据主要空间，Narration、Asset、Speech 是否能在同一任务上下文完成，浅色加载／失败／空状态是否连贯。真实宿主外层观测仍是正式验收的一项，不影响先用明确标注的模拟视口讨论设计。

## 可复查采集指纹

下载均来自上述公开一手地址；原图保留于本次 `/tmp`，不把第三方图像复制进项目资产。远端资源可能更新，可用 SHA-256 核对是否仍是本轮版本：

| 来源 | SHA-256 |
| --- | --- |
| Settings HTML | `c5acdf523c02e41b42d192e9c769b2d7ce7fe3243fc9dd1dd246d8a5562e31e1` |
| 桌面入口 HTML | `2e8c582cc5d0a2411c687f533d7ea37ad5cfed81d6161eadb5f3974712e6687f` |
| 数据分析海报 | `f20e3d6ea27b57b69feba7c5561e8c3b27434b032e19b63b6b8ec64e47764374` |
| 主动协作海报 | `ff414e4c6d745080ac0bfd83ac118308e9a99372460bff928c7499820c1a98c0` |

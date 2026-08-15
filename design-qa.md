# Issue #23 设计 QA

## 对照目标

- 视觉真值：`design/23/workspace-loaded.html`、`workspace-empty.html`、`project-loading.html`、`project-error.html`、`project-readonly.html`
- 实现地址：本地回环服务的 SPA 根路由
- 浏览器路径：Browser 插件不可用，按前端测试回退规则使用 Playwright Chromium 151
- 视口：`1440 × 1000` CSS px，`deviceScaleFactor = 1`
- 像素：所有参考截图、实现截图均为 `1440 × 1000` PNG，无密度缩放
- 主题与状态：浅色桌面工作台；分别对照 13 Scene、空项目、加载中、结构失败、未知新版本只读状态

## 证据

### 全视图

- 已加载参考：`/tmp/narracut-reference-loaded.png`
- 已加载实现：`/tmp/narracut-implementation-loaded-final.png`
- 已加载同图对照：`/tmp/narracut-loaded-comparison-final.png`
- 空项目同图对照：`/tmp/narracut-empty-comparison-v2.png`
- 加载中同图对照：`/tmp/narracut-loading-comparison-v2.png`
- 加载失败同图对照：`/tmp/narracut-error-comparison-final.png`
- 未知版本同图对照：`/tmp/narracut-readonly-comparison-v2.png`

### 聚焦区域

- Player、Inspector 与顶部操作区：`/tmp/narracut-right-comparison.png`
- 采用聚焦对照是因为全视图中的字段字号较小；该区域用于复核面板比例、标题层级、控件高度、圆角、Player 画幅和 Inspector 字段密度。

## 必查保真面

- 字体与排版：实现沿用参考的 Microsoft YaHei / 微软雅黑与 SF Mono 回退；标题、正文、元数据字号层级、字重、行高和表格截断一致。13 Scene 的真实 Narration 比参考模拟文案更长，换行差异属于内容约束。
- 间距与布局：64px 顶栏、左侧脚本表和右侧 Player / Inspector 比例、12px 面板间距、54px 面板标题栏、44px 控件触达高度、圆角与边界节奏均与参考一致；各状态无溢出或持久控件遮挡。
- 颜色与视觉 token：背景、白色表面、暖青选中态、青色主操作、玫红错误、琥珀只读阻断和暖灰边框均复用参考色值。
- 图像质量与资产：页面没有用手写 SVG、CSS 绘图或 emoji 代替资产。标准图标来自 Phosphor；Player 只从 `/media/*` 使用项目真实 Asset。13 Scene 示例目录缺少实际 Asset 文件时明确显示文件不可用，不伪造参考图中的设备画面。
- 文案与内容：加载、结构失败、未知版本升级、原始字节保护和空项目原位创建文案均覆盖参考语义；列表展示 Project DSL 中全部 13 Scene，而非参考原型为排版缩减的 5 行或 3 行。

## 交互与浏览器验证

- 页面身份、非空首屏、无框架错误覆盖层均通过。
- 选中 Scene 02 后，Player Subtitle 与 Inspector 同步更新。
- 空项目粘贴三行 Narration 后创建 3 个 Scene，并经 `PUT /api/project` 写回。
- 加载状态在延迟项目响应时可见；无效 DSL 展开技术详情；未知新版本的编辑、任务与渲染入口禁用。
- 6 个浏览器用例均检查 `console.error`、`console.warn` 与 `pageerror`，结果为空；额外覆盖了两个防抖保存请求乱序返回时，最新 Narration 仍最后落盘。

## 对照迭代历史

1. 首轮发现 `[P1]` 空项目主内容偏离参考：只有通用“暂无 Scene”提示，缺少第一句引导、双入口和项目元数据上下文。已改为“从第一句讲解开始”、粘贴/逐条新增双入口、暗色空 Player 和项目元数据 Inspector。复核：`/tmp/narracut-empty-comparison-v2.png`。
2. 首轮发现 `[P2]` 未知版本 Inspector 只展示阻断原因，没有保留安全可读的 Scene 上下文。已补充首个 Scene 的 Narration 与 Visual Type 禁用字段。复核：`/tmp/narracut-readonly-comparison-v2.png`。
3. 首轮发现 `[P2]` 加载状态背景工作台过淡，三栏结构不可辨。已补齐脚本行、Player 画幅和 Inspector 字段骨架以及进度条。复核：`/tmp/narracut-loading-comparison-v2.png`。

## 最终发现

没有剩余可执行的 P0、P1 或 P2 差异。

### 后续精修（P3）

- 加载卡片暂不显示项目绝对路径，因为项目元信息与 DSL 当前并行请求；这不影响状态解释或核心流程。
- 已加载状态按真实 Project DSL 显示全部 13 Scene 和磁盘缺失诊断，因此内容密度高于参考中的 5 行静态排版示例。

final result: passed

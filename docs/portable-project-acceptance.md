# VNext 单一入口与可移动项目验收

交互工作区通过 Narracut Codex 插件使用。`pnpm start <目录>` 和 `pnpm open <目录>` 严格打开并检查 Project VNext，输出项目身份和插件入口说明后释放租约并退出；不再启动独立浏览器服务。`create`、`copy`、`recover` 的 `--open` 执行同样的检查和指引。CLI 不自动续跑 Agent。

旧浏览器、Visual/Preset、固定 Composition 及其专属端到端测试已经删除。`docs/spec/project-v1.md` 至 `project-v3.md` 和旧 schema 只保留为历史资料，不被生产模块或默认验收导入。`pnpm build` 构建插件；`pnpm test:schema` 检查严格 VNext。

## 真实旅程

运行 `pnpm test:e2e:public`（`pnpm test:e2e:real` 是同一路径的别名）。默认完整测试 `pnpm test` 也包含这条旅程。需要项目规定的 Linux 执行胶囊环境、固定 Chromium、ffmpeg 和 pnpm 工具链；环境不能运行胶囊时直接失败，不以宿主执行替代。

旅程使用插件原始 HTML、真实 MCP handler 和工作台按钮；CLI 以子进程运行。仅 Codex 远端线程生命周期采用可控协议替身。准备期的包下载响应来自本地精确 tarball；安装、静态检查、构建、Metadata、Preview、代表帧采集和最终编码全部运行真实工具链。

夹具包含三个 Scene、已有中文“你好”合成语音、PNG 图片、运动 WebM 视频、`resources/palette.json`、`color-name@2.0.0`、跨 Scene 六帧叠化和具名种子动画。语音来自仓库已有本地演示素材，不需要在线 TTS；各 Scene 使用同一段短语音以缩短验收耗时。color-name 的原始公开 npm 归档含 MIT 许可证，完整性摘要进入项目锁图与离线库。

关闭插件会销毁 Preview、Bundle 和安装缓存；随后移动完整目录，确认旧路径不存在。在新 handler 中重新打开，确认 Project ID 保持一致、Agent 不自动恢复、Preview 尚未构建。移动后 registry 请求一律拒绝并计数，构建不能补包或修改锁图。

Preview 与 Render 的同一 Bundle、输入、媒体和环境身份写入 `evidence.json`。Scene 首尾、中点、边界及 Transition/运动补点逐一比较；H.264 延用通道差 30、不同像素占比至多 0.012 的既有策略，不降低阈值。浏览器与胶囊均使用 ANGLE SwiftShader 软件图形后端，避免匹配环境内仍因 GPU/软件解码路径不同引入色差。输出还包含代表帧、解码帧、失败差异图及桌面/窄屏工作台截图。

`Html5Video` 通过 Runtime 的受限包装提供视频画面，强制静音，禁止事件、DOM 引用和非输入媒体地址；权威 Speech 仍由 Runtime 单独挂载。项目只控制视觉子树，不能注册 Root 或 Composition。

精确 Preview 的帧回执等待视频完成 seek 并具有可读画面；HTTP Preview 与胶囊快照重放使用同一字节范围响应，支持媒体的部分读取和 HEAD 请求。

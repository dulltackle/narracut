# 本地插件构建与安装检查

Narracut 使用根目录 `plugin.json` 和 `mcp.json` 的 Agent Plugins 格式。`.codex-plugin/plugin.json` 保留 Codex 展示元数据与版本编辑入口；`pnpm build:plugin` 从该文件生成根清单的身份字段。修改版本后必须重新构建再安装，避免两份版本不一致。

MCP 配置必须携带 Agent Plugins schema，并显式声明 `type: "stdio"`。当前 Codex 在此格式下解析 `${PLUGIN_ROOT}`，并将工作目录设为安装目录。旧版 `.mcp.json` 配置中的该占位符曾被原样传给 Node，导致入口找不到、握手失败和工具缺失。格式依据：[OpenAI 插件打包文档](https://developers.openai.com/plugins/build/plugins)。

`sharp` 含原生模块，不能只依赖单文件 JavaScript bundle。构建脚本从当前已安装依赖复制 `sharp`、必需依赖和可用的平台可选依赖到插件的 `node_modules/`，保留许可证文件并移除仓库符号链接。构建不联网、不运行依赖安装脚本；缺失必需包或版本冲突直接失败。该目录不进入 Git，安装插件前必须运行构建。原生依赖产物对应构建机器的平台，跨平台发布须在目标平台构建与检查。

验收命令：

- `pnpm test:plugin`：重新构建，在仓库外的中文、空格路径中启动插件，验证握手、启动器、工作台资源与 PNG 编解码，然后运行既有项目检查。独立子进程清空 `NODE_PATH` 和 `NODE_OPTIONS`，避免借用仓库依赖。
- `pnpm test:plugin:installed`：在已安装并启用插件的 Codex 环境中运行。通过 `codex mcp list --json` 取得宿主实际解析的命令、参数和目录，再启动缓存里的插件验证；测试不会自行替换路径占位符。

这两条检查分别防止依赖遗漏和宿主配置解析回归。测试需要允许本地子进程及临时回环监听。更新安装缓存后，在新的 Codex 任务中调用启动器，以确认桌面工具列表已刷新。

此检查覆盖启动器与既有工作台入口，不替代 Preview、Render 和执行胶囊工具链的完整验收。

## 启动器宿主握手与目录窗口

工作台使用 MCP Apps `2026-01-26` 的 `ui/initialize`，声明 `appCapabilities`，处理宿主响应后发送 `ui/notifications/initialized`，随后接收工具结果。旧实现遗漏就绪通知，并使用了错误的能力字段；只注入工具结果的测试掩盖了真实宿主中始终显示“连接中”、没有创建或打开入口的问题。协议依据：[MCP Apps 生命周期](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html)。初始化拒绝或超时会显示连接失败。

标准宿主不保证提供 `window.openai.selectDirectory`。工作台完成握手后通过仅对 app 可见的 `select_project_directory` 调用本地系统窗口；保留已有宿主目录接口兼容。Linux 使用 Zenity，macOS 使用系统 AppleScript 文件夹窗口，Windows 使用 PowerShell 的系统文件夹对话框。窗口只返回明确选择的绝对路径，不扫描或写入项目；取消不触发项目操作。Linux 需要已安装 Zenity 和可用桌面会话，缺少选择器时显示错误，也可由用户在对话中明确提供绝对路径。macOS 与 Windows 分支仍需在对应系统实机验证。

`pnpm exec playwright test tests/e2e/plugin-launcher-handshake.spec.ts` 覆盖真实资源与工具返回值、标准父子窗口握手，以及通过 MCP 通道实际创建和打开临时项目；目录窗口返回值在此测试中由宿主模拟。`pnpm exec vitest run tests/plugin-directory-picker.test.ts` 覆盖系统窗口调用、中文空格路径、取消、失败和重复点击。Linux Zenity 的真实选择与取消另已在隔离 Xvfb 桌面验证。

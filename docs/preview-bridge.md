# 只读成片 Preview

工作台 Agent 主区通过 `project_preview` app-only 工具显式构建当前修订或候选。构建沿用 #75 的认证离线胶囊，运行时 Player 壳属于同一个不可变 Bundle；宿主不导入项目模块。工作台创作输入统一使用当前 Codex 对话；切换工作区不重建播放器或触碰 Codex Composer，离开 Agent 工作区与隐藏页面会暂停播放。

每个实例绑定 Bundle、独立输入、完整媒体字节摘要与执行环境身份。媒体在构建前捕获为有界内存副本，构建后重新捕获核对；出现项目、候选、Brief 或媒体变化时丢弃构建结果。每四秒核对已显示实例的新鲜度，观察失败也标为过期。过期状态不可自动清除；必须重新构建新实例。每份媒体最大 256 MiB，每次捕获总计最多 512 MiB，超过时返回可恢复错误，不以实时文件地址降级。实例和 Bundle 均为进程缓存，不写入可移动项目。

Preview 由绑定回环地址和随机端口的独立 HTTP 来源提供，宿主的 MCP UI CSP 仅为该来源开启 frameDomains。服务校验 Host，路径只能命中随机能力地址下的固定 HTML、可信 bootstrap、Bundle 与摘要寻址媒体；不提供目录路由、源码映射或 API，不允许写入请求。iframe 只授予 scripts 和 same-origin，跨 origin 宿主无法读取其 DOM。CSP 禁止连接、Worker、对象、表单与基础 URL，沙箱不授予顶层导航、弹窗、下载权限。项目静态能力检查和安全 JSX 进一步禁止 DOM、导航、网络、事件注入及写能力。宿主来源必须为可校验的 HTTP(S) origin；不接受 opaque/null origin 或通配来源。

Bridge V1 每条消息携带 `version`、`instanceId` 和随机 `token`。宿主与实例双向验证消息来源和身份。BOOT 后宿主发送一次 INIT 并回显完整身份，实例一次绑定后返回 READY。主版本不兼容或重复 INIT 失败关闭。宿主只消费公开 Bridge，不调用内部 Metadata 检查入口；Preview 绑定后内部绑定入口从 window 删除。

控制消息是 PLAY、PAUSE、SEEK（整数 frame 与 requestId）、VOLUME（0–1）、MUTE（布尔值）；事件是 READY、FRAME、PLAYING、PAUSED、BUFFERING、ERROR。FRAME 从 Composition 内布局提交后报告，并在缓冲状态恢复后重新报告；宿主等待对应 requestId 的 FRAME，不能用请求帧冒充已提交帧。相同帧的重复 seek 也会确认。播放 Scene 由实例的固定时间窗推导，不影响表格选择，逐帧输出不放入 live region。

首次读取已有 Preview 时优先候选；“对比当前”与“返回候选”提供单画面比较。同时最多保留两个浏览器槽位。查看副本通过 `sourceInstanceId` 关联原实例，不能以内容身份替代实例身份去重；同内容重建仍是新证据。新目标就绪只展示切换入口；显式切换先暂停源，再显示已 READY 目标并定位首帧。构建或目标初始化失败不移除源画面，错误明确命名目标版本；旧成功预览显示过期提示。零 Scene 没有时间线和播放能力，草稿时间明确标记 Draft Duration。候选交付与代表帧审核见 [代表帧证据协议](representative-frames.md)。候选接受由 `project_acceptance` 承载，最终 Render 见[最终 Render 界面说明](final-render-ui.md)；操作是否可用由最新验收证据与门禁决定。

验证：`pnpm typecheck`；`pnpm exec vitest run tests/preview-origin.test.ts tests/preview-bridge.test.ts tests/program-bundle.test.ts`；`pnpm exec playwright test tests/e2e/program-preview.spec.ts`。真实测试需要认证胶囊、Chromium 和本机监听权限。

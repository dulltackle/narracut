# 素材寻址走本地静态服务，而非 Remotion 的 `staticFile()` + `public/`

> **状态：Legacy，已由 [ADR-0011](./0011-run-preview-and-render-from-one-isolated-bundle.md) 整体替代。** Project VNext 通过受限 Runtime 地址、Media Revision 与执行胶囊访问 Asset，不继承项目根静态服务、同源 API 或无鉴权监听；也不提供兼容路径。

Remotion 官方的素材约定是把文件放进 `public/`、用 `staticFile()` 引用，并明确不支持绝对路径。但本项目的核心前提是「项目就是一个文件夹，可整体移动」，素材路径由用户决定——要求所有素材复制进一个固定的 `public/` 才能用，等于在唯一数据源之外再造一份可能不同步的副本。因此改用官方文档在 `absolute-paths` 页给出的逃生舱：**用 `serve-handler` 把项目根整体映射成本地 HTTP，DSL 只存相对项目根的相对路径**，Player 与渲染 Composition 共用同一个「相对路径 → URL」纯函数，两端读到的是同一个服务进程下的同一份磁盘文件。

- 决策出处：[02 — Remotion 实拍渲染调研](https://github.com/dulltackle/narracut/issues/7) 第 7 节（三方案对比 + 可跑代码）、[07 — 渲染管线与前后端边界](https://github.com/dulltackle/narracut/issues/12)。

## Considered Options

- **`staticFile()` + `public/`（官方约定）**——被否。强制复制素材，破坏「项目文件夹是唯一数据源」，且用户改动源文件后极易忘记同步。
- **DSL 存绝对路径 + 映射层**——被否。绝对路径与「项目文件夹可移动」天然冲突，移动后没有任何锚点可做批量修正；且 Remotion 的视频组件在渲染阶段最终仍需要一个 URL，绕开它等于放弃 `<Video>`/`<OffthreadVideo>` 自带的抽帧解码能力。
- **本地静态服务 + 相对路径**——采用。

## Consequences

- **端口与 URL 绝不落进 DSL**。`mediaBaseUrl` 是每次打开项目时现算的运行时值，项目文件夹移动/改名后重新打开即自愈。
- **服务与 API 同 origin、同端口**，素材挂在 `/media/*` 前缀下（见 [ADR-0003](./0003-frontend-owns-the-dsl.md) 的接口清单）。
- **工作台列表中的视频缩略图不得直接加载 `/media/*.mp4`**。列表改用 `GET /api/assets/thumbnail?path=...` 按需派生的 320×180 JPEG 首帧；只有用户打开完整 Asset 预览、选择视频 Scene 或播放时，Player 才能读取原视频。这避免了页面启动时为多个尾置 `moov` 的 MP4 并发发起 Range 请求。
- **首帧是非持久化运行时派生数据**。服务只按项目相对路径和源文件元数据签名缓存 JPEG，缓存有界且仅存在于进程内；不得修改 `project.json`、`assets/` 或项目内其他文件，服务重启后允许重新生成。
- **素材响应必须带 `Access-Control-Allow-Origin: *`**。渲染时 headless Chromium 从 Remotion 的 `serveUrl` 加载 bundle、再跨域抓 `/media/*`；CORS 失败会让 `@remotion/media` 的 `<Video>` 静默 fallback，而 Player 与 renderer 的 fallback 目标不同（`<Html5Video>` vs `<OffthreadVideo>`），「Preview = Render」会从这里裂开。
- **不加 token 鉴权**，这是明确接受的风险。`<Video src>` 的请求由浏览器与 renderer 自己发出，加不了 header，token 只能塞 query string 并污染那个两端共用的纯函数。缓解手段是显式 `listen(port, '127.0.0.1')` 绑回环，外加一道 `path.resolve` 校验解析结果落在项目根内。风险等价于「本机其他进程本来就能读你的磁盘」。
- **打开项目时必须做素材完整性校验**，报错带 Scene ID + 相对路径 + 拼出的绝对路径，而不是让 Player 黑屏或让渲染跑到一半才 404。
- **未来的视频导入管线必须产出 fast-start MP4**，即把 `moov` 元数据放在文件头，降低主动预览与播放时通过高延迟链路读取元数据的成本。本决策不自动改写既有 Asset，也不提前增加当前尚不存在的视频导入流程。

# Remotion 项目级 Render Program Runtime 约束调研

## 调研范围

本报告回答以下问题：Narracut 如何接入随视频项目保存的任意 React/Remotion 源码、项目独立依赖与锁文件、动态 Composition 发现、浏览器预览和最终渲染，以及离线可复现构建。

结论以 Narracut 当前锁定的 Remotion `4.0.512` 为基线。API 语义引用 Remotion 官方文档；涉及打包解析行为时，补充引用 `v4.0.512` 官方源码。本文没有把社区文章或第三方实现作为证据。

## 结论摘要

| 问题 | 官方能力边界 | 对 Narracut 的含义 |
| --- | --- | --- |
| 项目级任意源码 | `bundle()` 接受项目入口的绝对路径，并以 `rootDir` 作为项目上下文；入口必须注册 Remotion Root | 可把 Render Program 建成项目目录中的独立 Remotion 工程，并由 Node Runtime 动态打包 |
| 项目级依赖 | `rootDir` 应指向安装 Remotion 的 `package.json` 所在目录；所有 Remotion 包必须精确同版 | 每个 Render Program 应有 manifest、唯一锁文件和独立安装环境，不能依赖机器全局包 |
| Preview 与 Render 共用 bundle | Renderer 接受 `serveUrl` bundle；`<Player>` 不接受 entry point、Composition 或 `serveUrl`，只接受 React 组件 | 官方 API 支持“同一 Composition 源码”，不直接支持“同一个 bundle 同时喂给 Player 和 Renderer” |
| 动态发现 | 编程式 `bundle()` 要求明确入口；`getCompositions()` 可执行 bundle 的 Root 并枚举 Composition | 入口应采用 Narracut 固定约定；构建后再用 `getCompositions()` 验证和发现 Composition |
| 离线可复现 | bundle 可复用且可搬移；Remotion 同时允许网络取数、非确定随机和按需下载浏览器 | 需要 Narracut 自己冻结依赖、浏览器、输入与本地资产，并在构建/渲染期禁止网络依赖 |

最重要的架构判断是：**若“Preview = Render”被定义为执行同一份构建产物，Agent 工作区就不应继续把 `<Player>` 当作项目级任意源码的加载器。** 可选方案是内嵌同一个 Remotion bundle（最低成本是内嵌其 Studio 页面），或自行开发 bundle-to-host 协议；后者不是 Remotion 的公开 Player API。若仍使用 `<Player>`，最多只能保证预览和渲染从同一源码与输入分别构建，不能声称两端共用同一 bundle。

## 1. 项目级任意 React/Remotion 源码

### 1.1 可行的官方入口

`@remotion/bundler` 的 `bundle()` 会用 Webpack（或显式启用时使用 Rspack）打包 Remotion 项目，并返回可交给 Renderer 的 bundle 目录。其 `entryPoint` 必须是绝对路径；`rootDir` 应是“包含安装 Remotion 的 `package.json`”的目录，默认值只是当前进程工作目录，并不是调用文件所在目录。[`bundle()` 官方文档](https://www.remotion.dev/docs/bundle)

入口文件应调用 `registerRoot()`；Root 可以返回一个或多个 `<Composition>`。官方还允许异步准备完成后再调用 `registerRoot()`，因此入口可以在加载 WebAssembly 或动态模块后注册，但 Runtime 仍须等待 Root 成功完成注册。[`registerRoot()` 官方文档](https://www.remotion.dev/docs/register-root)

对 Narracut 而言，最直接的项目布局是：

```text
<video-project>/
  project.json
  video.md
  render-program/
    package.json
    pnpm-lock.yaml
    src/index.ts
    src/Root.tsx
    ...Agent 生成的组件
```

Node Runtime 以 `render-program/src/index.ts` 为明确入口，以 `render-program/` 为 `rootDir`。不要依赖 Narracut 服务进程的当前工作目录，否则项目移动、服务启动目录变化或并行打开多个项目时都会改变打包上下文。这是由 `rootDir` 的官方语义直接推导出的接入约束。[`bundle()` 的 `rootDir` 参数](https://www.remotion.dev/docs/bundle#rootdir)

### 1.2 “任意源码”仍是浏览器源码

Remotion 的生产 bundle 不是在 Node 中直接执行 Composition；Renderer 会启动 Chromium，加载 bundle，再对各帧求值。SSR 官方流程明确分为“创建 bundle、选择 Composition 并计算 metadata、渲染”三步。[SSR 官方流程](https://www.remotion.dev/docs/ssr-node)

`v4.0.512` 的 Bundler 默认把 TypeScript/TSX 交给 esbuild loader，目标为 Chrome 85，并内置 CSS、常见图片/音视频和字体资源规则；最终 Webpack/Rspack `context` 被设置为 `rootDir`。[`v4.0.512 shared-bundler-config.ts`](https://github.com/remotion-dev/remotion/blob/v4.0.512/packages/bundler/src/shared-bundler-config.ts)、[`v4.0.512 webpack-config.ts`](https://github.com/remotion-dev/remotion/blob/v4.0.512/packages/bundler/src/webpack-config.ts)

因此，“任意 React/Remotion 源码”不等于“任意 Node 程序”：Composition 及其依赖必须能被浏览器目标的 bundler 编译并在 Chromium 中运行。需要文件系统、子进程或原生 Node API 的准备工作应留在 Narracut/Worker 侧，产出 JSON 可序列化输入或本地 HTTP 资产，再交给 Composition。

### 1.3 配置不会自动成为隐式契约

编程式 `bundle()` 暴露 `bundlerOverride`、`webpackOverride` 和 `rspackOverride`。官方示例特意注明：如果 `remotion.config.ts` 中有 bundler override，调用方也要把它传给 `bundle()`。[`bundle()` 示例与参数](https://www.remotion.dev/docs/bundle)

这意味着 Narracut 不能假设项目中的任意 Remotion CLI 配置会自动被编程式 Runtime 采用。规格应在以下两种策略中二选一：

1. 只允许稳定、版本化的 Narracut bundler 配置，项目不拥有可执行配置；
2. 显式加载项目配置并把允许的 override 传入 `bundle()`。

第二种策略会把项目配置也纳入任意代码执行与可复现输入，必须和 Render Program 源码一起做版本记录和错误归因。

## 2. 项目独立依赖与锁文件

### 2.1 Remotion 的硬约束

Remotion 官方要求所有安装的 Remotion 包（`remotion`、`@remotion/player`、`@remotion/cli` 等）保持完全相同版本；版本不一致可能产生细微错误或彻底损坏。官方明确指出 `^` 范围不能保证同版，并建议使用不带 `^` 的精确版本以及 `npx remotion versions` 检查实际安装结果。[Version mismatch 官方文档](https://www.remotion.dev/docs/version-mismatch)

此外，`bundle()` 的 `rootDir` 定义本身要求该目录的 `package.json` 安装 Remotion。[`bundle()` 的 `rootDir` 参数](https://www.remotion.dev/docs/bundle#rootdir)

所以项目级 manifest 至少应满足：

- 所有 Remotion 家族包均锁为与 Narracut Runtime 兼容的同一个精确版本；
- React/React DOM 与项目引入的 Remotion 组件库之间不存在重复 Runtime；
- 第三方包声明在项目 manifest 中，而不是从全局或 Narracut 仓库偶然解析；
- 每个项目只接受一种被 Narracut 支持的包管理器和对应的唯一锁文件。

`v4.0.512` Bundler 源码会把 `react`、`react-dom` 与核心 `remotion` alias 到 Bundler 所解析的实例，以避免多个 React/Remotion 核心实例。[`v4.0.512 shared-bundler-config.ts`](https://github.com/remotion-dev/remotion/blob/v4.0.512/packages/bundler/src/shared-bundler-config.ts) 这进一步说明 Runtime 的启动位置会影响核心包身份：应由项目作用域中解析出的同版 Bundler/Renderer 启动项目 Worker，或者由 Narracut 明确统一注入一套核心 Runtime；不要让宿主与项目的 Remotion 包随机混用。

### 2.2 锁文件能保证什么、不能保证什么

Remotion 没有自己的依赖安装器或锁文件格式；`bundle()` 只消费已经可解析的依赖树。因而“项目有锁文件”只是必要条件，Narracut 还必须规定：

- 使用冻结锁文件的安装方式，锁文件与 manifest 不一致即失败；
- 不允许在正常打开/预览/渲染时隐式升级依赖；
- 安装成功后记录实际依赖树或至少运行 `remotion versions` 校验；
- 离线恢复依赖需要本地包缓存或随项目交付的离线依赖归档，锁文件本身不包含包内容。

最后一项是工程推论：锁文件记录解析结果，却不能替代包文件。若“项目可移动且离线重新渲染”是硬约束，规格必须明确离线依赖的携带方式；仅携带 `package.json` 和锁文件不够。

## 3. Browser Player 与最终 Renderer 的同构边界

### 3.1 Renderer 可以严格复用同一 bundle

SSR 的标准路径是：

1. `bundle({entryPoint})` 生成 bundle；
2. 把同一个 bundle 目录或托管 URL 作为 `serveUrl` 传给 `selectComposition()`；
3. 把该 `serveUrl` 与选出的 Composition 传给 `renderMedia()`。

`selectComposition()` 明确定义为执行 bundle 的 Remotion Root，并对指定 Composition 执行 `calculateMetadata()`；`serveUrl` 可以是 `bundle()` 生成的目录，也可以是已托管的 bundle URL。[`selectComposition()` 官方文档](https://www.remotion.dev/docs/renderer/select-composition) `bundle()` 只应在源码变化后重建，同一 bundle 可以通过 input props 参数化并用于多次渲染；每条视频都重新打包被官方列为 anti-pattern。[`bundle()` 官方文档](https://www.remotion.dev/docs/bundle)

因此最终渲染链路可以把“源码/依赖锁的内容哈希 → bundle”作为缓存，并确保 metadata 选择与 render 使用相同 `serveUrl`。

### 3.2 `<Player>` 不消费 Remotion bundle

官方 `<Player>` 接口接收直接的 React `component`，或返回动态 `import()` 的 `lazyComponent`，并要求调用方另行提供 fps、尺寸、时长和 input props。官方特别强调 Player 不使用 `<Composition>`。[`<Player>` 官方文档](https://www.remotion.dev/docs/player/player)

Remotion 的 Entry point 文档说得更直接：**Player 中不存在 entry point 概念，调用方直接传 React 组件和 metadata。** [Entry point 官方文档](https://www.remotion.dev/docs/terminology/entry-point#in-the-player)

由此可得：

- `lazyComponent` 只是宿主前端 bundler 的代码分割接口，不是从磁盘或 `serveUrl` 加载任意 Remotion 项目的接口；
- `bundle()` 的返回值不能直接作为 `<Player>` 的 `component`/`lazyComponent`；
- 官方 API 没有“把 Renderer 使用的 bundle URL 挂进 Player”的适配层。

### 3.3 三种接入方案

#### 方案 A：同一源码、两个构建上下文

宿主前端构建 Render Program 组件给 `<Player>`，Node 再用 `bundle()` 构建同一源码给 Renderer。这符合 Remotion 通常展示的 Player 用法，但对“运行时出现的项目级任意源码和项目独立依赖”不友好：已发布的 Narracut 前端无法天然导入用户后来写到任意目录的模块。

它只能承诺“源码相同”，不能承诺“bundle 相同”。两端 bundler、define、alias、环境变量或依赖解析不同，都可能造成 Preview/Render 漂移。

#### 方案 B：浏览器内嵌 Renderer 使用的同一 bundle

把 `bundle()` 产物通过本地服务暴露，并在 Agent 工作区用隔离 iframe 打开它。Remotion bundle 本身是可由浏览器加载、可由 Renderer 通过 `serveUrl` 执行的网页；默认 `publicPath` 从 `v4.0.497` 起为 `./`，使产物可搬移。[`bundle()` 的 `publicPath`](https://www.remotion.dev/docs/bundle#publicpath)

最低成本可以内嵌 Remotion Studio 页面，但会带入 Studio UI。若要实现 Narracut 自己的播放控件、seek、错误边界和状态同步，就需要基于 iframe 通信开发稳定桥接协议。该桥接不是 `<Player>` 的公开能力，必须作为 Narracut 自有 Runtime 模块测试和版本化。

这是唯一能在“不限制 Agent 源码形态”的同时，使浏览器预览和最终 Renderer 确实执行同一个 bundle 的方向。

#### 方案 C：自定义暴露 bundle 模块给宿主 Player

通过 Webpack/Rspack override 把项目组件暴露为可远程加载模块，再交给 `<Player>`。Remotion 的确开放 bundler override，但没有为这种 Player 远程模块协议提供公开契约。[`bundle()` override 参数](https://www.remotion.dev/docs/bundle)

它同时要兼容 Remotion Root/Renderer 的 bundle 格式、远程模块生命周期、React 单例、热更新和错误隔离，风险最高。除非原型证明方案 B 无法满足 UX，不建议把它作为首选规格。

## 4. 动态入口与 Composition 发现

### 4.1 编程式 Runtime 应固定入口

Remotion CLI 会按明确顺序发现入口：命令行显式路径、`Config.setEntryPoint()`，然后才检查一组固定常见路径。Player 则完全没有入口概念。[Entry point 官方文档](https://www.remotion.dev/docs/terminology/entry-point)

`bundle()` API 本身要求调用方传入 `entryPoint` 绝对路径。[`bundle()` 的 `entryPoint` 参数](https://www.remotion.dev/docs/bundle#entrypoint)

因此 Narracut 不需要复制 CLI 的启发式搜索。推荐把 `render-program/src/index.ts` 定为项目格式的一部分；文件不存在、越过项目目录、符号链接逃逸或没有 `registerRoot()` 时，在打包前直接报项目结构错误。

### 4.2 Composition 可以在构建后发现

`getCompositions()` 会执行 bundle 的 Remotion Root，返回其中定义的 Composition，并对每一个执行 `calculateMetadata()`；若只需要已知 ID，官方建议改用 `selectComposition()`，避免计算全部 Composition。[`getCompositions()` 官方文档](https://www.remotion.dev/docs/renderer/get-compositions)

适合 Narracut 的两阶段协议是：

1. 首次构建或 Agent 修改 Root 后，调用 `getCompositions({serveUrl, inputProps})` 做发现和校验；
2. Render Program manifest 记录用户选中的稳定 Composition ID；正常预览/渲染使用 `selectComposition()`。

如果产品规格规定每个项目只有一个最终成片 Composition，Runtime 应把“零个或多个候选”视为需用户/Agent 修正的构建结果，而不是默默选择列表第一项。Composition ID、fps、width、height、duration 必须进入预览与渲染的共同快照。

## 5. 离线与可复现构建

### 5.1 Remotion 已提供的基础

- `bundle()` 只有源码变化时才需要调用，产物可复用于多次参数化渲染。[`bundle()` 官方文档](https://www.remotion.dev/docs/bundle)
- `outDir` 可指定稳定输出目录；`publicDir` 可显式指定公开资产目录。[`bundle()` 参数](https://www.remotion.dev/docs/bundle)
- 默认相对 `publicPath` 让 bundle 可搬移。[`bundle()` 的 `publicPath`](https://www.remotion.dev/docs/bundle#publicpath)
- `selectComposition()` 和 `renderMedia()` 可消费本地 bundle 目录或已托管 URL，因而不要求把项目上传到云端。[`selectComposition()` 官方文档](https://www.remotion.dev/docs/renderer/select-composition)

### 5.2 必须由 Narracut 增加的封闭条件

Remotion 允许在 `calculateMetadata()` 或组件中通过 `fetch()` 取数，官方数据获取文档还展示了 API 请求模式。[Data fetching 官方文档](https://www.remotion.dev/docs/data-fetching) 这是一项能力，不是离线或可复现保证。Narracut 若坚持离线重渲染，应在 Agent 规则、静态检查和运行沙箱中禁止外网依赖；所需数据应在构建前固定为 JSON input props 或项目内资产。

Remotion 也明确指出 `Math.random()` 在预览可运行，却会因渲染并行页面实例产生不同值；应使用带稳定 seed 的 `random()`。[Using randomness 官方文档](https://www.remotion.dev/docs/using-randomness) 同理，当前时间、环境变量和运行机器状态都不应直接决定画面，必须先冻结到 Render Snapshot。

Renderer 需要本地 Chrome。`openBrowser()` 默认会探测兼容浏览器，找不到就下载；`ensureBrowser()` 允许指定 Chrome 版本，或通过 `browserExecutable` 使用已有二进制。[`openBrowser()` 官方文档](https://www.remotion.dev/docs/renderer/open-browser)、[`ensureBrowser()` 官方文档](https://www.remotion.dev/docs/renderer/ensure-browser) 因此真正离线的首次渲染必须预装浏览器；为了提高跨次复现性，还应记录并固定浏览器版本/模式，而不是每次采用 Remotion 当时的推荐版本。

建议构建缓存键至少包含：

```text
Render Program 全部源码与配置
+ package.json 与唯一锁文件
+ 实际 Remotion/React/Bundler 版本
+ video.md 与 Render Snapshot
+ project.json 中本次只读 Scene 投影
+ 所有被引用本地资产的内容哈希
+ 浏览器版本、chromeMode 与关键 Chromium flags
+ Narracut Runtime 协议版本
```

操作系统、字体栅格化、GPU 和编码器仍可能影响最终像素或二进制文件；因此规格应把“可复现”拆为两个可测试层级：

1. **语义可复现**：相同冻结输入得到相同 Composition metadata、时间线和画面逻辑；
2. **像素/文件可复现**：还需固定浏览器、字体、系统镜像、GPU/软件渲染路径和编码参数。

仅有源码与锁文件只能支撑第一层的大部分条件，不能自动保证跨机器输出文件逐字节一致。

## 6. 对后续 Runtime 决策的建议

1. **Render Program 采用独立项目根。** 固定入口、manifest、锁文件和本地资产边界；Node 为每个项目启动隔离 Worker，并显式传 `entryPoint`、`rootDir`、`publicDir`、`outDir`。
2. **核心 Runtime 版本由 Narracut 协议钉死。** 所有 Remotion 包用相同精确版本；打开项目先做依赖树和 `remotion versions` 校验，不在预览或渲染请求中隐式安装/升级。
3. **严格定义 Preview = Render。** 若要求同一 bundle，选择“本地 serve bundle + iframe”路线，并把播放控制桥接列为待原型决策；若保留 `<Player>`，规格必须降级为“同一源码/输入契约”，并承认是两个构建上下文。
4. **发现与执行分离。** `getCompositions()` 只在构建产物变化后用于发现/验收；稳定 ID 后，正常路径使用 `selectComposition()` 和同一 `serveUrl`。
5. **离线依赖作为项目格式的一部分解决。** 锁文件之外还需明确包缓存/离线归档和预装浏览器策略；网络数据、远程字体和远程媒体不能进入可复现渲染路径。
6. **bundle 以内容寻址缓存。** 构建成功后记录源码、依赖、输入和 Runtime 指纹；Preview 和 Render 绑定同一个不可变 bundle ID，源码变化即生成新 ID，而不是原地覆盖正在预览或渲染的产物。

## 7. 尚需原型验证的点

这些问题无法仅靠公开 API 文档定案，适合后续 Wayfinder prototype ticket：

- Remotion Studio bundle 以 iframe 内嵌时，能否在不依赖私有 Studio protocol 的情况下满足 Narracut 所需的 seek、播放状态、错误位置和热更新体验；
- 如果必须使用自有控件，最小 iframe bridge 应位于 Render Program 源码、Narracut 固定壳层还是 bundler override；
- 项目级依赖通过独立 Worker 解析时，pnpm symlink、React 单例与 Bundler alias 在 Narracut 实际目录布局中的行为；
- 断网环境下，依赖归档、Chrome、字体和媒体齐备时的完整 cold-start 构建与渲染演练。

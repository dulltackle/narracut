# Render Program 与 Agent 工具执行隔离边界调研

## 调研问题与基线

本文回答 [“调研 Render Program 与 Agent 工具的执行隔离边界”](https://github.com/dulltackle/narracut/issues/52)：项目级任意 React/Remotion 源码、依赖安装脚本、Agent 文件工具、构建、Preview 和 Render 分别能触及哪些文件系统、进程、环境变量与网络能力；容器、独立用户/进程、权限收窄和浏览器隔离各自能封闭什么、不能封闭什么。

Remotion 结论以 Narracut 当前精确锁定的 `4.0.512` 为基线。事实来源限于 Node.js、npm、pnpm、Webpack、Remotion、Chromium、Docker、Linux man-pages 与 OpenAI 的官方文档或第一方源码。没有把博客或社区回答作为事实依据。

本文用以下标记区分证据强度：

- **已验证事实**：官方文档、标准或 `v4.0.512` 第一方源码直接支持。
- **合理推论**：由多个已验证事实组合得出的 Narracut 边界判断。
- **待原型验证**：公开契约不足以证明，或依赖 Narracut 最终接法与操作系统配置。

## 结论摘要

1. **“任意 Render Program”至少跨越三个权限域。** 安装脚本和 Bundler 扩展在 Node/ shell 中运行；Composition 在浏览器中运行；Renderer 的 Node 宿主还负责临时文件、浏览器进程和输出文件。只隔离浏览器不能隔离安装和构建，只隔离 Agent 工具也不能隔离之后被工具写入项目的代码。
2. **依赖安装是直接的宿主代码执行。** npm 生命周期脚本交给 `/bin/sh` 或 `cmd.exe` 执行，脚本不必是 JavaScript；默认 `ignore-scripts=false`。若安装进程能读凭据、写工作区、启动进程或联网，安装脚本也能使用同一组 OS 权限。
3. **“普通 React 源码只在浏览器执行”不能覆盖任意依赖与任意构建配置。** Webpack loader 在 Node.js 中运行并可做 Node 能做的一切；插件的 `apply()` 在编译生命周期中执行。Remotion `bundle()` 允许调用方传入 bundler/Webpack/Rspack override。即使 Narracut 不接受项目配置，源码中的 inline loader 是否仍可把项目依赖带入 Node 构建进程，仍须用 `4.0.512` 原型封死。
4. **纯 Player Preview 的网页代码默认没有 Node `fs`/`child_process`，但仍有浏览器网络能力。** 它能访问同源资源、发出跨源请求，并调用宿主显式暴露的桥；同源策略/CORS 主要限制读取响应，不是主机网络出口策略。若改用 Remotion Studio，官方 Studio API 还明确支持写/删 `public` 文件与保存默认 props，不能把 Studio 当作纯只读预览器。
5. **Remotion Renderer 自带的 Chromium 不是可依赖的主机沙箱。** `v4.0.512` 第一方源码无条件加入 `--no-sandbox` 和 `--disable-setuid-sandbox`，同时禁用 `IsolateOrigins`、`site-per-process`、Site Isolation trials、本地网络访问检查与若干 Private Network Access 检查。Composition 仍通常受 Web API/同源规则约束，但 Chromium 的 OS 沙箱与站点隔离不能作为 Narracut 的不可信代码边界。
6. **独立进程不是安全边界；独立低权限用户只解决一部分。** Node 子进程默认继承当前工作目录和 `process.env`；同 UID 进程可按 Linux 规则互相发信号，并共享该 UID 可读写的文件权限。不同 UID 能用文件 DAC 和信号权限隔离文件/进程，却不会自动隔离网络、PID 可见性、CPU/内存、内核或世界可读文件。
7. **容器最接近完整的本地执行边界，但必须按能力配置。** mount namespace/只读根文件系统封文件，PID namespace 封进程视图，network namespace 或 `--network none` 封网络，cgroup 封资源，capability/seccomp/no-new-privileges 收窄内核接口。容器仍共享宿主内核；危险 bind mount、Docker socket、`--privileged`、host network/PID 或设备透传会重新打开边界。
8. **Node Permission Model 适合“防误操作”，不适合承诺隔离恶意依赖。** Node 官方明确称它不是针对恶意代码的安全边界，并列出既有文件描述符、部分初始化前读取及同用户进程信号等限制。它可作为容器/OS 沙箱内的第二层收窄，不能替代后者。

## 一、逐阶段能力矩阵

下表描述“没有额外 Narracut 沙箱”时的能力。这里的“宿主权限”指运行该进程的 UID、mount、network、环境与内核策略实际授予的权限，不等于 root。

| 阶段 | 文件系统 | 进程 | 环境变量 | 网络 |
| --- | --- | --- | --- | --- |
| Codex/Agent 文件与 shell 工具 | 由 Agent 宿主的 sandbox mode/permission profile 决定；典型 `workspace-write` 可读文件、写工作区与临时目录 | 可在沙箱内运行本地命令；越界是否执行由 OS 沙箱和审批共同决定 | 工具进程看到宿主传入的环境；是否含秘密取决于启动配置 | 本地 Codex 默认关闭命令网络；开启后若不启用网络代理则是直接出口 |
| 依赖安装 | 包管理器与生命周期脚本拥有安装进程的全部文件权限，可写 `node_modules`、缓存、项目和其他可写路径 | npm 脚本由 shell 执行，可启动任意可执行文件和子进程 | 继承安装进程环境，另有 npm 注入的包/生命周期变量 | 包管理器需访问 registry；脚本也共享该进程的网络边界 |
| `bundle()` 构建 | Bundler 读取入口、依赖与 `publicDir`，写 `outDir`/临时目录/缓存；`publicDir` 符号链接会被转发 | loader/plugin/override 在 Node 构建进程中执行，权限等同构建进程 | override/loader 可读 Node 环境；进入浏览器 bundle 的变量取决于 Remotion 注入规则 | Bundler 扩展拥有 Node 网络能力；普通源码转译本身不需要网络，但不能据此推断扩展不联网 |
| 纯 `<Player>`/自建 iframe Preview | 网页 JS 没有通用 Node 文件 API；可读被 HTTP 服务暴露的 bundle/资产、浏览器存储和用户授权的 Web 文件句柄 | 不能直接调用 Node `child_process`；能用 Web Worker，能调用宿主显式暴露的 HTTP/postMessage/MCP 桥 | 不会自动看到宿主 `process.env`；只能看到构建时内联或宿主注入的值 | 有浏览器 `fetch`、媒体、WebSocket 等能力；受浏览器 Web 安全规则而非 Narracut 主机 allowlist |
| Remotion Studio Preview | 除网页能力外，官方 Studio API 可列出/监听/写/删 `public` 文件，并保存 Root 默认 props | 浏览器代码仍不是通用 Node 进程；Studio server 是额外高权限代理 | CLI 可读取 `.env` 并把变量提供给前端 | 同纯浏览器；另有 Studio server 的本地 HTTP/WS 面 |
| `selectComposition()`/`renderMedia()` 中的 Composition | 浏览器 JS 通常没有 Node `fs`；可读由 `serveUrl` 暴露的 bundle/资产；可经网络请求触达服务 | 运行在 Remotion 启动的 Chromium 进程中；该 Chromium 在 `4.0.512` 以 `--no-sandbox` 启动 | Node API 只把显式 `envVariables` 注入项目；不会自动读取 `.env` | Chromium 可联网，且 Remotion 启动参数禁用了本地网络/PNA 检查；CORS是否允许读取响应仍取决于实际响应和 `disableWebSecurity` |
| Renderer 的 Node 宿主 | 读取 bundle/资产，创建临时目录与浏览器 profile，写帧、缓存和 `outputLocation` | 启动 Chromium，并运行 Remotion 自身的媒体/编码子流程；宿主选择的回调/override 也是 Node 代码 | Renderer 宿主可读自身全部环境；只应把显式 allowlist 交给 Composition | 宿主与其子流程继承部署网络边界；远程媒体或浏览器下载会产生网络需求 |

### 1. Agent 文件工具

**已验证事实。** OpenAI 官方把 Codex 的控制拆成两个层次：sandbox mode 决定技术上能写哪里、能否联网；approval policy 决定何时必须停下来请求许可。默认本地 `workspace-write` 允许读文件、在工作区内编辑和运行命令，工作区外写入或命令网络访问需审批；命令网络默认关闭。Linux 目前用 `bwrap` 加 seccomp 强制执行，而不是仅靠提示词。[Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)

官方还明确区分命令网络与其他工具面：命令网络代理不覆盖 web search、app/connector、MCP、Browser/Computer Use、Codex cloud 或客户端自身连接。因此，“Agent 的 shell 无网络”不能推出“Agent 的所有工具无网络”。[Traffic outside the command network proxy](https://learn.chatgpt.com/docs/agent-approvals-security#traffic-outside-the-command-network-proxy)

**合理推论。** Render Program 文件一旦由 Agent 写入项目，后续安装、构建、Preview、Render 是新的执行事件，不再受“Agent 当时是否获准写这个文件”的语义保护。Narracut 必须在每个消费者的 OS 边界重新校验/隔离，不能把 Agent 审批记录当成代码安全证明。

### 2. 依赖安装脚本

**已验证事实。** npm 生命周期脚本从包根目录运行，POSIX 上把脚本行交给 `/bin/sh`，Windows 上交给 `cmd.exe`；脚本可以是任意可执行文件，不必是 Node/JavaScript。[npm Scripts：工作目录、环境与执行](https://docs.npmjs.com/cli/v11/using-npm/scripts/)

npm `install` 的 `ignore-scripts` 默认是 `false`；设为 `true` 时不运行 `package.json` 中的脚本，但显式 `npm run`/`start`/`test` 等仍会执行目标脚本。npm 11 还提供项目级 `allowScripts`/`strict-allow-scripts` 来允许或拒绝依赖的安装期 `preinstall`、`install`、`postinstall`，以及非 registry 依赖的 `prepare`。[npm install 配置](https://docs.npmjs.com/cli/v11/commands/npm-install/#ignore-scripts)

Narracut 当前使用 pnpm。pnpm 官方的 `approve-builds` 会把允许和拒绝运行安装脚本的依赖写入 `pnpm-workspace.yaml` 的 `allowBuilds` 映射。[pnpm approve-builds](https://pnpm.io/cli/approve-builds)

Node `child_process` 默认继承父进程 `process.env`，未显式指定 `cwd` 时也继承当前工作目录；可通过 `env`、`cwd`、`uid`、`gid` 显式改变。[Node.js Child process](https://nodejs.org/api/child_process.html)

**合理推论。** 锁文件能锁定依赖内容选择，不能把安装脚本降级为“数据”。若允许脚本，真正权限上限是安装进程的 OS 身份与隔离配置。最小秘密暴露策略是给安装阶段构造全新的环境 allowlist，而不是从 Narracut 服务进程删几个已知变量；最小网络策略是只允许包源并隔离本机/私网地址。

### 3. Bundler 构建

**已验证事实。** Remotion `bundle()` 接收绝对入口，`rootDir` 默认是当前工作目录，`publicDir` 默认是项目 `public` 目录，`outDir` 未指定时写临时目录。官方特别说明 `publicDir` 中的符号链接会被转发。[Remotion `bundle()`](https://www.remotion.dev/docs/bundle)

`bundle()` 允许调用方传 `bundlerOverride`、`webpackOverride`、`rspackOverride`；Remotion Node API 示例明确说项目若有 config override，调用方也要把它传入。因此项目 `remotion.config.ts` 并不会由 `bundle()` 的公开契约自动变成隐式配置，但调用方一旦加载并传入，它就是构建进程中的 Node 代码。[Remotion `bundle()` overrides](https://www.remotion.dev/docs/bundle#webpackoverride)

Webpack 官方明确：loader 在 Node.js 中运行，“能做 Node 中一切可能的事”，还能发出任意附加文件；inline loader 可以直接写在 `import` 请求中。插件的 `apply()` 由 compiler 调用并获得完整编译生命周期。[Webpack Loaders](https://webpack.js.org/concepts/loaders/)、[Webpack Plugins](https://webpack.js.org/concepts/plugins/)

**合理推论。** 仅禁止项目提供 Webpack config 还不能自动证明构建安全：如果 Remotion 默认配置接受 inline loader，任意源码加任意已安装依赖可能在 import 中选择一个 Node loader。反过来，不含 loader/plugin/override 的普通 TSX 模块通常只是被解析和转换，模块顶层业务代码应在浏览器加载 bundle 时执行，而不是在 Webpack 构图阶段执行。前一句需要 `4.0.512` 原型验证，后一句不能外推到使用编译期宏、代码生成插件或自定义 loader 的包。

**已验证事实。** Node Permission Model 可以默认拒绝文件、网络、子进程、Worker、native addon、WASI、FFI 和 inspector，但 Node 官方同时明确称它是防止受信代码误操作的“seat belt”，不提供恶意代码安全保证；现有文件描述符、部分环境初始化前读取与其他通路有例外，同用户外部 Node 进程还可被 `process._debugProcess()` 触发 inspector。[Node.js Permission Model](https://nodejs.org/api/permissions.html)

**合理推论。** Node permissions 可用于测量 Bundler 所需的最小读写/子进程集合，或作为容器内纵深防御；不能作为“运行任意 loader 仍安全”的产品承诺。

### 4. Preview

#### 4.1 纯 Player 或自建 bundle iframe

**已验证事实。** Chromium 的安全架构把 Web 内容置于 renderer 进程，renderer/utility 进程使用最强的浏览器进程沙箱；browser process 本身不在沙箱中。Site Isolation 的目标是把不同站点置于不同 renderer 并限制跨站数据访问。[Chromium Security for Agents](https://chromium.googlesource.com/chromium/src/+/main/docs/security/security-for-agents.md)、[Site Isolation](https://www.chromium.org/Home/chromium-security/site-isolation/)

**合理推论。** 在未向网页注入 Node 或本地高权限桥的正常浏览器中，React/Remotion 代码只能使用 Web 平台能力：它不能直接 `require('node:fs')` 或 `child_process.spawn()`，也不会自动读取宿主环境。它仍能进行浏览器网络请求、消耗 CPU/内存、使用浏览器持久化存储，并攻击同源中错误暴露的本地 API。iframe `sandbox`、CSP、独立 origin 能缩小网页能力和跨源数据面，但不是安装器、Bundler、Studio server 或 Renderer Node 进程的边界。

#### 4.2 Remotion Studio

**已验证事实。** `@remotion/studio` 官方 API 包括 `getStaticFiles()`、`watchPublicFolder()`、`writeStaticFile()`、`deleteStaticFile()`、`saveDefaultProps()` 和 `restartStudio()`；文档直接说明这些操作会列出、写入、删除 public 文件或保存 Root 默认 props。[Remotion Studio API](https://www.remotion.dev/docs/studio/api)

**合理推论。** 若 Narracut 直接嵌入完整 Studio，必须把 Studio server 视作项目文件写代理，而不是只读画布。能否由 Composition 自身直接调用这些 API、它们如何校验路径和请求来源，需要针对最终嵌入方式原型验证；在证明之前不应把 Studio 与纯 Player 归为同一权限级别。

### 5. Render

**已验证事实。** `renderMedia()` 是 Node API，`outputLocation` 可以是绝对路径，也可以是相对当前工作目录解析的路径；`envVariables` 是调用方显式注入项目的键值对象。[Remotion `renderMedia()`](https://www.remotion.dev/docs/renderer/render-media)

Remotion 官方的环境变量文档把 CLI 与 Node API 分开：CLI 直接传入的变量需用 `REMOTION_` 前缀，以防整个环境（可能含秘密）进入 bundle；CLI 也可自动读项目 `.env`。Node API 不会自动读 `.env` 或转发全部环境，调用方必须显式传 `envVariables`，官方给出的理由正是避免安全问题。[Remotion Environment variables](https://www.remotion.dev/docs/env-variables)

最关键的事实来自 `v4.0.512` Renderer 源码：`openBrowser()` 的 Chromium 参数无条件包含：

- `--no-sandbox`、`--disable-setuid-sandbox`；
- 禁用 `IsolateOrigins` 与 `site-per-process`；
- `--disable-site-isolation-trials`；
- 禁用 `LocalNetworkAccessChecks`、`BlockInsecurePrivateNetworkRequests` 以及多项 Private Network Access preflight/result 检查；
- `--allow-running-insecure-content`；
- 仅当调用方另设 `chromiumOptions.disableWebSecurity` 时才额外加入 `--disable-web-security`。

见 [`v4.0.512 packages/renderer/src/open-browser.ts`](https://github.com/remotion-dev/remotion/blob/v4.0.512/packages/renderer/src/open-browser.ts)。Chromium 官方说明正常情况下 sandbox、IPC 检查和 Site Isolation 组合限制不可信 renderer；browser process 没有沙箱，Site Isolation 也是防御已完全攻陷 renderer 的基础。[Chromium compromised renderer threat model](https://chromium.googlesource.com/chromium/src/+/master/docs/security/compromised-renderers.md)

**合理推论。** `--no-sandbox` 不会凭空给网页 JavaScript 增加 `fs` API，且 Remotion 默认没有加入 `--disable-web-security`；所以“Composition 可直接读任意文件”不是已验证事实。但 Renderer 明确移除了 Chromium 的 OS 级 renderer 沙箱，且弱化了站点/私网隔离，因此 Narracut 不能把浏览器本身当作对恶意 Render Program 的可信主机边界。若 Chromium/V8/媒体解码器被利用，攻击代码落到 Renderer 所用 UID 的 OS 权限；这正是 Chromium sandbox 原本要限制的后果。

同理，`--disable-background-networking` 只关闭 Chromium 自身的后台流量，不等于阻止页面发起 `fetch`/媒体/WebSocket。Remotion 同一启动参数还显式采用 direct/no-proxy 并关闭本地网络访问检查。真正“无网络 Render”必须由 network namespace、容器网络或系统 egress policy 强制，而不是依赖 Chrome flag 或 CORS。

## 二、四类隔离机制能封闭什么

### 1. 独立进程

**能封闭：**

- 独立地址空间、崩溃与生命周期；父进程可设置超时、标准输入输出、工作目录和精简环境。
- Node `spawn()` 可显式指定 `env`、`cwd`、`uid`、`gid`；这为后续降权提供挂点。[Node.js Child process](https://nodejs.org/api/child_process.html)

**不能封闭：**

- 单独“fork/spawn 一个进程”不会改变 UID、mount、network、capability 或文件 DAC；默认还继承父进程环境和工作目录。
- Linux 允许 real/effective UID 与目标 real/saved UID 匹配的进程互发信号；同 UID 因而不是进程相互隔离边界。[Linux `kill(2)`](https://man7.org/linux/man-pages/man2/kill.2.html)
- 不限制子孙进程数、CPU、内存、磁盘或网络；杀父进程也不自动证明所有 detached/orphan 子进程都被回收。

**结论：** 独立进程适合故障隔离和可取消性，不足以承载不可信代码。需要至少配合独立凭据、namespace/cgroup 和权限策略。

### 2. 独立低权限用户与文件权限收窄

**能封闭：**

- Linux 用进程 filesystem UID/GID 与 supplementary groups 决定文件访问权限，用 UID/capability 决定发信号等跨进程操作。不同、非特权、无共享 group 的用户，加上严格 owner/group/mode/ACL，能阻止读取服务私有文件、修改其他项目以及向宿主服务进程发信号。[Linux credentials(7)](https://man7.org/linux/man-pages/man7/credentials.7.html)
- 只给项目输入只读权限、只给一个输出目录写权限，可把普通文件 API 的影响面收窄到显式路径。
- `no_new_privileges` 可保证后续 `execve()` 不因 setuid/setgid 位或 file capabilities 获得新权限；Docker 也暴露 `--security-opt no-new-privileges`。[Linux no_new_privs](https://www.kernel.org/doc/html/latest/userspace-api/no_new_privs.html)、[Docker run security options](https://docs.docker.com/reference/cli/docker/container/run/#security-opt)

**不能封闭：**

- 不自动隐藏其他 PID、mount、主机名、设备或 `/proc`；也不自动限制公网、loopback、Unix socket、私网服务、CPU、内存或进程数。
- 仍可读取 world-readable 文件及显式共享给该 UID/group 的内容；错误 ACL、继承 group、可写父目录、符号链接与预先打开的文件描述符都会改变边界。
- 仍共享宿主内核；内核漏洞不由 UID 边界解决。

**结论：** 独立用户是有价值的最小层，尤其可阻断同 UID 进程攻击；但它不是完整沙箱。

### 3. Node/应用级权限收窄

**能封闭：**

- Node Permission Model 可在受信代码场景按路径拒绝 `fs.read`/`fs.write`，并默认拒绝网络、子进程、Worker、native addon、WASI、FFI、inspector 等类别。[Node.js Permission Model](https://nodejs.org/api/permissions.html)
- Agent permission profile 可在 OS 沙箱中按 writable roots 和网络策略限制工具命令；Codex 官方默认 `workspace-write` 还递归保护 `.git`、`.agents`、`.codex`。[Codex protected paths](https://learn.chatgpt.com/docs/agent-approvals-security#protected-paths-in-writable-roots)
- 包管理器的 script allowlist/denylist 能避免不必要的安装期代码执行。

**不能封闭：**

- Node 官方明确不承诺抵御恶意代码，并记录权限模型绕过/例外；不能单独拿它运行恶意 loader 或 native dependency。
- 应用路径检查若不处理 canonical path、符号链接、TOCTOU 和已有文件描述符，不能等价于 mount/OS policy。
- Agent 审批是“是否允许动作”的控制；它不会自动约束之后由另一个服务执行同一文件。

**结论：** 这些机制适合作为纵深防御、审计和减少误操作，不是容器/OS sandbox 的替代品。

### 4. 浏览器隔离

**能封闭：**

- 在正常启用 Chromium sandbox 的常规浏览器里，renderer 进程与 browser/OS 分权；origin、CORS、CSP、iframe sandbox 与 Site Isolation 能限制网页能力、跨源数据读取和站点间影响。
- 单独 origin + 最小 iframe permissions + 不暴露本地写 API，可以把 Preview 的直接能力压到 Web 平台集合。

**不能封闭：**

- 不约束 Node 安装器、Bundler loader/plugin、Agent shell、Studio server 或 Renderer Node 宿主。
- CORS/同源策略不是 egress firewall；即使读不到响应，页面仍可能发送请求或加载某些跨源资源。
- browser process 本身没有 Chromium sandbox；任何宿主桥/DevTools/Studio 写 API都属于额外权限。
- Remotion `4.0.512` Renderer 主动以 `--no-sandbox` 启动并禁用 Site Isolation/PNA 检查，因此不能继承“普通桌面 Chrome”的安全假设。

**结论：** 浏览器隔离适合纯 Preview 的一层防护，不能作为统一 Render Program sandbox。

### 5. 容器/完整 OS sandbox

**能封闭：**

- Docker 启动容器时创建 namespaces 和 cgroups；namespace 隔离资源视图，cgroup 负责资源计量和限制。默认还减少 Linux capabilities。[Docker Engine security](https://docs.docker.com/engine/security/)
- `--read-only` 把容器根文件系统设为只读，只让显式 volume/tmpfs 可写；`--cap-drop`、seccomp、AppArmor/SELinux 与 `no-new-privileges` 可继续收窄系统调用和提权面。[Docker run](https://docs.docker.com/reference/cli/docker/container/run/)
- `--network none` 只创建 loopback，可封闭外网、宿主网络和其他容器网络；是否连 loopback 上的同容器服务仍取决于容器内进程布局。[Docker none network](https://docs.docker.com/engine/network/drivers/none/)
- Docker 默认 seccomp profile 是 allowlist，官方称会禁止约 44 个系统调用，并列出 namespace、kernel module、BPF、reboot 等重要限制。[Docker seccomp](https://docs.docker.com/engine/security/seccomp/)
- Rootless mode 把 daemon 与容器都放入 user namespace，以非 root 用户运行，用于降低 daemon/runtime 漏洞后果。[Docker Rootless mode](https://docs.docker.com/engine/security/rootless/)

**不能封闭：**

- 容器共享宿主内核，不是虚拟机；内核和容器 runtime 漏洞仍在威胁模型内。
- bind mount 会按配置重新暴露宿主路径；可写 mount 就是明确的宿主写能力。挂载 Docker socket 等于授予操纵 Docker daemon 的能力。Docker 官方直接警告 `--privileged` 不是安全沙箱，可取得宿主控制。
- 默认 bridge 不是“无网络”；host network/PID、设备、GPU、额外 capabilities、seccomp unconfined 都会放宽边界。
- 只读 rootfs 不限制已挂载可写卷，也不限制网络、CPU、内存或进程；每项仍需独立配置。

**结论：** 对安装、构建、Preview、Render 的任意项目代码，容器或等价的 mount/PID/network/user namespace + cgroup + seccomp/LSM 是能够同时封文件、进程、网络和资源的本地基础边界。安全性取决于具体 profile，而不是“用了 Docker”这一标签。

## 三、对 Narracut 决策的事实约束

以下是基于上文事实的**架构推论**，不是本研究替地图做出的最终产品决定：

1. **把执行拆成不同阶段与身份。** 至少区分 Agent 编辑、依赖解析/下载、安装脚本、bundle、Preview、composition metadata 计算、最终 Render；每阶段使用新的精简环境和显式 mount/network policy，不复用 Narracut 服务进程权限。
2. **依赖下载与不可信执行分相。** 下载阶段需要 registry 网络但不需要项目输出写权；安装脚本阶段默认不执行，确需执行的包走版本化 allowlist，并在无秘密、无宿主私网、低权限的边界内运行。
3. **项目输入只读，输出单写点。** 构建/Render 应只读挂载不可变项目快照与依赖快照，只写独立临时目录和一个输出目录；不要挂 Narracut 仓库、用户 home、SSH/cloud 凭据、Docker socket。
4. **环境变量使用从零构造的 allowlist。** Node 子进程默认继承 `process.env`，所以“删已知 secret”不够；Remotion Node API 本身支持只向 Composition 注入显式 `envVariables`，应利用这个方向。
5. **网络必须在 OS/容器层决定。** Preview 若允许取本地 HTTP 资产，应为资产服务建立单一、只读、带不可猜测/受控路径的入口；Render 最稳妥是 network namespace 无出口，资产预先冻结在只读输入中。若必须联网，至少区分公网 allowlist、loopback、link-local 与私网，不能只靠域名/CORS。
6. **不要把 Remotion Chromium 当第二个沙箱。** `--no-sandbox` 是 `4.0.512` 的确定行为；外层 sandbox 必须能承受浏览器进程完全被攻陷。是否能修改 Remotion 启动参数不是当前公开 API 给出的承诺，应假设不能靠它修复。
7. **资源与回收属于隔离规格。** Render 可并行启动多个页面/媒体流程；需要 cgroup/ulimit、PID namespace、超时、进程组或容器级销毁来保证 CPU、内存、进程、临时磁盘和取消后的子孙进程被收回。
8. **Preview 与 Render 可以同 bundle，但不必同权限。** 用户交互 Preview 可在正常沙箱浏览器、独立 origin 和严格桥接协议中运行；最终 Renderer 可在无网络容器内运行同一不可变 bundle。视觉同源不要求共享危险的进程权限。

## 四、尚需原型验证

以下问题不能仅凭公开文档定案，适合后续 prototype ticket；验证应在一次性容器/测试用户中进行，不要在开发者主环境直接执行恶意样例。

1. **Remotion `4.0.512` 是否接受源码 inline loader。** 制作无害 loader，尝试 `import 'loader!./resource'`，记录它能否在默认 `bundle()` 配置中读环境、写构建边界外 marker、发起网络。若能，规格必须静态拒绝 inline loader 或把构建视作任意 Node 执行；若不能，也要锁定导致拒绝的配置与回归测试。
2. **`publicDir` 符号链接逃逸的确切产物。** 分别测试指向项目外文件/目录的 symlink，观察 bundle 是复制内容、保留链接还是运行时跟随；随后决定构建前 canonical-path 扫描还是 mount 级封闭。
3. **Studio API 可达性。** 在最终 iframe/Studio 接法中，从 Composition 代码调用 `writeStaticFile()`、`deleteStaticFile()`、`saveDefaultProps()`，验证 server 的 origin、path 和授权检查；在结果前不要把 Studio 视为只读 Preview。
4. **Preview/Render 网络探针。** 对公网、DNS、loopback、宿主网关、link-local、RFC1918、Unix socket 代理分别探测请求是否能发出、响应是否能读取；区分浏览器 SOP/CORS/PNA、Remotion flags 与外层网络 namespace 的效果。
5. **Renderer 的实际子进程/文件清单。** 用 `strace`/audit/eBPF 或容器审计记录 `bundle()`、`selectComposition()`、`renderMedia()` 的 `openat`、`execve`、socket、临时路径与峰值资源，形成可维护的 mount/seccomp/cgroup profile。
6. **Node Permission Model 兼容性。** 在目标 Node 版本上以 audit mode 跑完整 Bundler/Renderer，确认 Remotion、Chromium 启动、native compositor、Worker、现有 fd 等需要的 grants；只把结果作为纵深防御，不把 audit 通过当恶意代码隔离证明。
7. **环境泄露回归。** 在 Agent、install、bundle、Preview、Render 各阶段植入不同 canary 环境变量，验证只有 allowlist 值进入对应进程和浏览器；特别覆盖 CLI `.env` 行为与 Node API `envVariables` 行为。
8. **容器 hardening 与 Chromium/编码兼容。** 组合非 root/rootless、只读 rootfs、`--cap-drop=ALL`、no-new-privileges、默认/定制 seccomp、`--network none`、tmpfs、PID/memory/CPU 限制，验证软件渲染与 GPU 两条路径；GPU 设备透传需要单独威胁模型。
9. **取消与进程树回收。** 在安装、bundle、Render 中创建无害 detached 子进程，触发取消/超时/崩溃，验证容器或 cgroup 销毁后无孤儿进程、端口和临时文件残留。
10. **资产服务最小协议。** 验证浏览器只需哪些 GET/Range/CORS 响应，确保服务不提供目录遍历、任意 file URL、写 API或 SSRF 代理；将 Preview 与 Render 的访问日志对齐。

## 五、证据边界

- 已证实的是 Remotion `4.0.512` 自身启动 Chromium 时关闭其 OS sandbox 和 Site Isolation；**没有**声称普通网页 JavaScript 因此自动获得 Node API 或任意文件读取。
- 已证实 Webpack loader 能执行任意 Node 行为且 Webpack 支持 inline loader；**尚未**证实 Remotion `4.0.512` 默认配置允许 Render Program 源码成功使用 inline loader。
- 已证实 Studio 提供文件写删 API；**尚未**证实任意 Composition 在 Narracut 最终嵌入方式下可无条件调用它们。
- 已证实容器提供所列内核隔离原语；**没有**声称默认 Docker 配置或单独 `docker run` 即满足 Narracut 的完整策略。
- 本文没有执行攻击性沙箱逃逸实验。所有“恶意代码后果”均以各官方威胁模型声明的权限边界为上限，具体 profile 仍需上述无害原型验证。

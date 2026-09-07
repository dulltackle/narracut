# 候选离线 Bundle 构建

`OpenedProjectVNext.buildCandidateBundle()` 消费已保存候选的基线，以及 Runtime 投影的 `input`、独立权威 `speech` 和可选取消信号。候选管理器从项目离线库读取字节，在执行前后核对候选与离线库基线；变化时丢弃结果。底层 `buildProgramBundle()` 也可用于已经捕获完整不可变字节的服务调用。两者均不下载依赖、修改锁图或接受候选。

流程先静态读取 `program.json`，拒绝重复字段、无效 UTF-8/JSON、缺失或未知协议版本、非正安全整数格式。未知 Manifest 字段保留为 `MANIFEST_UNKNOWN_FIELD` 警告。随后核验依赖声明、精确锁图、包内传递依赖及离线摘要；缺包只能通过显式依赖协调修复。

安装、构建和 Metadata 分别运行于认证胶囊。安装器校验 tar 路径、链接、校验和和包身份，按锁图连接依赖，并在离线安装阶段执行生命周期脚本。安装树只作为下一阶段输入。类型检查使用应用固定 TypeScript 二进制、类型库和配置，构建使用固定 esbuild，不读取项目构建插件或编译器配置。

项目源码与被打包的第三方模块经 AST 能力检查。当前采用保守子集：允许纯函数、常量绑定、帧轴动画、显式种子随机和具名安全导入；拒绝墙钟、无种子随机、异步/计时器、宿主全局变量、存储、网络、动态导入、动态属性、可变状态、对象扩展及不受支持的构造能力。无法证明合规的库会被阻断，不因包名或作者身份豁免。核心 React/Remotion 文件只有与固定工具链逐字节相同才允许执行。

固定 Runtime 独占 Root、Composition 和 Speech，向项目入口传入深冻结输入。项目 JSX 经过运行时属性校验，不能注入执行标签、事件、DOM 引用、外部地址或 CSS 时间动画。Asset 地址必须来自本次输入。第三方模块也经过同样能力检查；当前不支持需 CommonJS 宿主能力或动态模块解析的第三方库。安装脚本不能依赖未提供的宿主工具。

Metadata 在固定 Chromium 中阻断网络，通过同一 Bundle 检查固定 Composition 格式、总帧数和首帧 Runtime。零 Scene 不调用 Render Program，也不伪造一帧。此检查不替代后续代表帧、Preview Bridge 或最终 Render 验收。

成功返回的 `ProgramBundle` 包含完整文件字节指纹、执行环境指纹、程序和输入身份、Runtime 状态及警告。环境指纹覆盖胶囊、编译器、Runtime、检查器和 Metadata 驱动。`files()` 始终返回副本；对象没有更新接口，构建失败不会覆盖上一成功 Bundle。Bundle 是派生产物，不写入可移动修订。后续 Preview/Render 层负责缓存、实例绑定和过期展示。

验证命令：`pnpm typecheck` 与 `pnpm exec vitest run tests/program-bundle.test.ts`。真实成功路径要求 [执行胶囊环境](execution-capsule.md)，不以宿主执行或模拟后端代替。

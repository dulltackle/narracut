# Project VNext 执行胶囊

规范来源是 [Project VNext 第 9 节](spec/project-vnext.md) 与 [ADR-0011](adr/0011-run-preview-and-render-from-one-isolated-bundle.md)。本模块提供六个执行阶段共用的 OS 隔离边界；候选构建、Preview Bridge 和最终 Render 的业务编排由对应模块接入。

## 入口与认证

`localExecutionCapsule()` 从应用安装位置复制固定 Node、动态库、Shell、Remotion Chromium 与字体，生成只读工具链快照。项目不能指定宿主可执行路径、环境变量、挂载、资源预算或替代后端。工具链文件、Linux 内核与控制工具的字节身份进入执行环境指纹。

首次执行前，`certify()` 在各阶段运行文件、环境、网络和权限夹具，再通过同一后端的小型认证预算实际触发 PID、磁盘、日志和墙钟限制，并验证固定浏览器页面执行与截图。自检失败不执行调用者代码。每次任务在收到隔离内的就绪消息后，再核验 systemd 实际服务属性，才开放执行。日常认证不主动耗尽内存；内存限额核验与专项 OOM 测试见下文。

需要 Linux、支持完整用户/网络/PID/cgroup 命名空间及禁止嵌套用户命名空间的 bubblewrap、可用的用户 systemd 服务与内存/PID cgroup 控制器，以及应用已安装的 Remotion Chromium 和明确选定的 DejaVuSans.ttf 基础字体。缺少任何能力时返回 `CAPSULE_UNAVAILABLE` 或 `CAPSULE_SELF_TEST_FAILED`；不会安装工具、下载浏览器或退化为宿主执行。

## 阶段输入与输出

`run()` 接收精确文件名到字节的映射，复制输入后执行指定 Node 入口。它只接受以下文件名前缀；路径逃逸、未知角色、过多文件和过大输入会被拒绝。依赖安装或构建需要的包管理器及构建程序必须作为相应精确输入携带。

| 阶段 | 允许输入 | 工具链 | 唯一输出 |
| --- | --- | --- | --- |
| 依赖下载 | 固定 npm 包名、精确版本、SHA-512 摘要 | Node 与应用校验程序 | 包字节 |
| 安装脚本 | `dependencies/` | Node、Shell | 安装树 |
| 构建 | `program/`、`runtime/`、`dependencies/` | Node、Shell | Bundle |
| Metadata | `bundle/`、`input/` | Node、固定浏览器和字体 | 结构化结果 |
| Preview | `bundle/`、`input/`、`media/` | Node、固定浏览器和字体 | Preview 产物 |
| Render | `bundle/`、`input/`、`media/` | Node、固定浏览器和字体 | 渲染产物 |

安装脚本、构建、Metadata、Preview 和 Render 没有外网。下载使用 `downloadPackage()`，不能提交项目入口：唯一声明的宿主代理只获取固定公共 npm registry 的包字节，拒绝凭据、非 HTTPS、跨 registry 重定向和超限响应。在服务限额生效之后代理才开始读取响应，包字节在胶囊内外均验证完整性，不执行生命周期脚本。

胶囊只挂载选定工具链文件和本次复制的输入，根与输入只读。输出写入胶囊自己的 `/output` tmpfs，不挂载宿主输出目录。`/tmp`、普通临时文件组成的 `/dev`、`/dev/shm` 分别限额；不挂载宿主设备、用户目录、项目根、Docker socket 或应用 API。环境从零构造，固定 UTC、C.UTF-8、字体配置、浏览器和 SwiftShader 路径。浏览器调用使用导出的 `CAPSULE_BROWSER_ARGUMENTS`；其中关闭 Chromium 自有 sandbox 的参数只用于已认证的 OS 胶囊内，不代表宿主执行许可。基础字体只复制单个文件并计入指纹，不读取宿主字体目录。

## 固定资源预算

各阶段内存、PID、临时磁盘、输出和墙钟预算以[执行胶囊的 `CAPSULE_POLICIES`](../src/server/execution-capsule.ts)为准，日志、输入输出及共享内存限额也在该模块维护。排查超限时核对实际阶段及对应预算；项目不能自行扩大限制。日志不原样返回，避免把项目输出当作可信诊断或泄漏秘密。

## 销毁与发布

服务使用 `KillMode=control-group`、`OOMPolicy=kill`、`RuntimeMaxSec` 和最终 SIGKILL。取消、超时与失败都会停止整组进程；正常结束也先清理 namespace 中的子孙进程。只有等待整组服务结束、输出结构与容量检查通过、调用者提供的业务校验返回成功后，`run()` 才返回输出。业务校验必须核对期望文件、格式与绑定身份；胶囊认证不代替 Bundle 或视频内容验收。

`CAPSULE_TIMEOUT`、`CAPSULE_RESOURCE_EXCEEDED`、`CAPSULE_OUTPUT_INVALID` 与 `CAPSULE_EXECUTION_FAILED` 均丢弃输出。`CAPSULE_CANCELLED` 表示用户取消，应由调用方作为取消状态处理，不生成内容诊断。失败后可以重新认证；工具链变化会改变指纹，后续验收必须重新绑定。

## 验证

在具备上述真实能力的环境执行：

```sh
pnpm typecheck
pnpm exec vitest run tests/execution-capsule.test.ts tests/project-dependencies.test.ts
```

这些测试实际启动受限用户服务，不以伪造后端或检查命令文本替代隔离验收。registry 响应使用已有协议级可控替身，因此不访问公网。测试能力缺失会失败；应用自身则稳定失败关闭。

### 内存诊断

日常认证保留各阶段隔离、PID、临时磁盘、日志、超时及浏览器自检，但不主动耗尽内存。每次执行仍先核验 systemd 的 `MemoryMax`、`MemorySwapMax=0`、`OOMPolicy=kill` 和整组进程清理策略；属性不符合预期时阻断执行。真实项目超出内存限额时仍由内核终止，输出丢弃并返回 `CAPSULE_RESOURCE_EXCEEDED`。

内核实际执行内存限额及 OOM 结果翻译由显式专项测试覆盖：

```sh
pnpm test:capsule:oom
```

该命令在 128 MiB 胶囊中故意触发 OOM，并观察真实 systemd `Result=oom-kill` 信号。GNOME 可能因此显示“设备内存接近占满”的通知；这是诊断的预期副作用。普通 `pnpm test:unit` 会跳过此专项测试，并验证日常认证不产生该信号。

日常认证不再证明当前内核实际执行过 OOM kill；更换内核、systemd 或胶囊后端后，应显式运行此专项测试。真实项目 OOM 的系统通知仍可能出现。

原因见 [GNOME Settings Daemon 的通知实现](https://github.com/GNOME/gnome-settings-daemon/blob/gnome-46/plugins/housekeeping/gsd-systemd-notify.c)：它根据服务的 `Result=oom-kill` 发出通知，没有区分整机内存不足和胶囊自身限额。因此，减少认证次数不能代替将主动 OOM 留在专项诊断中。

## 维护事项

2026-09-11 对照代码与测试重新核对，来源为 2026-09-07 胶囊交接（读取方式见[历史追溯](README.md#历史追溯)）。工具链孤儿目录回收已随 `20e8f89` 提交；以下两项仍为待评估或待覆盖事项。

- **重复认证的缓存作用域**：[ExecutionCapsule.certify()](../src/server/execution-capsule.ts) 仍在实例上缓存认证 Promise，独立测试进程不能共享。原记录提出按执行环境身份建立跨进程缓存；这仍是待评估方案，尚未决定或实现。
- **孤儿目录回收的自动化覆盖**：[reclaimOrphanSnapshots()](../src/server/capsule-toolchain.ts) 已实现；当前测试未专门覆盖属主已死、属主存活和缺失 owner 标记三类回收判定。原会话仅记录手工验证。

原记录中的临时目录清理命令、测试耗时及并发失败只属于当时环境；若处理相关问题，应重新确认当前状态。

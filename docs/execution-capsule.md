# Project VNext 执行胶囊

规范来源是 [Project VNext 第 9 节](spec/project-vnext.md) 与 [ADR-0011](adr/0011-run-preview-and-render-from-one-isolated-bundle.md)。本模块提供六个执行阶段共用的 OS 隔离边界；候选构建、Preview Bridge 和最终 Render 的业务编排由对应模块接入。

## 入口与认证

`localExecutionCapsule()` 从应用安装位置复制固定 Node、动态库、Shell、Remotion Chromium 与字体，生成只读工具链快照。项目不能指定宿主可执行路径、环境变量、挂载、资源预算或替代后端。工具链文件、Linux 内核与控制工具的字节身份进入执行环境指纹。

首次执行前，`certify()` 在各阶段运行文件、环境、网络和权限夹具，再通过同一后端的小型认证预算实际触发 PID、磁盘、内存、日志和墙钟限制，并验证固定浏览器页面执行与截图。自检失败不执行调用者代码。每次任务在收到隔离内的就绪消息后，再核验 systemd 实际服务属性，才开放执行。

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

| 阶段 | 内存 MiB | PID/线程 | `/tmp` MiB | 输出 MiB | 墙钟秒 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 依赖下载 | 256 | 64 | 64 | 32 | 30 |
| 安装脚本 | 512 | 64 | 256 | 128 | 60 |
| 构建 | 1024 | 64 | 256 | 128 | 120 |
| Metadata | 1024 | 256 | 64 | 4 | 30 |
| Preview | 1024 | 256 | 128 | 64 | 120 |
| Render | 2048 | 256 | 512 | 256 | 300 |

各阶段日志总计最多 1 MiB；临时 `/dev` 最多 1 MiB、共享内存最多 16 MiB，均计入 cgroup 内存，禁止 swap。输入最多 4096 个文件，字节数不超过该阶段临时磁盘预算；输出最多 1024 个普通无硬链接文件、16 层目录。日志不原样返回，避免把项目输出当作可信诊断或泄漏秘密。

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

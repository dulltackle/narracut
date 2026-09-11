# 候选依赖协调

`coordinate_project_dependencies` 是修改候选 `package.json`、`pnpm-lock.yaml` 与项目离线依赖库的唯一插件工具。调用前显式创建候选并读取 `baseline`；普通候选 `apply` 不能修改依赖文件。

```json
{
  "projectDirectory": "/绝对路径/项目",
  "projectId": "项目身份",
  "baseline": "读取候选得到的基线",
  "dependencies": { "包名": "1.2.3" },
  "packages": [
    { "name": "包名", "version": "1.2.3", "integrity": "sha512-公共registry提供的规范Base64摘要" }
  ]
}
```

`dependencies` 合并到现有直接依赖。`packages` 为新增或更新的包提供精确版本和 SHA-512；已有锁图里的精确包可以复用。传递依赖和 peer 依赖必须由这两者提供满足包声明的精确选择；缺少选择会报错，不猜测最新版本。同名包可以提供多个精确版本；优先使用兼容的直接依赖，否则在已固定的版本中确定性选择兼容版本，不访问版本列表。未被引用的新增包、非公共来源、凭据、范围形式的直接版本，以及与 Runtime 不同版的 Remotion 包均被拒绝。

协调器只向 `https://registry.npmjs.org` 请求由包名和版本确定的 tarball，逐跳检查重定向，并校验 SHA-512、tar 路径、条目类型和包内名称/版本。包只作为数据解析，不落盘解包、不读取项目 npm 配置、不调用包管理器，也不运行生命周期脚本。不能安全解析的归档格式失败关闭。

候选指针同时引用完整程序树、上一份恢复检查点和按 SHA-512 十六进制摘要命名的 `.tgz` 离线库。新一代全部写入并同步后，才通过一次 rename 发布指针；提交前失败会删除临时输出。已有离线包随每一代保留，放弃候选只删除候选和检查点，离线库仍保留。首次协调会同时补齐当前候选、恢复检查点和全部保留修订锁图中的包；损坏或缺失的包只能通过显式协调原子修复。当前不回收任何包，因此不会误删候选、检查点或保留修订的依赖。

打开、读取和普通候选修改只验证已有字节，不补包或改锁。执行侧应只消费已验证的锁图和离线包，缺失或损坏必须失败关闭。安装脚本、构建、Preview 与 Render 的 OS 胶囊由独立执行层负责，本协调器没有执行项目代码的入口。不能把本模块的下载能力交给这些执行阶段。

## 执行链路验证（Issue #73）

运行以下验证需要 Linux、bubblewrap、用户 systemd 和本地固定工具链；外层沙箱必须允许测试访问用户 systemd。

```sh
pnpm exec vitest run tests/project-dependencies.test.ts tests/execution-capsule.test.ts tests/project-preview.test.ts tests/project-render.test.ts tests/dependency-execution-verification.test.ts
pnpm typecheck
```

- 胶囊认证在 download、install、build、metadata、preview、render 六个阶段分别真实尝试连接回环、元数据地址和公网 IP，任何连接成功或无法确定边界均使认证失败。下载由固定 registry 的宿主字节代理完成；项目不能向 download 阶段提交执行代码。
- 依赖测试覆盖越界重定向、摘要篡改、恶意归档和整批回滚。下载响应使用受控归档，不依赖公网 npm 的实时可用性；OS 胶囊、安装、构建、浏览器与渲染均真实执行。
- 跨阶段联验在显式协调后禁止宿主 fetch，比较候选、检查点、保留修订的声明和锁文件及离线包摘要，覆盖检查、当前与候选 Preview、完整验收、清空缓存后的 MP4 Render、从历史修订创建回退候选及重开。回退允许原子迁移代目录，离线包按摘要名称和内容比较，不能因目录变化误判回收。
- 缓存丢失可离线重建；离线包损坏或缺失只报告失败，必须通过显式协调修复。

构建器也能只读消费初始修订中 pnpm 生成的 peer 上下文快照（例如 `react-dom@19.2.8(react@19.2.8)`）。它把精确引用解析为离线包身份，仍校验快照引用、包摘要和依赖范围；同一包版本有多个上下文时拒绝，避免合并不同依赖图。该兼容不改写既有修订或锁文件，也不触发依赖下载。

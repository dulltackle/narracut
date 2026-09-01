# DSL 的权威副本在前端内存，Node 服务对 DSL 结构无知

> **状态：Legacy，已由 [ADR-0008](./0008-project-vnext-normative-architecture.md) 整体替代。** Project VNext 在客户端提交前与服务端落盘前独立复核严格 DSL，以项目写入租约和原子提交协调持久状态；不继承“Node 不理解 DSL”或无并发写假设。

多数人的直觉是把数据模型放在服务端。本项目反过来：**前端（Zustand）持有整个编辑模型，是编辑期的唯一权威；Node 服务对 `project.json` 只有「整份读」和「整份写」两个操作，不解析、不合并、不理解结构。** 理由是这是单用户、单窗口、无并发写的本地工具——服务端建模换不来任何东西，却会逼出两套 DSL 模型（Zod schema 跑两遍、前后端版本漂移）。由此得到一句能说清的边界：

> **Node 服务是文件系统与外部世界的代理，它不理解 DSL；前端持有整个编辑模型，它不碰文件系统。**

- 决策出处：[07 — 渲染管线与前后端边界](https://github.com/dulltackle/narracut/issues/12)。

## Consequences

- **Undo/Redo 与 autosave 完全是前端的事**，服务端不参与。写盘是防抖的整份 `PUT`。
- **渲染期间可以自由继续编辑**。点渲染时，前端把当前内存里的整份 DSL POST 给 Node，Node 立刻落成**渲染快照**；渲染进程只读快照，永不读 `project.json`。两者从此互不见面。
- **快照冻住的是 JSON，不是素材文件**。用户在渲染途中替换 `assets/` 下的文件，成片会用新素材。这是明确接受的风险——为它复制 20 段视频，代价与收益完全不成比例。缓解手段是渲染启动前做一次全量素材校验，把绝大多数问题挡在渲染开始之前。
- **一次渲染 = 项目文件夹下的一个目录**，关联关系靠同目录表达，不需要索引文件：

  ```
  <项目根>/renders/<ISO 时间戳>/
      project.snapshot.json
      out.mp4
      render.log
  ```

- **渲染、TTS 生成、（未来的）转码统一成一个 Job 概念**：`{ id, kind: 'render' | 'speech' | 'transcode', status, progress, error, createdAt }`。Job 表只在内存里，不落盘——服务重启就重跑，为持久化 job 状态引入数据库是本末倒置，真正要持久的产物本来就在 `renders/` 里。
- **每个 Job fork 一个独立子进程**。`renderMedia` 会拉起 headless Chromium 并按 `concurrency` 吃掉半数 CPU 线程，同进程会拖死素材服务与 API；更关键的是渲染崩溃或 OOM 不能带崩编辑器，用户手上那份还没存的编辑不能陪葬。
- **Asset 导入不越过这条边界**。浏览器把一个导入源以 multipart 交给 Node；Node 只负责探测、规范化和返回 `{assetId, kind, path}` 及运行时媒体事实，不读取或修改 DSL。前端只在 Job 成功后把 Asset 写入内存模型。一个导入源对应一个 `transcode` Job，服务端 FIFO 排队且最多运行一个；临时文件经复核后原子改名，失败或取消不产生 Asset。
- **媒体探测结果不落 DSL**。`frameCount`、编码、分辨率、色彩和帧率都是磁盘文件的运行时事实；前端解析 DSL 后把去重的项目相对路径交给 Node 探测，再由共享校验器关联回 Asset 与 Scene。打开项目不自动转码或修复，render worker 仍在开工前独立复核。
- **视频首帧缩略图同样不落 DSL**。Node 不读取 Asset 声明或 Scene 结构，只对请求给出的、经过项目根包含校验的相对文件路径抽帧；结果仅进入服务端和标签页内的有界内存缓存，不要求编辑租约。
- **进度走 SSE**（`GET /api/jobs/:id/events` + 原生 `EventSource`），不轮询。渲染是分钟级且逐帧回调，轮询要么粒度粗到没用、要么请求密到难看。取消走独立的 `POST /api/jobs/:id/cancel`。
- **接口清单**（单服务单端口，默认 3579，占用则递增；开发期 Vite proxy `/api` 与 `/media`）：

  | 方法 | 路径 | 说明 |
  |---|---|---|
  | GET | `/api/project` | 整份 DSL；Node 不解析其结构 |
  | PUT | `/api/project` | 整份写盘，防抖 autosave 调用 |
  | POST | `/api/assets/import` | 单文件 multipart 导入源 → 返回 `transcode` Job |
  | POST | `/api/assets/probe` | 项目相对路径列表 → 返回存在性与运行时媒体事实 |
  | GET | `/api/assets/thumbnail?path=<相对路径>` | 无租约地派生 320×180 JPEG 视频首帧；不读取 DSL，不写项目目录 |
  | POST | `/api/speech` | TTS 代理（key 只在 Node 侧），落 `speech/`，返回 Job |
  | POST | `/api/render` | body 是前端内存里的整份 DSL → 落快照 → 返回 Job |
  | GET | `/api/jobs/:id/events` | SSE 进度流 |
  | POST | `/api/jobs/:id/cancel` | 取消 |
  | GET | `/media/<相对路径>` | 项目根映射，见 [ADR-0001](./0001-asset-addressing-via-local-static-server.md) |

- **TTS key 存应用安装目录的 `.env`，前端永远不接触它**。key 绝不进项目文件夹——项目要能整体打包给别人。将来有安装器时（应用目录可能只读）改读 `~/.config/narracut/`，那是一个函数的事。

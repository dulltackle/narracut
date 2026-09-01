# Project VNext 规范

> **状态：规范性。** 本文件是 Project VNext 的格式、产品接口、状态机、门禁、错误语义、资源边界与测试边界的唯一规范性来源。实现不得从旧 Project 规格、旧 ADR 或历史 issue 反推额外行为。

Project VNext 是对 Project DSL V1–V3、封闭 Visual Type、Text Preset、固定 Composition 与独立浏览器工作台的破坏性替代。Narracut 只正向识别 Project VNext；不兼容、不迁移、也不以只读方式打开 Legacy Project。

## 1. 规范词与权威分工

本文中的“必须”“不得”表示强制要求，“可以”表示允许但不强制。正式术语以 [`CONTEXT.md`](../../CONTEXT.md) 为准。

- 本规范定义可观察产品行为、持久格式、公开协议、状态机、门禁与错误语义。
- [`CONTEXT.md`](../../CONTEXT.md) 只定义领域术语，不补充产品行为。
- [ADR-0008](../adr/0008-project-vnext-normative-architecture.md) 及其四份边界 ADR 只记录取舍、替代关系与被否方案，不复制一套平行规范。
- 实现、测试和界面文案与本文冲突时，以本文为准；本文未决定的细节必须另行决策，不得从 Legacy 行为推断。

## 2. 产品边界与工作区

Narracut 由 Codex 插件承载完整工作台。工作台有两个稳定顶层工作区，始终共享当前项目、所选 Scene、候选状态与底部 Composer：

- **表格工作区**是 Narration、Asset、Speech 和 Scene 顺序的唯一写入入口。
- **Agent 工作区**围绕 Video Brief、当前项目内容、当前修订与候选 Preview 发起和审核 Agent 创作任务。

切换工作区不得停止 Agent 创作任务，也不得改变候选、所选 Scene 或 Composer 内容。Agent、Render Program 和 Preview Bridge 都没有 Scene 写能力；Agent 需要 Scene 变化时只能生成 Scene 修改建议，由用户回到表格工作区手工完成。

Agent 工作区最多同时展示当前版本与候选版本两个 Preview 槽位。候选交付必须包含目标、变更摘要、输入新鲜度、检查结果、候选 Preview、非阻断警告和 Scene 修改建议。Agent 不得自动接受候选。

## 3. 项目识别与目录契约

项目是可以整体移动的目录。只有根目录中存在且严格有效的 `narracut.json` 才是 Project VNext。

### 3.1 项目清单

`narracut.json` 必须是严格 JSON，且只含以下字段：

```json
{
  "kind": "narracut-project",
  "formatVersion": 1,
  "projectId": "00000000-0000-4000-8000-000000000000"
}
```

- `kind` 是固定字符串 `narracut-project`。
- `formatVersion` 只接受整数 `1`。
- `projectId` 是创建时生成的 UUID；移动项目不改变它，正式复制必须生成新值，手工复制保留原值。
- 根对象拒绝未知字段；不得把显示名、路径、时间、兼容版本或迁移标记写入清单。
- 打开目录不得创建、补全、修复或升级清单。

### 3.2 持久内容

Project VNext 的持久内容至少包含：

```text
<project>/
  narracut.json
  project.json
  video.md
  assets/
  speech/
  renders/
  <Render Program 当前修订、候选、检查点、历史、离线依赖与任务检查点的格式内存储>
```

`narracut.json`、`project.json`、`video.md`、`assets/`、`speech/` 与 `renders/` 是固定根路径。#60 只决定了其余状态的身份和原子语义，没有决定其字面内部路径；实现不得自行把某种尚未决策的布局写成兼容承诺。任何持久状态都不能由宿主缓存或聊天记录补全。

安装树、Bundle、Preview、浏览器、系统镜像、完整日志、代表帧图片和原始工具输出都是可重建派生产物，不属于可移动项目内容。

### 3.3 文件与 JSON 资源边界

所有环境和所有入口使用同一组格式级资源边界：

| 输入 | 最大字节数 |
| --- | ---: |
| `narracut.json` | 4 KiB |
| `project.json` | 10 MiB |
| `video.md` | 2 MiB |
| 恢复信封 | 20,622,000 字节 |

严格 JSON 读取器还必须执行以下格式级预算：

| 内容 | 固定预算 |
| --- | --- |
| `narracut.json` | JSON 深度 4；对象字段 16；节点 32；禁止数组；普通字符串 256 个 Unicode 标量且不超过 1 KiB UTF-8 |
| `project.json` | JSON 深度 8；数组项总数 100,000；对象字段总数 32,000；节点总数 200,000 |
| DSL 普通字符串 | 65,536 个 Unicode 标量且不超过 256 KiB UTF-8 |
| DSL 路径 | 1,024 个 Unicode 标量且不超过 1,024 UTF-8 字节 |
| `ttsProfileId` | 256 个 Unicode 标量；UUID 与摘要继续使用精确格式 |
| DSL 产品数组 | `assets`、`scenes` 各最多 1,000 项；每个 Scene 最多 256 个 Asset 引用 |
| `video.md` | 不另设行数、字符数、Markdown AST 或结构上限 |
| 恢复信封元数据 | JSON 深度 16；数组项 1,024；对象字段 4,096；节点 8,192；普通字符串 32,768 个 Unicode 标量且不超过 128 KiB UTF-8 |
| 所有 JSON 数字字面量 | 最多 64 个 ASCII 字节；具体数值范围由对应 Schema 决定 |

字符按 Unicode 标量计数，不按 UTF-16 code unit 或用户感知字形计数。JSON 根容器深度计为 1，每进入一个对象或数组增加 1；对象、数组和每个值各计一个节点；对象成员计入字段数；各数组元素累加计入数组项总数。字段名受普通字符串限制。全部最大值都是包含端点的 `≤`，不得使用机器内存、运行平台或解析器默认值作为隐式上限。

恢复信封总上限按 `Base64(10 MiB) + 2 × Base64(2 MiB) + 1 MiB` 推导，其中标准 Base64 长度为 `4 × ceil(原始字节数 ÷ 3)`，1 MiB 是元数据余量。元数据实际用量等于信封原始字节数减去全部 Base64 字符串内容的原始 ASCII 字节数。

`narracut.json`、`project.json` 与恢复信封必须：

- 在解析前检查字节上限和严格 UTF-8；
- 拒绝 BOM、无效 UTF-8、重复 JSON 字段、非法数字、超限嵌套和未知字段；
- 在 Schema 后执行跨引用和文件一致性校验；
- 在客户端提交前与服务端落盘前独立复核；
- 聚合有界诊断，最多展示 100 条，稳定排序、去重并明确截断。

资源预算违规立即失败，只产生一条确定性诊断。资源诊断使用 `PROJECT_CONTROL_FILE_INVALID_UTF8`、`PROJECT_CONTROL_FILE_LIMIT_EXCEEDED`、`RECOVERY_SNAPSHOT_LIMIT_EXCEEDED`、`RECOVERY_PAYLOAD_LIMIT_EXCEEDED` 或 `DIAGNOSTICS_TRUNCATED`，携带 component、metric、安全可得的 actual、limit 与截断 JSON 路径，不包含原始内容。HTTP 413 只能作为传输映射，不能替代结构化诊断。

`project.json` 由应用按固定键序写成紧凑 UTF-8 JSON，不含 BOM 或尾随换行。合法外部空白与键顺序可以读取；未修改文件不得仅因打开而重写。`narracut.json` 与 `project.json` 禁止 UTF-8 BOM；`video.md` 中合法 U+FEFF 作为原始内容保留。不做 Unicode、换行或 JSON 规范化，摘要覆盖实际原始字节。

应用内粘贴、增加 Scene/Asset、修改 Narration 或 Brief 等操作如果将越界，必须原子拒绝并保留此前合法状态。既有超限文件没有祖父条款：读取或解析内容前失败关闭，不自动截断、迁移、保存或塞入恢复载荷。已打开项目的磁盘文件被外部替换为超限内容时，停止自动保存、保留当前合法内存副本，但不得读取或覆盖超限磁盘字节。

## 4. Project DSL

`project.json` 是表格工作区拥有的最小内容 DSL，不保存项目身份、显示名或成片表现。

```text
Project {
  assets: Asset[],
  scenes: Scene[]
}

Asset {
  id: UUID,
  path: ProjectRelativePath
}

Scene {
  id: UUID,
  narration: { text: string },
  assetIds: UUID[],
  speech?: {
    path: ProjectRelativePath,
    durationMs: positive integer,
    sourceTextHash: "sha256:<lowercase hex>",
    ttsProfileId: string
  }
}
```

根对象和全部子对象拒绝未知字段；可选值以字段缺省表达，禁止用 `null` 表示缺省。`project.json` 不得包含 `schemaVersion`、metadata、项目名、Visual、Caption、Theme、Style、Motion、Transition、Composition、帧号或运行时媒体事实。

### 4.1 ID、顺序与草稿

- Asset ID 和 Scene ID 在项目内分别唯一且稳定；复制 Scene 或再次导入文件生成新 ID。
- `scenes[]` 的顺序是权威 Scene 顺序；每个 Scene 在 Runtime 输入中恰好出现一次。
- `assetIds[]` 是有序且不重复的 Asset 引用；每个引用必须命中登记表。
- 草稿允许零 Scene、空 Narration、Scene 没有 Asset 和 Scene 缺 Speech。
- Render-ready 要求至少一个 Scene，且每个 Scene 都有非空 Narration 和与当前文本及合成配置匹配的完整 Speech；Asset 不是 Render-ready 的必选项。

### 4.2 Asset

Asset 是 `assets/` 下已登记的任意格式普通文件。DSL 只保存稳定 ID 和唯一项目相对路径，不保存 kind、MIME、尺寸、编码、来源或内容摘要。

- 路径必须是规范的项目相对路径，不能越出项目根，不能指向控制文件。
- Asset 不得是目录、符号链接或特殊文件。
- 导入源永不原地登记；导入必须逐字节复制到 `assets/`，成功后才登记。
- Scene 可以不引用 Asset；未被任何 Scene 引用的 Asset 不进入 Render Program Input。
- 文件不可用的已引用 Asset 仍进入输入并标记 unavailable，但不得获得读取地址。
- 项目不为每次 Render 复制全部 Asset。

### 4.3 Narration 与 Speech

Narration 与 Speech 是表格工作区权威。Speech 是当前 Narration 与 TTS 配置的完整派生记录；文本或配置变化后，Scene 不再拥有匹配的 Speech，不持久化 Stale Speech 状态。

存在的 Speech 必须使用固定项目相对路径 `speech/<sceneId>.mp3`，并与该 Scene ID、Narration 原始 UTF-8 字节摘要和当前 TTS profile 匹配。

每个 Scene 的 `durationMs` 必须分别向上量化为整数帧，再按 Scene 顺序累计半开 Scene Time Window。不得先累计毫秒后统一取整，不得四舍五入，不得裁剪首尾近静音、增加 Padding 或手动覆盖 Duration。

缺 Speech 的 Scene 使用 Runtime 提供且明确标记的 Draft Duration；它只用于草稿 Preview，可以参与候选接受，但必须阻断最终 Render。零 Scene 项目可以通过 Manifest 与构建检查接受候选，但不能最终 Render。

## 5. Video Brief

`video.md` 必须存在，可以是零字节，内容是严格 UTF-8 的自由 Markdown。缺失或超限表示当前格式内容无效，Narracut 不自动创建或补建。

- 用户编辑与 Agent 写入共用串行、原子、整文件写入队列。
- 保存使用 ETag/If-Match；外部字节变化不得被静默覆盖。
- 用户连续输入、Agent 在当前创作指令明确授权的直写、以及用户接受 Agent 提案，分别形成完整 Video Brief 历史项。
- Video Brief Undo/Redo 与 Scene DSL 历史分离。
- 一般讨论、问题、状态询问、审批回答和含糊偏好不得写入 Brief；Agent 提案必须展示统一 diff 和完整结果。
- 外部冲突保存 BASE/LOCAL/DISK，只允许明确三方合并、放弃 LOCAL 或把 LOCAL 导出到项目外；不提供强制覆盖。
- 已保存 Brief 的原始字节 SHA-256 是 Render Program 复核身份。任何字节变化都标记“Brief 待复核”，但不撤销当前修订、不阻断既有 Preview；只有接受绑定最新版 Brief 的候选才能清除该状态。

## 6. Render Program 与 Runtime 接口

Render Program 是成片表现的独立权威。每个候选或修订中的完整程序树使用以下固定内部布局：

```text
render-program/
├── program.json
├── package.json
├── pnpm-lock.yaml
├── src/
│   └── RenderProgram.tsx
└── resources/
```

`src/` 与 `resources/` 只允许规范项目相对路径下的普通文件和目录；拒绝符号链接、硬链接、特殊文件、路径越界、`node_modules`、Bundle 与缓存。Render Program 不需要项目自带测试；Narracut 不识别项目测试入口或测试脚本为门禁，只运行自己的固定产品契约检查。

项目代码不得注册 Remotion Root 或 Composition。Narracut 的 Render Program Runtime 独占 Root、Composition 骨架、Scene 顺序、Scene Time Window、项目总帧数和权威 Speech 音轨。

`src/RenderProgram.tsx` 必须命名导出项目级 `RenderProgram`，只接收一个 `input: RenderProgramInputV1` 参数。

### 6.1 Manifest

`program.json` 必须是可静态读取的严格 JSON，并声明：

```text
ProgramManifest {
  apiVersion: 1,
  output: {
    width: positive integer,
    height: positive integer,
    fps: positive integer
  }
}
```

Manifest 不得有隐藏默认值、可执行函数或依赖源码计算的字段。不支持的协议主版本失败关闭；同一主版本只能新增可选字段，Render Program 必须忽略未知输入字段。

Manifest 未知字段产生 `MANIFEST_UNKNOWN_FIELD` 非阻断警告，以便同一协议主版本向前扩展；这是本规范对项目清单、Project DSL 和恢复信封“拒绝未知字段”规则的明确例外。Manifest 无效 JSON、Schema、协议主版本或 Output Format 都是硬阻断。

### 6.2 Render Program Input V1

Runtime 向入口只传一个深只读且运行时深冻结的值：

```text
RenderProgramInputV1 {
  apiVersion: 1,
  videoBrief: string,
  output: { width, height, fps },
  durationInFrames: non-negative integer,
  scenes: Array<{
    id,
    narration: string,
    assetIds,
    time: {
      startFrame,
      durationInFrames,
      source: "speech" | "draft"
    }
  }>,
  assets: Array<
    | { id, path, availability: "available", src }
    | { id, path, availability: "unavailable" }
  >
}
```

输入不公开 Project ID、Speech 地址、`sourceTextHash`、`ttsProfileId`、Preview/Render 模式、文件系统或实时项目 API。已经开始的执行只读初始值；项目变化必须创建新输入身份，不能热读 `project.json`。

`durationInFrames` 是全部 Scene Duration 之和。项目没有 Scene 时，Runtime 显示工作区空状态，不调用 `RenderProgram`，也不伪造一帧时间线。

`@narracut/runtime` 只提供 V1 类型和无副作用纯函数：按全局帧定位 Scene、计算 Scene 内帧、按 ID 查找 Asset。它不提供 Scene 写入、宿主 API、文件系统、网络或项目状态读取能力。

### 6.3 表现权威

Render Program 独占画面文字、颜色、字体、Logo、版式、运动、Transition、音乐、音效、Subtitle 呈现和 Asset 播放方式。它可以跨 Scene Time Window 组织视觉层与 Transition，但不得：

- 复制或改写 Narration、Asset 路径、Speech、Duration 成为第二份内容权威；
- 替换、移动、重叠或静音权威 Speech；
- 改变 Scene 顺序、Scene Time Window 或项目总帧数；
- 读取未被 Scene 引用的 Asset；
- 通过 Program Resource 隐藏应当登记为 Asset 的 Scene 来源文件。

## 7. 候选、修订与历史

项目同时最多存在一个候选 Render Program。Agent、人工编辑器与外部工具只能修改候选；没有候选时必须显式从当前修订创建。当前修订本身不可写。

### 7.1 候选与恢复检查点

- 每批成功修改先在临时位置完成，再原子替换候选。
- 每次候选原子替换同时换代唯一候选恢复检查点；检查点保存上一份完整候选，不参与 Preview，也不是第二候选或候选历史。
- 修改失败保留上一候选与上一检查点。
- 接受或放弃候选时同时删除候选恢复检查点。
- 外部工具在任务运行期间改变候选时，Narracut 保留外部字节，丢弃未提交 Agent 修改，作废检查与 Preview 证据，并让任务以 `EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED` 进入等待用户；只有用户明确确认基于外部候选继续后才恢复运行，不得自动合并。

### 7.2 接受与修订

接受对象是候选 Preview 所代表的完整视频状态。接受必须在临时位置完成冻结、校验和写入，最后以单一原子提交：

1. 写入完整、不可变 Render Program 修订；
2. 把单一当前指向关系改为新修订；
3. 消费候选及其恢复检查点；
4. 保存精简 Render Program 验收记录。

提交前失败保留旧当前与候选；提交成功后历史裁剪和遗留文件清理可以幂等重试，不得撤销接受。

每份修订包含 Manifest、源码、依赖声明、锁文件和 Program Resource，并保存稳定修订 ID、完整程序树指纹、前一当前修订 ID、接受时 Brief 指纹、项目输入指纹、接受时间、来源和一行变更摘要。修订不包含项目输入、安装树、Bundle、Preview 或聊天记录。相同程序字节在不同输入下再次接受仍形成新修订。

项目保留最近 20 份已接受修订，包含当前修订；损坏但非当前的修订在自然裁剪前仍占名额且不可比较或回退。历史回退只能从有效修订创建新候选，再针对最新输入完成检查、Preview 与接受；不得直接移动当前指向。

### 7.3 存储完整性失败

源码语法、Manifest、类型或构建失败属于普通诊断；文件不可读、应有文件缺失、修订元数据损坏、程序树指纹不符或当前指向关系不一致才是 Render Program 存储完整性失败。

- 打开项目时同步完整校验当前修订、候选和候选恢复检查点，并检查历史索引与修订基本存在性；历史内容在后台、比较前或回退前完整验证。
- 候选完整性失败时停止任务并保留损坏候选，不自动覆盖。用户可以外部修复后重新检查；也可以先把损坏候选导出到明确的项目外新路径，再用恢复检查点替换；或者明确永久放弃。
- 当前修订损坏时阻断依赖它的 Agent、Preview 与 Render，但表格工作区仍可查看和编辑 Scene、Asset 与 Speech。完整候选可以重新验收；否则从用户选择的有效历史修订创建恢复候选，默认只建议最新有效修订，不自动切换当前。
- 没有有效候选或历史时，只能把人工修复、导入程序或兼容 starter 建成候选，再走正常验收。
- 非当前历史修订损坏时项目继续工作；该修订标记为不可比较、不可回退并显示警告，不立即删除，继续占名额直到自然裁剪。

## 8. Agent 创作任务

每项 Agent 创作任务由一个专用 Codex 创作线程承载，可跨多个 Turn，但同一时刻只能有一个线程拥有该任务和候选写权。另一 Codex 线程打开同一项目时，Narracut 自动中断旧 Turn、撤销旧线程写权并把任务改绑到新线程。

任务运行期间 Video Brief、Scene、Asset、Speech 或其他普通项目输入变化时，Narracut 必须自动作废依赖旧身份的未提交执行结果、检查批次、Bundle、Preview 与验收证据，读取最新值并由同一任务继续，不要求用户确认这次追赶。候选被外部工具修改不属于普通输入追赶，必须进入下述明确确认流程。

### 8.1 稳定状态

任务只有四种稳定状态：

| 状态 | 含义 |
| --- | --- |
| 运行中 | Agent 正在读取最新输入并形成新的持久成果 |
| 等待用户 | 等待工具审批、用户判断或必需的 Scene 修改；没有后台 Agent 动作 |
| 已停止 | 保留候选和检查点，必须由用户明确继续 |
| 已终结 | 候选已接受/放弃，或新目标已接管并取代旧任务 |

具体原因使用以下含义稳定的代码，不用自由文本扩张状态：

- 等待：`CANDIDATE_READY`、`USER_DECISION_REQUIRED`、`SCENE_CHANGE_REQUIRED`、`TOOL_APPROVAL_REQUIRED`、`EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED`。
- 停止：`USER_STOPPED`、`APP_RESTARTED`、`CODEX_INTERRUPTED`、`CODEX_THREAD_UNAVAILABLE`、`CODEX_USAGE_LIMIT`、`CODEX_AUTH_REQUIRED`、`CODEX_UNAVAILABLE`、`PROJECT_IDENTITY_LOST`、`PROJECT_COPIED`、`NO_PROGRESS`。
- 终结：`CANDIDATE_ACCEPTED`、`CANDIDATE_ABANDONED`、`TASK_SUPERSEDED`。
- 检查点无法恢复：`TASK_CHECKPOINT_INVALID`；它不表示项目或 Render Program 损坏。

用户停止、Codex 中断、应用重启、线程丢失、账户额度/认证/服务阻断，以及连续多轮无新持久成果都进入已停止。`NO_PROGRESS` 阈值是实现期固定产品常量，不是用户设置。任务不设置独立 token、活动时长或迭代次数预算。

状态退出规则固定如下：

- `TOOL_APPROVAL_REQUIRED` 获得对应工具批准后，直接触发同一任务继续运行，不另需“继续”操作。
- `SCENE_CHANGE_REQUIRED` 所等待的 Scene 修改完成后，Narracut 识别新项目输入并直接触发同一任务追赶继续，不另需“继续”操作，也不后台轮询。
- `CANDIDATE_READY`、`USER_DECISION_REQUIRED` 与 `EXTERNAL_CANDIDATE_CONFIRMATION_REQUIRED` 都必须等待用户明确选择；普通问题回复或工作区切换不能隐式恢复任务。
- 已停止状态一律需要用户明确继续；继续时按任务恢复契约恢复原 Codex 创作线程或创建替代线程。

接受或放弃候选终结任务；用户用新目标明确接管现有候选时终结旧任务、建立新任务 ID 并保留候选字节。

### 8.2 当前创作指令与检查点

当前创作指令由用户原文按顺序组成；后来的明确创作修订覆盖冲突的早期要求。Composer 中含义明确的创作要求自动追加；混合或含糊消息必须先让用户确认拟保存片段。

成片表现上的优先级为：当前创作指令 > Video Brief > 既有 Render Program。任何一层都不能推翻 Scene、Speech、时间、确定性和安全硬约束。当前创作指令与 Brief 有实质分歧时必须显式展示，不能静默修改 Brief。

项目原子保存单一 Agent 任务检查点，只包含任务 ID、稳定状态与原因、当前创作指令、相关项目/候选/输入身份、最后完成的安全阶段、待用户处理事项和可失效的 Codex 创作线程指针。不得保存原始工具输出、日志、未提交修改、推理、计划、Agent 总结、模型、token、活动时长或任务历史。

应用重启后任务保持已停止。用户明确继续时，Narracut 恢复可用原线程；原线程不可用时自动创建替代线程，从最后原子检查点、当前候选与最新项目内容开始新 Turn。未提交修改与工具调用一律丢弃并按需重跑；不得从聊天记录猜测状态。检查点缺失、损坏或与候选不一致时，原任务不可恢复，但候选与项目其他内容保持可用，新任务可以明确接管候选。

## 9. 执行胶囊与依赖

候选源码、人工/外部修改、第三方依赖、安装脚本与构建扩展都视为不可信代码。所有可能执行项目代码的阶段必须在经过能力自检的 OS 级 Render Program 执行胶囊中运行；独立进程、同 UID 权限或 Node Permission Model 不能作为主安全边界，也不存在“受信项目”降级开关。

### 9.1 分阶段能力

| 阶段 | 网络 | 项目代码 | 必要输入/输出 |
| --- | --- | --- | --- |
| 依赖下载 | 仅固定 canonical npm registry | 不执行 | 精确依赖与完整性元数据；只写下载输出 |
| 安装脚本 | 无外网 | 可以执行 | 只挂载精确依赖输入与安装输出 |
| 构建 | 无外网 | 可以执行 | 只挂载候选、Runtime 与依赖；只写 Bundle 输出 |
| Composition Metadata | 无外网 | 可以执行 | 只读不可变 Bundle 与输入；只写结构化结果 |
| Preview | 无外网 | 可以执行 | 只读不可变 Bundle、输入和授权媒体 |
| Render | 无外网 | 可以执行 | 只读验收绑定状态；只写单一渲染输出 |

依赖下载必须验证包、重定向与 registry 身份，不执行生命周期脚本。所有阶段环境变量从零构造，固定 UTC、locale、字体、浏览器与软件图形路径；动画只来自帧轴，随机必须使用显式种子。

每阶段有固定内存、PID、临时磁盘、输出、日志和墙钟上限。取消、超时或超限必须销毁整个胶囊及子孙进程并丢弃未验证输出。胶囊不可用或能力自检失败时失败关闭，不得退化到宿主执行。

胶囊不得挂载完整项目根、用户目录、宿主凭据、Docker socket、设备或宿主 API；只挂载精确不可变输入和单一输出位置。

### 9.2 依赖规则

- 只支持固定公共 npm registry 的精确版本包与完整性摘要。
- 不支持版本范围、私有 registry、Git、URL、`file:` 或依赖凭据。
- 全部 Remotion 包与 `@narracut/runtime` 必须精确同版。
- 依赖协调是唯一允许原子修改候选 `package.json`、`pnpm-lock.yaml` 与离线依赖库的操作。
- 普通打开、构建、Preview、Render 和回退不得隐式联网、补包、改锁或改依赖声明。
- 项目携带按 registry 完整性摘要寻址的离线依赖库，覆盖候选、候选恢复检查点、当前修订与全部保留历史；只有不再被任何状态引用的包才能回收。
- 匹配执行环境的机器必须能断网重建。执行环境变化不得静默改变已接受修订；新环境结果只能进入新候选验收。

执行环境指纹稳定标识胶囊、Runtime、工具链和确定性配置。每次接受绑定一个执行环境指纹。

## 10. Preview Bridge 与 Preview 实例

Runtime 在同一不可变 Bundle 中注入最小 Player 壳。Codex 工作台通过跨 origin iframe 和版本化 Preview Bridge 控制它；宿主不得导入项目源码，也不得把 Remotion Studio、Player Ref、iframe DOM 或 Bundle 全局变量作为产品接口。

Preview 实例身份绑定 Bundle 指纹、Render Program Input 指纹、全部 Media Revision 与执行环境指纹。实例只接受一次初始化；任何身份变化都创建新实例。Asset 在 Preview 中原位变化会换代 Media Revision 与输入；旧实例可以继续显示但必须标为过期，不能用于接受。

Bridge V1 支持：

- 宿主到实例：INIT、播放、暂停、精确 seek、音量、静音；
- 实例到宿主：启动、READY、帧提交、播放、暂停、缓冲、错误；
- READY 和每次事件回显协议主版本、实例 ID 与会话身份。

主版本不兼容失败关闭；同一主版本只能增加可选字段。宿主必须校验消息 origin、Window source、实例 ID 与会话 token。

当前与候选最多两个 Preview 槽位，隐藏槽位暂停。目标实例 READY 后才能原子切换；目标失败时保留源实例。最新候选构建失败时，可以展示上一份成功 Preview，但必须明确过期且不得用于接受。

iframe 使用与宿主跨 origin 的只读来源和最小脚本权限。CSP 只允许认证的 Bundle、Asset 与 Speech 来源，禁止外网、宿主 API、导航、弹窗、表单、下载和写操作。

## 11. 检查、诊断、门禁与验收证据

诊断、门禁和验收证据是三个独立层次：

- **Render Program 诊断**记录已经观察到的事实；
- **Render Program 门禁**按操作决定是否可继续；
- **Render Program 验收证据**证明门禁所需检查是否绑定当前完整状态。

### 11.1 诊断

每条诊断必须包含含义稳定的问题代码、检查阶段、完整状态身份、面向用户的说明、可操作修复建议、一个可证明的主要位置和可选相关位置。外部工具代码只能作为附加信息，不能替代稳定问题代码。位置不能证明与某 Scene 的因果关系时，Scene Time Window 只能提供导航上下文。

首版稳定问题代码目录如下；代码含义不可静默改变，新增或废弃必须随协议/检查器版本记录：

- 目录：`LAYOUT_INVALID`、`LAYOUT_REQUIRED_PATH_MISSING`、`LAYOUT_PATH_ESCAPE`、`LAYOUT_FORBIDDEN_ARTIFACT`。
- Manifest：`MANIFEST_INVALID`、`MANIFEST_API_UNSUPPORTED`、`OUTPUT_FORMAT_INVALID`、`MANIFEST_UNKNOWN_FIELD`。
- 依赖：`DEPENDENCY_MANIFEST_INVALID`、`DEPENDENCY_LOCK_INVALID`、`DEPENDENCY_LOCK_OUT_OF_SYNC`、`DEPENDENCY_SOURCE_UNSUPPORTED`、`DEPENDENCY_INTEGRITY_FAILED`、`DEPENDENCY_UNAVAILABLE`、`REMOTION_VERSION_MISMATCH`。
- 静态与类型：`STATIC_FORBIDDEN_CAPABILITY`、`STATIC_NONDETERMINISTIC_API`、`STATIC_DEPRECATED_API`、`TYPECHECK_FAILED`。
- Bundle：`BUNDLE_FAILED`、`BUNDLE_SOURCEMAP_MISSING`、`COMPOSITION_INVALID`、`BUNDLE_FINGERPRINT_MISMATCH`。
- 执行胶囊：`CAPSULE_UNAVAILABLE`、`CAPSULE_SELF_TEST_FAILED`、`CAPSULE_TIMEOUT`、`CAPSULE_RESOURCE_EXCEEDED`、`CAPSULE_RESOURCE_NEAR_LIMIT`。
- Runtime：`RUNTIME_ENTRY_INVALID`、`RUNTIME_METADATA_INVALID`、`RUNTIME_BRIDGE_FAILED`、`RUNTIME_FRAME_FAILED`、`RUNTIME_CONTRACT_VIOLATION`、`RUNTIME_EXTERNAL_ACCESS_BLOCKED`。
- 验收证据：`EVIDENCE_PLAN_INCOMPLETE`、`EVIDENCE_CAPTURE_FAILED`、`EVIDENCE_IDENTITY_MISMATCH`。
- 最终 Render：`RENDER_MEDIA_CHANGED`、`RENDER_FRAME_FAILED`、`RENDER_ENCODE_FAILED`、`RENDER_OUTPUT_FAILED`。
- 通用：`RESULT_TRUNCATED`。

检查按依赖图分阶段运行。互不依赖的阶段继续收集诊断；缺失前置条件的阶段记为未运行，不制造级联错误。检查批次绑定 Render Program、项目输入、Media Revision 和执行环境身份；任一变化使整批过期，禁止混合新旧结果。用户取消是操作结果，不得伪造成内容诊断。

以下能力无法证明合规时必须失败关闭：`Date.now()`、无参数日期、`performance.now()`、无种子随机、网络 API、计时器驱动画面、浏览器存储、宿主状态、环境变量和未固定 locale/时区/种子。

### 11.2 分操作门禁

门禁分别判断：

| 操作 | 必要条件 |
| --- | --- |
| 候选 Preview | 目录、Manifest、依赖、静态能力、确定性、类型、Bundle、Composition、Runtime 与胶囊检查通过；允许 Draft Duration 与零 Scene |
| 候选交付 | 最新候选 Preview 可用，证据新鲜，代表帧检查完成，全部非阻断警告已展示 |
| Render Program 接受 | 候选交付条件成立，用户明确整体接受，证据精确绑定候选完整视频状态 |
| 最终 Render | 接受记录新鲜且绑定同一 Bundle；项目 Render-ready；最终 Render 前检查通过 |

安全、身份、确定性、时间和内容权威硬约束不可由用户忽略。主观可读性、节奏、遮挡、黑帧等由 Agent 形成非阻断警告；系统不得自动作审美评分或声称用户完整观看。

### 11.3 代表帧与验收记录

基础代表帧计划确定性覆盖全片首尾、每个 Scene 的开始/中间/结束前、每个 Scene 边界两侧；Agent 为 Transition 与运动片段补充关键点。每份图像证据必须绑定准确 Preview 实例与帧。

Render Program 验收记录是精简、不可变记录，包含完整状态身份、检查器/协议版本、各阶段结果、非阻断警告、代表帧计划、图像摘要、Bundle 指纹与最终门禁结论。它不保存 Bundle、完整日志、代表帧图片，也不证明用户观看范围。

## 12. 最终 Render 与 Preview = Render

候选 Preview 与最终 Render 必须消费同一不可变 Bundle、同一 Render Program Input、同一 Media Revision 与同一执行环境身份。最终 Render 必须使用验收记录绑定的 Bundle；缓存缺失时只能在同一执行环境重建，且 Bundle 指纹必须完全相同。

Render 开始后 Asset 字节变化必须产生稳定诊断并终止该产物，防止一次输出混用变化前后的媒体。最终 Render 新发现的内容、帧或确定性失败可以阻断同一完整视频状态再次 Render，但不撤销已经接受的当前修订。胶囊、进程、编码器或输出位置的操作失败不改变接受事实；条件恢复后可以重试同一完整视频状态。

## 13. 项目生命周期、写入租约与身份丢失

启动器只提供创建、打开目录和从恢复快照创建项目，不保存最近项目列表。CLI 提供对应的 create、copy、recover、open、recovery inspect、recovery dry-run 和 recovery extract。

### 13.1 原子创建与正式复制

create、copy 和 recover 默认完成有限操作后退出；只有显式 `--open` 才进入工作区。目标必须不存在，现有空目录也不接管。创建和发布都在目标同级固定临时目录 `.目标名.narracut-tmp` 完成，写入、复核完整内容后通过原子改名发布；失败必须清理或明确保留可识别残留，不能留下貌似可打开的半成品项目。

创建不联网、不安装依赖，生成严格项目清单、空 Project DSL、零字节 Brief、兼容 starter Render Program 和锁文件。

正式复制前必须排空保存队列、解决 Brief 冲突、等待目录写任务并关闭来源工作区。复制完整持久项目内容，排除系统临时文件与派生产物；新副本生成新 Project ID。停止状态候选、检查点和完整历史随项目复制，但复制后的 Agent 任务使用新任务 ID、清除 Codex 创作线程指针并保持已停止。

手工复制保留 Project ID。同一进程发现另一路径的相同 Project ID 时，只提供：返回当前工作区、关闭后打开所选路径、把所选副本正式换成新 ID、取消。不得建立全机路径索引或选择“首选副本”。

当前进程失败或取消时只清理本次操作拥有的固定临时目录。崩溃残留只在下一次针对同一目标的操作中检查：标记与操作类型、目标匹配时必须经用户确认才删除并从头重试；标记缺失或不匹配时拒绝删除并展示准确路径。半成品不续传，也不建立项目外操作日志。

### 13.2 写入租约与身份复核

同一物理项目目录同一时刻只授予一个 Narracut 进程项目写入租约。另一进程不能进入该目录的工作区；崩溃遗留租约只有确认旧持有进程不存在后才能回收。inspect、dry-run 和 recovery extract 是只读操作，不取得租约。

每次 DSL、Brief、候选批次、接受和任务检查点提交都必须重新验证绝对项目路径、项目清单和 Project ID。打开项目期间目录被替换、清单消失或身份变化时，立即：

1. 冻结用户输入并撤销项目写权；
2. 取消可取消任务并阻止新写入；
3. 与已经开始的原子提交对账；
4. 封存单一恢复截面；
5. 展示全屏写阻断与可执行恢复路径。

## 14. 恢复快照与项目恢复

恢复快照只抢救尚未安全落盘的脏 DSL 或 Video Brief LOCAL，不是项目备份。没有这两类内存成果时不得创建快照。

### 14.1 恢复截面与信封

恢复截面在身份失效时一次封存，包含内存成果、最后安全持久基线以及与在途提交对账后的允许状态。截面封存后的后台结果或继续输入不得改变它；重复导出读取同一截面。

恢复信封是扩展名为 `.narracut-recovery.json` 的项目外单文件，包含固定 kind、独立 `snapshotFormatVersion`、`snapshotId`、`recoveryCutId`、UTC RFC 3339 的 `capturedAt` 与 `exportedAt`、来源绝对路径提示、原 Project ID、来源项目格式、逐项恢复基线、可选 Base64 载荷和整体 SHA-256。同一恢复截面的重复导出保持 recoveryCut、基线与载荷不变，但生成新 snapshot ID 与 exportedAt。它可以携带完整脏 DSL、Brief LOCAL 与解决三方冲突所需的 Brief BASE 原始字节；不得携带 Render Program、Asset、Speech、离线依赖、诊断、Preview、聊天或未提交 Agent 修改。

信封严格拒绝未知字段、非法字段组合、非规范 Base64、长度不符、摘要不符和资源超限。Base64 只接受标准 RFC 4648 字母表与必要 padding，拒绝空白、换行、URL-safe 字母、JSON 转义和非规范尾位；解码前先验证编码长度和组件上限，再有界解码并核对原始长度、内容与 SHA-256。目标必须位于项目外且不存在；解析符号链接后仍必须在项目外。导出经同级临时文件写入、权限设置、自校验和原子改名，不覆盖、不标记消费、不自动删除。

恢复基线逐项绑定原 Project ID，以及 DSL、Video Brief、当前修订、候选、候选恢复检查点、Render Program 历史索引和离线依赖库的身份与字节指纹。正在对账的单个原子提交可以暂时记录提交前与拟提交两个允许指纹；恢复前必须消除二选一结果。

### 14.2 恢复来源、计划与发布

恢复只接受用户明确指定的可读来源目录；原绝对路径只是默认提示，不是身份。来源必须逐项匹配恢复基线。来源清单缺失或损坏时可以用快照中的原 Project ID 重建清单；任何可靠读出的不同 Project ID、不同格式或其他基线差异都拒绝来源。Narracut 不扫描磁盘寻找替代目录。

恢复流程先只读检查信封，再只读验证来源、Project ID/格式、逐项基线、完整项目和 Render Program 完整性，形成恢复计划后才允许用户确认。计划明确展示恢复的 DSL 与 Brief、保持不变的 Render Program 状态、不会来自快照的持久内容和全部阻断问题。

恢复只发布到不存在的新路径，保留原 Project ID。它复制来源在整个复制期间保持稳定的完整持久内容，应用脏 DSL，并对 Brief BASE/LOCAL/DISK 冲突要求用户明确结果；全量校验后原子发布。失败全有或全无，不覆盖或合并既有项目。

恢复不恢复 Undo/Redo，不移动当前修订，不创建新修订，不改变候选/历史关系。相关输入变化只使 Preview 与验收证据过期。成功后恢复快照保持原样，不消费、不修改、不删除。

### 14.3 恢复载荷导出

完整恢复被来源问题阻断、但信封与相应载荷独立通过完整性和内容校验时，用户可以把 DSL、Brief LOCAL 或 Brief BASE 分别导出为项目外、目标不存在的普通文件。导出物不是项目，不能自动导入、覆盖或合并到项目；不得从版本不兼容、信封损坏或载荷摘要失败的快照中尽力提取。

## 15. 错误语义与 CLI 契约

CLI 在绑定端口、启动服务或后台任务前完成预检。失败必须向 stderr 输出稳定错误代码、相关绝对路径和可操作说明，并以非零状态退出。错误至少稳定区分：

- 路径不可访问或目标已存在；
- 不是 Narracut 项目；
- Project VNext 当前格式内容无效；
- 不支持的格式或协议主版本；
- 项目被占用；
- 运行期项目身份丢失；
- 资源超限或严格解析失败；
- 原子发布失败；
- 恢复信封无效、恢复来源不匹配或恢复冲突未解决；
- 执行胶囊不可用、阶段超时/超限/取消；
- Render Program 检查、门禁或最终 Render 失败。

项目识别的首版稳定代码是 `PROJECT_PATH_UNAVAILABLE`、`NOT_A_NARRACUT_PROJECT`、`PROJECT_CONTENT_INVALID`、`PROJECT_IN_USE` 与 `PROJECT_IDENTITY_LOST`。恢复代码是：

- 快照：`RECOVERY_SNAPSHOT_UNAVAILABLE`、`NOT_A_NARRACUT_RECOVERY_SNAPSHOT`、`RECOVERY_SNAPSHOT_VERSION_UNSUPPORTED`、`RECOVERY_SNAPSHOT_INTEGRITY_FAILED`、`RECOVERY_PAYLOAD_INVALID`。
- 来源：`RECOVERY_SOURCE_UNAVAILABLE`、`RECOVERY_SOURCE_PROJECT_ID_MISMATCH`、`RECOVERY_SOURCE_PROJECT_FORMAT_MISMATCH`、`RECOVERY_BASELINE_MISMATCH`、`RECOVERY_SOURCE_CHANGED_DURING_COPY`；内容与租约复用 `PROJECT_CONTENT_INVALID`、`PROJECT_IN_USE`。
- 目标与提交：`RECOVERY_TARGET_EXISTS`、`RECOVERY_TARGET_UNAVAILABLE`、`RECOVERY_BRIEF_RESOLUTION_REQUIRED`、`RECOVERY_PUBLISH_FAILED`。

其他具体代码字符串必须进入同一版本化稳定目录并由契约测试冻结。不同入口对同一事实必须返回同一语义类别。不得把未知格式当作可迁移 Legacy 项目，也不得把系统/进程/输出位置失败伪造成 Render Program 内容诊断。

## 16. 原子性与失败后状态

所有持久写入先写临时文件或临时目录、同步并复核，再以单一原子替换发布。每个操作的失败后状态必须固定：

| 操作 | 提交点前失败 | 提交点后清理失败 |
| --- | --- | --- |
| DSL / Brief 保存 | 保留原持久字节与内存待保存状态 | 新字节已生效；清理可幂等重试 |
| 候选批次 | 保留原候选与原恢复检查点 | 新候选与新检查点已生效 |
| 候选接受 | 保留旧当前、候选和检查点 | 新当前已生效；历史裁剪/清理重试 |
| create / copy / recover | 目标路径不存在 | 已发布项目有效；残留临时内容可清理 |
| 恢复快照导出 | 目标文件不存在 | 快照有效且保持不消费 |

项目内容或身份在操作期间变化时，不得把不同身份的检查、媒体或字节混入同一提交。

## 17. 测试边界

测试只验证外部可观察行为、稳定协议和持久化边界，不断言内部函数调用顺序、组件树、缓存实现、胶囊后端或内部目录去重方式。

### 17.1 主要 seam

最高优先级 seam 是公开产品边界：以临时 Project VNext 目录启动 Codex 插件工作台，通过浏览器完成 Scene 编辑、Agent 创作任务、候选换代、Preview 审核、接受和最终 Render，并验证持久文件、稳定状态、诊断和输出。关键主路径优先由这一条 seam 证明。

### 17.2 补充 seam

- CLI/服务契约：识别、创建、复制、同 ID 冲突、租约、身份丢失、资源边界、恢复 inspect/dry-run/extract、固定临时目录清理和原子发布。
- Runtime 契约：半开 Scene Time Window、逐 Scene Speech 向上量化、零 Scene、Draft Duration、深冻结、Asset 可用性、Asset Revision 和禁止字段。
- Preview = Render：同一 Bundle 身份下，Bridge 精确 seek 的代表帧与 Renderer still/最终视频对应帧比较。
- Agent 任务状态机：交付、停止/继续、重启、线程改绑、工具审批、Scene 等待、外部候选变化、接受/放弃/接管、外部服务停止、无进展和检查点损坏。
- 修订链：候选原子批次、检查点换代、接受提交点前后故障、20 修订裁剪、历史损坏、回退候选、外部编辑冲突和多进程租约。
- 执行胶囊：使用恶意但无害夹具分别验证文件、环境、网络、进程、资源、输出边界、失败关闭、子孙进程回收和秘密不泄露。
- 依赖：精确版本、锁图一致、Remotion 同版、非公共来源拒绝、完整性损坏、离线库缺包/修复、断网重建、环境变化和不隐式联网/改锁。
- Bridge：一次 INIT、主版本拒绝、READY 身份回显、FRAME 提交、槽位切换、旧实例过期、origin/source/token 与 CSP。
- 诊断/门禁：每个稳定代码的阶段、身份、位置、建议、排序、去重、截断和四类门禁；输入变化使整批过期。
- 恢复：在途提交对账、截面重复导出、严格信封、非规范 Base64、原始字节基线、来源替换、Brief 三方冲突、目标发布、崩溃残留、载荷提取和成功后快照不变。
- 资源边界：每项最大值、最大值加一、Unicode 标量、UTF-8 字节、孤立 surrogate、重复字段、数字 token、JSON 深度/节点/数组和 100 条诊断截断；同一夹具在打开、编辑、保存、恢复得到一致结论。

真实工具链验收至少包含一个多 Scene、含 Speech、图片、视频、Program Resource、第三方纯 JS 依赖、跨 Scene Transition 和 seeded 动画的可移动项目，并在断网且匹配执行环境下完成构建、Preview、接受和最终 Render。

测试不得依赖公网、当前时间、无种子随机、宿主字体/GPU 差异或用户真实 Codex 账户额度。外部服务和 Codex 创作线程生命周期使用协议级可控替身；执行胶囊能力另保留真实环境验收。

## 18. Legacy 与明确不提供的能力

以下全部属于 Legacy，不进入 Project VNext：

- Project DSL V1、V2、V3 及其 schema、示例和迁移链；
- Visual Type、Card、Caption、Project Theme、Text Style、Text Motion 与 Text Preset；
- 固定 1920×1080 / 30fps Composition、固定硬切、视频截断/冻帧表现；
- 独立 Node 服务加浏览器工作台、浏览器直接持有 DSL 权威、固定 WireGuard 服务拓扑；
- Legacy Render Program 或任何旧项目兼容、迁移、导入、转换、只读打开路径。

Project VNext 也明确不提供多人协作、云项目、分布式 Render、自动修改 Scene、自动接受/局部接受候选、直接移动历史指针、无限历史、候选历史、任务事件历史、项目级 token/时间预算、自动审美评分、宿主 Shell/完整文件系统、任意 registry/外网运行时、“受信项目”模式，或把恢复快照当作完整备份。

Asset、Speech、Render Program 树、离线依赖库、Render 产物和项目总磁盘量没有统一大小上限；这些容量策略需要各自独立决策，不能从本节文件级解析上限外推。

## 19. 实施验收清单

Project VNext 实现只有同时满足以下可执行验收才算符合本规范：

1. 严格 Project VNext 可以创建、关闭、移动、打开和正式复制；普通目录、Legacy Project、未来格式、损坏标识和同 ID 冲突都按稳定代码失败，且不产生隐式写入。
2. 表格工作区可以保存零 Scene、空 Narration、缺 Speech 和无 Asset 的合法草稿；Agent、Render Program 与 Bridge 无法改写这些字段。
3. Render Program Input V1 对零 Scene、Draft Duration、多 Scene Speech 向上量化、深冻结、Asset available/unavailable、禁止字段和输入换代符合契约。
4. 一项 Agent 创作任务可以从发起经历候选批次、检查、Preview、代表帧、交付、接受或放弃；停止、重启、线程改绑、外部候选变化和检查点损坏保持正确状态与写权。
5. 候选接受在故障注入下满足提交点前后语义；20 修订裁剪、历史损坏和回退都不能直接改写当前修订。
6. 恶意但无害的 Render Program 夹具无法读取宿主凭据、项目外文件或任意网络，无法逃逸进程/资源/输出边界；胶囊不可用时不在宿主降级执行。
7. 精确依赖、锁图、Remotion 同版、来源限制、完整性、离线库和断网重建通过契约与真实环境验收，普通路径不隐式联网或改锁。
8. Bridge 的身份、一次初始化、控制/事件、槽位原子切换和 CSP 通过协议测试；旧实例与旧检查批次不能用于接受。
9. 同一 Bundle 的候选 Preview 代表帧与最终 Render 对应帧通过既有视觉误差策略；Asset 在 Render 中变化会终止产物。
10. 每类稳定诊断、四类门禁、警告展示、代表帧计划与验收记录通过数据驱动测试，硬阻断没有用户覆盖路径。
11. create、copy、recover 与恢复 inspect/dry-run/extract 在真实字节、冲突和崩溃残留下满足全有或全无；恢复成功不修改快照。
12. 所有资源最大值和最大值加一在打开、编辑、保存、导出、检查与恢复入口得到相同结论，严格 UTF-8/JSON/Base64 与 100 条诊断截断行为通过。
13. 一个包含多 Scene、Speech、图片、视频、Program Resource、第三方纯 JS 依赖、跨 Scene Transition 和 seeded 动画的可移动项目，在断网、匹配执行环境中完成构建、Preview、接受和最终 Render。

## 20. 决策追踪

本规范固化父实施规格 [#60](https://github.com/dulltackle/narracut/issues/60) 的已决定行为；[#42](https://github.com/dulltackle/narracut/issues/42) 与已关闭的 [#43](https://github.com/dulltackle/narracut/issues/43)–[#59](https://github.com/dulltackle/narracut/issues/59) 只保留为可追踪背景，不再是实施规范来源。

| 规范边界 | 决策背景 |
| --- | --- |
| 项目识别、破坏性替代 | #43、#59 |
| Runtime Input 与内容/表现权威 | #44、#46 |
| Video Brief | #45 |
| Agent 创作任务与双工作区 | #47、#50、#57 |
| 创建、复制、候选、修订与恢复 | #49、#51、#56 |
| 执行胶囊、依赖与离线恢复 | #52、#53 |
| Preview Bridge、诊断与验收 | #54、#55 |
| 统一资源边界 | #58 |

实现只能从本规范取得行为要求；追踪链接不得用于推断本规范未决定的新行为。三层文档发生矛盾时视为文档缺陷：先按“规格定义行为、ADR 定义取舍、CONTEXT 定义术语”的职责修正文档，不能由实施者自行挑选。

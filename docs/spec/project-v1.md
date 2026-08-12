# Project DSL V1 技术规格

本文件是 [DSL schema 定稿](https://github.com/dulltackle/narracut/issues/11) 的可执行参考规格。结构定义见 [`project-schema-v1.ts`](./project-schema-v1.ts)，真实文案示例见 [`project.example.json`](./project.example.json)，AI 可生成性样本见 [`project.ai-example.json`](./project.ai-example.json)。

## 边界

- `project.json` 是前端编辑模型与渲染快照共用的 DSL；它不包含 Remotion 组件名、帧号、媒体探测事实或本机绝对路径。
- `schemaVersion: 1` 定义固定的 1920×1080、30fps 与唯一转场 `cut`；前两项不重复落盘，`transition: "cut"` 仍逐 Scene 显式保存。
- Node 只保存原始 DSL、提供路径探测与外部服务代理；共享应用层负责解析、迁移、内部一致性校验与 RenderPlan 派生。
- 所有对象拒绝未知键；所有可选值用字段缺省表达，禁止 `null`。

## 根结构

```text
Project {
  schemaVersion: 1,
  metadata: {
    name?,
    logoAssetId?
  },
  assets: Asset[],
  scenes: Scene[]
}
```

`metadata` 永远存在。`name` 与 `logoAssetId` 都可缺省；Logo 必须引用 `image` Asset。UI 可以文件夹名作为缺省显示名，但不因此回写 DSL。Asset 集中登记，Scene 只保存稳定 Asset ID；`scenes[]` 的数组顺序就是播放顺序。

Scene 与 Asset ID 都是应用生成的稳定 UUID。重排、编辑内容、移动 Asset 路径或原位替换 Asset 内容不改变 ID；复制 Scene 或再次导入文件生成新 ID。V1 不做内容哈希、内容去重或来源追踪。

## Asset

Asset 的持久化字段只有：

```text
Asset =
  { id, kind: "image", path }
  | { id, kind: "video", path }
```

`path` 是 POSIX 项目相对路径。禁止 POSIX / Windows 绝对路径、URL、反斜杠、空段、`.`、`..`、NUL 与 URL 编码。路径不是身份；正常导入流程以 Asset ID 生成独立目标路径，但 DSL 不额外把路径唯一性误当成身份约束。

导入源、原始文件名、内容哈希、`frameCount`、编码、容器、分辨率、帧率、色彩与音轨事实全部不落 DSL。打开项目和渲染前都重新探测；运行时事实陈旧不会污染核心数据资产。

## Scene、Speech 与 Visual

```text
Scene {
  id,
  narration: { text },
  speech?,
  visual,
  transition: "cut"
}
```

Narration 与所有可见文本原样持久化，不 trim、不做 Unicode 归一化。草稿可以保存空文本、未绑定 Asset 和缺 Speech；`assetId` 缺省表示未绑定，悬空 ID 不表示未绑定。

Speech 缺省时省略整个字段。存在时保存：

- 固定路径 `speech/<sceneId>.mp3`；
- 正整数 `durationMs`；
- 实际发送给 TTS 的精确 UTF-8 文本之 `sha256:<小写十六进制>`；
- 应用级版本化 `ttsProfileId`，V1 为 `narracut-mandarin-news-v1`。

Narration 或 profile 改变后 Speech 直接视为缺失；V1 不把 Stale Speech 持久化成第三种状态。供应商、模型、音色、速度与情绪等路由留在 Node TTS 适配器中。

Visual 是严格判别联合，只保存当前 type 的字段：

- `title`: `device`、`headline`、可选 `subheadline`；
- `image`: 可选 `assetId`；
- `image-caption`: 可选 `assetId`、`caption`；
- `video`: 可选 `assetId`；
- `video-caption`: 可选 `assetId`、`caption`；
- `end-card`: `title`、`bullets[]`。

Caption 再以 `kind` 判别：`{kind:"step", number, name}` 或 `{kind:"alert", text}`。Subtitle 始终直接取 `narration.text`，不重复存字段。Image 分支必须引用 image Asset，Video 分支必须引用 video Asset；Title 与 EndCard 没有 Scene Asset。

## 校验分层

校验每次聚合全部诊断，不 fail-fast，并统一返回：

```ts
{
  code: string;
  severity: "error" | "warning";
  path: Array<string | number>;
  message: string;
  sceneId?: string;
  assetId?: string;
  relativePath?: string;
  absolutePath?: string; // 仅运行时诊断，不落 DSL
}
```

### 保存前

1. Zod 结构校验：版本、字段类型、枚举、路径语法、未知键与 `null`。
2. 内部一致性校验：Scene/Asset ID 唯一、引用存在、Visual 与 Asset kind 匹配、Logo 引用 image、Speech 路径匹配 Scene ID。

这两层任何 error 都阻止保存。空 `scenes[]`、空可编辑文本、未绑定 Asset、缺 Speech，以及磁盘文件缺失仍可保存。

### 打开项目

1. 读取 `schemaVersion`，对已知旧版本连续执行纯迁移函数；
2. 做结构与内部一致性校验；
3. 前端提交去重后的相对路径，由 Node 探测 Asset 与 Speech；
4. 共享项目校验器把运行时事实关联回 Asset 和 Scene；
5. 以 draft 模式派生时间线。缺 Speech 时使用 Draft Duration，派生值不落盘。

打开项目不会自动转码、自动改路径或偷偷修补 DSL。

### 渲染前

前端预检与 render worker 对同一渲染快照重复执行同一套检查。Render-ready 还要求：

- 至少一个 Scene；
- 每个 Scene 的必需可见文本有效；EndCard 有 3–5 条有效要点；
- Image/Video 分支已绑定正确 Asset；
- 每个 Scene 有与当前 Narration 和 TTS profile 匹配的 Speech；
- Asset 与 Speech 文件存在、可解码，媒体符合规范；
- 所有可见字符都被打包字体 cmap 覆盖。

若使用 Title，它只能有一个并位于首个 Scene；若使用 EndCard，它只能有一个并位于最后一个 Scene。二者都不是 Render-ready 的必选项——真实 13 Scene 验收夹具可以从图片 Scene 开始、以视频 Scene 结束。

图片低分辨率是 warning；文件缺失、损坏、媒体不合规与缺字是 error。`startFrame`、`durationInFrames`、`endFrame`、项目总帧数和视频 `frameCount` 都只存在于运行时 RenderPlan。

## 版本与迁移

- 版本号是单调整数。每次升级只提供 `vN -> vN+1` 的共享纯函数，禁止跨版本捷径。
- 已知旧版本先在内存迁移并校验，通过后继续工作；下一次正常保存才写回新版本。
- 首次跨版本写回前，原样保留 `project.v<旧版本>.pre-migration.json`；已有同名备份绝不覆盖，然后原子替换 `project.json`。
- 迁移函数不能移动、修改或删除 Asset。
- 未知新版本拒绝写入和渲染，原文件保持不动并提示升级应用。

`project.snapshot.json` 始终是原样 DSL，不注入派生字段。worker 读取快照、校验后，用共享纯函数构造内存 RenderPlan。

## AI 可生成性验收

验收输入由以下三部分组成：由 `projectV1Schema` 经 Zod 4 `z.toJSONSchema(..., {target:"draft-2020-12"})` 生成的完整 JSON Schema、固定项目元信息，以及真实 13 项 Asset catalog。要求模型一次输出 20 Scene 草稿：Asset 登记表不得改变，Scene UUID 必须唯一，所有引用必须存在，六种 Visual 与两种 Caption 分支都至少出现一次，全部省略 Speech。

本次生成的原始结果直接保存为 [`project.ai-example.json`](./project.ai-example.json)，不做程序性修补。验证脚本 [`verify-project-examples.ts`](./verify-project-examples.ts) 同时检查结构、内部一致性和上述覆盖条件。AI 样本是“可保存草稿”，不是 Render-ready 成片；缺 Speech 是题目明确要求。

参考 Schema 使用 Zod 4，因为其官方稳定 API 原生提供 `z.toJSONSchema()`；生成给模型的结构 Schema 不包含无法由 JSON Schema 表达的跨引用检查，引用完整性由同一次验收中的内部一致性校验补齐。

# Project DSL V2 技术规格

> **Legacy，已被 [ADR-0008](../adr/0008-project-vnext-normative-architecture.md) 与 [`project-vnext.md`](./project-vnext.md) 替代。** 本规格只记录旧实现，不属于当前规范。Project VNext 不兼容、不自动迁移、也不以只读方式打开 V2。

V2 曾将内容用途从核心数据模型中移除。历史结构定义见 [`project-schema-v2.ts`](./project-schema-v2.ts)，当时的迁移决策见 [ADR-0005](../adr/0005-content-neutral-visual-model.md)；现有示例仍服务 Legacy V3 实现。

## 边界与根结构

`project.json` 仍是编辑器和渲染快照共用的严格 DSL：所有对象拒绝未知键，可选值以字段缺省表达，禁止 `null`。固定输出规格、运行时探测、Remotion 组件、帧号、主题和文字表现参数不进入 V2。

```text
Project {
  schemaVersion: 2,
  metadata: { name?, logoAssetId? },
  assets: Asset[],
  scenes: Scene[]
}

Scene {
  id,
  narration: { text },
  speech?,
  visual,
  transition: "cut"
}
```

Scene 与 Asset 的 UUID、Asset 项目相对路径、Speech 字段、内部一致性校验和派生时间线规则沿用 V1。`scenes[]` 顺序就是播放顺序；所有 Scene 都可自由重排，没有首尾锚点。

## Visual 与 Caption

V2 只有三种 Visual：

```text
Visual =
  | { type: "card", label?, title?, body?, items? }
  | { type: "image", assetId?, caption? }
  | { type: "video", assetId?, caption? }

Caption = { text }
```

- Card 是不依赖 Asset 的结构化文字画面，`label`、`title`、`body`、`items` 至少存在一项；存在的字符串和列表项必须含非空白文字。
- Image 与 Video 可以保存一个可选 Caption。Caption 只表达一段非空正文，不记录 Step、Alert、编号或其他内容用途。
- Subtitle 始终由 `narration.text` 派生，不重复持久化。
- Image 只能引用 image Asset，Video 只能引用 video Asset；未绑定 Asset 的草稿省略 `assetId`。

视觉样式和动效不由 Visual Type 决定。V3 已按 [ADR-0006](../adr/0006-versioned-text-presentation-presets.md) 引入独立、版本化的 Project Theme、Text Style 与 Text Motion Preset；V2 本身不保存这些字段。

## 编辑事务

- Image 与 Video 之间切换时保留 Caption；若 Asset 类型不兼容，提交前明确列出将删除的 Asset。
- Image/Video 切换到 Card 时，有 Caption 就把正文映射为 `body`；没有 Caption 就先要求作者填写至少一项 Card 内容。Asset 损失必须确认。
- Card 切换到 Image/Video 时，逐项列出将删除的 label、title、body 和 items，确认后只保存目标分支。
- 清空 Caption 会删除整个 `caption` 字段；不能保存空 Caption 或空 Card，也不保留不可编辑的隐藏字段。

## V1 → V2 迁移

连续迁移中的 V1 → V2 步骤会先严格解析 V1，再用纯函数在内存中迁移并校验 V2。当前应用随后继续执行 V2 → V3，打开本身不写文件，第一次正常保存才写出当前的 `schemaVersion: 3`。

| V1 | V2 |
| --- | --- |
| `title.device` | `card.label` |
| `title.headline` | `card.title` |
| `title.subheadline` | `card.body` |
| `end-card.title` | `card.title` |
| `end-card.bullets` | `card.items` |
| `image-caption` / `video-caption` | `image` / `video` + 可选 `caption` |
| `step.name` / `alert.text` | `caption.text` |
| `step.number`、Caption `kind` | 删除 |

迁移保持 Scene ID、Narration、Speech、Asset catalog 和 Scene 顺序。只有步骤编号而没有步骤名的 Caption 会被删除。未知的更高版本继续以只读方式打开，禁止写回。

V1 曾允许完全空白的 Title 与 EndCard 草稿，而 V2 禁止空 Card。若这两类历史 Visual 没有任何可迁移文字，迁移会保留 Scene 并将其转为未绑定 Image 草稿，避免伪造可见文字或阻断整个项目。

## 校验与验收

保存前依次执行 V2 结构校验和内部一致性校验；任一 error 都阻止保存。空 Scene 数组、空 Narration、未绑定 Asset 和缺 Speech 仍是可保存草稿。渲染前再执行媒体、Speech、字体覆盖和 Render-ready 校验。

V2 结构与迁移行为由 [`project-schema-v2.test.ts`](../../tests/project-schema-v2.test.ts) 覆盖。当前 [`verify-project-examples.ts`](./verify-project-examples.ts) 验证的是两个 V3 示例；V2 JSON Schema 仍可由 `projectV2Schema` 通过 Zod 4 生成。

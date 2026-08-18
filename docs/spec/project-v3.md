# Project DSL V3 技术规格

V3 以版本化、内容中立的 Preset 定义文字表现，并把同一份严格 DSL 快照同时交给编辑器 Player 与最终 Remotion Renderer。可执行结构见 [`project-schema-v3.ts`](./project-schema-v3.ts)，冻结的内置 Preset 见 [`text-presentation-presets-v1.md`](./text-presentation-presets-v1.md)，架构决策见 [ADR-0006](../adr/0006-versioned-text-presentation-presets.md)。

## 根结构与 Project Theme

```text
Project {
  schemaVersion: 3,
  metadata: { name? },
  theme: {
    presetId,
    defaultTextStyleId,
    defaultTextMotionId,
    accentColor,
    fontId,
    logoAssetId?
  },
  assets: Asset[],
  scenes: Scene[]
}
```

`presetId`、Style、Motion 与 Font 都是含命名空间和显式版本的稳定 ID。未知 ID 通过结构校验并原样保留，以便作者恢复或在安装未来 Preset Pack 后重新解析；一致性校验会报告可定位 error，并阻止最终渲染。`accentColor` 只接受大写 `#RRGGBB`。Logo 只能引用项目内的 image Asset。

内置 Theme `narracut/default@1` 默认使用 `narracut/panel@1`、`narracut/fade@1`、`#00A3A6` 和 `narracut/noto-sans-cjk-sc@1`。这些值是 Project 默认值，不是把参数复制到每个 Scene。

## Text Block 覆盖

Card 自身是一个 Text Block；Image 与 Video 只有在 Caption 存在时才有 Text Block。二者分别保存可选覆盖，字段缺省表示继续跟随 Project Theme：

```text
Card = {
  type: "card",
  label?, title?, body?, items?,
  textStyleId?, textMotionId?
}

Caption = {
  text,
  textStyleId?, textMotionId?
}
```

Text Style 与 Text Motion 相互独立，也不由 Visual Type 或内容用途决定。三种 Style 和四种 Motion 必须能形成全部 12 种组合。显式覆盖只影响当前 Card 或 Caption；“恢复项目默认”会删除对应字段，而不是复制默认 ID。Subtitle 始终由 `narration.text` 派生，不使用 Text Preset。

## V1 → V2 → V3 连续迁移

读取旧项目时，应用先以旧版本严格解析，再连续执行纯迁移函数。V1 先按 V2 规则移除内容用途；V2 再加入默认 Theme，并将 `metadata.logoAssetId` 移到 `theme.logoAssetId`。迁移不改写输入对象，打开本身不写文件，第一次正常保存才写出 V3。未知的更高版本仍以只读方式打开，禁止写回、Job 与渲染。

## Preview、Render 与诊断

保存后的 Project 先深拷贝并严格校验，再解析为不可变 Render Snapshot。编辑器 Player 与最终 Renderer 都使用 `ProjectComposition`、相同帧率、Speech 音轨、时间线、媒体 URL、字体、Preset 解析和安全缩放；安全区辅助线只属于编辑器外壳，不进入输出视频。Preview 可对缺少 Speech 的 Scene 使用 5 秒 Draft Duration，最终快照与 Renderer 边界都会拒绝这类草稿，成片时长与音轨由 `speech.durationMs` 和 `speech.path` 驱动。

- 提醒：强调色对比度偏低、内置字体可能不覆盖某个码位。
- 渲染阻断：Theme / Style / Motion / Font 缺失、Speech 未生成、Logo / Visual / Speech 文件缺失、字体加载失败、文字在最低 70% 安全缩放后仍溢出。
- 渲染前仍需通过既有 Speech 新鲜度、媒体探测和 Render-ready 校验。

[`verify-project-examples.ts`](./verify-project-examples.ts) 验证两个 V3 示例；JSON Schema 由 `projectV3Schema` 通过 Zod 4 生成。

# 用版本化 Text Preset 驱动 Remotion 表现

跟踪任务：[Issue #39](https://github.com/dulltackle/narracut/issues/39)。

Remotion 只作为内部预览与渲染引擎；Narracut 不向作者开放 Remotion Studio、React 或任意 CSS。Card 与 Caption 的 Text Block 分别选择与 Visual Type 无关的版本化 Text Style 和 Text Motion，Project Theme 提供项目默认值，单个 Scene 只保存例外；这既保留 Remotion 的表现力，又使 DSL 可校验、可迁移并满足 Preview = Render。

## Considered Options

- **把内容用途做成 Style**——被否。`warning`、`step` 等名称会重新引入垂直领域分类；Preset 只使用视觉、版面或运动名称。
- **允许作者自由组合 CSS、React 或底层 Remotion 参数**——被否。开放式表现会破坏安全区、确定性和项目可移植性。
- **Style 与 Motion 绑定 Visual Type 或彼此绑定**——被否。每个 Text Style 必须支持标签、标题、正文和列表，任意 Text Style 都能与任意 Text Motion 组合。

## Consequences

- 本决策不向 Project DSL V2 提前加入表现字段；正式实施时升级后续 schemaVersion 并提供连续纯迁移。
- 首批内置 Theme 为 `narracut/default@1`，默认 Text Style 为 `narracut/panel@1`，另有 `lower-third@1` 与 `spotlight@1`；默认 Text Motion 为 `narracut/fade@1`，另有 `none@1`、`rise@1` 与 `slide@1`。新版效果使用新版本 ID，不能暗中改变旧项目。
- Text Motion 只控制 Text Block 在 Scene 开始时的进场，时长由 Preset 固定并在短 Scene 中按比例缩短；Text Block 保留到 Cut，不单独退场。Subtitle 不使用 Text Style 或 Text Motion。
- Project Theme 只向作者开放一个品牌强调色、一款可稳定渲染的字体和一个可选 Logo。颜色对比度或字体覆盖问题只显示诊断，由作者决定是否处理；缺失 Preset 或文字在安全缩放后仍溢出则阻止最终渲染。
- V2 只实现内置 Preset，并为未来可信 Preset Pack 保留带命名空间和版本的标识边界；Preset Pack 的安装、打包与信任机制另行决策。

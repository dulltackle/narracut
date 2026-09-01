# Speech 驱动 Scene 时间并逐 Scene 向上量化到帧

> **状态：Accepted（局部修订）。** Speech 驱动 Duration、每个 Scene 分别向上量化再累计的核心已纳入 [`project-vnext.md`](../spec/project-vnext.md) 与 [ADR-0009](./0009-separate-scene-content-and-render-program-authority.md)；固定 Asset 截断/冻帧的 Legacy 表现已被 ADR-0009 的 Render Program 表现权威替代。Project VNext 不因此获得旧项目兼容或迁移路径。

Scene 的 Duration 只由完整 Speech 的 `audio_length` 决定，不裁首尾近静音、不加 Padding，也不允许手动覆盖。DSL 只在 Speech 上保存毫秒级原始时长；Player 与 renderer 共用同一个纯函数，把每个 Scene 的 Speech 时长分别向上量化到整帧，再累计得到时间线。

## Considered Options

- **手动覆盖或额外 Padding**——被否。缩短会截断旁白，延长则破坏「Narration 是时长的主人」这一领域约束。
- **逐 Scene 四舍五入**——被否。单个 Scene 可能比自己的 Speech 短半帧，从而截掉尾音。
- **累计时长后统一取整**——被否。虽然整片误差不到一帧，但单个 Scene 的画面边界可能早于其 Speech 结束，造成尾音跨 Scene 或相邻 Speech 重叠。
- **逐 Scene 向上取整**——采用。每个 Scene 都完整容纳自己的 Speech，并保持画面与 Speech 同帧开始。

## Consequences

- 每个 Scene 末尾增加的余量严格小于一帧；项目不限制 Scene 数量，因此整片累计增加严格小于 Scene 数量个帧。30fps 下，若项目有 `N` 个 Scene，累计增加严格小于 `N / 30` 秒。
- `startFrame`、`startTime`、`durationInFrames` 与项目总帧数全部运行时派生，不进入 DSL。
- 缺 Speech 的 Scene 只能用 Draft Duration 参与编辑器预览，最终渲染必须拦截。
- Asset 的播放窗口使用同一份整数帧时间线：长则截断，短则冻结最后一帧。

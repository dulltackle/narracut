# 02 — Remotion 实拍渲染调研：Preview = Render 能不能成立

Type: research
Status: resolved
Blocked by: —

## Question

在「实拍视频片段 + TTS 音轨 + 中文字幕」这个组合下，Remotion 的 Player（浏览器）与 renderer（本地 Node）两侧行为差异有多大？**「Preview = Render」这条原则能不能真的成立，代价是什么？**

必须回答：

1. **`<Video>` vs `<OffthreadVideo>`**：各自在 Player 与 renderer 两侧的可用性和行为差异。Player 里能不能用 `OffthreadVideo`？如果两侧必须用不同组件，一致性怎么保。
2. **截断**：素材 8s、Scene 只给 5s，怎么只播前 5s。当前 API 是什么（`trimAfter` / `endAt` / Sequence 裁剪），两侧表现是否一致。
3. **冻帧**：素材 3s、Scene 要 5s，最后一帧怎么冻住补 2s。有没有原生支持，还是得自己实现（截图末帧？暂停播放头？），两侧能不能一致。
4. **音频**：多段 TTS 音频按 Scene 顺序拼接的正确姿势（`<Audio>` + `<Sequence>`）；素材原声怎么彻底静音；渲染出的 MP4 音轨如何合成。
5. **本地渲染耗时**：`@remotion/renderer` 在普通开发机上渲染 1 分钟 / 1080p / 30fps（含约 20 段视频素材）大致要多久？给量级和主要影响因素（并发数、硬件加速、编码器选项）。这决定渲染要不要做成后台任务。
6. **中文字体**：字幕用中文字体时，两侧的字体加载策略是什么，怎么保证字形与换行完全一致（字体不一致会直接导致预览和成片不同）。
7. **素材访问路径（重点）**：Player 跑在浏览器里，只能通过 http(s) URL 拿到本地素材；renderer 跑在 Node 里可以直接读文件路径。**DSL 里到底存什么，才能让两边指向同一个文件？** 请给出具体可行方案（本地静态服务？`staticFile()`？绝对路径 + 服务前缀映射？），以及项目文件夹被移动后还能不能打开。这是「Preview = Render」最可能裂开的地方。
8. **许可**：Remotion 的商业使用条款——个人/公司/团队规模各自的要求。这是事实，会影响产品化路径，必须查清而不是猜。

## 约束

- 单用户本地应用，Vite + React SPA + 薄 Node 服务。
- 只有 Cut，无交叉转场。
- 16:9 / 1920×1080 / 30fps。
- 4 个 Visual Type：Title、Video、Video+Caption、EndCard。

## 产出

写到 `.scratch/video-script-v1/research/remotion-render.md`，结论回填本票 `## Answer`。
第 2、3、7 条尽量给**可运行的最小代码片段**，不要停留在 API 名字。

## Answer

调研基于 Remotion 核心包当前最新稳定版 **4.0.506**（npm，2026-08 查证；5.0 尚未发布，仍在迁移文档阶段）。完整依据、原文引用与代码见 `.scratch/video-script-v1/research/remotion-render.md`。

1. **`<Video>` vs `<OffthreadVideo>`**：4.0.x 新增了 `@remotion/media` 的 `<Video>`（基于 Mediabunny），是当前官方推荐、两端通用的组件，渲染最快且两端都"帧完美"。旧的 `<OffthreadVideo>` 明确**不支持 Player/client-side rendering**（官方原文 "Not supported in client-side rendering"），只能配合 `useRemotionEnvironment()` 在 Player 端切换成 `<Html5Video>` 来保证语义等价。裂缝在于 `@remotion/media` 的 fallback 机制：遇到 CORS/编解码器不支持/alpha 通道时，Player fallback 到 `<Html5Video>`、renderer fallback 到 `<OffthreadVideo>`，官方自己举例说明两者在循环播放等行为上会不一致。详见报告第1节。
2. **截断**：当前 API 是 `trimBefore`/`trimAfter`（v4.0.319 起，取代已废弃的 `startFrom`/`endAt`），单位是合成帧数，配合 `<Sequence durationInFrames>` 限定 Scene 占用的时间窗口。用 `@remotion/media` 的 `<Video>` 时两端行为一致。报告第2节给了可直接跑的 `TrimDemo.tsx` 完整示例（`trimAfter={150}` 实现"8秒素材只播前5秒"）。
3. **冻帧**：Remotion 原生支持，`<Freeze frame={n}>`（v2.2.0 起），会让子树的 `useCurrentFrame()` 恒定返回指定帧，且官方声明视频组件会自动暂停、音频自动静音，不需要自己截图或手写暂停逻辑，是纯 React 层实现，两端一致性有把握。报告第3节给了可直接跑的 `FreezeDemo.tsx`（两个 `<Sequence>` + 一个 `<Freeze frame={89}>` 实现"3秒素材冻结末帧撑满5秒"）。
4. **音频**：`<Sequence from={...}>` 包 `<Audio src=... trimBefore trimAfter volume>` 实现多段 TTS 顺序拼接；素材原声用 `muted` prop 彻底静音（官方额外说明 `muted` 还能让渲染跳过该视频的音轨抽取，提速）；最终 MP4 音轨由 `@remotion/renderer` 内部经 FFmpeg 混合多路音频（`amix`/`adelay` 一类滤镜）合成，目标是匹配浏览器预览听感，音频侧没发现类似视频组件的双实现分裂问题。详见报告第4节。
5. **本地渲染耗时**：官方文档没有给出任何"1分钟视频渲染多久"的具体数字或"N倍时长"经验法则，查过 Performance Tips / benchmark CLI / encoding 文档均只给定性建议（并发数不是越高越快，需要用 `npx remotion benchmark` 实测；硬件加速自 v4.0.228 起支持但平台受限且不能和 `crf` 同用；H.264 编码"Very fast"，VP8/VP9/AV1 很慢）。结论：耗时不可预测且依赖机器配置，**渲染必须做成异步后台任务**，不能假设是同步秒级操作。详见报告第5节。
6. **中文字体**：两端都用 `@remotion/fonts` 的 `loadFont()` 或 `@remotion/google-fonts` 显式加载 Web 字体（字体文件放 `public/`，`staticFile()` 引用），框架自 v2.2 起保证渲染前自动等待字体加载完成。风险点：这个保证不覆盖"自己写的换行测量逻辑是否也等了字体"，也不保证两端不会误用系统预装的同名不同版本字体——必须禁止依赖系统字体、字幕排版组件要显式等 `loadFont()` resolve 后再测量换行。详见报告第6节。
7. **素材双通道访问路径（最核心）**：官方 `staticFile()`/`public/` 约定要求素材复制进固定目录，不适合"项目即文件夹、路径任意"的场景。Remotion 官方文档明确不支持绝对路径引用素材，并给出官方认可的逃生舱——"起一个本地静态文件服务器（`npx serve`/`serve-handler`）把任意文件夹映射成 http 前缀"。推荐方案：**DSL 只存相对项目根目录的相对路径，薄 Node 服务把项目根目录整体映射成本地 HTTP 服务（动态端口），Player 与渲染用的 Composition 代码共用同一份"相对路径→URL"函数**，从而保证两端读到同一个物理文件。项目文件夹移动/改名后，DSL 相对路径本身不失效，只需要重新 `startMediaServer()` 拿新端口（不能把端口/URL 持久化进 DSL）；如果素材文件本身丢失，需要在打开项目时做一次完整性校验并给出"Scene ID + 相对路径 + 尝试解析的绝对路径"的明确报错。完整代码（静态服务、Player 端、`selectComposition`/`renderMedia` 端）见报告第7节。
8. **许可**：官方 LICENSE.md（remotion.dev/license 会 307 跳转到 GitHub `LICENSE.md`）明确双层许可——**个人（无论人数/收入，含商用）、3人及以下的营利性公司、非营利组织（不限规模）、评估阶段** 均可免费使用；**4人及以上的营利性公司/团队必须购买 Company License**（定价页 remotion.pro/license：按渲染量计费的 Automators 档 $0.01/render 起、$100/mo 最低消费，按坐席计费的 Creators 档 $25/mo/席，Enterprise 起价 $500/mo）。禁止行为仅限"倒卖/转授权 Remotion 自身代码"，与本项目用法无关。需要注意 5.0 即将生效的许可变化（GitHub PR #3750）：**外包/合同工也会计入团队规模**，届时需重新核算是否仍在免费范围。详见报告第8节。

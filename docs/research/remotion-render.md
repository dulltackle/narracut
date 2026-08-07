# Remotion 技术调研：Preview（Player）= Render（renderer）能否成立

## 调研依据的版本

- **`remotion` 核心包**：截至调研时（2026-08-06），npm 上最新稳定版为 **4.0.506**（[npmjs.com/package/remotion](https://www.npmjs.com/package/remotion)，最近一次发布约 2 天前）。Remotion 5.0 **尚未正式发布**，仍处于迁移文档撰写阶段：官方 [v5.0 迁移指南](https://www.remotion.dev/docs/5-0-migration) 明确写着 "Remotion 5.0 is not yet released. This is an incomplete list of breaking changes that are planned for the release."。因此本报告全部结论基于 **Remotion 4.0.x（4.0.506）**，并在涉及处标注 5.0 的已知计划变更。
- 文档站（remotion.dev/docs）内大量 API 用 `<AvailableFrom v="x.y.z" />` 标注引入版本，本报告在关键 API 上都摘录了这个版本号。
- **重要背景变化**：Remotion 在 4.0.x 生命周期内新增了 **`@remotion/media`** 包（内部基于 **Mediabunny**），这是一次不小的架构变化——官方原本"Player 用 `<Video>`/`<Html5Video>`、渲染用 `<OffthreadVideo>`"的两套组件的建议，现在被"两端统一用 `@remotion/media` 的 `<Video>`"取代。社区文章与 npm 变更记录显示，Remotion 在 2026 年 2 月起推荐从旧的 Media Parser 迁移到 Mediabunny（"As of February 1st 2026, Media Parser is now deprecated, and Remotion recommends migrating to Mediabunny"）。这个变化直接决定了第 1 题的结论，务必按当前版本（4.0.506）而非旧教程的结论来设计。

---

## 1.〈Video〉vs〈OffthreadVideo〉：两端可用性与行为差异

### 结论

Remotion 4.0.506 里，视频相关组件其实有 **三套**，官方在专门的对比页 [`/docs/video-tags`](https://www.remotion.dev/docs/video-tags) 里给出了权威对比：

| 组件 | 底层技术 | 来源包 | Player（浏览器预览） | Rendering（Node 端） | Client-side rendering |
|---|---|---|---|---|---|
| `<Video>`（**新，推荐**） | Mediabunny + WebCodecs | `@remotion/media` | ✅ 支持 | ✅ 支持（用 Mediabunny 解帧） | ✅ 支持 |
| `<OffthreadVideo>` | Rust + FFmpeg 二进制 | `remotion` | ❌ **不支持**（"Not supported in client-side rendering"，且文档原文警告不能在 `@remotion/player`/`@remotion/web-renderer` 中使用） | ✅ 支持（渲染时用 FFmpeg 在浏览器外单独抽帧，塞进 `<Img>`） | ❌ 不支持 |
| `<Html5Video>`（原来的 `<Video>`，现改名） | 原生 `<video>` 标签 | `remotion` | ✅ 支持 | ✅ 支持，但"帧精确度不保证"（"Not guaranteed"） | ❌ 不支持（"Use `<Video>` from `@remotion/media` instead"） |

关键原文：
- `<OffthreadVideo>` 文档明确：**"Not supported in client-side rendering"**，"`<OffthreadVideo>` is not supported in `@remotion/web-renderer`. ... For new video usage, prefer `<Video>` from `@remotion/media`"。也就是说 **Player 里不能用 `OffthreadVideo`**，这一点没有变。（[docs/offthreadvideo](https://www.remotion.dev/docs/offthreadvideo)）
- `/docs/video`（现在文档站上这个 URL 对应的是 `<Html5Video>`）原文：**"`<Video>` from `@remotion/media` is the recommended video component for new code"**，`<Html5Video>` 不支持 client-side rendering，要改用 `@remotion/media` 的 `<Video>`。（[docs/video](https://www.remotion.dev/docs/video)）
- `@remotion/media` 的 `<Video>` 页面原文：**"During rendering, it extracts the exact frame from the video using Mediabunny and displays it in a `<canvas>` tag."**，且明确"是新代码的推荐组件"。（[docs/media/video](https://www.remotion.dev/docs/media/video)）
- `video-tags` 对比页给出的关键结论：`<Video>`（`@remotion/media`）渲染速度 **"Fastest"**，帧精确度"帧完美"，且是三者中唯一 **Player 与 renderer 两端都支持、且都号称帧精确** 的组件。

### 两端如果必须用不同组件，一致性怎么保证

**在旧的两套组件体系下**（`Html5Video`/`Video` 给 Player，`OffthreadVideo` 给 renderer），官方给出的标准方案是用 `useRemotionEnvironment()` 这个 hook，在组件内部按运行环境切换：Player 环境渲染 `<Html5Video>`，渲染环境渲染 `<OffthreadVideo>`，二者共享同一组 `src`/`trimBefore`/`trimAfter` 等参数。这是"必须两端用不同组件"场景下官方认可的一致性方案，但本质上是"信任两个不同实现在语义上等价"，不是"字节级/像素级保证一致"。

**在当前版本（4.0.506）下更好的做法**：直接统一使用 `@remotion/media` 的 `<Video>`——两端走同一套 Mediabunny 解码逻辑，天然规避"两个组件语义对不齐"的风险。但要注意它有 **fallback 机制**（见下方"裂缝"），fallback 触发时两端会退化到不同组件，行为可能出现差异。

### 一致性裂缝：`@remotion/media` 的 fallback 机制

[`docs/media/fallback`](https://www.remotion.dev/docs/media/fallback) 明确列出 4 种触发 fallback 的场景：
1. 资源因 CORS 限制加载失败；
2. 容器格式 Mediabunny 不支持；
3. 编解码器 WebCodecs 解不了（例如渲染时遇到 H.265 流）；
4. 视频带 alpha 通道但浏览器不支持 WebGL。

触发后，**Player 端 fallback 到 `<Html5Video>`，renderer 端 fallback 到 `<OffthreadVideo>`**——原文举了一个具体的不一致案例：
> "During preview, the fallback uses `<Html5Video>`, which natively supports the `loop` prop. Looping works as expected." / "During rendering, `<OffthreadVideo>` does not natively support looping. To work around this, `@remotion/media` attempts to determine the duration of the video and automatically wraps `<OffthreadVideo>` in a `<Loop>` component." 并且如果时长无法确定，"the render will fail with an error"，而预览可能是成功的。

**结论**：对本项目（20 段实拍 MP4，H.264/H.265 常见编码，无 alpha 通道需求）来说，只要素材统一转成 H.264 + 常见容器（mp4/mov），基本不会触发 fallback，`<Video>` 的两端一致性可以视为成立；但工程上**必须在导入素材阶段做一次编解码器/容器归一化校验**（比如强制转码成 H.264 yuv420p mp4），否则一旦某条素材触发 fallback，Player 和渲染出的 MP4 就可能在循环/时长处理上出现差异。

---

## 2. 截断：素材 8 秒只播放前 5 秒

### 结论

当前（4.0.506）正确 API 是 **`trimAfter`**（配合 `trimBefore` 一起用于裁剪素材的头尾）。`startFrom`/`endAt` 是**历史名字，已在 v4.0.319 重命名**，虽然仍可用但不能和新 prop 混用。裁剪单位是**帧数**（以合成的 fps 为准，不是素材自身的帧率）。

官方原文（`docs/audio` 页，`trimBefore`/`trimAfter` 对 `<Video>`/`<Audio>` 是同一套语义）：
> "These props have been renamed to `trimBefore` and `trimAfter` in 4.0.319. They will continue to work, however you cannot combine them with the new props."
> `trimBefore={60} trimAfter={120}`（30fps 下）"playback starts immediately, but with the first 2 seconds of the audio trimmed away"。

配合 `<Sequence>` 的必要性：`trimAfter` 只负责"素材内部裁多少"，`<Sequence durationInFrames={...}>` 负责"这个 Scene 在整条时间线上占多久"。对于"素材 8s、只播前 5s、Scene 就是 5s"这种最常见情形，两者数值相同，用 `trimAfter` 单独就够；但只要 Scene 时长和裁剪时长可能不一致（比如未来要做转场预留帧），就必须用 `<Sequence>` 包一层来显式限定占用的时间窗口，这是更稳妥、可读性更好的写法。`<Sequence>` 官方定义：**"Children are unmounted if they are not within the time range of display."**（[docs/sequence](https://www.remotion.dev/docs/sequence)）

### Player 与 renderer 是否一致

- 如果用 **`@remotion/media` 的 `<Video>`**（推荐）：`trimBefore`/`trimAfter` 两端行为一致，官方文档在 Player 和渲染两种环境下用的是同一套 prop 定义，未发现关于裁剪本身两端不一致的说明。
- 如果用 **`<OffthreadVideo>`**：只能在渲染端验证效果，Player 预览时该 Scene 需要临时换成 `<Html5Video>`（同样的 `trimBefore`/`trimAfter`），语义应等价，但如前所述不是"同一份代码路径"。

### 可运行的最小代码示例

```tsx
// TrimDemo.tsx
import { registerRoot, Composition, Sequence, staticFile } from "remotion";
import { Video } from "@remotion/media"; // 推荐：Player 与 renderer 两端通用

const FPS = 30;
const SCENE_SECONDS = 5; // Scene 只应播放 5 秒
const SCENE_FRAMES = SCENE_SECONDS * FPS; // 150 帧

// 假设素材 clip-8s.mp4 放在 public/ 目录下，实际时长 8 秒
const TrimmedScene: React.FC = () => {
  return (
    <Sequence durationInFrames={SCENE_FRAMES}>
      <Video
        src={staticFile("clip-8s.mp4")}
        trimAfter={SCENE_FRAMES} // 只保留素材的前 150 帧（5秒），之后的 3 秒被裁掉
        muted // 素材原声一律静音（第4题会展开）
      />
    </Sequence>
  );
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="TrimDemo"
    component={TrimmedScene}
    durationInFrames={SCENE_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);

registerRoot(RemotionRoot);
```

在 Remotion Studio (`npx remotion studio`) 里可以直接预览这个 Composition；渲染用 `npx remotion render TrimDemo out.mp4` 即可产出同样只有 5 秒的视频。如果项目沿用旧的 `<OffthreadVideo>`（比如暂时没升级到 `@remotion/media`），把 `<Video>` 换成 `<OffthreadVideo>` 即可，`trimAfter` 用法完全一致，只是 Player 里无法直接预览这个组件（需要 `useRemotionEnvironment()` 切换成 `<Html5Video>`）。

---

## 3. 冻帧：素材 3 秒撑满 5 秒，最后 2 秒冻结末帧

### 结论

Remotion **原生提供 `<Freeze>` 组件**（自 v2.2.0 起），不需要自己截图末帧做静态图叠加，也不需要手写"暂停播放头"的逻辑。

官方定义（[docs/freeze](https://www.remotion.dev/docs/freeze)）：
> "At which frame it's children should freeze"（`frame` prop，必填）
> "If a component is a child of `<Freeze/>`, calling the `useCurrentFrame()` hook will always return the frame number you specify, **irrespective of any `<Sequence>`**."
> 对媒体元素的影响："`<Video>`, `<OffthreadVideo />` and `<Html5Video />` elements will be paused and `<Audio>` and `<Html5Audio />` elements will render muted."——即被冻结区间内，视频画面定格、音频自动静音，不需要额外处理音频。

`active` prop（v4.0.127 起）可以接布尔值或者 `(frame) => boolean` 回调，用来做更灵活的"只在某个区间生效"的冻结控制，但对我们这种"从某一帧开始一直冻结到 Scene 结束"的简单场景用不上，直接固定冻结整个尾部区间即可。

### Player 与 renderer 是否一致

`<Freeze>` 是纯 React 层的时间轴劫持（重写 `useCurrentFrame()` 的返回值），不依赖 FFmpeg/Chromium 差异化实现，Player 和 renderer 两端共享同一套渲染路径，是本报告里**一致性最有把握的机制之一**。

### 可运行的最小代码示例

```tsx
// FreezeDemo.tsx
import { registerRoot, Composition, Sequence, Freeze, staticFile } from "remotion";
import { Video } from "@remotion/media";

const FPS = 30;
const SOURCE_FRAMES = 3 * FPS; // 素材实际时长 3 秒 = 90 帧
const SCENE_FRAMES = 5 * FPS; // Scene 需要撑满 5 秒 = 150 帧
const LAST_FRAME_INDEX = SOURCE_FRAMES - 1; // 89，素材的最后一帧（本地帧号）

const FreezeScene: React.FC = () => {
  return (
    <>
      {/* 第 0~89 帧：正常播放素材 */}
      <Sequence from={0} durationInFrames={SOURCE_FRAMES}>
        <Video src={staticFile("clip-3s.mp4")} muted />
      </Sequence>

      {/* 第 90~149 帧：冻结在素材最后一帧，补足到 5 秒 */}
      <Sequence from={SOURCE_FRAMES} durationInFrames={SCENE_FRAMES - SOURCE_FRAMES}>
        <Freeze frame={LAST_FRAME_INDEX}>
          <Video src={staticFile("clip-3s.mp4")} muted />
        </Freeze>
      </Sequence>
    </>
  );
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="FreezeDemo"
    component={FreezeScene}
    durationInFrames={SCENE_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);

registerRoot(RemotionRoot);
```

**为什么 `<Freeze frame={89}>` 里嵌套的第二个 `<Video>` 是对的**：`<Sequence from={90}>` 会把子组件的本地帧号重置为从 0 开始计数，但 `<Freeze>` 的官方语义是"无视任何外层 `<Sequence>`，强制子树的 `useCurrentFrame()` 恒等于 `frame` 值"，所以嵌套在里面的 `<Video>` 拿到的当前帧永远是 89（对应素材自己时间轴上的最后一帧），而不是 `Sequence` 重置后的 0。这正是官方在 [freeze-portions 示例](https://www.remotion.dev/docs/miscellaneous/snippets/freeze-portions) 里演示的"冻结片段/恢复"模式的简化版（该页给出的是更复杂的"冻结多段再恢复播放"的通用组件 `FreezePortion`，本报告的例子是它的特例：只冻结一段，一直冻到 Scene 结束，不恢复）。

工程实现建议：把"播放前 N 帧 + 从 N 帧开始冻结"封装成一个通用的 `SceneVideo` 组件，入参是 `sourceDurationInFrames`（素材实际帧数）和 `sceneDurationInFrames`（Scene 应占帧数），内部自动判断走"第2题的截断分支"还是"第3题的冻结分支"，这也直接对应票据里"旷白是时长的主人"的归属规则。

---

## 4. 音频拼接、原声静音与最终音轨合成

### 4.1 多段 TTS 音频按 Scene 顺序拼接

标准做法：用 **`<Sequence>` 包 `<Audio>`**，`from` 决定这段语音在整条时间线上从第几帧开始播放。官方原文（`docs/media/audio`）：
> "You can still wrap `<Audio>` in an outer `<Sequence>`. Timing cascades like nested sequences."

```tsx
import { Sequence, staticFile } from "remotion";
import { Audio } from "@remotion/media";

// 假设三段 TTS 音频，时长分别是 40/35/50 帧（示意）
const scenes = [
  { from: 0, durationInFrames: 40, src: staticFile("tts/scene-01.mp3") },
  { from: 40, durationInFrames: 35, src: staticFile("tts/scene-02.mp3") },
  { from: 75, durationInFrames: 50, src: staticFile("tts/scene-03.mp3") },
];

export const NarrationTrack: React.FC = () => (
  <>
    {scenes.map((s) => (
      <Sequence key={s.src} from={s.from} durationInFrames={s.durationInFrames}>
        <Audio src={s.src} />
      </Sequence>
    ))}
  </>
);
```

`trimBefore`/`trimAfter`（同第 2 题，v4.0.319 后的命名）用于裁掉某段 TTS 音频头尾的静音/杂音；`volume` 支持常量或按帧函数（用于淡入淡出）。

### 4.2 素材原声彻底静音

**`muted` prop 足够**，官方原文（`docs/media/audio`，同样适用于 `<Video>` 的 `muted`）：
> "The `muted` prop will be respected. It will lead to no audio being played while still keeping the audio tag mounted."

并且 `docs/video`（`Html5Video`）额外指出一个渲染性能收益：给视频加 `muted` 后，**"Remotion will not have to download the video file during rendering in order to extract the audio from it"**——也就是说，`muted` 不只是"听不见"，在渲染管线里还会跳过对该视频音轨的抽取工作，是本项目"素材原声一律静音"这条规则应该**在组件层显式设置**、而不是仅指望后期混音阶段裁剪掉的原因（更快、更不容易漏改）。

### 4.3 渲染出的 MP4 音轨如何合成

官方文档没有一篇专门的"音频渲染管线"技术细节页，但可以拼出可靠轮廓：
- `@remotion/renderer` 底层用 **FFmpeg** 完成最终的音视频合成/封装（[docs/renderer](https://www.remotion.dev/docs/renderer) 提到 `renderMedia()` 是 `renderFrames()` + `stitchFramesToVideo()` 的合并封装）。
- 多条 `<Audio>`/`<Video>`（非静音）在同一时间线上会被翻译成 FFmpeg 的多路输入 + **`amix` 类滤镜**混合成一条输出音轨，配合 `adelay` 之类的滤镜处理每段素材在整条时间线上的起始偏移（`from`）。Remotion 官方博客对这一点有直接表述（"Remotion mixing audio in FFmpeg just like you hear it in the browser preview"这一类描述可在 [Remotion 2.0 发布博客](https://www.remotion.dev/blog/2-0) 等资料中找到，官方 `docs/using-audio` 页对此有概述但未展开具体滤镜细节，这部分**技术实现细节官方文档未逐字给出，以上是基于 FFmpeg 常规音频混合方式 + Remotion 公开表态做的合理推断，不是文档逐字引用**）。
- 关键的一致性保证点：Remotion 官方明确表示他们的目标是"渲染时 FFmpeg 混音的结果要匹配浏览器预览里听到的效果"，这意味着音量曲线（`volume` 按帧函数）、`trimBefore/After`、`from` 偏移这些参数在两端是被同一份"时间线语义"驱动的，不是两套独立实现——这是音频侧一致性风险明显低于视频侧的原因（视频侧有 OffthreadVideo/Html5Video/fallback 的复杂性，音频侧目前没看到类似的双实现分裂）。

---

## 5. 本地渲染耗时

### 结论

**官方文档没有给出"1分钟视频大概渲染多久"这类具体基准数字**，也没有找到"渲染时间通常是视频时长的 N 倍"这样的官方经验法则。查阅了 [Performance Tips](https://www.remotion.dev/docs/performance/)、[`npx remotion benchmark`](https://www.remotion.dev/docs/cli/benchmark)、[编码器文档](https://www.remotion.dev/docs/encoding) 等页面，均未给出具体 fps/秒数指标，只给出定性建议和让用户自己跑 benchmark 的工具。因此**以下只讨论影响因素和量级判断依据，不编造具体数字**。

官方点名的主要影响因素：

1. **并发数 concurrency**：`renderMedia()` 的 `concurrency` 参数可以是具体数字、CPU 线程占比字符串（如 `"50%"`），或 `null` 交给 Remotion 自动决定（默认是"半数 CPU 线程"）。官方原文警告：**"The `--concurrency` flag you set can influence the rendering speed both positively and negatively."**——不是越高越快，过高会因资源争抢反而变慢，官方建议用 `npx remotion benchmark` 实测找最优值。（[docs/performance](https://www.remotion.dev/docs/performance/)，[docs/renderer/render-media](https://www.remotion.dev/docs/renderer/render-media)）
2. **硬件加速 / GPU**：从 **v4.0.228** 起支持编码硬件加速，但平台受限——H.264/H.265 在 macOS、Linux、Windows（仅限 NVIDIA GPU）上可用，VP8/VP9/AV1 不支持硬件加速，ProRes 仅 macOS 支持。且**开启硬件加速后不能再用 `crf` 控制质量**，是个取舍点。（[docs/encoding](https://www.remotion.dev/docs/encoding)）
3. **编码器选择 codec**：官方给出的相对速度排序——H.264"Very fast"，H.265"Fast"，ProRes"Fast"，VP8/VP9"Slow"，AV1"Very slow"。原文：**"The WebM codecs `vp8` and `vp9` are very slow at encoding due to stronger compression."** 本项目目标是标准 MP4 交付，理应选 H.264，规避 WebM/AV1 的编码开销。
4. **Chromium headless 渲染开销**：Performance Tips 页明确指出，**GPU 密集型效果（WebGL、2D Canvas、部分 CSS 滤镜如 blur/drop-shadow）在没有 GPU 的机器上会成为渲染瓶颈**："Compute instances in the cloud do not have a GPU and may take a long time to render these effects, leading to bottlenecks."——但反过来说，如果本地开发机有独立显卡（大多数场景下有），这一项瓶颈会显著缓解。本项目的视觉形态（Title/Video/Video+Caption/EndCard，纯硬切无转场）**不涉及复杂 WebGL/滤镜特效**，理论上比官方警告的"复杂动效"场景要轻得多。
5. **`<OffthreadVideo>` 长视频的已知性能坑（社区信息，非官方基准，仅供参考）**：GitHub 官方仓库的一则社区讨论（[remotion-dev/remotion#3070](https://github.com/orgs/remotion-dev/discussions/3070)）反映，用 `<OffthreadVideo>` 渲染两条约 40 分钟的视频时，渲染速度会从正常水平骤降到"约 5fps 并持续变慢"，作者称"素材更短（约 5 分钟）时没有此问题"。这是**社区反馈，不是官方数据**，但提示了一个方向性结论：**素材时长越长、`<OffthreadVideo>` 的抽帧/下载缓存开销越明显**。本项目每段素材很短（约 3~8 秒，共约 20 段），大概率不会撞到这个坑；但如果用新的 `<Video>`（`@remotion/media`）组件，其官方定性评价是"三者中最快"，风险应更低。

### 对"渲染要不要做后台任务"的建议

即使没有具体数字，以下几点足以支持"渲染应该做成异步后台任务"这个工程决策：
- 官方自己都要求用户通过 `npx remotion benchmark` **实测**才能知道特定机器上的速度，这本身说明耗时是不可预测、依机器配置浮动的，不适合做成同步阻塞的前端请求。
- 20 段素材的合成 + Chromium headless 逐帧渲染 + FFmpeg 编码，即便乐观，也大概率是"数十秒到数分钟"量级而非"秒级"，从用户体验角度就应该走"提交任务 -> 轮询/推送进度 -> 完成通知"的异步模式。
- 硬件加速、并发数都需要根据本机 CPU/GPU 动态调优，这类"自适应策略"更适合放在一个独立的渲染任务执行器里做，而不是耦合在请求-响应周期里。

---

## 6. 中文字体加载与两端一致性

### 结论

Remotion 官方提供两条字体加载路径，二者都通过 **`@remotion/fonts` 的 `loadFont()`** 或者 **`@remotion/google-fonts`** 完成，本质都是往页面注入 `@font-face` 并返回一个 Promise，Remotion 框架层保证"渲染前一定等字体加载完成"：

> `docs/fonts`：**"From version 2.2 on, Remotion will automatically wait until the fonts are loaded"**，并建议"For projects with multiple fonts, load fonts in one shared module and wait until they are ready before rendering."

代码示例（官方文档给出）：
```tsx
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

loadFont({
  family: "MyChineseFont",
  url: staticFile("fonts/NotoSansSC-Regular.woff2"),
  weight: "500",
}).then(() => {
  console.log("Font loaded!");
});
```

对中文字体的具体建议：
- 中文字体文件通常很大（完整字集几 MB 到几十 MB），官方推荐把字体文件放进 `public/` 目录，用 `staticFile()` 引用（同一套机制两端通用，见第 7 题）。
- 如果字体来自 Google Fonts（例如 Noto Sans SC/TC），可以用 `@remotion/google-fonts` 按需导入，如 `import('@remotion/google-fonts/NotoSansSC')`，用 `fontFamily: "Noto Sans SC"` 在 CSS 里引用（这是包命名约定层面确认的，未逐字翻到该子页面完整正文，`/docs/google-fonts` 详情页在多次抓取时返回 404，可能是站内路由变更，此处结论主要来自搜索结果聚合，建议后续用站内搜索复核一次）。
- 中文字体子集化（subsetting）官方文档未见到专门段落说明，**这属于文档未明确覆盖、需要自行工程解决的部分**：建议在项目构建阶段用 `fonttools`/`subset-font` 之类工具，仅打包实际用到的汉字子集，避免每次预览/渲染都加载几十 MB 的全字体文件拖慢启动速度。

### 两端一致性保证的关键点

1. **同一份字体文件**：Player 和 renderer 必须引用**同一个物理字体文件**（走 `staticFile()`/相对路径这套机制，见第 7 题的方案），如果两端各自本地安装了"看起来一样"但实际字重/版本不同的系统字体（比如都写 `font-family: "PingFang SC"`），会导致 renderer 端（无头 Chromium，通常没有装 macOS 的苹方字体）**直接 fallback 到默认字体**，造成预览和成片字形、换行完全不同——这是中文场景最容易踩的坑，必须**禁止依赖系统预装中文字体，一律显式打包并 `loadFont()` 加载 Web 字体**。
2. **必须等待字体加载完成再测量/渲染文本换行**：中文字幕的自动换行逻辑如果依赖测量文本宽度（例如用 canvas `measureText` 或者 DOM 元素宽度做手动断行），必须在 `loadFont()` 的 Promise resolve 之后再测量，否则会用浏览器/Chromium 的默认字体宽度算出错误的换行点，而且这个错误在 Player 端和 renderer 端可能不一致（取决于各自默认字体是否恰好相同）。Remotion 框架层的"自动等待字体"只保证**渲染那一帧时字体已经就绪**，不保证**你自己在换行计算逻辑里手动测量文本时也顺带等了字体**——这一点文档没有专门强调，是本项目需要在自己的字幕排版组件里主动处理的部分（用 `delayRender()`/`continueRender()` 或者干脆等 `loadFont()` 的 Promise 之后再渲染字幕组件）。

---

## 7. 素材双通道访问路径（最核心问题）

### 方案对比

**方案 A：官方 `staticFile()` + `public/` 约定**

- 官方硬性目录规则：**"The `public/` folder should always be in the same folder as your `package.json` that contains the remotion dependency"**（[docs/staticfile](https://www.remotion.dev/docs/staticfile)）。
- 设计初衷是"避免部署到子目录时路径失效"：**"It prevents breaking when deploying your site into a subdirectory"**，同时官方在 [docs/miscellaneous/absolute-paths](https://www.remotion.dev/docs/miscellaneous/absolute-paths) 明确指出**不支持绝对路径**的四个原因：浏览器默认无法访问文件系统、web 框架约定只支持 `public` 目录、bundle 可能被上传到 Remotion Lambda/Cloud Run 等远端（只有 `public` 内容会被打进 bundle）、以及安全风险（"serving the full filesystem via HTTP...this would be a security risk"）。
- **不适用本场景**：本项目是"项目即文件夹、素材路径任意"，用户可能把素材放在项目文件夹下任意子目录甚至通过软链接引用文件夹外的素材，要求所有素材必须**复制**进一个固定的 `public/` 目录才能用，等于强加一次额外的复制/同步步骤，破坏"项目文件夹是唯一数据源"的设计，而且用户编辑素材时容易忘记同步复制，导致 DSL 引用的 `public/` 副本和源文件不一致。

**方案 B：本地起静态文件服务器，DSL 存相对路径，两端各自拼 URL/路径（推荐）**

- 这正是官方在"素材不在 `public/` 里怎么办"这个问题下给出的**官方推荐逃生舱**：[docs/miscellaneous/absolute-paths](https://www.remotion.dev/docs/miscellaneous/absolute-paths) 原文：**"you can use `npx serve` to serve a folder on your computer via HTTP"**，或者用 **`serve-handler`** 以编程方式起服务：**"use `serve-handler`"**。也就是说，"起一个静态文件服务器把任意文件夹映射成 http 前缀"不是我们自己发明的旁路方案，而是 Remotion 官方文档白纸黑字认可的做法。
- 再结合渲染管线的事实：无论是 `<Video>`（`@remotion/media`/Mediabunny）还是 `<OffthreadVideo>`（FFmpeg），渲染时都是**通过 URL 抓取素材**（`OffthreadVideo` 内部走一个 `downloadMap` 把 `src` 指向的资源下载/缓存到本地临时目录再喂给 FFmpeg，这一步要求 `src` 是一个可以被 Node 环境请求到的 URL，而不是裸的文件系统路径），renderer 并不会绕开 URL 直接吃一个 fs 路径字符串。这意味着即使 renderer 跑在 Node 里、理论上可以直接读文件系统，**Remotion 的视频组件实际上要求两端都提供 URL**，"起本地静态服务器"天然满足这个约束，而且能保证 Player 和 renderer 读到的是**同一个物理文件**（同一个服务进程、同一份磁盘文件，不存在"复制出两份可能不同步"的问题）。
- **DSL 里存什么**：只存**相对于项目根目录的相对路径**（例如 `"videoPath": "assets/scene-03/clip.mp4"`），不存端口号、不存 `http://` 前缀、更不存绝对文件系统路径。URL/绝对路径都是运行时用"当前项目根目录 + 当前静态服务器监听的端口"现算出来的，不落盘。

**方案 C：DSL 存绝对路径 + 路径映射/别名转换层**

- 理论上可行（renderer 直接 `fs.readFileSync` 绝对路径，Player 端靠映射表把绝对路径转成 URL），但存在两个明显问题：
  1. 如前所述，Remotion 的视频组件在渲染阶段最终还是要一个 URL（哪怕是 `file://`，Node 侧常见的 `fetch`/`undici` 实现对 `file://` 协议的支持并不稳定完整），要绕开这一层去做"直接读文件塞帧"，等于放弃使用 `<Video>`/`<OffthreadVideo>` 自带的抽帧/解码能力，自己重新造轮子，工程代价远大于起一个静态服务器。
  2. 绝对路径天然和"项目文件夹可被移动/改名"冲突——移动后 DSL 里存的绝对路径全部失效，且没有一个"项目根目录"的锚点可以用来做批量修正，必须整份 DSL 做路径重写迁移，工程上比方案 B 脆弱得多。

### 推荐方案与代码示例（方案 B）

**总体设计**：
- 项目文件夹 = 唯一数据源，DSL（JSON）和素材文件都在这个文件夹下，DSL 只存**相对路径**。
- 薄 Node 服务在"打开项目"时，用 `serve-handler`（或等价的 express `static` 中间件）把项目根目录挂载成一个本地 HTTP 服务，端口可以动态分配（避免多项目/多次打开冲突）。
- Player（Vite React SPA）和 Remotion 渲染 Composition 共享同一个"相对路径 -> URL"的纯函数，两端用相同逻辑拼出同一个 `http://localhost:<port>/<relPath>`。

```ts
// shared/resolveMediaUrl.ts —— Player 和 Composition 代码共用的一份逻辑
export const resolveMediaUrl = (mediaBaseUrl: string, relPath: string): string => {
  // relPath 例如 "assets/scene-03/clip.mp4"，统一用 / 分隔，不做操作系统路径转换
  return `${mediaBaseUrl.replace(/\/$/, "")}/${relPath.replace(/^\//, "")}`;
};
```

```ts
// server/mediaServer.ts —— 薄 Node 服务：打开项目时启动
import serveHandler from "serve-handler";
import http from "node:http";

export function startMediaServer(projectRoot: string) {
  const server = http.createServer((req, res) =>
    serveHandler(req, res, { public: projectRoot })
  );
  return new Promise<{ port: number; close: () => void }>((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as any).port; // 动态端口，避免冲突
      resolve({ port, close: () => server.close() });
    });
  });
}
```

```tsx
// Player 端（Vite React SPA）
import { Player } from "@remotion/player";
import { MainComposition } from "./remotion/MainComposition";
import { resolveMediaUrl } from "./shared/resolveMediaUrl";

const mediaBaseUrl = `http://localhost:${mediaServerPort}`; // 来自 startMediaServer() 的返回值

<Player
  component={MainComposition}
  inputProps={{
    mediaBaseUrl,
    scenes: dsl.scenes, // scenes[i].videoPath 是相对路径，如 "assets/scene-03/clip.mp4"
  }}
  durationInFrames={totalFrames}
  fps={30}
  compositionWidth={1920}
  compositionHeight={1080}
/>;
```

```tsx
// remotion/MainComposition.tsx —— Player 与 renderer 共用的同一份 Composition 代码
import { Video } from "@remotion/media";
import { Sequence } from "remotion";
import { resolveMediaUrl } from "../shared/resolveMediaUrl";

export const MainComposition: React.FC<{
  mediaBaseUrl: string;
  scenes: { from: number; durationInFrames: number; videoPath: string }[];
}> = ({ mediaBaseUrl, scenes }) => (
  <>
    {scenes.map((s) => (
      <Sequence key={s.videoPath} from={s.from} durationInFrames={s.durationInFrames}>
        <Video src={resolveMediaUrl(mediaBaseUrl, s.videoPath)} muted />
      </Sequence>
    ))}
  </>
);
```

```ts
// server/render.ts —— renderer 端：selectComposition + renderMedia
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { startMediaServer } from "./mediaServer";

export async function renderProject(projectRoot: string, dsl: ProjectDsl, outPath: string) {
  const { port, close } = await startMediaServer(projectRoot); // 渲染时同样起（或复用）这个静态服务
  try {
    const bundleLocation = await bundle({ entryPoint: require.resolve("../remotion/index.ts") });

    const inputProps = {
      mediaBaseUrl: `http://localhost:${port}`, // 和 Player 端拼 URL 的逻辑完全一致
      scenes: dsl.scenes,
    };

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "MainComposition",
      inputProps,
    });

    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outPath,
      inputProps, // 与 selectComposition 保持一致
    });
  } finally {
    close();
  }
}
```

这套方案下，Player 和 renderer **读取的是同一个 Node 静态文件服务进程、同一份磁盘文件**，不存在"两份拷贝"或"两套路径解析规则"的风险，也完全符合 Remotion 官方在 `absolute-paths` 文档里认可的做法。

### 项目文件夹被移动/改名后的行为

- **不会失效的部分**：DSL 里的相对路径（`scenes[i].videoPath` 等）本身不含任何机器相关信息，文件夹整体移动/改名后这些相对路径依然有效。
- **需要重新建立的部分**：`mediaBaseUrl`（含端口号）**绝不能持久化进 DSL 或任何缓存文件**——它必须是"每次打开项目时，薄 Node 服务重新在当前项目根目录上起服务、拿到的新端口"现算出来的运行时值。只要遵守"打开项目 -> 用当前磁盘上的真实路径重新 `startMediaServer()` -> 把新端口传给 Player 的 `inputProps`"这个流程，移动/改名文件夹后重新打开就能**自愈**，不需要用户手动做任何路径修复。
- **需要显式报错定位的部分**：如果移动/改名过程中**素材文件本身**也被移动、删除或改名（比如用户手动整理了文件夹内部结构），DSL 里的相对路径会指向一个不存在的文件。建议在"打开项目"时做一次**素材完整性校验**：遍历 DSL 里所有 Scene 的 `videoPath`，用 `fs.existsSync(path.join(projectRoot, videoPath))` 检查，收集所有缺失项，向用户报告"Scene xxx 的素材 assets/scene-03/clip.mp4 未找到（期望路径：/абс/绝对路径）"，而不是让 `<Video>` 组件在 Player 里静默显示黑屏/加载失败、或者让渲染任务跑到一半才因为 404 报错——**校验要在项目加载的第一时间做，报错信息里必须带上 Scene ID + 相对路径 + 拼出的绝对路径**，这样用户/开发者能一眼定位问题，而不是去猜测。
- 额外提醒：**多项目/多次打开的端口冲突**需要用动态端口分配（如上面代码里 `server.listen(0, ...)`），否则同时打开两个项目会抢占同一个固定端口。

---

## 8. 商业许可条款

### 结论（事实性，逐字引用官方 LICENSE.md）

Remotion 采用**双层许可**：个人/小团队免费（含商用），达到一定规模的营利性组织需付费购买 **Company License**。以下逐字引自官方仓库 [`remotion-dev/remotion/LICENSE.md`](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)（通过 `remotion.dev/license` 会 307 跳转到这个文件，二者是同一份内容，Copyright 标注 2026）：

> **Free License — Eligibility**
> "You are eligible to use Remotion for free if you are:
> - an individual
> - a for-profit organization with up to 3 employees
> - a non-profit or not-for-profit organization
> - evaluating whether Remotion is a good fit, and are not yet using it in a commercial way"

> **Free License — Allowed use cases**
> "Permission is hereby granted, free of charge, to any person eligible for the 'Free License', to use the software non-commercially or commercially for the purpose of creating videos and images and to modify the software to their own liking, for the purpose of fulfilling their custom use case or to contribute bug fixes or improvements back to Remotion."

> **Free License — Disallowed use cases**
> "It is not allowed to copy or modify Remotion code for the purpose of selling, renting, licensing, relicensing, or sublicensing your own derivate of Remotion."

> **Company License**
> "You are required to obtain a Company License to use Remotion if you are not within the group of entities eligible for a Free License. This license will enable you to use Remotion for the allowed use cases specified in the Free License, and give you access to prioritized support... Visit remotion.pro for pricing and to buy a license."

**逐条落地到本项目关心的规模判断**：

| 主体类型 | 是否需要付费 | 依据 |
|---|---|---|
| 个人开发者（哪怕做商用视频） | 不需要，免费 | "an individual" 直接落在 Free License |
| 4 人以下的营利性公司/团队 | 不需要，免费 | "a for-profit organization with **up to 3 employees**" —— 门槛是 **3 名员工（含）以内**，第 4 人起就需要付费 |
| 4 人及以上的营利性公司 | **需要付费**，购买 Company License | 超出 "up to 3 employees" 门槛 |
| 非营利组织 | 不需要，免费，且**不限规模** | "a non-profit or not-for-profit organization" 没有人数限制 |
| 尚在评估阶段、还没商用 | 不需要，免费 | "evaluating whether Remotion is a good fit, and are not yet using it in a commercial way" |

**Company License 具体价格**（来自 [remotion.pro/license](https://www.remotion.pro/license)，这是官方定价页，但不是 LICENSE.md 本身条款，属于商业条款细节，建议签约前以该页面实时价格为准）：
- **Remotion for Automators**：按渲染量计费，"$0.01 per render"，最低消费 "$100/mo minimum"，面向"companies launching applications and systems"这类场景——**与本项目"单用户本地渲染应用"的定位高度相关**。
- **Remotion for Creators**：按坐席计费，"$25/mo per seat"，最低 3 席（$75/mo），面向"low volume video creations through coding and prompting"的小规模创作场景。
- 两者叠加存在 "$100/month" 的最低消费门槛描述（页面结构显示默认组合会凑到 $100/mo 的最低消费）。
- **Enterprise License**："Starting at $500 per month"，"Custom terms, billing and pricing"，面向"advanced needs"，达到 $100/mo 消费即"eligible for the Enterprise License"。

**5.0 即将生效的许可变化**（重要，会影响未来的合规判断）：GitHub PR [#3750](https://github.com/remotion-dev/remotion/pull/3750)（"Prepare Remotion 5.0"）原文：
> "Besides wording changes, there are two effective changes in this license:
> - Contractors also count towards team size. Previously, a company could only work with contractors and never have to get a company license.
> - The company license is bound to our terms and conditions that will be introduced with Remotion 5.0."

也就是说，**当前 4.0.x 的免费门槛判断"员工"时不计入外包/合同工**，但 Remotion 5.0 发布后，**外包人员也会被计入团队规模**，这对"用外包/自由职业者组建团队来规避付费门槛"的做法会失效——如果本项目未来考虑产品化并雇佣或外包人手，需要在升级到 5.0 之后重新核算团队规模是否仍在免费范围内。

**对本项目的产品化路径含义**：
- 只要产品保持"单用户本地应用、个人使用"的形态，落在 "an individual" 条款下，**完全免费，包括商用**（比如个人接单做视频也算免费范围，因为条款写的是 "non-commercially or commercially"）。
- 一旦发展成一个 4 人以上的营利性公司/团队来运营这个产品（无论是自己开发时团队规模，还是把它包装成 SaaS 卖给终端用户由公司运营），都需要买 Company License；如果打算做成"渲染即服务"的应用/系统（"launching applications and systems"），"Remotion for Automators"（按渲染量计费）是官方明确对号入座的档位。
- 不允许的是"把 Remotion 本身的代码拿去做二次分发/转售/授权"（"selling, renting, licensing, relicensing, or sublicensing your own derivate of Remotion"），这与本项目"用 Remotion 做视频生成工具"的用法无关，不构成限制。

---

## 总体结论：「Preview = Render」能否成立？

**能够天然保证一致的部分**（工程投入很低，直接用官方推荐 API 即可）：
- **冻帧**（第3题）：`<Freeze>` 是纯 React 时间轴逻辑，两端同一套实现，一致性最有把握。
- **截断**（第2题）：`trimBefore`/`trimAfter` 语义在文档层面两端一致，只要统一走 `@remotion/media` 的 `<Video>`，就是同一份组件实现，不存在"两套代码路径"的问题。
- **音频拼接与静音**（第4题）：`<Sequence>` + `<Audio>` + `muted` 是纯时间线/声明式配置，Remotion 官方目标就是让渲染出的混音匹配预览听感，没发现类似视频组件那样的双实现分裂。
- **字体加载时序**：框架层面（v2.2 起）保证渲染前等待 `loadFont()` 完成，这条官方兜底是可靠的。

**存在裂缝、需要工程上主动管理风险的部分**：
- **视频组件的 fallback 机制**（第1题）：`@remotion/media` 的 `<Video>` 在 Player 端和 renderer 端表面上是同一组件，但一旦触发 fallback（CORS/编解码器不支持/alpha 通道），两端会分别退化成 `<Html5Video>` 和 `<OffthreadVideo>`，且官方自己举了"循环播放行为不同、甚至渲染直接失败"的例子。**对策**：素材导入阶段强制归一化编码（H.264 + yuv420p + 常见容器），从源头上避免触发 fallback 分支，而不是寄希望于 fallback 后两端还能长得一样。
- **中文字体的字形/换行一致性**（第6题）：官方框架层只保证"渲染前字体加载完成"，不保证"你自己写的换行测量逻辑也等了字体"，也不保证两端不会不小心引用了系统预装的、版本不同的同名字体。**对策**：字幕组件必须显式 `loadFont()` 之后再排版测量，全程只用打包进项目的 Web 字体，禁止依赖操作系统预装字体。
- **本地渲染耗时不可预测**（第5题）：官方自己都没有给出可靠基准数字，耗时高度依赖本机 CPU/GPU、并发数、编码器选择。这不是"Preview = Render 是否一致"的问题，而是"渲染要不要做成异步后台任务"的问题——结论是**必须做成异步任务**，不能假设渲染是秒级操作。

**需要额外工程投入才能补齐一致性的部分（本项目的关键设计决策）**：
- **素材双通道访问路径**（第7题）：Remotion 官方的 `staticFile()`/`public/` 约定不适合"项目即文件夹"的场景；官方自己也承认这种场景需要用户自己起一个静态文件服务器（`npx serve`/`serve-handler`）。本报告推荐的方案是：**DSL 只存相对路径，薄 Node 服务把项目根目录整体映射成一个本地 HTTP 服务，Player 和 Composition 代码共用同一份"相对路径 -> URL"函数**，从而保证两端读到的是**同一个物理文件**，而不是"看起来一样但其实是两份拷贝"。这个方案不是 Remotion 内置能力，需要项目自己实现（起服务、动态端口分配、项目打开时的素材完整性校验、明确的缺失文件报错），但每一步都有官方文档背书，不是野路子。

**总体判断**：在"20 段实拍短视频 + TTS 音轨 + 中文字幕 + 纯硬切"这个相对简单的内容形态下，只要做好三件事——① 素材编码归一化以避开 `@remotion/media` 的 fallback 分支，② 字幕组件显式等待字体加载后再排版，③ 用"项目根目录起本地静态服务 + DSL 存相对路径"解决双通道访问——「Preview = Render」在工程上是**可以做到接近成立**的，裂缝主要来自"官方框架尚未完全统一"的历史遗留（视频组件三代并存、fallback 机制）和"文档未覆盖的自行实现部分"（字体测量时序、素材路径映射），而不是 Remotion 架构性地不支持这个目标。

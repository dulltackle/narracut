# 地图：Video Script V1 技术规格

Status: active

## Destination

一份可直接开工的 **V1 技术规格**，四项收敛到位：**DSL schema**、**时间模型**、**渲染管线**、**Visual Type 首批清单**。

范围是**单用户可跑通的完整闭环**：写文案 → 生成语音 → 绑定素材 → 实时预览 → 渲染出 MP4。

验收锚点是一条真实视频：**中文仪器操作演示，1 分钟以内、20 句以内、每句配一段实拍片段**。

地图走完时，不应再剩下需要拍板的设计决策——只剩实现。

## Notes

**域**：以「脚本句子」为编辑单位的视频生成工具。用户编辑的是脚本及其对应视觉，不是时间线。

**上游文档**：仓库根的 `prd.md`。注意它的视觉体系偏向数据/营销类视频（Metric、Chart、Comparison…），与本次验收锚点错开——**冲突时以本地图的约束为准**。

**每个 session 必须调用**：`/grilling`、`/domain-modeling`。prototype 票另加 `/prototype`；research 票交给 `/research` 子 agent。

**已定约束**（2026-08-06 charting 会话敲定，后面每张票都受约束）：

| 维度 | 决定 |
|---|---|
| 部署形态 | 单用户本地应用，不做 SaaS |
| 数据 | 单个 `project.json`，项目就是一个文件夹 |
| 技术栈 | Vite + React SPA + 薄 Node 服务；TanStack Table、Zustand、Zod、Remotion |
| 转场 | 只有 Cut。DSL 保留 `transition` 字段，V1 唯一取值 `cut` |
| 素材形态 | 每句一个独立视频文件，拍摄时即按句分镜 |
| 时长归属 | **旁白是时长的主人**。素材长了截断、短了冻最后一帧 |
| 素材音频 | 一律静音，音轨只有 TTS |
| 字幕 | P0，文本直接取 `narration.text` |
| 视觉 | 单一硬编码视觉，**渲染器内部必须按 design token 组织**，但 V1 不做主题切换 |
| Visual Type | 只有 4 个：`Title` / `Video` / `Video+Caption` / `EndCard` |
| 画幅 | 锁定 16:9、1920×1080、30fps |
| TTS | MiniMax Speech 2.8 Turbo，key 已有。**走 tokendance 代理还是直连 MiniMax 官方，由 08 号票实测后定** |
| 保密 | 旁白**文本可外发**给 TTS；**视频素材全程不出本机** |
| 实现方式 | agent 为主 + 人工审核，时间盒约一个月 |
| 素材寻址 | DSL 只存**相对项目根的相对路径**；Node 服务把项目根整体映射成本地 HTTP（动态端口）；**端口/URL 绝不落进 DSL**。Player 与 Composition 共用同一个「相对路径→URL」函数（出处：[02](issues/02-remotion-render-research.md) 第 7 条） |
| 渲染 | 耗时不可预测，**必须是异步后台任务**，不能假设同步秒级完成（出处：[02](issues/02-remotion-render-research.md) 第 5 条） |
| 字体 | 中文字体必须用 `loadFont()` 显式加载并放 `public/`，**禁止依赖系统字体**；自写的换行测量必须等字体 resolve（出处：[02](issues/02-remotion-render-research.md) 第 6 条） |
| Remotion 许可 | 个人（含商用）、≤3 人营利公司、非营利组织免费；**4 人及以上营利团队须购买 Company License**。5.0 起外包/合同工也计入人数——团队一旦扩张要重新核算 |

**测试夹具**：真实文案放 `fixtures/script.md`，代表性样片放 `fixtures/clips/`（见 04 号票）。

## Decisions so far

<!-- 一行一张已关闭的票：足够判断相关性，细节点进去看 -->

- [01 — TTS 接入调研：MiniMax Speech 2.8 Turbo](issues/01-tts-minimax-api.md) — MiniMax 原生协议已查清：`extra_info.audio_length` 直接返回毫秒级时长、原生支持字/词级时间戳、$60 每百万字符、RPM 60、有显式停顿标记 `<#x#>`。但两件关键事实无法从文档确认：**tokendance 平台层的全部约定**（该站是纯前端 SPA，抓不到文档），以及**中文句首尾是否自带静音 padding**（官方完全未提）。两项转入 [08](issues/08-tts-live-verification.md) 拿 key 实测。
- [02 — Remotion 实拍渲染调研：Preview = Render 能不能成立](issues/02-remotion-render-research.md) — **能成立，但有一道必须堵住的裂缝**。截断（`trimBefore`/`trimAfter`）与冻帧（`<Freeze>`，自动暂停视频并静音）都是原生能力，有可跑代码。素材双通道有确定方案：DSL 存相对路径 + Node 服务把项目根映射成本地 HTTP。裂缝在 `@remotion/media` 的 fallback——遇到 CORS 或不支持的编解码器时，Player 退到 `<Html5Video>`、renderer 退到 `<OffthreadVideo>`，两者行为不一致（官方自己举了循环播放的例子）。**规避手段是控死素材编码**，转入 [09](issues/09-asset-import-spec.md)。另外：渲染耗时不可预测，必须做成异步后台任务；许可上个人与 ≤3 人营利公司免费。

## Not yet specified

范围之内、但现在还说不清楚的：

- **Undo / Redo 与 Auto Save 的模型**——是 DSL patch 还是整份快照，要等 06 号票把 DSL 结构定下来才谈得清
- **编辑器界面**——表格列怎么排、Inspector 何时展开、Table↔Preview 联动在边界帧上怎么判定「当前是哪个 Scene」
- **素材导入体验**——20 段素材怎么快速对上 20 句（拖拽、批量、按文件名自动配对？）这块可能比想象中吃重
- **错误模型**——渲染失败怎么呈现、怎么定位到具体 Scene（PRD 第 34 节的要求）
- **空状态与示例项目**——新项目打开时看到什么
- **应用分发**——怎么装、怎么更新（07 号票会碰到边缘）
- **素材原声与环境音**——V1 静音，将来要不要放开
- **逐字字幕 / 字级时间戳**——01 号票查明 TTS **原生就支持** `word` 级时间戳（`subtitle_enable` + `subtitle_type`），成本比预想的低得多。仍留在 V1 之外，但将来要做时这里没有技术障碍

## Out of scope

明确划到本次终点之外的，**不会**随前沿推进而毕业；要做只能重画终点、另起一张地图。

- **SaaS 全套基础设施**（多租户、Postgres、Redis 队列、对象存储、多项目 Dashboard、账号体系）——要验证的假设与它们无关，且它们都是「已知怎么做」的工程，不该占预算
- **交叉转场**（Cross Fade / Slide / Wipe / Zoom）——只留 Cut 就消掉了 Duration 三种语义的分叉，这是本次范围收敛里最划算的一笔交易
- **显式 Trim 与长录像切分**——是一整条独立产品线（选段 UI、in/out 点、两侧 seek 精度对齐），靠「按句拍摄」规避
- **另外 8 个 Visual Type**（Kinetic Text / Image / B-Roll / Screen Demo / Metric / Comparison / Quote / Chart）——服务的是另一类视频；`visual.type` 是开放枚举，将来加是低风险增量
- **多画幅**（9:16、1:1）
- **Theme 选择与 Brand Kit**——V1 单一视觉，只在渲染器内部保留 token 化结构
- **AI 能力**（Generate Visual / Script→Scenes / Suggest Visual）——只要求 DSL 保持 AI 可生成，见 06 号票第 8 条
- **协作、评论、模板市场、插件系统**

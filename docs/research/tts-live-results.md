# TTS 实测：MiniMax Speech 2.8 Turbo（经 TokenDance）

实测日期：2026-08-08（America/Los_Angeles）

本报告补齐 [TTS 接入调研：MiniMax Speech 2.8 Turbo](https://github.com/dulltackle/narracut/issues/6) 中只能拿 key 验证的部分。凭据仅从项目根 `.env` 读取；报告、Git diff 和命令输出均不包含 key 或账户余额。

## 结论

1. **TokenDance 走 MiniMax 原生 T2A 协议，不是 OpenAI Audio 协议。** 实际 Base URL 是 `https://tokendance.space/gateway/minimax/v1`，合成路径是 `/t2a_v2`，鉴权仍是 `Authorization: Bearer ...`。`/audio/speech` 返回 HTTP 404。
2. **TokenDance 改了模型 ID，但完整透传响应。** 官方 ID `speech-2.8-turbo` 返回 HTTP 400 `模型不存在`；TokenDance ID `minimax-speech-2.8-turbo` 成功。响应仍含 `data.audio`、`extra_info`、`base_resp`、`trace_id`，音频仍是 hex，`extra_info` 没有被吞掉。
3. **`extra_info.audio_length` 可以直接作为 V1 的 Speech 时长。** 14 条主测试样本中，API 毫秒数与 ffprobe 的 MP3 容器时长全部完全相等，误差均为 **0 ms**，远低于 30fps 的一帧（33.3ms）。
4. **没有可安全统一裁掉的固定首尾 padding。** 在 `-50dB`、连续 50ms 的口径下，9 条句长/标点样本的句首近静音均值 68.3ms、范围 0–275ms；句尾均值 132.1ms、范围 0–262ms。换成 `-40dB` 后分别是 86.9ms（0–282ms）和 174.7ms（0–339ms）。同一文本三次调用的句尾近静音也在 235–312ms（`-50dB`）之间波动。**V1 不应按固定毫秒数掐头去尾，也不应做阈值式自动裁静音；应使用完整 Speech 的 `audio_length`。**
5. **同一请求不具备字节级或波形级确定性。** 完全相同的文本和参数连续调用三次，时长都为 3276ms，但三个 MP3 MD5 不同，解码成单声道 32kHz PCM 后 MD5 仍不同，证明不是仅容器元数据变化。缓存应缓存已生成的 Speech 文件，而不能假设重新调用会复现同一波形；Narration 或合成参数变化时，整句重新生成。
6. **`speed`、`emotion`、`<#x#>` 均可经 TokenDance 透传。** 同一文本基线为 2880ms，`speed: 1.2` 为 2628ms；`emotion: calm` 请求成功并得到 3240ms。`<#0.50#>` 组合样本检测到 1.067s 的内部近静音（包含句号的自然停顿，不能把 1.067s 全归因于标记），证明显式停顿标记生效。
7. **TokenDance 没有透传 `/get_voice`。** `POST .../get_voice` 返回 HTTP 404；已知系统音色 `Chinese (Mandarin)_News_Anchor` 可以正常合成。V1 若继续走 TokenDance，应固定一个已验证音色，不依赖运行时拉取完整音色清单。
8. **TokenDance 平台限流公开口径是用户 500 RPM、单 Key 500 RPM，两个门槛同时生效；HTTP 429 表示平台限流。** 上游供应商仍可能独立限流。V1 一次最多约 20 个 Scene，远低于平台门槛；实现仍应对 429 做指数退避。
9. **实际计费口径可以观测到积分，但公开资料不足以可靠换算成货币。** 一次隔离请求文本为“计费测试。”，响应 `usage_characters = 9`，账户 `credits_used` 增加 1800，即 **200 积分 / usage_character**。MiniMax 的中文计数口径是一个汉字计 2、标点计 1，因此这 5 个 Unicode 字符计为 9。报告不根据未公开的“积分兑人民币”比例猜测货币单价。

## 协议实测

### 成功请求

```text
POST https://tokendance.space/gateway/minimax/v1/t2a_v2
Authorization: Bearer <key>
Content-Type: application/json

model = minimax-speech-2.8-turbo
```

成功响应为 `application/json`：

```text
顶层字段：base_resp, data, extra_info, trace_id
data.audio：MP3 的 hex 字符串
extra_info.audio_length：毫秒
extra_info.audio_sample_rate：32000
extra_info.audio_format：mp3
extra_info.audio_channel：1
base_resp.status_code：0
```

### 失败对照

| 探针 | 结果 | 含义 |
|---|---:|---|
| `/t2a_v2` + `speech-2.8-turbo` | HTTP 400 | TokenDance 不接受官方模型 ID |
| `/t2a_v2` + `minimax-speech-2.8-turbo` | HTTP 200 | 正确组合 |
| `/audio/speech` + TokenDance 模型 ID | HTTP 404 | 不支持 OpenAI Audio 包装 |
| `/get_voice` | HTTP 404 | 未透传 MiniMax 的系统音色枚举接口 |

TokenDance 的公开模型目录也把该模型标为仅支持 `minimax:t2a_v2`、`minimax:t2a_v2_ws`、`minimax:voice_clone`，与实测吻合。

## 时长与首尾近静音

静音检测口径：`ffmpeg silencedetect`，至少连续 50ms；以下主表使用 `-50dB`。`API` 与 `ffprobe` 单位均为毫秒。

| 分组 | 样本 | API | ffprobe | 误差 | 句首 | 句尾 |
|---|---|---:|---:|---:|---:|---:|
| 标点 | 请确认样本架已经放置到位。 | 2952 | 2952 | 0 | 0 | 0 |
| 标点 | 请确认样本架已经放置到位？ | 2952 | 2952 | 0 | 54 | 0 |
| 标点 | 请确认样本架已经放置到位！ | 3060 | 3060 | 0 | 0 | 243 |
| 标点 | 请确认样本架已经放置到位， | 3060 | 3060 | 0 | 213 | 238 |
| 标点 | 请确认样本架已经放置到位 | 2952 | 2952 | 0 | 0 | 0 |
| 句长 | 请打开仪器电源。 | 2052 | 2052 | 0 | 0 | 262 |
| 句长 | 请确认样本架已经放置到位并锁紧。 | 3456 | 3456 | 0 | 73 | 243 |
| 句长 | 仪器完成自检后会进入待机状态，此时蓝色指示灯应保持常亮。 | 6660 | 6660 | 0 | 0 | 203 |
| 句长 | 如果屏幕显示错误代码，请先记录代码和当前步骤，再关闭电源并联系设备管理员。 | 7992 | 7992 | 0 | 275 | 0 |

“0”表示该边界没有检测到满足当前阈值和最短时长的连续近静音，不表示绝对没有低能量声音。阈值从 `-50dB` 改为 `-40dB` 后统计显著变化，进一步说明它不是一个稳定、可硬编码的 padding 常数。

## 重复调用一致性

完全相同请求三次：

| 调用 | API / ffprobe 时长 | MP3 MD5 | `-50dB` 句尾近静音 |
|---|---:|---|---:|
| 1 | 3276ms | `233314adbe0f19f08d6639d773129190` | 235ms |
| 2 | 3276ms | `a4776ae6ded6969f4929d705cf0a7ffe` | 269ms |
| 3 | 3276ms | `a9595c3176884e29bfb6442f3c8dc80b` | 312ms |

三份 MP3 解码后的 PCM MD5 也各不相同。因此只能说“本组三次时长一致”，不能把 MiniMax 定义成确定性合成器。

## 对时间模型的输入

- `Duration = extra_info.audio_length`，单位毫秒；换算帧数的取整规则由“时间模型定稿”决定。
- 不增加隐式的“首尾静音裁剪”步骤。若未来需要改变节奏，应把它建模成明确、可预览、可复现的 Speech 后处理，而不是隐藏阈值。
- Speech 缓存键至少包含 Narration 文本、模型 ID、音色与全部合成参数；缓存命中时直接复用已落盘文件。
- 任一缓存键字段变化，重新生成整个 Scene 的 Speech，并以新响应的 `audio_length` 更新时长。

## TokenDance 公开依据

- [快速开始](https://tokendance.space/docs/quickstart)：Base URL、Bearer 鉴权和公开模型目录。
- [请求限流](https://tokendance.space/docs/rate-limits)：用户与 API Key 各 500 RPM、HTTP 429、上游供应商限流。
- [开放平台 API](https://tokendance.space/docs/open-api)：用同一 API key 查询积分余额；本报告据此完成隔离计费测量。

## 路由决定

2026-08-08 已拍板：**V1 继续使用 TokenDance，不另行申请 MiniMax 官方 key。**

理由是现有 key、关键字段透传、时长精度、固定音色和参数能力都已通过实测；V1 不需要运行时枚举音色，代理层缺少 `/get_voice` 不构成阻塞。实现时把以下平台差异封装在 Node 侧 TTS 适配器中，不进入 DSL：

- Base URL：`https://tokendance.space/gateway/minimax/v1`
- 模型 ID：`minimax-speech-2.8-turbo`
- V1 固定音色：`Chinese (Mandarin)_News_Anchor`
- 429 指数退避，以及 TokenDance 错误体到 Job 错误模型的转换

这样未来若改为直连 MiniMax 官方，只替换适配器配置和协议映射，不迁移项目数据。

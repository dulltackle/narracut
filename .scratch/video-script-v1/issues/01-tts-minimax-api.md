# 01 — TTS 接入调研：MiniMax Speech 2.8 Turbo

Type: research
Status: resolved
Blocked by: —

## Question

MiniMax Speech 2.8 Turbo（经 https://tokendance.space/models/minimax-speech-2.8-turbo 接入）的 API 到底长什么样，**它能不能精确地告诉我们音频有多长**？

这张票之所以挡在时间模型前面，是因为整个产品的 Duration 都来自它的返回值。

必须回答：

1. **鉴权与调用**：endpoint、鉴权方式、请求体结构、响应结构。tokendance 是聚合平台，要分清哪些是平台的约定、哪些是 MiniMax 原生的。
2. **返回什么**：音频二进制 / URL / base64？容器与编码格式、采样率、声道。
3. **时长**：响应里**是否直接返回音频时长**？如果不返回，本地拿什么测（ffprobe？解码？）、精度到毫秒还是更粗？
4. **中文断句与韵律**：标点如何影响停顿？**句首句尾是否自带静音 padding**——这一条直接决定 Duration 的语义，20 句累积起来会不会让整条片子节奏拖沓。
5. **时间戳**：是否支持返回字级/词级时间戳？（现在只需知道有没有，逐字字幕在范围外）
6. **配额**：计费单位、速率限制、并发上限、单次文本长度上限。
7. **稳定性**：是否支持流式；同一段文本重复请求，音频是否逐字节/逐时长一致——这决定「改一个字要不要重新生成整句」以及能不能做缓存。
8. **可选音色与参数**：V1 只需要一个中文音色，但要知道可选面和参数名（speed、emotion 等），以免 DSL 里留错了口子。

## 约束

- 单用户本地应用，key 存在本机。
- 旁白**文本可以外发**；视频素材不出本机（本票不涉及素材）。
- 中文旁白，句子长度约 10–40 字。

## 产出

写到 `.scratch/video-script-v1/research/tts-minimax.md`，并把结论回填到本票的 `## Answer`。
能实际发一次请求验证的部分，优先给实测结果而不是文档转述。

## Answer

完整报告见 `.scratch/video-script-v1/research/tts-minimax.md`（含每条结论的来源、原文摘录、可直接运行的 curl/脚本）。

**重要限制**：tokendance.space 是纯前端渲染 SPA，WebFetch 抓不到任何文档正文（模型页、首页、/docs、/docs/quickstart、docs 子域名全部试过，只返回空标题）。因此**本报告里所有"tokendance 平台自身约定"的结论都是待实测，没有一手依据**；MiniMax 官方文档（`platform.minimax.io`）内容完整，是本报告的主要一手来源。

1. **鉴权与调用**：MiniMax 原生层**已查证**——`POST https://api.minimax.io/v1/t2a_v2`，`Authorization: Bearer <key>`，请求体核心字段 `model`/`text`/`voice_setting`/`audio_setting`，响应体含 `data.audio`、`extra_info`、`base_resp`。tokendance 层（base URL、鉴权 header 名、接口路径是否被包装成 OpenAI 风格）**全部待实测**，报告第 1 节给出了两组对照 curl（原生协议 vs OpenAI 兼容协议）。

2. **返回什么**：MiniMax 原生**已查证**——音频以 `hex` 或 `url`（24 小时有效）返回，不支持 base64；容器可选 mp3/pcm/flac/wav/opus 等（默认 mp3）；采样率可选 8k/16k/22.05k/24k/32k/44.1k；声道 1（默认）或 2。tokendance 是否原样透传**待实测**。

3. **时长（关键）**：响应体 `extra_info.audio_length` **直接给出毫秒级时长**，不需要客户端解码计算。但**文档未对该字段与本地 ffprobe 实测时长的一致性做任何精度承诺**，必须实测校验（报告第 3 节给出对比脚本：调用后 hex 还原为文件、ffprobe 测真实时长、算误差）。tokendance 是否透传 `extra_info` 也待实测。

4. **中文断句与首尾静音（关键，本报告最大空白项）**：**官方文档完全未说明句首/句尾是否自带静音 padding、时长多少**。一手信息只有显式停顿标记 `<#x#>`（可指定 0.01~99.99 秒停顿）；标点影响自然停顿只在一篇官网新闻稿里被定性提及（无具体数值，不可靠）。**必须实测**：报告第 4 节给出用 `ffmpeg -af silencedetect` 批量测不同长度/标点的中文短句首尾静音时长的方法，并建议若测出固定 padding，则在渲染前统一裁剪。

5. **时间戳**：**支持**，`subtitle_enable` + `subtitle_type`（`sentence`/`word`/`word_streaming`），时间戳单位毫秒，字幕以 JSON 文件下载链接形式返回。

6. **配额**：按字符计费，`speech-2.8-turbo` 为 $60/百万字符；T2A 类模型默认 RPM=60；单次 `text` 字段需 <10,000 字符，超过 3,000 字符官方建议走流式。tokendance 的计费口径/是否加价/独立限流**待实测**。

7. **稳定性**：支持流式（`stream` 参数，SSE，`status` 字段区分合成中/完成）。**同一文本重复调用是否字节级/时长一致，文档完全未提及**，且无 seed/temperature 等确定性控制参数，**必须实测**（报告第 7 节给出 md5 + ffprobe 三次调用对比脚本），这决定能否做本地缓存以及"改一个字是否要重新生成整句"。

8. **音色与参数**：`voice_setting` 下 `speed`[0.5,2]、`vol`(0,10]、`pitch`[-12,12] 整数、`emotion`（happy/sad/angry/fearful/disgusted/surprised/calm/fluent/whisper 共 9 种）取值范围均明确；另支持文本内嵌感叹词标签（如 `(sighs)`，2.8 系列独有）；中文音色示例已列出（如 `Chinese (Mandarin)_News_Anchor`），完整列表需调用 `/v1/get_voice` 实测获取。tokendance 是否透传全部参数与音色 ID 命名空间是否一致**待实测**。

**待实测清单汇总**（拿到 key 后按报告里的脚本逐项跑）：tokendance 的 base URL / 鉴权 header / 接口路径是否与原生一致、`audio_length` 与真实解码时长的误差、句首尾静音时长、重复调用的一致性、tokendance 的计费与限流阈值、tokendance 是否透传 `emotion`/停顿标记/音色全集。

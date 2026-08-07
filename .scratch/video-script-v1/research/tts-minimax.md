# TTS 技术调研报告：MiniMax Speech 2.8 Turbo（经 tokendance 接入）

调研日期：2026-08-06
调研目的：为「单用户本地视频脚本生成工具」V1 的时间模型（每句话在时间轴上的时长）提供准确、可复核的技术依据。

## 0. 结论总览（先看这个）

| # | 问题 | 结论状态 |
|---|------|---------|
| 1 | 鉴权与调用 | MiniMax 原生层**已查证**；tokendance 层**未查证**（网站为纯前端 SPA，无法抓取文档正文），需实测 |
| 2 | 返回格式 | MiniMax 原生层**已查证**（hex/url，多种容器格式可选）；tokendance 转发格式**待实测** |
| 3 | 时长 | MiniMax 原生层**已查证**：响应体自带 `audio_length`（毫秒）字段；但该字段是否等于本地 ffprobe 测出的真实时长、tokendance 是否透传该字段，**待实测** |
| 4 | 中文断句与首尾静音 | 官方文档**未说明**具体静音时长数值，**必须实测** |
| 5 | 时间戳 | MiniMax 原生层**已查证**：支持句级/词级时间戳（`subtitle_enable` + `subtitle_type`） |
| 6 | 配额计费 | MiniMax 原生层**已查证**：按字符计费，$60/百万字符（turbo），T2A 类模型 RPM=60；tokendance 层计费与限流**待实测** |
| 7 | 稳定性（流式/一致性） | 流式支持**已查证**；重复调用是否字节级一致，官方文档**未说明**，**待实测** |
| 8 | 音色与参数 | MiniMax 原生层**已查证**：speed/vol/pitch/emotion 等参数及取值范围明确；tokendance 是否透传全部参数**待实测** |

---

## 1. 鉴权与调用

### 结论
- **MiniMax 原生 API（一手，已查证）**：
  - Endpoint：`POST https://api.minimax.io/v1/t2a_v2`（另有低延迟备用节点 `https://api-uw.minimax.io/v1/t2a_v2`）
  - 鉴权：HTTP Bearer Auth，即 `Authorization: Bearer <API_key>`
  - 请求体核心字段：
    | 字段 | 类型 | 必填 | 说明 |
    |---|---|---|---|
    | `model` | string | 是 | 如 `speech-2.8-turbo` |
    | `text` | string | 是 | <10,000 字符，支持 `<#x#>` 停顿标记、感叹词标签 |
    | `stream` | boolean | 否，默认 false | 是否流式 |
    | `language_boost` | string | 否 | 可设 `"auto"` 自动检测语言 |
    | `output_format` | string | 否，默认 hex | `url` / `hex` |
    | `voice_setting.voice_id` | string | 是 | 音色 ID |
    | `voice_setting.speed/vol/pitch/emotion` | 见第 8 节 | 否 | |
    | `audio_setting.sample_rate/bitrate/format/channel` | 见第 2 节 | 否 | |
  - 响应体核心结构（原文示例，字段名与结构均为一手实录）：
    ```
    data:
      audio: <hex encoded audio>
      status: 2
    extra_info:
      audio_length: 11124
      audio_sample_rate: 32000
      audio_size: 179926
      bitrate: 128000
      word_count: 163
      invisible_character_ratio: 0
      usage_characters: 163
      audio_format: mp3
      audio_channel: 1
    trace_id: 01b8bf9bb7433cc75c18eee6cfa8fe21
    base_resp:
      status_code: 0
      status_msg: success
    ```

- **tokendance 平台层（未查证，待实测）**：
  多次尝试用 WebFetch 抓取 `https://tokendance.space/models/minimax-speech-2.8-turbo`、`https://tokendance.space/`、`https://tokendance.space/docs`、`https://tokendance.space/docs/quickstart`、`https://docs.tokendance.space`，返回内容均只有页面 `<title>TokenDance - 词元跳动</title>`，正文由前端 JS 异步渲染，WebFetch（纯 HTTP GET + HTML 转 Markdown，不执行 JS）抓不到任何实际文档内容。这是**已确认的工具局限**，不是「tokendance 没有文档」。
  通过第三方文章（见「一手来源 vs 二手来源」一节）交叉印证：tokendance 定位是「模型 API 聚合网关」，对外宣传「兼容 OpenAI / Claude / Gemini 原生协议，切换 Base URL 即可接入」，覆盖「文本、图像、视频、文本转语音」。这说明 tokendance 很可能对 TTS 类接口也做了协议包装（例如可能提供 OpenAI 风格的 `/v1/audio/speech` 或是直接透传 MiniMax 原生 `/v1/t2a_v2` 报文体），但**具体是哪种包装方式、鉴权 header 名称是否被替换、请求体字段是否被重命名，二手文章均未提及，必须实测确认**。

### 待实测验证脚本
拿到 tokendance 的 API key 后，请先做两组对照测试：一是按 MiniMax 原生协议直接打给 tokendance 的 base URL，二是尝试 OpenAI 风格的 `/v1/audio/speech`，哪个能跑通就说明 tokendance 采用了哪种转发方式。

```bash
# 测试一：假设 tokendance 透传 MiniMax 原生协议（把 base URL 换成 tokendance 提供的域名）
export TOKENDANCE_API_KEY="替换成你的key"
export TOKENDANCE_BASE_URL="https://tokendance.space"   # 请以控制台/文档实际给出的 base url 为准

curl -sS -X POST "${TOKENDANCE_BASE_URL}/v1/t2a_v2" \
  -H "Authorization: Bearer ${TOKENDANCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
        "model": "speech-2.8-turbo",
        "text": "这是一次测试，用于验证接口返回结构。",
        "stream": false,
        "output_format": "hex",
        "voice_setting": {"voice_id": "Chinese (Mandarin)_News_Anchor", "speed": 1.0, "vol": 1.0, "pitch": 0},
        "audio_setting": {"sample_rate": 32000, "format": "mp3", "channel": 1}
      }' | tee /tmp/tokendance_resp_native.json | jq '.extra_info, .base_resp'

# 测试二：假设 tokendance 走 OpenAI 兼容协议
curl -sS -X POST "${TOKENDANCE_BASE_URL}/v1/audio/speech" \
  -H "Authorization: Bearer ${TOKENDANCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
        "model": "minimax-speech-2.8-turbo",
        "input": "这是一次测试，用于验证接口返回结构。",
        "voice": "Chinese (Mandarin)_News_Anchor"
      }' -o /tmp/tokendance_resp_openai.mp3 -D -
```
记录：实际能跑通的是哪一个、响应 header（Content-Type 是 audio/mpeg 还是 application/json）、响应体字段名是否与 MiniMax 原生文档一致。

---

## 2. 返回什么（容器格式/编码/采样率/声道）

### 结论（MiniMax 原生层，一手，已查证）
- 音频数据编码方式由请求里的 `output_format` 决定：`hex`（十六进制字符串，默认）或 `url`（有效期 24 小时的下载链接）。**不支持 base64**（文档字段只列出 hex / url 两种）。
- 容器/编码格式由 `audio_setting.format` 决定，可选：`mp3` / `pcm` / `flac` / `wav` / `pcmu_raw` / `pcmu_wav` / `opus`，默认 `mp3`。
- 采样率 `audio_setting.sample_rate` 可选：`8000 / 16000 / 22050 / 24000 / 32000 / 44100`，文档未标注默认值来自哪个字段（示例响应中出现的是 32000）。
- 声道 `audio_setting.channel` 可选 `1`（单声道）/ `2`（立体声），默认 1。
- 码率 `audio_setting.bitrate` 仅对 MP3 生效，可选 `32000 / 64000 / 128000 / 256000`。
- 响应 `extra_info` 里会回传 `audio_sample_rate`、`audio_format`、`audio_channel`、`audio_size`（字节），可用来做校验。

来源：`https://platform.minimax.io/docs/api-reference/speech-t2a-http`

### tokendance 层（待实测）
tokendance 是否原样透传 hex/url，还是统一转成二进制流/公网 URL，未查到文档说明。

### 验证脚本
```bash
# 拿到 hex 响应后本地还原成文件并用 ffprobe 校验真实参数
python3 - <<'PY'
import json, binascii
resp = json.load(open("/tmp/tokendance_resp_native.json"))
audio_hex = resp["data"]["audio"]
with open("/tmp/sample.mp3", "wb") as f:
    f.write(binascii.unhexlify(audio_hex))
PY
ffprobe -v error -show_entries stream=sample_rate,channels,codec_name -show_entries format=duration -of json /tmp/sample.mp3
```

---

## 3. 时长（关键问题）

### 结论
- **MiniMax 原生层（一手，已查证）**：响应体 `extra_info.audio_length` 字段直接给出音频时长，单位为**毫秒**（原文："Audio duration in milliseconds."）。这是 API 主动返回的时长，不需要客户端解码音频再计算。
- **是否精确、是否与本地 ffprobe 测出的真实时长完全一致**：文档未做任何精度承诺（没有"精确到毫秒"或"可能有 X ms 误差"这类说明），**必须实测**：拿真实调用结果与 ffprobe 测出的时长做逐条比对，确认二者是否一致、误差范围多大，这直接决定后续架构是"信任 API 返回值直接用于时间轴"还是"每条都要本地解码校验"。
- **tokendance 是否透传 `extra_info` 整个对象**：未查到文档说明，**待实测**。

来源：`https://platform.minimax.io/docs/api-reference/speech-t2a-http`（`extra_info` 字段说明与响应示例）

### 验证脚本
```bash
# 1. 调用接口拿到 API 返回的 audio_length（毫秒）
api_len_ms=$(jq -r '.extra_info.audio_length' /tmp/tokendance_resp_native.json)
echo "API 返回时长(ms): $api_len_ms"

# 2. 用 ffprobe 测本地解码出的真实时长
real_sec=$(ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/sample.mp3)
real_ms=$(python3 -c "print(round(${real_sec} * 1000))")
echo "ffprobe 真实时长(ms): $real_ms"

# 3. 差值
python3 -c "print('误差(ms):', ${real_ms} - ${api_len_ms})"
```
建议对 10~40 字的中文短句构造至少 10~20 条样本（不同长度、不同标点密度）重复此流程，统计误差分布，再决定时间模型是否可以直接信任 API 返回值。

---

## 4. 中文断句与韵律（关键问题：首尾静音 padding）

### 结论
**文档未说明，必须实测。** MiniMax 官方 T2A 文档中，与断句/停顿相关的一手内容只有两处：
1. 显式停顿标记：可以在文本中插入 `<#x#>` 来强制指定停顿时长，取值范围 `[0.01, 99.99]` 秒，最多两位小数，**原文**："You can customize speech pauses by adding markers in the form `<#x#>`, where `x` is the pause duration in seconds. ... Pause markers must be placed between speakable text segments and cannot be used consecutively."
2. 二手资料（MiniMax 官网新闻稿类页面，非 API 参考文档）提到模型会"根据标点做不同时长的自然停顿、疑问句语调上扬、句末语气变软，类似人类自然朗读习惯"，但**没有给出任何具体毫秒数**，且这是产品宣传性质的页面而非 API 规格文档，不能当作可靠依据。

**没有任何一手文档提到"句首/句尾是否自带静音 padding"以及 padding 的时长数值。** 这是本次调研中最关键的空白项，直接影响"20 句音频拼接后是否拖沓"的判断，必须实测。

来源：
- 一手（停顿标记语法）：`https://platform.minimax.io/docs/api-reference/speech-t2a-http`
- 二手/宣传性质（标点停顿的定性描述，不含数值）：`https://www.minimaxi.com/news/minimax-speech-26`

### 验证脚本（用 ffmpeg silencedetect 分析首尾静音）
构造覆盖不同长度（10/20/30/40 字）、不同末尾标点（句号/问号/感叹号/逗号/无标点）的至少 8~10 条样本，分别调用接口生成音频后跑：

```bash
# 阈值可按需调整，-50dB 是常见的"近似静音"判定线
ffmpeg -i /tmp/sample.mp3 -af silencedetect=noise=-50dB:d=0.05 -f null - 2> /tmp/silence.log

grep -E "silence_start|silence_end|silence_duration" /tmp/silence.log

# 更精确地只看开头和结尾：先获取总时长，再看第一个 silence_end 和最后一个 silence_start
duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/sample.mp3)
echo "总时长: ${duration}s"
```
批量跑完后，重点统计：
- 每条音频的 `silence_start=0.000000` 附近是否有一段 `silence_end`（即开头静音时长）
- 最后一段 `silence_start` 到 `duration` 之间的间隔（即结尾静音时长）
- 不同末尾标点（。？！，）对结尾静音时长是否有系统性差异

若测出首尾 padding 是几百毫秒级的固定值，建议在后续架构里对每条音频做统一的"掐头去尾"裁剪（用 `ffmpeg -af silenceremove` 或按测得的固定偏移量直接切片），而不是直接按 API 返回的整段时长做时间轴分配。

---

## 5. 时间戳

### 结论（MiniMax 原生层，一手，已查证）
**支持字级/词级时间戳**。请求中可设置 `subtitle_enable` 开启字幕，`subtitle_type` 可选：
- `sentence`（句级）
- `word`（词级）
- `word_streaming`（流式场景下的词级时间戳）

响应会给出字幕文件下载链接，**原文**："Download link for generated subtitles. Subtitles are aligned to sentences (≤ 50 characters), timestamped in milliseconds, returned in JSON format."

本次调研只需确认"有没有这个能力"，结论是：有，且支持到词级，时间戳单位是毫秒。tokendance 是否透传该功能待实测（不是本次架构决策的关键路径，可后置验证）。

来源：`https://platform.minimax.io/docs/api-reference/speech-t2a-http`

---

## 6. 配额（计费/限流/文本长度上限）

### 结论（MiniMax 原生层，一手，已查证）
- **计费单位**：按字符计费。`speech-2.8-turbo`：**$60 / 百万字符**；`speech-2.8-hd`：$100 / 百万字符。响应体里的 `extra_info.usage_characters` 就是本次调用的计费字符数。
  来源：`https://platform.minimax.io/docs/guides/pricing-paygo`（原文表格行："T2A | speech-2.8-turbo | $60/M characters"）
- **中英文字符计费是否有差异**：文档未说明。
- **速率限制**：T2A 类模型（含 speech-2.8-turbo/hd、speech-2.6-turbo/hd、speech-02-turbo/hd）默认 **RPM = 60**（即每分钟最多 60 次请求）。文档未给出 T2A 专属的 TPM 或并发连接数限制；错误码里出现过 `1002: rate limit exceeded`、`1039: TPM rate limit exceeded`，说明限流机制确实存在，但具体阈值以 `rate-limits` 页面表格为准。如需更高配额需联系 MiniMax 商务（`api@minimax.io`）。
  来源：`https://platform.minimax.io/docs/guides/rate-limits`
- **单次请求文本长度上限**：`text` 字段**必须少于 10,000 字符**；超过 3,000 字符官方建议使用流式输出。
  来源：`https://platform.minimax.io/docs/api-reference/speech-t2a-http`

### tokendance 层（未查证，待实测）
tokendance 的计费方式（是否与 MiniMax 官方 1:1 同价、是否加价、是否有自己独立的 RPM/并发限制）完全没有查到文档，第三方文章只提到它是"统一账单、余额扣费、新用户注册送 10 元额度、百亿 Token 补贴计划"这类营销性描述，不构成可靠的计费规格依据。**必须实测**：连续发起多次请求观察是否触发限流、对照官方定价核算 tokendance 实际扣费金额。

### 验证脚本
```bash
# 简单的限流探测：短时间内连续发 10 次请求，观察是否有 429 / rate limit 错误
for i in $(seq 1 10); do
  curl -sS -o /dev/null -w "第 $i 次: HTTP %{http_code}, 耗时 %{time_total}s\n" \
    -X POST "${TOKENDANCE_BASE_URL}/v1/t2a_v2" \
    -H "Authorization: Bearer ${TOKENDANCE_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"model":"speech-2.8-turbo","text":"限流测试第'"$i"'条。","voice_setting":{"voice_id":"Chinese (Mandarin)_News_Anchor"}}'
done
```

---

## 7. 稳定性（流式/一致性）

### 结论
- **流式支持（一手，已查证）**：`stream` 参数控制是否流式输出。非流式返回单个 JSON 对象；流式返回 `text/event-stream`，多个对象序列，每个对象带 `status`（1=合成中，2=完成）。官方建议文本超过 3,000 字符时用流式。
  来源：`https://platform.minimax.io/docs/api-reference/speech-t2a-http`
- **重复调用同一文本，返回音频是否逐字节/逐时长一致**：**官方文档完全没有提及**（没有 `temperature`、`seed` 等控制随机性的参数说明，也没有"确定性"相关的文字）。这意味着：
  - 无法从文档推断出"是否可以缓存 + 改一个字要不要重新生成整句"这个问题的答案，**必须实测**。
  - 由于请求参数里没有 seed/temperature 字段，如果实测发现结果不一致，也没有官方参数可以强制其确定性输出。

### 验证脚本
```bash
# 同一文本连续调用 3 次，比较音频文件的哈希值和 ffprobe 时长是否完全一致
for i in 1 2 3; do
  curl -sS -X POST "${TOKENDANCE_BASE_URL}/v1/t2a_v2" \
    -H "Authorization: Bearer ${TOKENDANCE_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"model":"speech-2.8-turbo","text":"这是用于一致性测试的固定句子。","voice_setting":{"voice_id":"Chinese (Mandarin)_News_Anchor"},"audio_setting":{"format":"mp3"}}' \
    | jq -r '.data.audio' > /tmp/hex_$i.txt
  python3 -c "import binascii; open('/tmp/run_${i}.mp3','wb').write(binascii.unhexlify(open('/tmp/hex_${i}.txt').read().strip()))"
  echo "run $i: md5=$(md5sum /tmp/run_${i}.mp3 | cut -d' ' -f1) duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/run_${i}.mp3)"
done
```
如果三次 md5 相同 → 完全确定性，可以做本地缓存并跳过未改动句子的重新生成；如果 md5 不同但时长一致 → 可能只是容器/元数据层面的微小差异，需要再看波形是否一致；如果时长本身就有波动 → 时间轴模型必须支持"文本不变但时长可能变"的重新校验机制，不能假设"改一个字只影响这一句"。

---

## 8. 可选音色与参数

### 结论（MiniMax 原生层，一手，已查证）

**可调参数（`voice_setting`）：**
| 参数 | 类型 | 取值范围 | 默认值 |
|---|---|---|---|
| `speed` | float | `[0.5, 2]` | 1.0 |
| `vol` | float | `(0, 10]` | 1.0 |
| `pitch` | integer | `[-12, 12]` | 0 |
| `emotion` | string | `happy / sad / angry / fearful / disgusted / surprised / calm / fluent / whisper` | 无 |

此外文本内还支持：
- 停顿标记 `<#x#>`（见第 4 节）
- 感叹词标签（仅 `speech-2.8-hd` / `speech-2.8-turbo` 支持），如 `(laughs)`、`(sighs)`、`(breath)` 等
- `language_boost` 可设为 `"auto"` 自动识别语言，粤语需设为 `"Chinese,Yue"`

**中文音色示例（一手，从官方"获取音色"接口文档摘取，非完整列表）：**
- `Chinese (Mandarin)_Reliable_Executive`（可靠男性高管音）
- `Chinese (Mandarin)_News_Anchor`（专业女性新闻主播音）
- `Chinese (Mandarin)_Lyrical_Voice`
- `Chinese (Mandarin)_HK_Flight_Attendant`
- 粤语：`Cantonese_GentleLady`、`Cantonese_podacast_host_1`（需配合 `language_boost="Chinese,Yue"`）

完整音色列表需要调用 `POST https://api.minimax.io/v1/get_voice` 接口以 API Key 实测获取（该接口本身不支持按语言筛选，需要自己在返回结果里挑中文音色），或查阅文档中的"System Voice ID List"页面（`/faq/system-voice-id`，本次未能完整抓取该页正文，只抓到接口 schema 页面里引用的示例）。

来源：
- `https://platform.minimax.io/docs/api-reference/speech-t2a-http`
- `https://platform.minimax.io/docs/api-reference/voice-management-get`

### tokendance 层（待实测）
tokendance 是否暴露全部参数（尤其是 `emotion`、感叹词标签这类 2.8 系列特有功能）、音色 ID 是否与 MiniMax 原生一致，未查到文档，需实测。

### 验证脚本
```bash
# 拉取音色全量列表（原生协议；如 tokendance 转发方式不同需调整 path）
curl -sS -X POST "${TOKENDANCE_BASE_URL}/v1/get_voice" \
  -H "Authorization: Bearer ${TOKENDANCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"voice_type": "system"}' | jq '.system_voice[] | select(.voice_id | test("Chinese"))'
```

---

## 一手来源 vs 二手来源区分

### 实际访问并读取到正文内容的一手/官方文档（可信来源）
- MiniMax T2A HTTP API 参考（英文站，主要依据）：`https://platform.minimax.io/docs/api-reference/speech-t2a-http`
- MiniMax 获取音色接口文档：`https://platform.minimax.io/docs/api-reference/voice-management-get`
- MiniMax 按量计费价格页：`https://platform.minimax.io/docs/guides/pricing-paygo`
- MiniMax 速率限制页：`https://platform.minimax.io/docs/guides/rate-limits`

以上四个页面是本报告中**除 tokendance 部分之外全部结论性数字**（endpoint、字段名、取值范围、`audio_length` 单位、价格、RPM）的直接依据，均为原文摘录或紧贴原文的转述，未做推测。

### 尝试访问但未获取到正文（工具局限，非"文档不存在"）
- `https://tokendance.space/models/minimax-speech-2.8-turbo`
- `https://tokendance.space/`
- `https://tokendance.space/docs`
- `https://tokendance.space/docs/quickstart`
- `https://docs.tokendance.space`

以上五个 URL 均只返回了 `<title>TokenDance - 词元跳动</title>`，正文由前端 JS 异步加载，WebFetch 工具无法执行 JS，抓不到实际内容。**报告中所有关于 tokendance 平台自身约定的结论，没有一条来自 tokendance 一手文档**，全部标注为"待实测"。

### 仅供背景参考的二手来源（不作为规格依据，未采信任何具体数字）
- `https://www.aig123.com/sites/8331.html`（AI 工具导航站对 tokendance 的介绍，用于确认其定位为"OpenAI/Claude/Gemini 协议兼容的模型聚合网关"，并给出了 `https://tokendance.space/docs/quickstart` 这个文档路径线索）
- `https://s.unifuncs.com/?sid=79cf1cc7-e83d-4bea-bc4b-f29687d29fbf`（关于 tokendance 定位的第三方分析文章）
- `https://www.minimaxi.com/news/minimax-speech-26`（MiniMax 官网新闻稿，提到"标点影响停顿、疑问句语调"等定性描述，**不含任何具体数值**，仅作为第 4 节的背景补充，不作为结论依据）
- 若干知乎/CSDN 关于"API 中转站"的行业综述文章，仅用于确认 tokendance 的市场定位，未采信其中任何技术参数

### 推测说明
本报告**没有对任何规格数字做推测**。所有在文档中查不到的问题（tokendance 鉴权方式、tokendance 计费/限流、首尾静音时长、重复调用一致性、中英文计费差异、TTFA 具体数值等），均直接标注为"文档未说明，待实测"，并附验证脚本，不做行业惯例式的猜测填空。

---

## tokendance 平台约定 vs MiniMax 原生约定对照表

**未找到 tokendance 侧的一手文档细节**（原因见上一节），下表左列为 MiniMax 原生 API 的已查证行为，右列为 tokendance 层的现状说明——目前全部是"未知，需实测"，请勿假设它与原生完全一致。

| 维度 | MiniMax 原生约定（一手，已查证） | tokendance 平台约定 |
|---|---|---|
| Base URL | `https://api.minimax.io` | 未找到文档；需在 tokendance 控制台查看实际分配的 base url，**待实测** |
| 鉴权 header | `Authorization: Bearer <API_key>` | 未找到文档说明是否沿用同一 header 名称，**待实测** |
| 接口路径 | `/v1/t2a_v2` | 未找到文档说明是透传原生路径，还是包装成 OpenAI 风格的 `/v1/audio/speech`，**待实测**（本报告第 1 节提供了两种假设的对照 curl 脚本） |
| 请求体字段名 | `model` / `text` / `voice_setting` / `audio_setting` 等（见第 1 节表格） | 未找到文档说明字段是否被 tokendance 重命名或做了字段映射，**待实测** |
| 音频返回形式 | `output_format` 控制返回 `hex` 或 `url`（24 小时有效） | 未找到文档说明 tokendance 是否统一转换为二进制流或永久 URL，**待实测** |
| 时长字段 | `extra_info.audio_length`（毫秒） | 未找到文档说明该字段是否被透传，或是否被 tokendance 重新计算/改名，**待实测** |
| 计费单位 | 按字符，speech-2.8-turbo 为 $60/百万字符 | 未找到文档说明 tokendance 是否 1:1 同价、是否加价、计费口径是否也按 `usage_characters`，**待实测** |
| 限流 | T2A 类模型默认 RPM=60 | 未找到文档说明 tokendance 是否有自己独立于 MiniMax 的限流层，**待实测**（第 6 节提供了限流探测脚本） |
| 音色 ID | 如 `Chinese (Mandarin)_News_Anchor` | 未找到文档说明 tokendance 是否使用相同的音色 ID 命名空间，**待实测** |
| 情感/语速/停顿等参数 | `voice_setting.emotion`、`<#x#>` 停顿标记等（见第 4、8 节） | 未找到文档说明是否被完整透传，**待实测** |

**结论：在没有 tokendance 一手文档的情况下，唯一可靠的确认方式是直接用 API key 跑本报告第 1、3、4、6、7 节提供的验证脚本，逐项核对 tokendance 的实际响应与 MiniMax 原生文档描述是否一致。** 建议把这些脚本保存为可重复执行的测试用例，一旦 tokendance 更新其转发逻辑，可以随时重新跑一遍确认架构假设仍然成立。

# 08 — TTS 实测：把 01 号票的待验证项跑完

Type: task (AFK，前置需用户提供 key)
Status: open
Blocked by: —

## Question

01 号票把 MiniMax 原生协议查清楚了，但有两件**时间模型直接依赖的事实**文档里没有答案，只能实测。这张票就是拿 key 把它们跑出来。

**前置**：用户把 API key 放到项目根 `.env`（不要贴进对话）。实测需要访问外网 API，Bash 沙箱默认只放行 github，跑脚本时要显式放开。

按 `research/tts-minimax.md` 里已备好的脚本逐项跑：

1. **句首尾静音 padding（最关键）**：用 `ffmpeg -af silencedetect` 测一批不同长度、不同结尾标点（。？！、无标点）的中文短句，看首尾各有多少静音、是否稳定。
   这一条决定 Duration 到底等不等于音频时长——如果每句头尾各带 0.2s 静音，20 句拼起来就凭空多出 8 秒的停顿，整条片子会明显拖沓，那就必须在渲染前统一裁剪。
2. **`audio_length` 的可信度**：把返回的音频落盘，用 ffprobe 测真实时长，和 `extra_info.audio_length` 比对误差。误差若超过一帧（30fps 下 33ms），时间模型就不能直接采信这个字段。
3. **重复调用的一致性**：同一段文本连调三次，比 md5 和时长。一致才谈得上本地缓存，也才能回答「改一个字要不要重新生成整句」。
4. **tokendance 平台层协议**：base URL、鉴权 header 名、路径是原生透传还是 OpenAI 兼容包装、`extra_info` 是否被透传。报告第 1 节给了两组对照 curl，跑一下就知道。
5. **顺带确认**：中文音色全集（调 `/v1/get_voice`）、`emotion`/`speed`/停顿标记 `<#x#>` 是否可用、tokendance 的计费与限流口径。

## 一个要顺带定的决策

既然 MiniMax 官方 API 文档完整、协议清晰，**为什么要经 tokendance 这一层？** 如果只是付款或网络可达性的便利，那没问题；但如果 tokendance 会包装协议、吞掉 `extra_info`、或者另有限流，代价就要摆出来对比。

实测完给个明确结论：**走 tokendance 还是直连 MiniMax 官方**。这会写进地图的已定约束。

## 产出

结果写到 `.scratch/video-script-v1/research/tts-live-results.md`，结论回填本票 `## Answer`。
第 1 条要给出具体数值（静音时长的均值与波动范围），不要只说"有"或"没有"。

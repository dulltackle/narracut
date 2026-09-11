# 历史归档

本目录保存被替代的规格、决策和运行指南，以及研究与会话快照。当前实现入口见[文档索引](../README.md)。归档保留原始结论和证据边界，不把旧限制或待办重新引入当前产品。

| 材料 | 内容与替代来源 |
| --- | --- |
| [Legacy 规格](legacy/spec/) | V1–V3、Text Preset 及配套 schema、示例和校验脚本；当前使用 [VNext](../spec/project-vnext.md) |
| [Legacy ADR](legacy/adr/) | 0001、0002、0003、0005、0006、0007；替代关系见 [ADR-0008](../adr/0008-project-vnext-normative-architecture.md)；局部有效的 ADR-0004 仍留在现行目录 |
| [WireGuard 指南](legacy/wireguard-remote-workbench.md) | 旧浏览器服务拓扑；当前使用 Codex 插件 |
| [2026-09-10 补充收口](qa/project-vnext-acceptance-closure-20260910.md) | 当前对话改造前的历史测试映射；现行结果见[当前对话验收](../current-conversation-acceptance.md) |
| [Issue #23 设计 QA](qa/issue-23-design-qa.md) | 旧浅色 SPA 的验收记录，临时截图不保证仍可访问 |
| [胶囊交接](handoffs/narracut-capsule-handoff-2026-09-07.md) | 2026-09-07 会话记录；修复已提交，剩余事项见[维护清单](../capsule-maintenance.md) |
| [调研快照](research/) | TTS、Remotion 与执行隔离的版本化研究依据；当前实现以规范和现行模块说明为准 |

旧 schema、示例及脚本按原始字节归档，未接入生产模块和默认验收。它们保留原目录布局下的源码引用，其中 `src/shared/text-presets.ts` 已在 `2adde67` 删除，因此不提供当前可运行的历史验收入口；如需复现实验，应检出 Legacy 清理前的完整版本。

# 在隔离执行胶囊中以同一 Bundle 完成 Preview 与 Render

> **状态：已接受。** 这是 [ADR-0008](./0008-project-vnext-normative-architecture.md) 的执行/Preview/Render 边界 ADR。

## Decision

Render Program 与第三方依赖一律视为不可信代码。依赖下载、安装脚本、构建、Metadata、Preview 和 Render 分阶段进入经过能力自检的 OS 级执行胶囊；只有依赖下载阶段能访问固定公共 npm registry，其余阶段无外网且只挂载最小不可变输入和单一输出。

Runtime 把最小 Player 壳注入同一不可变 Bundle。Codex 工作台通过跨 origin、版本化 Preview Bridge 控制 Preview。候选 Preview 与最终 Render 必须绑定同一 Bundle、同一 Runtime 输入、同一 Media Revision 和同一执行环境指纹。

诊断、分操作门禁和验收证据保持分层；确定性、安全、身份与时间硬阻断不可覆盖，主观视觉问题只形成非阻断警告。

## Considered Options

- **宿主直接执行“受信项目”**——被否。信任开关会在最需要安全边界时悄悄降低隔离。
- **独立进程或 Node Permission Model 作为主边界**——被否。同 UID 与宿主资源仍可泄漏，不能满足不可信依赖隔离。
- **Player 直接导入源码、Renderer 另行构建**——被否。两条产物路径无法建立 Bundle 身份级 Preview = Render。
- **允许运行时联网或私有依赖凭据**——被否。移动、断网重建与确定性都无法保证。
- **分阶段胶囊 + 同一 Bundle + Bridge**——采用。

## Consequences

- 本 ADR 替代 ADR-0001 的项目根静态服务寻址、ADR-0002 的独立浏览器壳、ADR-0007 的固定 WireGuard 信任拓扑，以及 ADR-0006 的固定 Composition/表现执行方式。
- Preview Bridge 是唯一宿主控制接口；Remotion Studio、Player Ref、iframe DOM 与 Bundle 全局变量不是产品 API。
- 执行胶囊不可用时失败关闭；取消、超时或超限销毁全部子孙进程并丢弃未验证输出。
- 安装树、Bundle、Preview 和浏览器均为缓存；项目只携带精确声明、锁文件与按完整性摘要寻址的离线依赖库。
- 最终 Render 新发现的内容失败阻断再次 Render，但不回滚已接受修订。

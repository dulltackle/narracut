# 信任 WireGuard 对端并在其地址提供服务

Narracut 的 HTTP 服务包含项目写入、导入、TTS 与渲染等操作，却因浏览器和 renderer 的媒体请求约束而不加 token 鉴权。为了让工作台可通过专用 WireGuard 网络直接访问，服务默认精确绑定 `10.8.0.5`，并把能够访问该接口的 WireGuard 对端视为受信任主体；不监听 `0.0.0.0` 或 `::`，避免把信任边界扩大到所有网络接口。

## Consequences

- 本决策替代 [ADR-0001](./0001-asset-addressing-via-local-static-server.md) 中“仅绑定 `127.0.0.1`”的安全缓解措施，以及 [ADR-0002](./0002-no-electron.md) 中“浏览器打开 localhost”的地址描述；素材寻址和不使用 Electron 的其余决策不变。
- 服务首选端口仍为 `3579`，占用时依次尝试到 `3678`；CLI、API URL 与 renderer 媒体 URL 必须使用同一个实际地址和端口。
- 本机不额外保留回环监听。没有 `10.8.0.5` 的环境会明确启动失败，可通过 `NARRACUT_HOST` 改用另一个具体 IP 或可解析主机名；通配监听地址被拒绝。
- 自动化测试显式绑定 `127.0.0.1` 和动态端口，不依赖执行机器的 WireGuard 配置。

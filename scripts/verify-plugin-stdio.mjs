let input = "";
for await (const chunk of process.stdin) input += chunk;
const responses = input.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const initialized = responses.find((response) => response.id === 1)?.result;
const health = responses.find((response) => response.id === 2)?.result;
const inspection = responses.find((response) => response.id === 3)?.result;
const resource = responses.find((response) => response.id === 4)?.result?.contents?.[0];
if (
  initialized?.protocolVersion !== "2025-06-18" ||
  initialized?.serverInfo?.name !== "narracut" ||
  health?.structuredContent?.status !== "connected" ||
  health?.structuredContent?.readOnly !== true ||
  inspection?.structuredContent?.status !== "valid" ||
  inspection?.structuredContent?.project?.sceneCount !== 1 ||
  resource?.mimeType !== "text/html;profile=mcp-app" ||
  !resource?.text?.includes("data:image/webp;base64,") ||
  !resource?.text?.includes("data:font/woff2;base64,") ||
  Buffer.byteLength(resource.text, "utf8") >= 1_000_000
) {
  process.stderr.write(`Narracut MCP stdio 检查失败：${JSON.stringify(responses)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Narracut MCP stdio 连接、项目检查与 UI 资源读取通过。\n");
}

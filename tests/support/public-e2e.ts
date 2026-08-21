import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const TOKEN_DANCE_T2A_URL = "https://tokendance.space/gateway/minimax/v1/t2a_v2";

type PublicE2EPreflightOptions = {
  environment?: NodeJS.ProcessEnv;
  envFile: string;
  probe?: typeof fetch;
};

async function readEnvFileKey(envFile: string): Promise<string | undefined> {
  try {
    return parseEnv(await readFile(envFile, "utf8")).TOKENDANCE_API_KEY;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function preflightPublicE2E({
  environment = process.env,
  envFile,
  probe = fetch,
}: PublicE2EPreflightOptions): Promise<{ apiKey: string }> {
  const apiKey = environment.TOKENDANCE_API_KEY ?? await readEnvFileKey(envFile);
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error(
      "公开浏览器 E2E 缺少 TOKENDANCE_API_KEY；未启动测试，也不会切换到替代 TTS。",
    );
  }

  try {
    await probe(TOKEN_DANCE_T2A_URL, {
      method: "OPTIONS",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("TokenDance 网络前置检查失败，未启动浏览器旅程。");
  }

  return { apiKey };
}

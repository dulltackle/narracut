import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_SERVER_HOST,
  startNarracutServer,
  type RunningServer,
} from "./server";

type CliOptions = {
  args: string[];
  staticDirectory?: string;
  initialPort?: number;
  log?: (message: string) => void;
  envFile?: string;
  environment?: { NARRACUT_HOST?: string };
  startServer?: typeof startNarracutServer;
};

const DEFAULT_STATIC_DIRECTORY = fileURLToPath(
  new URL("../../dist/client", import.meta.url),
);
const DEFAULT_ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));

function loadOptionalEnvFile(envFile: string): void {
  try {
    loadEnvFile(envFile);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

export async function runCli({
  args,
  staticDirectory = DEFAULT_STATIC_DIRECTORY,
  initialPort = 3579,
  log = console.log,
  envFile = DEFAULT_ENV_FILE,
  environment = process.env,
  startServer = startNarracutServer,
}: CliOptions): Promise<RunningServer> {
  const [projectPath, ...unexpectedArguments] = args;
  if (projectPath === undefined || unexpectedArguments.length > 0) {
    throw new Error("用法：pnpm start <项目路径>");
  }

  loadOptionalEnvFile(envFile);
  const projectDirectory = resolve(projectPath);
  const host = environment.NARRACUT_HOST ?? DEFAULT_SERVER_HOST;
  let server: RunningServer;
  try {
    server = await startServer({
      projectDirectory,
      staticDirectory,
      host,
      initialPort,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EADDRNOTAVAIL") {
      throw new Error(
        `无法监听 ${host}：该地址在当前机器上不可用（EADDRNOTAVAIL：${error.message}）。` +
          "请启动对应网络接口，或设置 NARRACUT_HOST=127.0.0.1 覆盖。",
        { cause: error },
      );
    }
    throw error;
  }

  log(`Narracut 已打开 ${projectDirectory}`);
  log(`本地工作台：${server.url}`);
  return server;
}

async function main(): Promise<void> {
  const server = await runCli({ args: process.argv.slice(2) });
  const shutdown = () => {
    void server
      .close()
      .catch(() => {
        process.exitCode = 1;
      })
      .finally(() => process.exit(process.exitCode));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

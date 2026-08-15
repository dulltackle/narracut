import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import open from "open";

import { startNarracutServer, type RunningServer } from "./server";

type CliOptions = {
  args: string[];
  staticDirectory?: string;
  initialPort?: number;
  openUrl?: (url: string) => Promise<unknown>;
  log?: (message: string) => void;
};

const DEFAULT_STATIC_DIRECTORY = fileURLToPath(
  new URL("../../dist/client", import.meta.url),
);

export async function runCli({
  args,
  staticDirectory = DEFAULT_STATIC_DIRECTORY,
  initialPort = 3579,
  openUrl = (url) => open(url, { wait: false }),
  log = console.log,
}: CliOptions): Promise<RunningServer> {
  const [projectPath, ...unexpectedArguments] = args;
  if (projectPath === undefined || unexpectedArguments.length > 0) {
    throw new Error("用法：pnpm start <项目路径>");
  }

  const projectDirectory = resolve(projectPath);
  const server = await startNarracutServer({
    projectDirectory,
    staticDirectory,
    initialPort,
  });

  try {
    await openUrl(server.url);
  } catch (error) {
    await server.close();
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

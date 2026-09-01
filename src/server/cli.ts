import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_SERVER_HOST,
  startNarracutServer,
  type RunningServer,
} from "./server";
import {
  inspectProjectVNext,
  ProjectInspectionError,
  type ProjectVNextInspection,
} from "./project-vnext-inspection";

type CliOptions = {
  args: string[];
  staticDirectory?: string;
  initialPort?: number;
  log?: (message: string) => void;
  envFile?: string;
  environment?: { NARRACUT_HOST?: string };
  startServer?: typeof startNarracutServer;
};

type InspectCliOptions = {
  args: string[];
  log?: (message: string) => void;
  command?: "inspect" | "dry-run";
};

class CliArgumentError extends Error {
  readonly code = "CLI_ARGUMENT_INVALID";

  constructor(readonly path: string, message: string) {
    super(message);
    this.name = "CliArgumentError";
  }
}

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

export async function runInspectCli({
  args,
  log = console.log,
  command = "inspect",
}: InspectCliOptions): Promise<ProjectVNextInspection> {
  const [projectPath, ...unexpectedArguments] = args;
  if (projectPath === undefined || unexpectedArguments.length > 0) {
    throw new CliArgumentError(
      resolve(projectPath ?? "."),
      `参数无效。用法：pnpm ${command} <Project VNext 路径>`,
    );
  }
  const inspection = await inspectProjectVNext(projectPath);
  for (const warning of inspection.warnings) {
    log(JSON.stringify({
      code: warning.code,
      path: join(inspection.projectDirectory, warning.component),
      ...(warning.jsonPath === undefined ? {} : { jsonPath: warning.jsonPath }),
      message: warning.message,
    }));
  }
  log(JSON.stringify({ code: "PROJECT_VALID", path: inspection.projectDirectory }));
  return inspection;
}

export async function runDryRunCli(options: InspectCliOptions): Promise<ProjectVNextInspection> {
  return runInspectCli({ ...options, command: "dry-run" });
}

export function formatCliError(error: unknown): string {
  if (error instanceof CliArgumentError) {
    return JSON.stringify({ code: error.code, path: error.path, message: error.message });
  }
  if (!(error instanceof ProjectInspectionError)) {
    return error instanceof Error ? error.message : String(error);
  }
  const lines = [JSON.stringify({ code: error.code, path: error.path, message: error.message })];
  for (const diagnostic of error.diagnostics) {
    lines.push(JSON.stringify({
      code: diagnostic.code,
      path: error.path,
      ...(diagnostic.jsonPath === undefined ? {} : { jsonPath: diagnostic.jsonPath }),
      message: diagnostic.message,
      ...(diagnostic.metric === undefined ? {} : { metric: diagnostic.metric }),
      ...(diagnostic.actual === undefined ? {} : { actual: diagnostic.actual }),
      ...(diagnostic.limit === undefined ? {} : { limit: diagnostic.limit }),
    }));
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "inspect") {
    await runInspectCli({ args: args.slice(1) });
    return;
  }
  if (args[0] === "dry-run") {
    await runDryRunCli({ args: args.slice(1) });
    return;
  }
  const server = await runCli({ args });
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
    console.error(formatCliError(error));
    process.exitCode = 1;
  });
}

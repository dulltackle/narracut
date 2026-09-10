import { inspectRecovery, planRecovery, recoverProject, extractRecovery } from './project-restore';
import { readBoundedControlFile, decodeUtf8 } from './project-vnext-inspection';
import { copyProjectVNext } from './project-copy';
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  inspectProjectVNext,
  ProjectInspectionError,
  type ProjectVNextInspection,
} from "./project-vnext-inspection";
import {
  createProjectVNext,
  openProjectVNext,
  ProjectLifecycleError,
  type CreatedProjectVNext,
} from "./project-lifecycle";

type CliOptions = {
  args: string[];
  log?: (message: string) => void;
};

type InspectCliOptions = {
  args: string[];
  log?: (message: string) => void;
  command?: "inspect" | "dry-run";
};

type ProjectWorkspaceCliOptions = Omit<CliOptions, "args"> & { args: string[] };

export type CreateCliResult = CreatedProjectVNext;

class CliArgumentError extends Error {
  readonly code = "CLI_ARGUMENT_INVALID";

  constructor(readonly path: string, message: string) {
    super(message);
    this.name = "CliArgumentError";
  }
}

/** CLI 只处理项目目录；交互工作区由 Codex 插件公开 MCP 入口承载。 */
export async function runCli(options: CliOptions): Promise<ProjectVNextInspection> {
  return runOpenProjectCli(options);
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

function parseCreateArguments(args: readonly string[]): {
  projectDirectory: string;
  open: boolean;
  confirmTemporaryCleanup: boolean;
} {
  const flags = new Set(args.filter((argument) => argument.startsWith("--")));
  const paths = args.filter((argument) => !argument.startsWith("--"));
  if (
    paths.length !== 1 ||
    [...flags].some((flag) => flag !== "--open" && flag !== "--confirm-cleanup") ||
    flags.size !== args.length - paths.length
  ) {
    throw new CliArgumentError(
      resolve(paths[0] ?? "."),
      "参数无效。用法：pnpm start create <不存在的 Project VNext 路径> [--open] [--confirm-cleanup]",
    );
  }
  return {
    projectDirectory: resolve(paths[0]!),
    open: flags.has("--open"),
    confirmTemporaryCleanup: flags.has("--confirm-cleanup"),
  };
}

export async function runCreateCli(options: ProjectWorkspaceCliOptions): Promise<CreateCliResult> {
  const parsed = parseCreateArguments(options.args);
  const created = await createProjectVNext(parsed.projectDirectory, {
    confirmTemporaryCleanup: parsed.confirmTemporaryCleanup,
  });
  options.log?.(JSON.stringify({ code: "PROJECT_CREATED", path: created.projectDirectory }));
  if (!parsed.open) return created;
  await runOpenProjectCli({ ...options, args: [created.projectDirectory] });
  return created;
}

export async function runCopyCli(options: ProjectWorkspaceCliOptions): Promise<CreateCliResult> {
  const [source, ...rest] = options.args;
  if (!source || source.startsWith('--')) throw new Error('用法：copy <来源路径> <新路径> [--open] [--confirm-cleanup]');
  const parsed = parseCreateArguments(rest);
  const copied = await copyProjectVNext(source, parsed.projectDirectory, parsed);
  options.log?.(JSON.stringify({ code: 'PROJECT_COPIED', path: copied.projectDirectory, projectId: copied.projectId }));
  if (!parsed.open) return copied;
  await runOpenProjectCli({ ...options, args: [copied.projectDirectory] });
  return copied;
}

export async function runOpenProjectCli(options: ProjectWorkspaceCliOptions): Promise<ProjectVNextInspection> {
  const [projectPath, ...unexpectedArguments] = options.args;
  if (projectPath === undefined || unexpectedArguments.length > 0) {
    throw new CliArgumentError(resolve(projectPath ?? "."), "参数无效。用法：pnpm start open <Project VNext 路径>");
  }
  const opened = await openProjectVNext(projectPath);
  try {
    (options.log ?? console.log)(JSON.stringify({
      code: "PROJECT_OPENED", path: opened.inspection.projectDirectory,
      projectId: opened.inspection.manifest.projectId,
      message: "项目已通过校验。请在 Narracut Codex 插件工作台打开此目录以继续编辑、Preview 和最终 Render。",
    }));
    return opened.inspection;
  } finally {
    await opened.release();
  }
}

export function formatCliError(error: unknown): string {
  if (error instanceof CliArgumentError) {
    return JSON.stringify({ code: error.code, path: error.path, message: error.message });
  }
  if (error instanceof ProjectLifecycleError) {
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

export async function runRecoveryCli(options: ProjectWorkspaceCliOptions, recover = false) {
  const args = [...options.args], action = recover ? 'recover' : args.shift();
  const paths: string[] = [], flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (['--open', '--confirm-cleanup'].includes(arg)) flags.set(arg, 'true');
    else if (['--plan', '--brief-result'].includes(arg) && args[i + 1] && !args[i + 1]!.startsWith('--')) flags.set(arg, args[++i]!);
    else if (arg.startsWith('--')) throw new Error(`未知或不完整参数：${arg}`);
    else paths.push(arg);
  }
  const briefFile = flags.get('--brief-result');
  const briefResult = briefFile === undefined ? undefined : decodeUtf8(await readBoundedControlFile(briefFile, 'video.md', 2 * 1024 * 1024), briefFile, 'video.md', true);
  let result: any;
  if (action === 'inspect' && paths.length === 1 && flags.size === 0) result = await inspectRecovery(paths[0]!);
  else if (action === 'dry-run' && paths.length === 2 && [...flags.keys()].every(key => key === '--brief-result')) result = await planRecovery(paths[0]!, paths[1]!, briefResult);
  else if (action === 'extract' && paths.length === 4 && flags.size === 0 && ['dsl', 'briefLocal', 'briefBase'].includes(paths[2]!)) result = await extractRecovery(paths[0]!, paths[1]!, paths[2] as 'dsl' | 'briefLocal' | 'briefBase', paths[3]!);
  else if (action === 'recover' && paths.length === 3 && flags.has('--plan')) {
    result = await recoverProject(paths[0]!, paths[1]!, paths[2]!, { planId: flags.get('--plan')!, briefResult, confirmTemporaryCleanup: flags.has('--confirm-cleanup') });
    (options.log ?? console.log)(JSON.stringify({ code: 'PROJECT_RECOVERED', ...result }));
    if (flags.has('--open')) await runOpenProjectCli({ ...options, args: [result.projectDirectory] });
    return result;
  } else throw new Error('用法：recovery inspect <快照>；recovery dry-run <快照> <明确来源> [--brief-result <文件>]；recover <快照> <明确来源> <新路径> --plan <计划摘要> [--brief-result <文件>] [--confirm-cleanup] [--open]；recovery extract <快照> <明确来源> <dsl|briefLocal|briefBase> <新文件>');
  (options.log ?? console.log)(JSON.stringify(result));
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "recovery" || args[0] === "recover") {
    const result = await runRecoveryCli({ args: args.slice(1) }, args[0] === "recover");
    return;
  }
  if (args[0] === "copy") {
    const copied = await runCopyCli({ args: args.slice(1) });
    return;
  }
  if (args[0] === "create") {
    const created = await runCreateCli({ args: args.slice(1) });
    return;
  }
  if (args[0] === "open") {
    await runOpenProjectCli({ args: args.slice(1) });
    return;
  }
  if (args[0] === "inspect") {
    await runInspectCli({ args: args.slice(1) });
    return;
  }
  if (args[0] === "dry-run") {
    await runDryRunCli({ args: args.slice(1) });
    return;
  }
  await runCli({ args });
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

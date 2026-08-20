import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isAbsolute as isPosixAbsolute } from "node:path/posix";

import serveHandler from "serve-handler";

import { validateRenderReadiness } from "../remotion/render-snapshot";
import { validateProjectConsistency, validateProjectStructure } from "../shared/project";
import { ImageImportJobError, ImageImportJobs } from "./image-import-jobs";
import {
  SpeechGenerationJobError,
  SpeechGenerationJobs,
} from "./speech-generation-jobs";
import {
  RenderJobError,
  RenderJobs,
  type RenderWorkerInput,
  type RenderWorkerHandle,
} from "./render-jobs";
import { preflightRenderMedia, RenderPreflightError } from "./render-preflight";
import { VideoThumbnailError, VideoThumbnailService } from "./video-thumbnails";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 3579;
const MAX_PROJECT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_IMPORT_BYTES = 100 * 1024 * 1024;
const PROJECT_LEASE_TTL_MS = 3_000;
const BACKUP_KINDS = new Set(["pre-migration", "external-conflict"]);

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export type StartServerOptions = {
  projectDirectory: string;
  staticDirectory: string;
  initialPort?: number;
  ttsFetch?: typeof fetch;
  environment?: { TOKENDANCE_API_KEY?: string };
  renderWorkerFactory?: (input: RenderWorkerInput) => RenderWorkerHandle;
  openDirectory?: (directory: string) => Promise<void>;
};

export type RunningServer = {
  url: string;
  port: number;
  releaseProjectLease: () => Promise<void>;
  close: () => Promise<void>;
};

function send(
  response: ServerResponse,
  statusCode: number,
  body: string | Buffer,
  contentType = "text/plain; charset=utf-8",
  headers: Record<string, string> = {},
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": contentType,
    ...headers,
  });
  response.end(body);
}

async function readRequestBody(
  request: IncomingMessage,
  limit = MAX_PROJECT_BYTES,
  tooLargeMessage = "Project DSL 超过 10 MiB 上限。",
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limit) {
      throw new HttpError(413, tooLargeMessage);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function writeProjectAtomically(
  projectFile: string,
  bytes: Buffer,
): Promise<void> {
  const temporaryFile = join(
    resolve(projectFile, ".."),
    `.${basename(projectFile)}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporaryFile, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporaryFile).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await rename(temporaryFile, projectFile);
  } catch (error) {
    await unlink(temporaryFile).catch(() => undefined);
    throw error;
  }

  // rename 已经是提交点；目录 fsync 失败不能把已成功的原子写入反转为失败。
  await syncProjectDirectory(projectFile).catch(() => undefined);
}

async function syncProjectDirectory(projectFile: string): Promise<void> {
  const directory = await open(resolve(projectFile, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function projectEtag(bytes: Buffer): string {
  return `"sha256-${createHash("sha256").update(bytes).digest("hex")}"`;
}

async function createProjectBackup(
  projectFile: string,
  kind: string,
  bytes: Buffer,
): Promise<string> {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const fileName = `project.${kind}.${timestamp}.${randomUUID()}.json`;
  const backupFile = join(resolve(projectFile, ".."), fileName);
  const handle = await open(backupFile, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(backupFile).catch(() => undefined);
    throw error;
  }
  await handle.close();
  await syncProjectDirectory(projectFile);
  return fileName;
}

function readBackupKind(request: IncomingMessage): string | undefined {
  const value = request.headers["x-narracut-backup-kind"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !BACKUP_KINDS.has(value)) {
    throw new HttpError(400, "备份类型无效。");
  }
  return value;
}

function readSessionId(request: IncomingMessage): string {
  const sessionId = request.headers["x-narracut-session-id"];
  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    sessionId.length > 128
  ) {
    throw new HttpError(423, "当前请求没有有效的项目编辑租约。");
  }
  return sessionId;
}

function isProjectRelativePath(path: string): boolean {
  const segments = path.split("/");
  return (
    path.length > 0 &&
    !isPosixAbsolute(path) &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !/%[0-9A-Fa-f]{2}/.test(path) &&
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

async function probeProjectPaths(
  projectRoot: string,
  projectRealRoot: string,
  paths: string[],
): Promise<Array<{ path: string; exists: boolean; error?: string }>> {
  return Promise.all(
    paths.map(async (path) => {
      if (!isProjectRelativePath(path)) {
        return { path, exists: false, error: "INVALID_PROJECT_PATH" };
      }

      try {
        return {
          path,
          exists: await isContainedProjectFile(
            projectRealRoot,
            join(projectRoot, ...path.split("/")),
          ),
        };
      } catch {
        return { path, exists: false };
      }
    }),
  );
}

async function probeSpeechRevisions(
  projectRoot: string,
  projectRealRoot: string,
  paths: string[],
): Promise<Array<{ path: string; exists: boolean; revision?: string; error?: string }>> {
  return Promise.all(
    paths.map(async (path) => {
      if (!isProjectRelativePath(path) || !path.startsWith("speech/")) {
        return { path, exists: false, error: "INVALID_SPEECH_PATH" };
      }
      const file = join(projectRoot, ...path.split("/"));
      try {
        if (!(await isContainedProjectFile(projectRealRoot, file))) {
          return { path, exists: false };
        }
        return {
          path,
          exists: true,
          revision: `sha256:${createHash("sha256")
            .update(await readFile(file))
            .digest("hex")}`,
        };
      } catch {
        return { path, exists: false };
      }
    }),
  );
}

async function isContainedProjectFile(
  projectRealRoot: string,
  candidate: string,
): Promise<boolean> {
  const resolvedCandidate = await realpath(candidate);
  const projectRelativePath = relative(projectRealRoot, resolvedCandidate);
  if (
    projectRelativePath === "" ||
    projectRelativePath === ".." ||
    projectRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(projectRelativePath)
  ) {
    return false;
  }
  return (await stat(resolvedCandidate)).isFile();
}

async function listen(
  server: ReturnType<typeof createServer>,
  initialPort: number,
): Promise<number> {
  if (initialPort === 0) {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.once("error", rejectPromise);
      server.listen(0, LOOPBACK_HOST, () => {
        server.off("error", rejectPromise);
        resolvePromise();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("无法确定本地服务端口。");
    }
    return address.port;
  }

  let port = initialPort;
  while (port < initialPort + 100) {
    const result = await new Promise<"listening" | "in-use">(
      (resolvePromise, rejectPromise) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off("listening", onListening);
          if (error.code === "EADDRINUSE") {
            resolvePromise("in-use");
          } else {
            rejectPromise(error);
          }
        };
        const onListening = () => {
          server.off("error", onError);
          resolvePromise("listening");
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, LOOPBACK_HOST);
      },
    );

    if (result === "listening") return port;
    port += 1;
  }

  throw new Error(`端口 ${initialPort}–${initialPort + 99} 均不可用。`);
}

async function openLocalDirectory(directory: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";
  const child = spawn(command, [directory], { detached: true, stdio: "ignore" });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    child.once("spawn", resolvePromise);
    child.once("error", rejectPromise);
  });
  child.unref();
}

export async function startNarracutServer({
  projectDirectory,
  staticDirectory,
  initialPort = DEFAULT_PORT,
  ttsFetch,
  environment = process.env,
  renderWorkerFactory,
  openDirectory = openLocalDirectory,
}: StartServerOptions): Promise<RunningServer> {
  const projectRoot = resolve(projectDirectory);
  const staticRoot = resolve(staticDirectory);
  const projectFile = join(projectRoot, "project.json");
  const staticIndexFile = join(staticRoot, "index.html");

  const [projectDirectoryStat, staticDirectoryStat, projectFileStat, staticIndexStat] =
    await Promise.all([
      stat(projectRoot),
      stat(staticRoot),
      stat(projectFile),
      stat(staticIndexFile),
    ]);
  if (!projectDirectoryStat.isDirectory() || !staticDirectoryStat.isDirectory()) {
    throw new Error("项目路径与 SPA 路径都必须是文件夹。");
  }
  if (!projectFileStat.isFile()) {
    throw new Error(`${projectFile} 不是有效的 Project DSL 文件。`);
  }
  if (!staticIndexStat.isFile()) {
    throw new Error(`${staticIndexFile} 不是有效的 SPA 入口文件。`);
  }
  const projectRealRoot = await realpath(projectRoot);
  const imageImportJobs = new ImageImportJobs(projectRoot);
  const speechGenerationJobs = new SpeechGenerationJobs(projectRoot, {
    fetchImpl: ttsFetch,
    apiKey: environment.TOKENDANCE_API_KEY,
  });
  const renderJobs = new RenderJobs(projectRoot, {
    workerFactory: renderWorkerFactory,
  });
  const videoThumbnails = new VideoThumbnailService();
  const eventStreams = new Set<ServerResponse>();
  let lease: { sessionId: string; expiresAt: number } | undefined;
  let projectMutationQueue: Promise<void> = Promise.resolve();

  const withProjectLock = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = projectMutationQueue.then(operation, operation);
    projectMutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const hasLease = (sessionId: string): boolean => {
    const now = Date.now();
    if (lease !== undefined && lease.expiresAt <= now) lease = undefined;
    return lease?.sessionId === sessionId;
  };

  const requireLease = (request: IncomingMessage): string => {
    const sessionId = readSessionId(request);
    if (!hasLease(sessionId)) {
      throw new HttpError(423, "项目编辑权正由另一个浏览器会话持有。");
    }
    return sessionId;
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);

      if (url.pathname === "/api/project" && request.method === "GET") {
        const bytes = await readFile(projectFile);
        send(
          response,
          200,
          bytes,
          "application/json; charset=utf-8",
          { etag: projectEtag(bytes) },
        );
        return;
      }

      if (url.pathname === "/api/project/lease" && request.method === "POST") {
        let input: unknown;
        try {
          input = JSON.parse((await readRequestBody(request)).toString("utf8"));
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(400, "租约请求体不是合法的 JSON。");
        }
        const sessionId =
          typeof input === "object" && input !== null
            ? Reflect.get(input, "sessionId")
            : undefined;
        if (
          typeof sessionId !== "string" ||
          sessionId.length === 0 ||
          sessionId.length > 128
        ) {
          throw new HttpError(400, "sessionId 必须是 1–128 字符的字符串。");
        }
        const leaseResult = await withProjectLock(async () => {
          const now = Date.now();
          if (lease !== undefined && lease.expiresAt <= now) lease = undefined;
          if (lease !== undefined && lease.sessionId !== sessionId) {
            return { status: "occupied" as const, expiresAt: lease.expiresAt };
          }
          lease = { sessionId, expiresAt: now + PROJECT_LEASE_TTL_MS };
          return { status: "acquired" as const, expiresAt: lease.expiresAt };
        });
        if (leaseResult.status === "occupied") {
          send(
            response,
            200,
            JSON.stringify(leaseResult),
            "application/json; charset=utf-8",
          );
          return;
        }
        send(
          response,
          200,
          JSON.stringify(leaseResult),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (url.pathname === "/api/project/lease" && request.method === "DELETE") {
        const sessionId = readSessionId(request);
        await withProjectLock(async () => {
          if (lease?.sessionId === sessionId) lease = undefined;
        });
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }

      if (url.pathname === "/api/project/lease/release" && request.method === "POST") {
        const sessionId = (await readRequestBody(request)).toString("utf8");
        if (sessionId.length === 0 || sessionId.length > 128) {
          throw new HttpError(400, "sessionId 必须是 1–128 字符的字符串。");
        }
        await withProjectLock(async () => {
          if (lease?.sessionId === sessionId) lease = undefined;
        });
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }

      if (url.pathname === "/api/project" && request.method === "PUT") {
        const sessionId = readSessionId(request);
        const ifMatch = request.headers["if-match"];
        if (typeof ifMatch !== "string" || ifMatch.length === 0) {
          throw new HttpError(428, "写入 Project DSL 必须携带 If-Match。");
        }
        const backupKind = readBackupKind(request);
        const bytes = await readRequestBody(request);
        const nextEtag = await withProjectLock(async () => {
          if (!hasLease(sessionId)) {
            throw new HttpError(423, "项目编辑权正由另一个浏览器会话持有。");
          }
          const currentBytes = await readFile(projectFile);
          const currentEtag = projectEtag(currentBytes);
          if (currentBytes.equals(bytes)) return currentEtag;
          if (currentEtag !== ifMatch) {
            throw new HttpError(412, "Project DSL 已在磁盘上改变。");
          }
          if (backupKind !== undefined) {
            await createProjectBackup(projectFile, backupKind, currentBytes);
          }
          await writeProjectAtomically(projectFile, bytes);
          return projectEtag(bytes);
        });
        response.writeHead(204, {
          "cache-control": "no-store",
          etag: nextEtag,
        });
        response.end();
        return;
      }

      if (url.pathname === "/api/project/backups" && request.method === "POST") {
        const sessionId = readSessionId(request);
        const backupKind = readBackupKind(request);
        if (backupKind === undefined) {
          throw new HttpError(400, "备份请求必须声明备份类型。");
        }
        const ifMatch = request.headers["if-match"];
        if (typeof ifMatch !== "string" || ifMatch.length === 0) {
          throw new HttpError(428, "备份请求必须携带当前磁盘修订的 If-Match。");
        }
        const bytes = await readRequestBody(request);
        const fileName = await withProjectLock(async () => {
          if (!hasLease(sessionId)) {
            throw new HttpError(423, "项目编辑权正由另一个浏览器会话持有。");
          }
          const currentBytes = await readFile(projectFile);
          if (projectEtag(currentBytes) !== ifMatch) {
            throw new HttpError(412, "Project DSL 已在磁盘上再次改变。");
          }
          return createProjectBackup(projectFile, backupKind, bytes);
        });
        send(
          response,
          201,
          JSON.stringify({ fileName }),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (url.pathname === "/api/project-info" && request.method === "GET") {
        send(
          response,
          200,
          JSON.stringify({
            projectDirectory: projectRoot,
            projectFile,
            fallbackName: basename(projectRoot),
          }),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (url.pathname === "/api/assets/probe" && request.method === "POST") {
        let input: unknown;
        try {
          input = JSON.parse((await readRequestBody(request)).toString("utf8"));
        } catch (error) {
          if (error instanceof HttpError) throw error;
          send(response, 400, "请求体不是合法的 JSON。");
          return;
        }
        const pathsValue: unknown =
          typeof input === "object" && input !== null &&
          Array.isArray(Reflect.get(input, "paths"))
            ? Reflect.get(input, "paths")
            : undefined;
        if (
          !Array.isArray(pathsValue) ||
          pathsValue.length > 1_000 ||
          !pathsValue.every((path: unknown) => typeof path === "string")
        ) {
          send(response, 400, "paths 必须是不超过 1000 项的字符串数组。");
          return;
        }
        const paths = pathsValue as string[];
        send(
          response,
          200,
          JSON.stringify({
            results: await probeProjectPaths(projectRoot, projectRealRoot, paths),
          }),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (url.pathname === "/api/assets/thumbnail" && request.method === "GET") {
        const relativePath = url.searchParams.get("path");
        if (relativePath === null || !isProjectRelativePath(relativePath)) {
          throw new HttpError(400, "path 必须是有效的项目相对路径。");
        }
        const candidate = join(projectRoot, ...relativePath.split("/"));
        let mediaFile: string;
        try {
          if (!(await isContainedProjectFile(projectRealRoot, candidate))) {
            throw new HttpError(404, "视频文件不存在。");
          }
          mediaFile = await realpath(candidate);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(404, "视频文件不存在。");
        }
        const thumbnail = await videoThumbnails.get(relativePath, mediaFile);
        const headers = {
          "cache-control": "private, no-cache",
          etag: thumbnail.etag,
        };
        if (request.headers["if-none-match"] === thumbnail.etag) {
          response.writeHead(304, headers);
          response.end();
          return;
        }
        response.writeHead(200, {
          ...headers,
          "content-length": thumbnail.bytes.byteLength,
          "content-type": "image/jpeg",
        });
        response.end(thumbnail.bytes);
        return;
      }

      if (url.pathname === "/api/speech/revisions" && request.method === "POST") {
        let input: unknown;
        try {
          input = JSON.parse((await readRequestBody(request)).toString("utf8"));
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(400, "Speech 修订请求体不是合法的 JSON。");
        }
        const paths =
          typeof input === "object" && input !== null &&
          Array.isArray(Reflect.get(input, "paths"))
            ? Reflect.get(input, "paths")
            : undefined;
        if (
          !Array.isArray(paths) ||
          paths.length > 1_000 ||
          !paths.every((path: unknown) => typeof path === "string")
        ) {
          throw new HttpError(400, "paths 必须是不超过 1000 项的字符串数组。");
        }
        send(
          response,
          200,
          JSON.stringify({
            results: await probeSpeechRevisions(
              projectRoot,
              projectRealRoot,
              paths as string[],
            ),
          }),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (url.pathname === "/api/jobs/events" && request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
          "x-accel-buffering": "no",
        });
        response.write(": connected\n\n");
        eventStreams.add(response);
        for (const job of imageImportJobs.list()) {
          response.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
        }
        for (const job of speechGenerationJobs.list()) {
          response.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
        }
        for (const job of renderJobs.list()) {
          response.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
        }
        const writeJob = (job: import("../shared/jobs").NarracutJob) => {
          if (!response.destroyed && !response.writableEnded) {
            response.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
          }
        };
        const unsubscribeImage = imageImportJobs.subscribe(writeJob);
        const unsubscribeSpeech = speechGenerationJobs.subscribe(writeJob);
        const unsubscribeRender = renderJobs.subscribe(writeJob);
        request.once("close", () => {
          unsubscribeImage();
          unsubscribeSpeech();
          unsubscribeRender();
          eventStreams.delete(response);
        });
        return;
      }

      if (url.pathname === "/api/jobs/render" && request.method === "POST") {
        requireLease(request);
        if (!request.headers["content-type"]?.startsWith("application/json")) {
          throw new HttpError(415, "Render 请求必须使用 application/json。");
        }
        let input: unknown;
        try {
          input = JSON.parse((await readRequestBody(request)).toString("utf8"));
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(400, "Render 请求体不是合法的 Project DSL。");
        }
        const structure = validateProjectStructure(input);
        if (!structure.success) {
          throw new HttpError(
            400,
            structure.diagnostics[0]?.message ?? "Render 请求包含无效的 Project DSL。",
          );
        }
        const snapshotSource = request.headers["x-narracut-snapshot-source"] ?? "saved";
        if (snapshotSource !== "saved" && snapshotSource !== "unsaved") {
          throw new HttpError(400, "快照版本说明必须是 saved 或 unsaved。");
        }
        const availability = await preflightRenderMedia(structure.project, projectRoot);
        const blocker = [
          ...validateProjectConsistency(structure.project),
          ...validateRenderReadiness(structure.project, availability),
        ].find((diagnostic) => diagnostic.severity === "error");
        if (blocker !== undefined) throw new HttpError(422, blocker.message);
        const serverAddress = server.address();
        if (serverAddress === null || typeof serverAddress === "string") {
          throw new HttpError(503, "本地服务尚未准备好渲染媒体。");
        }
        send(
          response,
          202,
          JSON.stringify({
            job: await renderJobs.create({
              project: structure.project,
              mediaBaseUrl: `http://${LOOPBACK_HOST}:${serverAddress.port}/media/`,
              snapshotSource,
              mediaAvailability: availability,
            }),
          }),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (url.pathname === "/api/jobs/speech" && request.method === "POST") {
        requireLease(request);
        let input: unknown;
        try {
          input = JSON.parse((await readRequestBody(request)).toString("utf8"));
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(400, "Speech 请求体不是合法的 JSON。");
        }
        const sceneId =
          typeof input === "object" && input !== null
            ? Reflect.get(input, "sceneId")
            : undefined;
        const narrationText =
          typeof input === "object" && input !== null
            ? Reflect.get(input, "narrationText")
            : undefined;
        if (
          typeof sceneId !== "string" ||
          typeof narrationText !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            sceneId,
          )
        ) {
          throw new HttpError(400, "Speech 请求必须包含目标 Scene ID 与 Narration。");
        }
        send(
          response,
          202,
          JSON.stringify({
            job: speechGenerationJobs.create({ sceneId, narrationText }),
          }),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (
        url.pathname === "/api/jobs/speech/recover" &&
        request.method === "POST"
      ) {
        requireLease(request);
        send(
          response,
          200,
          JSON.stringify({
            jobs: await withProjectLock(() => speechGenerationJobs.recoverOrphans()),
          }),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (url.pathname === "/api/jobs/image-import" && request.method === "POST") {
        requireLease(request);
        const rawFileName = request.headers["x-narracut-file-name"];
        const sceneId = request.headers["x-narracut-scene-id"];
        if (typeof rawFileName !== "string" || typeof sceneId !== "string") {
          throw new HttpError(400, "图片导入必须包含文件名与目标 Scene ID。");
        }
        let fileName: string;
        try {
          fileName = decodeURIComponent(rawFileName);
        } catch {
          throw new HttpError(400, "图片文件名无效。");
        }
        if (
          fileName.length === 0 ||
          fileName.length > 512 ||
          /[\0\r\n]/u.test(fileName) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            sceneId,
          )
        ) {
          throw new HttpError(400, "图片文件名或目标 Scene ID 无效。");
        }
        const source = await readRequestBody(
          request,
          MAX_IMAGE_IMPORT_BYTES,
          "图片导入源超过 100 MiB 上限。",
        );
        if (source.byteLength === 0) throw new HttpError(400, "图片导入源为空。");
        send(
          response,
          202,
          JSON.stringify({ job: imageImportJobs.create({ sceneId, fileName, source }) }),
          "application/json; charset=utf-8",
        );
        return;
      }

      const jobMatch = /^\/api\/jobs\/([0-9a-f-]+)$/iu.exec(url.pathname);
      const openOutputMatch = /^\/api\/jobs\/([0-9a-f-]+)\/open-output$/iu.exec(
        url.pathname,
      );
      const speechActionMatch =
        /^\/api\/jobs\/([0-9a-f-]+)\/(commit|discard)$/iu.exec(
          url.pathname,
        );
      if (speechActionMatch !== null && request.method === "POST") {
        const [, jobId, action] = speechActionMatch;
        const sessionId = readSessionId(request);
        if (action === "discard") {
          if (!hasLease(sessionId)) {
            throw new HttpError(423, "项目编辑权正由另一个浏览器会话持有。");
          }
          const discarded = await speechGenerationJobs.discard(jobId);
          if (discarded === undefined) {
            throw new HttpError(404, "找不到这个 Speech Job。");
          }
          send(response, 200, JSON.stringify(discarded), "application/json; charset=utf-8");
          return;
        }
        const ifMatch = request.headers["if-match"];
        if (typeof ifMatch !== "string" || ifMatch.length === 0) {
          throw new HttpError(428, "应用 Speech 必须携带 Project If-Match。");
        }
        const bytes = await readRequestBody(request, MAX_PROJECT_BYTES);
        let input: unknown;
        try {
          input = JSON.parse(bytes.toString("utf8"));
        } catch {
          throw new HttpError(400, "Speech 提交包含无效的 Project DSL。");
        }
        const structural = validateProjectStructure(input);
        if (!structural.success) {
          throw new HttpError(400, "Speech 提交包含无效的 Project DSL。");
        }
        const prepared = speechGenerationJobs.get(jobId);
        const targetScene = structural.project.scenes.find(
          (scene) => scene.id === prepared?.sceneId,
        );
        if (
          prepared?.result === undefined ||
          targetScene?.narration.text !== prepared.narrationText ||
          JSON.stringify(targetScene.speech) !== JSON.stringify(prepared.result.speech)
        ) {
          throw new HttpError(409, "Speech 提交前提已改变，结果未应用。");
        }
        const nextEtag = await withProjectLock(async () => {
          if (!hasLease(sessionId)) {
            throw new HttpError(423, "项目编辑权正由另一个浏览器会话持有。");
          }
          const currentBytes = await readFile(projectFile);
          if (projectEtag(currentBytes) !== ifMatch) {
            throw new HttpError(412, "Project DSL 已在磁盘上改变。");
          }
          let committed = false;
          try {
            const job = await speechGenerationJobs.commit(jobId);
            if (job === undefined) throw new HttpError(404, "找不到这个 Speech Job。");
            committed = true;
            await writeProjectAtomically(projectFile, bytes);
            await speechGenerationJobs.acknowledge(jobId);
            return projectEtag(bytes);
          } catch (error) {
            if (committed) {
              try {
                await speechGenerationJobs.rollback(jobId);
              } catch {
                throw new HttpError(500, "Speech 提交失败，且旧音频恢复失败。");
              }
            }
            throw error;
          }
        });
        send(
          response,
          200,
          JSON.stringify({ job: speechGenerationJobs.get(jobId) }),
          "application/json; charset=utf-8",
          { etag: nextEtag },
        );
        return;
      }
      if (openOutputMatch !== null && request.method === "POST") {
        requireLease(request);
        const job = renderJobs.get(openOutputMatch[1]);
        if (job === undefined) throw new HttpError(404, "找不到这个 Render Job。");
        if (job.status !== "succeeded") {
          throw new HttpError(409, "Render Job 尚未成功完成。");
        }
        await openDirectory(job.artifacts.directory);
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }
      if (jobMatch !== null && request.method === "GET") {
        const job =
          imageImportJobs.get(jobMatch[1]) ??
          speechGenerationJobs.get(jobMatch[1]) ??
          renderJobs.get(jobMatch[1]);
        if (job === undefined) throw new HttpError(404, "找不到这个 Job。");
        send(response, 200, JSON.stringify(job), "application/json; charset=utf-8");
        return;
      }
      if (jobMatch !== null && request.method === "DELETE") {
        requireLease(request);
        const renderJob = renderJobs.cancel(jobMatch[1]);
        if (renderJob !== undefined) {
          send(response, 200, JSON.stringify(renderJob), "application/json; charset=utf-8");
          return;
        }
        const job =
          imageImportJobs.cancel(jobMatch[1]) ??
          speechGenerationJobs.cancel(jobMatch[1]);
        if (job === undefined) throw new HttpError(404, "找不到这个 Job。");
        send(response, 200, JSON.stringify(job), "application/json; charset=utf-8");
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        send(response, 404, "未知项目 API。");
        return;
      }

      if (url.pathname.startsWith("/media/")) {
        response.setHeader("access-control-allow-origin", "*");
        const encodedRelativePath = url.pathname.slice("/media/".length);
        let relativePath: string;
        try {
          relativePath = decodeURIComponent(encodedRelativePath);
        } catch {
          send(response, 404, "无效的项目媒体路径。");
          return;
        }
        if (!isProjectRelativePath(relativePath)) {
          send(response, 404, "无效的项目媒体路径。");
          return;
        }
        const mediaFile = join(projectRoot, ...relativePath.split("/"));
        try {
          if (!(await isContainedProjectFile(projectRealRoot, mediaFile))) {
            send(response, 404, "项目媒体不存在。");
            return;
          }
        } catch {
          send(response, 404, "项目媒体不存在。");
          return;
        }
        request.url = `/${encodedRelativePath}${url.search}`;
        await serveHandler(request, response, {
          public: projectRoot,
          cleanUrls: false,
          directoryListing: false,
        });
        return;
      }

      if (extname(url.pathname) !== "") {
        await serveHandler(request, response, {
          public: staticRoot,
          cleanUrls: false,
          directoryListing: false,
        });
        return;
      }

      send(
        response,
        200,
        await readFile(staticIndexFile),
        "text/html; charset=utf-8",
      );
    } catch (error) {
      if (response.headersSent) return;
      const message = error instanceof Error ? error.message : "未知本地服务错误。";
      const statusCode =
        error instanceof HttpError ||
        error instanceof ImageImportJobError ||
        error instanceof SpeechGenerationJobError ||
        error instanceof RenderJobError ||
        error instanceof RenderPreflightError ||
        error instanceof VideoThumbnailError
          ? error.statusCode
          : 500;
      send(response, statusCode, message);
    }
  });

  const port = await listen(server, initialPort);
  return {
    port,
    url: `http://${LOOPBACK_HOST}:${port}`,
    releaseProjectLease: () =>
      withProjectLock(async () => {
        lease = undefined;
      }),
    close: async () => {
      for (const stream of eventStreams) stream.end();
      eventStreams.clear();
      await videoThumbnails.close();
      renderJobs.close();
      return new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
        server.closeAllConnections();
      });
    },
  };
}

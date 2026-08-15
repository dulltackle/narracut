import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isAbsolute as isPosixAbsolute } from "node:path/posix";

import serveHandler from "serve-handler";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 3579;
const MAX_PROJECT_BYTES = 10 * 1024 * 1024;

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
};

export type RunningServer = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

function send(
  response: ServerResponse,
  statusCode: number,
  body: string | Buffer,
  contentType = "text/plain; charset=utf-8",
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": contentType,
  });
  response.end(body);
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_PROJECT_BYTES) {
      throw new HttpError(413, "Project DSL 超过 10 MiB 上限。");
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
  await writeFile(temporaryFile, bytes);
  await rename(temporaryFile, projectFile);
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

export async function startNarracutServer({
  projectDirectory,
  staticDirectory,
  initialPort = DEFAULT_PORT,
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

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);

      if (url.pathname === "/api/project" && request.method === "GET") {
        send(
          response,
          200,
          await readFile(projectFile),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (url.pathname === "/api/project" && request.method === "PUT") {
        const bytes = await readRequestBody(request);
        await writeProjectAtomically(projectFile, bytes);
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
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
      send(response, error instanceof HttpError ? error.statusCode : 500, message);
    }
  });

  const port = await listen(server, initialPort);
  return {
    port,
    url: `http://${LOOPBACK_HOST}:${port}`,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      }),
  };
}

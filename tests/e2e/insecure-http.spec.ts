import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { startNarracutServer, type RunningServer } from "../../src/server/server";

let projectDirectory: string;
let server: RunningServer;

test.beforeAll(async () => {
  projectDirectory = await mkdtemp(join(tmpdir(), "narracut-insecure-http-e2e-"));
  const project = JSON.parse(
    await readFile(resolve("docs/spec/project.example.json"), "utf8"),
  ) as {
    scenes: Array<{
      id: string;
      speech?: {
        path: string;
        durationMs: number;
        sourceTextHash: string;
        ttsProfileId: string;
      };
    }>;
  };
  const firstScene = project.scenes[0];
  if (firstScene === undefined) throw new Error("测试项目必须至少包含一个 Scene。");
  firstScene.speech = {
    path: `speech/${firstScene.id}.mp3`,
    durationMs: 1_000,
    sourceTextHash: `sha256:${"0".repeat(64)}`,
    ttsProfileId: "narracut-mandarin-news-v1",
  };
  await writeFile(
    join(projectDirectory, "project.json"),
    `${JSON.stringify(project, null, 2)}\n`,
  );
  server = await startNarracutServer({
    projectDirectory,
    staticDirectory: resolve("dist/client"),
    host: "127.0.0.1",
    initialPort: 0,
  });
});

test.afterAll(async () => {
  await server.close();
  await rm(projectDirectory, { recursive: true, force: true });
});

test("非安全 HTTP 来源仍能启动工作台", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const insecureUrl = server.url.replace("127.0.0.1", "0.0.0.0");

  await page.goto(insecureUrl);

  expect(await page.evaluate(() => globalThis.isSecureContext)).toBe(false);
  await expect(page.getByRole("heading", { name: "脚本表" })).toBeVisible();
  await expect(
    page.getByText("Cannot read properties of undefined (reading 'digest')"),
  ).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

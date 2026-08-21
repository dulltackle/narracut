import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "real-acceptance.live.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  outputDir: join(tmpdir(), "narracut-real-acceptance-playwright"),
  timeout: 30 * 60_000,
  expect: { timeout: 30_000 },
  use: {
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    browserName: "chromium",
    viewport: { width: 2000, height: 1200 },
    trace: "retain-on-failure",
  },
});

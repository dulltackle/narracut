import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "public-journey.live.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  outputDir: join(tmpdir(), "narracut-public-e2e-results"),
  timeout: 12 * 60_000,
  expect: { timeout: 15_000 },
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
});

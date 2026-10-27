import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Never seed or reset browser fixtures in the developer's demo database.
process.env.MONGODB_DB = process.env.E2E_MONGODB_DB ?? "normal_e2e";
process.env.NORMAL_AUTO_MONITOR = "true";
process.env.E2E_ARTIFACT_DIR ??= join(tmpdir(), "normal-e2e-artifacts");

/**
 * E2E tests run against `next dev` so the dev-only simulator routes are available.
 * They use a dedicated business/run (see tests/e2e) and never touch unrelated data.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: join(process.env.E2E_ARTIFACT_DIR, "test-results"),
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3101", trace: "retain-on-failure" },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npx next dev -p 3101",
    env: { NORMAL_NEXT_DIST_DIR: ".next/e2e" },
    url: "http://localhost:3101",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});

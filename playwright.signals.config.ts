import { defineConfig, devices } from "@playwright/test";

/** Read-only desktop verification against an already running Normal server. */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "signals-inbox.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
  projects: [{ name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});

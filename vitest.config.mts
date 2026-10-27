import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

// `server-only` throws when imported outside a React Server Components bundler.
// Tests exercise server modules directly in Node, so alias it to a no-op.
const serverOnlyStub = fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias: { "server-only": serverOnlyStub } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // DB-backed suites share one Atlas free-tier cluster; run files sequentially.
    fileParallelism: false,
  },
});

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored shared contracts package: type-checked and fixture-validated by its
    // own scripts (npm run contracts:typecheck / contracts:validate); not edited here.
    "packages/contracts/**",
    "src/vendor/**",
    // Vendored Python Animation Studio; its browser UI is tested by its own suite.
    "apps/animation-studio/**",
    ".local/**",
    "**/*.tmp.ts",
    "**/*.tmp.mts",
    "**/*.tmp.config.mts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;

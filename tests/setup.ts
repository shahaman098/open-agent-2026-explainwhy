import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Next.js deliberately skips `.env.local` when NODE_ENV === "test", so tests load
 * it explicitly. Existing process variables win; values are never logged.
 */
function loadDotEnvLocal(): void {
  const file = resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnvLocal();

// Fixture-driven suites validate provider configuration before invoking injected
// models. Keep them independent of the developer's local/hosted inference setup
// and never give a test the developer's real NVIDIA credential. Provider-boundary
// tests explicitly unset/replace these values to exercise each supported mode.
process.env.NVIDIA_API_KEY = "test-fixture-no-provider-requests";
process.env.NVIDIA_INFERENCE_MODE = "cloud";
process.env.NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
for (const stage of ["INVESTIGATOR", "DIAGNOSIS", "PLANNER"]) delete process.env[`NEMOTRON_${stage}_MODEL`];

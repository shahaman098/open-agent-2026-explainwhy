import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const args = process.argv.slice(2);
const nextArgs = args.length ? args : ["--hostname", "127.0.0.1", "--port", "8772"];
const children = [
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...nextArgs], { stdio: "inherit", env: { ...process.env, NODE_ENV: "development" } }),
  spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/dashboard-analysis-worker.ts", `--business=${process.env.EXPLAINWHY_ANALYSIS_BUSINESS || "nvidia_demo"}`], { stdio: "inherit", env: { ...process.env, NODE_ENV: "development" } }),
  spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/investigator-worker.ts"], { stdio: "inherit", env: { ...process.env, NODE_ENV: "development" } }),
  spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/planner-worker.ts"], { stdio: "inherit", env: { ...process.env, NODE_ENV: "development" } }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true; process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  const timeout = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); }, 5000); timeout.unref();
}
for (const child of children) { child.once("error", () => stop(1)); child.once("exit", code => stop(code || 0)); }
process.once("SIGINT", () => stop()); process.once("SIGTERM", () => stop());

import { existsSync } from "node:fs";
import { getDb, getMongoClient, describeDbError } from "../src/lib/mongodb";
import { ensureIndexes } from "../src/lib/collections";
import { checkChangeStreams, runWatcher } from "../src/intelligence/monitoring/watcher";
import { recoverCommittedWindows } from "../src/simulator/monitoring";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

async function main() {
  const db = await getDb();
  await ensureIndexes(db);
  // Probe the actual deployment before enabling the stream; never infer Atlas capabilities from its URL.
  const capability = await checkChangeStreams(db);
  console.log(`[monitor-watch] Change Streams verified (${capability.topology})`);
  if (process.argv.includes("--check")) return;
  while (!stop.signal.aborted) {
    try { await runWatcher(db, { signal: stop.signal, recoverProducer: () => recoverCommittedWindows(db) }); }
    catch (error) { console.error("[monitor-watch] reconnecting:", describeDbError(error)); }
    if (!stop.signal.aborted) await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); stop.signal.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, 5_000);
      stop.signal.addEventListener("abort", done, { once: true });
    });
  }
}

main().catch((error: unknown) => {
  console.error("[monitor-watch]", describeDbError(error));
  process.exitCode = 1;
}).finally(async () => {
  if (globalThis._normalMongoClientPromise) await (await getMongoClient()).close();
});

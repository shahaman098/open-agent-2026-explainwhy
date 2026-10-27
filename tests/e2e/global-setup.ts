import { existsSync } from "node:fs";
import { MongoClient } from "mongodb";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Browser fixtures select a storefront run; restore the previous selection even after a failed suite. */
export default async function preserveActiveDemoRun() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required for database-backed browser tests");
  await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "tests/e2e/seed.mts"], { timeout: 300_000 });
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const dbName = process.env.MONGODB_DB || "normal_dev";
  let active: string | undefined;
  try {
    active = (await client.db(dbName).collection("businesses").findOne({ businessId: "nike_demo" }))?.activeSimulationRunId as string | undefined;
  } finally { await client.close(); }
  return async () => {
    const restore = await MongoClient.connect(process.env.MONGODB_URI!);
    try {
      // Do not override an operator's intervening choice of an unrelated run.
      await restore.db(dbName).collection("businesses").updateOne(
        { businessId: "nike_demo", activeSimulationRunId: { $in: ["e2e_run", "e2e_monitor", "e2e_dashboard"] } },
        active ? { $set: { activeSimulationRunId: active } } : { $unset: { activeSimulationRunId: "" } },
      );
    } finally { await restore.close(); }
  };
}

import "server-only";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { ExportRequest, hasValues, PRESENTATION_RENDERER_VERSION, type PresentationExport, type PresentationJob } from "./schema";
export const exportRoot = () => path.join(process.cwd(), ".local/presentation-exports");
export function exportDirectory(id: string) { if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Invalid export ID"); return path.join(exportRoot(), id); }
export async function readExport(id: string) { return JSON.parse(await readFile(path.join(exportDirectory(id), "job.json"), "utf8")) as PresentationJob; }
async function workerFailed(id: string) {
  const job = await readExport(id).catch(() => null);
  if (job && job.status !== "complete" && job.status !== "failed") {
    job.status = "failed"; job.error = "The export worker stopped. Retry the export."; job.updatedAt = new Date().toISOString();
    await writeFile(path.join(exportDirectory(id), "job.tmp.json"), JSON.stringify(job));
    await rename(path.join(exportDirectory(id), "job.tmp.json"), path.join(exportDirectory(id), "job.json"));
  }
  const lock = await readFile(path.join(exportRoot(), "render.lock"), "utf8").then(text => JSON.parse(text)).catch(() => null);
  if (lock?.id === id) await rm(path.join(exportRoot(), "render.lock"), { force: true });
}
async function ffmpegPath() {
  for (const executable of [process.env.EXPLAINWHY_FFMPEG, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]) {
    if (executable) try { await access(executable, constants.X_OK); return executable; } catch { /* Try the next installed runtime. */ }
  }
  throw new Error("export_runtime_unavailable");
}
export async function queueExport(input: PresentationExport) {
  const request = ExportRequest.parse(input);
  if (!hasValues(request.presentation)) throw new Error("export_has_no_values");
  const ffmpeg = await ffmpegPath();
  const id = createHash("sha256").update(`presentation-v${PRESENTATION_RENDERER_VERSION}:` + JSON.stringify(request)).digest("hex").slice(0, 32);
  const previous = await readExport(id).catch(() => null);
  if (previous && previous.status !== "failed") return previous;
  await mkdir(exportRoot(), { recursive: true });
  const lockPath = path.join(exportRoot(), "render.lock");
  let lock;
  try { lock = await open(lockPath, "wx"); }
  catch { throw new Error("export_busy"); }
  await lock.writeFile(JSON.stringify({ id, createdAt: new Date().toISOString() })); await lock.close();
  const directory = exportDirectory(id);
  try {
    await mkdir(directory, { recursive: true });
    const now = new Date().toISOString();
    const job: PresentationJob = { id, status: "queued", progress: 0, createdAt: now, updatedAt: now, request };
    await writeFile(path.join(directory, "job.tmp.json"), JSON.stringify(job));
    await rename(path.join(directory, "job.tmp.json"), path.join(directory, "job.json"));
    const log = await open(path.join(directory, "render.log"), "a");
    try {
      const child = spawn(process.execPath, ["--import", "tsx", path.join(process.cwd(), "scripts/render-presentation.ts"), id], { cwd: process.cwd(), env: { ...process.env, EXPLAINWHY_FFMPEG: ffmpeg }, detached: true, stdio: ["ignore", log.fd, log.fd], shell: false });
      child.once("exit", code => { if (code !== 0) void workerFailed(id); });
      await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      child.unref();
    } finally { await log.close(); }
    return job;
  } catch (error) { await rm(lockPath, { force: true }); throw error; }
}

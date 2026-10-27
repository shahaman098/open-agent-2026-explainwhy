import { readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import sharp from "sharp";
import { presentationSvg } from "../src/lib/presentation/render";
import { ExportRequest, PRESENTATION_RENDERER_VERSION, type PresentationJob } from "../src/lib/presentation/schema";

async function main() {
const id = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(id ?? "")) throw new Error("Invalid job");
const root = path.join(process.cwd(), ".local/presentation-exports"), directory = path.join(root, id);
const job: PresentationJob = JSON.parse(await readFile(path.join(directory, "job.json"), "utf8"));
const request = ExportRequest.parse(job.request), fps = 24;
const width = request.resolution === "4k" ? 3840 : 1920, height = width * 9 / 16;
const save = async () => { job.updatedAt = new Date().toISOString(); await writeFile(path.join(directory, "job.tmp.json"), JSON.stringify(job)); await rename(path.join(directory, "job.tmp.json"), path.join(directory, "job.json")); };
sharp.concurrency(2);
const output = path.join(directory, "presentation.mp4"), temporary = path.join(directory, "presentation.part.mp4");
let encoder: ReturnType<typeof spawn> | undefined;
try {
  job.status = "rendering"; await save();
  await writeFile(path.join(directory, "snapshot.json"), JSON.stringify({ ...request, rendererVersion: PRESENTATION_RENDERER_VERSION, capturedAt: job.createdAt, provenance: "on-screen dashboard values; not independently re-verified by the exporter" }, null, 2));
  await sharp(Buffer.from(presentationSvg(request, Math.min(3, request.duration / 2), width, height))).jpeg({ quality: 90 }).toFile(path.join(directory, "poster.jpg"));
  encoder = spawn(process.env.EXPLAINWHY_FFMPEG || "/opt/homebrew/bin/ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-an", "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-vf", "setsar=1", "-movflags", "+faststart", "-metadata", `title=${request.presentation.title}`, temporary], { stdio: ["pipe", "ignore", "inherit"], shell: false });
  // Attach immediately so failures cannot leave a full input pipe waiting forever.
  const done = new Promise<void>((resolve, reject) => { encoder!.once("error", reject); encoder!.once("exit", code => code === 0 ? resolve() : reject(new Error("Video encoder failed"))); });
  void done.catch(() => {});
  let pipeError: Error | null = null;
  encoder.stdin!.on("error", error => { pipeError = error; });
  const deadline = setTimeout(() => encoder?.kill("SIGTERM"), 300_000);
  try {
    for (let n = 0; n < request.duration * fps; n++) {
      if (pipeError || encoder.exitCode !== null) throw pipeError ?? new Error("Encoder stopped");
      const buffer = await sharp(Buffer.from(presentationSvg(request, n / fps, width, height))).png({ compressionLevel: 1 }).toBuffer();
      if (!encoder.stdin!.write(buffer)) await once(encoder.stdin!, "drain");
      if (n % 12 === 0) { job.progress = Math.round(n / (request.duration * fps) * 99); await save(); }
    }
    encoder.stdin!.end(); await done;
  } finally { clearTimeout(deadline); }
  await rename(temporary, output); job.status = "complete"; job.progress = 100; await save();
} catch {
  encoder?.kill("SIGTERM"); await rm(temporary, { force: true }); job.status = "failed"; job.error = "The video could not be rendered. Your source chart is unchanged. Retry the export."; await save();
} finally { await rm(path.join(root, "render.lock"), { force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

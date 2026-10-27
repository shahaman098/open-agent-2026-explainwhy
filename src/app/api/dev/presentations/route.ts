import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { z } from "zod";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { apiError } from "@/lib/api";
import { ExportRequest } from "@/lib/presentation/schema";
import { exportDirectory, queueExport, readExport } from "@/lib/presentation/store";
const Query = z.object({ id: z.string().regex(/^[a-f0-9]{32}$/), businessId: z.string().regex(/^[a-z0-9_]{1,64}$/), simulationRunId: z.string().regex(/^[a-z0-9_]{1,64}$/), download: z.enum(["video", "data", "poster"]).optional() });
export async function POST(request: Request) {
  const denied = guardDevRoute(request); if (denied) return denied;
  const origin = request.headers.get("origin"), url = new URL(request.url);
  if (origin && origin !== url.origin && origin !== `${url.protocol}//${request.headers.get("host")}`) return apiError("invalid_origin", "Export from the dashboard", 403);
  try {
    if (Number(request.headers.get("content-length")) > 256000) return apiError("too_large", "Choose fewer chart points", 413);
    const raw = await request.text(); if (Buffer.byteLength(raw) > 256000) return apiError("too_large", "Choose fewer chart points", 413);
    const input = ExportRequest.parse(JSON.parse(raw));
    const job = await queueExport(input);
    return Response.json({ id: job.id, status: job.status, progress: job.progress, error: job.error }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "export_busy") return apiError("export_busy", "Another presentation is exporting. Try again when it finishes.", 409);
    if (error instanceof Error && error.message === "export_runtime_unavailable") return apiError("export_unavailable", "Video export is unavailable on this host. The animated preview is ready to present.", 503);
    if (error instanceof Error && error.message === "export_has_no_values") return apiError("no_data", "This chart has no observed values to export", 400);
    if (error instanceof SyntaxError) return apiError("invalid_json", "Invalid presentation", 400);
    return handleRouteError(error, "presentation/create");
  }
}
export async function GET(request: Request) {
  const denied = guardDevRoute(request); if (denied) return denied;
  try {
    const query = Query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const job = await readExport(query.id).catch(() => null);
    if (!job || job.request.scope.businessId !== query.businessId || job.request.scope.simulationRunId !== query.simulationRunId) return apiError("not_found", "Export not found in this run", 404);
    if (!query.download) return Response.json({ id: job.id, status: job.status, progress: job.progress, error: job.error }, { headers: { "Cache-Control": "no-store" } });
    if (job.status !== "complete") return apiError("not_ready", "The presentation is still exporting", 409);
    const name = query.download === "video" ? "presentation.mp4" : query.download === "poster" ? "poster.jpg" : "snapshot.json";
    const file = path.join(exportDirectory(job.id), name), info = await stat(file);
    const type = query.download === "video" ? "video/mp4" : query.download === "poster" ? "image/jpeg" : "application/json";
    const filename = `${job.request.presentation.title.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 70)}-${job.request.resolution}.${name.split(".").at(-1)}`;
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { "Content-Type": type, "Content-Length": String(info.size), "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return handleRouteError(error, "presentation/read"); }
}

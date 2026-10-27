import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { apiError, readJson } from "@/lib/api";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { AnalysisScope } from "@/intelligence/dashboard/schema";
import { analysisView, localAnalysisConfig, retryAnalysis, watchAnalysis } from "@/intelligence/dashboard/store";
const scopeFrom = (request: Request) => AnalysisScope.parse(Object.fromEntries(new URL(request.url).searchParams));
export async function GET(request: Request) {
  const denied = guardDevRoute(request); if (denied) return denied;
  try { return Response.json(await analysisView(await getDb(), scopeFrom(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleRouteError(error, "dashboard-analysis/read"); }
}
export async function POST(request: Request) {
  const denied = guardDevRoute(request); if (denied) return denied;
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return apiError("invalid_origin", "Use this app to configure local analysis", 403);
  try {
    const scope = scopeFrom(request), input = z.object({ action: z.enum(["watch", "retry"]) }).strict().parse(await readJson(request));
    try { localAnalysisConfig(); } catch { return apiError("local_model_required", "Configure local Nemotron to enable automatic analysis", 503); }
    const db = await getDb(); await watchAnalysis(db, scope);
    if (input.action === "retry") await retryAnalysis(db, scope);
    return Response.json(await analysisView(db, scope), { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "analysis_run_not_found") return apiError("not_found", "Run not found in this business", 404);
    return handleRouteError(error, "dashboard-analysis/watch");
  }
}

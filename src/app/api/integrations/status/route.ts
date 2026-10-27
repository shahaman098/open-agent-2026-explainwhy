import { guardDevRoute } from "@/lib/route-helpers";
import { zetarisStatus } from "@/integrations/zetaris/config";
import { HMEM_UPSTREAM } from "@/integrations/meterless/history";

export async function GET(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  return Response.json({
    meterless: { implemented: true, engine: "H-MEM reference", upstreamCommit: HMEM_UPSTREAM, path: "historical_incidents", limits: "Deterministic reference embeddings; prior history is context only. No Nightshift or local inference claim." },
    zetaris: { ...zetarisStatus(), path: "zetaris_campaign_analysis", liveQueryVerified: false, note: "Configuration status only. Each evidence collection records its own actual query receipt and canonical validation." },
  });
}

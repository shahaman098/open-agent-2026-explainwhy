import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BusinessEvent } from "@explainwhy/contracts";
import { getDb } from "@/lib/mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import type { EvidenceDetailDoc } from "@/intelligence/evidence/persistence";
import type { MemoryRecall } from "@/integrations/meterless/history";
import { zetarisStatus, zetarisConfig } from "@/integrations/zetaris/config";
import { campaignQuery, verifyCampaignRows } from "@/integrations/zetaris/campaigns";
import { queryZetaris } from "@/integrations/zetaris/client";
import { ANIMATIONS, type AnimationDoc } from "@/integrations/animation-studio/store";
import { readStudioJob } from "@/integrations/animation-studio/client";

const Scope = z.object({ businessId: z.string().regex(/^[a-z0-9_]{1,64}$/), simulationRunId: z.string().regex(/^[a-z0-9_]{1,64}$/) });

export async function GET(request: Request) {
  const denied = guardDevRoute(request); if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const scope = Scope.parse({ businessId: params.get("businessId"), simulationRunId: params.get("simulationRunId") });
    const db = await getDb();
    const details = db.collection<EvidenceDetailDoc>(COLLECTIONS.evidenceDetails);
    const [lastZetaris, lastHistory, animation, memories] = await Promise.all([
      details.findOne({ ...scope, tool: "zetaris_campaign_analysis", "verification.passed": true }, { sort: { retrievedAt: -1 } }),
      details.findOne({ ...scope, tool: "historical_incidents", "detail.hmem.contextOnly": true, "verification.passed": true }, { sort: { retrievedAt: -1 } }),
      db.collection<AnimationDoc>(ANIMATIONS).findOne(scope, { sort: { createdAt: -1 } }),
      db.collection(COLLECTIONS.meterlessMemories).countDocuments(scope),
    ]);
    const hmem = lastHistory?.detail.hmem as MemoryRecall | undefined;
    const evidence = lastZetaris ? await details.find({ ...scope, tool: "zetaris_campaign_analysis", investigationId: lastZetaris.investigationId, "verification.passed": true }).limit(20).toArray() : [];
    let live: { status: "unchecked" | "passed" | "failed"; rows?: number; campaigns?: number; checkedAt?: string; requestId?: string; cursorClosed?: boolean } = { status: "unchecked" };
    if (params.get("probe") === "1") {
      try {
        if (!lastZetaris) throw new Error("No verified scope");
        const window = z.object({ startAt: z.string().datetime(), endAt: z.string().datetime() }).parse(lastZetaris.input.window);
        const queryScope = { ...scope, window, campaignIds: [] };
        const result = await queryZetaris(campaignQuery(queryScope, zetarisConfig()));
        const events = await db.collection(COLLECTIONS.businessEvents).find({ ...scope, type: "ad.metrics_observed", "payload.window.startAt": { $gte: window.startAt }, "payload.window.endAt": { $lte: window.endAt } }, { projection: { _id: 0 } }).limit(5001).toArray();
        const rows = verifyCampaignRows(result.records, events.map(event => BusinessEvent.parse(event)), queryScope);
        if (!rows.length || !result.receipt.closed) throw new Error("No completed verification");
        live = { status: "passed", rows: rows.length, campaigns: new Set(rows.map(row => row.campaign_id)).size, checkedAt: result.receipt.fetchedAt, requestId: result.receipt.requestId, cursorClosed: result.receipt.closed };
      } catch { live = { status: "failed", checkedAt: new Date().toISOString() }; }
    }
    const job = animation?.studioJobId ? await readStudioJob(animation.studioJobId).catch(() => null) : null;
    const docker = await readFile(path.join(process.cwd(), ".local/docker-status.json"), "utf8").then(text => z.object({ capturedAt: z.string().datetime(), output: z.string().max(10000) }).parse(JSON.parse(text))).catch(() => null);
    return Response.json({ checkedAt: new Date().toISOString(), scope, synthetic: true, docker,
      zetaris: { configured: zetarisStatus().configured, live, verifiedRecords: evidence.length, verifiedObservations: evidence.reduce((sum, item) => sum + Number(item.detail.verifiedObservations ?? 0), 0), investigationId: lastZetaris?.investigationId ?? null, verifiedAt: lastZetaris?.retrievedAt ?? null, evidenceIds: evidence.map(item => item.evidenceId) },
      meterless: { engine: hmem?.engine ?? "Meterless H-MEM reference", verified: !!hmem?.memories.length && hmem.ledger.some(item => item.action === "read"), storedReports: memories, recalled: hmem?.memories.length ?? 0, contextOnly: true, investigationId: lastHistory?.investigationId ?? null, verifiedAt: lastHistory?.retrievedAt ?? null, context: hmem?.memories.map(item => ({ id: item.id, content: item.content, source: item.source, refs: item.provenance?.refs ?? [] })) ?? [], ledger: hmem?.ledger ?? [] },
      animation: { status: job?.status ?? "unavailable", video: job?.video ?? null, investigationId: animation?.investigationId ?? null, evidenceId: animation?.packet.provenance.evidenceId ?? null, metric: animation?.packet.provenance.metric ?? null },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error, "integrations/status"); }
}

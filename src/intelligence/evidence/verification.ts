import "server-only";
import type { Db } from "mongodb";
import { Evidence, type EvidenceT } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import { getReferenceCatalogue, getReferenceFinancials } from "@/reference/service";
import { REFERENCE_FINANCIALS, REFERENCE_PRODUCTS } from "./tools/public-context";
import type { EvidenceDraft } from "./types";

export interface VerificationCheck { name: string; passed: boolean; note: string }
export interface Verification { passed: boolean; checks: VerificationCheck[]; resolvedSources: number; unresolvedSources: string[] }

const MAX_DETAIL_BYTES = 200_000;
const RUN_SCOPED = new Set<string>([COLLECTIONS.businessEvents, COLLECTIONS.metricSnapshots, COLLECTIONS.incidents]);

/** Resolves every source reference against the real store, scoped to the business (and run where the collection is run-scoped). */
export async function resolveSources(db: Db, scope: { businessId: string; simulationRunId: string }, refs: EvidenceDraft["sourceRecords"]): Promise<{ resolved: number; unresolved: string[] }> {
  const byCollection = new Map<string, Set<string>>();
  for (const r of refs) { if (!byCollection.has(r.collection)) byCollection.set(r.collection, new Set()); byCollection.get(r.collection)!.add(r.recordId); }
  const unresolved: string[] = [];
  let resolved = 0;
  for (const [collection, ids] of byCollection) {
    const wanted = [...ids];
    let found: Set<string>;
    const idField: Record<string, string> = { [COLLECTIONS.businessEvents]: "eventId", [COLLECTIONS.metricSnapshots]: "snapshotId", [COLLECTIONS.investigations]: "investigationId", [COLLECTIONS.incidents]: "incidentId", [COLLECTIONS.anomalies]: "anomalyId" };
    if (collection === REFERENCE_PRODUCTS) found = new Set((await getReferenceCatalogue(db)).products.map((p) => p.referenceProductId));
    else if (collection === REFERENCE_FINANCIALS) found = new Set((await getReferenceFinancials(db)).records.map((r) => r.referenceId));
    else if (idField[collection]) {
      const field = idField[collection];
      // `collection` is one of the COLLECTIONS values enumerated in idField above; nothing caller-supplied reaches here.
      const docs = await db.collection(collection)
        .find({ businessId: scope.businessId, ...(RUN_SCOPED.has(collection) ? { simulationRunId: scope.simulationRunId } : {}), [field]: { $in: wanted } }, { projection: { _id: 0, [field]: 1 } }).toArray();
      found = new Set(docs.map((d) => d[field] as string));
    } else { for (const id of wanted) unresolved.push(`${collection}:${id} (unknown collection)`); continue; }
    for (const id of wanted) { if (found.has(id)) resolved++; else unresolved.push(`${collection}:${id}`); }
  }
  return { resolved, unresolved };
}

export async function verifyEvidence(db: Db, scope: { businessId: string; simulationRunId: string; cutoff: string }, draft: EvidenceDraft, evidence: EvidenceT): Promise<Verification> {
  const checks: VerificationCheck[] = [];
  const parsed = Evidence.safeParse(evidence);
  checks.push({ name: "canonical_schema", passed: parsed.success, note: parsed.success ? "Evidence validates against @normal/contracts" : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; ") });
  const sources = await resolveSources(db, scope, draft.sourceRecords);
  checks.push({ name: "source_records_resolve", passed: sources.unresolved.length === 0 && draft.sourceRecords.length > 0, note: `${sources.resolved}/${draft.sourceRecords.length} references found${sources.unresolved.length ? `; missing ${sources.unresolved.slice(0, 3).join(", ")}` : ""}` });
  const finite = draft.measurements.every((m) => Number.isFinite(m.value) && (m.baseline === undefined || Number.isFinite(m.baseline)));
  checks.push({ name: "measurements_finite", passed: finite, note: finite ? `${draft.measurements.length} measurements are finite numbers` : "A measurement is not a finite number" });
  const windowOk = !draft.window || (draft.window.endAt > draft.window.startAt && draft.window.endAt <= scope.cutoff);
  checks.push({ name: "window_within_cutoff", passed: windowOk, note: draft.window ? `${draft.window.startAt} → ${draft.window.endAt} (cutoff ${scope.cutoff})` : "no time window (reference or historical evidence)" });
  const bytes = Buffer.byteLength(JSON.stringify(draft.detail));
  checks.push({ name: "bounded_detail", passed: bytes <= MAX_DETAIL_BYTES, note: `${bytes} bytes of detail` });
  const labelled = draft.dataOrigin !== "simulated" || /simulat/i.test(`${draft.observation} ${draft.warnings.join(" ")}`);
  checks.push({ name: "origin_labelled", passed: labelled, note: `data origin ${draft.dataOrigin}${draft.dataOrigin === "simulated" ? (labelled ? ", stated in the observation" : ", NOT stated") : ""}` });
  const nonCausal = !/\b(caused by|because of|due to|root cause is)\b/i.test(draft.observation);
  checks.push({ name: "no_causal_claim", passed: nonCausal, note: nonCausal ? "observation states what changed, not why" : "observation contains causal language" });
  return { passed: checks.every((c) => c.passed), checks, resolvedSources: sources.resolved, unresolvedSources: sources.unresolved };
}

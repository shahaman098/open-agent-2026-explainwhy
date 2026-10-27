// Live Nemotron check on a prepared incident's verified evidence, with NO Gemini/Mubit diagnosis.
// The blind judge sees only candidate cause codes and evidence. Candidate statements for the reward model are
// operator-authored, neutral mechanism descriptions and are labelled as such in the saved record.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { COLLECTIONS } from "../src/lib/collections";
import { loadVerifiedEvidence } from "../src/intelligence/investigator/validation";
import { verifyDiagnosis } from "../src/integrations/nemotron/verifier";
import type { DiagnosisModelOutputT } from "@explainwhy/contracts";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const [simulationRunId, investigationId] = [process.argv[2], process.argv[3]];
const CANDIDATES: Array<[DiagnosisModelOutputT["hypotheses"][number]["cause"], string]> = [
  ["discount_failure", "A promotion or coupon code fails at checkout, so shoppers who try it do not complete their orders."],
  ["ad_fatigue", "An advertising audience is over-exposed, so the campaign attracts fewer clicks and fewer shoppers."],
  ["delivery_delays", "Late deliveries make customers less willing to buy again."],
];
async function main() {
  if (!simulationRunId || !investigationId) throw new Error("usage: smoke-nemotron.ts <runId> <investigationId>");
  const db = await getDb();
  const scope = { businessId: "nike_demo", simulationRunId, investigationId };
  const ids = (await db.collection(COLLECTIONS.evidence).find({ businessId: scope.businessId, simulationRunId, investigationId }, { projection: { _id: 0, evidenceId: 1 } }).toArray()).map((e) => e.evidenceId as string);
  const packet = await loadVerifiedEvidence(db, scope, ids, new Date().toISOString());
  const all = packet.evidence.map((e) => e.evidenceId);
  const candidate: DiagnosisModelOutputT = { primaryCause: "unknown", requiresReview: true, summary: "Smoke test candidates", missingEvidence: [],
    hypotheses: CANDIDATES.map(([cause, explanation]) => ({ cause, strength: "moderate", explanation, evidenceIds: all, counterEvidenceIds: [] })) };
  const verification = await verifyDiagnosis(candidate, packet.evidence);
  const record = { kind: "nemotron_smoke_test", note: "Nemotron judged the recorded deterministic evidence directly; no Gemini/Mubit investigation was run. Reward-scored statements are operator-authored neutral candidates.",
    ...scope, verifiedEvidenceIds: all, excludedEvidence: packet.limitations, candidates: CANDIDATES.map(([cause, statement]) => ({ cause, statement })), verification };
  mkdirSync("docs/proof-moments", { recursive: true });
  const path = `docs/proof-moments/nemotron-smoke-${simulationRunId}.json`;
  writeFileSync(path, JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ path, status: verification.status, bestSupportedCause: verification.bestSupportedCause, verdicts: verification.assessments.map((a) => `${a.cause}:${a.verdict}`), rewardTopCause: verification.rewardTopCause, receipts: verification.receipts.map((r) => `${r.task}:${r.status}${r.error ? `(${r.error})` : ""}`) }, null, 2));
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : "Smoke test failed"); process.exitCode = 1; }).finally(async () => { if (globalThis._explainwhyMongoClientPromise) await (await getMongoClient()).close(); });

import "server-only";
import { createHash } from "node:crypto";
import type { ClientSession, Db } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import type { ReportT, ScopeT } from "@/intelligence/investigator/schemas";
import type { HistoricalMemory } from "./history";

export function reportMemory(scope: ScopeT & { cutoff: string }, report: ReportT): HistoricalMemory {
  if (report.investigationId !== scope.investigationId || report.diagnosis.businessId !== scope.businessId) throw new Error("Memory report does not match its source scope");
  return {
    businessId: scope.businessId, simulationRunId: scope.simulationRunId, investigationId: scope.investigationId,
    reportId: report.reportId, availableAt: report.createdAt, observedThrough: scope.cutoff,
    title: report.executiveBrief.whatChanged.slice(0, 500), summaries: [report.diagnosis.summary],
    metrics: report.impact.metric ? [report.impact.metric] : [], themes: report.diagnosis.hypotheses.map((hypothesis) => hypothesis.cause),
  };
}

/** Immutable per-report capture; invoked in the same transaction that publishes a validated report. */
export async function captureReportMemory(db: Db, scope: ScopeT & { cutoff: string }, report: ReportT, session?: ClientSession) {
  const memory = reportMemory(scope, report);
  const id = createHash("sha256").update(JSON.stringify([scope.businessId, scope.simulationRunId, report.reportId])).digest("hex");
  await db.collection<HistoricalMemory & { _id: string }>(COLLECTIONS.meterlessMemories).updateOne({ _id: id }, { $setOnInsert: { ...memory, _id: id } }, { upsert: true, ...(session ? { session } : {}) });
}

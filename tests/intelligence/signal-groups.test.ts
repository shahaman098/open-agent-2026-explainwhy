import { describe, expect, it } from "vitest";
import type { AnomalyT } from "@normal/contracts";
import { groupSignalObservations, type SignalObservationInput } from "@/intelligence/signals/grouping";

const window = (hour: number) => ({ startAt: `2026-10-04T${String(hour).padStart(2, "0")}:00:00.000Z`, endAt: `2026-10-04T${String(hour + 1).padStart(2, "0")}:00:00.000Z` });
function observation(id: string, options: Partial<Pick<SignalObservationInput, "businessId" | "simulationRunId" | "signalId" | "signalLabel" | "theme" | "segment" | "segmentLabel" | "entityName" | "incident" | "investigation">> & { metric?: AnomalyT["metric"]; change?: number; hour?: number; severity?: AnomalyT["severity"] } = {}): SignalObservationInput {
  const currentWindow = window(options.hour ?? 8);
  return {
    businessId: options.businessId ?? "nike_demo", simulationRunId: options.simulationRunId ?? "run_a",
    anomaly: {
      schemaVersion: 1, businessId: options.businessId ?? "nike_demo", anomalyId: id, metric: options.metric ?? "ctr",
      direction: (options.change ?? -58) < 0 ? "decrease" : "increase", severity: options.severity ?? "medium",
      currentWindow, baselineWindow: window(0), actualValue: options.change === -82.4 ? 0.004 : 0.4,
      baselineValue: 0.94, changePercent: options.change ?? -58, sourceSnapshotIds: [`snapshot_${id}`],
      detectorVersion: "test", status: "investigating", detectedAt: currentWindow.endAt,
    } as AnomalyT,
    signalId: options.signalId ?? "advertising_ctr", signalLabel: options.signalLabel ?? "Ad click-through rate",
    theme: options.theme ?? "advertising", segment: options.segment ?? { kind: "campaign", id },
    segmentLabel: options.segmentLabel ?? null, entityName: options.entityName ?? id,
    incident: options.incident === undefined ? { incidentId: "incident_1", title: "Advertising CTR deterioration", summary: "CTR declined across campaigns.", status: "investigating", primaryTheme: "advertising", investigationId: "investigation_1", severity: { level: "high", score: 80 }, onsetAt: currentWindow.startAt, lastTriggeredAt: currentWindow.endAt, resolvedAt: null } : options.incident,
    investigation: options.investigation === undefined ? { investigationId: "investigation_1", title: "Investigate advertising decline", status: "collecting_evidence" } : options.investigation,
  };
}

describe("groupSignalObservations", () => {
  it("groups five campaigns with an exact business aggregate without averaging percentages", () => {
    const campaigns = ["mercurial", "sportswear", "basketball", "air_force", "pegasus"].map((id, index) => observation(id, { change: [-58, -75.2, -75.5, -78.1, -85.5][index], hour: 8 + index }));
    const aggregate = observation("whole_business", { segment: { kind: "global" }, entityName: "Whole business", change: -82.4, severity: "high", hour: 14 });
    const [group] = groupSignalObservations([...campaigns, aggregate]);
    expect(group.campaignCount).toBe(5);
    expect(group.observationCount).toBe(6);
    expect(group.aggregateObservationId).toBe("whole_business");
    expect(group.headline.changePercent).toBe(-82.4);
    expect(group.headline.changePercent).not.toBe(campaigns.reduce((sum, item) => sum + item.anomaly.changePercent, 0) / campaigns.length);
    expect(group.severity).toBe("high");
    expect(group.observations.map((item) => item.anomalyId)).toContain("whole_business");
  });

  it("deduplicates campaign counts while preserving repeated observations", () => {
    const [group] = groupSignalObservations([observation("campaign_1_a", { segment: { kind: "campaign", id: "campaign_1" } }), observation("campaign_1_b", { segment: { kind: "campaign", id: "campaign_1" }, hour: 10 })]);
    expect(group.campaignCount).toBe(1);
    expect(group.observationCount).toBe(2);
  });

  it("keeps unrelated incidents and different business/run scopes distinct", () => {
    const base = observation("one");
    const otherIncident = observation("two", { incident: { ...base.incident!, incidentId: "incident_2" } });
    const otherBusiness = observation("three", { businessId: "other", incident: { ...base.incident!, incidentId: "incident_1" } });
    const otherRun = observation("four", { simulationRunId: "run_b", incident: { ...base.incident!, incidentId: "incident_1" } });
    expect(groupSignalObservations([base, otherIncident, otherBusiness, otherRun])).toHaveLength(4);
  });

  it("splits metrics inside one incident and does not join unlinked observations by metric", () => {
    const first = observation("ctr");
    const revenue = observation("revenue", { metric: "revenue_minor" });
    const unlinkedA = observation("unlinked_a", { incident: null, investigation: null });
    const unlinkedB = observation("unlinked_b", { incident: null, investigation: null });
    expect(groupSignalObservations([first, revenue, unlinkedA, unlinkedB])).toHaveLength(4);
  });

  it("prefers incident status and severity while retaining child values and fallback severity", () => {
    const low = observation("low", { severity: "low" });
    const [group] = groupSignalObservations([low]);
    expect(group.severity).toBe("high");
    expect(group.status).toBe("investigating");
    expect(group.observations[0].severity).toBe("low");
    expect(groupSignalObservations([observation("fallback", { incident: null, investigation: null, severity: "critical" })])[0].severity).toBe("critical");
  });

  it("uses the strongest observation when no valid business aggregate exists", () => {
    const [group] = groupSignalObservations([observation("low", { severity: "low" }), observation("high", { severity: "high", change: -70 })]);
    expect(group.aggregateObservationId).toBeNull();
    expect(group.headline.anomalyId).toBe("high");
  });
});

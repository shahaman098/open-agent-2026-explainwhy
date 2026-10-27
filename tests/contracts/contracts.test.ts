import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ActionExecution, Anomaly, BusinessEvent, Diagnosis, Evidence, IngestBatch, Investigation,
  MetricSnapshot, ModelCorrection, PlanApproval, PlanHandoff, ProposedPlan, SimulatorRun,
  eventBusinessRules, planReferenceErrors,
} from "@normal/contracts";

const examplesDir = resolve(process.cwd(), "packages/contracts/examples");
const fixture = (name: string) => JSON.parse(readFileSync(resolve(examplesDir, name), "utf8"));

describe("@normal/contracts fixtures (Milestone 0 gate)", () => {
  const cases = [
    ["order-event.json", BusinessEvent], ["ad-event.json", BusinessEvent], ["review-event.json", BusinessEvent],
    ["metric-snapshot.json", MetricSnapshot], ["anomaly.json", Anomaly], ["investigation.json", Investigation],
    ["evidence.json", Evidence], ["diagnosis.json", Diagnosis], ["proposed-plan.json", ProposedPlan],
    ["approval.json", PlanApproval], ["execution.json", ActionExecution], ["correction.json", ModelCorrection],
    ["simulator-run.json", SimulatorRun], ["ingest-batch.json", IngestBatch], ["plan-handoff.json", PlanHandoff],
  ] as const;

  it.each(cases)("%s validates against its canonical schema", (name, schema) => {
    const result = schema.safeParse(fixture(name));
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it("every bundled fixture is covered by a validation case", () => {
    const all = readdirSync(examplesDir).filter((f) => f.endsWith(".json")).sort();
    const covered = new Set<string>([...cases.map((c) => c[0]), "diagnosis-model-output.json"]);
    expect(all.filter((f) => !covered.has(f))).toEqual([]);
  });

  it("plan-handoff fixture passes cross-record invariants", () => {
    const handoff = PlanHandoff.parse(fixture("plan-handoff.json"));
    expect(planReferenceErrors(handoff.plan, handoff.diagnosis, handoff.evidence)).toEqual([]);
  });
});

describe("BusinessEvent strictness", () => {
  const base = fixture("order-event.json");

  it("rejects unknown event types such as session.started", () => {
    const bad = { ...fixture("order-event.json"), type: "session.started" };
    expect(BusinessEvent.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown top-level keys (dataOrigin) and unknown payload keys", () => {
    expect(BusinessEvent.safeParse({ ...base, dataOrigin: "simulated" }).success).toBe(false);
    expect(BusinessEvent.safeParse({ ...base, payload: { ...base.payload, lineItems: [] } }).success).toBe(false);
  });

  it("accepts all 13 canonical event type names", () => {
    const options = BusinessEvent.options.map((o) => o.shape.type.value).sort();
    expect(options).toEqual([
      "ad.metrics_observed", "campaign.budget_updated", "checkout.failed", "customer.message_sent",
      "delivery.status_changed", "inventory.level_changed", "order.completed", "order.refunded",
      "promotion.created", "review.created", "social.mention_observed", "storefront.banner_published",
      "web.session_started",
    ]);
  });

  it("eventBusinessRules flags net != gross - discount", () => {
    const ev = BusinessEvent.parse(base);
    if (ev.type !== "order.completed") throw new Error("fixture type changed");
    expect(eventBusinessRules(ev)).toEqual([]);
    const broken = { ...ev, payload: { ...ev.payload, netRevenueMinor: ev.payload.netRevenueMinor + 1 } };
    expect(eventBusinessRules(BusinessEvent.parse(broken))).toHaveLength(1);
  });
});

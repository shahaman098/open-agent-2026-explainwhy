import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { chartOptions, financialAnimation, type ChartEvidence } from "@/integrations/animation-studio/scene";
import { AnimationError, publicStudioJob, readStudioJob, studioBase, submitAnimation } from "@/integrations/animation-studio/client";
import { queueAnimation, type AnimationDoc } from "@/integrations/animation-studio/store";

const scope = { businessId: "test", simulationRunId: "run_1", investigationId: "inv_1" };
const item = (value = 75000, baseline = 100000): ChartEvidence => ({ simulationRunId: "run_1", dataOrigin: "simulated", verification: { passed: true },
  evidence: { schemaVersion: 1, businessId: "test", investigationId: "inv_1", evidenceId: "ev_revenue", category: "sales", title: "Observed revenue comparison", observation: "Synthetic observations", measurements: [{ metric: "revenue_minor", value, baseline, unit: "GBP minor units" }], sourceRecords: [{ collection: "events", recordId: "source_1" }], retrievedAt: "2026-10-27T12:00:00.000Z" } });
beforeEach(() => { vi.stubEnv("EXPLAINWHY_ANIMATION_ENABLED", "true"); vi.stubEnv("ANIMATION_STUDIO_BASE_URL", "http://127.0.0.1:8765"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("verified financial animation compiler", () => {
  it("preserves exact figures and provenance, scales from zero and produces a deterministic identifier", () => {
    const input = item(), before = JSON.stringify(input), packet = financialAnimation(scope, input, "revenue_minor");
    expect(packet.provenance).toMatchObject({ value: 75000, baseline: 100000, ...scope, evidenceId: "ev_revenue", dataOrigin: "simulated" });
    const parts = packet.scene.assets[0].parts;
    expect(parts.find((p) => p.id === "bar_0")?.size).toEqual([1.8, 0.8, 4]);
    expect(parts.find((p) => p.id === "bar_1")?.size).toEqual([1.8, 0.8, 3]);
    expect(parts.find((p) => p.id === "value_1")?.text).toBe("GBP 750.00");
    expect(parts.find((p) => p.id === "origin")?.text).toContain("SYNTHETIC");
    expect(financialAnimation(scope, input, "revenue_minor").animationId).toBe(packet.animationId);
    expect(financialAnimation(scope, item(60000), "revenue_minor").animationId).not.toBe(packet.animationId);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("shows negative values below zero, zero without an invented bar, and exact currency cents", () => {
    const packet = financialAnimation(scope, item(-101, 0), "revenue_minor"), parts = packet.scene.assets[0].parts;
    expect(parts.some((p) => p.id === "bar_0")).toBe(false);
    expect(parts.find((p) => p.id === "bar_1")?.position).toEqual([3, 0, -2]);
    expect(parts.find((p) => p.id === "value_1")?.text).toBe("GBP -1.01");
  });
  it("rejects unverified/public-context/cross-tenant and nonfinite measurements", () => {
    for (const input of [{ ...item(), verification: null }, { ...item(), dataOrigin: "public_reference" }, item(Infinity)]) expect(chartOptions([input])).toEqual([]);
    expect(() => financialAnimation({ ...scope, businessId: "other" }, item(), "revenue_minor")).toThrow("animation_scope_mismatch");
    expect(() => financialAnimation(scope, { ...item(), simulationRunId: "other" }, "revenue_minor")).toThrow("animation_scope_mismatch");
    const duplicate = item(); duplicate.evidence.measurements.push(duplicate.evidence.measurements[0]);
    expect(() => financialAnimation(scope, duplicate, "revenue_minor")).toThrow("animation_ambiguous_metric");
  });
});
describe("Animation Studio boundary", () => {
  it.each(["http://example.com", "http://127.0.0.1:8765/path", "http://user:password@127.0.0.1:8765", "http://127.0.0.1:8765/?secret=x"])("rejects endpoint %s", (base) => {
    vi.stubEnv("ANIMATION_STUDIO_BASE_URL", base); expect(studioBase).toThrow();
  });
  it("uses the per-launch token and the existing data-only endpoint", async () => {
    const packet = financialAnimation(scope, item(), "revenue_minor"), transport = vi.fn().mockResolvedValueOnce(Response.json({ token: "test-session-token-only", ready: true }))
      .mockResolvedValueOnce(Response.json({ id: "0123456789abcdef", status: "queued" }, { status: 202 }));
    expect(await submitAnimation(packet, transport)).toMatchObject({ status: "queued" });
    const [url, request] = transport.mock.calls[1];
    expect(url).toBe("http://127.0.0.1:8765/api/jobs/from-scene"); expect(request.headers["X-Orbit-Token"]).toBe("test-session-token-only");
    expect(JSON.parse(request.body)).toMatchObject({ scene: packet.scene, reviews: 0 });
    expect(JSON.stringify(packet)).not.toContain("test-session-token-only");
  });
  it("distinguishes a busy server from an ambiguous accepted submission", async () => {
    const packet = financialAnimation(scope, item(), "revenue_minor");
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ token: "test-session-token-only", ready: true })).mockResolvedValueOnce(new Response("private diagnostics", { status: 409 }));
    await expect(submitAnimation(packet, transport)).rejects.toMatchObject({ code: "animation_studio_busy", dispatched: false });
    transport.mockResolvedValueOnce(Response.json({ token: "test-session-token-only", ready: true })).mockRejectedValueOnce(new Error("timeout after submit"));
    await expect(submitAnimation(packet, transport)).rejects.toMatchObject({ code: "animation_submission_outcome_unknown", dispatched: true });
  });
  it("rejects status replies for a different job and external/traversing artifact URLs", async () => {
    await expect(readStudioJob("0123456789abcdef", vi.fn().mockResolvedValue(Response.json({ id: "1111111111111111", status: "complete" })))).rejects.toThrow("animation_status_unavailable");
    expect(publicStudioJob({ id: "0123456789abcdef", status: "complete", video: "https://evil.example/video", blend: "/artifacts/0123456789abcdef/../secret" })).toMatchObject({ video: null, blend: null });
  });
});
function database() {
  const rows = new Map<string, AnimationDoc>();
  const collection = { findOne: async (filter: Record<string, unknown>) => {
    const row = rows.get(filter._id as string); return row && Object.entries(filter).every(([k, v]) => row[k as keyof AnimationDoc] === v) ? row : null;
  }, insertOne: async (doc: AnimationDoc) => { if (rows.has(doc._id)) throw { code: 11000 }; rows.set(doc._id, structuredClone(doc)); },
  updateOne: async (filter: Record<string, unknown>, update: { $set: Partial<AnimationDoc> }) => { const row = await collection.findOne(filter); if (!row) return { modifiedCount: 0 }; Object.assign(row, update.$set); return { modifiedCount: 1 }; } };
  return { db: { collection: () => collection } as unknown as Db, rows };
}
describe("render submission ledger", () => {
  it("deduplicates concurrent requests and preserves the evidence packet", async () => {
    const { db, rows } = database(), packet = financialAnimation(scope, item(), "revenue_minor"), submit = vi.fn().mockResolvedValue({ id: "0123456789abcdef", status: "queued" });
    await Promise.all([queueAnimation(db, scope, packet, submit), queueAnimation(db, scope, packet, submit)]);
    expect(submit).toHaveBeenCalledTimes(1); expect(rows.get(packet.animationId)?.packet.provenance.value).toBe(75000);
    expect((await queueAnimation(db, scope, packet, submit)).studioJobId).toBe("0123456789abcdef"); expect(submit).toHaveBeenCalledTimes(1);
  });
  it("does not repeat an uncertain submission, but permits retry after a definite pre-submit failure", async () => {
    const { db } = database(), packet = financialAnimation(scope, item(), "revenue_minor"), submit = vi.fn().mockRejectedValue(new AnimationError("outcome_unknown", true));
    expect((await queueAnimation(db, scope, packet, submit)).status).toBe("unknown");
    await queueAnimation(db, scope, packet, submit); expect(submit).toHaveBeenCalledTimes(1);
    const fresh = database(), offline = vi.fn().mockRejectedValueOnce(new AnimationError("unavailable")).mockResolvedValue({ id: "0123456789abcdef", status: "queued" });
    expect((await queueAnimation(fresh.db, scope, packet, offline)).status).toBe("failed");
    expect((await queueAnimation(fresh.db, scope, packet, offline)).status).toBe("submitted"); expect(offline).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/investigations/[id]/animation/route";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), evidence: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb, describeDbError: () => "database failure" }));
vi.mock("@/intelligence/evidence/queries", () => ({ listInvestigationEvidence: mocks.evidence }));
vi.mock("@/integrations/animation-studio/store", () => ({ ANIMATIONS: "financial_animations", queueAnimation: mocks.queue }));
const ctx = { params: Promise.resolve({ id: "inv_1" }) };
const url = "http://localhost:3118/api/investigations/inv_1/animation?businessId=test&simulationRunId=run_1";
const item = { simulationRunId: "run_1", dataOrigin: "simulated", verification: { passed: true }, evidence: { schemaVersion: 1, businessId: "test", investigationId: "inv_1", evidenceId: "ev_1", title: "Revenue fixture", category: "sales", observation: "Fixture only", measurements: [{ metric: "revenue_minor", value: 75000, baseline: 100000, unit: "GBP minor units" }], sourceRecords: [{ collection: "fixture", recordId: "row" }], retrievedAt: "2026-10-27T12:00:00.000Z" } };
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("EXPLAINWHY_ANIMATION_ENABLED", "true"); vi.stubEnv("ANIMATION_STUDIO_BASE_URL", "http://127.0.0.1:8765");
  mocks.getDb.mockResolvedValue({}); mocks.evidence.mockResolvedValue({ items: [item] });
  mocks.queue.mockImplementation(async (_db, scope, packet) => ({ ...scope, _id: packet.animationId, status: "submitted", studioJobId: "0123456789abcdef", error: null, packet }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const request = (body: object, origin = "http://127.0.0.1:3118") => new Request(url, { method: "POST", headers: { host: "127.0.0.1:3118", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
it("accepts the actual browser host even when Next normalizes its internal URL to localhost", async () => {
  const response = await POST(request({ evidenceId: "ev_1", metric: "revenue_minor" }), ctx);
  expect(response.status).toBe(202); const result = await response.json();
  expect(result.animation.provenance).toMatchObject({ value: 75000, baseline: 100000 });
  expect(mocks.evidence).toHaveBeenCalledWith("inv_1", { businessId: "test", simulationRunId: "run_1", limit: 100 }, {});
});
it("rejects cross-origin submissions before accessing the database", async () => {
  expect((await POST(request({ evidenceId: "ev_1", metric: "revenue_minor" }, "https://evil.example"), ctx)).status).toBe(403);
  expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
});
it("does not accept client-supplied replacement figures or unverified comparisons", async () => {
  expect((await POST(request({ evidenceId: "ev_1", metric: "revenue_minor", value: 999999 }), ctx)).status).toBe(400);
  mocks.evidence.mockResolvedValue({ items: [{ ...item, verification: { passed: false } }] });
  expect((await POST(request({ evidenceId: "ev_1", metric: "revenue_minor" }), ctx)).status).toBe(400);
  expect(mocks.queue).not.toHaveBeenCalled();
});
it("keeps unavailable features explicit and missing investigations scoped", async () => {
  vi.stubEnv("EXPLAINWHY_ANIMATION_ENABLED", "false");
  const response = await GET(new Request(url), ctx); expect((await response.json()).enabled).toBe(false);
  vi.stubEnv("EXPLAINWHY_ANIMATION_ENABLED", "true"); mocks.evidence.mockResolvedValue(null);
  expect((await POST(request({ evidenceId: "ev_1", metric: "revenue_minor" }), ctx)).status).toBe(404);
});

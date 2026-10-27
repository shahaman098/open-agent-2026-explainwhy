import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { IngestResult, MetricSnapshot, PlanHandoff, SimulatorRun, SimulatorTickResponse } from "@normal/contracts";
import { POST as startRoute } from "@/app/api/dev/simulator/start/route";
import { POST as tickRoute } from "@/app/api/dev/simulator/tick/route";
import { POST as injectRoute } from "@/app/api/dev/simulator/inject/route";
import { GET as stateRoute } from "@/app/api/dev/simulator/state/route";
import { GET as eventsRoute } from "@/app/api/dev/simulator/events/route";
import { GET as runsRoute } from "@/app/api/dev/simulator/runs/route";
import { POST as seedPlanRoute } from "@/app/api/dev/plans/seed-fixture/route";
import { POST as ingestRoute } from "@/app/api/ingest/events/route";
import { GET as metricsRoute } from "@/app/api/metrics/route";
import { GET as breakdownRoute } from "@/app/api/metrics/breakdown/route";
import { GET as productsRoute } from "@/app/api/demo-store/products/route";
import { POST as checkoutRoute } from "@/app/api/demo-store/checkout/route";
import { GET as ordersRoute } from "@/app/api/demo-store/orders/route";
import { GET as planRoute } from "@/app/api/plans/[id]/route";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { TEST_BUSINESS, resetTestRun } from "../helpers";

const RUN = "t_routes";
const DEMO_KEY = "test-demo-key-123";
const base = `http://localhost/api`;
const biz = `businessId=${TEST_BUSINESS}`;

function req(path: string, init: RequestInit & { json?: unknown; demo?: boolean } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (init.demo) headers.set("x-normal-demo-key", DEMO_KEY);
  return new Request(`${base}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
}

describe("API routes", () => {
  beforeAll(async () => {
    await resetTestRun(RUN);
    process.env.NORMAL_DEMO_MODE = "true";
    process.env.NORMAL_DEMO_KEY = DEMO_KEY;
    delete process.env.NORMAL_INGEST_API_KEY;
  });
  afterEach(() => { process.env.NORMAL_DEMO_MODE = "true"; process.env.NORMAL_DEMO_KEY = DEMO_KEY; });
  afterAll(async () => {
    await resetTestRun(RUN);
    delete process.env.NORMAL_DEMO_MODE; delete process.env.NORMAL_DEMO_KEY;
  });

  it("dev/demo routes are hidden (404) without the demo key and when demo mode is off", async () => {
    expect(process.env.NODE_ENV).not.toBe("development");
    expect((await startRoute(req("/dev/simulator/start", { method: "POST", json: {} }))).status).toBe(404);
    expect((await stateRoute(req(`/dev/simulator/state?${biz}`))).status).toBe(404);
    expect((await tickRoute(req("/dev/simulator/tick", { method: "POST", json: {}, headers: { "x-normal-demo-key": "wrong" } }))).status).toBe(404);
    process.env.NORMAL_DEMO_MODE = "false";
    expect((await startRoute(req("/dev/simulator/start", { method: "POST", json: {}, demo: true }))).status).toBe(404);
  });

  it("start → tick → inject → state round-trip through the HTTP handlers with canonical shapes", async () => {
    const start = await startRoute(req("/dev/simulator/start", { method: "POST", demo: true, json: { businessId: TEST_BUSINESS, simulationRunId: RUN, seed: 42, reset: true } }));
    expect(start.status).toBe(201);
    const summary = await start.json();
    expect(SimulatorRun.safeParse(summary.run).success).toBe(true);

    const bad = await tickRoute(req(`/dev/simulator/tick?${biz}`, { method: "POST", demo: true, json: { simulationRunId: RUN, ticks: 999 } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("validation_error");

    const tick = await tickRoute(req(`/dev/simulator/tick?${biz}`, { method: "POST", demo: true, json: { simulationRunId: RUN, ticks: 24 }, headers: { "idempotency-key": "route-tick-1" } }));
    expect(tick.status).toBe(200);
    const tickBody = await tick.json();
    expect(SimulatorTickResponse.safeParse(tickBody).success).toBe(true);
    expect(tickBody.metricSnapshotIds).toHaveLength(24);
    const replay = await (await tickRoute(req(`/dev/simulator/tick?${biz}`, { method: "POST", demo: true, json: { simulationRunId: RUN, ticks: 24 }, headers: { "idempotency-key": "route-tick-1" } }))).json();
    expect(replay).toEqual(tickBody);

    const inject = await injectRoute(req(`/dev/simulator/inject?${biz}`, { method: "POST", demo: true, json: { simulationRunId: RUN, scenario: "viral_demand", severity: 0.6 } }));
    expect(inject.status).toBe(200);
    expect((await inject.json()).run.activeScenario).toBe("viral_demand");
    const badInject = await injectRoute(req(`/dev/simulator/inject?${biz}`, { method: "POST", demo: true, json: { simulationRunId: RUN, scenario: "viral_demand", severity: 1.5 } }));
    expect(badInject.status).toBe(400);

    const state = await stateRoute(req(`/dev/simulator/state?${biz}&simulationRunId=${RUN}`, { demo: true }));
    expect(state.status).toBe(200);
    const stateBody = await state.json();
    expect(stateBody.run.simulationRunId).toBe(RUN);
    expect(stateBody.inventory).toHaveLength(17);
    expect(stateBody.campaigns).toHaveLength(5);
    expect(JSON.stringify(stateBody)).not.toContain("scenarioParams");
    expect(JSON.stringify(stateBody)).not.toContain("viralInterestBoost");

    const events = await (await eventsRoute(req(`/dev/simulator/events?${biz}&simulationRunId=${RUN}&limit=5&type=order.completed`, { demo: true }))).json();
    expect(events.events).toHaveLength(5);
    expect(events.events.every((e: { type: string }) => e.type === "order.completed")).toBe(true);
    const runs = await (await runsRoute(req(`/dev/simulator/runs?${biz}`, { demo: true }))).json();
    expect(runs.runs.some((r: { simulationRunId: string }) => r.simulationRunId === RUN)).toBe(true);
  });

  it("ingest route requires credentials, validates the batch, scopes the tenant and returns IngestResult", async () => {
    process.env.NORMAL_DEMO_MODE = "false";
    expect((await ingestRoute(req("/ingest/events", { method: "POST", json: { schemaVersion: 1, events: [] } }))).status).toBe(401);
    process.env.NORMAL_INGEST_API_KEY = "ingest-secret";
    const bad = await ingestRoute(req("/ingest/events", { method: "POST", json: { schemaVersion: 1, events: [] }, headers: { authorization: "Bearer ingest-secret" } }));
    expect(bad.status).toBe(400);
    const db = await getDb();
    const sample = await db.collection(COLLECTIONS.businessEvents).findOne({ businessId: TEST_BUSINESS, simulationRunId: RUN, type: "web.session_started" }, { projection: { _id: 0 } });
    const sampleEvent = sample as unknown as { provenance: Record<string, unknown> };
    const fresh = { ...sample, eventId: "evt_route_ing_1", provenance: { ...sampleEvent.provenance, sourceRecordId: "route-ing-1" } };
    const ok = await ingestRoute(req(`/ingest/events?${biz}`, { method: "POST", json: { schemaVersion: 1, events: [fresh, fresh] }, headers: { authorization: "Bearer ingest-secret" } }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(IngestResult.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ accepted: 1, duplicates: 1, rejected: 0 });
    const scoped = await ingestRoute(req(`/ingest/events?businessId=other_biz`, { method: "POST", json: { schemaVersion: 1, events: [{ ...fresh, eventId: "evt_route_ing_2", provenance: { ...fresh.provenance, sourceRecordId: "route-ing-2" } }] }, headers: { authorization: "Bearer ingest-secret" } }));
    expect((await scoped.json()).rejected).toBe(1);
    delete process.env.NORMAL_INGEST_API_KEY;
  });

  it("metrics routes return validated snapshots and consistent breakdowns, with safe defaults and validation", async () => {
    const res = await metricsRoute(req(`/metrics?${biz}&simulationRunId=${RUN}&bucket=day`));
    expect(res.status).toBe(200);
    const snaps = await res.json();
    expect(Array.isArray(snaps)).toBe(true);
    expect(snaps.length).toBe(1);
    for (const s of snaps) expect(MetricSnapshot.safeParse(s).success).toBe(true);
    expect((await metricsRoute(req(`/metrics?${biz}&simulationRunId=${RUN}&bucket=weekly`))).status).toBe(400);
    expect((await metricsRoute(req(`/metrics?${biz}&simulationRunId=nope`))).status).toBe(404);
    const bd = await (await breakdownRoute(req(`/metrics/breakdown?${biz}&simulationRunId=${RUN}`))).json();
    expect(bd.total.counters.orders).toBe(snaps.reduce((a: number, s: { counters: { orders: number } }) => a + s.counters.orders, 0));
    expect(bd.products).toHaveLength(17);
    expect(bd.campaigns).toHaveLength(5);
    expect(bd.hourly.length).toBe(24);
    expect(JSON.stringify(bd)).not.toContain("NaN");
  });

  it("demo-store routes: products expose provenance, checkout is server-priced and idempotent, orders list the shopper's purchases", async () => {
    const products = await (await productsRoute(req(`/demo-store/products?${biz}`))).json();
    expect(products.simulationRunId).toBe(RUN);
    expect(products.products).toHaveLength(17);
    const af1 = products.products.find((p: { productId: string }) => p.productId === "nk_air_force_1_07");
    expect(af1.reference.sourceUrl).toContain("nike.com/gb");
    expect(af1.priceOrigin).toBe("official_public_list_price");
    expect(JSON.stringify(products)).not.toContain("costMinor");

    const key = "route-checkout-0001";
    const bad = await checkoutRoute(req("/demo-store/checkout", { method: "POST", json: { businessId: TEST_BUSINESS, idempotencyKey: key, items: [{ productId: af1.productId, quantity: 1 }], cardNumber: "4111" } }));
    expect(bad.status).toBe(400);
    const created = await checkoutRoute(req("/demo-store/checkout", { method: "POST", json: { businessId: TEST_BUSINESS, idempotencyKey: key, items: [{ productId: af1.productId, quantity: 1 }], device: "android" } }));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.order.netRevenueMinor).toBe(af1.priceMinor);
    const again = await checkoutRoute(req("/demo-store/checkout", { method: "POST", json: { businessId: TEST_BUSINESS, idempotencyKey: key, items: [{ productId: af1.productId, quantity: 1 }], device: "android" } }));
    expect(again.status).toBe(200);
    expect((await again.json()).status).toBe("replayed");
    const after = await (await productsRoute(req(`/demo-store/products?${biz}`))).json();
    expect(after.products.find((p: { productId: string }) => p.productId === af1.productId).availableUnits).toBe(af1.availableUnits - 1);
    const orders = await (await ordersRoute(req(`/demo-store/orders?${biz}&keys=${key}`))).json();
    expect(orders.orders).toHaveLength(1);
    expect(orders.orders[0].orderId).toBe(body.order.orderId);
    expect(orders.orders[0].shipment.status).toBe("pending");
  });

  it("GET /api/plans/:id serves the canonical PlanHandoff after the fixture is seeded, 404 otherwise", async () => {
    expect((await planRoute(req("/plans/plan_missing"), { params: Promise.resolve({ id: "plan_missing" }) })).status).toBe(404);
    const seeded = await seedPlanRoute(req("/dev/plans/seed-fixture", { method: "POST", demo: true }));
    expect(seeded.status).toBe(200);
    const res = await planRoute(req("/plans/plan_001"), { params: Promise.resolve({ id: "plan_001" }) });
    expect(res.status).toBe(200);
    const handoff = await res.json();
    expect(PlanHandoff.safeParse(handoff).success).toBe(true);
    expect(Object.keys(handoff).sort()).toEqual(["diagnosis", "evidence", "plan"]);
  });
});

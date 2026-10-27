import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusinessEventT } from "@explainwhy/contracts";
import { queryZetaris } from "@/integrations/zetaris/client";
import { campaignQuery, CampaignRow, verifyCampaignRows } from "@/integrations/zetaris/campaigns";
import { campaignCsv } from "@/integrations/zetaris/export";
import { zetarisConfig, zetarisStatus } from "@/integrations/zetaris/config";
import { listTools } from "@/intelligence/evidence/registry";

const config = { baseUrl: "https://zetaris.example", apiKey: "test-key-do-not-log", orgId: "23", adsRelation: "demo.ads", campaignsRelation: "demo.campaigns" };
const scope = { businessId: "nike_demo", simulationRunId: "run_one", window: { startAt: "2026-10-23T00:00:00.000Z", endAt: "2026-10-23T01:00:00.000Z" }, campaignIds: ["campaign_a"] };
const row = { event_id: "event_a", business_id: scope.businessId, simulation_run_id: scope.simulationRunId, campaign_id: "campaign_a", window_start: scope.window.startAt, window_end: scope.window.endAt, impressions: 100, clicks: 4, spend_minor: 200, attributed_orders: 1, attributed_revenue_minor: 300, campaign_name: "Campaign A", platform: "meta_ads" };
const event: BusinessEventT = { schemaVersion: 1, businessId: scope.businessId, simulationRunId: scope.simulationRunId, eventId: "event_a", source: "meta_ads", type: "ad.metrics_observed", occurredAt: scope.window.endAt, receivedAt: scope.window.endAt, provenance: { sourceRecordId: "event_a", connectorId: "test_simulator", simulated: true, ingestMethod: "simulation" }, payload: { campaignId: "campaign_a", window: scope.window, impressions: 100, clicks: 4, spendMinor: 200, attributedOrders: 1, attributedRevenueMinor: 300, frequency: 1, currency: "GBP" } };
const page = (records: unknown[], patch: Record<string, unknown> = {}) => Response.json({ records, queryToken: "opaque-cursor", pageNumber: 1, totalCount: records.length, totalPages: 1, ...patch });
afterEach(() => vi.unstubAllEnvs());

describe("Zetaris scoped SQL integration", () => {
  it("builds one scoped SELECT joining both registered data sources and rejects injection", () => {
    const sql = campaignQuery(scope, config);
    expect(sql).toContain("LEFT JOIN `demo`.`campaigns`");
    expect(sql).toContain("a.simulation_run_id = 'run_one'");
    expect(sql).toContain("a.window_end <= '2026-10-23T01:00:00.000Z'");
    expect(sql).toContain("a.campaign_id IN ('campaign_a')");
    expect(() => campaignQuery({ ...scope, campaignIds: ["x' OR 1=1"] }, config)).toThrow();
    expect(() => campaignQuery(scope, { ...config, adsRelation: "ads; DROP TABLE x" })).toThrow();
  });
  it("uses documented pagination, authentication and closes its cursor without exposing credentials", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(page([row], { totalCount: 2, totalPages: 2 })).mockResolvedValueOnce(page([{ ...row, event_id: "event_b" }], { pageNumber: 2, totalCount: 2, totalPages: 2 })).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const result = await queryZetaris(campaignQuery(scope, config), { config, fetch: transport });
    expect(result.records).toHaveLength(2);
    expect(result.receipt).toMatchObject({ rowCount: 2, pages: 2, closed: true });
    expect(transport.mock.calls[0][0]).toBe("https://zetaris.example/api/v1.0/query/sql/start");
    expect(transport.mock.calls[0][1]?.headers).toMatchObject({ authorization: "Bearer test-key-do-not-log", "X-Org-ID": "23" });
    expect(String(transport.mock.calls[1][0])).toContain("pageNumber=2");
    expect(transport.mock.calls[2][1]?.method).toBe("DELETE");
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
    expect(JSON.stringify(result)).not.toContain("opaque-cursor");
  });
  it("closes failed and oversized queries and refuses incomplete pagination", async () => {
    for (const first of [page([row], { totalCount: 5001, totalPages: 51 }), page([row], { totalCount: 2, totalPages: 2 })]) {
      const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(first).mockResolvedValueOnce(page([], { pageNumber: 2, totalCount: 2, totalPages: 2 })).mockResolvedValue(new Response(null, { status: 200 }));
      await expect(queryZetaris(campaignQuery(scope, config), { config, fetch: transport })).rejects.toThrow();
      expect(transport.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    }
  });
  it("reports cursor cleanup failure without inventing a clean receipt", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(page([row])).mockRejectedValueOnce(new Error("offline"));
    expect((await queryZetaris(campaignQuery(scope, config), { config, fetch: transport })).receipt.closed).toBe(false);
  });
  it("rejects cross-scope, duplicate, tampered, missing and stale observations", () => {
    expect(verifyCampaignRows([row], [event], scope)).toHaveLength(1);
    for (const invalid of [{ ...row, simulation_run_id: "other" }, { ...row, clicks: 99 }, { ...row, window_end: "2026-10-24T00:00:00Z" }]) expect(() => verifyCampaignRows([invalid], [event], scope)).toThrow();
    expect(() => verifyCampaignRows([row, row], [event], scope)).toThrow(/duplicate/);
    expect(() => verifyCampaignRows([row], [], scope)).toThrow(/missing/);
    expect(() => verifyCampaignRows([], [event], scope)).toThrow(/incomplete/);
    expect(CampaignRow.safeParse({ ...row, clicks: null }).success).toBe(false);
    expect(CampaignRow.safeParse({ ...row, clicks: "" }).success).toBe(false);
    expect(() => verifyCampaignRows([row], [{ ...event, provenance: { ...event.provenance, simulated: false } }], scope)).toThrow(/synthetic/);
  });
  it("exports only scoped advertising and catalogue fields with CSV escaping", () => {
    const data = campaignCsv([event], [{ businessId: scope.businessId, simulationRunId: scope.simulationRunId, campaignId: "campaign_a", name: 'A, "B"', platform: "meta_ads" }], scope);
    expect(data.counts).toEqual({ observations: 1, campaigns: 1 });
    expect(data.campaigns).toContain('"A, ""B"""');
    expect(data.ads).not.toContain("customer");
    expect(() => campaignCsv([event], [], scope)).toThrow(/catalogue/);
    expect(() => campaignCsv([{ ...event, provenance: { ...event.provenance, simulated: false } }], [], scope)).toThrow(/synthetic/);
  });
  it("fails explicitly when disabled or unconfigured", () => {
    vi.stubEnv("EXPLAINWHY_ZETARIS_ENABLED", "false");
    expect(zetarisStatus().configured).toBe(false);
    expect(() => zetarisConfig()).toThrow(/disabled/);
    expect(listTools().some((tool) => tool.name === "zetaris_campaign_analysis")).toBe(false);
    vi.stubEnv("EXPLAINWHY_ZETARIS_ENABLED", "true"); vi.stubEnv("ZETARIS_API_KEY", "");
    expect(() => zetarisConfig()).toThrow(/missing/);
    expect(listTools().some((tool) => tool.name === "zetaris_campaign_analysis")).toBe(true);
  });
  it("does not reflect server error bodies", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(config.apiKey, { status: 401 }));
    await expect(queryZetaris("SELECT 1", { config, fetch: transport })).rejects.toThrow("Zetaris returned HTTP 401; no evidence accepted");
  });
  it("cancels an oversized streamed response before buffering it all", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2_000_001)); }, cancel });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(queryZetaris("SELECT 1", { config, fetch: transport })).rejects.toThrow(/size limit/);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

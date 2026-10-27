import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/mongodb';
import { COLLECTIONS } from '@/lib/collections';
import { campaignTrends } from '@/intelligence/evidence/tools/campaign-trends';
import { advertisingAnalysis } from '@/intelligence/evidence/tools/advertising';
import type { ToolContext } from '@/intelligence/evidence/types';

const run = `t_trends_${randomUUID().replaceAll('-', '')}`;
const businessId = 'trend_test';
const time = (hour: number) => new Date(Date.UTC(2026, 9, 1) + hour * 3600000).toISOString();
let ctx: ToolContext;
const event = (id: string, campaignId: string, hour: number, clicks: number, frequency: number) => ({
  businessId, simulationRunId: run, eventId: `${run}_${id}`, type: 'ad.metrics_observed',
  provenance: { connectorId: 'campaign_trend_test', sourceRecordId: `${run}_${id}` },
  occurredAt: time(hour + 1), receivedAt: time(hour + 1),
  payload: { campaignId, window: { startAt: time(hour), endAt: time(hour + 1) },
    impressions: 100, clicks, frequency, spendMinor: 1000, attributedOrders: 1, attributedRevenueMinor: 2000 },
});

describe('campaign chronology from scoped canonical observations', () => {
  beforeAll(async () => {
    const db = await getDb();
    ctx = { db, businessId, simulationRunId: run, investigationId: `inv_${run}`, cutoff: time(48), catalogue: new Map() };
    await db.collection(COLLECTIONS.businessEvents).insertMany([
      event('a_before', 'camp_a', 0, 10, 1), event('a_after', 'camp_a', 24, 2, 5),
      event('b_before', 'camp_b', 0, 8, 1), event('b_after', 'camp_b', 24, 8, 1),
      { ...event('a_duplicate', 'camp_a', 0, 90, 9), receivedAt: time(2) },
      { ...event('foreign', 'camp_a', 0, 99, 99), businessId: 'other_business' },
      event('future', 'camp_a', 48, 99, 99),
    ]);
  });
  afterAll(async () => {
    if (ctx) await ctx.db.collection(COLLECTIONS.businessEvents).deleteMany({ simulationRunId: run });
  });

  it('deduplicates observations, preserves temporal comparisons and excludes other businesses and future data', async () => {
    const rows = await campaignTrends(ctx, { startAt: time(0), endAt: time(72) });
    expect(rows).toHaveLength(4);
    expect(rows.filter(r => r.campaignId === 'camp_a')).toMatchObject([
      { day: '2026-10-01', hours: 1, impressions: 100, clicks: 10, ctr: 0.1, averageFrequency: 1 },
      { day: '2026-10-02', hours: 1, impressions: 100, clicks: 2, ctr: 0.02, averageFrequency: 5 },
    ]);
    const refs = rows.flatMap(r => r.sourceRecords.map(s => s.recordId));
    expect(refs).not.toContain(`${run}_a_duplicate`);
    expect(refs).not.toContain(`${run}_foreign`);
    expect(refs).not.toContain(`${run}_future`);
  });

  it('puts campaign comparisons, peer observations and chronology into the canonical AI evidence', async () => {
    const result = await advertisingAnalysis.run(ctx, { businessId, simulationRunId: run,
      window: { startAt: time(24), endAt: time(48) }, baselineWindow: { startAt: time(0), endAt: time(24) },
      campaignIds: ['camp_a'], limit: 50 });
    expect(result.evidence).toHaveLength(2);
    const comparison = result.evidence.find(e => e.key === 'advertising:campaign:camp_a')!;
    expect(comparison.observation).toContain('CTR 0.02 versus 0.1 baseline');
    expect(comparison.observation).toContain('2026-10-01: 1 observed hours, CTR 0.1, frequency 1');
    expect(comparison.observation).toContain('camp_b: CTR 0.08 vs 0.08');
    expect(comparison.observation).toContain('peers are not assumed unaffected controls');
    expect(comparison.sourceRecords.map(s => s.recordId)).toContain(`${run}_a_before`);
    expect(comparison.detail.campaigns).toMatchObject([{ campaignId: 'camp_a', affected: true }]);
    expect(JSON.stringify(comparison)).not.toMatch(/activeScenario|scenarioSeverity|scenarioParams|simulator_ground_truth/);
  });
});

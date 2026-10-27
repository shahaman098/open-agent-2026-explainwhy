import type { ToolContext, WindowT } from '../types';
import { COLLECTIONS } from '@/lib/collections';
import { ratio, round, scopeOf } from './_shared';

interface DailyRow {
  _id: { campaignId: string; day: string };
  impressions: number; clicks: number; spendMinor: number; orders: number;
  frequency: number; hours: number; firstEventId: string; lastEventId: string;
}

/** Read only observed campaign events, deduplicated by campaign/hour as in campaignBreakdown. */
export async function campaignTrends(ctx: ToolContext, window: WindowT) {
  const endAt = window.endAt < ctx.cutoff ? window.endAt : ctx.cutoff;
  const rows = await ctx.db.collection(COLLECTIONS.businessEvents).aggregate<DailyRow>([
    { $match: { ...scopeOf(ctx), type: 'ad.metrics_observed',
      'payload.window.startAt': { $gte: window.startAt, $lt: endAt }, 'payload.window.endAt': { $lte: endAt } } },
    { $sort: { receivedAt: 1, eventId: 1 } },
    { $group: { _id: { campaignId: '$payload.campaignId', startAt: '$payload.window.startAt' }, doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $sort: { 'payload.window.startAt': 1, eventId: 1 } },
    { $group: { _id: { campaignId: '$payload.campaignId', day: { $substrBytes: ['$payload.window.startAt', 0, 10] } },
      impressions: { $sum: '$payload.impressions' }, clicks: { $sum: '$payload.clicks' }, spendMinor: { $sum: '$payload.spendMinor' },
      orders: { $sum: '$payload.attributedOrders' }, frequency: { $avg: '$payload.frequency' }, hours: { $sum: 1 },
      firstEventId: { $first: '$eventId' }, lastEventId: { $last: '$eventId' } } },
    { $sort: { '_id.campaignId': 1, '_id.day': 1 } },
  ]).toArray();
  return rows.map(r => ({ campaignId: r._id.campaignId, day: r._id.day, hours: r.hours,
    impressions: r.impressions, clicks: r.clicks, ctr: ratio(r.clicks, r.impressions),
    averageFrequency: round(r.frequency, 2), spendMinor: r.spendMinor, attributedOrders: r.orders,
    sourceRecords: [...new Set([r.firstEventId, r.lastEventId])].map(recordId => ({ collection: COLLECTIONS.businessEvents, recordId })) }));
}

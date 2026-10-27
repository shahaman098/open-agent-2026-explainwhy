import { z } from "zod";
import { COLLECTIONS } from "@/lib/collections";
import { MAX_ENTITY_IDS, ToolInputBase, type EvidenceDraft, type EvidenceTool, type ToolContext, type WindowT } from "../types";
import { cap, clampToCutoff, compact, countAndSample, labelFor, measurement, occurredIn, pc, ratio, round, scopeOf } from "./_shared";

export const FeedbackInput = ToolInputBase.extend({
  productIds: z.array(z.string().min(1).max(64)).max(MAX_ENTITY_IDS).default([]),
}).strict();
export type FeedbackInputT = z.infer<typeof FeedbackInput>;

const DELIVERY_TERMS = /\b(deliver|delivery|late|arriv|shipping|shipped|parcel|courier|days? late|never came|took .* days)\b/i;

interface ReviewAgg { _id: string | null; reviews: number; low: number; avgRating: number | null; deliveryMentions: number }
async function reviews(ctx: ToolContext, w: WindowT, productIds: string[], byProduct: boolean) {
  return ctx.db.collection(COLLECTIONS.businessEvents).aggregate<ReviewAgg>([
    { $match: { ...scopeOf(ctx), type: "review.created", ...occurredIn(w), ...(productIds.length ? { "payload.productId": { $in: productIds } } : {}) } },
    { $group: { _id: byProduct ? "$payload.productId" : null, reviews: { $sum: 1 }, low: { $sum: { $cond: [{ $lte: ["$payload.rating", 2] }, 1, 0] } }, avgRating: { $avg: "$payload.rating" },
      deliveryMentions: { $sum: { $cond: [{ $regexMatch: { input: "$payload.text", regex: DELIVERY_TERMS.source, options: "i" } }, 1, 0] } } } },
    { $sort: { low: -1, reviews: -1 } }, { $limit: 100 },
  ]).toArray();
}

export const customerFeedbackAnalysis: EvidenceTool<FeedbackInputT> = {
  name: "customer_feedback_analysis",
  title: "Customer feedback analysis",
  description: "Review volume, low-star (≤2) share, average rating and delivery-related complaint mentions overall and per product, versus baseline. Reads canonical review.created events; every review is simulated.",
  category: "reviews",
  dataSources: [{ collection: COLLECTIONS.businessEvents, description: "review.created canonical events (rating 1–5 and synthetic text)", origin: "simulated" }],
  input: FeedbackInput,
  async run(ctx, input) {
    const window = clampToCutoff(input.window, ctx.cutoff);
    const baseline = input.baselineWindow ? clampToCutoff(input.baselineWindow, ctx.cutoff) : null;
    const warnings: string[] = ["All reviews are simulated; no public review source is read. Delivery-complaint counts use a keyword heuristic on synthetic text."];
    const [cur, base, perProduct, sample, lowSample] = await Promise.all([
      reviews(ctx, window, input.productIds, false), baseline ? reviews(ctx, baseline, input.productIds, false) : Promise.resolve([] as ReviewAgg[]), reviews(ctx, window, input.productIds, true),
      countAndSample(ctx.db, { ...scopeOf(ctx), type: "review.created", ...occurredIn(window), ...(input.productIds.length ? { "payload.productId": { $in: input.productIds } } : {}) }, input.limit),
      countAndSample(ctx.db, { ...scopeOf(ctx), type: "review.created", "payload.rating": { $lte: 2 }, ...occurredIn(window), ...(input.productIds.length ? { "payload.productId": { $in: input.productIds } } : {}) }, Math.min(input.limit, 50)),
    ]);
    const c = cur[0], b = base[0];
    if (!c) return { evidence: [], resultCount: 0, warnings: [...warnings, "No reviews were created in the requested window"], emptyResult: "No reviews in window" };
    const hc = Math.max(1, (Date.parse(window.endAt) - Date.parse(window.startAt)) / 3_600_000), hb = baseline ? Math.max(1, (Date.parse(baseline.endAt) - Date.parse(baseline.startAt)) / 3_600_000) : 1;
    const lowRate = ratio(c.low, c.reviews), baseLowRate = b ? ratio(b.low, b.reviews) : null;
    if (c.reviews < 10) warnings.push(`Only ${c.reviews} reviews in the window; rating statistics are weak`);
    if (!baseline) warnings.push("No baseline window supplied");
    const products = perProduct.map((p) => ({ productId: p._id as string, ...labelFor(ctx, p._id as string), reviews: p.reviews, lowRating: p.low, lowRatingRate: ratio(p.low, p.reviews), averageRating: p.avgRating === null ? null : round(p.avgRating, 2), deliveryMentions: p.deliveryMentions }));

    const observation = [
      `${c.reviews} reviews over ${hc} h ending ${window.endAt}: ${c.low} rated ≤2 (${lowRate === null ? "n/a" : (lowRate * 100).toFixed(1) + "%"}), average rating ${c.avgRating === null ? "n/a" : c.avgRating.toFixed(2)}, ${c.deliveryMentions} mention delivery terms.`,
      b ? `Baseline: ${b.reviews} reviews, low-rating share ${baseLowRate === null ? "n/a" : (baseLowRate * 100).toFixed(1) + "%"} (${pc(lowRate, baseLowRate)} change), average rating ${b.avgRating === null ? "n/a" : b.avgRating.toFixed(2)}, reviews per hour ${pc(c.reviews / hc, b.reviews / hb)} change.` : "",
      products.length ? `Most low-rated products: ${products.slice(0, 3).map((p) => `${p.name} (${p.lowRating}/${p.reviews})`).join(", ")}.` : "",
      "Simulated review records; delivery mentions are a keyword heuristic.",
    ].filter(Boolean).join(" ");

    const evidence: EvidenceDraft = {
      key: "reviews:ratings", category: "reviews", title: "Review volume, low ratings and delivery complaints", observation, window,
      measurements: compact([
        measurement("reviews", c.reviews, "count", b?.reviews), measurement("reviews_per_hour", c.reviews / hc, "count/hour", b ? b.reviews / hb : undefined),
        measurement("low_rating_reviews", c.low, "count", b?.low), measurement("low_rating_rate", lowRate, "ratio", baseLowRate),
        measurement("average_rating", c.avgRating, "stars", b?.avgRating), measurement("delivery_mention_reviews", c.deliveryMentions, "count", b?.deliveryMentions),
      ]),
      sourceRecords: [...lowSample.sample, ...sample.sample],
      detail: { hours: { current: hc, baseline: baseline ? hb : null }, byProduct: cap(products, input.limit), reviewEventsInWindow: sample.count, lowRatingEventsInWindow: lowSample.count, deliveryTermHeuristic: DELIVERY_TERMS.source },
      warnings, dataOrigin: "simulated",
    };
    return { evidence: [evidence], resultCount: c.reviews, warnings };
  },
};

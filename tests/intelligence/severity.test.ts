import { describe, expect, it } from "vitest";
import { assess } from "@/intelligence/detection/severity";
import { SIGNALS_BY_ID } from "@/intelligence/detection/rules";
import { evaluatePoint } from "@/intelligence/detection/signal";
import { jitter, seriesFrom } from "./synth";

const healthy = (h: number) => ({ sessions: { direct: 40 + jitter(h, 1, 2) }, orders: 2 });
describe("finding severity", () => {
  it("grows with magnitude, persistence and business impact", () => {
    const def = SIGNALS_BY_ID.get("orders")!;
    const small = seriesFrom(24 * 7, (h) => ({ ...healthy(h), orders: h >= 24 * 5 ? 1 : 2 }));
    const big = seriesFrom(24 * 7, (h) => ({ ...healthy(h), orders: h >= 24 * 5 ? 0 : 2 }));
    const k = 24 * 6;
    const evSmall = evaluatePoint(def, def.triggers[0], small, "global", 24, k, 24 * 5);
    const evBig = evaluatePoint(def, def.triggers[0], big, "global", 24, k, 24 * 5);
    const a = assess(def, 0, small, "global", 24, 24 * 5, evSmall, 6);
    const b = assess(def, 0, big, "global", 24, 24 * 5, evBig, 6);
    const c = assess(def, 0, big, "global", 24, 24 * 5, evBig, 24);
    expect(b.score).toBeGreaterThan(a.score);
    expect(c.score).toBeGreaterThan(b.score);
    // Impact is normalised to 25% of daily revenue, so both order declines saturate it; magnitude separates them.
    expect(b.components.magnitude).toBeGreaterThan(a.components.magnitude);
    expect(b.components.impact).toBeGreaterThanOrEqual(a.components.impact);
    expect(c.components.persistence).toBeGreaterThan(b.components.persistence);
    expect(c.explanation).toMatch(/magnitude .* reliability .* impact .* persistence/);
  });

  it("impact scales with the share of daily revenue at stake", () => {
    const def = SIGNALS_BY_ID.get("product_orders")!;
    const spec = (big: boolean) => (h: number) => ({ ...healthy(h), orders: 4, productOrders: { p_a: h >= 24 * 5 ? (big ? 2 : 1) : (h % 4 === 0 ? 1 : 0) } });
    const k = 24 * 6;
    const sSmall = seriesFrom(24 * 7, spec(false)); const sBig = seriesFrom(24 * 7, spec(true));
    const a = assess(def, 0, sSmall, "product:p_a", 24, 24 * 5, evaluatePoint(def, def.triggers[0], sSmall, "product:p_a", 24, k, 24 * 5), 12);
    const b = assess(def, 0, sBig, "product:p_a", 24, 24 * 5, evaluatePoint(def, def.triggers[0], sBig, "product:p_a", 24, k, 24 * 5), 12);
    expect(b.impactPerDayMinor).toBeGreaterThanOrEqual(a.impactPerDayMinor);
    expect(a.components.impact).toBeLessThan(1);
  });
});

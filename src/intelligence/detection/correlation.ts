import { DEFAULT_CONFIG, levelForScore, type DetectionConfig } from "@/intelligence/config";
import { HOUR_MS } from "@/intelligence/signals/rows";
import type { FindingDraft } from "@/intelligence/detection/engine";
import { parseSegmentKey, type CatalogueView, type SeverityLevel, type Theme } from "@/intelligence/types";

export type IncidentPolarity = "negative" | "positive" | "mixed";

export interface IncidentDraft {
  /** Natural key of the earliest member finding; used to mint a stable incident ID for new incidents. */
  seedKey: string;
  findingKeys: string[];
  primaryTheme: Theme;
  themes: Theme[];
  polarity: IncidentPolarity;
  scope: { kind: "global" | "campaign" | "product" | "channel" | "category" | "multiple"; ids: string[] };
  affected: { campaigns: string[]; products: string[]; channels: string[]; categories: string[] };
  onsetAt: string;
  lastTriggeredAt: string;
  active: boolean;
  resolvedAt: string | null;
  severity: { score: number; level: SeverityLevel; baseScore: number; breadthBonus: number; distinctSignals: number; cap: string | null };
  title: string;
  summary: string;
  /** Why members were grouped (explainability; co-occurrence, never causation). */
  links: Array<{ from: string; to: string; reason: string }>;
}

const HUB_THEMES: ReadonlySet<Theme> = new Set(["sales", "traffic"]);

/**
 * Cross-theme metric relationships that justify grouping co-occurring findings. They describe which observations are
 * commonly seen together; they are not causal claims and contain no scenario knowledge.
 */
const RELATED: Array<{ a: Theme; b: Theme; reason: string; sameEntity: boolean; anyPolarity: boolean; maxOnsetGapHours: number }> = [
  // Reviews follow deliveries by days, so no onset proximity is required; the episodes must still overlap.
  { a: "fulfilment", b: "reputation", reason: "delivery performance and customer ratings moved together", sameEntity: false, anyPolarity: false, maxOnsetGapHours: Infinity },
  { a: "demand", b: "inventory", reason: "demand and stock availability for the same product", sameEntity: true, anyPolarity: true, maxOnsetGapHours: Infinity },
  // Paid-acquisition efficiency and site conversion share the same orders; link only when they start together.
  { a: "advertising", b: "conversion", reason: "paid acquisition efficiency and site conversion changed at the same time", sameEntity: false, anyPolarity: false, maxOnsetGapHours: 12 },
  // Checkout failures/conversion and stock-outs share the same failed checkouts; link only when they start together.
  { a: "conversion", b: "inventory", reason: "checkout outcomes and stock availability changed at the same time", sameEntity: false, anyPolarity: false, maxOnsetGapHours: 12 },
];

/** Preferred incident themes for each impact hub, most preferred first. */
function hubPreference(hub: FindingDraft): Theme[] {
  if (hub.theme === "traffic") {
    const seg = hub.segment;
    if (seg.startsWith("channel:paid_")) return ["advertising"];
    if (seg.startsWith("channel:")) return hub.polarity === "positive" ? ["demand", "inventory"] : ["advertising", "conversion"];
    return hub.polarity === "positive" ? ["demand", "inventory", "advertising"] : ["advertising", "conversion", "demand"];
  }
  return hub.polarity === "positive"
    ? ["demand", "inventory", "conversion", "advertising"]
    : ["advertising", "conversion", "inventory", "demand", "fulfilment", "reputation"];
}

function interval(f: FindingDraft, asOf: string): [number, number] {
  return [Date.parse(f.onsetAt), Date.parse(f.resolvedAt ?? asOf)];
}
function overlapHours(a: [number, number], b: [number, number]): number {
  return (Math.min(a[1], b[1]) - Math.max(a[0], b[0])) / HOUR_MS;
}
const entityOf = (segment: string) => (segment === "global" ? null : segment);

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a); const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
}

/** Whether two non-hub findings belong to the same incident, and why. */
function linkReason(a: FindingDraft, b: FindingDraft, asOf: string, config: DetectionConfig): string | null {
  if (overlapHours(interval(a, asOf), interval(b, asOf)) < config.correlationOverlapHours) return null;
  if (a.theme === b.theme) {
    if (a.polarity !== b.polarity) return null;
    if (a.segment === b.segment) return `same ${a.theme} signal family on ${a.segment}`;
    if (a.segment === "global" || b.segment === "global") return `${a.theme} change business-wide and on ${a.segment === "global" ? b.segment : a.segment}`;
    return null;
  }
  for (const r of RELATED) {
    const match = (a.theme === r.a && b.theme === r.b) || (a.theme === r.b && b.theme === r.a);
    if (!match) continue;
    if (!r.anyPolarity && a.polarity !== b.polarity) continue;
    const ea = entityOf(a.segment); const eb = entityOf(b.segment);
    if (r.sameEntity ? !(ea === eb || ea === null || eb === null) : !(ea === null || eb === null || ea === eb)) continue;
    if (Math.abs(Date.parse(a.onsetAt) - Date.parse(b.onsetAt)) / HOUR_MS > r.maxOnsetGapHours) continue;
    return r.reason;
  }
  return null;
}

const THEME_TITLES: Record<Theme, { negative: string; positive: string; mixed: string }> = {
  advertising: { negative: "Advertising performance deterioration", positive: "Advertising performance improvement", mixed: "Advertising performance change" },
  conversion: { negative: "Checkout and conversion deterioration", positive: "Conversion improvement", mixed: "Checkout and conversion change" },
  fulfilment: { negative: "Delivery performance deterioration", positive: "Delivery performance improvement", mixed: "Delivery performance change" },
  inventory: { negative: "Inventory availability risk", positive: "Inventory availability improvement", mixed: "Inventory availability risk" },
  reputation: { negative: "Customer rating deterioration", positive: "Customer rating improvement", mixed: "Customer rating change" },
  demand: { negative: "Product demand decline", positive: "Demand surge", mixed: "Demand surge with stock risk" },
  sales: { negative: "Revenue decline", positive: "Revenue surge", mixed: "Revenue change" },
  traffic: { negative: "Traffic decline", positive: "Traffic surge", mixed: "Traffic change" },
};

function fmtChange(f: FindingDraft): string {
  const e = f.primary.latest.ok ? f.primary.latest : f.primary.peak;
  if (e.changePercent !== null) return `${f.label} ${e.changePercent > 0 ? "+" : ""}${e.changePercent.toFixed(0)}%`;
  if (f.signalId === "projected_stockout" && e.actual !== null) return `${f.label} (≈${e.actual.toFixed(0)}h of cover)`;
  return f.label;
}

function labelFor(segment: string, catalogue: CatalogueView): string {
  const s = parseSegmentKey(segment);
  if (s.kind === "product") return catalogue.get(s.id!)?.name ?? s.id!;
  return s.id ?? "all";
}

function buildIncident(members: FindingDraft[], links: IncidentDraft["links"], asOf: string, catalogue: CatalogueView, config: DetectionConfig): IncidentDraft {
  const sorted = [...members].sort((a, b) => b.severity.score - a.severity.score || a.key.localeCompare(b.key));
  const core = sorted.filter((f) => !HUB_THEMES.has(f.theme));
  const themeScore = new Map<Theme, number>();
  for (const f of core.length ? core : sorted) themeScore.set(f.theme, (themeScore.get(f.theme) ?? 0) + f.severity.score);
  const primaryTheme = [...themeScore.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const polarities = new Set(members.map((f) => f.polarity));
  const polarity: IncidentPolarity = polarities.size > 1 ? "mixed" : (members[0].polarity as IncidentPolarity);

  const primaryMembers = members.filter((f) => f.theme === primaryTheme);
  const segs = [...new Set(primaryMembers.map((f) => f.segment))].sort();
  const scope: IncidentDraft["scope"] = segs.includes("global")
    ? { kind: "global", ids: segs.filter((s) => s !== "global").map((s) => parseSegmentKey(s).id!) }
    : segs.length === 1 ? { kind: parseSegmentKey(segs[0]).kind as IncidentDraft["scope"]["kind"], ids: [parseSegmentKey(segs[0]).id!] }
    : { kind: "multiple", ids: segs.map((s) => parseSegmentKey(s).id!) };
  const affected = { campaigns: [] as string[], products: [] as string[], channels: [] as string[], categories: [] as string[] };
  for (const f of members) {
    const s = parseSegmentKey(f.segment);
    if (s.kind === "campaign") affected.campaigns.push(s.id!);
    if (s.kind === "product") { affected.products.push(s.id!); const c = catalogue.get(s.id!)?.category; if (c) affected.categories.push(c); }
    if (s.kind === "channel") affected.channels.push(s.id!);
    if (s.kind === "category") affected.categories.push(s.id!);
  }
  for (const k of Object.keys(affected) as Array<keyof typeof affected>) affected[k] = [...new Set(affected[k])].sort();

  // Severity: strongest member + breadth bonus, capped when the incident rests on one weak signal.
  const distinctSignals = new Set(members.map((f) => f.signalId)).size;
  const baseScore = sorted[0].severity.score;
  const breadthBonus = Math.min(config.severity.breadthBonusCap, config.severity.breadthBonusPerSignal * (distinctSignals - 1));
  let score = Math.min(100, baseScore + breadthBonus);
  let cap: string | null = null;
  if (distinctSignals === 1) {
    if (sorted[0].severity.components.reliability < 0.5 && score > 54.9) { score = 54.9; cap = "single low-reliability signal: capped at medium"; }
    else if (sorted[0].severity.components.magnitude < 0.8 && score > 74.9) { score = 74.9; cap = "single supporting signal: capped at high"; }
  }

  const titleBase = THEME_TITLES[primaryTheme][polarity];
  let suffix = "";
  if (scope.kind === "product" || (scope.kind === "multiple" && scope.ids.length <= 2 && primaryMembers.every((f) => f.segment.startsWith("product:")))) {
    suffix = ` — ${scope.ids.map((id) => labelFor(`product:${id}`, catalogue)).join(", ")}`;
  } else if (primaryTheme === "advertising" && affected.campaigns.length > 1) suffix = ` across ${affected.campaigns.length} campaigns`;
  else if (scope.kind === "campaign") suffix = ` — ${scope.ids[0]}`;
  const salesHub = members.find((f) => f.theme === "sales" && f.segment === "global");
  if (salesHub && primaryTheme !== "sales") suffix += salesHub.polarity === "negative" ? " with revenue decline" : " with revenue growth";

  const onsetAt = members.map((f) => f.onsetAt).sort()[0];
  const active = members.some((f) => f.active);
  const summary = `Observed since ${onsetAt}: ${sorted.slice(0, 6).map(fmtChange).join("; ")}${sorted.length > 6 ? `; +${sorted.length - 6} more` : ""}. `
    + "Signals are grouped by timing and metric relationships only; causes are not inferred.";
  return {
    seedKey: [...members].sort((a, b) => a.onsetAt.localeCompare(b.onsetAt) || a.key.localeCompare(b.key))[0].key,
    findingKeys: sorted.map((f) => f.key), primaryTheme, themes: [...new Set(members.map((f) => f.theme))].sort(), polarity, scope, affected,
    onsetAt, lastTriggeredAt: members.map((f) => f.lastTriggeredAt).sort().at(-1)!, active,
    resolvedAt: active ? null : members.map((f) => f.resolvedAt as string).sort().at(-1)!,
    severity: { score: Math.round(score * 10) / 10, level: levelForScore(score, config), baseScore, breadthBonus, distinctSignals, cap },
    title: titleBase + suffix, summary, links,
  };
}

/**
 * Groups findings into incidents.
 *  1. Non-hub findings are linked when they overlap in time and share a theme and segment (or one is business-wide),
 *     or match an entry of the RELATED table. Connected components become incidents.
 *  2. Business-wide impact signals (revenue, orders, traffic) attach to the ONE best component (preferred theme,
 *     compatible polarity, most overlap, highest severity) so they never bridge unrelated incidents.
 *  3. Impact signals with no compatible component form their own incident.
 */
export function correlate(findings: readonly FindingDraft[], asOf: string, catalogue: CatalogueView = new Map(), config: DetectionConfig = DEFAULT_CONFIG): IncidentDraft[] {
  const core = findings.filter((f) => !HUB_THEMES.has(f.theme));
  const hubs = findings.filter((f) => HUB_THEMES.has(f.theme)).sort((a, b) => b.severity.score - a.severity.score || a.key.localeCompare(b.key));
  const uf = new UnionFind();
  const links: IncidentDraft["links"] = [];
  for (const f of core) uf.find(f.key);
  for (let i = 0; i < core.length; i++) {
    for (let j = i + 1; j < core.length; j++) {
      const reason = linkReason(core[i], core[j], asOf, config);
      if (reason) { uf.union(core[i].key, core[j].key); links.push({ from: core[i].key, to: core[j].key, reason }); }
    }
  }
  const components = new Map<string, FindingDraft[]>();
  for (const f of core) { const r = uf.find(f.key); components.set(r, [...(components.get(r) ?? []), f]); }

  const leftover: FindingDraft[] = [];
  for (const hub of hubs) {
    const prefs = hubPreference(hub);
    let best: { root: string; rank: number; overlap: number; score: number } | null = null;
    for (const [root, members] of components) {
      const pol = new Set(members.map((m) => m.polarity));
      const compatible = pol.has(hub.polarity);
      if (!compatible) continue;
      const span: [number, number] = [Math.min(...members.map((m) => interval(m, asOf)[0])), Math.max(...members.map((m) => interval(m, asOf)[1]))];
      const overlap = overlapHours(interval(hub, asOf), span);
      if (overlap < config.correlationOverlapHours) continue;
      const themes = new Set(members.map((m) => m.theme));
      const rank = prefs.findIndex((t) => themes.has(t));
      if (rank < 0) continue;
      const score = Math.max(...members.map((m) => m.severity.score));
      if (!best || rank < best.rank || (rank === best.rank && (overlap > best.overlap || (overlap === best.overlap && score > best.score)))) {
        best = { root, rank, overlap, score };
      }
    }
    if (best) {
      components.get(best.root)!.push(hub);
      links.push({ from: hub.key, to: best.root, reason: `${hub.theme} change observed alongside ${prefs[best.rank]} signals` });
    } else {
      leftover.push(hub);
    }
  }
  // Leftover impact signals: group by polarity and time overlap.
  const hubUf = new UnionFind();
  for (const h of leftover) hubUf.find(h.key);
  for (let i = 0; i < leftover.length; i++) for (let j = i + 1; j < leftover.length; j++) {
    const a = leftover[i]; const b = leftover[j];
    if (a.polarity === b.polarity && overlapHours(interval(a, asOf), interval(b, asOf)) >= config.correlationOverlapHours) {
      hubUf.union(a.key, b.key); links.push({ from: a.key, to: b.key, reason: "business-wide impact signals observed together" });
    }
  }
  for (const h of leftover) { const r = `hub:${hubUf.find(h.key)}`; components.set(r, [...(components.get(r) ?? []), h]); }

  const keyOf = (members: FindingDraft[]) => new Set(members.map((m) => m.key));
  return [...components.values()]
    .map((members) => {
      const keys = keyOf(members);
      return buildIncident(members, links.filter((l) => keys.has(l.from) || keys.has(l.to)), asOf, catalogue, config);
    })
    .sort((a, b) => b.severity.score - a.severity.score || a.seedKey.localeCompare(b.seedKey));
}

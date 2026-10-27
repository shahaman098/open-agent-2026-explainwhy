import "server-only";
import { createHash } from "node:crypto";
import type { EvidenceT } from "@explainwhy/contracts";
import type { ScopeT } from "@/intelligence/investigator/schemas";

export interface ChartEvidence {
  evidence: EvidenceT; simulationRunId?: string; dataOrigin: string | null;
  verification: { passed: boolean } | null;
}
export function chartOptions(items: ChartEvidence[]) {
  return items.filter((item) => item.verification?.passed === true && ["simulated", "normal_internal"].includes(item.dataOrigin || ""))
    .flatMap((item) => item.evidence.measurements.filter((m) => Number.isFinite(m.value) && m.baseline !== undefined && Number.isFinite(m.baseline))
      .map((m) => ({ evidenceId: item.evidence.evidenceId, metric: m.metric, unit: m.unit, title: item.evidence.title })));
}
const clean = (text: string, max = 70) => text.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
function label(value: number, unit: string) {
  // Retain enough precision to round-trip the original value. No abbreviated or invented totals.
  if (unit === "GBP minor units") {
    const minor = BigInt(value), absolute = minor < BigInt(0) ? -minor : minor;
    return `GBP ${minor < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
  }
  return `${value} ${unit}`;
}

/** Deterministic scene compiler. Models cannot change the figures, geometry or evidence references. */
export function financialAnimation(scope: ScopeT, item: ChartEvidence, metric: string) {
  const e = item.evidence;
  if (e.businessId !== scope.businessId || e.investigationId !== scope.investigationId || item.simulationRunId !== scope.simulationRunId) throw new Error("animation_scope_mismatch");
  if (!chartOptions([item]).some((option) => option.metric === metric)) throw new Error("animation_requires_verified_comparison");
  const measurement = e.measurements.find((m) => m.metric === metric)!;
  if (e.measurements.filter((m) => m.metric === metric).length !== 1) throw new Error("animation_ambiguous_metric");
  const { value, baseline: rawBaseline, unit } = measurement, baseline = rawBaseline!;
  if (!Number.isSafeInteger(value) && unit === "GBP minor units" || !Number.isSafeInteger(baseline) && unit === "GBP minor units") throw new Error("animation_invalid_currency");
  const duration = 5, magnitude = Math.max(Math.abs(value), Math.abs(baseline), 1);
  const text = (id: string, content: string, x: number, z: number, size = 0.38) => ({ id, shape: "text", material: "text", text: clean(content, 180), size, depth: 0.005, bevel: 0, align: "CENTER", position: [x, -0.65, z], rotation: [90, 0, 0] });
  const parts: Array<Record<string, unknown>> = [
    { id: "zero_axis", shape: "box", material: "muted", size: [12, 0.08, 0.025], position: [0, 0, 0] },
    text("title", metric.replace(/_minor$/, "").replaceAll("_", " "), 0, 6, 0.55),
    text("origin", `${item.dataOrigin === "simulated" ? "SYNTHETIC DEMO DATA" : "INTERNAL OBSERVATIONS"} | observed comparison; causation not established`, 0, 5.3, 0.23),
    text("source", `Evidence: ${e.evidenceId}`, 0, -6, 0.22),
    text("window", e.window ? `${e.window.startAt} to ${e.window.endAt}` : "Observation window not supplied", 0, -6.5, 0.2),
  ];
  for (const [index, amount] of [baseline, value].entries()) {
    const x = index ? 3 : -3, height = Math.abs(amount) / magnitude * 4, z = Math.sign(amount) * height / 2;
    if (amount !== 0 && height < 0.0001) throw new Error("animation_dynamic_range_too_large");
    if (amount !== 0) parts.push({ id: `bar_${index}`, shape: "box", material: index ? "current" : "baseline", size: [1.8, 0.8, height], position: [x, 0, z], bevel: 0,
      animation: [{ time: 0, scale: [1, 1, 0.0001], position: [x, 0, z * 0.0001] }, { time: 2.5, scale: [1, 1, 1], position: [x, 0, z] }] });
    parts.push(text(`name_${index}`, index ? "Current" : "Baseline", x, -4.8), text(`value_${index}`, label(amount, unit), x, -5.35, 0.3));
  }
  const provenance = { schemaVersion: 1, ...scope, evidenceId: e.evidenceId, metric, value, baseline, unit, window: e.window ?? null,
    sourceRecords: e.sourceRecords, dataOrigin: item.dataOrigin, retrievedAt: e.retrievedAt, compilerVersion: "financial-chart-v1", interpretation: "Observed comparison only; bar growth is presentation, not a measured time series." };
  const scene = { version: 2, title: clean(`ExplainWhy: ${metric}`), summary: clean(`${e.title}. ${provenance.interpretation}`, 400),
    materials: [{ id: "text", color: "#eef5ff", emission: 1 }, { id: "muted", color: "#8294aa" }, { id: "baseline", color: "#7186aa" }, { id: "current", color: "#26c6b0" }],
    assets: [{ id: "chart", name: "Verified financial comparison", parts }], instances: [{ id: "chart", asset: "chart" }],
    lights: [{ id: "key", type: "AREA", position: [0, -8, 10], target: [0, 0, 0], energy: 1800, size: 10 }],
    environment: { theme: "studio", ground: false, background: "#101c2e", strength: 0.5 },
    shots: [{ start: 0, end: duration, label: "Baseline and current values on the same zero-based scale", camera: { position: [0, -25, 0], target: [0, 0, 0], projection: "ORTHO", ortho_scale: 25 } }] };
  const animationId = createHash("sha256").update(JSON.stringify({ provenance, scene })).digest("hex").slice(0, 32);
  return { animationId, provenance, scene, settings: { duration, quality: "preview", aspect: "16:9", fps: 24, reviews: 0, engine: "eevee", style: "technical" } };
}
export type AnimationPacket = ReturnType<typeof financialAnimation>;

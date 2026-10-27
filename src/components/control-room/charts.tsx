"use client";

import { useId, useState } from "react";

export interface Point { x: string; label: string; value: number | null }

interface ChartProps {
  title: string;
  subtitle?: string;
  points: Point[];
  format: (v: number | null) => string;
  kind: "bar" | "line";
  /** Test hook so E2E can count the plotted marks. */
  testId?: string;
}

const W = 640; const H = 220; const PAD = { l: 44, r: 12, t: 12, b: 28 };

function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/**
 * Single-series chart (bar or line) with a crosshair/hover tooltip, recessive
 * hairline grid, a sparse end-label and a table view. One axis only.
 */
export function Chart({ title, subtitle, points, format, kind, testId }: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const values = points.map((p) => p.value ?? 0);
  const max = Math.max(...values, 0);
  const yTicks = ticks(max);
  const yMax = yTicks[yTicks.length - 1] || 1;
  const plotW = W - PAD.l - PAD.r; const plotH = H - PAD.t - PAD.b;
  const n = Math.max(1, points.length);
  const xAt = (i: number) => PAD.l + (kind === "bar" ? (i + 0.5) * (plotW / n) : (n === 1 ? plotW / 2 : (i * plotW) / (n - 1)));
  const yAt = (v: number) => PAD.t + plotH - (v / yMax) * plotH;
  const barW = Math.min(24, Math.max(4, (plotW / n) - 2));
  const last = points.length - 1;
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className="card">
      <div className="card-head">
        <div><h3>{title}</h3>{subtitle ? <div className="muted small">{subtitle}</div> : null}</div>
        <button className="btn sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? "Chart" : "Table"}</button>
      </div>
      {table ? (
        <div className="card-body scroll-x">
          <table><thead><tr><th>Period</th><th className="num">Value</th></tr></thead>
            <tbody>{points.map((p) => <tr key={p.x}><td>{p.label}</td><td className="num">{format(p.value)}</td></tr>)}</tbody></table>
        </div>
      ) : points.length === 0 ? <div className="empty">No data in this window yet.</div> : (
        <div style={{ position: "relative", padding: "6px 10px 10px" }}>
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`} data-testid={testId}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * W;
              let best = 0; let dist = Infinity;
              points.forEach((_, i) => { const d = Math.abs(xAt(i) - x); if (d < dist) { dist = d; best = i; } });
              setHover(best);
            }}>
            <title id={`${id}-t`}>{title}</title>
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={yAt(t)} y2={yAt(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.l - 6} y={yAt(t) + 4} fontSize={10} textAnchor="end" fill="var(--ink-3)" style={{ fontVariantNumeric: "tabular-nums" }}>{format(t)}</text>
              </g>
            ))}
            {kind === "bar" ? points.map((p, i) => {
              const v = p.value ?? 0; const y = yAt(v); const h = Math.max(0, PAD.t + plotH - y);
              const r = Math.min(4, h / 2);
              const x = xAt(i) - barW / 2;
              const path = `M${x},${PAD.t + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${PAD.t + plotH} Z`;
              return <path key={p.x} d={path} fill="var(--c1)" opacity={hover === null || hover === i ? 1 : 0.55} data-mark="bar" />;
            }) : (
              <>
                <path d={points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.value ?? 0)}`).join(" ")} fill="none" stroke="var(--c1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" data-mark="line" />
                {last >= 0 ? <circle cx={xAt(last)} cy={yAt(points[last].value ?? 0)} r={4} fill="var(--c1)" stroke="var(--surface)" strokeWidth={2} /> : null}
              </>
            )}
            {last >= 0 && kind === "line" ? (
              <text x={Math.min(xAt(last), W - PAD.r - 40)} y={yAt(points[last].value ?? 0) - 8} fontSize={11} fill="var(--ink-2)" textAnchor="end">{format(points[last].value)}</text>
            ) : null}
            {points.map((p, i) => (i === 0 || i === last || (points.length > 8 && i % Math.ceil(points.length / 6) === 0)) ? (
              <text key={`x${p.x}`} x={xAt(i)} y={H - 8} fontSize={10} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} fill="var(--ink-3)">{p.label}</text>
            ) : null)}
            {hover !== null ? <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.t} y2={PAD.t + plotH} stroke="var(--ink-3)" strokeWidth={1} /> : null}
          </svg>
          {hovered ? (
            <div style={{ position: "absolute", top: 8, right: 16, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 12, boxShadow: "var(--shadow)", pointerEvents: "none" }}>
              <strong style={{ fontSize: 14 }}>{format(hovered.value)}</strong>
              <div className="muted">{hovered.label}</div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

import type { ChartSpec, PresentationExport } from "./schema";
const esc = (v: string | number) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const clip = (v: string, n: number) => v.length > n ? v.slice(0, n - 1) + "…" : v;
const ease = (v: number) => 1 - (1 - Math.max(0, Math.min(1, v))) ** 3;
export function chartScale(values: number[]) {
  const rawMin = Math.min(0, ...values), rawMax = Math.max(0, ...values);
  const rawStep = (rawMax - rawMin || 1) / 3, magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 2.5, 5, 10].find(factor => factor * magnitude >= rawStep) ?? 10) * magnitude;
  const min = Math.floor(rawMin / step) * step, max = Math.max(min + step, Math.ceil(rawMax / step) * step);
  return { min, max, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + step * i) };
}
export function displayValue(value: number | null, unit: string, compact = false) {
  if (value === null) return "No observation";
  const n = unit.startsWith("GBP minor") ? value / 100 : unit === "ratio" ? value * 100 : value;
  const text = new Intl.NumberFormat("en-GB", { maximumFractionDigits: compact ? 1 : 2, ...(compact && Math.abs(n) >= 10000 ? { notation: "compact" as const } : {}) }).format(n);
  return (unit.startsWith("GBP") ? "£" : unit.startsWith("USD") ? "$" : "") + text + (unit === "USD billions" ? "B" : unit.startsWith("USD millions") ? "M" : unit === "ratio" || unit === "%" ? "%" : unit === "multiple" ? "×" : unit.endsWith("/hour") ? "/h" : "");
}
/** The same SVG function drives the browser preview and every exported video frame. */
export function presentationSvg(request: PresentationExport, seconds: number, width = 1920, height = 1080) {
  const dark = request.theme === "midnight";
  const c = { bg: dark ? "#091910" : "#f2f3ed", card: dark ? "#12271b" : "#ffffff", edge: dark ? "#2b4935" : "#d9dfd2", text: dark ? "#f2f7ec" : "#182c1b", muted: dark ? "#a0b6a5" : "#677362", grid: dark ? "#2b4031" : "#e3e7de", accents: dark ? ["#b1e98a", "#8cbfe0", "#dbc4f1", "#efba8b"] : ["#4f8539", "#4b86ad", "#9875b8", "#c98446"] };
  const svg: string[] = [];
  const text = (x: number, y: number, s: string | number, size: number, fill = c.text, weight = 400, anchor = "start", opacity = 1) => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}">${esc(s)}</text>`;
  const rect = (x: number, y: number, w: number, h: number, fill: string, r = 20, stroke = "none") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
  const line = (x1: number, y1: number, x2: number, y2: number, color = c.grid, extra = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" ${extra}/>`;
  const t = Math.max(0, Math.min(request.duration, seconds));
  const charts = request.presentation.charts;
  // A dashboard opens with all cards, then focuses on each actual chart, then returns to the overview.
  const multi = charts.length > 1;
  const intro = multi ? 2 : 0;
  const focusSpan = Math.max(1, request.duration - intro - (multi ? 2 : 0));
  const active = multi && t >= intro && t < request.duration - 2 ? Math.min(charts.length - 1, Math.floor((t - intro) / focusSpan * charts.length)) : multi ? -1 : 0;
  const local = active < 0 ? t : multi ? (t - intro) % (focusSpan / charts.length) : t;
  const progress = active < 0 ? ease(t / 1.5) : ease(local / Math.min(2.2, multi ? focusSpan / charts.length * .7 : 3));
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1920 1080" role="img" aria-label="${esc(request.presentation.title)}"><defs><linearGradient id="ambience" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c.bg}"/><stop offset="1" stop-color="${dark ? "#183423" : "#e5ecdc"}"/></linearGradient></defs><rect width="1920" height="1080" fill="url(#ambience)"/><g font-family="Avenir Next, Arial, sans-serif">`);
  svg.push(`<circle cx="83" cy="65" r="14" fill="${c.accents[0]}"/><circle cx="83" cy="65" r="6" fill="${c.bg}"/>`, text(110, 74, "ExplainWhy", 26, c.text, 700), text(1840, 72, "DASHBOARD → PRESENTATION", 17, c.muted, 500, "end"));
  svg.push(text(78, 150, clip(request.presentation.title, 74), 48, c.text, 650), text(80, 192, clip(request.presentation.subtitle ?? "Your dashboard values, brought to life.", 130), 23, c.muted));

  function chartPanel(chart: ChartSpec, x: number, y: number, w: number, h: number, compact: boolean, p: number, index: number) {
    let out = rect(x, y, w, h, c.card, 25, c.edge);
    const fs = compact ? 24 : 32;
    out += text(x + 32, y + 48, clip(chart.title, compact ? 32 : 90), fs, c.text, 600);
    out += text(x + 32, y + 78, clip(chart.subtitle ?? chart.unit, compact ? 48 : 110), compact ? 15 : 19, c.muted);
    if (chart.summary) out += text(x + w - 32, y + 49, displayValue(chart.summary.value * p, chart.unit, compact), compact ? 30 : 48, c.accents[index % 4], 650, "end") + text(x + w - 32, y + 78, chart.summary.label, compact ? 13 : 18, c.muted, 400, "end");
    const vals = chart.series.flatMap(series => series.points.flatMap(point => point.value === null ? [] : [point.value]));
    if (!vals.length) return out + text(x + w / 2, y + h / 2, "No observed values in this window", 24, c.muted, 400, "middle");
    if (chart.kind === "gauge") {
      const value = chart.series[0].points[0]?.value;
      if (value == null) return out;
      const cx = x + w / 2, cy = y + h * .77, r = Math.min(w * .3, h * .42);
      const end = (Math.max(0, Math.min(100, value)) * p / 100) * Math.PI;
      const arc = (a: number, b: number, color: string) => `<path d="M ${cx - Math.cos(a) * r} ${cy - Math.sin(a) * r} A ${r} ${r} 0 0 1 ${cx - Math.cos(b) * r} ${cy - Math.sin(b) * r}" stroke="${color}" stroke-width="${compact ? 24 : 38}" fill="none"/>`;
      out += arc(0, Math.PI / 3, "#7bbd61") + arc(Math.PI / 3, Math.PI * 2 / 3, "#dfbc64") + arc(Math.PI * 2 / 3, Math.PI, "#d67565");
      out += line(cx, cy, cx - Math.cos(end) * r * .84, cy - Math.sin(end) * r * .84, c.text, 'stroke-width="7" stroke-linecap="round"');
      out += `<circle cx="${cx}" cy="${cy}" r="12" fill="${c.text}"/>`;
      out += text(cx, cy - r * .3, displayValue(value * p, chart.unit), compact ? 43 : 70, c.text, 650, "middle");
      return out + text(cx, cy + 40, "Recorded score / 100", compact ? 16 : 22, c.muted, 400, "middle");
    }
    const left = x + (compact ? 78 : 138), right = x + w - 38, top = y + (compact ? 122 : 160), bottom = y + h - (compact ? 65 : 95);
    const { min, max, ticks } = chartScale([...vals, chart.baseline ?? 0]);
    const yy = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);
    for (const value of ticks) {
      out += line(left, yy(value), right, yy(value));
      out += text(left - 14, yy(value) + 6, displayValue(value, chart.unit, true), compact ? 13 : 20, c.muted, 400, "end");
    }
    if (chart.baseline !== undefined) out += line(left, yy(chart.baseline), right, yy(chart.baseline), c.muted, 'stroke-dasharray="7 6"') + text(right, yy(chart.baseline) - 10, `Baseline ${displayValue(chart.baseline, chart.unit)}`, compact ? 12 : 17, c.muted, 400, "end");
    const points = chart.series[0].points;
    const allX = chart.series.flatMap(series => series.points.flatMap(point => point.x === undefined ? [] : [point.x]));
    const xMin = Math.min(...allX), xMax = Math.max(...allX);
    const at = (i: number, n: number, xv?: number) => xv !== undefined && xMax > xMin ? left + (xv - xMin) / (xMax - xMin) * (right - left) : chart.kind === "line" ? left + (n === 1 ? .5 : i / (n - 1)) * (right - left) : left + (i + .5) * (right - left) / n;
    chart.series.forEach((series, si) => {
      const color = c.accents[(index + si) % c.accents.length];
      const gradientId = `bar-${index}-${si}`;
      out += `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".65"/></linearGradient></defs>`;
      const n = series.points.length;
      const cadence = series.points.slice(1).flatMap((point, i) => point.x !== undefined && series.points[i].x !== undefined && point.x > series.points[i].x! ? [point.x - series.points[i].x!] : []).sort((a, b) => a - b);
      const gap = cadence.length ? cadence[Math.floor(cadence.length / 2)] * 1.6 : Infinity;
      if (chart.kind === "line") {
        let path = "", connected = false;
        const reveal = p * Math.max(1, n - 1);
        series.points.forEach((point, i) => {
          if (point.value === null || i > Math.ceil(reveal)) { connected = false; return; }
          const prev = series.points[i - 1];
          if (prev?.x !== undefined && point.x !== undefined && point.x - prev.x > gap) connected = false;
          const px = at(i, n, point.x), py = yy(point.value);
          if (i > reveal && prev?.value != null && connected) {
            const f = reveal - (i - 1); path += ` L${at(i - 1, n, prev.x) + (px - at(i - 1, n, prev.x)) * f},${yy(prev.value) + (py - yy(prev.value)) * f}`;
          } else { path += `${connected ? " L" : " M"}${px},${py}`; }
          connected = true;
          if (i <= reveal) out += `<circle cx="${px}" cy="${py}" r="${compact ? 3 : 5}" fill="${color}"/>`;
        });
        out += `<path d="${path}" fill="none" stroke="${color}" stroke-width="${compact ? 3 : 5}" stroke-linecap="round" stroke-linejoin="round"/>`;
      } else {
        const slot = (right - left) / Math.max(n, 1), bw = Math.min(compact ? 54 : 110, slot * .65 / chart.series.length);
        series.points.forEach((point, i) => {
          if (point.value === null) return;
          const pp = ease(Math.max(0, p * 1.35 - i / n * .35));
          const px = at(i, n) - bw * chart.series.length / 2 + bw * si;
          const y0 = yy(0), yv = yy(point.value * pp);
          out += rect(px, Math.min(y0, yv), Math.max(1, bw - 3), Math.max(.01, Math.abs(y0 - yv)), `url(#${gradientId})`, Math.min(8, Math.abs(y0 - yv) / 3));
          if (!compact && n <= 12 && p > .85) out += text(px + bw / 2, point.value >= 0 ? yv - 15 : yv + 24, displayValue(point.value, chart.unit), 21, color, 600, "middle", ease((p - .85) / .15));
        });
      }
      if (chart.series.length > 1) out += `<circle cx="${x + 34 + si * Math.min(230, w / 4)}" cy="${y + h - 20}" r="5" fill="${color}"/>` + text(x + 48 + si * Math.min(230, w / 4), y + h - 14, clip(series.name, 20), compact ? 13 : 17, c.muted);
    });
    const every = Math.ceil(points.length / (compact ? 4 : 8));
    points.forEach((point, i) => { if (i === 0 || i === points.length - 1 || i % every === 0) out += text(at(i, points.length, chart.kind === "line" ? point.x : undefined), bottom + 33, clip(point.label, compact ? 13 : 22), compact ? 12 : 18, c.muted, 400, i === 0 && chart.kind === "line" ? "start" : i === points.length - 1 && chart.kind === "line" ? "end" : "middle"); });
    return out;
  }
  if (active < 0) {
    const cols = charts.length <= 4 ? 2 : 3, rows = Math.ceil(charts.length / cols), gap = 22;
    const w = (1764 - (cols - 1) * gap) / cols, h = (716 - (rows - 1) * gap) / rows;
    charts.forEach((chart, i) => svg.push(chartPanel(chart, 78 + i % cols * (w + gap), 240 + Math.floor(i / cols) * (h + gap), w, h, true, progress, i)));
  } else {
    const reveal = ease(local / .32);
    svg.push(`<g opacity="${reveal}" transform="translate(0 ${(1 - reveal) * 22})">`, chartPanel(charts[active], 78, 240, 1764, 716, false, progress, active), "</g>");
    if (multi) svg.push(text(1804, 285, `${active + 1} / ${charts.length}`, 19, c.muted, 500, "end"));
  }
  svg.push(text(80, 1001, request.presentation.synthetic ? "SYNTHETIC BUSINESS DATA · Dashboard snapshot · Animation illustrates recorded values" : "DASHBOARD SNAPSHOT · Animation illustrates recorded values", 16, c.muted));
  svg.push(text(1840, 1001, active >= 0 ? clip(charts[active].source ?? "", 72) : "Same data. Presentation ready.", 15, c.muted, 400, "end"));
  svg.push(line(80, 1035, 1840, 1035), line(80, 1035, 80 + 1760 * t / request.duration, 1035, c.accents[0], 'stroke-width="3"'), "</g></svg>");
  return svg.join("");
}

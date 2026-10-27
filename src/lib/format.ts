/** Client-safe formatting helpers (no server-only imports). */
export function money(minor: number | null | undefined, currency = "GBP"): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}
export function moneyCompact(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "—";
  const v = minor / 100;
  if (Math.abs(v) >= 10_000) return `£${(v / 1000).toFixed(1)}k`;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);
}
export function pct(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}
export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB").format(n);
}
export function fixed(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}
export function virtualDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}
export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}
export const CATEGORY_LABEL: Record<string, string> = {
  running: "Running", basketball: "Basketball", lifestyle: "Lifestyle", football: "Football", apparel: "Apparel",
};

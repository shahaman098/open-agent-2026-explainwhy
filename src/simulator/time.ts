export function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}
export function addHours(iso: string, hours: number): string {
  return addMinutes(iso, hours * 60);
}
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
}
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}
export function pad(n: number, width = 6): string {
  return n.toString(36).padStart(width, "0");
}

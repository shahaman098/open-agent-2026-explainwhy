/**
 * Documents are stored as Postgres jsonb. JSON has no Date type, so Dates are tagged as
 * `{ "$date": iso }` on the way in and revived on the way out; `undefined` is stored as null,
 * matching the MongoDB driver's default serialisation.
 */

export function encodeDoc(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string, v: unknown) {
    const raw = this[key];
    if (raw instanceof Date) return { $date: Number.isNaN(raw.getTime()) ? null : raw.toISOString() };
    if (v === undefined) return null;
    if (typeof v === "number" && !Number.isFinite(v)) return { $num: String(v) };
    if (typeof v === "bigint") return Number(v);
    if (raw instanceof RegExp) return { $regex: raw.source, $options: raw.flags };
    return v;
  });
}

export function reviveValue(_key: string, v: unknown): unknown {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    let only: string | undefined;
    for (const k in o) { if (only !== undefined) return v; only = k; }
    if (only === "$date") return new Date((o.$date as string | null) ?? Number.NaN);
    if (only === "$num") return Number(o.$num);
  }
  return v;
}

export function decodeDoc<T = Record<string, unknown>>(text: string): T {
  return JSON.parse(text, reviveValue) as T;
}

/** Deep copy that keeps Dates as Dates. */
export function cloneDoc<T>(value: T): T {
  return decodeDoc<T>(encodeDoc(value));
}

let counter = Math.floor(Math.random() * 0xffffff);
const processPart = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("");

/** ObjectId-shaped hex string: sorts by creation second like a MongoDB ObjectId. */
export function newObjectId(): string {
  counter = (counter + 1) % 0xffffff;
  return Math.floor(Date.now() / 1000).toString(16).padStart(8, "0") + processPart + counter.toString(16).padStart(6, "0");
}

/** Stable text key for the `_id` column. */
export function idKey(id: unknown): string {
  return typeof id === "string" ? id : encodeDoc(id);
}

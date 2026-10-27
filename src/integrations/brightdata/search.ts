import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { boundedJson } from "../bounded-json";
import { canonicalUrl } from "@/intelligence/investigator/safe-fetch";

const Result = z.object({ link: z.string().max(2000), title: z.string().max(1000).optional(), description: z.string().max(4000).optional() });
const Search = z.object({ organic: z.array(Result).max(100) });
export const BRIGHTDATA_ROUTE = "https://api.brightdata.com/request";
export function brightDataStatus() {
  return { configured: Boolean(process.env.BRIGHTDATA_API_KEY?.trim() && /^[a-zA-Z0-9_-]{1,100}$/.test(process.env.BRIGHTDATA_SERP_ZONE || "")) };
}

/** One public-topic query. No operational records, model-written instructions or arbitrary target URLs. */
export async function searchBrightData(query: string, transport: typeof fetch = fetch) {
  if (!brightDataStatus().configured) throw new Error("brightdata_not_configured");
  if (!query || query.length > 1000) throw new Error("invalid_search_query");
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query); url.searchParams.set("brd_json", "1");
  const started = Date.now();
  let response: Response;
  try {
    response = await transport(BRIGHTDATA_ROUTE, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY!.trim()}` },
      body: JSON.stringify({ zone: process.env.BRIGHTDATA_SERP_ZONE, url: url.href, format: "json" }) });
  } catch { throw new Error("brightdata_unavailable_or_timeout"); }
  const data = Search.parse(await boundedJson(response));
  const candidates = data.organic.flatMap((row) => {
    try { return [{ url: canonicalUrl(row.link), claim: (row.description || row.title || "Public source requiring review").slice(0, 2000), excerpt: "" }]; }
    catch { return []; }
  }).filter((row, index, rows) => rows.findIndex((other) => other.url === row.url) === index).slice(0, 8);
  return { candidates, requestId: response.headers.get("x-brd-request-id") || response.headers.get("x-request-id") || randomUUID(), latencyMs: Date.now() - started };
}

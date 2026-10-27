import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { zetarisConfig, type ZetarisConfig } from "./config";

const Page = z.object({
  records: z.array(z.unknown()).default([]), queryToken: z.string().min(1).max(2048),
  pageNumber: z.number().int().min(0), totalCount: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
});
export interface QueryReceipt { requestId: string; fetchedAt: string; rowCount: number; pages: number; closed: boolean }

/** The only SQL caller is the fixed campaign-query builder. No model-authored SQL or public SQL endpoint. */
export async function queryZetaris(select: string, options: { config?: ZetarisConfig; fetch?: typeof fetch; maxRows?: number } = {}) {
  if (!/^SELECT\s/i.test(select) || /;|--|\/\*/.test(select)) throw new Error("Only a single server-built SELECT is allowed");
  const config = options.config ?? zetarisConfig(), transport = options.fetch ?? fetch;
  const maxRows = options.maxRows ?? 5000;
  const requestId = randomUUID(), signal = AbortSignal.timeout(18_000);
  const headers = { "content-type": "application/json", authorization: `Bearer ${config.apiKey}`, "X-Org-ID": config.orgId, "X-Request-ID": requestId };
  const request = async (path: string, init?: RequestInit) => {
    let response: Response;
    try { response = await transport(`${config.baseUrl}${path}`, { ...init, headers, signal, redirect: "error", cache: "no-store" }); }
    catch { throw new Error("Zetaris request failed or timed out; no evidence accepted"); }
    // Never reflect response bodies: gateways can include credentials or private SQL diagnostics.
    if (!response.ok) throw new Error(`Zetaris returned HTTP ${response.status}; no evidence accepted`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Zetaris returned an empty response");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2_000_000) { await reader.cancel(); throw new Error("Zetaris response exceeded the size limit"); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const data = Buffer.concat(chunks).toString("utf8");
    try { return JSON.parse(data) as unknown; } catch { throw new Error("Zetaris returned invalid JSON"); }
  };
  let token: string | undefined;
  let receipt: QueryReceipt | undefined;
  try {
    const raw = await request("/api/v1.0/query/sql/start", { method: "POST", body: JSON.stringify({ select, pageLimit: 100 }) });
    // Capture an allocated cursor even if another response field fails validation.
    const candidate = z.object({ queryToken: z.string().min(1).max(2048) }).safeParse(raw);
    if (candidate.success) token = candidate.data.queryToken;
    const first = Page.parse(raw); token = first.queryToken;
    if (first.totalCount > maxRows || first.totalPages > Math.ceil(maxRows / 100)) throw new Error("Zetaris query exceeds the bounded evidence limit; narrow the window");
    const records = [...first.records]; let pages = 1;
    for (let pageNumber = first.pageNumber + 1; records.length < first.totalCount; pageNumber++) {
      if (pages >= Math.ceil(maxRows / 100) || records.length >= maxRows) throw new Error("Zetaris pagination exceeded the evidence limit");
      const params = new URLSearchParams({ queryToken: token, pageLimit: "100", pageNumber: String(pageNumber) });
      const page = Page.parse(await request(`/api/v1.0/query/sql/page?${params}`));
      if (page.queryToken !== token || page.pageNumber !== pageNumber || page.totalCount !== first.totalCount || page.totalPages !== first.totalPages || !page.records.length) throw new Error("Zetaris pagination is incomplete or inconsistent");
      records.push(...page.records); pages++;
    }
    if (records.length !== first.totalCount || records.length > maxRows) throw new Error("Zetaris result count does not match its cursor metadata");
    receipt = { requestId, fetchedAt: new Date().toISOString(), rowCount: records.length, pages, closed: false };
    return { records, receipt };
  } finally {
    if (token) {
      try {
        const response = await transport(`${config.baseUrl}/api/v1.0/query/sql/close/${encodeURIComponent(token)}`, {
          method: "DELETE", headers, signal: AbortSignal.timeout(3000), redirect: "error", cache: "no-store",
        });
        if (receipt) receipt.closed = response.ok;
      } catch { /* Receipt exposes cursor cleanup failure. Never discard an earlier query error. */ }
    }
  }
}

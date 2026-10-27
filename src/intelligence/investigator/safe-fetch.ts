import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 2) || (b === 88 && c === 99))) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Only global unicast IPv6, excluding transition/tunnel and documentation ranges.
  if (isIP(address) === 6) return /^2[0-9a-f]{3}:/i.test(address) && !/^200[12]:|^2001:(?:db8|0*0|0*1[0-9a-f]|0*2[0-9a-f]):/i.test(address);
  return false;
}
export function canonicalUrl(value: string): string {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || u.hostname.endsWith(".") || u.hostname.length > 253) throw new Error("unsafe_url");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || /\.(localhost|local|internal|test|invalid)$/i.test(host) || (isIP(host) && !publicAddress(host))) throw new Error("unsafe_destination");
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  return u.href;
}
export interface PageResponse { url: string; status: number; body: string; headers: Record<string, string | string[] | undefined> }

/** DNS is validated and pinned for the actual TLS socket on EVERY redirect; no unchecked second resolution. */
export async function safeFetch(value: string, redirects = 0, deadline = Date.now() + 15000, beforeRequest?: (url: URL) => Promise<void>): Promise<PageResponse> {
  if (redirects > 3 || Date.now() >= deadline) throw new Error("retrieval_limit");
  const url = new URL(canonicalUrl(value));
  if (beforeRequest) await beforeRequest(url);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw new Error("unsafe_dns");
  const pinned = addresses[0];
  const page = await new Promise<PageResponse>((resolve, reject) => {
    const req = https.request(url, { method: "GET", agent: false, headers: { "user-agent": "NormalResearch/1.0", accept: "text/html,text/plain,application/json", "accept-encoding": "identity" },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [pinned]); else callback(null, pinned.address, pinned.family);
      },
    }, (res) => {
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 512000) req.destroy(new Error("page_too_large")); else chunks.push(chunk); });
      res.on("end", () => resolve({ url: url.href, status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new Error("retrieval_timeout")), Math.max(1, deadline - Date.now()));
    req.on("error", reject); req.on("close", () => clearTimeout(timer)); req.end();
  });
  if ([301, 302, 303, 307, 308].includes(page.status)) {
    if (typeof page.headers.location !== "string") throw new Error("invalid_redirect");
    return safeFetch(new URL(page.headers.location, url).href, redirects + 1, deadline, beforeRequest);
  }
  return page;
}

/** Conservative robots parser: any matching applicable Disallow blocks; uncertain/unavailable policy blocks. */
export function robotsAllowed(body: string, path: string): boolean {
  let applies = false, rulesSeen = false;
  for (const line of body.split(/\r?\n/)) {
    const [key, ...rest] = line.replace(/#.*$/, "").split(":"); const value = rest.join(":").trim();
    const field = key.trim().toLowerCase();
    if (field === "user-agent") {
      if (rulesSeen) { applies = false; rulesSeen = false; }
      applies ||= value === "*" || /normalresearch/i.test(value);
    } else if (field === "allow" || field === "disallow") {
      rulesSeen = true;
      if (applies && field === "disallow" && value) {
        const pattern = value.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
        if (new RegExp(`^${pattern}`).test(path)) return false;
      }
    }
  }
  return true;
}
export async function retrievePermittedPage(value: string): Promise<PageResponse> {
  const u = new URL(canonicalUrl(value));
  const page = await safeFetch(u.href, 0, Date.now() + 30000, async (target) => {
    const robots = await safeFetch(new URL("/robots.txt", target).href);
    if (robots.status !== 404 && (robots.status !== 200 || !robotsAllowed(robots.body, target.pathname + target.search))) throw new Error("robots_restricted_or_unavailable");
  });
  const contentType = String(page.headers["content-type"] || "");
  if (!/text\/(html|plain)|application\/json/i.test(contentType)) throw new Error("unsupported_content_type");
  return page;
}

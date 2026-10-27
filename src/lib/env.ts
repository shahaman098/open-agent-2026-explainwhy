import "server-only";

/**
 * Access control for simulator controls and other dangerous mutation routes.
 *
 * Allowed when:
 *  - NODE_ENV === "development" (local hacking), or
 *  - NORMAL_DEMO_MODE === "true" AND the request carries header
 *    `x-normal-demo-key` equal to NORMAL_DEMO_KEY (separately configured demo).
 *
 * Everything else is answered with 404 so the routes are indistinguishable from
 * non-existent ones in production.
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

export function demoModeConfigured(): boolean {
  return process.env.NORMAL_DEMO_MODE === "true" && Boolean(process.env.NORMAL_DEMO_KEY);
}

export function isPrivilegedRequest(request: Request | undefined): boolean {
  if (isDevelopment()) return true;
  if (!demoModeConfigured() || !request) return false;
  const provided = request.headers.get("x-normal-demo-key");
  return provided !== null && timingSafeEqualString(provided, process.env.NORMAL_DEMO_KEY ?? "");
}

/** Ingest API: development, or a configured NORMAL_INGEST_API_KEY presented as a bearer token. */
export function isIngestAuthorised(request: Request): boolean {
  if (isPrivilegedRequest(request)) return true;
  const expected = process.env.NORMAL_INGEST_API_KEY;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqualString(token, expected);
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

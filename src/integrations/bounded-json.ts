import "server-only";

/** Read provider responses with a byte limit; never include upstream bodies in errors. */
export async function boundedJson(response: Response, limit = 1_000_000): Promise<unknown> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`upstream_http_${response.status}`); }
  if (!response.body) throw new Error("upstream_empty_response");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("upstream_response_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("upstream_invalid_json"); }
}

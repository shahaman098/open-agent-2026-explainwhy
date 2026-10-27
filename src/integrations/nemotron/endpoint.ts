import "server-only";

/** Cloud credentials never cross into a local inference server. Local mode is explicit. */
export function nvidiaEndpoint() {
  const mode = process.env.NVIDIA_INFERENCE_MODE || "cloud";
  if (mode !== "cloud" && mode !== "local") throw new Error("invalid_inference_mode");
  const local = mode === "local";
  const url = new URL(process.env.NVIDIA_BASE_URL || (local ? "http://127.0.0.1:11434/v1" : "https://integrate.api.nvidia.com/v1"));
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, "") !== "/v1"
    || (local ? !loopback || !["http:", "https:"].includes(url.protocol) : url.protocol !== "https:" || loopback)) throw new Error("invalid_base_url");
  const key = local ? process.env.NVIDIA_LOCAL_API_KEY?.trim() || "local" : process.env.NVIDIA_API_KEY?.trim();
  if (!key) throw new Error("missing_nvidia_key");
  return { base: url.href.replace(/\/$/, ""), key, local };
}

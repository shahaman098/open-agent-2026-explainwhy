export const NVIDIA_BUSINESS_ID = "nvidia_demo";
export function workspaceName(businessId: string) { return businessId === NVIDIA_BUSINESS_ID ? "NVIDIA" : "Nike"; }
export function workspaceFromSearch(search: string) { return new URLSearchParams(search).get("businessId") || "nike_demo"; }
export function workspaceApiPath(input: string) {
  if (typeof window === "undefined" || !input.startsWith("/api/")) return input;
  const url = new URL(input, window.location.origin);
  if (!url.searchParams.has("businessId")) url.searchParams.set("businessId", workspaceFromSearch(window.location.search));
  return url.pathname + url.search;
}

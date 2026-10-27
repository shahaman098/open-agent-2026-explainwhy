import type { APIRequestContext } from "@playwright/test";

/** Dedicated E2E run inside the default demo business; reset at the start of each spec. */
export const E2E_RUN = "e2e_run";

export async function resetE2ERun(request: APIRequestContext, seed = 42): Promise<void> {
  const res = await request.post("/api/dev/simulator/start", { data: { simulationRunId: E2E_RUN, seed, reset: true, makeActive: true } });
  if (res.status() !== 201) throw new Error(`start failed: ${res.status()} ${await res.text()}`);
}

export async function tick(request: APIRequestContext, ticks: number): Promise<void> {
  const res = await request.post("/api/dev/simulator/tick", { data: { simulationRunId: E2E_RUN, ticks } });
  if (!res.ok()) throw new Error(`tick failed: ${res.status()} ${await res.text()}`);
}

export async function products(request: APIRequestContext): Promise<Array<{ productId: string; availableUnits: number; priceMinor: number; name: string }>> {
  const res = await request.get("/api/demo-store/products");
  return ((await res.json()) as { products: Array<{ productId: string; availableUnits: number; priceMinor: number; name: string }> }).products;
}

import { readJson } from "@/lib/api";
import { handleRouteError } from "@/lib/route-helpers";
import { checkout } from "@/simulator/checkout";

/**
 * POST /api/demo-store/checkout — synthetic purchase. Body: CheckoutRequest.
 * Prices come from the server; stock is reserved atomically; never asks for payment details.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const result = await checkout(await readJson(request));
    const status = result.status === "completed" ? 201 : result.status === "replayed" ? 200 : 409;
    return Response.json(result, { status });
  } catch (error) {
    return handleRouteError(error, "demo-store/checkout");
  }
}

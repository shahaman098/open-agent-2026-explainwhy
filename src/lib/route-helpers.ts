import "server-only";

import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { apiError, notFound, zodIssuesMessage } from "@/lib/api";
import { describeDbError } from "@/lib/mongodb";
import { isPrivilegedRequest } from "@/lib/env";
import { DEFAULT_BUSINESS_ID } from "@/simulator/config";
import { SimulatorError } from "@/simulator/runtime";

const BUSINESS_ID = /^[a-z0-9_]{1,64}$/;

/** Returns a 404 Response when the caller is not allowed to use dev/demo controls. */
export function guardDevRoute(request: Request): Response | null {
  return isPrivilegedRequest(request) ? null : notFound();
}

/** Business scoping for this stage: a validated businessId, defaulting to the Nike demo tenant. */
export function businessIdFrom(request: Request): string {
  const value = new URL(request.url).searchParams.get("businessId") ?? DEFAULT_BUSINESS_ID;
  if (!BUSINESS_ID.test(value)) throw new SimulatorError("Invalid businessId", "invalid_business", 400);
  return value;
}

export function handleRouteError(error: unknown, context: string): Response {
  // Let Next.js prerender bail-out / navigation signals propagate instead of being reported as 500s.
  unstable_rethrow(error);
  if (error instanceof ZodError) return apiError("validation_error", zodIssuesMessage(error), 400);
  if (error instanceof SimulatorError) return apiError(error.code, error.message, error.status);
  if (error instanceof Error && (error.name === "MonitorError" || error.name === "EvidenceError")) {
    const e = error as Error & { code: string; status: number };
    return apiError(e.code, e.message, e.status);
  }
  if (error instanceof Error && error.name === "AdapterError") {
    const code = (error as Error & { code?: string }).code ?? "adapter_error";
    return apiError(code, error.message, 400);
  }
  console.error(`[${context}]`, describeDbError(error));
  return apiError("internal_error", "The request could not be completed", 500);
}

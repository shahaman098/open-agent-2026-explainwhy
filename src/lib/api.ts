import { randomUUID } from "node:crypto";
import type { ZodError } from "zod";

/** Builds the canonical `ApiError` envelope from @normal/contracts. */
export function apiError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message, requestId: randomUUID() } }, { status });
}

export function notFound(): Response {
  return apiError("not_found", "Not found", 404);
}

export function zodIssuesMessage(error: ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

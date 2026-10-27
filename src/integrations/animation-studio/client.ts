import "server-only";
import { z } from "zod";
import { boundedJson } from "../bounded-json";
import type { AnimationPacket } from "./scene";

export class AnimationError extends Error {
  constructor(readonly code: string, readonly dispatched = false) { super(code); this.name = "AnimationError"; }
}
export function studioBase() {
  if (process.env.EXPLAINWHY_ANIMATION_ENABLED !== "true") throw new AnimationError("animation_disabled");
  const url = new URL(process.env.ANIMATION_STUDIO_BASE_URL || "http://127.0.0.1:8765");
  // The Studio itself is loopback-only. Both apps run on the friend's Mac.
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new AnimationError("invalid_animation_endpoint");
  return url.origin;
}
const Job = z.object({ id: z.string().regex(/^[a-f0-9]{16}$/), status: z.enum(["queued", "running", "complete", "failed", "cancelled", "interrupted"]),
  message: z.string().max(4000).optional(), video: z.string().max(1000).optional(), blend: z.string().max(1000).optional() });
export type StudioJob = z.infer<typeof Job>;
export function publicStudioJob(job: StudioJob) {
  const base = studioBase();
  const artifact = (value?: string) => value && new RegExp(`^/artifacts/${job.id}/[A-Za-z0-9_./-]+$`).test(value) && !value.includes("..") ? `${base}${value}` : null;
  return { id: job.id, status: job.status, message: job.message, video: artifact(job.video), blend: artifact(job.blend), studioUrl: `${base}/` };
}
export async function studioStatus(transport: typeof fetch = fetch) {
  const response = await transport(`${studioBase()}/api/status`, { signal: AbortSignal.timeout(5000), redirect: "error", cache: "no-store" });
  return z.object({ token: z.string().min(16).max(256), ready: z.boolean() }).parse(await boundedJson(response));
}
export async function submitAnimation(packet: AnimationPacket, transport: typeof fetch = fetch) {
  let token: string;
  try { const status = await studioStatus(transport); if (!status.ready) throw new Error(); token = status.token; }
  catch { throw new AnimationError("animation_studio_unavailable_or_not_ready"); }
  try {
    const response = await transport(`${studioBase()}/api/jobs/from-scene`, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", "X-Orbit-Token": token }, body: JSON.stringify({ scene: packet.scene, ...packet.settings }) });
    // A definite client rejection allocated no job. Never retry ambiguous/network outcomes automatically.
    if ([400, 403, 409].includes(response.status)) throw new AnimationError(response.status === 409 ? "animation_studio_busy" : "animation_studio_rejected_scene");
    return Job.parse(await boundedJson(response));
  } catch (error) {
    if (error instanceof AnimationError) throw error;
    throw new AnimationError("animation_submission_outcome_unknown", true);
  }
}
export async function readStudioJob(id: string, transport: typeof fetch = fetch) {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new AnimationError("invalid_animation_job");
  try {
    const response = await transport(`${studioBase()}/api/jobs/${id}`, { signal: AbortSignal.timeout(5000), redirect: "error", cache: "no-store" });
    const job = Job.parse(await boundedJson(response));
    if (job.id !== id) throw new Error();
    return publicStudioJob(job);
  } catch { throw new AnimationError("animation_status_unavailable"); }
}

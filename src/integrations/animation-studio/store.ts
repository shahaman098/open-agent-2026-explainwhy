import "server-only";
import type { Db } from "mongodb";
import type { ScopeT } from "@/intelligence/investigator/schemas";
import { AnimationError, submitAnimation } from "./client";
import type { AnimationPacket } from "./scene";

export const ANIMATIONS = "financial_animations";
export interface AnimationDoc extends ScopeT { _id: string; status: "submitting" | "submitted" | "failed" | "unknown"; packet: AnimationPacket; studioJobId: string | null; error: string | null; createdAt: string }
export async function queueAnimation(db: Db, scope: ScopeT, packet: AnimationPacket, submit = submitAnimation) {
  const col = db.collection<AnimationDoc>(ANIMATIONS), filter = { ...scope, _id: packet.animationId };
  const existing = await col.findOne(filter);
  if (existing && existing.status !== "failed") return existing;
  const doc: AnimationDoc = { ...scope, _id: packet.animationId, status: "submitting", packet, studioJobId: null, error: null, createdAt: new Date().toISOString() };
  if (existing) {
    const claimed = await col.updateOne({ ...filter, status: "failed" }, { $set: { status: "submitting", error: null } });
    if (!claimed.modifiedCount) return (await col.findOne(filter))!;
  } else {
    try { await col.insertOne(doc); }
    catch (error) { if ((error as { code?: number }).code === 11000) return (await col.findOne(filter))!; throw error; }
  }
  let result: Pick<AnimationDoc, "status" | "studioJobId" | "error">;
  try { const job = await submit(packet); result = { status: "submitted", studioJobId: job.id, error: null }; }
  catch (error) {
    const known = error instanceof AnimationError;
    result = { status: known && !error.dispatched ? "failed" : "unknown", studioJobId: null, error: known ? error.code : "animation_submission_outcome_unknown" };
  }
  await col.updateOne(filter, { $set: result });
  return { ...doc, ...result };
}

import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { SOURCE_PROMPT_VERSION, SOURCE_TASK } from "@/intelligence/investigator/source-task";
import { SourceAssessments } from "@/intelligence/investigator/schemas";
import type { CallDoc } from "@/intelligence/investigator/store";
import type { TaskProfileDoc } from "@/intelligence/training/task-profile";
import { createHash } from "node:crypto";

const Body = z.object({ callId: z.string().min(1), decision: z.enum(["approve", "reject"]) }).strict();

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Not found" }, { status: 404 });
  const body = Body.parse(await request.json());
  const db = await getDb();
  const call = await db.collection<CallDoc>(COLLECTIONS.investigationCalls).findOne({ callId: body.callId });
  if (!call || call.task !== SOURCE_TASK || call.status !== "completed" || !call.result || !("value" in call.result)) {
    return Response.json({ error: "call_not_eligible" }, { status: 400 });
  }
  if (body.decision === "reject") return Response.json({ callId: body.callId, decision: "reject" });
  const output = SourceAssessments.parse(call.result.value);
  const profileId = `tp_${createHash("sha256").update(`${call.promptFingerprint}:${call.callId}`).digest("hex").slice(0, 24)}`;
  const now = new Date().toISOString();
  const existing = await db.collection<TaskProfileDoc>(COLLECTIONS.taskProfiles).findOne({ profileId });
  const examples = [...(existing?.examples ?? []), { input: call.inputSnapshot ?? null, output, sourceCallId: call.callId, approvedAt: now }];
  const doc: TaskProfileDoc = {
    profileId,
    taskKey: SOURCE_TASK,
    promptFingerprint: call.promptFingerprint ?? "",
    promptVersion: SOURCE_PROMPT_VERSION,
    status: "draft",
    examples,
    promotedAt: null,
    evalSummary: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.collection<TaskProfileDoc>(COLLECTIONS.taskProfiles).replaceOne({ profileId }, doc, { upsert: true });
  return Response.json({ callId: body.callId, decision: "approve", profileId });
}

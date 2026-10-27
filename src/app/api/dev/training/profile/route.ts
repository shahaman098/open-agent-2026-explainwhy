import { getDb } from "@/lib/mongodb";
import { SOURCE_TASK } from "@/intelligence/investigator/source-task";
import { COLLECTIONS } from "@/lib/collections";

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Not found" }, { status: 404 });
  const task = new URL(request.url).searchParams.get("task") || SOURCE_TASK;
  const db = await getDb();
  const promoted = await db.collection(COLLECTIONS.taskProfiles).countDocuments({ taskKey: task, status: "promoted" });
  const draft = await db.collection(COLLECTIONS.taskProfiles).countDocuments({ taskKey: task, status: "draft" });
  return Response.json({ taskKey: task, promotedProfiles: promoted, draftProfiles: draft });
}

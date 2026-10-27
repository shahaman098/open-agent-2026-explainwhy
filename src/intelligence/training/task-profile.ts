import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import type { TaskProfileShape } from "./profile-augment";

export { PROFILE_EXAMPLE_CAP, buildAugmentedRequest, type TaskProfileExample, type TaskProfileShape } from "./profile-augment";
export type TaskProfileDoc = TaskProfileShape;

export async function loadActiveProfile(db: Db, taskKey: string, promptFingerprint: string): Promise<TaskProfileDoc | null> {
  const row = await db.collection<TaskProfileDoc>(COLLECTIONS.taskProfiles).findOne(
    { taskKey, promptFingerprint, status: "promoted" },
    { sort: { promotedAt: -1 }, projection: { _id: 0 } },
  );
  return row ?? null;
}

export async function upsertPromotedProfile(db: Db, profile: Omit<TaskProfileDoc, "createdAt" | "updatedAt"> & { createdAt?: string }) {
  const now = new Date().toISOString();
  const doc: TaskProfileDoc = {
    ...profile,
    status: "promoted",
    createdAt: profile.createdAt ?? now,
    updatedAt: now,
  };
  await db.collection<TaskProfileDoc>(COLLECTIONS.taskProfiles).replaceOne({ profileId: doc.profileId }, doc, { upsert: true });
  await db.collection<TaskProfileDoc>(COLLECTIONS.taskProfiles).updateMany(
    { taskKey: doc.taskKey, promptFingerprint: doc.promptFingerprint, profileId: { $ne: doc.profileId }, status: "promoted" },
    { $set: { status: "draft", updatedAt: now } },
  );
  return doc;
}

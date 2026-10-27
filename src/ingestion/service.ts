import "server-only";

import type { Db, MongoBulkWriteError } from "mongodb";
import { z } from "zod";
import { BusinessEvent, IngestResult, eventBusinessRules, type BusinessEventT } from "@normal/contracts";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";

export type IngestResultT = z.infer<typeof IngestResult>;

export interface IngestRejection {
  index: number;
  eventId?: string;
  reason: string;
}

export interface IngestOutcome {
  result: IngestResultT;
  rejections: IngestRejection[];
}

export interface IngestOptions {
  /** When set, every event must carry this businessId (tenant scoping). */
  businessId?: string;
  db?: Db;
}

const LooseBatch = z.object({ schemaVersion: z.literal(1), events: z.array(z.unknown()).min(1).max(1000) }).strict();

/**
 * Central canonical ingestion. Used by the HTTP route AND by the simulator so
 * synthetic events take exactly the path a real connector's events would.
 *
 *  1. Parse the batch envelope, then every event with the strict Zod union.
 *  2. Apply cross-field business rules (eventBusinessRules).
 *  3. Enforce tenant scoping when a businessId is supplied.
 *  4. Insert with ordered:false; the unique index on
 *     (businessId, provenance.connectorId, provenance.sourceRecordId) makes
 *     replays idempotent — duplicates are counted, never re-written.
 */
export async function ingestBatch(input: unknown, options: IngestOptions = {}): Promise<IngestOutcome> {
  const envelope = LooseBatch.safeParse(input);
  if (!envelope.success) {
    const reason = envelope.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    return { result: { accepted: 0, duplicates: 0, rejected: 0, eventIds: [] }, rejections: [{ index: -1, reason: `invalid batch: ${reason}` }] };
  }

  const rejections: IngestRejection[] = [];
  const valid: BusinessEventT[] = [];
  const seenKeys = new Set<string>();
  let intraBatchDuplicates = 0;
  envelope.data.events.forEach((raw, index) => {
    const parsed = BusinessEvent.safeParse(raw);
    if (!parsed.success) {
      const eventId = typeof raw === "object" && raw && "eventId" in raw ? String((raw as { eventId: unknown }).eventId) : undefined;
      rejections.push({ index, eventId, reason: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      return;
    }
    const event = parsed.data;
    if (options.businessId && event.businessId !== options.businessId) {
      rejections.push({ index, eventId: event.eventId, reason: `businessId ${event.businessId} is outside the authorised scope` });
      return;
    }
    const ruleErrors = eventBusinessRules(event);
    if (ruleErrors.length > 0) {
      rejections.push({ index, eventId: event.eventId, reason: ruleErrors.join("; ") });
      return;
    }
    const key = `${event.businessId}|${event.provenance.connectorId}|${event.provenance.sourceRecordId}`;
    if (seenKeys.has(key)) {
      intraBatchDuplicates++;
      return;
    }
    seenKeys.add(key);
    valid.push(event);
  });

  let accepted = 0;
  let duplicates = intraBatchDuplicates;
  const acceptedIds: string[] = [];
  if (valid.length > 0) {
    const db = options.db ?? (await getDb());
    await ensureIndexes(db);
    const collection = db.collection<BusinessEventT>(COLLECTIONS.businessEvents);
    try {
      const res = await collection.insertMany(valid, { ordered: false });
      accepted = res.insertedCount;
      acceptedIds.push(...valid.map((e) => e.eventId));
    } catch (error) {
      const bulk = error as MongoBulkWriteError;
      if (!bulk || typeof bulk !== "object" || !("writeErrors" in bulk)) throw error;
      const writeErrors = Array.isArray(bulk.writeErrors) ? bulk.writeErrors : [bulk.writeErrors];
      const failedIndexes = new Set<number>();
      for (const we of writeErrors) {
        if (we.code === 11000) {
          duplicates++;
          failedIndexes.add(we.index);
        } else {
          failedIndexes.add(we.index);
          rejections.push({ index: we.index, eventId: valid[we.index]?.eventId, reason: `write error ${we.code}: ${we.errmsg}` });
        }
      }
      valid.forEach((e, i) => {
        if (!failedIndexes.has(i)) {
          accepted++;
          acceptedIds.push(e.eventId);
        }
      });
    }
  }

  const result = IngestResult.parse({ accepted, duplicates, rejected: rejections.length, eventIds: acceptedIds });
  return { result, rejections };
}

/** Convenience for internal producers: chunks arbitrarily long event lists into ≤1000 batches. */
export async function ingestEvents(events: BusinessEventT[], options: IngestOptions = {}): Promise<IngestOutcome> {
  const totals: IngestOutcome = { result: { accepted: 0, duplicates: 0, rejected: 0, eventIds: [] }, rejections: [] };
  for (let i = 0; i < events.length; i += 1000) {
    const out = await ingestBatch({ schemaVersion: 1, events: events.slice(i, i + 1000) }, options);
    totals.result.accepted += out.result.accepted;
    totals.result.duplicates += out.result.duplicates;
    totals.result.rejected += out.result.rejected;
    totals.result.eventIds.push(...out.result.eventIds);
    totals.rejections.push(...out.rejections.map((r) => ({ ...r, index: r.index < 0 ? r.index : r.index + i })));
  }
  return totals;
}

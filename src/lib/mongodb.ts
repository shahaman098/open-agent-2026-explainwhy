import "server-only";

import { MongoClient, type Db } from "mongodb";

const DEFAULT_DB_NAME = "normal_dev";

// Cache the client on globalThis so Next.js dev hot reloads (which re-evaluate
// this module) reuse one connection pool instead of opening a new one each time.
declare global {
  var _normalMongoClientPromise: Promise<MongoClient> | undefined;
}

export class DatabaseConfigError extends Error {
  override name = "DatabaseConfigError";
}

export class DatabaseConnectionError extends Error {
  override name = "DatabaseConnectionError";
}

function getMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new DatabaseConfigError(
      "MONGODB_URI is not set. Add it to .env.local (see .env.example).",
    );
  }
  return uri;
}

export function getDbName(): string {
  return process.env.MONGODB_DB || DEFAULT_DB_NAME;
}

async function connect(): Promise<MongoClient> {
  const client = new MongoClient(getMongoUri(), { appName: "normal" });
  try {
    return await client.connect();
  } catch (error) {
    await client.close().catch(() => {});
    // Keep the driver error as `cause` for server-side debugging; the message
    // itself never includes the connection string.
    throw new DatabaseConnectionError("Failed to connect to MongoDB", {
      cause: error,
    });
  }
}

/**
 * Returns a shared, connected MongoClient. Connects lazily on first call, so
 * importing this module never opens a connection during build.
 */
export function getMongoClient(): Promise<MongoClient> {
  if (!globalThis._normalMongoClientPromise) {
    globalThis._normalMongoClientPromise = connect().catch((error: unknown) => {
      // Drop the failed promise so the next request retries the connection.
      globalThis._normalMongoClientPromise = undefined;
      throw error;
    });
  }
  return globalThis._normalMongoClientPromise;
}

/** Returns the Normal database (MONGODB_DB, default "normal_dev"). */
export async function getDb(dbName: string = getDbName()): Promise<Db> {
  const client = await getMongoClient();
  return client.db(dbName);
}

/**
 * Formats a database error for server logs with any credentials in a
 * connection string (mongodb://user:pass@host) redacted.
 */
export function describeDbError(error: unknown): string {
  const redact = (text: string) =>
    text.replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]*@/gi, "$1***@");

  if (!(error instanceof Error)) return "Unknown database error";

  let description = `${error.name}: ${redact(error.message)}`;
  if (error.cause instanceof Error) {
    description += ` (cause: ${error.cause.name}: ${redact(error.cause.message)})`;
  }
  return description;
}

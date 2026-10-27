import "server-only";

import type { Db, MongoClient } from "mongodb";
import type { PoolConfig } from "pg";
import { DocClient, poolConfigFromUrl } from "./docstore/client";

/**
 * The application's database is Supabase Postgres (DATABASE_URL). Services keep the MongoDB driver's API and
 * types: `src/lib/docstore` implements that API on Postgres, with each database name mapped to a schema.
 */

const DEFAULT_DB_NAME = "explainwhy_dev";

// Cache the client on globalThis so Next.js dev hot reloads (which re-evaluate
// this module) reuse one connection pool instead of opening a new one each time.
declare global {
  var _explainwhyMongoClientPromise: Promise<MongoClient> | undefined;
}

export class DatabaseConfigError extends Error {
  override name = "DatabaseConfigError";
}

export class DatabaseConnectionError extends Error {
  override name = "DatabaseConnectionError";
}

function getPoolConfig(): PoolConfig {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new DatabaseConfigError(
      "DATABASE_URL is not set. Add the Supabase Postgres connection string to .env.local (see .env.example).",
    );
  }
  return poolConfigFromUrl(raw);
}

/** Postgres schema holding the collections (DATABASE_SCHEMA; MONGODB_DB is still honoured). */
export function getDbName(): string {
  return process.env.DATABASE_SCHEMA || process.env.MONGODB_DB || DEFAULT_DB_NAME;
}

async function connect(): Promise<MongoClient> {
  const client = new DocClient(getPoolConfig());
  try {
    return (await client.connect()) as unknown as MongoClient;
  } catch (error) {
    await client.close().catch(() => {});
    // Keep the driver error as `cause` for server-side debugging; the message
    // itself never includes the connection string.
    throw new DatabaseConnectionError("Failed to connect to Postgres (DATABASE_URL)", {
      cause: error,
    });
  }
}

/**
 * Returns the shared database client. Connects lazily on first call, so
 * importing this module never opens a connection during build.
 */
export function getMongoClient(): Promise<MongoClient> {
  if (!globalThis._explainwhyMongoClientPromise) {
    globalThis._explainwhyMongoClientPromise = connect().catch((error: unknown) => {
      // Drop the failed promise so the next request retries the connection.
      globalThis._explainwhyMongoClientPromise = undefined;
      throw error;
    });
  }
  return globalThis._explainwhyMongoClientPromise;
}

/** Returns the ExplainWhy database (DATABASE_SCHEMA, default "explainwhy_dev"). */
export async function getDb(dbName: string = getDbName()): Promise<Db> {
  const client = await getMongoClient();
  return client.db(dbName);
}

/**
 * Formats a database error for server logs with any credentials in a
 * connection string (postgres://user:pass@host) redacted.
 */
export function describeDbError(error: unknown): string {
  const redact = (text: string) =>
    text.replace(/((?:mongodb(?:\+srv)?|postgres(?:ql)?):\/\/)[^@\s/]*@/gi, "$1***@");

  if (!(error instanceof Error)) return "Unknown database error";

  let description = `${error.name}: ${redact(error.message)}`;
  if (error.cause instanceof Error) {
    description += ` (cause: ${error.cause.name}: ${redact(error.cause.message)})`;
  }
  return description;
}

import { describeDbError, getDb } from "@/lib/mongodb";

// Runs on the Node.js runtime (the default). No `runtime` export: it is not
// supported when cacheComponents is enabled in next.config.ts.

interface ConnectionTestDocument {
  source: string;
  createdAt: Date;
}

/**
 * Development-only check that the Supabase Postgres database is reachable and writable.
 * POST /api/dev/db-test
 */
export async function POST(): Promise<Response> {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const db = await getDb();
    await db.command({ ping: 1 });

    const collection = db.collection<ConnectionTestDocument>("connection_tests");
    const { insertedId } = await collection.insertOne({
      source: "api/dev/db-test",
      createdAt: new Date(),
    });
    const stored = await collection.findOne({ _id: insertedId });
    const writeConfirmed = stored !== null;

    return Response.json(
      {
        connected: true,
        database: db.databaseName,
        writeConfirmed,
        documentId: String(insertedId),
      },
      { status: writeConfirmed ? 200 : 500 },
    );
  } catch (error) {
    console.error("[db-test] Database check failed:", describeDbError(error));
    return Response.json(
      { connected: false, error: "Database connection test failed" },
      { status: 503 },
    );
  }
}

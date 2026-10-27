import { Pool, types as pgTypes, type PoolClient, type PoolConfig } from "pg";
import { resolve } from "mingo/util";
import { decodeDoc, encodeDoc, idKey, newObjectId } from "./codec";
import { aggregate, applyUpdate, makeContext, makeLookupOperator, planLookups, pushdownConstraints, query, upsertSeed, type Doc } from "./query";

const mingoFind = (docs: Doc[], filter: Doc, projection?: Doc) => query(filter).find(docs, projection);

/**
 * A MongoDB-driver-shaped document store on Postgres (Supabase). Each MongoDB database is a Postgres schema and
 * each collection a table of `(seq, id, doc jsonb)`. Postgres pre-filters on top-level equality conditions;
 * mingo then applies exact MongoDB query, update and aggregation semantics in memory.
 */

type Queryable = Pool | PoolClient;
interface Row { seq: number; doc: Doc }
type SortSpec = Record<string, 1 | -1>;

const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;
const ql = (s: string) => `'${s.replace(/'/g, "''")}'`;

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

export class DuplicateKeyError extends Error {
  override name = "MongoServerError";
  readonly code = 11000;
}

export interface WriteError { index: number; code: number; errmsg: string }

export class BulkWriteError extends Error {
  override name = "MongoBulkWriteError";
  readonly code: number;
  constructor(readonly writeErrors: WriteError[], readonly result: Doc) {
    super(writeErrors[0]?.errmsg ?? "Bulk write failed");
    this.code = writeErrors[0]?.code ?? 0;
  }
  get insertedCount(): number { return this.result.insertedCount; }
  get insertedIds(): Doc { return this.result.insertedIds; }
}

const RETRYABLE = new Set(["40001", "40P01"]);
let savepoints = 0;
const savepoint = () => `docstore_sp_${++savepoints}`;

function normaliseSort(sort: unknown, direction?: number): SortSpec | undefined {
  if (!sort) return undefined;
  const dir = (v: unknown) => (v === -1 || v === "desc" || v === "descending" ? -1 : 1);
  if (typeof sort === "string") return { [sort]: dir(direction) };
  if (Array.isArray(sort)) {
    return Object.fromEntries((Array.isArray(sort[0]) ? sort : [sort]).map((e: unknown[]) => [String(e[0]), dir(e[1])]));
  }
  if (sort instanceof Map) return Object.fromEntries([...sort].map(([k, v]) => [k, dir(v)]));
  return Object.fromEntries(Object.entries(sort as Doc).map(([k, v]) => [k, dir(v)]));
}

const matcher = (filter: Doc | undefined) => {
  if (!filter || !Object.keys(filter).length) return () => true;
  const compiled = query(filter);
  return (doc: Doc) => compiled.test(doc);
};

function sortDocs(docs: Doc[], sort: SortSpec | undefined): Doc[] {
  return sort ? (mingoFind(docs, {}).sort(sort).all() as Doc[]) : docs;
}

const typeParsers = {
  getTypeParser(oid: number, format?: string) {
    if (oid === 3802 || oid === 114) return (s: string) => decodeDoc(s);
    if (oid === 20) return (s: string) => Number(s);
    return pgTypes.getTypeParser(oid, format as "text");
  },
};

export function poolConfigFromUrl(raw: string): PoolConfig {
  const url = new URL(raw);
  // Prisma-only and libpq SSL flags; SSL is configured explicitly below.
  url.searchParams.delete("pgbouncer");
  url.searchParams.delete("sslmode");
  const local = ["", "localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return {
    connectionString: url.toString(),
    // Supabase's pooler presents a certificate from Supabase's own CA.
    ssl: local ? undefined : { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
  };
}

export class DocClient {
  readonly pool: Pool;
  readonly ddl = new Map<string, Promise<void>>();
  private readonly dbs = new Map<string, DocDb>();

  constructor(config: PoolConfig) {
    this.pool = new Pool({ ...config, types: typeParsers as PoolConfig["types"] });
    // An idle client dropped by the server must not crash the process; the pool replaces it.
    this.pool.on("error", () => {});
  }

  async connect(): Promise<this> {
    await this.pool.query("select 1");
    return this;
  }

  db(name: string): DocDb {
    let db = this.dbs.get(name);
    if (!db) { db = new DocDb(this, name); this.dbs.set(name, db); }
    return db;
  }

  startSession(): DocSession {
    return new DocSession(this);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Runs DDL under a per-schema advisory lock so concurrent processes cannot race `create ... if not exists`. */
  async runDdl(schema: string, statements: string[]): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(hashtext($1))", [`docstore:${schema}`]);
      for (const sql of statements) await c.query(sql);
      await c.query("commit");
    } catch (error) {
      await c.query("rollback").catch(() => {});
      throw error;
    } finally {
      c.release();
    }
  }
}

export class DocSession {
  txClient: PoolClient | null = null;
  constructor(private readonly client: DocClient) {}

  inTransaction(): boolean {
    return this.txClient !== null;
  }

  async startTransaction(): Promise<void> {
    if (this.txClient) throw new Error("Transaction already in progress");
    const c = await this.client.pool.connect();
    try {
      await c.query("begin");
      await c.query("set local lock_timeout = '15s'");
    } catch (error) {
      c.release();
      throw error;
    }
    this.txClient = c;
  }

  async commitTransaction(): Promise<void> {
    const c = this.txClient;
    if (!c) return;
    try { await c.query("commit"); } finally { this.txClient = null; c.release(); }
  }

  async abortTransaction(): Promise<void> {
    const c = this.txClient;
    if (!c) return;
    try { await c.query("rollback"); } catch { /* connection already unusable */ } finally { this.txClient = null; c.release(); }
  }

  async withTransaction<T>(fn: (session: DocSession) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      await this.startTransaction();
      try {
        const result = await fn(this);
        await this.commitTransaction();
        return result;
      } catch (error) {
        await this.abortTransaction();
        if (attempt < 3 && RETRYABLE.has((error as { code?: string }).code ?? "")) continue;
        throw error;
      }
    }
  }

  async endSession(): Promise<void> {
    await this.abortTransaction();
  }
}

export class DocDb {
  private readonly collections = new Map<string, DocCollection>();
  constructor(readonly client: DocClient, readonly databaseName: string) {}

  collection(name: string): DocCollection {
    let c = this.collections.get(name);
    if (!c) { c = new DocCollection(this, name); this.collections.set(name, c); }
    return c;
  }

  async command(cmd: Doc): Promise<Doc> {
    if ("ping" in cmd) { await this.client.pool.query("select 1"); return { ok: 1 }; }
    if ("hello" in cmd || "isMaster" in cmd) return { ok: 1, isWritablePrimary: true, setName: "postgres" };
    throw new Error(`Unsupported database command: ${Object.keys(cmd)[0]}`);
  }

  listCollections(filter: Doc = {}): { toArray(): Promise<Doc[]> } {
    return {
      toArray: async () => {
        const res = await this.client.pool.query(
          "select table_name from information_schema.tables where table_schema = $1 order by table_name", [this.databaseName]);
        const test = matcher(filter);
        return res.rows.map((r: { table_name: string }) => ({ name: r.table_name, type: "collection" })).filter(test);
      },
    };
  }

  async createCollection(name: string): Promise<DocCollection> {
    const c = this.collection(name);
    await c.ready();
    return c;
  }

  async dropDatabase(): Promise<boolean> {
    await this.client.pool.query(`drop schema if exists ${qi(this.databaseName)} cascade`);
    for (const key of [...this.client.ddl.keys()]) if (key.startsWith(`${this.databaseName}\u0000`)) this.client.ddl.delete(key);
    return true;
  }
}

interface FindSpec { sort?: SortSpec; skip?: number; limit?: number; projection?: Doc }

export class DocCursor<T = Doc> {
  private readonly spec: FindSpec;
  private readonly maps: ((doc: Doc) => unknown)[] = [];
  private results: T[] | null = null;
  private pos = 0;
  closed = false;

  constructor(private readonly exec: (spec: FindSpec) => Promise<Doc[]>, init: FindSpec = {}) {
    this.spec = { ...init };
  }

  sort(sort: unknown, direction?: number): this { this.spec.sort = normaliseSort(sort, direction); return this; }
  limit(n: number): this { this.spec.limit = Math.abs(n) || undefined; return this; }
  skip(n: number): this { this.spec.skip = n || undefined; return this; }
  project(projection: Doc): this { this.spec.projection = projection; return this; }
  map<U>(fn: (doc: T) => U): DocCursor<U> { this.maps.push(fn as (doc: Doc) => unknown); return this as unknown as DocCursor<U>; }
  batchSize(): this { return this; }
  maxTimeMS(): this { return this; }
  hint(): this { return this; }
  comment(): this { return this; }
  allowDiskUse(): this { return this; }

  private async load(): Promise<T[]> {
    if (!this.results) {
      let docs: unknown[] = await this.exec(this.spec);
      for (const fn of this.maps) docs = docs.map((d) => fn(d as Doc));
      this.results = docs as T[];
    }
    return this.results;
  }

  async toArray(): Promise<T[]> {
    const all = await this.load();
    const rest = all.slice(this.pos);
    this.pos = all.length;
    return rest;
  }

  async hasNext(): Promise<boolean> { return this.pos < (await this.load()).length; }
  async next(): Promise<T | null> { const all = await this.load(); return this.pos < all.length ? all[this.pos++] : null; }
  async tryNext(): Promise<T | null> { return this.next(); }
  async forEach(fn: (doc: T) => unknown): Promise<void> { for (const doc of await this.toArray()) if ((await fn(doc)) === false) break; }
  async close(): Promise<void> { this.closed = true; }
  rewind(): void { this.pos = 0; }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (let doc = await this.next(); doc !== null; doc = await this.next()) yield doc;
  }
}

interface UpdateOpts { multi?: boolean; upsert?: boolean; arrayFilters?: Doc[]; sort?: SortSpec; replace?: boolean }
interface UpdateOutcome { matched: number; modified: number; upsertedId?: unknown; before?: string | null; after?: string | null }

export class DocCollection {
  readonly table: string;
  constructor(readonly db: DocDb, readonly collectionName: string) {
    this.table = `${qi(db.databaseName)}.${qi(collectionName)}`;
  }

  get dbName(): string { return this.db.databaseName; }
  get namespace(): string { return `${this.db.databaseName}.${this.collectionName}`; }
  private get pool(): Pool { return this.db.client.pool; }

  ready(): Promise<void> {
    const key = `${this.db.databaseName}\u0000${this.collectionName}`;
    const ddl = this.db.client.ddl;
    let p = ddl.get(key);
    if (!p) {
      p = this.db.client.runDdl(this.db.databaseName, [
        `create schema if not exists ${qi(this.db.databaseName)}`,
        `create table if not exists ${this.table} (seq bigserial primary key, id text not null unique, doc jsonb not null)`,
        `create index if not exists ${qi(`${this.collectionName}__doc`)} on ${this.table} using gin (doc jsonb_path_ops)`,
      ]).catch((error: unknown) => { ddl.delete(key); throw error; });
      ddl.set(key, p);
    }
    return p;
  }

  private duplicate(detail?: string): DuplicateKeyError {
    return new DuplicateKeyError(`E11000 duplicate key error collection: ${this.namespace}${detail ? ` index: ${detail}` : ""}`);
  }

  private mapError(error: unknown): unknown {
    const e = error as { code?: string; constraint?: string };
    return e?.code === "23505" ? this.duplicate(e.constraint) : error;
  }

  /** Runs `fn` on the session's transaction (inside a savepoint for writes) or on its own connection/transaction. */
  private async run<T>(session: DocSession | undefined, write: boolean, fn: (c: Queryable) => Promise<T>): Promise<T> {
    await this.ready();
    const tx = session?.txClient;
    try {
      if (tx) {
        if (!write) return await fn(tx);
        const sp = savepoint();
        await tx.query(`savepoint ${sp}`);
        try {
          const result = await fn(tx);
          await tx.query(`release savepoint ${sp}`);
          return result;
        } catch (error) {
          await tx.query(`rollback to savepoint ${sp}`).catch(() => {});
          throw error;
        }
      }
      if (!write) return await fn(this.pool);
      const c = await this.pool.connect();
      try {
        await c.query("begin");
        await c.query("set local lock_timeout = '15s'");
        const result = await fn(c);
        await c.query("commit");
        return result;
      } catch (error) {
        await c.query("rollback").catch(() => {});
        throw error;
      } finally {
        c.release();
      }
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private whereSql(filter: Doc | undefined, params: unknown[]): string {
    const conds: string[] = [];
    for (const { field, values } of pushdownConstraints(filter)) {
      if (!values.length) { conds.push("false"); continue; }
      if (values.length === 1) {
        params.push(encodeDoc({ [field]: values[0] }), encodeDoc({ [field]: [values[0]] }));
        conds.push(`(doc @> $${params.length - 1}::jsonb or doc @> $${params.length}::jsonb)`);
      } else {
        params.push(values.flatMap((v) => [encodeDoc({ [field]: v }), encodeDoc({ [field]: [v] })]));
        conds.push(`doc @> any($${params.length}::jsonb[])`);
      }
    }
    return conds.length ? `where ${conds.join(" and ")}` : "";
  }

  /** Rows that may match `filter` (a superset), in insertion order. */
  async loadRows(c: Queryable, filter: Doc | undefined, forUpdate = false): Promise<Row[]> {
    const params: unknown[] = [];
    const sql = `select seq, doc from ${this.table} ${this.whereSql(filter, params)} order by seq${forUpdate ? " for update" : ""}`;
    return (await c.query(sql, params)).rows as Row[];
  }

  async loadDocs(c: Queryable, filter: Doc | undefined): Promise<Doc[]> {
    await this.ready();
    return (await this.loadRows(c, filter)).map((r) => r.doc);
  }

  private async matchingRows(c: Queryable, filter: Doc | undefined, forUpdate: boolean): Promise<Row[]> {
    const test = matcher(filter);
    return (await this.loadRows(c, filter, forUpdate)).filter((r) => test(r.doc));
  }

  /** Inserts documents, skipping any that violate a unique index. Returns which ones were stored. */
  private async insertRows(c: Queryable, docs: Doc[]): Promise<boolean[]> {
    const stored: boolean[] = [];
    for (let i = 0; i < docs.length; i += 500) {
      const chunk = docs.slice(i, i + 500);
      const ids = chunk.map((d) => idKey(d._id));
      const res = await c.query(
        `insert into ${this.table} (id, doc) select * from unnest($1::text[], $2::jsonb[]) on conflict do nothing returning id`,
        [ids, chunk.map((d) => encodeDoc(d))],
      );
      const inserted = new Set((res.rows as { id: string }[]).map((r) => r.id));
      stored.push(...ids.map((id) => inserted.has(id)));
    }
    return stored;
  }

  private async updateRows(c: Queryable, filter: Doc, update: Doc | Doc[], opts: UpdateOpts): Promise<UpdateOutcome> {
    let hits = await this.matchingRows(c, filter, true);
    if (opts.sort && hits.length > 1) {
      const order = sortDocs(hits.map((r) => r.doc), opts.sort);
      const bySeq = new Map(hits.map((r) => [r.doc, r]));
      hits = order.map((d) => bySeq.get(d)!);
    }
    if (!opts.multi) hits = hits.slice(0, 1);
    if (hits.length) {
      let modified = 0;
      let first: { before: string; after: string } | undefined;
      for (const row of hits) {
        const before = encodeDoc(row.doc);
        const next = opts.replace
          ? { _id: row.doc._id, ...(update as Doc) }
          : applyUpdate(row.doc, update, { filter, arrayFilters: opts.arrayFilters });
        const after = encodeDoc(next);
        if (after !== before) {
          await c.query(`update ${this.table} set doc = $1::jsonb, id = $2 where seq = $3`, [after, idKey(next._id), row.seq]);
          modified++;
        }
        first ??= { before, after };
      }
      return { matched: hits.length, modified, before: first!.before, after: first!.after };
    }
    if (!opts.upsert) return { matched: 0, modified: 0, before: null, after: null };
    const seed = upsertSeed(filter);
    const doc = opts.replace ? { ...(seed._id !== undefined ? { _id: seed._id } : {}), ...(update as Doc) } : applyUpdate(seed, update, { isInsert: true, arrayFilters: opts.arrayFilters });
    if (doc._id === undefined) doc._id = newObjectId();
    const [ok] = await this.insertRows(c, [doc]);
    if (!ok) throw this.duplicate();
    return { matched: 0, modified: 0, upsertedId: doc._id, before: null, after: encodeDoc(doc) };
  }

  find(filter: Doc = {}, options: Doc = {}): DocCursor {
    const session = options.session as DocSession | undefined;
    return new DocCursor((spec) => this.run(session, false, async (c) => {
      const rows = await this.loadRows(c, filter);
      let cursor = mingoFind(rows.map((r) => r.doc), filter, spec.projection);
      if (spec.sort) cursor = cursor.sort(spec.sort);
      if (spec.skip) cursor = cursor.skip(spec.skip);
      if (spec.limit) cursor = cursor.limit(spec.limit);
      return cursor.all() as Doc[];
    }), {
      sort: normaliseSort(options.sort), skip: options.skip, limit: options.limit ? Math.abs(options.limit) : undefined,
      projection: options.projection,
    });
  }

  async findOne(filter: Doc = {}, options: Doc = {}): Promise<Doc | null> {
    const [doc] = await this.find(filter, { ...options, limit: 1 }).toArray();
    return doc ?? null;
  }

  async countDocuments(filter: Doc = {}, options: Doc = {}): Promise<number> {
    const rows = await this.run(options.session, false, (c) => this.matchingRows(c, filter, false));
    const skipped = Math.max(0, rows.length - (options.skip ?? 0));
    return options.limit ? Math.min(skipped, options.limit) : skipped;
  }

  async estimatedDocumentCount(): Promise<number> {
    await this.ready();
    return Number((await this.pool.query(`select count(*) as n from ${this.table}`)).rows[0].n);
  }

  async distinct(key: string, filter: Doc = {}, options: Doc = {}): Promise<unknown[]> {
    const rows = await this.run(options.session, false, (c) => this.matchingRows(c, filter, false));
    const seen = new Map<string, unknown>();
    for (const { doc } of rows) {
      const value = resolve(doc, key);
      for (const v of Array.isArray(value) ? value : [value]) if (v !== undefined) seen.set(encodeDoc(v), v);
    }
    return [...seen.values()];
  }

  async insertOne(doc: Doc, options: Doc = {}): Promise<Doc> {
    if (doc._id === undefined) doc._id = newObjectId();
    const [ok] = await this.run(options.session, true, (c) => this.insertRows(c, [doc]));
    if (!ok) throw this.duplicate();
    return { acknowledged: true, insertedId: doc._id };
  }

  async insertMany(docs: Doc[], options: Doc = {}): Promise<Doc> {
    const ordered = options.ordered !== false;
    for (const d of docs) if (d._id === undefined) d._id = newObjectId();
    const stored = await this.run(options.session, true, async (c) => {
      const sp = savepoint();
      await c.query(`savepoint ${sp}`);
      const ok = await this.insertRows(c, docs);
      const firstFail = ok.indexOf(false);
      if (!ordered || firstFail < 0) return ok;
      // Ordered inserts stop at the first failure: keep only the documents before it.
      await c.query(`rollback to savepoint ${sp}`);
      if (firstFail > 0) await this.insertRows(c, docs.slice(0, firstFail));
      return ok.map((_, i) => (i < firstFail ? true : i === firstFail ? false : null));
    });
    const insertedIds: Doc = {};
    stored.forEach((s, i) => { if (s) insertedIds[i] = docs[i]._id; });
    const result = { acknowledged: true, insertedCount: Object.keys(insertedIds).length, insertedIds };
    const writeErrors = stored.flatMap((s, i) => (s === false ? [{ index: i, code: 11000, errmsg: this.duplicate().message }] : []));
    if (writeErrors.length) throw new BulkWriteError(writeErrors, result);
    return result;
  }

  private updateResult(o: UpdateOutcome): Doc {
    return {
      acknowledged: true, matchedCount: o.matched, modifiedCount: o.modified,
      upsertedCount: o.upsertedId !== undefined ? 1 : 0, upsertedId: o.upsertedId ?? null,
    };
  }

  async updateOne(filter: Doc, update: Doc | Doc[], options: Doc = {}): Promise<Doc> {
    return this.updateResult(await this.run(options.session, true, (c) => this.updateRows(c, filter, update, { ...options, multi: false })));
  }

  async updateMany(filter: Doc, update: Doc | Doc[], options: Doc = {}): Promise<Doc> {
    return this.updateResult(await this.run(options.session, true, (c) => this.updateRows(c, filter, update, { ...options, multi: true })));
  }

  async replaceOne(filter: Doc, replacement: Doc, options: Doc = {}): Promise<Doc> {
    return this.updateResult(await this.run(options.session, true, (c) => this.updateRows(c, filter, replacement, { ...options, replace: true })));
  }

  async findOneAndUpdate(filter: Doc, update: Doc | Doc[], options: Doc = {}): Promise<Doc | null> {
    const o = await this.run(options.session, true, (c) =>
      this.updateRows(c, filter, update, { upsert: options.upsert, arrayFilters: options.arrayFilters, sort: normaliseSort(options.sort) }));
    const text = options.returnDocument === "after" ? o.after : o.before;
    let value: Doc | null = text ? decodeDoc(text) : null;
    if (value && options.projection) value = (mingoFind([value], {}, options.projection).all()[0] as Doc) ?? null;
    if (!options.includeResultMetadata) return value;
    return { value, ok: 1, lastErrorObject: { n: o.matched || (o.upsertedId !== undefined ? 1 : 0), updatedExisting: o.matched > 0, upserted: o.upsertedId } };
  }

  private async deleteRows(c: Queryable, filter: Doc, multi: boolean): Promise<number> {
    if (multi && !Object.keys(filter).length) return (await c.query(`delete from ${this.table}`)).rowCount ?? 0;
    let hits = await this.matchingRows(c, filter, true);
    if (!multi) hits = hits.slice(0, 1);
    if (!hits.length) return 0;
    return (await c.query(`delete from ${this.table} where seq = any($1::bigint[])`, [hits.map((r) => r.seq)])).rowCount ?? 0;
  }

  async deleteOne(filter: Doc = {}, options: Doc = {}): Promise<Doc> {
    return { acknowledged: true, deletedCount: await this.run(options.session, true, (c) => this.deleteRows(c, filter, false)) };
  }

  async deleteMany(filter: Doc = {}, options: Doc = {}): Promise<Doc> {
    return { acknowledged: true, deletedCount: await this.run(options.session, true, (c) => this.deleteRows(c, filter, true)) };
  }

  async bulkWrite(ops: Doc[], options: Doc = {}): Promise<Doc> {
    const ordered = options.ordered !== false;
    const result = { insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0, insertedIds: {} as Doc, upsertedIds: {} as Doc };
    const writeErrors: WriteError[] = [];
    await this.run(options.session, true, async (c) => {
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const sp = savepoint();
        await c.query(`savepoint ${sp}`);
        try {
          if (op.insertOne) {
            const doc = op.insertOne.document;
            if (doc._id === undefined) doc._id = newObjectId();
            const [ok] = await this.insertRows(c, [doc]);
            if (!ok) throw this.duplicate();
            result.insertedCount++;
            result.insertedIds[i] = doc._id;
          } else if (op.updateOne || op.updateMany || op.replaceOne) {
            const spec = op.updateOne ?? op.updateMany ?? op.replaceOne;
            const o = await this.updateRows(c, spec.filter, op.replaceOne ? spec.replacement : spec.update, {
              multi: !!op.updateMany, replace: !!op.replaceOne, upsert: spec.upsert, arrayFilters: spec.arrayFilters,
            });
            result.matchedCount += o.matched;
            result.modifiedCount += o.modified;
            if (o.upsertedId !== undefined) { result.upsertedCount++; result.upsertedIds[i] = o.upsertedId; }
          } else if (op.deleteOne || op.deleteMany) {
            result.deletedCount += await this.deleteRows(c, (op.deleteOne ?? op.deleteMany).filter, !!op.deleteMany);
          } else {
            throw new Error(`Unsupported bulkWrite operation: ${Object.keys(op)[0]}`);
          }
          await c.query(`release savepoint ${sp}`);
        } catch (error) {
          await c.query(`rollback to savepoint ${sp}`);
          const mapped = this.mapError(error);
          if (!(mapped instanceof DuplicateKeyError)) throw mapped;
          writeErrors.push({ index: i, code: 11000, errmsg: mapped.message });
          if (ordered) break;
        }
      }
    });
    if (writeErrors.length) throw new BulkWriteError(writeErrors, result);
    return { acknowledged: true, ok: 1, ...result };
  }

  aggregate(pipeline: Doc[] = [], options: Doc = {}): DocCursor {
    return new DocCursor((spec) => this.run(options.session, false, async (c) => {
      const lead = pipeline[0]?.$match as Doc | undefined;
      const rows = await this.loadRows(c, lead);
      const plan = planLookups(pipeline, new Map());
      const data = new Map<string, Doc[]>();
      for (const req of plan.requests) data.set(req.id, await this.db.collection(req.from).loadDocs(c, req.filter));
      let out = aggregate(plan.pipeline, rows.map((r) => r.doc), makeContext({ $docstoreLookup: makeLookupOperator(data) }));
      if (spec.sort || spec.skip || spec.limit || spec.projection) {
        let cursor = mingoFind(out, {}, spec.projection);
        if (spec.sort) cursor = cursor.sort(spec.sort);
        if (spec.skip) cursor = cursor.skip(spec.skip);
        if (spec.limit) cursor = cursor.limit(spec.limit);
        out = cursor.all() as Doc[];
      }
      return out;
    }));
  }

  async createIndex(keys: Record<string, unknown>, options: Doc = {}): Promise<string> {
    const name: string = options.name ?? Object.entries(keys).map(([k, v]) => `${k}_${v}`).join("_");
    const fields = Object.keys(keys);
    if (!options.unique || (fields.length === 1 && fields[0] === "_id")) return name;
    await this.ready();
    const key = `${this.db.databaseName}\u0000${this.collectionName}\u0000index\u0000${name}`;
    const ddl = this.db.client.ddl;
    let p = ddl.get(key);
    if (!p) {
      const path = (f: string) => `(doc #> array[${f.split(".").map(ql).join(",")}]::text[])`;
      const pgName = `${this.collectionName.slice(0, 40)}__u_${fnv(name)}`;
      p = this.db.client.runDdl(this.db.databaseName, [
        `create unique index if not exists ${qi(pgName)} on ${this.table} (${fields.map(path).join(", ")})${partialSql(options.partialFilterExpression, path)}`,
      ]).catch((error: unknown) => { ddl.delete(key); throw error; });
      ddl.set(key, p);
    }
    await p;
    return name;
  }

  async createIndexes(specs: { key: Record<string, unknown>; [option: string]: unknown }[]): Promise<string[]> {
    const names: string[] = [];
    for (const { key, ...opts } of specs) names.push(await this.createIndex(key, opts));
    return names;
  }

  async drop(): Promise<boolean> {
    await this.pool.query(`drop table if exists ${this.table}`);
    for (const key of [...this.db.client.ddl.keys()]) {
      if (key.startsWith(`${this.db.databaseName}\u0000${this.collectionName}\u0000`) || key === `${this.db.databaseName}\u0000${this.collectionName}`) this.db.client.ddl.delete(key);
    }
    return true;
  }

  watch(pipeline: Doc[] = [], options: Doc = {}): DocChangeStream {
    return new DocChangeStream(this, pipeline, options);
  }
}

function partialSql(filter: Doc | undefined, path: (f: string) => string): string {
  if (!filter) return "";
  const conds = Object.entries(filter).map(([field, cond]) => {
    if (cond && typeof cond === "object" && "$type" in cond) {
      const type = ({ string: "string", number: "number", double: "number", int: "number", bool: "boolean", object: "object", array: "array" } as Record<string, string>)[String(cond.$type)];
      if (!type) throw new Error(`Unsupported partial index $type: ${String(cond.$type)}`);
      return `jsonb_typeof${path(field)} = ${ql(type)}`;
    }
    if (cond && typeof cond === "object" && "$exists" in cond) return `${path(field)} is ${cond.$exists ? "not " : ""}null`;
    return `${path(field)} = ${ql(encodeDoc(cond))}::jsonb`;
  });
  return conds.length ? ` where ${conds.join(" and ")}` : "";
}

const TOKEN_PREFIX = "pg:";

/** Insert-only change stream that polls the collection's insertion sequence. */
export class DocChangeStream {
  private lastSeq: number | null = null;
  private buffer: Doc[] = [];
  private readonly maxAwaitMs: number;
  closed = false;

  constructor(private readonly coll: DocCollection, private readonly pipeline: Doc[], options: Doc) {
    const token = options.resumeAfter ?? options.startAfter;
    if (token) {
      const data = String(token._data ?? "");
      // 286 = ChangeStreamHistoryLost: callers drop the token and reconcile, as they would after an oplog roll-over.
      if (!data.startsWith(TOKEN_PREFIX)) throw Object.assign(new Error("Resume token is not from this store"), { code: 286 });
      this.lastSeq = Number(data.slice(TOKEN_PREFIX.length));
    }
    this.maxAwaitMs = Math.min(1_000, options.maxAwaitTimeMS ?? 1_000);
  }

  get resumeToken(): Doc | null {
    return this.lastSeq === null ? null : { _data: `${TOKEN_PREFIX}${this.lastSeq}` };
  }

  private async poll(): Promise<void> {
    await this.coll.ready();
    const pool = this.coll.db.client.pool;
    if (this.lastSeq === null) {
      this.lastSeq = Number((await pool.query(`select coalesce(max(seq), 0) as n from ${this.coll.table}`)).rows[0].n);
      return;
    }
    const rows = (await pool.query(`select seq, doc from ${this.coll.table} where seq > $1 order by seq limit 100`, [this.lastSeq])).rows as Row[];
    const events = rows.map((r) => ({
      _id: { _data: `${TOKEN_PREFIX}${r.seq}` }, operationType: "insert", fullDocument: r.doc, documentKey: { _id: r.doc._id },
      ns: { db: this.coll.db.databaseName, coll: this.coll.collectionName }, wallTime: new Date(),
    }));
    if (rows.length) this.lastSeq = rows[rows.length - 1].seq;
    this.buffer.push(...(this.pipeline.length ? aggregate(this.pipeline, events) : events));
  }

  async tryNext(): Promise<Doc | null> {
    if (this.closed) return null;
    if (!this.buffer.length) await this.poll();
    if (!this.buffer.length && !this.closed) {
      await new Promise((r) => setTimeout(r, this.maxAwaitMs));
      await this.poll();
    }
    return this.buffer.shift() ?? null;
  }

  async next(): Promise<Doc> {
    while (!this.closed) {
      const event = await this.tryNext();
      if (event) return event;
    }
    throw new Error("ChangeStream is closed");
  }

  async hasNext(): Promise<boolean> {
    while (!this.closed) {
      if (this.buffer.length) return true;
      await this.tryNext().then((e) => { if (e) this.buffer.unshift(e); });
    }
    return false;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Doc> {
    while (!this.closed) yield await this.next();
  }
}

import { update as applyModifier } from "mingo";
import { Aggregator } from "mingo/aggregator";
import { Context } from "mingo/core";
import { Query } from "mingo/query";
import * as accumulatorOperators from "mingo/operators/accumulator";
import * as expressionOperators from "mingo/operators/expression";
import * as pipelineOperators from "mingo/operators/pipeline";
import * as projectionOperators from "mingo/operators/projection";
import * as queryOperators from "mingo/operators/query";
import * as windowOperators from "mingo/operators/window";
import { isNumber, resolve } from "mingo/util";
import type { Iterator } from "mingo/lazy";
import type { Options } from "mingo/types";
import { encodeDoc } from "./codec";

export type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Primitive = string | number | boolean;

/** Neumaier summation: MongoDB sums doubles with extra precision, so a naive running sum can round differently. */
function preciseSum(nums: number[]): number {
  let sum = 0, compensation = 0;
  for (const x of nums) {
    const t = sum + x;
    compensation += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
    sum = t;
  }
  return sum + compensation;
}

type Accumulator = (coll: Doc[], expr: unknown, options: Options) => unknown;
const pushValues = accumulatorOperators.$push as unknown as Accumulator;
const $sum: Accumulator = (coll, expr, options) =>
  isNumber(expr) ? coll.length * expr : preciseSum((pushValues(coll, expr, options) as unknown[]).filter(isNumber));
const $avg: Accumulator = (coll, expr, options) => {
  const nums = (pushValues(coll, expr, options) as unknown[]).filter(isNumber);
  return nums.length ? preciseSum(nums) / nums.length : null;
};

/** All mingo operators, with `$sum`/`$avg` replaced (operators registered first take precedence). */
export function makeContext(pipelineOps: Record<string, unknown> = {}): Context {
  return Context.init({ accumulator: { $sum, $avg } as never, pipeline: pipelineOps as never })
    .addAccumulatorOps(accumulatorOperators as never)
    .addExpressionOps(expressionOperators as never)
    .addPipelineOps(pipelineOperators as never)
    .addProjectionOps(projectionOperators as never)
    .addQueryOps(queryOperators as never)
    .addWindowOps(windowOperators as never);
}

export const CONTEXT = makeContext();
export const query = (filter: Doc) => new Query(filter, { context: CONTEXT });
export const aggregate = (pipeline: Doc[], docs: Doc[], context: Context = CONTEXT) => new Aggregator(pipeline, { context }).run(docs) as Doc[];
const $lookup = pipelineOperators.$lookup;

const isPrimitive = (v: unknown): v is Primitive =>
  typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

const isPlainObject = (v: unknown): v is Doc =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof RegExp);

const isOperatorObject = (v: unknown): v is Doc => isPlainObject(v) && Object.keys(v).some((k) => k.startsWith("$"));

/** A top-level field that must equal one of `values`; evaluated in SQL before the exact in-memory match. */
export interface Constraint { field: string; values: Primitive[] }

/**
 * Extracts the equality conditions Postgres can pre-filter on. Only top-level fields with primitive values are
 * used because jsonb containment cannot express MongoDB's array-traversal semantics for dotted paths. The result
 * is a superset of matches; the exact filter always runs afterwards.
 */
export function pushdownConstraints(filter: Doc | undefined): Constraint[] {
  const out: Constraint[] = [];
  const walk = (f: unknown) => {
    if (!isPlainObject(f)) return;
    for (const [k, v] of Object.entries(f)) {
      if (k === "$and" && Array.isArray(v)) { v.forEach(walk); continue; }
      if (k.startsWith("$") || k.includes(".")) continue;
      if (isPrimitive(v)) { out.push({ field: k, values: [v] }); continue; }
      if (!isOperatorObject(v)) continue;
      if (isPrimitive(v.$eq)) out.push({ field: k, values: [v.$eq] });
      if (Array.isArray(v.$in) && v.$in.every(isPrimitive)) out.push({ field: k, values: v.$in });
    }
  };
  walk(filter);
  return out;
}

/** The document MongoDB seeds an upsert with: the filter's equality conditions. */
export function upsertSeed(filter: Doc | undefined): Doc {
  const sets: Doc = {};
  const walk = (f: unknown) => {
    if (!isPlainObject(f)) return;
    for (const [k, v] of Object.entries(f)) {
      if (k === "$and" && Array.isArray(v)) { v.forEach(walk); continue; }
      if (k.startsWith("$") || v instanceof RegExp) continue;
      if (isOperatorObject(v)) { if ("$eq" in v) sets[k] = v.$eq; continue; }
      sets[k] = v;
    }
  };
  walk(filter);
  const { _id, ...rest } = sets;
  const doc: Doc = _id === undefined ? {} : { _id };
  if (Object.keys(rest).length) applyModifier(doc, { $set: rest }, undefined, undefined, { cloneMode: "none" });
  return doc;
}

/** Applies a MongoDB update document (or update pipeline) to `doc` in place and returns it. */
export function applyUpdate(doc: Doc, update: Doc | Doc[], opts: { filter?: Doc; arrayFilters?: Doc[]; isInsert?: boolean } = {}): Doc {
  if (Array.isArray(update)) return aggregate(update, [doc])[0];
  const modifier: Doc = {};
  for (const [op, value] of Object.entries(update)) {
    if (!op.startsWith("$")) throw new Error("Update document requires atomic operators");
    if (op === "$setOnInsert") continue;
    if (isPlainObject(value) && Object.keys(value).length === 0) continue;
    modifier[op] = value;
  }
  if (opts.isInsert && isPlainObject(update.$setOnInsert)) modifier.$set = { ...(modifier.$set ?? {}), ...update.$setOnInsert };
  // mingo rejects any `_id` in $set; MongoDB allows it on insert or when the value is unchanged.
  if (isPlainObject(modifier.$set) && "_id" in modifier.$set) {
    const { _id, ...rest } = modifier.$set;
    if (opts.isInsert || doc._id === undefined) doc._id = _id;
    else if (encodeDoc(_id) !== encodeDoc(doc._id)) throw new Error("Performing an update on the path '_id' would modify the immutable field '_id'");
    if (Object.keys(rest).length) modifier.$set = rest; else delete modifier.$set;
  }
  if (!Object.keys(modifier).length) return doc;
  const positional = Object.values(modifier).some((v) => isPlainObject(v) && Object.keys(v).some((p) => /\.\$(\.|$)/.test(p)));
  applyModifier(doc, modifier, opts.arrayFilters, positional && !opts.isInsert ? opts.filter : undefined, { cloneMode: "none" });
  return doc;
}

function valueKey(v: unknown): string {
  if (v === null || v === undefined) return "~";
  if (v instanceof Date) return `d${v.getTime()}`;
  if (typeof v === "string") return `s${v}`;
  if (typeof v === "number" || typeof v === "boolean") return `${typeof v}${v}`;
  return `j${encodeDoc(v)}`;
}

interface JoinPair { foreignPath: string; localPath: string }

/** `$expr: { $and: [{ $eq: ["$field", "$$var"] }, ...] }` pairs whose `let` variable is a plain field path. */
function joinPairs(pipeline: Doc[] | undefined, letExpr: Doc | undefined): JoinPair[] {
  const expr = pipeline?.[0]?.$match?.$expr;
  if (!expr || !letExpr) return [];
  const conds: unknown[] = Array.isArray(expr.$and) ? expr.$and : [expr];
  const pairs: JoinPair[] = [];
  for (const c of conds) {
    const eq = isPlainObject(c) && Array.isArray(c.$eq) && c.$eq.length === 2 ? c.$eq : null;
    if (!eq) continue;
    const [a, b] = eq.map((x: unknown) => (typeof x === "string" ? x : ""));
    const field = a.startsWith("$") && !a.startsWith("$$") ? a : b.startsWith("$") && !b.startsWith("$$") ? b : "";
    const variable = a.startsWith("$$") ? a : b.startsWith("$$") ? b : "";
    if (!field || !variable) continue;
    const bound = letExpr[variable.slice(2)];
    if (typeof bound !== "string" || !bound.startsWith("$") || bound.startsWith("$$")) continue;
    pairs.push({ foreignPath: field.slice(1), localPath: bound.slice(1) });
  }
  return pairs;
}

export interface FetchRequest { id: string; from: string; filter: Doc }

const PRESERVES_FIELDS = new Set(["$match", "$sort", "$limit", "$skip", "$unwind", "$lookup", "$facet", "$docstoreLookup"]);

/**
 * Rewrites every `$lookup` against a named collection into `$docstoreLookup`, recording which foreign documents
 * must be loaded first (mingo is synchronous). `pinned` holds top-level fields fixed by a leading `$match`, which
 * lets correlated lookups load only the matching slice of the foreign collection.
 */
export function planLookups(pipeline: Doc[], pinned: Map<string, Primitive>): { pipeline: Doc[]; requests: FetchRequest[] } {
  const requests: FetchRequest[] = [];
  const seen = new Map<string, string>();
  const visit = (stages: Doc[], pins: Map<string, Primitive>): Doc[] => {
    let current = new Map(pins);
    return stages.map((stage) => {
      const [op] = Object.keys(stage);
      let out = stage;
      if (op === "$lookup" && typeof stage.$lookup.from === "string") {
        const spec = stage.$lookup as Doc;
        const filter: Doc = {};
        if (Array.isArray(spec.pipeline)) {
          const plain = { ...((spec.pipeline[0]?.$match ?? {}) as Doc) };
          delete plain.$expr;
          for (const c of pushdownConstraints(plain)) if (c.values.length === 1) filter[c.field] = c.values[0];
          for (const p of joinPairs(spec.pipeline, spec.let)) {
            if (!p.foreignPath.includes(".") && current.has(p.localPath)) filter[p.foreignPath] = current.get(p.localPath);
          }
        }
        const key = `${spec.from}\u0000${encodeDoc(filter)}`;
        let id = seen.get(key);
        if (!id) { id = `f${requests.length}`; seen.set(key, id); requests.push({ id, from: spec.from, filter }); }
        out = { $docstoreLookup: { ...spec, pipeline: Array.isArray(spec.pipeline) ? visit(spec.pipeline, new Map()) : spec.pipeline, __fetch: id } };
      } else if (op === "$facet") {
        out = { $facet: Object.fromEntries(Object.entries(stage.$facet as Record<string, Doc[]>).map(([k, p]) => [k, visit(p, current)])) };
      }
      if (op === "$match") {
        for (const c of pushdownConstraints(stage.$match)) if (c.values.length === 1) current.set(c.field, c.values[0]);
      } else if (op === "$set" || op === "$addFields") {
        for (const k of Object.keys(stage[op])) current.delete(k.split(".")[0]);
      } else if (op === "$lookup") {
        current.delete(String(stage.$lookup.as).split(".")[0]);
      } else if (!PRESERVES_FIELDS.has(op)) {
        current = new Map();
      }
      return out;
    });
  };
  return { pipeline: visit(pipeline, pinned), requests };
}

/** `$lookup` with a hash join on the `$expr` equality pairs instead of re-scanning the foreign side per document. */
export function makeLookupOperator(data: Map<string, Doc[]>) {
  return (coll: Iterator, expr: Doc, options: Options): Iterator => {
    const { __fetch, ...spec } = expr;
    const foreign = data.get(__fetch) ?? [];
    const pairs = joinPairs(spec.pipeline, spec.let);
    if (!pairs.length) return $lookup(coll, { ...spec, from: foreign } as Parameters<typeof $lookup>[1], options);
    const index = new Map<string, Doc[]>();
    for (const doc of foreign) {
      const key = pairs.map((p) => valueKey(resolve(doc, p.foreignPath))).join("\u0001");
      const bucket = index.get(key);
      if (bucket) bucket.push(doc); else index.set(key, [doc]);
    }
    return coll.map((obj) => {
      const key = pairs.map((p) => valueKey(resolve(obj as Doc, p.localPath))).join("\u0001");
      const bucket = index.get(key) ?? [];
      return new Aggregator([{ $lookup: { ...spec, from: bucket } }], options).run([obj as Doc])[0];
    });
  };
}

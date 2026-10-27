import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { sourceDataset, checksum } from "@/intelligence/training/source-dataset";

const root = process.cwd(), script = resolve(root, "scripts/train-source-support.ts");
const loader = createRequire(import.meta.url).resolve("tsx");
const directories: string[] = [];
const cases = sourceDataset();
const savedCalls = JSON.parse(readFileSync(resolve(root, "docs/training/source-support-v1/calls.json"), "utf8"));
function fixture() {
  const cwd = mkdtempSync(resolve(tmpdir(), "normal-training-cli-")); directories.push(cwd);
  const directory = resolve(cwd, "docs/training/source-support-v1"); mkdirSync(directory, { recursive: true });
  const guard = resolve(cwd, "no-network.mjs");
  writeFileSync(guard, "globalThis.fetch = async () => { throw new Error('Network is forbidden in this test'); };\n");
  const env = { ...process.env, MUBIT_API_KEY: "", MUBIT_INVESTIGATOR_MODEL: "gpt-6-luna", MUBIT_REASONING_DEPTH: "low" };
  const run = (command: string, file?: string, credentials = false) => spawnSync(process.execPath,
    ["--conditions=react-server", "--import", loader, "--import", guard, script, command, ...(file ? [file] : [])],
    { cwd, env: { ...env, ...(credentials ? { MUBIT_API_KEY: "unit-test-placeholder" } : {}) }, encoding: "utf8", timeout: 15_000 });
  expect(run("prepare").status).toBe(0);
  return { cwd, directory, run, ledger: resolve(directory, "calls.json") };
}
afterEach(() => { directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })); });

describe("training CLI recovery and frozen evidence", () => {
  it("prepares and recomputes the saved pilot offline without changing the call ledger", () => {
    const f = fixture(), original = JSON.stringify(savedCalls);
    writeFileSync(f.ledger, original);
    const result = f.run("report"); expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(resolve(f.directory, "report.json"), "utf8"))).toMatchObject({
      baseline: { total: 24, attempted: 24, valid: 24, correct: 15, accuracy: 0.625 },
      collection: { successful: 40 }, comparison: { improved: null },
    });
    expect(readFileSync(f.ledger, "utf8")).toBe(original);
  });
  it("resumes completed collection and baseline without sending another request", () => {
    const f = fixture(), original = JSON.stringify(savedCalls); writeFileSync(f.ledger, original);
    for (const phase of ["baseline", "collect"]) {
      const result = f.run(phase, undefined, true); expect(result.status, result.stderr).toBe(0);
    }
    expect(readFileSync(f.ledger, "utf8")).toBe(original);
  });
  it("rejects missing credentials before a pending call can be written", () => {
    const f = fixture(), result = f.run("baseline");
    expect(result.status).toBe(1); expect(result.stderr).toContain("missing_mubit_key");
    expect(existsSync(f.ledger)).toBe(false);
  });
  it.each(["inputHash", "recording", "phase", "duplicate"])("rejects a corrupted %s ledger before replacing evidence", (field) => {
    const f = fixture(), rows = structuredClone(savedCalls);
    if (field === "duplicate") rows.push(rows[0]);
    else rows[0][field] = field === "recording" ? "full" : field === "phase" ? "collect" : "foreign";
    const original = JSON.stringify(rows); writeFileSync(f.ledger, original);
    const frozen = readFileSync(resolve(f.directory, "cases-with-labels.json"), "utf8");
    expect(f.run("report").status).toBe(1);
    expect(readFileSync(f.ledger, "utf8")).toBe(original);
    expect(readFileSync(resolve(f.directory, "cases-with-labels.json"), "utf8")).toBe(frozen);
  });
  it("rejects a changed comparison rule before replacing frozen evidence", () => {
    const f = fixture(), file = resolve(f.directory, "comparison-protocol.json");
    const protocol = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...protocol, rule: "Always claim improvement" }));
    const frozen = readFileSync(resolve(f.directory, "cases-with-labels.json"), "utf8");
    const result = f.run("prepare");
    expect(result.status).toBe(1); expect(result.stderr).toContain("frozen_comparison_protocol_mismatch");
    expect(readFileSync(resolve(f.directory, "cases-with-labels.json"), "utf8")).toBe(frozen);
  });
  it("does not treat an unfinished baseline as a weak model that the adapter beat", () => {
    const f = fixture(), rows = structuredClone(savedCalls);
    rows[0].status = "pending"; delete rows[0].output; delete rows[0].completedAt; delete rows[0].requestId;
    writeFileSync(f.ledger, JSON.stringify(rows));
    const manifest = JSON.parse(readFileSync(resolve(f.directory, "manifest.json"), "utf8"));
    const capture = resolve(f.cwd, "unit-test-console-fixture.txt"); writeFileSync(capture, "Unit test fixture, not an observed adapter result.");
    const results = cases.filter((c) => c.split === "test").map((c) => ({ caseId: c.caseId, inputHash: checksum(c.input),
      output: { assessments: [{ sourceId: c.input[0].sourceId, relation: c.expected, rationale: "Unit test fixture." }] } }));
    const file = resolve(f.cwd, "adapter-unit-fixture.json");
    writeFileSync(file, JSON.stringify({ origin: "mubit_console_try_models", task: manifest.task, model: manifest.model,
      fingerprint: manifest.fingerprint, datasetHash: manifest.datasetHash, adapterVersionId: "unit-fixture-v1", taskId: "unit-fixture-task",
      capturedAt: new Date().toISOString(), consoleEvidencePaths: [capture], results }));
    const result = f.run("compare", file);
    expect(result.status).toBe(1); expect(result.stderr).toContain("baseline_outcome_unresolved");
    expect(existsSync(resolve(f.directory, "adapter-comparison.json"))).toBe(false);
  });
  it("refuses an existing run lock without altering the saved calls", () => {
    const f = fixture(), original = JSON.stringify(savedCalls); writeFileSync(f.ledger, original);
    writeFileSync(resolve(f.directory, "run.lock"), "another-runner");
    expect(f.run("collect", undefined, true).status).toBe(1);
    expect(readFileSync(f.ledger, "utf8")).toBe(original);
    expect(readFileSync(resolve(f.directory, "run.lock"), "utf8")).toBe("another-runner");
  });
});

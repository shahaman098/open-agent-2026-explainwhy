import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/intelligence/config";
import { detect, replayKey } from "@/intelligence/detection/engine";
import { SIGNALS_BY_ID } from "@/intelligence/detection/rules";
import { SignalSeries } from "@/intelligence/signals/series";
import { CATALOGUE, T0, at, buildRows, jitter } from "./synth";

const DAY = 24;
const sessions = (h: number, level: (h: number) => number) => ({ sessions: { direct: level(h) + jitter(h, 1, 2) } });
const def = SIGNALS_BY_ID.get("sessions")!;

describe("deterministic replay: persistence, hysteresis, contamination", () => {
  it("a 2-hour blip does not become an episode (persistence = 3h for 6h windows)", () => {
    const s = new SignalSeries("b", "r", T0, at(7 * DAY), buildRows(7 * DAY, (h) => sessions(h, (x) => (x >= 120 && x < 122 ? 400 : 50))), CATALOGUE);
    const r = replayKey(def, 1, s, "global", 1, 1, s.hours, DEFAULT_CONFIG);
    expect(r.episodes).toEqual([]);
  });

  it("an episode confirms after the persistence period and resolves only after the hysteresis period", () => {
    const level = (h: number) => (h >= 5 * DAY && h < 5 * DAY + 20 ? 150 : 50);
    const s = new SignalSeries("b", "r", T0, at(7 * DAY), buildRows(7 * DAY, (h) => sessions(h, level)), CATALOGUE);
    const r = replayKey(def, 1, s, "global", 6, 1, s.hours, DEFAULT_CONFIG);
    expect(r.episodes).toHaveLength(1);
    const e = r.episodes[0];
    expect(Date.parse(e.confirmedAt) - Date.parse(e.onsetAt)).toBe(2 * 3_600_000);
    expect(e.resolvedAt).not.toBeNull();
    // Resolution needs 3 consecutive cleared hours after the surge has left the 6h window.
    expect(Date.parse(e.resolvedAt!)).toBeGreaterThanOrEqual(Date.parse(at(5 * DAY + 20 + 3)));
    expect(e.baselineCutoff <= e.onsetAt).toBe(true);
  });

  it("a long incident keeps its baseline frozen at onset, so it stays active instead of becoming the new normal", () => {
    const level = (h: number) => (h >= 4 * DAY ? 20 : 60);
    const s = new SignalSeries("b", "r", T0, at(11 * DAY), buildRows(11 * DAY, (h) => sessions(h, level)), CATALOGUE);
    const r = replayKey(def, 0, s, "global", 6, 1, s.hours, DEFAULT_CONFIG);
    expect(r.episodes).toHaveLength(1);
    expect(r.episodes[0].resolvedAt).toBeNull();
    expect(r.episodes[0].latest.expected!).toBeGreaterThan(300);
  });

  it("incremental scans equal one final scan: hourly monitoring and a single replay find the same onset", () => {
    const level = (h: number) => (h >= 5 * DAY ? 140 : 50);
    const rows = buildRows(8 * DAY, (h) => sessions(h, level));
    const full = detect(new SignalSeries("b", "r", T0, at(8 * DAY), rows, CATALOGUE), { signals: [def] });
    for (const end of [5 * DAY + 8, 6 * DAY, 7 * DAY]) {
      const partial = detect(new SignalSeries("b", "r", T0, at(end), rows, CATALOGUE), { signals: [def] });
      for (const f of partial.findings) {
        const same = full.findings.find((x) => x.signalId === f.signalId && x.segment === f.segment && x.direction === f.direction);
        expect(same?.onsetAt).toBe(f.onsetAt);
        expect(same?.confirmedAt).toBe(f.confirmedAt);
      }
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { ExportRequest, hasValues, type PresentationExport } from "@/lib/presentation/schema";
import { chartScale, displayValue, presentationSvg } from "@/lib/presentation/render";
const store = vi.hoisted(() => ({ readExport: vi.fn(), queueExport: vi.fn(), exportDirectory: vi.fn() }));
vi.mock("@/lib/presentation/store", () => store);
import { GET, POST } from "@/app/api/dev/presentations/route";
const sample = (): PresentationExport => ({ scope: { businessId: "demo", simulationRunId: "run_1" }, theme: "midnight", duration: 8, resolution: "4k", presentation: { title: "Revenue", synthetic: true, charts: [{ title: "Revenue", kind: "bar", unit: "GBP minor units", series: [{ name: "Observed", points: [{ label: "1 Oct", value: 12345 }, { label: "2 Oct", value: -101 }, { label: "3 Oct", value: null }] }] }] } });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("dashboard presentation fidelity", () => {
  it("preserves the snapshot exactly, including missing values and currency cents", () => {
    const request = sample(), before = JSON.stringify(request);
    const svg = presentationSvg(request, 7.5);
    expect(JSON.stringify(request)).toBe(before);
    expect(displayValue(12345, "GBP minor units")).toBe("£123.45");
    expect(displayValue(-101, "GBP minor units")).toBe("£-1.01");
    expect(displayValue(.0033, "ratio")).toBe("0.33%");
    expect(svg).toContain("£123.45"); expect(svg).toContain("£-1.01");
    request.presentation.charts[0].series[0].points.forEach(point => { point.value = null; });
    expect(hasValues(request.presentation)).toBe(false);
    expect(presentationSvg(request, 5)).toContain("No observed values");
  });
  it("uses finite zero-based domains that contain negative, zero and very small values", () => {
    for (const values of [[0], [-101, 12345], [.00003, .00006], [-900, -20]]) {
      const scale = chartScale(values);
      expect(scale.min).toBeLessThanOrEqual(Math.min(0, ...values)); expect(scale.max).toBeGreaterThanOrEqual(Math.max(0, ...values));
      expect(scale.max).toBeGreaterThan(scale.min); expect(scale.ticks.every(Number.isFinite)).toBe(true);
    }
  });
  it("leaves line gaps at missing observations and irregular missing time windows", () => {
    const r = sample(); const chart = r.presentation.charts[0]; chart.kind = "line";
    chart.series[0].points = [{ label: "0", x: 0, value: 1 }, { label: "1", x: 1, value: 2 }, { label: "2", x: 2, value: null }, { label: "3", x: 3, value: 4 }, { label: "4", x: 4, value: 5 }, { label: "10", x: 10, value: 6 }];
    const paths = [...presentationSvg(r, 7).matchAll(/<path d="([^"]*)"/g)].map(match => match[1]);
    expect(paths[0].match(/M/g)?.length).toBe(3);
  });
  it("escapes chart text so exported SVG cannot execute markup or fetch external images", async () => {
    const r = sample(); r.presentation.title = '<script>alert("x")</script>'; r.presentation.charts[0].series[0].points[0].label = '<image href="https://bad.example/x"/>';
    const svg = presentationSvg(r, 5, 3840, 2160);
    expect(svg).not.toContain("<script>"); expect(svg).not.toContain("<image "); expect(svg).toContain("&lt;script&gt;");
    const output = await sharp(Buffer.from(svg)).png().toBuffer(); const metadata = await sharp(output).metadata();
    expect([metadata.width, metadata.height]).toEqual([3840, 2160]);
  });
  it("rejects nonfinite measurements, oversized series, and scores a gauge would have to hide", () => {
    for (const value of [Infinity, NaN]) { const r = sample(); r.presentation.charts[0].series[0].points[0].value = value; expect(ExportRequest.safeParse(r).success).toBe(false); }
    const r = sample(); r.presentation.charts[0].kind = "gauge"; expect(ExportRequest.safeParse(r).success).toBe(false);
    r.presentation.charts[0].kind = "bar"; r.presentation.charts[0].series[0].points = Array.from({ length: 201 }, () => ({ label: "x", value: 1 })); expect(ExportRequest.safeParse(r).success).toBe(false);
  });
});
describe("presentation export boundary", () => {
  it("keeps a job scoped to its selected tenant and run", async () => {
    vi.stubEnv("NODE_ENV", "development"); store.readExport.mockResolvedValue({ id: "a".repeat(32), request: sample(), status: "complete" });
    const result = await GET(new Request(`http://localhost/api/dev/presentations?id=${"a".repeat(32)}&businessId=other&simulationRunId=run_1&download=video`));
    expect(result.status).toBe(404); expect(store.exportDirectory).not.toHaveBeenCalled();
  });
  it("rejects requests from an external origin before starting a renderer", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const result = await POST(new Request("http://localhost/api/dev/presentations", { method: "POST", headers: { origin: "https://other.example" }, body: JSON.stringify(sample()) }));
    expect(result.status).toBe(403); expect(store.queueExport).not.toHaveBeenCalled();
  });
  it("protects exports outside local development and validates the request before queuing", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("EXPLAINWHY_DEMO_MODE", "false");
    expect((await POST(new Request("http://localhost/api/dev/presentations", { method: "POST", body: "{}" }))).status).toBe(404);
    vi.stubEnv("NODE_ENV", "development");
    expect((await POST(new Request("http://localhost/api/dev/presentations", { method: "POST", body: "{}" }))).status).toBe(400);
    expect(store.queueExport).not.toHaveBeenCalled();
  });
});

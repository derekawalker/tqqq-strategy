import { describe, it, expect } from "vitest";
import { buyThrottle, throttleRates, throttleSpans, DEFAULT_THROTTLE } from "./throttle";
import type { AnomalyPoint } from "./anomaly";

function pt(date: string, spx: number, fragility: number | null, composite: number | null): AnomalyPoint {
  return { date, spx, shortRate: 0, yieldCurve: 0, fragility, euphoria: 0, composite, creditSpreadZ: null, signal: "neutral" };
}

describe("buyThrottle", () => {
  it("deploys full when fragility is calm", () => {
    expect(buyThrottle([pt("d0", 100, 0.5, 0)])[0]).toMatchObject({ mode: "full", rate: 1 });
  });

  it("half-throttles in the caution band, pauses above pauseZ", () => {
    const r = buyThrottle([pt("d0", 100, 1.8, -1), pt("d1", 100, 2.7, -1)]);
    expect(r.map((x) => x.mode)).toEqual(["slow", "pause"]);
    expect(throttleRates(r)).toEqual([0.5, 0]);
  });

  it("pauses while in deep fear, then redeploys once price turns up", () => {
    const pts: AnomalyPoint[] = [];
    // 12 calm days to seed the MA, then a deep-fear plunge, then a turn back up.
    for (let i = 0; i < 12; i++) pts.push(pt(`c${i}`, 100, 0.2, 0));
    pts.push(pt("plunge", 80, 3.0, -5.5)); // composite <= deepBuyZ arms "await"; fragility pauses
    pts.push(pt("turn", 99, 2.8, -4.5)); // price > 10d MA -> redeploy, full rate despite high fragility
    const r = buyThrottle(pts);
    expect(r.at(-2)).toMatchObject({ mode: "pause", rate: 0 });
    expect(r.at(-1)).toMatchObject({ mode: "redeploy", rate: 1 });
  });

  it("ends the redeploy once the composite normalizes", () => {
    const pts: AnomalyPoint[] = [];
    for (let i = 0; i < 12; i++) pts.push(pt(`c${i}`, 100, 0.2, 0));
    pts.push(pt("plunge", 80, 3.0, -5.5));
    pts.push(pt("turn", 99, 2.8, -4.5)); // redeploy on
    pts.push(pt("recovered", 101, 2.0, 0)); // composite >= resetZ(-1) -> seek; fragility 2.0 -> half
    expect(buyThrottle(pts).at(-1)).toMatchObject({ mode: "slow", rate: 0.5 });
  });

  it("null fragility deploys full (warm-up)", () => {
    expect(buyThrottle([pt("d0", 100, null, null)])[0]).toMatchObject({ mode: "full", rate: 1 });
  });

  it("DEFAULT_THROTTLE thresholds", () => {
    expect(DEFAULT_THROTTLE).toMatchObject({ halfZ: 1.5, pauseZ: 2.5 });
  });

  it("throttleSpans groups pause runs", () => {
    const pts = [pt("d0", 1, 0, 0), pt("d1", 1, 3, 0), pt("d2", 1, 3, 0), pt("d3", 1, 0, 0)];
    const rates = throttleRates(buyThrottle(pts));
    expect(throttleSpans(pts, rates, (x) => x === 0)).toEqual([{ x1: "d1", x2: "d2" }]);
  });
});

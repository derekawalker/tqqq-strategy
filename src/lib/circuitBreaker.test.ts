import { describe, it, expect } from "vitest";
import { circuitBreaker, breakerSpans, DEFAULT_BREAKER } from "./circuitBreaker";
import type { AnomalyPoint } from "./anomaly";

function pt(date: string, fragility: number | null): AnomalyPoint {
  return { date, spx: 0, shortRate: 0, yieldCurve: 0, fragility, euphoria: 0, composite: 0, creditSpreadZ: null, signal: "neutral" };
}

describe("circuitBreaker", () => {
  it("trips at armZ and resets only below disarmZ (hysteresis)", () => {
    const points = [
      pt("d0", 1.0), // calm
      pt("d1", 3.2), // >= arm(3) -> trip
      pt("d2", 2.0), // still >= disarm(1.5) -> stay tripped
      pt("d3", 1.0), // < disarm -> reset
      pt("d4", 2.5), // between arm/disarm, not tripped -> stays off
    ];
    expect(circuitBreaker(points, { armZ: 3, disarmZ: 1.5 })).toEqual([false, true, true, false, false]);
  });

  it("does not trip on a slow grind that never reaches armZ", () => {
    const points = [pt("a", 1.5), pt("b", 2.3), pt("c", 2.0), pt("d", 1.8)]; // 2022-like
    expect(circuitBreaker(points).every((x) => x === false)).toBe(true);
  });

  it("ignores null fragility (warm-up) by holding state", () => {
    const points = [pt("a", null), pt("b", 3.5), pt("c", null), pt("d", 0.5)];
    expect(circuitBreaker(points)).toEqual([false, true, true, false]);
  });

  it("default params are the validated thresholds", () => {
    expect(DEFAULT_BREAKER).toEqual({ armZ: 3, disarmZ: 1.5 });
  });

  it("breakerSpans groups contiguous tripped runs", () => {
    const points = [pt("d0", 1), pt("d1", 3.2), pt("d2", 2), pt("d3", 1), pt("d4", 3.5)];
    const state = circuitBreaker(points);
    expect(breakerSpans(points, state)).toEqual([
      { x1: "d1", x2: "d2" },
      { x1: "d4", x2: "d4" },
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { dailyAdvice, backtestAdvice, DEFAULT_ADVICE } from "./advice";
import type { AnomalyPoint, SignalKind } from "./anomaly";

function pt(
  date: string,
  spx: number,
  composite = 0,
  signal: SignalKind = "neutral",
  creditSpreadZ: number | null = null,
): AnomalyPoint {
  return { date, spx, shortRate: 0, yieldCurve: 0, fragility: 0, euphoria: 0, composite, creditSpreadZ, signal };
}

// Build n rising days (so the MA exists and price is above it), then a custom tail.
function rampThen(n: number, base: number, tail: { spx: number; composite?: number }[]): AnomalyPoint[] {
  const head = Array.from({ length: n }, (_, i) => pt(`d${i}`, base + i));
  return [...head, ...tail.map((t, i) => pt(`t${i}`, t.spx, t.composite ?? 0))];
}

const P = { maPeriod: 10, band: 0.03, confirmDays: 3, capitulation: -3, creditStressZ: 1, reducedExposure: 0.5 };

describe("dailyAdvice", () => {
  it("stays 'normal' and invested in a steady uptrend", () => {
    const adv = dailyAdvice(rampThen(40, 100, []), P);
    const live = adv.filter((a) => a.ma != null);
    expect(live.every((a) => a.stance === "in")).toBe(true);
    expect(live.every((a) => a.action === "normal")).toBe(true);
  });

  it("says GET OUT after price holds below the MA for confirmDays", () => {
    // 40 rising days near ~120-160, then a sharp drop well below the MA
    const tail = [{ spx: 100 }, { spx: 98 }, { spx: 96 }, { spx: 94 }];
    const adv = dailyAdvice(rampThen(40, 120, tail), P);
    const out = adv.find((a) => a.action === "get-out");
    expect(out).toBeTruthy();
    expect(adv.at(-1)!.stance).toBe("out");
  });

  it("snaps GET BACK IN on a capitulation extreme while out", () => {
    // drop out, then a deep composite reading should re-enter even though price
    // is still below the MA
    const tail = [
      { spx: 100 },
      { spx: 96 },
      { spx: 92 },
      { spx: 88 }, // -> get-out confirmed around here
      { spx: 80, composite: -4 }, // capitulation -> get-back-in
    ];
    const adv = dailyAdvice(rampThen(40, 120, tail), P);
    const backIn = adv.find((a) => a.action === "get-back-in");
    expect(backIn).toBeTruthy();
    expect(backIn!.reason).toMatch(/capitulation/i);
    expect(adv.at(-1)!.stance).toBe("in");
  });

  it("default params expose the validated settings", () => {
    expect(DEFAULT_ADVICE).toMatchObject({
      maPeriod: 200,
      band: 0.03,
      confirmDays: 3,
      capitulation: -3,
      creditStressZ: 1,
      reducedExposure: 0.5,
    });
  });

  it("halves exposure during a credit-stress regime while still invested", () => {
    // steady uptrend (stays 'in'); credit spread spikes partway through
    const head = Array.from({ length: 40 }, (_, i) => pt(`d${i}`, 100 + i, 0, "neutral", 0));
    const stressed = [
      pt("s0", 142, 0, "neutral", 0.2),
      pt("s1", 143, 0, "neutral", 1.6), // -> reduce-risk
      pt("s2", 144, 0, "neutral", 1.6),
      pt("s3", 145, 0, "neutral", 0.1), // -> restore-risk
    ];
    const adv = dailyAdvice([...head, ...stressed], P);
    const reduce = adv.find((a) => a.action === "reduce-risk");
    const restore = adv.find((a) => a.action === "restore-risk");
    expect(reduce).toBeTruthy();
    expect(reduce!.exposure).toBe(P.reducedExposure);
    expect(reduce!.stance).toBe("in"); // still invested, just lighter
    expect(restore).toBeTruthy();
    expect(adv.at(-1)!.exposure).toBe(1);
  });
});

describe("backtestAdvice", () => {
  it("sits in cash (flat) while out through a decline the benchmark suffers", () => {
    const tail = [{ spx: 100 }, { spx: 96 }, { spx: 92 }, { spx: 88 }, { spx: 70 }, { spx: 65 }];
    const points = rampThen(40, 120, tail);
    const adv = dailyAdvice(points, P);
    const bt = backtestAdvice(adv, points);
    expect(bt.equity.length).toBeGreaterThan(0);
    // strategy should end higher than benchmark since it side-stepped the worst
    expect(bt.strategy.totalReturn).toBeGreaterThan(bt.benchmark.totalReturn);
    expect(bt.strategy.maxDrawdown).toBeGreaterThan(bt.benchmark.maxDrawdown); // less negative
    expect(bt.pctInMarket).toBeLessThan(1);
    expect(bt.switches).toBeGreaterThanOrEqual(1);
  });
});

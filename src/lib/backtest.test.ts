import { describe, it, expect } from "vitest";
import { maxDrawdown, performance, forwardStudy, backtest, DEFAULT_OPTIONS } from "./backtest";
import type { AnomalyPoint, SignalKind } from "./anomaly";

function pt(date: string, spx: number, signal: SignalKind, shortRate = 0): AnomalyPoint {
  return { date, spx, shortRate, yieldCurve: 0, fragility: 0, euphoria: 0, composite: 0, signal };
}

describe("maxDrawdown", () => {
  it("is 0 for a monotonically rising curve", () => {
    expect(maxDrawdown([1, 1.1, 1.2, 1.3])).toBe(0);
  });
  it("captures the worst peak-to-trough decline", () => {
    // peak 2 -> trough 1 => -50%
    expect(maxDrawdown([1, 2, 1.5, 1, 1.8])).toBeCloseTo(-0.5, 10);
  });
});

describe("performance", () => {
  it("annualizes and computes drawdown for a simple curve", () => {
    const rets = [0.01, -0.02, 0.03, -0.01];
    const equity = [1];
    for (const r of rets) equity.push(equity[equity.length - 1] * (1 + r));
    const m = performance(rets, equity, [0, 0, 0, 0]);
    expect(m.totalReturn).toBeCloseTo(equity[equity.length - 1] - 1, 10);
    expect(m.annVol).toBeGreaterThan(0);
    expect(m.maxDrawdown).toBeLessThan(0);
  });
});

describe("forwardStudy", () => {
  it("attributes forward returns to the signal in effect on the start day", () => {
    // Day 0 is a crash signal; price falls hard over the next 2 days.
    const points = [
      pt("2024-01-01", 100, "crash"),
      pt("2024-01-02", 95, "neutral"),
      pt("2024-01-03", 90, "neutral"),
      pt("2024-01-04", 92, "boom"),
      pt("2024-01-05", 99, "neutral"),
    ];
    const [h1] = forwardStudy(points, [1]);
    // crash day 0: fwd = 95/100 - 1 = -0.05
    expect(h1.crash).toBeCloseTo(-0.05, 10);
    // boom day 3: fwd = 99/92 - 1 > 0
    expect(h1.boom!).toBeGreaterThan(0);
    expect(h1.crashHitRate).toBe(1); // the one crash day was followed by a decline
    expect(h1.boomHitRate).toBe(1);
    expect(h1.crashDays).toBe(1);
  });
});

describe("backtest", () => {
  it("crash exposure of 0 sidesteps a drawdown that hits buy & hold", () => {
    // Signal goes crash on day 0, so day 1's -20% move is avoided (lagged position).
    const points = [
      pt("2024-01-01", 100, "crash", 0),
      pt("2024-01-02", 80, "crash", 0), // -20% day, strategy was in cash
      pt("2024-01-03", 84, "neutral", 0),
    ];
    const res = backtest(points, DEFAULT_OPTIONS);
    // Benchmark took the full hit; strategy stayed flat through the crash day.
    expect(res.benchmark.maxDrawdown).toBeCloseTo(-0.2, 10);
    expect(res.strategy.maxDrawdown).toBeGreaterThan(res.benchmark.maxDrawdown);
    expect(res.equity[1].strategy).toBeCloseTo(1, 10); // unchanged on the crash day
    expect(res.signalDays.crash).toBe(2);
  });

  it("boom leverage amplifies an up move via the prior-day signal", () => {
    const points = [
      pt("2024-01-01", 100, "boom", 0),
      pt("2024-01-02", 110, "neutral", 0), // +10% benchmark, strategy was 3x
    ];
    const res = backtest(points, { boomLeverage: 3, neutralLeverage: 1, crashLeverage: 0 });
    expect(res.equity[1].benchmark).toBeCloseTo(1.1, 10);
    expect(res.equity[1].strategy).toBeCloseTo(1.3, 10); // 3 × 10%
  });

  it("cash position earns the short rate when fully de-risked", () => {
    const points = [
      pt("2024-01-01", 100, "crash", 5.04), // 5.04%/yr ≈ 0.02%/day
      pt("2024-01-02", 100, "crash", 5.04),
    ];
    const res = backtest(points);
    // flat market, but cash earns 0.0504/252 on day 2
    expect(res.equity[1].strategy).toBeCloseTo(1 + 0.0504 / 252, 8);
  });
});

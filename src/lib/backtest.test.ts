import { describe, it, expect } from "vitest";
import { maxDrawdown, performance, forwardStudy, backtest, DEFAULT_OPTIONS, strategyOptionsFor, tradeSignals } from "./backtest";
import type { AnomalyPoint, SignalKind } from "./anomaly";

function pt(date: string, spx: number, signal: SignalKind, shortRate = 0): AnomalyPoint {
  return { date, spx, shortRate, yieldCurve: 0, fragility: 0, euphoria: 0, composite: 0, creditSpreadZ: null, signal };
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

describe("tradeSignals", () => {
  it("BUYs when a crash episode ends and SELLs when a boom begins", () => {
    const points = [
      pt("2024-01-01", 100, "neutral"),
      pt("2024-01-02", 95, "crash"), // crash begins (no buy yet — falling knife)
      pt("2024-01-03", 92, "crash"), // still falling
      pt("2024-01-04", 96, "neutral"), // crash ENDS -> BUY (panic subsided, near the turn)
      pt("2024-01-05", 110, "boom"), // boom begins -> SELL (fade greed)
      pt("2024-01-06", 112, "boom"),
      pt("2024-01-07", 108, "crash"), // crash begins again, hasn't ended -> no buy yet
    ];
    expect(tradeSignals(points)).toEqual([
      { date: "2024-01-04", spx: 96, action: "buy" },
      { date: "2024-01-05", spx: 110, action: "sell" },
    ]);
  });

  it("does not BUY while still inside an unfinished crash episode", () => {
    const points = [pt("a", 100, "neutral"), pt("b", 90, "crash"), pt("c", 85, "crash")];
    expect(tradeSignals(points)).toEqual([]);
  });

  it("returns nothing when the signal never leaves neutral", () => {
    expect(tradeSignals([pt("2024-01-01", 100, "neutral"), pt("2024-01-02", 101, "neutral")])).toEqual([]);
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

  it("strategyOptionsFor maps mode + leverage to per-state exposure", () => {
    expect(strategyOptionsFor("trend", 3)).toEqual({ crashLeverage: 0, neutralLeverage: 1, boomLeverage: 3 });
    // contrarian: lever into crashes, sit in cash during booms
    expect(strategyOptionsFor("contrarian", 2)).toEqual({ crashLeverage: 2, neutralLeverage: 1, boomLeverage: 0 });
    // contrarian at 1x = the "trim froth" play: stay invested except sell on boom
    expect(strategyOptionsFor("contrarian", 1)).toEqual({ crashLeverage: 1, neutralLeverage: 1, boomLeverage: 0 });
  });

  it("contrarian de-risks on the prior-day boom signal", () => {
    const points = [
      pt("2024-01-01", 100, "boom", 0),
      pt("2024-01-02", 90, "neutral", 0), // -10% day; contrarian was in cash, trend was 2x
    ];
    const contra = backtest(points, strategyOptionsFor("contrarian", 2));
    const trend = backtest(points, strategyOptionsFor("trend", 2));
    expect(contra.equity[1].strategy).toBeCloseTo(1, 10); // sidestepped the drop
    expect(trend.equity[1].strategy).toBeCloseTo(1 + 2 * -0.1, 10); // 2x the -10%
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

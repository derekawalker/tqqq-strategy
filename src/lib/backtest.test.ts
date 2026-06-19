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
  // pt(date, spx, signal, shortRate); compose with composite via spread
  const cp = (date: string, spx: number, composite: number, signal: SignalKind = "neutral") => ({
    ...pt(date, spx, signal),
    composite,
  });

  // Use a 2-day MA so short fixtures can exercise the price-turn confirmation.
  const ts = (points: AnomalyPoint[], thr = -5) => tradeSignals(points, thr, 2);

  it("BUYs only after composite hits the zone AND price turns up", () => {
    const points = [
      cp("d0", 100, -1, "neutral"),
      cp("d1", 96, -3, "crash"), // not deep enough
      cp("d2", 92, -6, "crash"), // <= -5 -> awaiting the turn (no buy: still falling)
      cp("d3", 88, -7, "crash"), // sma2[92,88]=90, 88<90 -> no buy
      cp("d4", 98, -4, "crash"), // sma2[88,98]=93, 98>93 -> BUY (turn confirmed)
      cp("d5", 108, 0, "neutral"), // composite >= -1 -> re-armed
      cp("d6", 120, 2, "boom"), // boom begins -> SELL
    ];
    expect(ts(points)).toEqual([
      { date: "d4", spx: 98, action: "buy" },
      { date: "d6", spx: 120, action: "sell" },
    ]);
  });

  it("does not BUY while still falling inside the deep zone", () => {
    const points = [cp("a", 100, -1), cp("b", 95, -6), cp("c", 90, -7), cp("d", 85, -8)];
    expect(ts(points)).toEqual([]); // reached -5 but price never turned up
  });

  it("fires a second BUY only after the composite resets above the re-arm level", () => {
    const points = [
      cp("d0", 100, -1),
      cp("d1", 90, -6), // deep
      cp("d2", 96, -5), // sma2[90,96]=93, 96>93 -> BUY #1
      cp("d3", 92, -4), // cooldown (composite still < -1)
      cp("d4", 110, 0), // composite >= -1 -> re-armed
      cp("d5", 95, -6), // deep again
      cp("d6", 100, -4), // sma2[95,100]=97.5, 100>97.5 -> BUY #2
    ];
    expect(ts(points).filter((s) => s.action === "buy").map((s) => s.date)).toEqual(["d2", "d6"]);
  });

  it("respects a custom deep-buy threshold", () => {
    const shallow = [cp("a", 100, -1), cp("b", 96, -4), cp("c", 102, -3)];
    expect(ts(shallow, -5).filter((s) => s.action === "buy")).toHaveLength(0); // -4 not deep enough for -5
    expect(ts(shallow, -3.5).filter((s) => s.action === "buy")).toHaveLength(1); // -4 qualifies, then turns up
  });

  it("returns nothing when the composite never reaches the zone", () => {
    expect(ts([cp("a", 100, -1), cp("b", 101, -2)])).toEqual([]);
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

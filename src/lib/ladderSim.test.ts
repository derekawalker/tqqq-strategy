import { describe, it, expect } from "vitest";
import { simulateLadder, DEFAULT_LADDER, type LadderParams } from "./ladderSim";

const P: LadderParams = { startingCash: 100000, stepPct: 1, sellPct: 5, reductionFactor: 1, reanchorPct: 0 };

describe("simulateLadder", () => {
  it("buys a lot on the dip and sells it for the target gain", () => {
    // anchor 100: level0 buys @100, level1 @99 (sell @103.95), level0 sells @105
    const bars = [
      { date: "d0", close: 100 }, // buy level0 @100
      { date: "d1", close: 99 }, // buy level1 @99
      { date: "d2", close: 105 }, // sell level0 (>=105) and level1 (>=103.95)
    ];
    const r = simulateLadder(bars, P);
    expect(r.buys).toBe(2);
    expect(r.sells).toBe(2);
    expect(r.realizedProfit).toBeGreaterThan(0);
    expect(r.finalValue).toBeGreaterThan(r.equity[0].value); // ended in profit
  });

  it("pause mask suppresses buying on tripped days", () => {
    const bars = [
      { date: "d0", close: 100 },
      { date: "d1", close: 99 }, // would buy level1 — but paused
      { date: "d2", close: 105 },
    ];
    const r = simulateLadder(bars, P, [false, true, false]);
    expect(r.buys).toBe(1); // only level0 on d0
    expect(r.sells).toBe(1);
  });

  it("preserves dry powder through a crash when the breaker is on", () => {
    // a fast decline: without pause it buys all the way down; with pause it doesn't
    const bars = [{ date: "d0", close: 100 }];
    for (let i = 1; i <= 30; i++) bars.push({ date: `d${i}`, close: 100 - i * 2 }); // -2%/day
    const free = simulateLadder(bars, P);
    const paused = simulateLadder(bars, P, bars.map((_, i) => i >= 2)); // breaker trips after day 1
    expect(paused.buys).toBeLessThan(free.buys);
    // less deployed into the falling knife -> shallower drawdown
    expect(paused.maxDrawdown).toBeGreaterThan(free.maxDrawdown);
  });

  it("uses intraday high/low to catch touches a flat close would miss", () => {
    // d1 closes flat at 100 (no close-cross) but dipped to 98 and popped to 106
    const bars = [
      { date: "d0", close: 100 }, // buy level0 @100
      { date: "d1", close: 100, high: 106, low: 98 }, // intraday: sell level0 (hi≥105), buy levels 1 & 2 (lo≤99/98)
    ];
    const ohlc = simulateLadder(bars, P);
    const closeOnly = simulateLadder([{ date: "d0", close: 100 }, { date: "d1", close: 100 }], P);
    expect(ohlc.buys).toBeGreaterThan(closeOnly.buys); // intraday range catches more
    expect(ohlc.sells).toBeGreaterThanOrEqual(1);
  });

  it("handles R=1 (uniform allocation) without NaN", () => {
    const bars = [{ date: "d0", close: 100 }, { date: "d1", close: 98 }];
    const r = simulateLadder(bars, P);
    expect(Number.isFinite(r.finalValue)).toBe(true);
    expect(r.buys).toBeGreaterThan(0);
  });

  it("DEFAULT_LADDER is a sane uniform ladder", () => {
    expect(DEFAULT_LADDER).toMatchObject({ stepPct: 1, sellPct: 5, reductionFactor: 1 });
  });
});

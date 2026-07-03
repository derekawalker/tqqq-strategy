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

  it("fractional throttle buys half-size lots (deploys less cash)", () => {
    const bars = [
      { date: "d0", close: 100 }, // level0 @100
      { date: "d1", close: 98 }, // levels 1 & 2 touched
    ];
    const full = simulateLadder(bars, P);
    const half = simulateLadder(bars, P, [0.5, 0.5]);
    // same number of levels touched, but each lot is ~half the shares -> less cash deployed
    const fullInvested = full.equity.at(-1)!.value; // value = cash + lots (≈ start, MTM)
    expect(half.buys).toBe(full.buys);
    expect(half.peakInvested).toBeLessThan(full.peakInvested);
    expect(fullInvested).toBeGreaterThan(0);
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

  describe("sellPctOverride", () => {
    it("uses the override's sell target instead of p.sellPct for a lot bought that day", () => {
      // level0 buys @100. With p.sellPct=5 it needs 105 to sell; with a 3% override
      // it only needs 103, so it should sell a day earlier.
      const bars = [
        { date: "d0", close: 100 }, // buy level0 @100
        { date: "d1", close: 103 }, // sells only under the 3% override (needs >=103)
      ];
      const withOverride = simulateLadder(bars, P, undefined, [3, 3]);
      const withoutOverride = simulateLadder(bars, P);
      expect(withOverride.sells).toBe(1);
      expect(withoutOverride.sells).toBe(0);
    });

    it("keeps the target a lot was bought with even if the override later changes", () => {
      // level0 buys @100 under a 3% override (sell target 103). Day 2's override (5%)
      // must NOT retroactively raise that lot's target to 105.
      const bars = [
        { date: "d0", close: 100 }, // buy level0 @100 under override[0]=3 -> target 103
        { date: "d1", close: 103, high: 103 }, // hits the original 3% target, not a 5% one
      ];
      const r = simulateLadder(bars, P, undefined, [3, 5]);
      expect(r.sells).toBe(1);
    });

    it("falls back to p.sellPct for bars beyond the override array's length", () => {
      const bars = [
        { date: "d0", close: 100 }, // no override[0] -> uses p.sellPct (5%) -> target 105
        { date: "d1", close: 103 }, // below the 5% target, should not sell yet
      ];
      const r = simulateLadder(bars, P, undefined, []);
      expect(r.sells).toBe(0);
    });

    it("is a no-op (identical result to omitting it) when absent", () => {
      const bars = [
        { date: "d0", close: 100 },
        { date: "d1", close: 99 },
        { date: "d2", close: 105 },
      ];
      const withUndefined = simulateLadder(bars, P);
      const explicitlyOmitted = simulateLadder(bars, P, undefined, undefined);
      expect(explicitlyOmitted).toEqual(withUndefined);
    });
  });

  describe("corePct", () => {
    const bars = [
      { date: "d0", close: 100 },
      { date: "d1", close: 99 },
      { date: "d2", close: 150 }, // strong rally the ladder mostly sits out (sold, in cash)
    ];

    it("is a no-op (identical result) when omitted or zero", () => {
      const omitted = simulateLadder(bars, P);
      const zero = simulateLadder(bars, { ...P, corePct: 0 });
      expect(zero).toEqual(omitted);
    });

    it("buys the core once at the anchor price and never sells it", () => {
      const r = simulateLadder(bars, { ...P, corePct: 50 });
      // 50% of 100000 = 50000 at anchor 100 -> 500 core shares, held the whole way;
      // final value must include their full mark-to-market at the last close (150).
      const noCoreLadderOnly = simulateLadder(bars, { ...P, startingCash: 50000 });
      const coreMtm = 500 * 150;
      expect(r.finalValue).toBeCloseTo(noCoreLadderOnly.finalValue + coreMtm, 0);
    });

    it("sizes the ladder off the remaining cash, not the full startingCash", () => {
      // With half the cash walled off into the core, the ladder-only side (a
      // separate sim run at that half-sized cash pool) should match the ladder
      // portion of the core-and-ladder run almost exactly.
      const halfCore = simulateLadder(bars, { ...P, corePct: 50 });
      const ladderOnlyAtHalfCash = simulateLadder(bars, { ...P, startingCash: 50000 });
      const coreMtm = 500 * bars[bars.length - 1].close; // 500 core shares from the 50% carve-out
      expect(halfCore.finalValue - coreMtm).toBeCloseTo(ladderOnlyAtHalfCash.finalValue, 0);
    });

    it("peak-invested rises with a permanent core, since it's always fully deployed", () => {
      const noCore = simulateLadder(bars, P);
      const withCore = simulateLadder(bars, { ...P, corePct: 50 });
      expect(withCore.peakInvested).toBeGreaterThan(noCore.peakInvested);
    });

    it("a larger core captures more of a rally the ladder itself sits out", () => {
      const noCore = simulateLadder(bars, { ...P, corePct: 0 });
      const bigCore = simulateLadder(bars, { ...P, corePct: 80 });
      // Both start at the same equity; after the rally, more core = more upside
      // captured that a sold-out ladder would otherwise miss entirely.
      expect(bigCore.totalReturn).toBeGreaterThan(noCore.totalReturn);
    });

    it("clamps out-of-range corePct to [0, 100]", () => {
      const over = simulateLadder(bars, { ...P, corePct: 150 });
      const capped = simulateLadder(bars, { ...P, corePct: 100 });
      expect(over.finalValue).toBeCloseTo(capped.finalValue, 0);
    });
  });
});

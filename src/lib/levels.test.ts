import { describe, it, expect } from "vitest";
import { computeLevels, matchLevel, computeCurrentLevel } from "./levels";

// ── computeLevels ─────────────────────────────────────────────────────────────

describe("computeLevels", () => {
  const levels = computeLevels(200000, 70, 5, 0.95);

  it("generates 88 levels", () => {
    expect(levels).toHaveLength(88);
  });

  it("level 0 buy price equals initialLotPrice", () => {
    expect(levels[0].buyPrice).toBe(70);
  });

  it("each level buy price decreases by 1% of initialLotPrice from the previous", () => {
    // Formula is linear: buyPrice = initialLotPrice * (1 - 0.01 * n)
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].buyPrice).toBeCloseTo(70 - 0.01 * i * 70, 5);
    }
  });

  it("sell price is buyPrice * (1 + sellPercentage/100)", () => {
    for (const l of levels) {
      expect(l.sellPrice).toBeCloseTo(l.buyPrice * 1.05, 5);
    }
  });

  it("level n property matches array index", () => {
    levels.forEach((l, i) => expect(l.n).toBe(i));
  });

  it("allocated cash sums to approximately levelStartingCash", () => {
    const total = levels.reduce((sum, l) => sum + l.cost, 0);
    expect(total).toBeGreaterThan(190000);
    expect(total).toBeLessThan(210000);
  });
});

// ── matchLevel ────────────────────────────────────────────────────────────────

describe("matchLevel", () => {
  const levels = computeLevels(200000, 70, 5, 0.95);

  it("matches an exact buy price fill", () => {
    const idx = matchLevel(levels, levels[0].shares, levels[0].buyPrice);
    expect(idx).toBe(0);
  });

  it("matches an exact sell price fill", () => {
    const idx = matchLevel(levels, levels[0].shares, levels[0].sellPrice);
    expect(idx).toBe(0);
  });

  it("matches within $0.01 of buy price", () => {
    // Use 0.009 — 0.01 hits floating-point rounding at the boundary
    const idx = matchLevel(levels, levels[5].shares, levels[5].buyPrice + 0.009);
    expect(idx).toBe(5);
  });

  it("does not match a fill $0.02 away from any level price", () => {
    const idx = matchLevel(levels, levels[5].shares, levels[5].buyPrice + 0.02);
    expect(idx).toBe(-1);
  });

  it("returns -1 when share count matches no level", () => {
    const idx = matchLevel(levels, 999999, levels[0].buyPrice);
    expect(idx).toBe(-1);
  });

  it("returns -1 when price is way off even if shares match", () => {
    // This is the regression: before the $0.01 tolerance, stale fills from
    // old settings would spuriously match new levels if shares coincided.
    const idx = matchLevel(levels, levels[0].shares, levels[0].buyPrice + 10);
    expect(idx).toBe(-1);
  });
});

// ── computeCurrentLevel ───────────────────────────────────────────────────────

describe("computeCurrentLevel", () => {
  const levels = computeLevels(200000, 70, 5, 0.95);

  it("returns -1 with no orders", () => {
    expect(computeCurrentLevel(levels, [])).toBe(-1);
  });

  it("returns the highest bought level index", () => {
    const orders = [
      { side: "BUY" as const, shares: levels[2].shares, fillPrice: levels[2].buyPrice },
      { side: "BUY" as const, shares: levels[1].shares, fillPrice: levels[1].buyPrice },
      { side: "BUY" as const, shares: levels[0].shares, fillPrice: levels[0].buyPrice },
    ];
    expect(computeCurrentLevel(levels, orders)).toBe(2);
  });

  it("returns -1 after selling the only owned level", () => {
    // Buy L0, then sell L0 — most recent action for L0 is SELL
    const orders = [
      { side: "SELL" as const, shares: levels[0].shares, fillPrice: levels[0].sellPrice },
      { side: "BUY" as const, shares: levels[0].shares, fillPrice: levels[0].buyPrice },
    ];
    expect(computeCurrentLevel(levels, orders)).toBe(-1);
  });

  it("recognises a re-buy after a sell (the sell-then-rebuy regression)", () => {
    // Sequence (newest first): re-buy L1, re-buy L2, sell L1
    // The sell cap must not fire because L1 was re-bought after the sell.
    const orders = [
      { side: "BUY" as const, shares: levels[2].shares, fillPrice: levels[2].buyPrice },
      { side: "BUY" as const, shares: levels[1].shares, fillPrice: levels[1].buyPrice },
      { side: "SELL" as const, shares: levels[1].shares, fillPrice: levels[1].sellPrice },
    ];
    expect(computeCurrentLevel(levels, orders)).toBe(2);
  });
});

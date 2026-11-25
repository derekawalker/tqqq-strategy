import { describe, it, expect } from "vitest";
import { shortOptionsPl, ladderBuysAtTrough, putAssignmentCash } from "./crashStress";
import type { OptionPosition } from "./schwab/parse";
import type { Level } from "./levels";

const NOW = new Date("2026-11-25T12:00:00");

function opt(over: Partial<OptionPosition>): OptionPosition {
  return {
    accountNumber: "A",
    symbol: "TQQQ  261218P00045000",
    underlyingSymbol: "TQQQ",
    putCall: "PUT",
    strike: 45,
    expiry: "2026-12-18",
    shortQty: 1,
    longQty: 0,
    marketValue: -100, // $1.00 mark
    averagePrice: 1.5,
    openedAt: null,
    ...over,
  };
}

describe("shortOptionsPl", () => {
  it("a short put expiring mid-crash settles at intrinsic on the path price", () => {
    // 24 DTE (to the close on expiry day), 48-day crash to -50%: at expiry the
    // path is 50 * (1 - 0.5 * 24/48) = 37.5
    const pl = shortOptionsPl([opt({})], 50, { tqqqMove: -0.5, days: 48, iv: 1 }, NOW);
    expect(pl).toBeCloseTo(100 - (45 - 37.5) * 100, 0); // -650
  });

  it("a short put that outlives the crash is marked at the trough with time value", () => {
    const longDated = opt({ expiry: "2027-03-19" });
    const pl = shortOptionsPl([longDated], 50, { tqqqMove: -0.5, days: 20, iv: 1 }, NOW);
    expect(pl).toBeLessThan(100 - (45 - 25) * 100); // worse than intrinsic alone
  });

  it("a short call gains in a crash", () => {
    const call = opt({ putCall: "CALL", strike: 60, symbol: "TQQQ  261218C00060000", marketValue: -150 });
    expect(shortOptionsPl([call], 50, { tqqqMove: -0.5, days: 46, iv: 1 }, NOW)).toBeCloseTo(150, 0);
  });

  it("ignores long positions and other underlyings", () => {
    const positions = [opt({ shortQty: 0, longQty: 2 }), opt({ underlyingSymbol: "QQQ" })];
    expect(shortOptionsPl(positions, 50, { tqqqMove: -0.5, days: 46, iv: 1 }, NOW)).toBe(0);
  });
});

describe("ladderBuysAtTrough", () => {
  const lvl = (n: number, buyPrice: number, shares = 10): Level =>
    ({ n, buyPrice, sellPrice: buyPrice * 1.05, shares, cost: buyPrice * shares, purchased: false });
  const levels = [lvl(0, 55), lvl(1, 48), lvl(2, 40), lvl(3, 30)];

  it("fills unowned rungs between spot and trough and marks them at the trough", () => {
    // spot 50, -30% → trough 35: rungs at 48 and 40 fill; 55 is above spot, 30 below the trough
    const r = ladderBuysAtTrough(levels, new Set(), 50, -0.3);
    expect(r.cost).toBeCloseTo(480 + 400);
    expect(r.pl).toBeCloseTo(10 * (35 - 48) + 10 * (35 - 40));
  });

  it("skips rungs already owned", () => {
    expect(ladderBuysAtTrough(levels, new Set([1]), 50, -0.3).cost).toBeCloseTo(400);
  });
});

describe("putAssignmentCash", () => {
  it("counts short puts struck at or above the trough", () => {
    const positions = [opt({ strike: 45, shortQty: 2 }), opt({ strike: 30 }), opt({ putCall: "CALL", strike: 60 })];
    expect(putAssignmentCash(positions, 35)).toBe(45 * 100 * 2);
  });
});

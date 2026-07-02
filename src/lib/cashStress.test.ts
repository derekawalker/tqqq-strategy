import { describe, it, expect } from "vitest";
import { computeCashStress, worstShortfall } from "./cashStress";
import type { Level } from "./levels";

function level(n: number, buyPrice: number, shares: number): Level {
  return { n, buyPrice, sellPrice: buyPrice * 1.05, shares, cost: shares * buyPrice, purchased: false };
}

describe("computeCashStress", () => {
  const levels: Level[] = [
    level(0, 100, 10), // cost 1000
    level(1, 90, 10), // cost 900
    level(2, 80, 10), // cost 800
    level(3, 70, 10), // cost 700
  ];

  it("only counts unpurchased levels whose buy price is at/above the scenario price", () => {
    const points = computeCashStress({
      levels,
      ownedLevelIndices: new Set(), // nothing owned yet
      shortPuts: [],
      currentPrice: 100,
      cashAvailable: 0,
      maxDropPct: 0.3,
      stepPct: 0.1,
    });
    // price=100 (0% drop): levels with buyPrice>=100 -> level0 only -> 1000
    expect(points[0].price).toBeCloseTo(100);
    expect(points[0].ladderCash).toBe(1000);
    // price=90 (10% drop): levels 0,1 -> 1000+900=1900
    expect(points[1].price).toBeCloseTo(90);
    expect(points[1].ladderCash).toBe(1900);
    // price=80 (20% drop): levels 0,1,2 -> 2700
    expect(points[2].ladderCash).toBe(2700);
    // price=70 (30% drop): all levels -> 3400
    expect(points[3].ladderCash).toBe(3400);
  });

  it("excludes already-owned levels from ladder cash demand", () => {
    const points = computeCashStress({
      levels,
      ownedLevelIndices: new Set([0, 1]), // levels 0 and 1 already bought
      shortPuts: [],
      currentPrice: 100,
      cashAvailable: 0,
      maxDropPct: 0.3,
      stepPct: 0.3,
    });
    // At -30% (all 4 levels touched), only levels 2 and 3 remain unpurchased: 800+700=1500
    const last = points[points.length - 1];
    expect(last.ladderCash).toBe(1500);
  });

  it("adds put assignment collateral once the strike is reached", () => {
    const points = computeCashStress({
      levels: [],
      ownedLevelIndices: new Set(),
      shortPuts: [{ strike: 85, shortQty: 2 }], // 85 * 100 * 2 = 17000
      currentPrice: 100,
      cashAvailable: 0,
      maxDropPct: 0.2,
      stepPct: 0.05,
    });
    // price=100,95,90 -> strike 85 not yet in range (85 < price) -> 0
    expect(points[0].putCollateral).toBe(0);
    expect(points[1].putCollateral).toBe(0);
    expect(points[2].putCollateral).toBe(0);
    // price=85 (15% drop) -> strike >= price -> 17000
    const at85 = points.find((p) => Math.abs(p.price - 85) < 0.01)!;
    expect(at85.putCollateral).toBe(17000);
  });

  it("computes shortfall as totalNeeded minus cashAvailable", () => {
    const points = computeCashStress({
      levels,
      ownedLevelIndices: new Set(),
      shortPuts: [],
      currentPrice: 100,
      cashAvailable: 1500,
      maxDropPct: 0.3,
      stepPct: 0.1,
    });
    // price=90: needed 1900, available 1500 -> shortfall 400
    expect(points[1].shortfall).toBe(400);
    // price=100: needed 1000, available 1500 -> shortfall -500 (surplus)
    expect(points[0].shortfall).toBe(-500);
  });

  it("returns an empty array for a non-positive current price", () => {
    expect(computeCashStress({ levels, ownedLevelIndices: new Set(), shortPuts: [], currentPrice: 0, cashAvailable: 0 })).toEqual([]);
  });
});

describe("worstShortfall", () => {
  it("returns the point with the largest shortfall", () => {
    const points = computeCashStress({
      levels: [level(0, 100, 10), level(1, 50, 100)], // cost 1000, 5000
      ownedLevelIndices: new Set(),
      shortPuts: [],
      currentPrice: 100,
      cashAvailable: 1000,
      maxDropPct: 0.5,
      stepPct: 0.1,
    });
    const worst = worstShortfall(points);
    expect(worst).not.toBeNull();
    // deepest scenario pulls in the big level-1 cost -> largest shortfall
    expect(worst!.price).toBeCloseTo(50, 0);
  });

  it("returns null for an empty sweep", () => {
    expect(worstShortfall([])).toBeNull();
  });
});

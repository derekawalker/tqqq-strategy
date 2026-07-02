import { describe, it, expect } from "vitest";
import { tqqqReturnForShock, runCrashStress, DEFAULT_CRASH_SCENARIOS } from "./crashStress";
import type { Level } from "./levels";
import type { OptionPosition } from "./schwab/parse";

function level(n: number, buyPrice: number, shares: number): Level {
  return { n, buyPrice, sellPrice: buyPrice * 1.05, shares, cost: shares * buyPrice, purchased: false };
}

function position(overrides: Partial<OptionPosition>): OptionPosition {
  return {
    accountNumber: "1",
    symbol: "TEST",
    underlyingSymbol: "TQQQ",
    putCall: "PUT",
    strike: 50,
    expiry: "2027-01-01",
    shortQty: 0,
    longQty: 0,
    marketValue: 0,
    averagePrice: 0,
    openedAt: null,
    ...overrides,
  };
}

describe("tqqqReturnForShock", () => {
  it("is calibrated against this app's documented crash anchors", () => {
    // hedgeTranches.ts: QQQ -25% ~ TQQQ -55-60%.
    const r25 = tqqqReturnForShock(0.25, 50);
    expect(-r25).toBeGreaterThan(0.55);
    expect(-r25).toBeLessThan(0.62);

    // hedgeTranches.ts: QQQ -35% ~ TQQQ -75%+.
    const r35 = tqqqReturnForShock(0.35, 70);
    expect(-r35).toBeGreaterThan(0.70);
    expect(-r35).toBeLessThan(0.80);
  });

  it("never drops below -100% even for extreme shocks", () => {
    const r = tqqqReturnForShock(0.95, 200);
    expect(r).toBeGreaterThan(-1);
    expect(r).toBeLessThan(0);
  });

  it("decays slightly even at a 0% QQQ move, due to volatility drag", () => {
    // A leveraged fund bleeds value to vol drag even in a flat/choppy market —
    // this is a real, well-documented property, not a bug.
    const r = tqqqReturnForShock(0, 20);
    expect(r).toBeLessThan(0);
    expect(r).toBeCloseTo(0, 1); // small at moderate vol
  });

  it("has no decay at zero vol regardless of the QQQ move", () => {
    expect(tqqqReturnForShock(0, 0)).toBeCloseTo(0, 6);
    // Pure compounding, no decay term: 3x daily-reset return of a smooth decline.
    const r = tqqqReturnForShock(0.20, 0);
    expect(r).toBeLessThan(0);
    expect(r).toBeGreaterThan(-0.60); // shallower than naive 3x — compounding on a shrinking base
  });

  it("gets worse (more negative) with higher shocked vol at a fixed QQQ drop", () => {
    const lowVol = tqqqReturnForShock(0.20, 30);
    const highVol = tqqqReturnForShock(0.20, 90);
    expect(highVol).toBeLessThan(lowVol);
  });
});

describe("runCrashStress", () => {
  const levels: Level[] = [level(0, 80, 100), level(1, 70, 100), level(2, 60, 100)];

  it("computes a larger TQQQ position loss for deeper scenarios", () => {
    const rows = runCrashStress({
      qqqSpot: 500,
      tqqqSpot: 80,
      dteFor: () => 90,
      tqqqShares: 1000,
      hedgePuts: [],
      shortOptions: [],
      levels,
      ownedLevelIndices: new Set(),
      cashAvailable: 100000,
    });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].tqqqPositionLoss).toBeGreaterThan(rows[i - 1].tqqqPositionLoss);
    }
  });

  it("a long QQQ put hedge produces a positive payoff that grows with scenario severity", () => {
    const hedgePuts = [
      position({
        underlyingSymbol: "QQQ",
        putCall: "PUT",
        strike: 400, // deep OTM vs spot 500, becomes valuable as QQQ craters
        longQty: 10,
        marketValue: 5000, // current mark: $5/share * 10 contracts * 100
      }),
    ];
    const rows = runCrashStress({
      qqqSpot: 500,
      tqqqSpot: 80,
      dteFor: () => 180,
      tqqqShares: 0,
      hedgePuts,
      shortOptions: [],
      levels: [],
      ownedLevelIndices: new Set(),
      cashAvailable: 100000,
    });
    for (const row of rows) expect(row.hedgePayoff).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].hedgePayoff).toBeGreaterThan(rows[i - 1].hedgePayoff);
    }
  });

  it("a short TQQQ put position produces increasing damage (loss) in deeper scenarios", () => {
    const shortOptions = [
      position({
        underlyingSymbol: "TQQQ",
        putCall: "PUT",
        strike: 75,
        shortQty: 5,
        marketValue: -500, // current cost-to-close: $1/share * 5 contracts * 100
      }),
    ];
    const rows = runCrashStress({
      qqqSpot: 500,
      tqqqSpot: 80,
      dteFor: () => 14,
      tqqqShares: 0,
      hedgePuts: [],
      shortOptions,
      levels: [],
      ownedLevelIndices: new Set(),
      cashAvailable: 100000,
    });
    for (const row of rows) expect(row.shortBookDamage).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].shortBookDamage).toBeGreaterThan(rows[i - 1].shortBookDamage);
    }
  });

  it("a short TQQQ call position benefits (negative damage) as spot crashes", () => {
    const shortOptions = [
      position({
        underlyingSymbol: "TQQQ",
        putCall: "CALL",
        strike: 90,
        shortQty: 5,
        marketValue: -300,
      }),
    ];
    const rows = runCrashStress({
      qqqSpot: 500,
      tqqqSpot: 80,
      dteFor: () => 14,
      tqqqShares: 0,
      hedgePuts: [],
      shortOptions,
      levels: [],
      ownedLevelIndices: new Set(),
      cashAvailable: 100000,
    });
    for (const row of rows) expect(row.shortBookDamage).toBeLessThan(0);
  });

  it("ladder cash needed reflects unpurchased levels at/above the shocked price", () => {
    const rows = runCrashStress({
      qqqSpot: 500,
      tqqqSpot: 80,
      dteFor: () => 90,
      tqqqShares: 0,
      hedgePuts: [],
      shortOptions: [],
      levels, // buy prices 80, 70, 60
      ownedLevelIndices: new Set(),
      cashAvailable: 0,
      scenarios: [{ label: "test", qqqDropPct: 0.10, shockedVxnPct: 35 }],
    });
    // tqqqReturnForShock(0.10, 35) is a a fairly mild drop; shocked price should still
    // be below 80 (level 0's buy price), so at least level 0's cost is included.
    expect(rows[0].ladderCashNeeded).toBeGreaterThanOrEqual(levels[0].cost);
  });

  it("netDrawdown combines TQQQ loss, hedge payoff, and short book damage correctly", () => {
    const hedgePuts = [position({ underlyingSymbol: "QQQ", putCall: "PUT", strike: 400, longQty: 10, marketValue: 5000 })];
    const shortOptions = [position({ underlyingSymbol: "TQQQ", putCall: "PUT", strike: 75, shortQty: 5, marketValue: -500 })];
    const rows = runCrashStress({
      qqqSpot: 500,
      tqqqSpot: 80,
      dteFor: () => 90,
      tqqqShares: 1000,
      hedgePuts,
      shortOptions,
      levels: [],
      ownedLevelIndices: new Set(),
      cashAvailable: 100000,
    });
    for (const row of rows) {
      expect(row.netDrawdown).toBeCloseTo(row.tqqqPositionLoss - row.hedgePayoff + row.shortBookDamage, 6);
    }
  });

  it("uses DEFAULT_CRASH_SCENARIOS when none are supplied", () => {
    const rows = runCrashStress({
      qqqSpot: 500,
      tqqqSpot: 80,
      dteFor: () => 90,
      tqqqShares: 0,
      hedgePuts: [],
      shortOptions: [],
      levels: [],
      ownedLevelIndices: new Set(),
      cashAvailable: 0,
    });
    expect(rows).toHaveLength(DEFAULT_CRASH_SCENARIOS.length);
  });
});

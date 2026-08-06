import { describe, it, expect } from "vitest";
import {
  strikeForDelta,
  planProgram,
  scenarioTable,
  tqqqIvFromVxn,
  hedgeSpendSince,
  budgetStatus,
  type ProgramInput,
} from "./putProgram";

const TQQQ = 72.335;
const IV = tqqqIvFromVxn(24.3); // ^VXN 24.3 x the TQQQ leverage multiple
const SHARES = 1602;
const ACCOUNT = 265881;

const base: ProgramInput = {
  accountValue: ACCOUNT,
  tqqqShares: SHARES,
  tqqqSpot: TQQQ,
  baseIv: IV,
  dte: 60,
  budgetPctPerYear: 3,
  targetDelta: 0.1,
  driftBandPct: 25,
  currentContracts: 0,
};

describe("tqqqIvFromVxn", () => {
  it("scales the index vol by the leverage multiple", () => {
    expect(tqqqIvFromVxn(24.3)).toBeCloseTo(0.729, 6);
  });
});

describe("strikeForDelta", () => {
  it("finds a strike below spot for a low delta", () => {
    const k = strikeForDelta(TQQQ, IV, 60, 0.1)!;
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(TQQQ);
  });

  it("puts a higher delta closer to the money", () => {
    expect(strikeForDelta(TQQQ, IV, 60, 0.3)!).toBeGreaterThan(
      strikeForDelta(TQQQ, IV, 60, 0.1)!,
    );
  });

  it("reaches further out when vol is higher", () => {
    expect(strikeForDelta(TQQQ, 1.2, 60, 0.1)!).toBeLessThan(
      strikeForDelta(TQQQ, 0.5, 60, 0.1)!,
    );
  });

  it("rejects a delta at or above the money", () => {
    expect(strikeForDelta(TQQQ, IV, 60, 0.5)).toBeNull();
    expect(strikeForDelta(TQQQ, IV, 60, 0)).toBeNull();
  });
});

describe("planProgram", () => {
  const plan = planProgram(base)!;

  it("sets the strike from delta, on the $1 grid", () => {
    expect(plan.strike % 1).toBe(0);
    expect(Math.abs(plan.delta)).toBeCloseTo(0.1, 1);
    expect(plan.otmPct).toBeGreaterThan(0);
  });

  it("splits the annual budget across cycles", () => {
    expect(plan.annualBudget).toBeCloseTo(ACCOUNT * 0.03, 6);
    expect(plan.cycleBudget).toBeCloseTo(plan.annualBudget * (60 / 365), 6);
  });

  it("gives finer resolution than QQQ would — one contract covers 100 shares", () => {
    expect(plan.notionalContracts).toBe(Math.floor(SHARES / 100));
  });

  it("is budget-bound at this account size, not notional-bound", () => {
    expect(plan.binding).toBe("budget");
    expect(plan.budgetContracts).toBeLessThan(plan.notionalContracts);
    expect(plan.targetContracts).toBe(plan.budgetContracts);
  });

  it("never spends more than the cycle budget", () => {
    expect(plan.cycleCost).toBeLessThanOrEqual(plan.cycleBudget);
    expect(plan.annualCostPct).toBeLessThanOrEqual(3.001);
  });

  it("reports partial coverage — 3% cannot buy the whole position", () => {
    expect(plan.coveragePct).toBeGreaterThan(0);
    expect(plan.coveragePct).toBeLessThan(100);
  });

  it("becomes notional-bound when few shares are held", () => {
    const early = planProgram({ ...base, tqqqShares: 100 })!;
    expect(early.binding).toBe("notional");
    expect(early.cycleCost).toBeLessThan(early.cycleBudget);
  });

  it("buys nothing when the ladder holds nothing", () => {
    const flat = planProgram({ ...base, tqqqShares: 0 })!;
    expect(flat.targetContracts).toBe(0);
    expect(flat.cycleCost).toBe(0);
  });

  it("spends only its share when the budget is split with another layer", () => {
    const split = planProgram({ ...base, budgetShare: 0.8 })!;
    expect(split.annualBudget).toBeCloseTo(plan.annualBudget * 0.8, 6);
    expect(split.targetContracts).toBeLessThanOrEqual(plan.targetContracts);
  });

  it("buys more as the budget grows", () => {
    const rich = planProgram({ ...base, budgetPctPerYear: 6 })!;
    expect(rich.targetContracts).toBeGreaterThan(plan.targetContracts);
  });

  describe("rebalancing", () => {
    it("says buy when nothing is open", () => {
      expect(plan.action).toBe("buy");
      expect(plan.actionContracts).toBe(plan.targetContracts);
    });

    it("holds when already at target", () => {
      const at = planProgram({ ...base, currentContracts: plan.targetContracts })!;
      expect(at.action).toBe("hold");
      expect(at.actionContracts).toBe(0);
      expect(at.driftPct).toBe(0);
    });

    it("holds inside the drift band rather than churning on spreads", () => {
      const near = planProgram({ ...base, currentContracts: plan.targetContracts - 1 })!;
      expect(near.driftPct).toBeLessThan(25);
      expect(near.action).toBe("hold");
    });

    it("sells when overweight beyond the band", () => {
      const over = planProgram({ ...base, currentContracts: plan.targetContracts + 5 })!;
      expect(over.action).toBe("sell");
      expect(over.actionContracts).toBe(5);
    });

    it("unwinds everything once the ladder is flat", () => {
      const flat = planProgram({ ...base, tqqqShares: 0, currentContracts: 3 })!;
      expect(flat.action).toBe("sell");
      expect(flat.actionContracts).toBe(3);
    });

    it("respects a wider band", () => {
      const loose = planProgram({
        ...base,
        currentContracts: plan.targetContracts - 1,
        driftBandPct: 90,
      })!;
      expect(loose.action).toBe("hold");
    });
  });
});

describe("scenarioTable", () => {
  const plan = planProgram(base)!;
  const moves = [-0.15, -0.3, -0.5, -0.7];
  const rows = scenarioTable(plan, SHARES, TQQQ, moves);

  it("returns a row per move", () => {
    expect(rows).toHaveLength(moves.length);
  });

  it("loses more on the shares the deeper the drop", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].sharesPl).toBeLessThan(rows[i - 1].sharesPl);
    }
  });

  it("offsets more of the loss the deeper the crash", () => {
    expect(rows[rows.length - 1].offsetPct).toBeGreaterThan(rows[0].offsetPct);
  });

  it("costs the premium when the puts expire worthless", () => {
    const mild = scenarioTable(plan, SHARES, TQQQ, [0.05])[0];
    expect(mild.putPl).toBeCloseTo(-plan.cycleCost, 6);
  });

  it("never claims to offset more than the loss", () => {
    for (const r of rows) expect(r.offsetPct).toBeLessThanOrEqual(100);
  });

  it("is worth far more with a vol shock than at expiry intrinsic", () => {
    // A fast -30% with IV tripling and time left is the realistic crash case.
    const floor = scenarioTable(plan, SHARES, TQQQ, [-0.3])[0];
    const shocked = scenarioTable(plan, SHARES, TQQQ, [-0.3], {
      iv: IV * 2.5,
      daysLeft: 40,
    })[0];
    expect(shocked.putPl).toBeGreaterThan(floor.putPl);
    expect(shocked.offsetPct).toBeGreaterThan(floor.offsetPct);
  });
});

describe("hedgeSpendSince", () => {
  const since = new Date("2026-01-01");
  const BTO = "BUY_TO_OPEN" as const;
  const STC = "SELL_TO_CLOSE" as const;
  const orders = [
    { underlyingSymbol: "TQQQ", instruction: BTO, total: -1300, fees: -1.3, time: "2026-02-01" },
    { underlyingSymbol: "TQQQ", instruction: BTO, total: -900, fees: -1.0, time: "2026-04-01" },
    { underlyingSymbol: "TQQQ", instruction: STC, total: 400, fees: -0.5, time: "2026-05-01" },
  ];

  it("nets opens against closes, fees included", () => {
    expect(hedgeSpendSince(orders, since, ["TQQQ"])).toBeCloseTo(
      1300 + 1.3 + 900 + 1.0 - 400 + 0.5,
      6,
    );
  });

  it("ignores the ladder's cash-secured puts on the same underlying", () => {
    // Short-side premium is income from the options ladder, not hedge spend.
    const withCsp = [
      ...orders,
      {
        underlyingSymbol: "TQQQ",
        instruction: "SELL_TO_OPEN" as const,
        total: 2500,
        fees: -2,
        time: "2026-03-01",
      },
      {
        underlyingSymbol: "TQQQ",
        instruction: "BUY_TO_CLOSE" as const,
        total: -800,
        fees: -1,
        time: "2026-03-20",
      },
    ];
    expect(hedgeSpendSince(withCsp, since, ["TQQQ"])).toBeCloseTo(
      hedgeSpendSince(orders, since, ["TQQQ"]),
      6,
    );
  });

  it("counts every symbol it is told to", () => {
    const withVix = [
      ...orders,
      { underlyingSymbol: "VIX", instruction: BTO, total: -500, fees: -0.5, time: "2026-03-01" },
    ];
    expect(hedgeSpendSince(withVix, since, ["TQQQ", "VIX"])).toBeCloseTo(
      hedgeSpendSince(orders, since, ["TQQQ"]) + 500.5,
      6,
    );
  });

  it("ignores symbols outside the hedge", () => {
    const withOther = [
      ...orders,
      { underlyingSymbol: "SPY", instruction: BTO, total: -5000, fees: 0, time: "2026-03-01" },
    ];
    expect(hedgeSpendSince(withOther, since, ["TQQQ"])).toBeCloseTo(
      hedgeSpendSince(orders, since, ["TQQQ"]),
      6,
    );
  });

  it("ignores orders before the window", () => {
    const older = [
      { underlyingSymbol: "TQQQ", instruction: BTO, total: -5000, fees: 0, time: "2025-06-01" },
      ...orders,
    ];
    expect(hedgeSpendSince(older, since, ["TQQQ"])).toBeCloseTo(
      hedgeSpendSince(orders, since, ["TQQQ"]),
      6,
    );
  });
});

describe("budgetStatus", () => {
  it("measures pace against the calendar", () => {
    const mid = budgetStatus(8000, 4000, new Date("2026-07-02T00:00:00"));
    expect(mid.yearElapsed).toBeCloseTo(0.5, 1);
    expect(mid.onPaceSpend).toBeCloseTo(4000, -2);
    expect(Math.abs(mid.overPace)).toBeLessThan(200);
  });

  it("flags overspending", () => {
    const hot = budgetStatus(8000, 7000, new Date("2026-04-01T00:00:00"));
    expect(hot.overPace).toBeGreaterThan(0);
    expect(hot.remaining).toBe(1000);
  });

  it("flags underspending", () => {
    expect(budgetStatus(8000, 500, new Date("2026-10-01T00:00:00")).overPace).toBeLessThan(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  TRANCHES,
  classifyTranche,
  buildTranchePlan,
  planAnnualCost,
  PUT_SPREAD_VXN_THRESHOLD,
} from "./hedgeTranches";

describe("TRANCHES", () => {
  it("active budget shares sum to 1", () => {
    const sum = TRANCHES.reduce((s, t) => s + t.budgetShare, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe("classifyTranche", () => {
  it("maps moneyness to the nearest tranche and rejects near-the-money puts", () => {
    // QQQ anchors workhorse 0.88 / crash 0.78 / catastrophe 0.68 → boundaries 0.83, 0.73.
    expect(classifyTranche(0.97)).toBeNull(); // too close to be a hedge tranche
    expect(classifyTranche(0.88)).toBe("workhorse");
    expect(classifyTranche(0.85)).toBe("workhorse");
    expect(classifyTranche(0.8)).toBe("crash");
    expect(classifyTranche(0.78)).toBe("crash");
    expect(classifyTranche(0.75)).toBe("crash");
    expect(classifyTranche(0.72)).toBe("catastrophe");
    expect(classifyTranche(0.68)).toBe("catastrophe");
    expect(classifyTranche(0.5)).toBe("catastrophe"); // even deeper still catastrophe
  });

  it("classifies every recommended tranche strike back to its own tranche", () => {
    for (const def of TRANCHES) {
      expect(classifyTranche(def.moneyness)).toBe(def.key);
    }
  });
});

describe("buildTranchePlan", () => {
  const base = { tqqqValue: 100_000, spot: 500, vxnPct: 22, annualBudgetPct: 0.02 };

  it("only sizes active tranches; strikes solved by delta sit below spot and deeper for the lower-delta leg", () => {
    const plan = buildTranchePlan(base);
    expect(plan.map((t) => t.def.key)).toEqual(["crash", "catastrophe"]);
    const [crash, catastrophe] = plan;
    // Both are OTM puts (strike below spot).
    expect(crash.strike).toBeLessThan(base.spot);
    expect(catastrophe.strike).toBeLessThan(base.spot);
    // The lower-delta (0.10) catastrophe leg targets a deeper-OTM strike than
    // the 0.20-delta crash leg.
    expect(catastrophe.def.targetDelta).toBeLessThan(crash.def.targetDelta);
    expect(catastrophe.strike).toBeLessThan(crash.strike);
  });

  it("caps deep tranches by notional so they don't balloon into hundreds of contracts", () => {
    const plan = buildTranchePlan(base);
    for (const t of plan) {
      const notionalCovered = t.targetContracts * t.strike * 100;
      expect(notionalCovered).toBeLessThanOrEqual(t.def.maxCoverage * base.tqqqValue + 1e-6);
    }
  });

  it("keeps total estimated carry within the requested budget", () => {
    const plan = buildTranchePlan(base);
    const budget = base.tqqqValue * base.annualBudgetPct;
    // Flooring contracts can only spend less than the budget, never more.
    expect(planAnnualCost(plan)).toBeLessThanOrEqual(budget + 1e-6);
    expect(planAnnualCost(plan)).toBeGreaterThan(0);
  });

  it("clip is whole contracts (≥1 while building), and stagger spacing is positive", () => {
    const plan = buildTranchePlan(base);
    for (const t of plan) {
      if (t.targetContracts > 0) {
        expect(t.clipContracts).toBeGreaterThanOrEqual(1);
        expect(t.clipContracts).toBeLessThanOrEqual(t.targetContracts);
        expect(Number.isInteger(t.clipContracts)).toBe(true);
        expect(t.spacingDays).toBeGreaterThan(0);
        // Out-of-pocket per buy = whole contracts × premium.
        expect(t.perBuyCost).toBeCloseTo(t.clipContracts * t.estPremiumPerContract, 6);
      } else {
        expect(t.clipContracts).toBe(0);
      }
    }
  });

  it("on a tiny budget the ladder is small and spacing stretches (no fractional clip)", () => {
    // Tiny budget → ~1 contract per leg → clip is 1, spaced across the whole hold.
    const plan = buildTranchePlan({ ...base, annualBudgetPct: 0.005 });
    for (const t of plan) {
      if (t.targetContracts > 0) {
        expect(t.clipContracts).toBe(1);
        expect(t.spacingDays).toBeGreaterThanOrEqual(t.dte / t.targetContracts - 1);
      }
    }
  });

  it("a bigger budget buys more contracts (until the notional cap binds)", () => {
    // A tiny budget is budget-bound; a larger one fills more before the cap.
    const lean = buildTranchePlan({ ...base, annualBudgetPct: 0.002 });
    const fat = buildTranchePlan({ ...base, annualBudgetPct: 0.02 });
    const leanTotal = lean.reduce((s, t) => s + t.targetContracts, 0);
    const fatTotal = fat.reduce((s, t) => s + t.targetContracts, 0);
    expect(fatTotal).toBeGreaterThan(leanTotal);
  });

  it("zero exposure or zero budget yields no contracts", () => {
    expect(buildTranchePlan({ ...base, tqqqValue: 0 }).every((t) => t.targetContracts === 0)).toBe(true);
    expect(buildTranchePlan({ ...base, annualBudgetPct: 0 }).every((t) => t.targetContracts === 0)).toBe(true);
  });

  it("falls back to a default IV when ^VXN is missing", () => {
    const plan = buildTranchePlan({ ...base, vxnPct: null });
    expect(plan.every((t) => t.estPremiumPerContract > 0)).toBe(true);
  });

  it("uses live marks and listed strikes from a resolver when available", () => {
    const modeled = buildTranchePlan(base);
    // Resolver snaps to a $5-grid strike and quotes a cheap $1.00 mark.
    const live = buildTranchePlan({
      ...base,
      resolver: (ideal) => ({ strike: Math.round(ideal / 5) * 5, mark: 1.0 }),
    });
    expect(live.every((t) => t.live)).toBe(true);
    expect(modeled.every((t) => !t.live)).toBe(true);
    for (const t of live) {
      expect(t.estPremiumPerContract).toBeCloseTo(100, 6); // $1.00 × 100
      expect(t.strike % 5).toBe(0); // snapped to the listed grid
    }
  });

  it("ignores a resolver that returns no quote (falls back to model)", () => {
    const plan = buildTranchePlan({ ...base, resolver: () => null });
    expect(plan.every((t) => !t.live && t.estPremiumPerContract > 0)).toBe(true);
  });

  it("TQQQ mode uses deeper strikes than QQQ for the same legs", () => {
    const qqq = buildTranchePlan({ ...base, instrument: "QQQ" });
    const tqqq = buildTranchePlan({ ...base, instrument: "TQQQ" });
    // Same active legs, but TQQQ strikes are a smaller fraction of spot (deeper OTM).
    expect(tqqq.map((t) => t.def.key)).toEqual(qqq.map((t) => t.def.key));
    for (let i = 0; i < qqq.length; i++) {
      expect(tqqq[i].strike / base.spot).toBeLessThan(qqq[i].strike / base.spot);
    }
  });
});

describe("catastrophe put-spread financing", () => {
  const base = { tqqqValue: 100_000, spot: 500, annualBudgetPct: 0.02 };

  it("stays naked (no spread) in calm markets", () => {
    const plan = buildTranchePlan({ ...base, vxnPct: PUT_SPREAD_VXN_THRESHOLD });
    const catastrophe = plan.find((t) => t.def.key === "catastrophe")!;
    expect(catastrophe.spread).toBeNull();
  });

  it("finances the catastrophe leg as a spread once VXN clears the threshold", () => {
    const naked = buildTranchePlan({ ...base, vxnPct: 22 });
    const spread = buildTranchePlan({ ...base, vxnPct: PUT_SPREAD_VXN_THRESHOLD + 5 });
    const nakedCat = naked.find((t) => t.def.key === "catastrophe")!;
    const spreadCat = spread.find((t) => t.def.key === "catastrophe")!;

    expect(nakedCat.spread).toBeNull();
    expect(spreadCat.spread).not.toBeNull();
    // Short leg sits deeper OTM (lower strike) than the long leg.
    expect(spreadCat.spread!.shortStrike).toBeLessThan(spreadCat.spread!.longStrike);
    expect(spreadCat.spread!.longStrike).toBe(spreadCat.strike);
    // Net premium (long − short) replaces the naked estimate, and must be
    // strictly cheaper than paying for the long leg alone.
    expect(spreadCat.estPremiumPerContract).toBeCloseTo(
      spreadCat.spread!.longPremiumPerContract - spreadCat.spread!.shortPremiumPerContract,
      6,
    );
    expect(spreadCat.estPremiumPerContract).toBeLessThan(spreadCat.spread!.longPremiumPerContract);
    // Payoff is capped at the strike width, not unlimited like the naked leg.
    expect(spreadCat.spread!.maxPayoffPerContract).toBeCloseTo(
      (spreadCat.spread!.longStrike - spreadCat.spread!.shortStrike) * 100,
      6,
    );
  });

  it("leaves the crash leg naked regardless of VXN — only catastrophe gets financed", () => {
    const plan = buildTranchePlan({ ...base, vxnPct: PUT_SPREAD_VXN_THRESHOLD + 15 });
    const crash = plan.find((t) => t.def.key === "crash")!;
    expect(crash.spread).toBeNull();
  });

  it("cheaper net premium under high vol still respects the annual budget", () => {
    const plan = buildTranchePlan({ ...base, vxnPct: PUT_SPREAD_VXN_THRESHOLD + 10 });
    const budget = base.tqqqValue * base.annualBudgetPct;
    expect(planAnnualCost(plan)).toBeLessThanOrEqual(budget + 1e-6);
  });
});

describe("classifyTranche by instrument", () => {
  it("uses TQQQ's shallower boundaries (crash=−30%, catastrophe=−50%)", () => {
    // 0.60 moneyness is catastrophe on QQQ but crash on TQQQ (crash leg starts at −30%).
    expect(classifyTranche(0.60, "QQQ")).toBe("catastrophe");
    expect(classifyTranche(0.60, "TQQQ")).toBe("crash");
    expect(classifyTranche(0.50, "TQQQ")).toBe("catastrophe");
    expect(classifyTranche(0.82, "TQQQ")).toBe("workhorse");
  });
});

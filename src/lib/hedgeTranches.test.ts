import { describe, it, expect } from "vitest";
import {
  TRANCHES,
  WEEKS_PER_CYCLE,
  classifyTranche,
  buildTranchePlan,
  planAnnualCost,
} from "./hedgeTranches";

describe("TRANCHES", () => {
  it("active budget shares sum to 1", () => {
    const sum = TRANCHES.reduce((s, t) => s + t.budgetShare, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe("classifyTranche", () => {
  it("maps moneyness to the nearest tranche and rejects near-the-money puts", () => {
    expect(classifyTranche(0.97)).toBeNull(); // too close to be a hedge tranche
    expect(classifyTranche(0.88)).toBe("workhorse");
    expect(classifyTranche(0.82)).toBe("workhorse");
    expect(classifyTranche(0.8)).toBe("crash");
    expect(classifyTranche(0.75)).toBe("crash");
    expect(classifyTranche(0.7)).toBe("crash");
    expect(classifyTranche(0.65)).toBe("catastrophe");
    expect(classifyTranche(0.5)).toBe("catastrophe"); // even deeper still catastrophe
  });

  it("classifies every recommended tranche strike back to its own tranche", () => {
    for (const def of TRANCHES) {
      expect(classifyTranche(def.moneyness)).toBe(def.key);
    }
  });
});

describe("buildTranchePlan", () => {
  const base = { tqqqValue: 100_000, qqqPrice: 500, vxnPct: 22, annualBudgetPct: 0.02 };

  it("only sizes active (budgetShare > 0) tranches and prices the deeper one cheaper", () => {
    const plan = buildTranchePlan(base);
    expect(plan.map((t) => t.def.key)).toEqual(["crash", "catastrophe"]);
    const [crash, catastrophe] = plan;
    expect(crash.estPremiumPerContract).toBeGreaterThan(catastrophe.estPremiumPerContract);
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

  it("weekly clip is a fraction of the target but at least one contract", () => {
    const plan = buildTranchePlan(base);
    for (const t of plan) {
      if (t.targetContracts > 0) {
        expect(t.weeklyContracts).toBeGreaterThanOrEqual(1);
        expect(t.weeklyContracts).toBeLessThanOrEqual(t.targetContracts);
        expect(t.weeklyContracts).toBeGreaterThanOrEqual(Math.ceil(t.targetContracts / WEEKS_PER_CYCLE));
      } else {
        expect(t.weeklyContracts).toBe(0);
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
});

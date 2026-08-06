import { describe, it, expect } from "vitest";
import {
  vixForward,
  priceVixCall,
  planVixLayer,
  vixPayoff,
  EPISODES,
  type VixLayerInput,
} from "./vixLayer";

const base: VixLayerInput = {
  accountValue: 265881,
  budgetPctPerYear: 3,
  budgetShare: 0.2,
  dte: 45,
  vix: 17,
  vix3m: 21,
  strikeOffset: 10,
  volOfVol: 0.9,
  maxEntryVix: 25,
  monetizeVix: 40,
  currentContracts: 0,
};

describe("vixForward", () => {
  it("returns spot at or inside the 30-day tenor", () => {
    expect(vixForward(17, 21, 30)).toBe(17);
    expect(vixForward(17, 21, 10)).toBe(17);
  });

  it("returns the 3-month index at or beyond its tenor", () => {
    expect(vixForward(17, 21, 93)).toBe(21);
    expect(vixForward(17, 21, 200)).toBe(21);
  });

  it("interpolates between them", () => {
    const f = vixForward(17, 21, 60);
    expect(f).toBeGreaterThan(17);
    expect(f).toBeLessThan(21);
  });

  it("lifts the forward above spot in contango", () => {
    expect(vixForward(15, 22, 60)).toBeGreaterThan(15);
  });

  it("pulls the forward below spot in backwardation", () => {
    expect(vixForward(40, 30, 60)).toBeLessThan(40);
  });

  it("falls back to spot when the 3-month index is missing", () => {
    expect(vixForward(17, null, 60)).toBe(17);
  });
});

describe("priceVixCall", () => {
  it("is worth more the lower the strike", () => {
    const near = priceVixCall(20, 25, 45, 0.9).price;
    const far = priceVixCall(20, 40, 45, 0.9).price;
    expect(near).toBeGreaterThan(far);
  });

  it("is worth more with more time", () => {
    expect(priceVixCall(20, 30, 90, 0.9).price).toBeGreaterThan(
      priceVixCall(20, 30, 15, 0.9).price,
    );
  });

  it("is worth more when vol-of-vol is higher", () => {
    expect(priceVixCall(20, 30, 45, 1.4).price).toBeGreaterThan(
      priceVixCall(20, 30, 45, 0.6).price,
    );
  });

  it("settles to intrinsic at expiry", () => {
    expect(priceVixCall(35, 25, 0, 0.9).price).toBeCloseTo(10, 6);
    expect(priceVixCall(20, 25, 0, 0.9).price).toBe(0);
  });

  it("has delta between 0 and 1", () => {
    const d = priceVixCall(20, 30, 45, 0.9).delta;
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });
});

describe("planVixLayer", () => {
  const plan = planVixLayer(base)!;

  it("strikes above the forward by the requested offset", () => {
    expect(plan.strike).toBe(Math.round(plan.forward + 10));
    expect(plan.strike % 1).toBe(0);
  });

  it("spends only its share of the budget", () => {
    expect(plan.annualBudget).toBeCloseTo(265881 * 0.03 * 0.2, 6);
    expect(plan.cycleCost).toBeLessThanOrEqual(plan.cycleBudget);
  });

  it("buys when vol is calm and nothing is open", () => {
    expect(plan.gated).toBe(false);
    expect(plan.action).toBe("buy");
    expect(plan.actionContracts).toBe(plan.targetContracts);
  });

  describe("entry gate", () => {
    it("refuses to open new positions once VIX is elevated", () => {
      const hot = planVixLayer({ ...base, vix: 28 })!;
      expect(hot.gated).toBe(true);
      expect(hot.action).toBe("hold");
      expect(hot.actionContracts).toBe(0);
      expect(hot.note).toContain("entry cap");
    });

    it("holds an existing position rather than adding into the spike", () => {
      const hot = planVixLayer({ ...base, vix: 28, currentContracts: 3 })!;
      expect(hot.action).toBe("hold");
      expect(hot.targetContracts).toBe(3);
    });

    it("still buys just under the cap", () => {
      expect(planVixLayer({ ...base, vix: 24.9 })!.action).toBe("buy");
    });

    it("respects a cap the user moves", () => {
      expect(planVixLayer({ ...base, vix: 28, maxEntryVix: 35 })!.gated).toBe(false);
    });
  });

  describe("monetizing", () => {
    it("sells the sleeve into a real spike", () => {
      const spike = planVixLayer({ ...base, vix: 45, currentContracts: 4 })!;
      expect(spike.monetize).toBe(true);
      expect(spike.action).toBe("sell");
      expect(spike.actionContracts).toBe(4);
      expect(spike.note).toContain("take the spike");
    });

    it("does not flag monetizing with nothing open", () => {
      const spike = planVixLayer({ ...base, vix: 45, currentContracts: 0 })!;
      expect(spike.monetize).toBe(false);
      expect(spike.action).toBe("hold");
    });

    it("prefers monetizing over the entry gate when both apply", () => {
      const spike = planVixLayer({ ...base, vix: 60, currentContracts: 2 })!;
      expect(spike.gated).toBe(true);
      expect(spike.action).toBe("sell");
    });
  });

  it("buys more with a bigger sleeve", () => {
    const big = planVixLayer({ ...base, budgetShare: 0.5 })!;
    expect(big.targetContracts).toBeGreaterThanOrEqual(plan.targetContracts);
  });

  it("buys fewer, cheaper contracts the further out the strike", () => {
    const far = planVixLayer({ ...base, strikeOffset: 25 })!;
    expect(far.pricePerContract).toBeLessThan(plan.pricePerContract);
    expect(far.targetContracts).toBeGreaterThanOrEqual(plan.targetContracts);
  });
});

describe("vixPayoff", () => {
  const plan = planVixLayer(base)!;

  it("loses the premium when VIX stays put", () => {
    expect(vixPayoff(plan, plan.targetContracts, 15)).toBeCloseTo(-plan.cycleCost, 6);
  });

  it("pays off in a spike", () => {
    expect(vixPayoff(plan, plan.targetContracts, 60)).toBeGreaterThan(0);
  });

  it("scales with the spike's size", () => {
    const a = vixPayoff(plan, plan.targetContracts, 45);
    const b = vixPayoff(plan, plan.targetContracts, 80);
    expect(b).toBeGreaterThan(a);
  });
});

describe("EPISODES", () => {
  it("records the deepest drawdown as the weakest VIX response", () => {
    const worst = EPISODES.reduce((a, b) => (a.tqqqMove < b.tqqqMove ? a : b));
    expect(worst.label).toContain("2022");
    // Every faster episode printed a higher VIX than the deepest, slowest one.
    const faster = EPISODES.filter((e) => e.days < 60);
    expect(faster.some((e) => e.vixPeak > worst.vixPeak)).toBe(true);
  });
});

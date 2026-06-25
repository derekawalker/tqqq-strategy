import { describe, it, expect } from "vitest";
import { runHedgeBacktest, type HedgeBar, type HedgeBacktestConfig } from "./hedgeBacktest";

// ---------------------------------------------------------------------------
// Synthetic-history helpers
// ---------------------------------------------------------------------------

/** Build N daily bars from a price function. */
function bars(n: number, priceAt: (i: number) => number, startDate = "2020-01-01"): HedgeBar[] {
  const out: HedgeBar[] = [];
  const d = new Date(startDate + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), close: priceAt(i) });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function flatVxn(b: HedgeBar[], level: number): Map<string, number> {
  return new Map(b.map((x) => [x.date, level]));
}

const baseCfg: HedgeBacktestConfig = {
  instrument: "QQQ",
  tqqqStartValue: 300_000,
  annualBudgetPct: 0.03,
  rollAtDte: 21,
  monetizeDelta: 0.45,
  monetizeGainPct: 1.5,
  vxnPauseThreshold: 25,
  buyEveryDays: 5,
};

describe("runHedgeBacktest", () => {
  it("returns an empty result for no bars", () => {
    const res = runHedgeBacktest([], [], new Map(), baseCfg);
    expect(res.curve).toHaveLength(0);
    expect(res.stats.totalPremiumPaid).toBe(0);
  });

  it("bleeds premium with no payoff in a calm, flat market", () => {
    const qqq = bars(250, () => 400);
    // TQQQ flat too — no crash, so the hedge is pure cost.
    const tqqq = bars(250, () => 70, qqq[0].date);
    const res = runHedgeBacktest(qqq, tqqq, flatVxn(qqq, 18), baseCfg);

    expect(res.stats.buys).toBeGreaterThan(0);
    expect(res.stats.totalPremiumPaid).toBeGreaterThan(0);
    // Hedged book underperforms naked when nothing crashes.
    expect(res.stats.finalHedged).toBeLessThan(res.stats.finalNaked);
    expect(res.stats.netHedgeCost).toBeGreaterThan(0);
  });

  it("respects the annual budget governor (premium ≈ within budget per year)", () => {
    const qqq = bars(250, () => 400);
    const tqqq = bars(250, () => 70, qqq[0].date);
    const res = runHedgeBacktest(qqq, tqqq, flatVxn(qqq, 18), baseCfg);
    // One calendar year, 3% of $300k = $9k ceiling. Flooring buys keeps it under.
    expect(res.stats.totalPremiumPaid).toBeLessThanOrEqual(300_000 * 0.03 + 1e-6);
  });

  it("pays off in a crash: puts gain value and cushion the drawdown", () => {
    // 60 calm days, then QQQ −35% over 30 days (TQQQ ~−80%), VXN spikes.
    const crashStart = 60;
    const qqq = bars(120, (i) => {
      if (i < crashStart) return 400;
      const t = Math.min(1, (i - crashStart) / 30);
      return 400 * (1 - 0.35 * t);
    });
    const tqqq = bars(120, (i) => {
      if (i < crashStart) return 70;
      const t = Math.min(1, (i - crashStart) / 30);
      return 70 * (1 - 0.80 * t);
    }, qqq[0].date);
    const vxn = new Map(qqq.map((x, i) => [x.date, i < crashStart ? 18 : 55]));

    const res = runHedgeBacktest(qqq, tqqq, vxn, baseCfg);

    // Puts reached real value during the crash.
    expect(res.stats.peakPutValue).toBeGreaterThan(0);
    expect(res.stats.totalProceeds).toBeGreaterThan(0); // monetized in the selloff
    // The hedged book draws down less than the naked TQQQ book.
    expect(res.stats.maxDrawdownHedged).toBeGreaterThan(res.stats.maxDrawdownNaked);
    expect(res.stats.drawdownReduced).toBeGreaterThan(0);
  });

  it("pauses buying while VXN is above the threshold", () => {
    const qqq = bars(120, () => 400);
    const tqqq = bars(120, () => 70, qqq[0].date);
    const calm = runHedgeBacktest(qqq, tqqq, flatVxn(qqq, 18), baseCfg);
    const panicked = runHedgeBacktest(qqq, tqqq, flatVxn(qqq, 40), baseCfg);
    // VXN pinned above 25 the whole time → no clips ever fire.
    expect(panicked.stats.buys).toBe(0);
    expect(calm.stats.buys).toBeGreaterThan(0);
  });

  it("curve equity reconciles: withHedge = naked + netHedgeCash + putValue", () => {
    const qqq = bars(80, (i) => 400 - i); // gentle decline
    const tqqq = bars(80, (i) => 70 - i * 0.4, qqq[0].date);
    const res = runHedgeBacktest(qqq, tqqq, flatVxn(qqq, 20), baseCfg);
    for (const p of res.curve) {
      expect(p.withHedge).toBeCloseTo(p.naked + p.netHedgeCash + p.putValue, 6);
    }
  });

  it("a bigger budget buys more protection", () => {
    const qqq = bars(120, () => 400);
    const tqqq = bars(120, () => 70, qqq[0].date);
    const lean = runHedgeBacktest(qqq, tqqq, flatVxn(qqq, 18), { ...baseCfg, annualBudgetPct: 0.01 });
    const fat = runHedgeBacktest(qqq, tqqq, flatVxn(qqq, 18), { ...baseCfg, annualBudgetPct: 0.05 });
    expect(fat.stats.totalPremiumPaid).toBeGreaterThan(lean.stats.totalPremiumPaid);
  });
});

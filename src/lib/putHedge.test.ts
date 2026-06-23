import { describe, it, expect } from "vitest";
import {
  normCdf,
  bsPut,
  maxDrawdown,
  simulatePutHedge,
  sweepPutHedge,
  alignHedgeBars,
  type HedgeBar,
} from "./putHedge";

// ---------------------------------------------------------------------------
// Black-Scholes
// ---------------------------------------------------------------------------

describe("normCdf", () => {
  it("is 0.5 at the mean and symmetric", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 4);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe("bsPut", () => {
  it("returns intrinsic value at expiry", () => {
    expect(bsPut(90, 100, 0, 0.3)).toBeCloseTo(10, 6); // ITM
    expect(bsPut(110, 100, 0, 0.3)).toBeCloseTo(0, 6); // OTM
  });

  it("is worth more than intrinsic before expiry (time value)", () => {
    const price = bsPut(100, 100, 0.5, 0.25);
    expect(price).toBeGreaterThan(0);
    // ATM put with no intrinsic value must be all time value.
    expect(price).toBeGreaterThan(2);
  });

  it("satisfies put-call parity: C - P = S e^-qT - K e^-rT", () => {
    const s = 100,
      k = 95,
      t = 0.75,
      sigma = 0.2,
      r = 0.04;
    const put = bsPut(s, k, t, sigma, r, 0);
    // Price the call via parity-equivalent BS by reusing the put through parity.
    // C = S - K e^-rT + P
    const call = s - k * Math.exp(-r * t) + put;
    // Independent BS call for cross-check.
    const sqrtT = Math.sqrt(t);
    const d1 = (Math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    const bsCall = s * normCdf(d1) - k * Math.exp(-r * t) * normCdf(d2);
    expect(call).toBeCloseTo(bsCall, 4);
  });

  it("is monotonically more expensive with higher vol", () => {
    const lo = bsPut(100, 90, 0.5, 0.15);
    const hi = bsPut(100, 90, 0.5, 0.45);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("maxDrawdown", () => {
  it("measures the worst peak-to-trough fall", () => {
    expect(maxDrawdown([1, 2, 1, 1.5])).toBeCloseTo(-0.5, 6); // 2 -> 1
    expect(maxDrawdown([1, 1.1, 1.2])).toBeCloseTo(0, 6); // monotone up
  });
});

// ---------------------------------------------------------------------------
// Synthetic series builders
// ---------------------------------------------------------------------------

/** A flat-then-crash-then-partial-recovery path for the held & put underlying. */
function crashBars(opts: { iv?: number; days?: number } = {}): HedgeBar[] {
  const iv = opts.iv ?? 0.3;
  const n = opts.days ?? 250;
  const bars: HedgeBar[] = [];
  let price = 100;
  const t0 = Date.parse("2022-01-03");
  for (let i = 0; i < n; i++) {
    // Drift up for the first half, crash 40% over days 120-160, drift back.
    if (i > 0) {
      if (i >= 120 && i < 160) price *= 0.987; // ~ -40% over 40 days
      else price *= 1.0008;
    }
    const date = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
    bars.push({ date, heldClose: price, putClose: price, iv });
  }
  return bars;
}

// ---------------------------------------------------------------------------
// simulatePutHedge
// ---------------------------------------------------------------------------

describe("simulatePutHedge", () => {
  it("with zero coverage is a no-op equal to buy & hold", () => {
    const bars = crashBars();
    const r = simulatePutHedge(bars, { moneyness: 0.9, dteDays: 60, coverageRatio: 0 });
    expect(r.totalPremiumPaid).toBe(0);
    expect(r.totalPutPayoff).toBe(0);
    for (const p of r.equity) expect(p.hedged).toBeCloseTo(p.unhedged, 10);
    expect(r.hedgedMaxDD).toBeCloseTo(r.unhedgedMaxDD, 10);
  });

  it("equity starts at $1", () => {
    const bars = crashBars();
    const r = simulatePutHedge(bars, { moneyness: 0.9, dteDays: 30, coverageRatio: 1 });
    expect(r.equity[0].hedged).toBeCloseTo(1, 6);
    expect(r.equity[0].unhedged).toBeCloseTo(1, 6);
  });

  it("cuts the drawdown through a crash and pays out premium during it", () => {
    const bars = crashBars();
    const r = simulatePutHedge(bars, {
      moneyness: 0.95,
      dteDays: 60,
      rollEveryDays: 30,
      coverageRatio: 1,
    });
    expect(r.totalPremiumPaid).toBeGreaterThan(0);
    expect(r.totalPutPayoff).toBeGreaterThan(0); // puts paid off in the crash
    // Hedged drawdown is shallower than unhedged.
    expect(r.hedgedMaxDD).toBeGreaterThan(r.unhedgedMaxDD);
    expect(r.ddReduction).toBeGreaterThan(0);
  });

  it("bleeds premium in a calm, rising market (no payoff)", () => {
    const n = 250;
    const bars: HedgeBar[] = [];
    let price = 100;
    const t0 = Date.parse("2021-01-04");
    for (let i = 0; i < n; i++) {
      if (i > 0) price *= 1.0008;
      const date = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
      bars.push({ date, heldClose: price, putClose: price, iv: 0.25 });
    }
    const r = simulatePutHedge(bars, { moneyness: 0.9, dteDays: 30, coverageRatio: 1 });
    expect(r.totalPremiumPaid).toBeGreaterThan(0);
    expect(r.annualBleed).toBeGreaterThan(0); // hedge cost dragged returns
    expect(r.hedgedCagr).toBeLessThan(r.unhedgedCagr);
  });

  it("deeper OTM puts are cheaper to carry than near-the-money", () => {
    const bars = crashBars();
    const near = simulatePutHedge(bars, { moneyness: 0.97, dteDays: 30, coverageRatio: 1 });
    const far = simulatePutHedge(bars, { moneyness: 0.85, dteDays: 30, coverageRatio: 1 });
    expect(far.totalPremiumPaid).toBeLessThan(near.totalPremiumPaid);
  });
});

// ---------------------------------------------------------------------------
// sweepPutHedge
// ---------------------------------------------------------------------------

describe("sweepPutHedge", () => {
  it("returns results sorted best-first by efficiency and drops non-protective combos", () => {
    const bars = crashBars();
    const results = sweepPutHedge(bars, {
      moneyness: [0.85, 0.9, 0.95],
      dteDays: [30, 60],
      rollEveryDays: [null, 30],
      coverageRatio: [0.5, 1, 2],
    });
    expect(results.length).toBeGreaterThan(0);
    // Every surviving combo must actually reduce drawdown.
    for (const r of results) expect(r.ddReduction).toBeGreaterThan(0);
    // Sorted descending by efficiency, then protectionPerPremium within ties.
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1];
      const cur = results[i];
      if (prev.efficiency === cur.efficiency) {
        expect(prev.protectionPerPremium).toBeGreaterThanOrEqual(cur.protectionPerPremium);
      } else {
        expect(prev.efficiency).toBeGreaterThan(cur.efficiency);
      }
    }
  });

  it("breaks the Infinity bucket toward cheaper hedges, not oversized ones", () => {
    const bars = crashBars();
    const results = sweepPutHedge(bars, {
      moneyness: [0.85, 0.9],
      dteDays: [60],
      coverageRatio: [0.5, 1, 3],
    });
    const inf = results.filter((r) => r.efficiency === Infinity);
    // If multiple combos are "free", the leanest-per-premium ranks first.
    if (inf.length > 1) {
      expect(inf[0].protectionPerPremium).toBeGreaterThanOrEqual(inf[1].protectionPerPremium);
    }
  });
});

// ---------------------------------------------------------------------------
// alignHedgeBars
// ---------------------------------------------------------------------------

describe("alignHedgeBars", () => {
  it("keeps only dates present in held, put, and IV — and drops bad IV", () => {
    const held = [
      { date: "2022-01-03", close: 100 },
      { date: "2022-01-04", close: 101 },
      { date: "2022-01-05", close: 102 },
    ];
    const put = [
      { date: "2022-01-03", close: 50 },
      { date: "2022-01-04", close: 51 },
      // 01-05 missing
    ];
    const iv = new Map([
      ["2022-01-03", 0.2],
      ["2022-01-04", 0], // invalid → dropped
    ]);
    const out = alignHedgeBars(held, put, iv);
    expect(out).toEqual([{ date: "2022-01-03", heldClose: 100, putClose: 50, iv: 0.2 }]);
  });
});

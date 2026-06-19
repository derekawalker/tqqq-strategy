import { describe, it, expect } from "vitest";
import {
  mean,
  std,
  rollingZ,
  pctChange,
  realizedVol,
  logReturns,
  sma,
  rsiSeries,
  drawdown,
  blendZ,
  blendZWeighted,
  buildFactors,
  alignSeries,
  computeAnomaly,
  DEFAULT_PARAMS,
  FRAGILITY_FACTORS,
  EUPHORIA_FACTORS,
  Z_WINDOW,
  type AlignedRow,
  type SeriesPoint,
} from "./anomaly";

describe("numeric helpers", () => {
  it("mean and std ignore non-finite values", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([2, NaN, 6])).toBe(4);
    expect(std([2, 4, 6])).toBeCloseTo(2, 10); // sample std of {2,4,6}
    expect(Number.isNaN(std([5]))).toBe(true);
  });

  it("rollingZ is causal and null before a full window", () => {
    const s = [1, 2, 3, 4, 5];
    expect(rollingZ(s, 2, 4)).toBeNull(); // not enough history yet
    // window [2,3,4,5]: mean 3.5, std ~1.2910, z of 5 = 1.5/1.291 ≈ 1.1619
    expect(rollingZ(s, 4, 4)).toBeCloseTo(1.1619, 3);
  });

  it("rollingZ returns null on zero variance", () => {
    expect(rollingZ([7, 7, 7, 7], 3, 4)).toBeNull();
  });

  it("pctChange computes n-period return", () => {
    expect(pctChange([100, 110, 121], 2, 1)).toBeCloseTo(0.1, 10);
    expect(pctChange([100, 110, 121], 2, 2)).toBeCloseTo(0.21, 10);
    expect(Number.isNaN(pctChange([100], 0, 1))).toBe(true);
  });

  it("logReturns and realizedVol annualize", () => {
    const closes = [100, 101, 102, 101, 103, 104];
    const r = logReturns(closes);
    expect(Number.isNaN(r[0])).toBe(true);
    expect(r[1]).toBeCloseTo(Math.log(101 / 100), 10);
    const rv = realizedVol(r, 5, 5);
    expect(rv).toBeGreaterThan(0);
  });

  it("sma needs a full window", () => {
    expect(Number.isNaN(sma([1, 2, 3], 1, 3))).toBe(true);
    expect(sma([1, 2, 3], 2, 3)).toBe(2);
  });

  it("rsi is 100 for a monotonic rally and within 0..100", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const rsi = rsiSeries(up, 14);
    expect(rsi[20]).toBe(100); // only gains => RSI 100
    const mixed = [10, 11, 10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18, 17, 19];
    rsiSeries(mixed, 14)
      .filter((x) => !Number.isNaN(x))
      .forEach((x) => {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
      });
  });

  it("drawdown measures decline from the trailing high", () => {
    const closes = [100, 120, 90, 95];
    expect(drawdown(closes, 2, 10)).toBeCloseTo((120 - 90) / 120, 10); // 0.25
    expect(drawdown(closes, 1, 10)).toBe(0); // at a new high
  });

  it("blendZ averages finite z-scores and ignores nulls", () => {
    expect(blendZ([1, null, 3, NaN])).toBe(2);
    expect(blendZ([null, NaN])).toBeNull();
  });

  it("blendZWeighted weights and renormalizes around missing factors", () => {
    // weighted mean of 2 (w1) and 4 (w3): (2*1 + 4*3)/(1+3) = 3.5
    expect(blendZWeighted([2, 4], [1, 3])).toBeCloseTo(3.5, 10);
    // a null factor drops out and remaining weights renormalize: only 4 (w3) left
    expect(blendZWeighted([null, 4], [1, 3])).toBe(4);
    // zero-weight factors are pruned entirely
    expect(blendZWeighted([99, 4], [0, 1])).toBe(4);
    expect(blendZWeighted([null, NaN], [1, 1])).toBeNull();
  });
});

function makeRows(n: number): AlignedRow[] {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    spx: 300 + i * 0.5,
    vix: 16 + (i % 5),
    vix3m: 20,
    move: 80 + (i % 7),
    hyg: 80 - (i % 3) * 0.1,
    lqd: 108,
    tlt: 90 + (i % 4) * 0.1,
    tnx: 4.4,
    irx: 3.6,
    cper: 38 + (i % 6) * 0.1,
    gld: 380,
  }));
}

describe("buildFactors", () => {
  it("returns one series per named factor, each the length of the input", () => {
    const rows = makeRows(300);
    const { fragility, euphoria } = buildFactors(rows, DEFAULT_PARAMS);
    expect(fragility).toHaveLength(FRAGILITY_FACTORS.length);
    expect(euphoria).toHaveLength(EUPHORIA_FACTORS.length);
    for (const s of [...fragility, ...euphoria]) expect(s).toHaveLength(rows.length);
  });

  it("vixTS factor equals vix/vix3m", () => {
    const rows = makeRows(10);
    const { fragility } = buildFactors(rows, DEFAULT_PARAMS);
    const vixTS = fragility[0]; // FRAGILITY_FACTORS[0]
    expect(vixTS[5]).toBeCloseTo(rows[5].vix / rows[5].vix3m, 10);
  });
});

describe("alignSeries", () => {
  const sp = (dates: string[], vals: number[]): SeriesPoint[] =>
    dates.map((d, i) => ({ date: d, close: vals[i] }));

  it("aligns on the SPX axis and forward-fills gaps", () => {
    const series = {
      spx: sp(["2024-01-01", "2024-01-02", "2024-01-03"], [10, 11, 12]),
      // vix missing 01-02 -> should forward-fill 20
      vix: sp(["2024-01-01", "2024-01-03"], [20, 22]),
      vix3m: sp(["2024-01-01", "2024-01-02", "2024-01-03"], [21, 21, 23]),
      move: sp(["2024-01-01", "2024-01-02", "2024-01-03"], [80, 81, 82]),
      hyg: sp(["2024-01-01", "2024-01-02", "2024-01-03"], [79, 79, 78]),
      lqd: sp(["2024-01-01", "2024-01-02", "2024-01-03"], [108, 108, 109]),
      tlt: sp(["2024-01-01", "2024-01-02", "2024-01-03"], [90, 90, 91]),
      tnx: sp(["2024-01-01", "2024-01-02", "2024-01-03"], [4.4, 4.4, 4.5]),
      irx: sp(["2024-01-01", "2024-01-02", "2024-01-03"], [3.6, 3.6, 3.6]),
      cper: sp(["2024-01-01", "2024-01-02", "2024-01-03"], [38, 38, 39]),
      gld: sp(["2024-01-01", "2024-01-02", "2024-01-03"], [380, 381, 382]),
    };
    const rows = alignSeries(series);
    expect(rows).toHaveLength(3);
    expect(rows[1].vix).toBe(20); // forward-filled from 01-01
    expect(rows[2].vix).toBe(22);
  });

  it("drops leading rows that have no prior value for a series", () => {
    const series = {
      spx: sp(["2024-01-01", "2024-01-02"], [10, 11]),
      vix: sp(["2024-01-02"], [20]), // no value on/before 01-01
      vix3m: sp(["2024-01-01", "2024-01-02"], [21, 22]),
      move: sp(["2024-01-01", "2024-01-02"], [80, 81]),
      hyg: sp(["2024-01-01", "2024-01-02"], [79, 78]),
      lqd: sp(["2024-01-01", "2024-01-02"], [108, 109]),
      tlt: sp(["2024-01-01", "2024-01-02"], [90, 91]),
      tnx: sp(["2024-01-01", "2024-01-02"], [4.4, 4.5]),
      irx: sp(["2024-01-01", "2024-01-02"], [3.6, 3.6]),
      cper: sp(["2024-01-01", "2024-01-02"], [38, 39]),
      gld: sp(["2024-01-01", "2024-01-02"], [380, 381]),
    };
    const rows = alignSeries(series);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2024-01-02");
  });
});

describe("computeAnomaly", () => {
  // Build a synthetic dataset long enough to clear the z-score window, then
  // inject a stress event near the end and confirm a crash signal fires.
  function synthetic(): AlignedRow[] {
    const n = Z_WINDOW + 60;
    const rows: AlignedRow[] = [];
    for (let i = 0; i < n; i++) {
      const stress = i >= n - 10; // last 10 days: vol/credit/move blow out
      const day = new Date(Date.UTC(2022, 0, 1) + i * 86400000);
      rows.push({
        date: day.toISOString().slice(0, 10),
        // calm uptrend, then a sharp drop during the stress window
        spx: stress ? 400 - (i - (n - 10)) * 8 : 300 + i * 0.3,
        vix: stress ? 40 : 15,
        vix3m: stress ? 30 : 20, // backwardation during stress (ratio > 1)
        move: stress ? 150 : 80,
        hyg: stress ? 70 : 80, // credit ratio collapses
        lqd: 108,
        tlt: 90,
        tnx: 4.4,
        irx: 3.6,
        cper: 38,
        gld: 380,
      });
    }
    return rows;
  }

  it("returns one point per input row with nulls before the window", () => {
    const rows = synthetic();
    const out = computeAnomaly(rows);
    expect(out).toHaveLength(rows.length);
    expect(out[0].fragility).toBeNull();
    expect(out[0].signal).toBe("neutral");
    expect(out.at(-1)!.fragility).not.toBeNull();
  });

  it("raises fragility and fires a confirmed crash signal under stress", () => {
    const out = computeAnomaly(synthetic());
    const last = out.at(-1)!;
    expect(last.fragility!).toBeGreaterThan(1.5);
    expect(out.some((p) => p.signal === "crash")).toBe(true);
    // composite should be deeply negative when fragility dominates
    expect(last.composite!).toBeLessThan(0);
  });

  it("yieldCurve passes through tnx - irx", () => {
    const out = computeAnomaly(synthetic());
    expect(out[0].yieldCurve).toBeCloseTo(0.8, 10);
  });
});

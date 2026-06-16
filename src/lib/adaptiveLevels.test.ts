import { describe, it, expect } from "vitest";
import { annualizedVol, sma, rollingSma, rollingVol, computeRegime, scaleByVol, computeAdaptiveLevels, buildMergedLadder } from "./adaptiveLevels";
import { computeLevels } from "./levels";

describe("annualizedVol", () => {
  it("is 0 for a flat series (no movement)", () => {
    expect(annualizedVol([100, 100, 100, 100, 100], 4)).toBe(0);
  });

  it("returns 0 when there aren't enough closes", () => {
    expect(annualizedVol([100, 101], 20)).toBe(0);
  });

  it("scales with the size of daily moves", () => {
    const calm = annualizedVol([100, 101, 100, 101, 100, 101], 5);
    const wild = annualizedVol([100, 110, 100, 110, 100, 110], 5);
    expect(wild).toBeGreaterThan(calm);
    expect(calm).toBeGreaterThan(0);
  });

  it("uses only the trailing window", () => {
    const closes = [1, 100, 1, 100, 50, 50.5, 50, 50.5, 50];
    // last 4 returns are tiny; a huge early swing must be ignored
    expect(annualizedVol(closes, 4)).toBeLessThan(annualizedVol(closes, 8));
  });
});

describe("sma", () => {
  it("averages the trailing window", () => {
    expect(sma([1, 2, 3, 4, 5, 6], 3)).toBe(5); // (4+5+6)/3
  });
  it("returns 0 when there aren't enough points", () => {
    expect(sma([1, 2], 5)).toBe(0);
  });
});

describe("rollingSma", () => {
  it("is null until the window fills, then the trailing average", () => {
    expect(rollingSma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });
});

describe("rollingVol", () => {
  it("is null until window+1 points, then positive for a moving series", () => {
    const series = rollingVol([100, 101, 100, 101, 100, 101], 2);
    expect(series[0]).toBeNull();
    expect(series[1]).toBeNull();
    expect(series[2]).toBeGreaterThan(0);
    expect(series.length).toBe(6);
  });
});

describe("computeRegime", () => {
  it("is risk-on above the band", () => {
    expect(computeRegime(105, 100, 1.5)).toBe("risk-on");
  });
  it("is risk-off below the band", () => {
    expect(computeRegime(95, 100, 1.5)).toBe("risk-off");
  });
  it("is neutral inside the band", () => {
    expect(computeRegime(101, 100, 1.5)).toBe("neutral");
    expect(computeRegime(99, 100, 1.5)).toBe("neutral");
  });
  it("is neutral when the moving average is unavailable", () => {
    expect(computeRegime(100, 0)).toBe("neutral");
  });
});

describe("scaleByVol", () => {
  it("returns the base when current equals baseline", () => {
    expect(scaleByVol(1, 50, 50, 0.5, 3)).toBe(1);
  });
  it("widens when current vol exceeds baseline", () => {
    expect(scaleByVol(1, 75, 50, 0.5, 3)).toBeCloseTo(1.5);
  });
  it("clamps to the max", () => {
    expect(scaleByVol(1, 500, 50, 0.5, 3)).toBe(3);
  });
  it("clamps to the min", () => {
    expect(scaleByVol(1, 5, 50, 0.5, 3)).toBe(0.5);
  });
  it("falls back to base when baseline is zero", () => {
    expect(scaleByVol(2, 50, 0, 0.5, 3)).toBe(2);
  });
});

describe("computeAdaptiveLevels", () => {
  const params = {
    levelStartingCash: 100_000,
    initialLotPrice: 80,
    reductionFactor: 1.02,
    spacingPercent: 1.5,
    sellPercent: 7,
    count: 10,
  };

  it("spaces buy prices geometrically by the spacing percent", () => {
    const levels = computeAdaptiveLevels(params);
    expect(levels[0].buyPrice).toBeCloseTo(80);
    expect(levels[1].buyPrice).toBeCloseTo(80 * 0.985);
    expect(levels[2].buyPrice).toBeCloseTo(80 * 0.985 * 0.985);
  });

  it("keeps every buy price positive even with wide spacing", () => {
    const levels = computeAdaptiveLevels({ ...params, spacingPercent: 3, count: 88 });
    expect(levels.every((l) => l.buyPrice > 0)).toBe(true);
  });

  it("sets the sell price the configured percent above the buy", () => {
    const levels = computeAdaptiveLevels(params);
    expect(levels[0].sellPrice).toBeCloseTo(80 * 1.07);
    expect(levels[3].sellPrice).toBeCloseTo(levels[3].buyPrice * 1.07);
  });

  it("allocates roughly the starting cash across the ladder", () => {
    const levels = computeAdaptiveLevels(params);
    const totalCost = levels.reduce((sum, l) => sum + l.cost, 0);
    // share rounding makes this approximate, not exact
    expect(totalCost).toBeGreaterThan(95_000);
    expect(totalCost).toBeLessThan(105_000);
  });
});

describe("buildMergedLadder", () => {
  const opts = {
    initialLotPrice: 80,
    reductionFactor: 1.02,
    spacingPercent: 1.5,
    sellPercent: 7,
    levelStartingCash: 100_000,
    count: 10,
  };

  it("with nothing owned (currentLevel -1) is fully adaptive from initialLotPrice", () => {
    const merged = buildMergedLadder([], -1, opts);
    const adaptive = computeAdaptiveLevels(opts);
    expect(merged.every((l) => l.optimized)).toBe(true);
    // iterative multiply vs Math.pow differ only by float rounding
    merged.forEach((l, i) => expect(l.buyPrice).toBeCloseTo(adaptive[i].buyPrice, 6));
  });

  it("keeps owned levels at their static buy basis but uses the optimized sell %", () => {
    const staticLevels = computeLevels(100_000, 80, 5, 1.02);
    const merged = buildMergedLadder(staticLevels, 3, opts);
    for (let n = 0; n <= 3; n++) {
      expect(merged[n].optimized).toBe(false);
      expect(merged[n].buyPrice).toBeCloseTo(staticLevels[n].buyPrice); // real basis, static
      expect(merged[n].sellPrice).toBeCloseTo(staticLevels[n].buyPrice * 1.07); // optimized 7%, not 5%
    }
  });

  it("starts the adaptive rungs below the last owned rung and stays monotonic", () => {
    const staticLevels = computeLevels(100_000, 80, 5, 1.02);
    const merged = buildMergedLadder(staticLevels, 3, opts);
    expect(merged[4].optimized).toBe(true);
    expect(merged[4].buyPrice).toBeCloseTo(staticLevels[3].buyPrice * 0.985);
    expect(merged[4].sellPrice).toBeCloseTo(merged[4].buyPrice * 1.07); // adaptive 7%
    for (let n = 1; n < merged.length; n++) {
      expect(merged[n].buyPrice).toBeLessThan(merged[n - 1].buyPrice);
    }
  });

  it("stays monotonic even when adaptive spacing is tighter than the static 1%", () => {
    const staticLevels = computeLevels(100_000, 80, 5, 1.02);
    const merged = buildMergedLadder(staticLevels, 3, { ...opts, spacingPercent: 0.5 });
    for (let n = 1; n < merged.length; n++) {
      expect(merged[n].buyPrice).toBeLessThan(merged[n - 1].buyPrice);
    }
  });
});

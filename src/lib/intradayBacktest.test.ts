import { describe, it, expect } from "vitest";
import { candlesToBars, buyHoldCurve, downsample, coveredSpan, dailyTable, type CurvePoint } from "./intradayBacktest";
import { simulateLadder, type LadderParams } from "./ladderSim";
import type { Candle } from "./schwab/pricehistory";

const candle = (datetime: number, c: number, h = c, l = c): Candle => ({
  datetime,
  open: c,
  high: h,
  low: l,
  close: c,
  volume: 0,
});

const DAY = 24 * 60 * 60 * 1000;

describe("candlesToBars", () => {
  it("maps candles to ISO-dated sim bars keeping intraday range", () => {
    const bars = candlesToBars([candle(0, 100, 105, 95)]);
    expect(bars).toEqual([{ date: "1970-01-01T00:00:00.000Z", close: 100, high: 105, low: 95 }]);
  });
});

describe("buyHoldCurve", () => {
  it("grows starting cash with the close from the first bar", () => {
    const bars = candlesToBars([candle(0, 100), candle(DAY, 150)]);
    const curve = buyHoldCurve(bars, 1000);
    expect(curve[0].value).toBeCloseTo(1000); // 10 shares @100
    expect(curve[1].value).toBeCloseTo(1500); // 10 shares @150
  });

  it("returns empty for no bars", () => {
    expect(buyHoldCurve([], 1000)).toEqual([]);
  });
});

describe("downsample", () => {
  it("keeps the last point of each calendar day", () => {
    const curve: CurvePoint[] = [
      { date: "2026-01-01T14:00:00.000Z", value: 1 },
      { date: "2026-01-01T20:00:00.000Z", value: 2 }, // last of day 1
      { date: "2026-01-02T20:00:00.000Z", value: 3 }, // last of day 2
    ];
    expect(downsample(curve)).toEqual([
      { date: "2026-01-01T20:00:00.000Z", value: 2 },
      { date: "2026-01-02T20:00:00.000Z", value: 3 },
    ]);
  });

  it("strides down to maxPoints but always keeps the final point", () => {
    const curve: CurvePoint[] = Array.from({ length: 10 }, (_, i) => ({
      date: new Date(i * DAY).toISOString(),
      value: i,
    }));
    const out = downsample(curve, 3);
    expect(out.length).toBeLessThanOrEqual(4); // 3 strided + forced last
    expect(out[out.length - 1].value).toBe(9); // exact final value preserved
  });
});

describe("coveredSpan", () => {
  it("reports earliest/latest, distinct trading days, and bar count", () => {
    const bars = candlesToBars([candle(0, 100), candle(60_000, 101), candle(DAY, 102)]);
    const span = coveredSpan(bars);
    expect(span.bars).toBe(3);
    expect(span.tradingDays).toBe(2);
    expect(span.earliest).toBe("1970-01-01T00:00:00.000Z");
    expect(span.latest).toBe("1970-01-02T00:00:00.000Z");
  });

  it("is empty for no bars", () => {
    expect(coveredSpan([])).toEqual({ earliest: null, latest: null, tradingDays: 0, bars: 0 });
  });
});

describe("dailyTable", () => {
  const pt = (date: string, value: number, barBuys = 0, barSells = 0, barProfit = 0) => ({
    date, value, barBuys, barSells, barProfit,
  });

  it("aggregates intraday bars into calendar-day rows", () => {
    const equity = [
      pt("2026-01-01T14:00:00.000Z", 100000, 2, 0, 0),
      pt("2026-01-01T15:00:00.000Z", 100050, 0, 1, 50), // last bar of day 1
      pt("2026-01-02T14:00:00.000Z", 100100, 1, 1, 100), // only bar of day 2
    ];
    const rows = dailyTable(equity);
    expect(rows).toHaveLength(2);
    // most recent first
    expect(rows[0].date).toBe("2026-01-02");
    expect(rows[0].buys).toBe(1);
    expect(rows[0].sells).toBe(1);
    expect(rows[0].profit).toBeCloseTo(100);
    expect(rows[0].balance).toBeCloseTo(100100);
    // day 1: 2 buys + 1 sell across both bars
    expect(rows[1].date).toBe("2026-01-01");
    expect(rows[1].buys).toBe(2);
    expect(rows[1].sells).toBe(1);
    expect(rows[1].profit).toBeCloseTo(50);
    expect(rows[1].balance).toBeCloseTo(100050); // last bar's value
  });

  it("returns empty for empty equity", () => {
    expect(dailyTable([])).toEqual([]);
  });
});

describe("end-to-end: candles -> simulateLadder", () => {
  it("runs the ladder over mapped candles", () => {
    const P: LadderParams = { startingCash: 100000, stepPct: 1, sellPct: 5, reductionFactor: 1, reanchorPct: 0 };
    const candles = [candle(0, 100), candle(DAY, 99, 99, 99), candle(2 * DAY, 105, 105, 105)];
    const r = simulateLadder(candlesToBars(candles), P);
    expect(r.buys).toBe(2); // level0 @100, level1 @99
    expect(r.sells).toBe(2); // both sold when high reaches 105
    expect(r.finalValue).toBeGreaterThan(r.equity[0].value);
  });
});

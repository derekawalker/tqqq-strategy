import { describe, it, expect } from "vitest";
import {
  SCORE_MIN,
  SCORE_MAX,
  RISK_ON_MIN,
  NEUTRAL_MIN,
  classifyRegime,
  computeSeries,
  backtestRegimes,
  daysInRegime,
  type SeriesInput,
} from "./sentiment";

describe("score range", () => {
  it("is derived from the seven signal tier tables", () => {
    // vs200 +2, vs50 +2, vix +1, momentum +2, stress +1, slope +1, term +1
    expect(SCORE_MAX).toBe(10);
    // vs200 -2, vs50 -2, vix -3, momentum -2, stress -3, slope -2, term -2
    expect(SCORE_MIN).toBe(-16);
  });
});

describe("classifyRegime", () => {
  it("classifies on raw thresholds with no prior regime", () => {
    expect(classifyRegime(RISK_ON_MIN)).toBe("Risk-On");
    expect(classifyRegime(NEUTRAL_MIN)).toBe("Neutral");
    expect(classifyRegime(NEUTRAL_MIN - 1)).toBe("Risk-Off");
  });

  it("applies hysteresis so it doesn't whipsaw at the boundary", () => {
    // Sitting at Risk-On, a one-point dip below the entry threshold holds.
    expect(classifyRegime(RISK_ON_MIN - 1, "Risk-On")).toBe("Risk-On");
    // Two points below flips to Neutral.
    expect(classifyRegime(RISK_ON_MIN - 2, "Risk-On")).toBe("Neutral");
    // Sitting at Risk-Off, a one-point rise above the exit threshold holds.
    expect(classifyRegime(NEUTRAL_MIN + 1, "Risk-Off")).toBe("Risk-Off");
    // Two points above leaves Risk-Off.
    expect(classifyRegime(NEUTRAL_MIN + 2, "Risk-Off")).toBe("Neutral");
  });
});

// Build a synthetic series: a long calm uptrend, then a sharp selloff.
function syntheticInput(): SeriesInput {
  const dates: string[] = [];
  const closes: number[] = [];
  const vix: (number | null)[] = [];
  const vix3m: (number | null)[] = [];
  const start = new Date("2022-01-03T00:00:00Z");

  // 260 calm up-days, then 30 crash days.
  for (let i = 0; i < 290; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    dates.push(d.toISOString().slice(0, 10));
    if (i < 260) {
      closes.push(100 + i * 0.5); // steady grind up
      vix.push(13);
      vix3m.push(16); // contango (calm)
    } else {
      const k = i - 260;
      closes.push(230 - k * 4); // sharp drop
      vix.push(40);
      vix3m.push(32); // backwardation (stress)
    }
  }
  return { dates, closes, vix, vix3m };
}

describe("computeSeries", () => {
  const series = computeSeries(syntheticInput());

  it("produces one scored day per input bar", () => {
    expect(series).toHaveLength(290);
  });

  it("reads Risk-On during the calm uptrend", () => {
    const calm = series[259]; // last calm day
    expect(calm.regime).toBe("Risk-On");
    expect(calm.total).toBeGreaterThan(0);
  });

  it("reads Risk-Off during the crash", () => {
    const crash = series[series.length - 1];
    expect(crash.regime).toBe("Risk-Off");
    expect(crash.total).toBeLessThan(0);
    expect(crash.scores.term).toBeLessThan(0); // backwardation penalised
  });
});

describe("backtestRegimes", () => {
  it("separates forward returns by regime in a trending series", () => {
    const series = computeSeries(syntheticInput());
    const bt = backtestRegimes(series, 10);
    const on = bt.stats.find((s) => s.regime === "Risk-On");
    const off = bt.stats.find((s) => s.regime === "Risk-Off");
    expect(on).toBeDefined();
    expect(off).toBeDefined();
    // Up-trend days look forward into more up-trend; crash days into more crash.
    expect(on!.avgReturn).toBeGreaterThan(off!.avgReturn);
    // Every regime reports a non-negative annualised forward volatility.
    expect(on!.avgVol).toBeGreaterThanOrEqual(0);
    expect(off!.avgVol).toBeGreaterThanOrEqual(0);
  });
});

describe("daysInRegime", () => {
  it("counts the trailing run of the current regime", () => {
    const series = computeSeries(syntheticInput());
    const held = daysInRegime(series);
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThanOrEqual(30); // crash lasted 30 days
  });
});

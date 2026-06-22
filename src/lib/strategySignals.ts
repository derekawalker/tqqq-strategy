/**
 * Pure signal generators for the backtest strategy overlays.
 * All functions are bar-aligned: output[i] corresponds to bars[i].
 *
 * Throttle conventions (used by simulateLadder):
 *   1.0 = full buys  |  0.0 = pause all buys  |  0–1 = partial
 */

import type { SimBar } from "./intradayBacktest";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Simple moving average. Returns null until `period` values have accumulated. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Wilder's smoothed ATR. Returns null until `period` bars have elapsed. */
export function atr(bars: SimBar[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  let smooth = 0;
  for (let i = 0; i < bars.length; i++) {
    const hi = bars[i].high ?? bars[i].close;
    const lo = bars[i].low ?? bars[i].close;
    const prevClose = i > 0 ? bars[i - 1].close : bars[i].close;
    const tr = Math.max(hi - lo, Math.abs(hi - prevClose), Math.abs(lo - prevClose));
    smooth = i === 0 ? tr : (smooth * (period - 1) + tr) / period;
    if (i >= period - 1) out[i] = smooth;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Last intraday bar for each calendar day → daily close series. */
function dailyCloses(bars: SimBar[]): { date: string; close: number }[] {
  const byDay = new Map<string, number>();
  for (const b of bars) byDay.set(b.date.slice(0, 10), b.close);
  return [...byDay.entries()].map(([date, close]) => ({ date, close }));
}

// ---------------------------------------------------------------------------
// Strategy 1 – MA gate
// ---------------------------------------------------------------------------

export interface DailyPrice {
  date: string; // YYYY-MM-DD
  close: number;
}

/**
 * MA gate throttle: 1 when price ≥ SMA, 0 when below.
 * Pass `externalPrices` for an external symbol (e.g. QQQ from Yahoo);
 * omit to compute from the TQQQ bars themselves.
 */
export function maGateThrottle(
  bars: SimBar[],
  period: number,
  externalPrices?: DailyPrice[],
): number[] {
  const prices = externalPrices ?? dailyCloses(bars);
  const maVals = sma(prices.map((p) => p.close), period);
  const byDate = new Map<string, number>();
  for (let i = 0; i < prices.length; i++) {
    const ma = maVals[i];
    byDate.set(prices[i].date, ma == null ? 1 : prices[i].close >= ma ? 1 : 0);
  }
  return bars.map((b) => byDate.get(b.date.slice(0, 10)) ?? 1);
}

// ---------------------------------------------------------------------------
// Strategy 2 – VIX gate
// ---------------------------------------------------------------------------

/**
 * VIX gate: linear scale from 1 (at or below vixFloor) to 0 (at or above vixCeiling).
 * Dates with no VIX data default to full buys.
 */
export function vixGateThrottle(
  bars: SimBar[],
  vixByDate: Map<string, number>,
  floor: number,
  ceiling: number,
): number[] {
  return bars.map((b) => {
    const vix = vixByDate.get(b.date.slice(0, 10));
    if (vix == null) return 1;
    if (vix <= floor) return 1;
    if (vix >= ceiling) return 0;
    return 1 - (vix - floor) / (ceiling - floor);
  });
}

// ---------------------------------------------------------------------------
// Strategy 3 – ATR-adaptive step sizes
// ---------------------------------------------------------------------------

/**
 * Per-bar step % derived from ATR as a fraction of price.
 * Low ATR → stepMin (tight grid, frequent harvests).
 * High ATR → stepMax (wide grid, preserves dry powder).
 * Normalised between the 10th and 90th percentile of ATR% history.
 */
export function atrStepPcts(
  bars: SimBar[],
  period: number,
  stepMin: number,
  stepMax: number,
): number[] {
  const rawAtr = atr(bars, period);
  const atrPcts = bars.map((b, i) => {
    const a = rawAtr[i];
    return a != null ? (a / b.close) * 100 : null;
  });
  const known = atrPcts.filter((v): v is number => v != null).sort((a, b) => a - b);
  const p10 = known[Math.floor(known.length * 0.1)] ?? 0;
  const p90 = known[Math.floor(known.length * 0.9)] ?? 1;
  return atrPcts.map((a) => {
    if (a == null) return stepMin;
    const t = p10 === p90 ? 0.5 : Math.max(0, Math.min(1, (a - p10) / (p90 - p10)));
    return stepMin + t * (stepMax - stepMin);
  });
}

// ---------------------------------------------------------------------------
// Strategy 5 – Golden Cross regime
// ---------------------------------------------------------------------------

/**
 * Maps the 3-way relationship between price, fast MA, and slow MA to a throttle:
 *   price ≥ fast ≥ slow → 1.0 (bull)
 *   fast ≥ slow, price < fast → 0.6 (caution)
 *   price ≥ slow > fast → 0.3 (weak bear — GC just died)
 *   price < slow → 0.0 (bear)
 * Returns 1 until both MAs have enough history.
 */
export function gcThrottle(
  bars: SimBar[],
  fastPeriod: number,
  slowPeriod: number,
): number[] {
  const daily = dailyCloses(bars);
  const prices = daily.map((d) => d.close);
  const fastMA = sma(prices, fastPeriod);
  const slowMA = sma(prices, slowPeriod);
  const byDate = new Map<string, number>();
  for (let i = 0; i < daily.length; i++) {
    const fast = fastMA[i];
    const slow = slowMA[i];
    const price = daily[i].close;
    let throttle: number;
    if (fast == null || slow == null) {
      throttle = 1;
    } else if (price >= fast && fast >= slow) {
      throttle = 1.0;
    } else if (fast >= slow) {
      throttle = 0.6;
    } else if (price >= slow) {
      throttle = 0.3;
    } else {
      throttle = 0.0;
    }
    byDate.set(daily[i].date, throttle);
  }
  return bars.map((b) => byDate.get(b.date.slice(0, 10)) ?? 1);
}

// ---------------------------------------------------------------------------
// Combiner
// ---------------------------------------------------------------------------

/**
 * Element-wise minimum across throttle arrays — most restrictive signal wins.
 * Returns an all-ones array if no throttles are provided.
 */
export function combineThrottles(...throttles: number[][]): number[] {
  if (throttles.length === 0) return [];
  const len = throttles[0].length;
  const out = new Array<number>(len).fill(1);
  for (const t of throttles) {
    for (let i = 0; i < len; i++) out[i] = Math.min(out[i], t[i]);
  }
  return out;
}

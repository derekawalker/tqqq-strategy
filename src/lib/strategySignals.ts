/**
 * Pure signal generators for backtest strategy overlays.
 * All functions are bar-aligned: output[i] corresponds to bars[i].
 *
 * Throttle conventions (used by simulateLadder):
 *   1.0 = full buys  |  0.0 = pause all buys
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

/** Last intraday bar for each calendar day → daily close series. */
function dailyCloses(bars: SimBar[]): { date: string; close: number }[] {
  const byDay = new Map<string, number>();
  for (const b of bars) byDay.set(b.date.slice(0, 10), b.close);
  return [...byDay.entries()].map(([date, close]) => ({ date, close }));
}

// ---------------------------------------------------------------------------
// MA gate with hysteresis
// ---------------------------------------------------------------------------

/**
 * Stateful MA gate: stop buying when price falls below stopPeriod MA,
 * resume when price rises back above resumePeriod MA.
 * Setting both periods equal gives a simple on/off gate with no hysteresis.
 * Should be called on maBars (extended history) so the initial state reflects
 * the full price history before the display range starts.
 */
export function maHysteresisThrottle(
  bars: SimBar[],
  stopPeriod: number,
  resumePeriod: number,
): number[] {
  const daily = dailyCloses(bars);
  const prices = daily.map((d) => d.close);
  const stopMA = sma(prices, stopPeriod);
  const resumeMA = sma(prices, resumePeriod);
  const byDate = new Map<string, number>();
  let buying = true;
  for (let i = 0; i < daily.length; i++) {
    const price = daily[i].close;
    const stop = stopMA[i];
    const resume = resumeMA[i];
    if (buying && stop != null && price < stop) buying = false;
    if (!buying && resume != null && price > resume) buying = true;
    byDate.set(daily[i].date, buying ? 1 : 0);
  }
  return bars.map((b) => byDate.get(b.date.slice(0, 10)) ?? 1);
}

// ---------------------------------------------------------------------------
// VIX gate with hysteresis
// ---------------------------------------------------------------------------

/**
 * Stateful VIX gate: stop buying when VIX rises above stopVix,
 * resume when VIX falls back below resumeVix.
 * Dates with no VIX data leave the current state unchanged.
 */
export function vixHysteresisThrottle(
  bars: SimBar[],
  vixByDate: Map<string, number>,
  stopVix: number,
  resumeVix: number,
): number[] {
  let buying = true;
  return bars.map((b) => {
    const vix = vixByDate.get(b.date.slice(0, 10));
    if (vix !== undefined) {
      if (buying && vix >= stopVix) buying = false;
      if (!buying && vix <= resumeVix) buying = true;
    }
    return buying ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Combiner
// ---------------------------------------------------------------------------

/**
 * Element-wise minimum across throttle arrays — most restrictive signal wins.
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

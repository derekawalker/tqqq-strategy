/**
 * Pure helpers for the intraday ladder backtest page. The Schwab fetch and the
 * ladder simulation live elsewhere (pricehistory.ts / ladderSim.ts); this module
 * just shapes candles into sim bars, builds the buy-and-hold benchmark, and
 * thins curves for transport. Kept pure so the /api/backtest route stays thin
 * and the logic is unit-testable.
 */

import type { Candle } from "./schwab/pricehistory";

export interface SimBar {
  date: string; // ISO timestamp (label + chart x)
  close: number;
  high: number;
  low: number;
}

export interface CurvePoint {
  date: string;
  value: number;
}

/** Schwab candles → bars for simulateLadder (ISO date, intraday high/low kept). */
export function candlesToBars(candles: Candle[]): SimBar[] {
  return candles.map((c) => ({
    date: new Date(c.datetime).toISOString(),
    close: c.close,
    high: c.high,
    low: c.low,
  }));
}

/** Growth of `startingCash` held in the symbol from the first bar's close. */
export function buyHoldCurve(bars: SimBar[], startingCash: number): CurvePoint[] {
  if (bars.length === 0) return [];
  const first = bars[0].close;
  const shares = first > 0 ? startingCash / first : 0;
  return bars.map((b) => ({ date: b.date, value: shares * b.close }));
}

/**
 * Thin a curve for the chart: keep the last point of each calendar day, then —
 * if still over `maxPoints` — stride-sample down to it (always keeping the last
 * point so the final value is exact). Stats are computed on the full series
 * before this runs, so thinning only affects rendering.
 */
export function downsample(curve: CurvePoint[], maxPoints = 1500): CurvePoint[] {
  if (curve.length === 0) return [];
  const lastPerDay: CurvePoint[] = [];
  for (let i = 0; i < curve.length; i++) {
    const day = curve[i].date.slice(0, 10);
    const nextDay = i + 1 < curve.length ? curve[i + 1].date.slice(0, 10) : null;
    if (day !== nextDay) lastPerDay.push(curve[i]);
  }
  if (lastPerDay.length <= maxPoints) return lastPerDay;

  const stride = Math.ceil(lastPerDay.length / maxPoints);
  const out: CurvePoint[] = [];
  for (let i = 0; i < lastPerDay.length; i += stride) out.push(lastPerDay[i]);
  const last = lastPerDay[lastPerDay.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export interface DailyRow {
  date: string; // YYYY-MM-DD
  buys: number;
  sells: number;
  profit: number; // realized profit on this calendar day
  balance: number; // portfolio value at end of day
}

/** Aggregate per-bar sim output into one row per calendar day (most recent first). */
export function dailyTable(
  equity: Array<{ date: string; value: number; barBuys: number; barSells: number; barProfit: number }>,
): DailyRow[] {
  const byDay = new Map<string, DailyRow>();
  for (const pt of equity) {
    const day = pt.date.slice(0, 10);
    const row = byDay.get(day);
    if (row) {
      row.buys += pt.barBuys;
      row.sells += pt.barSells;
      row.profit += pt.barProfit;
      row.balance = pt.value; // last bar of the day wins
    } else {
      byDay.set(day, { date: day, buys: pt.barBuys, sells: pt.barSells, profit: pt.barProfit, balance: pt.value });
    }
  }
  return [...byDay.values()].reverse(); // most recent first
}

export interface CoveredSpan {
  earliest: string | null; // ISO
  latest: string | null; // ISO
  tradingDays: number;
  bars: number;
}

/** Span summary for the page header (depth of the pulled intraday history). */
export function coveredSpan(bars: SimBar[]): CoveredSpan {
  if (bars.length === 0) return { earliest: null, latest: null, tradingDays: 0, bars: 0 };
  const days = new Set(bars.map((b) => b.date.slice(0, 10)));
  return {
    earliest: bars[0].date,
    latest: bars[bars.length - 1].date,
    tradingDays: days.size,
    bars: bars.length,
  };
}

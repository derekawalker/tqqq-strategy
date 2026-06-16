/**
 * Yahoo Finance fetchers for the backtest engine. Server/CLI only (pulls from the network).
 * Pure simulation logic lives in src/lib/backtest.ts.
 */
import YahooFinance from "yahoo-finance2";
import { type Bar, DAY } from "./backtest";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type Interval = "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "1d";
/** Explicit historical window (ISO YYYY-MM-DD). When set, fetches use it instead of `days` back from now. */
export interface DateRange { from: string; to: string }

export async function dailyCloses(symbol: string, days: number, range?: DateRange): Promise<{ date: string; close: number }[]> {
  // Always pull 420 extra calendar days before the window start so SMA-200 / vol baselines have history.
  const period1 = range ? new Date(new Date(range.from).getTime() - 420 * DAY) : new Date(Date.now() - (days + 420) * DAY);
  const r = await yf.chart(symbol, { period1, ...(range ? { period2: new Date(range.to) } : {}), interval: "1d" });
  return (r.quotes ?? [])
    .filter((q) => q.close != null && q.date != null)
    .map((q) => ({ date: (q.date as Date).toISOString().slice(0, 10), close: q.close as number }));
}

export async function intradayBars(interval: Interval, days: number, range?: DateRange): Promise<Bar[]> {
  const period1 = range ? new Date(range.from) : new Date(Date.now() - days * DAY);
  const r = await yf.chart("TQQQ", { period1, ...(range ? { period2: new Date(range.to) } : {}), interval });
  return (r.quotes ?? [])
    .filter((q) => q.high != null && q.low != null && q.close != null && q.open != null && q.date != null)
    .map((q) => ({ date: q.date as Date, high: q.high as number, low: q.low as number, close: q.close as number, open: q.open as number }));
}

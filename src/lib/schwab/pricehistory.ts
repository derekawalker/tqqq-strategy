import { schwabFetch } from "./client";

/** A single Schwab price-history candle (datetime is epoch ms). */
export interface Candle {
  datetime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceHistoryOpts {
  periodType?: "day" | "month" | "year" | "ytd";
  period?: number;
  frequencyType?: "minute" | "daily" | "weekly" | "monthly";
  frequency?: number; // for minute: 1 | 5 | 10 | 15 | 30
  startDate?: number; // epoch ms
  endDate?: number; // epoch ms
  needExtendedHoursData?: boolean;
}

/** Build the pricehistory query string (pure — unit-testable). */
export function priceHistoryQuery(symbol: string, opts: PriceHistoryOpts): string {
  const p = new URLSearchParams({ symbol });
  if (opts.periodType) p.set("periodType", opts.periodType);
  if (opts.period != null) p.set("period", String(opts.period));
  if (opts.frequencyType) p.set("frequencyType", opts.frequencyType);
  if (opts.frequency != null) p.set("frequency", String(opts.frequency));
  if (opts.startDate != null) p.set("startDate", String(Math.floor(opts.startDate)));
  if (opts.endDate != null) p.set("endDate", String(Math.floor(opts.endDate)));
  p.set("needExtendedHoursData", String(opts.needExtendedHoursData ?? false));
  return p.toString();
}

/** Fetch raw candles from Schwab's market-data pricehistory endpoint. */
export async function getPriceHistory(symbol: string, opts: PriceHistoryOpts): Promise<Candle[]> {
  const res = await schwabFetch(`/marketdata/v1/pricehistory?${priceHistoryQuery(symbol, opts)}`);
  if (!res.ok) {
    throw new Error(`pricehistory ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.candles ?? []) as Candle[];
}

/**
 * Pull a long span of minute candles by paging month-by-month (a single request
 * caps the candle count, and minute history is windowed). De-dupes by datetime
 * and returns ascending. `freq` is minutes (1/5/10/15/30).
 */
export async function getIntradayHistory(
  symbol: string,
  startMs: number,
  endMs: number,
  freq: number,
  needExtendedHoursData = false,
): Promise<Candle[]> {
  const byTs = new Map<number, Candle>();
  const MONTH = 31 * 24 * 60 * 60 * 1000;
  for (let from = startMs; from < endMs; from += MONTH) {
    const to = Math.min(from + MONTH, endMs);
    let candles: Candle[] = [];
    try {
      candles = await getPriceHistory(symbol, {
        frequencyType: "minute",
        frequency: freq,
        startDate: from,
        endDate: to,
        needExtendedHoursData,
      });
    } catch {
      // a window before Schwab's minute history simply returns nothing/errors — skip
      continue;
    }
    for (const c of candles) if (c.datetime >= startMs && c.datetime <= endMs) byTs.set(c.datetime, c);
  }
  return [...byTs.values()].sort((a, b) => a.datetime - b.datetime);
}

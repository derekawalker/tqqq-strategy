/**
 * Lightweight Yahoo Finance daily OHLCV fetch. Server-side only.
 * Uses the v8 chart endpoint which returns timestamps + quote arrays.
 */

export interface YahooBar {
  date: string; // YYYY-MM-DD (ET calendar day)
  close: number;
  high: number;
  low: number;
  open: number;
}

async function fetchYahooChart(symbol: string, query: string): Promise<YahooBar[]> {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&${query}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    // Cache for 1 hour — daily bars don't change mid-day.
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`Yahoo Finance fetch failed for ${symbol}: ${res.status}`);
  }
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for ${symbol}`);

  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const closes: (number | null)[] = q.close ?? [];
  const highs: (number | null)[] = q.high ?? [];
  const lows: (number | null)[] = q.low ?? [];
  const opens: (number | null)[] = q.open ?? [];

  const out: YahooBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !isFinite(close)) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    out.push({
      date,
      close,
      high: highs[i] ?? close,
      low: lows[i] ?? close,
      open: opens[i] ?? close,
    });
  }
  return out;
}

export async function fetchYahooDaily(
  symbol: string,
  rangeYears: number | "max" = 3,
): Promise<YahooBar[]> {
  const range = rangeYears === "max" ? "max" : `${rangeYears}y`;
  return fetchYahooChart(symbol, `range=${range}`);
}

/**
 * Daily bars for an explicit date window via Yahoo's period1/period2 (Unix
 * seconds). Unlike `range=max`, this reliably returns *daily* granularity for
 * historical windows — `range=max` silently downgrades to monthly bars, which
 * is useless for a backtest. `start`/`end` are YYYY-MM-DD (inclusive).
 */
export async function fetchYahooDailyRange(
  symbol: string,
  start: string,
  end: string,
): Promise<YahooBar[]> {
  const period1 = Math.floor(new Date(start + "T00:00:00Z").getTime() / 1000);
  const period2 = Math.floor(new Date(end + "T23:59:59Z").getTime() / 1000);
  return fetchYahooChart(symbol, `period1=${period1}&period2=${period2}`);
}

/** Build a date→close map from Yahoo bars for fast lookup. */
export function yahooByDate(bars: YahooBar[]): Map<string, number> {
  return new Map(bars.map((b) => [b.date, b.close]));
}

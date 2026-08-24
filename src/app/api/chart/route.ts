import YahooFinance from "yahoo-finance2";
import { getCached, setCached } from "@/lib/ttlCache";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface Candle {
  time: number;  // ms timestamp
  close: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "1w";
  // Defaults to TQQQ so every existing caller is unaffected; the Hedge page
  // asks for ^VIX alongside it.
  const symbol = searchParams.get("symbol") ?? "TQQQ";
  const days = range === "1d" ? 1 : range === "1w" ? 7 : 30;
  const interval = range === "1d" ? "5m" : range === "1w" ? "30m" : "1d";

  // Several cards mount their own chart at once (dashboard minis, the chart and
  // hedge pages), each previously its own Yahoo round trip. Cache per
  // symbol+range, scaled to the bar size so a 5m chart still moves.
  const cacheKey = `chart:${symbol}:${range}`;
  const ttlMs = interval === "5m" ? 60_000 : interval === "30m" ? 5 * 60_000 : 30 * 60_000;
  const cached = getCached<Candle[]>(cacheKey, ttlMs);
  if (cached) return Response.json(cached);

  try {
    const result = await yf.chart(symbol, {
      period1: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      interval,
    });

    const candles: Candle[] = (result.quotes ?? [])
      .filter((q) => q.close != null)
      .map((q) => ({ time: (q.date as Date).getTime(), close: q.close as number }));

    setCached(cacheKey, candles);
    return Response.json(candles);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}

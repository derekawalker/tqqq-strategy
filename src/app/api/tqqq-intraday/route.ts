import { getPriceHistory, getIntradayHistory, type Candle } from "@/lib/schwab/pricehistory";

/**
 * TQQQ intraday history from the Schwab market-data API (uses the existing
 * Schwab OAuth session — no new account/key).
 *
 *   ?probe=1        — one wide minute request to discover how far back Schwab's
 *                     minute data actually goes (earliest/latest/count).
 *   ?start=YYYY-MM-DD&freq=5  — paged pull of the full span (month-by-month).
 *
 * Returns bars as { t, o, h, l, c, v } with t = epoch ms. Schwab candles are
 * continuous/split-adjusted, so they can be used directly for the ladder sim.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") ?? "TQQQ";
  const freq = Number(searchParams.get("freq") ?? 5);
  const ext = searchParams.get("ext") === "1";

  const pack = (c: Candle) => ({ t: c.datetime, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume });

  try {
    if (searchParams.get("probe")) {
      // Single request for an explicit window (defaults to 2010→now). Pass
      // ?start= & ?end= to test whether a specific OLD window has data — the
      // definitive way to tell a depth limit from a per-request count cap.
      const sStr = searchParams.get("start");
      const eStr = searchParams.get("end");
      const candles = await getPriceHistory(symbol, {
        frequencyType: "minute",
        frequency: freq,
        startDate: sStr ? Date.parse(sStr) : Date.parse("2010-01-01"),
        endDate: eStr ? Date.parse(eStr) : Date.now(),
        needExtendedHoursData: ext,
      });
      const first = candles[0];
      const last = candles.at(-1);
      const days = new Set(candles.map((c) => new Date(c.datetime).toISOString().slice(0, 10)));
      return Response.json({
        symbol,
        freqMinutes: freq,
        requested: { start: sStr ?? "2010-01-01", end: eStr ?? "now" },
        count: candles.length,
        tradingDays: days.size,
        earliest: first ? new Date(first.datetime).toISOString() : null,
        latest: last ? new Date(last.datetime).toISOString() : null,
        note: "if a specific old window returns 0, Schwab simply doesn't have that minute history",
      });
    }

    const startStr = searchParams.get("start");
    const startMs = startStr ? Date.parse(startStr) : Date.now() - 365 * 24 * 60 * 60 * 1000;
    const candles = await getIntradayHistory(symbol, startMs, Date.now(), freq, ext);
    return Response.json({ symbol, freqMinutes: freq, count: candles.length, bars: candles.map(pack) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const status = message.includes("Not authenticated") ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}

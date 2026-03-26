import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface Candle {
  time: number;  // ms timestamp
  close: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "1w";
  const days = range === "1d" ? 1 : range === "1w" ? 7 : 30;
  const interval = range === "1d" ? "5m" : range === "1w" ? "30m" : "1d";

  try {
    const result = await yf.chart("TQQQ", {
      period1: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      interval,
    });

    const candles: Candle[] = (result.quotes ?? [])
      .filter((q) => q.close != null)
      .map((q) => ({ time: (q.date as Date).getTime(), close: q.close as number }));

    return Response.json(candles);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}

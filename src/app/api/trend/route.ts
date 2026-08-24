import YahooFinance from "yahoo-finance2";
import { appendLiveQuote, computeTrend, dayLabelUTC, type DailyBar } from "@/lib/trend";
import { getCached, setCached } from "@/lib/ttlCache";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const BARS_KEY = "trend-bars-TQQQ";
// The header polls this every 45s during market hours, but the 45 days of daily
// bars behind it only change once a day. Cache the history and keep the live
// quote — which is what actually moves — on every call.
const BARS_TTL_MS = 10 * 60_000;

async function dailyBars(): Promise<DailyBar[]> {
  const cached = getCached<DailyBar[]>(BARS_KEY, BARS_TTL_MS);
  if (cached) return cached;

  const result = await yf.chart("TQQQ", {
    period1: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
    interval: "1d",
  });
  const bars: DailyBar[] = (result.quotes ?? [])
    .filter((q) => q.close != null)
    .map((q) => {
      const d = q.date as Date;
      return { close: q.close as number, date: dayLabelUTC(d), dow: d.getUTCDay() };
    });
  setCached(BARS_KEY, bars);
  return bars;
}

export async function GET() {
  try {
    const [historical, quoteData] = await Promise.all([dailyBars(), yf.quote("TQQQ")]);

    // Replace (or append) today's bar with the live quote, labelled in the same UTC
    // basis as the historical bars so the two can't disagree on which day is "today".
    const bars = appendLiveQuote(historical, quoteData.regularMarketPrice, new Date());

    const trend = computeTrend(bars.map((r) => r.close));

    const last30 = bars.slice(-30);
    const closes30 = last30.map((r) => r.close);
    const dates30 = last30.map((r) => r.date);
    const daysOfWeek30 = last30.map((r) => r.dow);

    return Response.json({ trend, closes30, dates30, daysOfWeek30 });
  } catch (err) {
    console.error("Trend fetch error:", err);
    return Response.json({ trend: 0 });
  }
}

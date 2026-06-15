import YahooFinance from "yahoo-finance2";
import { appendLiveQuote, computeTrend, dayLabelUTC, type DailyBar } from "@/lib/trend";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export async function GET() {
  try {
    const [result, quoteData] = await Promise.all([
      yf.chart("TQQQ", {
        period1: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
        interval: "1d",
      }),
      yf.quote("TQQQ"),
    ]);

    const historical: DailyBar[] = (result.quotes ?? [])
      .filter((q) => q.close != null)
      .map((q) => {
        const d = q.date as Date;
        return { close: q.close as number, date: dayLabelUTC(d), dow: d.getUTCDay() };
      });

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

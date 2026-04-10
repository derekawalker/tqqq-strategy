import YahooFinance from "yahoo-finance2";

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

    const filtered = (result.quotes ?? [])
      .filter((q) => q.close != null)
      .map((q) => ({
        close: q.close as number,
        date: (() => {
          const d = q.date as Date;
          return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
        })(),
        dow: (q.date as Date).getUTCDay(),
      }));

    // Always append/replace the last entry with the live quote price
    const now = new Date();
    const todayLabel = `${now.getMonth() + 1}/${now.getDate()}`;
    const livePrice = quoteData.regularMarketPrice;

    if (livePrice != null) {
      if (filtered.length > 0 && filtered[filtered.length - 1].date === todayLabel) {
        filtered[filtered.length - 1].close = livePrice;
      } else {
        filtered.push({ close: livePrice, date: todayLabel, dow: now.getDay() });
      }
    }

    const closes = filtered.slice(-6).map((r) => r.close);

    let trend = 0;
    if (closes.length >= 6) {
      const allUp   = closes.every((c, i) => i === 0 || c > closes[i - 1]);
      const allDown = closes.every((c, i) => i === 0 || c < closes[i - 1]);
      if (allUp)   trend =  1;
      else if (allDown) trend = -1;
    }

    const last30      = filtered.slice(-30);
    const closes30    = last30.map((r) => r.close);
    const dates30     = last30.map((r) => r.date);
    const daysOfWeek30 = last30.map((r) => r.dow);

    return Response.json({ trend, closes30, dates30, daysOfWeek30 });
  } catch (err) {
    console.error("Trend fetch error:", err);
    return Response.json({ trend: 0 });
  }
}

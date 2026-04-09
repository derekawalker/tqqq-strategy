import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export async function GET() {
  try {
    const result = await yf.chart("TQQQ", {
      period1: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      interval: "1d",
    });

    const closes = (result.quotes ?? [])
      .filter((q) => q.close != null)
      .map((q) => q.close as number)
      .slice(-6);

    let trend = 0;
    if (closes.length >= 6) {
      const allUp   = closes.every((c, i) => i === 0 || c > closes[i - 1]);
      const allDown = closes.every((c, i) => i === 0 || c < closes[i - 1]);
      if (allUp)   trend =  1;
      else if (allDown) trend = -1;
    }

    return Response.json({ trend });
  } catch (err) {
    console.error("Trend fetch error:", err);
    return Response.json({ trend: 0 });
  }
}

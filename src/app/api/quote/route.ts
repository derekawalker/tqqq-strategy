import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export async function GET() {
  try {
    const [quote, chartResult] = await Promise.all([
      yf.quote("TQQQ"),
      yf.chart("TQQQ", {
        period1: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        interval: "1d",
      }),
    ]);

    const {
      marketState,
      regularMarketPrice,
      regularMarketPreviousClose,
      postMarketPrice,
      preMarketPrice,
    } = quote;

    const previousClose = regularMarketPreviousClose;
    let price = regularMarketPrice;

    if (marketState === "POST" || marketState === "POSTPOST") {
      price = postMarketPrice ?? regularMarketPrice;
    } else if (marketState === "PRE" || marketState === "PREPRE") {
      price = preMarketPrice ?? regularMarketPrice;
    }

    if (price == null || previousClose == null) {
      return Response.json({ error: "Missing price data" }, { status: 502 });
    }

    const changePercent = ((price - previousClose) / previousClose) * 100;

    // Compute 3-day trend: 1 = 3 consecutive up days, -1 = 3 consecutive down days, 0 = mixed
    const closes = (chartResult.quotes ?? [])
      .filter((q) => q.close != null)
      .map((q) => q.close as number)
      .slice(-4); // need 4 closes to get 3 day-over-day comparisons
    let trend = 0;
    if (closes.length >= 4) {
      const allUp   = closes.every((c, i) => i === 0 || c > closes[i - 1]);
      const allDown = closes.every((c, i) => i === 0 || c < closes[i - 1]);
      if (allUp)   trend =  1;
      else if (allDown) trend = -1;
    }

    return Response.json({ price, changePercent, marketState, trend });
  } catch (err) {
    console.error("Yahoo Finance error:", err);
    return Response.json({ error: "Failed to fetch quote" }, { status: 502 });
  }
}

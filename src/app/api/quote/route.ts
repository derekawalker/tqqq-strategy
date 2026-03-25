import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export async function GET() {
  try {
    const quote = await yf.quote("TQQQ");

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

    return Response.json({ price, changePercent, marketState });
  } catch (err) {
    console.error("Yahoo Finance error:", err);
    return Response.json({ error: "Failed to fetch quote" }, { status: 502 });
  }
}

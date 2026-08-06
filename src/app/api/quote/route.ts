import YahooFinance from "yahoo-finance2";
import { getEquityMark } from "@/lib/tastytrade/quotes";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export async function GET(req: Request) {
  // Defaults to TQQQ so every existing caller is unaffected; the Hedge page
  // asks for QQQ, which is what its puts are written on.
  const symbol = new URL(req.url).searchParams.get("symbol") ?? "TQQQ";
  try {
    const quote = await yf.quote(symbol);

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

    // Outside regular market hours, run DXLink in parallel to get the live tastytrade price
    if (marketState !== "REGULAR") {
      const tastyPrice = await getEquityMark(symbol);
      if (tastyPrice != null && tastyPrice > 0) {
        price = tastyPrice;
      }
    }

    const changePercent = ((price - previousClose) / previousClose) * 100;

    return Response.json({ price, changePercent, marketState });
  } catch (err) {
    console.error("Yahoo Finance error:", err);
    return Response.json({ error: "Failed to fetch quote" }, { status: 502 });
  }
}

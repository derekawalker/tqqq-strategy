import YahooFinance from "yahoo-finance2";
import { getEquityMark } from "@/lib/tastytrade/quotes";
import { getCached, setCached } from "@/lib/ttlCache";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

interface QuotePayload {
  price: number;
  changePercent: number;
  marketState: string | undefined;
}

// Short enough that the header still reads live, long enough to collapse the
// burst when several pages ask for the same symbol on mount.
const QUOTE_TTL_MS = 10_000;

export async function GET(req: Request) {
  // Defaults to TQQQ so every existing caller is unaffected; the Hedge page
  // asks for QQQ, which is what its puts are written on.
  const symbol = new URL(req.url).searchParams.get("symbol") ?? "TQQQ";
  const cacheKey = `quote:${symbol}`;
  const cached = getCached<QuotePayload>(cacheKey, QUOTE_TTL_MS);
  if (cached) return Response.json(cached);

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

    // Outside regular market hours Yahoo's price goes stale, so fall back to a
    // live tastytrade mark.
    if (marketState !== "REGULAR") {
      const tastyPrice = await getEquityMark(symbol);
      if (tastyPrice != null && tastyPrice > 0) {
        price = tastyPrice;
      }
    }

    const changePercent = ((price - previousClose) / previousClose) * 100;

    const payload: QuotePayload = { price, changePercent, marketState };
    setCached(cacheKey, payload);
    return Response.json(payload);
  } catch (err) {
    console.error("Yahoo Finance error:", err);
    return Response.json({ error: "Failed to fetch quote" }, { status: 502 });
  }
}

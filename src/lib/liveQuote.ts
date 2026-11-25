/**
 * Live last price for a symbol, server-side. Yahoo's quote endpoint (not the
 * hourly-cached daily chart) with the extended-hours price picked by market
 * state; outside regular hours Yahoo's number goes stale, so a tastytrade
 * DXLink mark wins when one is available.
 */

import YahooFinance from "yahoo-finance2";
import { getEquityMark } from "@/lib/tastytrade/quotes";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface LiveQuote {
  price: number;
  previousClose: number;
  marketState: string | undefined;
}

export interface YahooQuoteFields {
  marketState?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  postMarketPrice?: number;
  preMarketPrice?: number;
}

/** Exported for testing — Yahoo's best price for the current session. */
export function sessionPrice(q: YahooQuoteFields): number | undefined {
  if (q.marketState === "POST" || q.marketState === "POSTPOST") return q.postMarketPrice ?? q.regularMarketPrice;
  if (q.marketState === "PRE" || q.marketState === "PREPRE") return q.preMarketPrice ?? q.regularMarketPrice;
  return q.regularMarketPrice;
}

/** Throws when Yahoo fails or returns no usable price. */
export async function getLiveQuote(symbol: string): Promise<LiveQuote> {
  const q = (await yf.quote(symbol)) as YahooQuoteFields;
  let price = sessionPrice(q);
  const previousClose = q.regularMarketPreviousClose;
  if (price == null || previousClose == null) throw new Error(`Missing price data for ${symbol}`);

  // Indices (^VXN etc.) aren't DXLink equity symbols — Yahoo is all there is.
  if (q.marketState !== "REGULAR" && !symbol.startsWith("^")) {
    const mark = await getEquityMark(symbol);
    if (mark != null && mark > 0) price = mark;
  }
  return { price, previousClose, marketState: q.marketState };
}

/**
 * Live QQQ put-chain for hedge sizing.
 *
 * GET → the OTM put quotes for the expiry nearest the hedge DTE, pulled from
 * Schwab. When the user isn't connected (or Schwab errors), responds
 * `{ connected: false }` with 200 so the client silently falls back to the
 * Black-Scholes model instead of surfacing an error.
 */

import { getPutChain, pickExpiry } from "@/lib/schwab/optionChain";
import { HEDGE_DTE } from "@/lib/hedgeTranches";

export async function GET() {
  try {
    const quotes = await getPutChain("QQQ", HEDGE_DTE);
    const expiry = pickExpiry(quotes, HEDGE_DTE);
    if (!expiry) {
      return Response.json({ connected: true, expiry: null, quotes: [] });
    }
    // Only the chosen expiry's quotable strikes are needed to size the tranches.
    const forExpiry = quotes.filter((q) => q.expiry === expiry && q.mark > 0);
    return Response.json({
      connected: true,
      asOf: new Date().toISOString(),
      expiry,
      quotes: forExpiry,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "chain fetch failed";
    // Not connected is the expected, quiet case — fall back to the model.
    if (message.includes("Not authenticated")) {
      return Response.json({ connected: false });
    }
    return Response.json({ connected: false, error: message });
  }
}

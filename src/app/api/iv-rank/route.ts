/**
 * IV rank — data endpoint.
 *
 * GET → current ^VXN level plus its percentile rank within the trailing
 * year of sessions, so the Options page can size premium selling by vol
 * richness instead of just direction.
 */

import { fetchYahooDaily } from "@/lib/yahoo";
import { percentileRank } from "@/lib/ivRank";

export async function GET() {
  try {
    // 2y gives a full trailing-252-session window with room to spare even
    // accounting for market holidays.
    const vxnBars = await fetchYahooDaily("^VXN", 2);
    if (vxnBars.length < 20) {
      return Response.json({ error: "Not enough ^VXN history" }, { status: 502 });
    }

    const closes = vxnBars.map((b) => b.close);
    const ivRank = percentileRank(closes, 252);

    return Response.json({
      vxnPct: closes.at(-1) ?? null,
      ivRank,
      asOf: vxnBars.at(-1)?.date ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch IV rank";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Put-hedge market data.
 *
 * GET → current TQQQ price + ^VXN level, for sizing the hedge buy plan.
 */

import { fetchYahooDaily } from "@/lib/yahoo";

export async function GET() {
  try {
    const [tqqq, vxn] = await Promise.all([
      fetchYahooDaily("TQQQ", 1),
      fetchYahooDaily("^VXN", 1),
    ]);
    return Response.json({
      tqqqPrice: tqqq.at(-1)?.close ?? null,
      vxnPct: vxn.at(-1)?.close ?? null,
      asOf: tqqq.at(-1)?.date ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch market data";
    return Response.json({ error: message }, { status: 500 });
  }
}

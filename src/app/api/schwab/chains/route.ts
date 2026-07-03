/**
 * Listed option strikes for a symbol, at the expiry nearest a target DTE —
 * lets the Options page snap its modeled $0.50-grid strikes to real
 * tradable contracts (TQQQ lists $1 strikes in some price bands).
 */

import { getListedStrikes } from "@/lib/schwab/chains";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? "TQQQ";
  const targetDte = Number(searchParams.get("targetDte") ?? "7");

  if (process.env.DEMO_MODE === "true") {
    return Response.json({ strikes: [] });
  }

  try {
    const strikes = await getListedStrikes(symbol, targetDte);
    return Response.json({ strikes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch option chain";
    return Response.json({ error: message }, { status: 500 });
  }
}

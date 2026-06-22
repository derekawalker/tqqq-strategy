import { getBarStats, syncBars, todayET } from "@/lib/polygon";

/**
 * GET  — returns current sync status (bar count, date range, whether synced today).
 * POST — triggers an incremental pull from Polygon and upserts into tqqq_bars.
 *        Pass { force: true } in the body to bypass the once-per-day guard (needed
 *        for the initial full-history pull when the table is empty).
 */
export async function GET() {
  try {
    const { count, maxT } = await getBarStats();
    const lastDate = maxT ? new Date(maxT).toISOString() : null;
    const syncedToday = maxT
      ? new Date(maxT).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === todayET()
      : false;
    return Response.json({ count, lastDate, syncedToday });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const force = body.force === true;
    const result = await syncBars(force);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const status = message.includes("POLYGON_API_KEY") ? 501
      : message.includes("rate limit") ? 429
      : 500;
    return Response.json({ error: message }, { status });
  }
}

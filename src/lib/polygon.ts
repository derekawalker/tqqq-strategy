/**
 * Polygon.io market-data client + Supabase persistence for TQQQ 5-min bars.
 *
 * Strategy:
 *  - Initial sync: pull all bars from TQQQ's 2010-02-11 inception date through today,
 *    paging through Polygon's next_url chain, and upsert into the `tqqq_bars` table.
 *  - Incremental sync: find max(t) in the table, pull from that date forward. Polygon
 *    upsert is idempotent (primary key on t), so overlapping a day is safe.
 *  - Once-per-day guard: the sync route stores the last sync date (ET calendar day)
 *    in the settings table and rejects repeat calls on the same market day.
 *  - In-process cache: after the first Supabase read per server instance, bars are
 *    cached for 4 hours so repeated backtest runs don't re-query the full table.
 */

import { createClient } from "@supabase/supabase-js";
import { getCached, setCached } from "./ttlCache";
import type { SimBar } from "./intradayBacktest";

const TQQQ_INCEPTION = "2010-02-11";
const CACHE_KEY = "polygon_tqqq_bars";
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function apiKey(): string {
  const k = process.env.POLYGON_API_KEY;
  if (!k) throw new Error("POLYGON_API_KEY is not set");
  return k;
}

export interface PolygonBar {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Today's date in Eastern time as YYYY-MM-DD. */
export function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ─── Polygon API ─────────────────────────────────────────────────────────────

/**
 * Fetch one page of 5-min bars from Polygon and return bars + the next page URL
 * (with apiKey already appended). Callers page through themselves so they can
 * upsert after each page and survive rate-limit interruptions.
 */
export async function fetchPolygonPage(url: string): Promise<{ bars: PolygonBar[]; nextUrl: string | null }> {
  const key = apiKey();
  const httpRes = await fetch(url);
  if (httpRes.status === 429) throw new Error("Polygon rate limit hit — wait a minute and try again");
  if (!httpRes.ok) throw new Error(`Polygon ${httpRes.status}: ${(await httpRes.text()).slice(0, 200)}`);
  const body = await httpRes.json() as { results?: PolygonBar[]; next_url?: string };
  return {
    bars: Array.isArray(body.results) ? body.results : [],
    nextUrl: body.next_url ? `${body.next_url}&apiKey=${key}` : null,
  };
}

export function polygonFirstUrl(ticker: string, from: string, to: string): string {
  const key = apiKey();
  return (
    `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/5/minute/${from}/${to}` +
    `?adjusted=true&sort=asc&limit=50000&apiKey=${key}`
  );
}

// ─── Supabase persistence ─────────────────────────────────────────────────────

/** Upsert bars into tqqq_bars. Returns the number of rows affected. */
async function upsertBars(bars: PolygonBar[]): Promise<number> {
  if (bars.length === 0) return 0;
  const CHUNK = 5000; // Supabase upsert works best in chunks
  let total = 0;
  for (let i = 0; i < bars.length; i += CHUNK) {
    const chunk = bars.slice(i, i + CHUNK).map((b) => ({
      t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
    }));
    const { error } = await sb().from("tqqq_bars").upsert(chunk, { onConflict: "t" });
    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
    total += chunk.length;
  }
  // Bust the in-process cache so the next backtest sees fresh data.
  setCached(CACHE_KEY, null);
  return total;
}

/** Max t in the table (null if empty). */
async function getMaxT(): Promise<number | null> {
  const { data, error } = await sb()
    .from("tqqq_bars")
    .select("t")
    .order("t", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return data.t as number;
}

/** Bar count and max t for the status endpoint. */
export async function getBarStats(): Promise<{ count: number; maxT: number | null }> {
  const [countRes, maxRes] = await Promise.all([
    sb().from("tqqq_bars").select("*", { count: "exact", head: true }),
    getMaxT(),
  ]);
  return { count: countRes.count ?? 0, maxT: maxRes };
}

/**
 * Incremental sync: pull bars since the last stored bar (or from inception),
 * upsert, and return stats. Guarded against running more than once per ET
 * calendar day — pass `force = true` to bypass for the initial full pull.
 */
export async function syncBars(force = false): Promise<{
  skipped: boolean;
  reason?: string;
  added: number;
  maxT: number | null;
}> {
  const maxT = await getMaxT();
  const today = todayET();

  if (!force && maxT) {
    // Check last sync date stored in settings.
    const { data } = await sb()
      .from("settings")
      .select("value")
      .eq("key", "polygonLastSync")
      .single();
    const lastSync = data?.value as string | undefined;
    if (lastSync === today) {
      return { skipped: true, reason: "Already synced today", added: 0, maxT };
    }
  }

  // Pull from last bar's date (inclusive — upsert handles duplicates) or inception.
  const from = maxT
    ? new Date(maxT).toLocaleDateString("en-CA", { timeZone: "America/New_York" })
    : TQQQ_INCEPTION;

  // Page through Polygon, upserting after each page so progress survives
  // a rate-limit interruption. Re-syncing will continue from the last saved bar.
  let url: string | null = polygonFirstUrl("TQQQ", from, today);
  let added = 0;
  let lastT = maxT;
  while (url) {
    const { bars, nextUrl } = await fetchPolygonPage(url);
    if (bars.length > 0) {
      added += await upsertBars(bars);
      lastT = bars[bars.length - 1].t;
    }
    url = nextUrl;
  }

  // Record today as the last sync date so we don't pull again until tomorrow.
  await sb().from("settings").upsert({ key: "polygonLastSync", value: today });

  return { skipped: false, added, maxT: lastT };
}

// ─── Bar reads for the backtest ───────────────────────────────────────────────

/** All stored bars as SimBars, cached in-process for 4 hours. */
export async function getStoredSimBars(): Promise<SimBar[]> {
  const cached = getCached<SimBar[]>(CACHE_KEY, CACHE_TTL);
  if (cached && cached.length > 0) return cached;

  // Pull all rows. setLimit high enough to clear the default 1000-row cap.
  const { data, error } = await sb()
    .from("tqqq_bars")
    .select("t,o,h,l,c")
    .order("t", { ascending: true })
    .limit(1_000_000);

  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  if (!data || data.length === 0) return [];

  const bars: SimBar[] = (data as { t: number; o: number; h: number; l: number; c: number }[]).map(
    (r) => ({ date: new Date(r.t).toISOString(), close: r.c, high: r.h, low: r.l }),
  );
  setCached(CACHE_KEY, bars);
  return bars;
}

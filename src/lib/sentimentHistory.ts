import { createClient } from "@supabase/supabase-js";
import YahooFinance from "yahoo-finance2";
import type { VerdictPayload } from "@/app/api/sentiment/route";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Migration for adding magnitude-model output to existing tables:
//
//   alter table public.sentiment_verdict_history
//     add column if not exists predicted_return_5d numeric;
//
// Required Supabase table (run once in the SQL editor):
//
//   create table public.sentiment_verdict_history (
//     date date primary key,
//     verdict text not null,
//     expected_return_5d numeric not null,
//     predicted_return_5d numeric,
//     edge numeric not null,
//     agreement_up int not null,
//     agreement_down int not null,
//     agreement_neutral int not null,
//     signals jsonb not null,
//     qqq_close numeric,
//     tqqq_close numeric,
//     realized_return_5d_qqq numeric,
//     realized_return_5d_tqqq numeric,
//     created_at timestamptz not null default now(),
//     updated_at timestamptz not null default now(),
//     realized_at timestamptz
//   );

function supabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export interface HistoryRow {
  date: string;
  verdict: VerdictPayload["verdict"];
  expectedReturn5d: number;
  predictedReturn5d: number | null;
  edge: number;
  qqqClose: number | null;
  tqqqClose: number | null;
  realizedReturn5dQqq: number | null;
  realizedReturn5dTqqq: number | null;
}

export interface AccuracyStats {
  totalCalls: number;
  realizedCalls: number;
  // Magnitude-model performance over realized calls (all verdicts pooled)
  predictionMae: number | null;     // mean abs error of predictedReturn5d vs realized
  predictionBias: number | null;    // mean(predicted - realized) — positive = bullish-biased
  predictionPearson: number | null; // pearson(predicted, realized)
  byVerdict: Record<VerdictPayload["verdict"], {
    n: number;
    avgPredicted: number;
    avgRealizedQqq: number;
    avgRealizedTqqq: number;
    hitRateQqq: number;          // % of cases where realized direction matched verdict direction
  }>;
}

// ── helpers ────────────────────────────────────────────────────────────────

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchClosesByDate(symbol: string, days: number): Promise<Map<string, number>> {
  const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await yf.chart(symbol, { period1, interval: "1d" });
  const map = new Map<string, number>();
  for (const q of result.quotes) {
    if (q.close == null || q.date == null) continue;
    map.set(toDateKey(q.date as Date), q.close);
  }
  return map;
}

// ── snapshot ───────────────────────────────────────────────────────────────

export async function snapshotVerdict(payload: VerdictPayload): Promise<void> {
  // Use the latest available trading-day close as the snapshot date so weekend/holiday visits
  // don't create rows we can't backfill against.
  let qqq: Map<string, number>, tqqq: Map<string, number>;
  try {
    [qqq, tqqq] = await Promise.all([
      fetchClosesByDate("QQQ", 10),
      fetchClosesByDate("TQQQ", 10),
    ]);
  } catch {
    return;  // network hiccup; skip silently rather than break the page
  }

  if (qqq.size === 0) return;
  const lastTradingDay = [...qqq.keys()].sort().at(-1)!;
  const qqqClose = qqq.get(lastTradingDay) ?? null;
  const tqqqClose = tqqq.get(lastTradingDay) ?? null;

  const row = {
    date: lastTradingDay,
    verdict: payload.verdict,
    expected_return_5d: payload.expectedReturn5d,
    predicted_return_5d: payload.predictedReturn5d,
    edge: payload.edge,
    agreement_up: payload.agreement.up,
    agreement_down: payload.agreement.down,
    agreement_neutral: payload.agreement.neutral,
    signals: payload.signals,
    qqq_close: qqqClose,
    tqqq_close: tqqqClose,
    updated_at: new Date().toISOString(),
  };

  await supabase()
    .from("sentiment_verdict_history")
    .upsert(row, { onConflict: "date" });
}

// ── backfill ───────────────────────────────────────────────────────────────

const FORWARD_DAYS = 5;

export async function backfillRealizedReturns(): Promise<number> {
  const { data: pending } = await supabase()
    .from("sentiment_verdict_history")
    .select("date, qqq_close, tqqq_close, realized_return_5d_qqq")
    .is("realized_return_5d_qqq", null)
    .order("date", { ascending: true })
    .limit(60);

  if (!pending || pending.length === 0) return 0;

  // Fetch enough history to cover the oldest pending date + 7d for safety
  const oldest = pending[0].date as string;
  const daysBack = Math.ceil((Date.now() - new Date(oldest).getTime()) / 86_400_000) + 14;
  const [qqq, tqqq] = await Promise.all([
    fetchClosesByDate("QQQ",  daysBack),
    fetchClosesByDate("TQQQ", daysBack),
  ]);

  const tradingDays = [...qqq.keys()].sort();
  const dayIndex = new Map(tradingDays.map((d, i) => [d, i]));

  let updated = 0;
  for (const row of pending) {
    const date = row.date as string;
    const startIdx = dayIndex.get(date);
    if (startIdx == null) continue;
    const endIdx = startIdx + FORWARD_DAYS;
    if (endIdx >= tradingDays.length) continue;  // not enough forward data yet
    const endDate = tradingDays[endIdx];
    const startQqq = row.qqq_close as number | null;
    const startTqqq = row.tqqq_close as number | null;
    const endQqq = qqq.get(endDate) ?? null;
    const endTqqq = tqqq.get(endDate) ?? null;

    const realizedQqq = startQqq && endQqq ? ((endQqq - startQqq) / startQqq) * 100 : null;
    const realizedTqqq = startTqqq && endTqqq ? ((endTqqq - startTqqq) / startTqqq) * 100 : null;

    if (realizedQqq == null) continue;

    await supabase()
      .from("sentiment_verdict_history")
      .update({
        realized_return_5d_qqq: Math.round(realizedQqq * 1000) / 1000,
        realized_return_5d_tqqq: realizedTqqq != null ? Math.round(realizedTqqq * 1000) / 1000 : null,
        realized_at: new Date().toISOString(),
      })
      .eq("date", date);
    updated++;
  }
  return updated;
}

// ── load + stats ───────────────────────────────────────────────────────────

export async function loadRecentHistory(limit = 120): Promise<HistoryRow[]> {
  const { data } = await supabase()
    .from("sentiment_verdict_history")
    .select("date, verdict, expected_return_5d, predicted_return_5d, edge, qqq_close, tqqq_close, realized_return_5d_qqq, realized_return_5d_tqqq")
    .order("date", { ascending: false })
    .limit(limit);

  if (!data) return [];
  return data.map((r) => ({
    date: r.date as string,
    verdict: r.verdict as VerdictPayload["verdict"],
    expectedReturn5d: r.expected_return_5d as number,
    predictedReturn5d: (r.predicted_return_5d as number | null) ?? null,
    edge: r.edge as number,
    qqqClose: r.qqq_close as number | null,
    tqqqClose: r.tqqq_close as number | null,
    realizedReturn5dQqq: r.realized_return_5d_qqq as number | null,
    realizedReturn5dTqqq: r.realized_return_5d_tqqq as number | null,
  }));
}

export function computeAccuracy(history: HistoryRow[]): AccuracyStats {
  const verdicts: VerdictPayload["verdict"][] = ["lean-long", "lean-short", "chop"];
  const stats: AccuracyStats = {
    totalCalls: history.length,
    realizedCalls: 0,
    predictionMae: null,
    predictionBias: null,
    predictionPearson: null,
    byVerdict: {
      "lean-long":  { n: 0, avgPredicted: 0, avgRealizedQqq: 0, avgRealizedTqqq: 0, hitRateQqq: 0 },
      "lean-short": { n: 0, avgPredicted: 0, avgRealizedQqq: 0, avgRealizedTqqq: 0, hitRateQqq: 0 },
      "chop":       { n: 0, avgPredicted: 0, avgRealizedQqq: 0, avgRealizedTqqq: 0, hitRateQqq: 0 },
    },
  };

  for (const v of verdicts) {
    const rows = history.filter((h) => h.verdict === v && h.realizedReturn5dQqq != null);
    if (rows.length === 0) continue;
    stats.realizedCalls += rows.length;
    const avgPredicted = rows.reduce((s, r) => s + r.expectedReturn5d, 0) / rows.length;
    const avgRealizedQqq = rows.reduce((s, r) => s + (r.realizedReturn5dQqq as number), 0) / rows.length;
    const avgRealizedTqqq = rows
      .filter((r) => r.realizedReturn5dTqqq != null)
      .reduce((s, r, _, arr) => s + (r.realizedReturn5dTqqq as number) / arr.length, 0);
    const hits = rows.filter((r) => {
      const rr = r.realizedReturn5dQqq as number;
      if (v === "lean-long") return rr > 1.5;    // hit = actually went up >1.5%
      if (v === "lean-short") return rr < -1.5;  // hit = actually went down >1.5%
      return Math.abs(rr) <= 1.5;                // hit = stayed within ±1.5%
    }).length;

    stats.byVerdict[v] = {
      n: rows.length,
      avgPredicted: Math.round(avgPredicted * 1000) / 1000,
      avgRealizedQqq: Math.round(avgRealizedQqq * 1000) / 1000,
      avgRealizedTqqq: Math.round(avgRealizedTqqq * 1000) / 1000,
      hitRateQqq: Math.round((hits / rows.length) * 1000) / 10,
    };
  }

  // Magnitude-model performance (pooled across all verdicts)
  const realized = history.filter(
    (h) => h.predictedReturn5d != null && h.realizedReturn5dQqq != null,
  );
  if (realized.length > 0) {
    const errs = realized.map((r) => (r.predictedReturn5d as number) - (r.realizedReturn5dQqq as number));
    const mae = errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length;
    const bias = errs.reduce((s, e) => s + e, 0) / errs.length;
    stats.predictionMae = Math.round(mae * 1000) / 1000;
    stats.predictionBias = Math.round(bias * 1000) / 1000;
    if (realized.length >= 3) {
      const xs = realized.map((r) => r.predictedReturn5d as number);
      const ys = realized.map((r) => r.realizedReturn5dQqq as number);
      const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
      const my = ys.reduce((s, v) => s + v, 0) / ys.length;
      let num = 0, dx2 = 0, dy2 = 0;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my;
        num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
      }
      const denom = Math.sqrt(dx2 * dy2);
      stats.predictionPearson = denom > 0 ? Math.round((num / denom) * 10000) / 10000 : null;
    }
  }

  return stats;
}

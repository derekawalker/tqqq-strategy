/**
 * Backfills sentiment_verdict_history with historically computed verdicts.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/backfill-history.ts
 *   npx tsx --env-file=.env.local scripts/backfill-history.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-history.ts --years 3
 *
 * Uses today's signal-stats.json bins to classify each past trading day —
 * technically look-ahead bias, but fine for personal tracking since it's
 * the same data the live signal uses.
 */

import { createClient } from "@supabase/supabase-js";
import YahooFinance from "yahoo-finance2";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── config ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const YEARS = (() => {
  const i = args.indexOf("--years");
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : 2;
})();
const FORWARD_DAYS = 5;

// ── env + clients ──────────────────────────────────────────────────────────

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, key);
}

// ── load signal stats ──────────────────────────────────────────────────────

type StatBin = { label: string; count: number; avgReturn5d: number; hitRateUp: number; lowConfidence: boolean };
type SignalKey = "vixTerm" | "vixSpike" | "rsi2InTrend" | "pctAbove200ma" | "realizedVol20Pct" | "hygSpyDiv";
type Stats = {
  baselineAvgReturn5d: number;
  yearsHistory: number;
  totalSamples: number;
  signals: Record<SignalKey, StatBin[]>;
};

const STATS: Stats = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/signal-stats.json"), "utf8")
);

function lookup(sk: SignalKey, binLabel: string | null): StatBin | null {
  if (!binLabel) return null;
  return STATS.signals[sk].find((b) => b.label === binLabel) ?? null;
}

// ── bin classifiers (mirrors route.ts) ────────────────────────────────────

function vixTermBin(v: number): string {
  if (v < 0.90) return "<0.90 (deep contango)";
  if (v < 0.95) return "0.90 – 0.95";
  if (v < 1.00) return "0.95 – 1.00";
  if (v < 1.05) return "1.00 – 1.05";
  return ">1.05 (backwardation)";
}

function vixSpikeBin(v: number): string {
  if (v < -10) return "<-10%";
  if (v < 0)   return "-10% – 0%";
  if (v < 5)   return "0% – 5%";
  if (v < 15)  return "5% – 15%";
  return ">15% (spike)";
}

function rsi2Bin(rsi2: number | null, inUptrend: boolean): string | null {
  if (!inUptrend) return "Downtrend (any RSI)";
  if (rsi2 == null) return null;
  if (rsi2 < 10) return "Uptrend, RSI(2) <10 (oversold)";
  if (rsi2 > 90) return "Uptrend, RSI(2) >90 (overbought)";
  return "Uptrend, RSI(2) 10–90";
}

function pctAbove200maBin(pct: number): string {
  if (pct < -3) return "<-3% (below MA)";
  if (pct < 0)  return "-3% – 0%";
  if (pct < 5)  return "0% – 5% (just above)";
  if (pct < 10) return "5% – 10%";
  return ">10% (extended)";
}

function realizedVol20PctBin(pct: number): string {
  if (pct < 15) return "<15 (very calm)";
  if (pct < 40) return "15 – 40";
  if (pct < 70) return "40 – 70 (typical)";
  if (pct < 90) return "70 – 90";
  return ">90 (very high)";
}

function hygSpyDivBin(v: number): string {
  if (v < -1.5) return "<-1.5% (credit lagging)";
  if (v < -0.5) return "-1.5% – -0.5%";
  if (v < 0.5)  return "-0.5% – 0.5%";
  if (v < 1.5)  return "0.5% – 1.5%";
  return ">1.5% (credit leading)";
}

// ── indicator math ─────────────────────────────────────────────────────────

function rsi(closes: number[], idx: number, period: number): number | null {
  if (idx < period) return null;
  let gain = 0, loss = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss += Math.abs(diff);
  }
  gain /= period;
  loss /= period;
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function sma(closes: number[], idx: number, period: number): number | null {
  if (idx < period - 1) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += closes[i];
  return sum / period;
}

function stdev(xs: number[]) {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

// ── verdict builder (mirrors route.ts) ────────────────────────────────────

interface SignalReading {
  key: SignalKey;
  name: string;
  binLabel: string | null;
  avgReturn5d: number | null;
  hitRateUp: number | null;
  sampleCount: number;
  lowConfidence: boolean;
  vsBaseline: number | null;
}

function buildReading(key: SignalKey, name: string, binLabel: string | null): SignalReading {
  const stat = lookup(key, binLabel);
  return {
    key, name, binLabel,
    avgReturn5d: stat?.avgReturn5d ?? null,
    hitRateUp: stat?.hitRateUp ?? null,
    sampleCount: stat?.count ?? 0,
    lowConfidence: stat?.lowConfidence ?? false,
    vsBaseline: stat ? Math.round((stat.avgReturn5d - STATS.baselineAvgReturn5d) * 1000) / 1000 : null,
  };
}

const STRONG_EDGE = 0.3;

function buildVerdict(signals: SignalReading[]) {
  const usable = signals.filter((s) => s.avgReturn5d != null && !s.lowConfidence);
  let weightedReturn = 0, totalWeight = 0;
  let up = 0, down = 0, neutral = 0;
  for (const s of usable) {
    const w = Math.min(s.sampleCount, 200);
    weightedReturn += (s.avgReturn5d as number) * w;
    totalWeight += w;
    const edge = (s.avgReturn5d as number) - STATS.baselineAvgReturn5d;
    if (edge > STRONG_EDGE) up++;
    else if (edge < -STRONG_EDGE) down++;
    else neutral++;
  }
  const expectedReturn5d = totalWeight > 0 ? weightedReturn / totalWeight : STATS.baselineAvgReturn5d;
  const edge = expectedReturn5d - STATS.baselineAvgReturn5d;

  // Bearish signal clusters historically fired into bounces — treat as mean-reversion long.
  let verdict: "lean-long" | "lean-short" | "chop" = "chop";
  if (up >= 2 && down <= 1) verdict = "lean-long";
  else if (down >= 2 && up <= 1) verdict = "lean-long";

  return {
    verdict,
    expectedReturn5d: Math.round(expectedReturn5d * 1000) / 1000,
    edge: Math.round(edge * 1000) / 1000,
    agreement: { up, down, neutral },
  };
}

// ── data fetch ─────────────────────────────────────────────────────────────

type Series = { date: string; close: number }[];

async function fetchDaily(symbol: string, years: number): Promise<Series> {
  // Extra year to ensure 200d MA has enough warm-up data
  const period1 = new Date(Date.now() - (years + 1) * 365 * 24 * 60 * 60 * 1000);
  const result = await yf.chart(symbol, { period1, interval: "1d" });
  return result.quotes
    .filter((q) => q.close != null && q.date != null)
    .map((q) => ({
      date: (q.date as Date).toISOString().slice(0, 10),
      close: q.close as number,
    }));
}

function alignByDate(series: Record<string, Series>): { date: string; values: Record<string, number> }[] {
  const maps = Object.fromEntries(
    Object.entries(series).map(([k, s]) => [k, new Map(s.map((d) => [d.date, d.close]))])
  );
  const sets = Object.values(maps).map((m) => new Set(m.keys()));
  const common = [...sets[0]].filter((d) => sets.every((s) => s.has(d))).sort();
  return common.map((date) => ({
    date,
    values: Object.fromEntries(Object.keys(series).map((k) => [k, maps[k].get(date) as number])),
  }));
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Backfilling ${YEARS}y of history${DRY_RUN ? " [DRY RUN — no writes]" : ""}...`);

  console.log("Fetching price data...");
  const [qqq, vix, vix3m, hyg, spy, tqqq] = await Promise.all([
    fetchDaily("QQQ",    YEARS),
    fetchDaily("^VIX",   YEARS),
    fetchDaily("^VIX3M", YEARS),
    fetchDaily("HYG",    YEARS),
    fetchDaily("SPY",    YEARS),
    fetchDaily("TQQQ",   YEARS),
  ]);

  const aligned = alignByDate({ QQQ: qqq, VIX: vix, VIX3M: vix3m, HYG: hyg, SPY: spy });
  // TQQQ may not share all dates with the others (e.g. index rebalance days), so look it up separately
  const tqqqMap = new Map(tqqq.map((d) => [d.date, d.close]));

  console.log(`Aligned: ${aligned.length} common trading days`);

  // Need 252d for vol-percentile warm-up (which subsumes 200d MA + 20d vol); FORWARD_DAYS forward for realized returns
  const start = 252;

  type Row = {
    date: string;
    verdict: string;
    expected_return_5d: number;
    edge: number;
    agreement_up: number;
    agreement_down: number;
    agreement_neutral: number;
    signals: SignalReading[];
    qqq_close: number;
    tqqq_close: number | null;
    realized_return_5d_qqq: number | null;
    realized_return_5d_tqqq: number | null;
    realized_at: string | null;
    updated_at: string;
  };

  const rows: Row[] = [];
  const qqqCloses = aligned.map((d) => d.values.QQQ);
  const vixCloses = aligned.map((d) => d.values.VIX);
  const vix3mCloses = aligned.map((d) => d.values.VIX3M);
  const hygCloses = aligned.map((d) => d.values.HYG);
  const spyCloses = aligned.map((d) => d.values.SPY);

  // Pre-compute 20d realized vol (annualized %) for percentile calc
  const realizedVol20: (number | null)[] = qqqCloses.map((_, i) => {
    if (i < 20) return null;
    const rets: number[] = [];
    for (let j = i - 19; j <= i; j++) rets.push((qqqCloses[j] - qqqCloses[j - 1]) / qqqCloses[j - 1]);
    return stdev(rets) * Math.sqrt(252) * 100;
  });

  for (let i = start; i < aligned.length; i++) {
    const { date, values } = aligned[i];

    // VIX term structure
    const term = vixCloses[i] / vix3mCloses[i];

    // VIX 1-day spike
    const spike = ((vixCloses[i] - vixCloses[i - 1]) / vixCloses[i - 1]) * 100;

    // 200d MA & trend
    const ma200 = sma(qqqCloses, i, 200);
    const pctAbove = ma200 != null ? ((values.QQQ / ma200) - 1) * 100 : null;
    const inUptrend = ma200 != null && values.QQQ > ma200;

    // RSI(2)
    const rsi2 = rsi(qqqCloses, i, 2);

    // 20d realized vol percentile vs trailing 252d
    let rvPct: number | null = null;
    const curRv = realizedVol20[i];
    if (curRv != null) {
      const window: number[] = [];
      for (let j = i - 251; j <= i; j++) {
        const v = realizedVol20[j];
        if (v != null) window.push(v);
      }
      if (window.length > 50) {
        const sorted = [...window].sort((a, b) => a - b);
        const rank = sorted.filter((x) => x <= curRv).length;
        rvPct = (rank / sorted.length) * 100;
      }
    }

    // HYG − SPY 5d divergence
    const hyg5d = ((hygCloses[i] - hygCloses[i - 5]) / hygCloses[i - 5]) * 100;
    const spy5d = ((spyCloses[i] - spyCloses[i - 5]) / spyCloses[i - 5]) * 100;
    const hygDiv = hyg5d - spy5d;

    const signals: SignalReading[] = [
      buildReading("vixTerm",          "VIX / VIX3M",        vixTermBin(term)),
      buildReading("vixSpike",         "VIX 1-day change",   vixSpikeBin(spike)),
      buildReading("pctAbove200ma",    "QQQ vs 200d MA",     pctAbove != null ? pctAbove200maBin(pctAbove) : null),
      buildReading("realizedVol20Pct", "20d vol percentile", rvPct != null ? realizedVol20PctBin(rvPct) : null),
      buildReading("rsi2InTrend",      "RSI(2) + trend",     ma200 != null ? rsi2Bin(rsi2, inUptrend) : null),
      buildReading("hygSpyDiv",        "HYG − SPY (5d)",     hygSpyDivBin(hygDiv)),
    ];

    const { verdict, expectedReturn5d, edge, agreement } = buildVerdict(signals);

    // Realized returns — only if we have FORWARD_DAYS of data ahead
    let realizedQqq: number | null = null;
    let realizedTqqq: number | null = null;
    let realizedAt: string | null = null;

    if (i + FORWARD_DAYS < aligned.length) {
      const fwdDate = aligned[i + FORWARD_DAYS].date;
      const fwdQqq = aligned[i + FORWARD_DAYS].values.QQQ;
      realizedQqq = Math.round(((fwdQqq - values.QQQ) / values.QQQ) * 100 * 1000) / 1000;

      const fwdTqqq = tqqqMap.get(fwdDate) ?? null;
      const curTqqq = tqqqMap.get(date) ?? null;
      if (fwdTqqq != null && curTqqq != null) {
        realizedTqqq = Math.round(((fwdTqqq - curTqqq) / curTqqq) * 100 * 1000) / 1000;
      }
      realizedAt = new Date().toISOString();
    }

    rows.push({
      date,
      verdict,
      expected_return_5d: expectedReturn5d,
      edge,
      agreement_up: agreement.up,
      agreement_down: agreement.down,
      agreement_neutral: agreement.neutral,
      signals,
      qqq_close: values.QQQ,
      tqqq_close: tqqqMap.get(date) ?? null,
      realized_return_5d_qqq: realizedQqq,
      realized_return_5d_tqqq: realizedTqqq,
      realized_at: realizedAt,
      updated_at: new Date().toISOString(),
    });
  }

  // Filter to only the requested date range (warm-up dates are excluded)
  const cutoff = new Date(Date.now() - YEARS * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const filtered = rows.filter((r) => r.date >= cutoff);

  console.log(`Generated ${filtered.length} rows (from ${filtered[0]?.date} to ${filtered.at(-1)?.date})`);

  // Verdict distribution + hit-rate summary
  const counts = { "lean-long": 0, "lean-short": 0, chop: 0 } as Record<string, number>;
  const hits = { "lean-long": 0, "lean-short": 0, chop: 0 } as Record<string, number>;
  const realizedCount = { "lean-long": 0, "lean-short": 0, chop: 0 } as Record<string, number>;
  for (const r of filtered) {
    counts[r.verdict]++;
    if (r.realized_return_5d_qqq != null) {
      realizedCount[r.verdict]++;
      const rr = r.realized_return_5d_qqq;
      if (r.verdict === "lean-long" && rr > 0) hits[r.verdict]++;
      else if (r.verdict === "lean-short" && rr < 0) hits[r.verdict]++;
      else if (r.verdict === "chop" && Math.abs(rr) < 1) hits[r.verdict]++;
    }
  }
  console.log(`\nVerdict distribution:`);
  for (const v of ["lean-long", "lean-short", "chop"]) {
    const n = counts[v], rN = realizedCount[v], h = hits[v];
    const pct = ((n / filtered.length) * 100).toFixed(1);
    const hr = rN > 0 ? ((h / rN) * 100).toFixed(0) : "—";
    console.log(`  ${v.padEnd(11)} n=${String(n).padStart(3)} (${pct}%)   hit-rate=${hr}% (${h}/${rN} realized)`);
  }

  if (DRY_RUN) {
    console.log("\nSample rows (first 3):");
    for (const r of filtered.slice(0, 3)) {
      console.log(`  ${r.date}  ${r.verdict.padEnd(12)}  edge=${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(3)}%  realized=${r.realized_return_5d_qqq != null ? (r.realized_return_5d_qqq >= 0 ? "+" : "") + r.realized_return_5d_qqq.toFixed(2) + "%" : "pending"}`);
    }
    console.log("\nDry run complete — no rows written.");
    return;
  }

  // Upsert in batches of 100
  const db = supabase();
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < filtered.length; i += BATCH) {
    const batch = filtered.slice(i, i + BATCH);
    const { error } = await db
      .from("sentiment_verdict_history")
      .upsert(batch, { onConflict: "date" });
    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
    inserted += batch.length;
    process.stdout.write(`\rUpserted ${inserted} / ${filtered.length} rows...`);
  }

  console.log(`\nDone. ${inserted} rows written to sentiment_verdict_history.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

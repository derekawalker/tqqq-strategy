import YahooFinance from "yahoo-finance2";
import statsData from "@/data/signal-stats.json";
import {
  snapshotVerdict,
  backfillRealizedReturns,
  loadRecentHistory,
  computeAccuracy,
  type AccuracyStats,
  type HistoryRow,
} from "@/lib/sentimentHistory";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// ── types ──────────────────────────────────────────────────────────────────

export type SignalKey = "vixTerm" | "vixSpike" | "rsi2InTrend" | "pctAbove200ma" | "realizedVol20Pct" | "hygSpyDiv" | "tnxMom20" | "tltMom20";

export interface SignalReading {
  key: SignalKey;
  name: string;
  current: number | null;        // current raw value (null if unavailable)
  display: string;               // pre-formatted display string
  binLabel: string | null;       // which bin the current value falls into
  avgReturn5d: number | null;    // historical avg QQQ 5d return for this bin (%)
  hitRateUp: number | null;      // % of historical 5d windows that were up
  sampleCount: number;
  lowConfidence: boolean;
  vsBaseline: number | null;     // avgReturn5d - baseline (in %, "edge")
  informational: boolean;        // shown in table but not counted toward verdict
}

export interface VerdictPayload {
  cachedAt: number;
  baselineAvgReturn5d: number;
  yearsHistory: number;
  totalSamples: number;
  verdict: "lean-long" | "lean-short" | "chop";
  verdictLabel: string;
  expectedReturn5d: number;      // signal-weighted avg of bin returns
  edge: number;                  // expectedReturn5d - baseline
  agreement: { up: number; down: number; neutral: number };
  signals: SignalReading[];
  accuracy: AccuracyStats | null;
  recentHistory: HistoryRow[];   // last 30 days for sparkline / list
}

// ── stats lookup ──────────────────────────────────────────────────────────

type StatBin = { label: string; count: number; avgReturn5d: number; hitRateUp: number; lowConfidence: boolean };
type Stats = typeof statsData & { signals: Record<SignalKey, StatBin[]> };
const STATS: Stats = statsData as Stats;

function lookup(sk: SignalKey, binLabel: string | null): StatBin | null {
  if (!binLabel) return null;
  return STATS.signals[sk].find((b) => b.label === binLabel) ?? null;
}

// ── bin classification (mirrors backtest script) ──────────────────────────

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

function tnxMom20Bin(change: number): string {
  if (change < -0.30) return "<-0.30 (rates falling fast)";
  if (change < -0.10) return "-0.30 – -0.10";
  if (change <  0.10) return "-0.10 – +0.10 (flat)";
  if (change <  0.30) return "+0.10 – +0.30";
  return ">+0.30 (rates rising fast)";
}

function tltMom20Bin(pct: number): string {
  if (pct < -4.0) return "<-4% (bonds selling off)";
  if (pct < -1.0) return "-4% – -1%";
  if (pct <  1.0) return "-1% – +1% (flat)";
  if (pct <  3.0) return "+1% – +3%";
  return ">+3% (bonds rallying)";
}

function hygSpyDivBin(v: number): string {
  if (v < -1.5) return "<-1.5% (credit lagging)";
  if (v < -0.5) return "-1.5% – -0.5%";
  if (v < 0.5)  return "-0.5% – 0.5%";
  if (v < 1.5)  return "0.5% – 1.5%";
  return ">1.5% (credit leading)";
}

// ── indicator math ────────────────────────────────────────────────────────

function rsi(closes: number[], period: number): number | null {
  const n = closes.length;
  if (n < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = n - period; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss += Math.abs(diff);
  }
  gain /= period;
  loss /= period;
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i];
  return sum / period;
}

function stdev(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

// Current 20d realized vol (annualized %) as a percentile of its trailing 252d distribution.
function realizedVol20Pctile(closes: number[]): number | null {
  if (closes.length < 273) return null;  // need 252 days of 20d-vol values, each needing 20d history
  const rv: number[] = [];
  for (let i = 20; i < closes.length; i++) {
    const rets: number[] = [];
    for (let j = i - 19; j <= i; j++) rets.push((closes[j] - closes[j - 1]) / closes[j - 1]);
    rv.push(stdev(rets) * Math.sqrt(252) * 100);
  }
  const cur = rv[rv.length - 1];
  const window = rv.slice(-252);
  const sorted = [...window].sort((a, b) => a - b);
  const rank = sorted.filter((x) => x <= cur).length;
  return (rank / sorted.length) * 100;
}

// ── verdict aggregation ───────────────────────────────────────────────────

function buildReading(
  key: SignalKey,
  name: string,
  current: number | null,
  display: string,
  binLabel: string | null,
  informational = false,
): SignalReading {
  const stat = lookup(key, binLabel);
  return {
    key, name, current, display, binLabel,
    avgReturn5d: stat?.avgReturn5d ?? null,
    hitRateUp: stat?.hitRateUp ?? null,
    sampleCount: stat?.count ?? 0,
    lowConfidence: stat?.lowConfidence ?? false,
    vsBaseline: stat ? Math.round((stat.avgReturn5d - STATS.baselineAvgReturn5d) * 1000) / 1000 : null,
    informational,
  };
}

// Regime flagger: lean long/short only when ≥2 signals hit their extreme-edge bins
// (|edge| > 0.3) in the same direction and the other side is ≤1. expectedReturn5d
// is kept as informational summary — it's NOT a forecast of magnitude. Per backtest
// diagnostic (pearson ~0.02 with realized 5d return), individual signal edges
// carry weak directional signal at the extremes only.
const STRONG_EDGE = 0.3;

function buildVerdict(signals: SignalReading[]): {
  verdict: VerdictPayload["verdict"];
  verdictLabel: string;
  expectedReturn5d: number;
  edge: number;
  agreement: VerdictPayload["agreement"];
} {
  const usable = signals.filter((s) => s.avgReturn5d != null && !s.lowConfidence && !s.informational);
  let weightedReturn = 0;
  let totalWeight = 0;
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

  let verdict: VerdictPayload["verdict"] = "chop";
  let verdictLabel = "Neutral";
  if (up >= 2 && down <= 1) {
    verdict = "lean-long";
    verdictLabel = "Bullish";
  } else if (down >= 2 && up <= 1) {
    // Backtest 2024-2026: bearish signal clusters fired into bounces 9 of 10 times
    // (avg +3.64% over 5d). Treat as mean-reversion long, not short.
    verdict = "lean-long";
    verdictLabel = "Bullish (panic)";
  }

  return {
    verdict, verdictLabel,
    expectedReturn5d: Math.round(expectedReturn5d * 1000) / 1000,
    edge: Math.round(edge * 1000) / 1000,
    agreement: { up, down, neutral },
  };
}

// ── route ──────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 20 * 60 * 1000;
let cached: VerdictPayload | null = null;
let cachedTime = 0;

export async function GET() {
  try {
    if (cached && Date.now() - cachedTime < CACHE_TTL_MS) {
      return Response.json(cached);
    }

    // Need 273 trading days (252d vol-percentile window + 20d warmup); pull 500 cal days.
    const period1 = new Date(Date.now() - 500 * 24 * 60 * 60 * 1000);

    const [vixR, vix3mR, qqqR, hygR, spyR, tnxR, tltR] = await Promise.allSettled([
      yf.chart("^VIX",   { period1, interval: "1d" }),
      yf.chart("^VIX3M", { period1, interval: "1d" }),
      yf.chart("QQQ",    { period1, interval: "1d" }),
      yf.chart("HYG",    { period1, interval: "1d" }),
      yf.chart("SPY",    { period1, interval: "1d" }),
      yf.chart("^TNX",   { period1, interval: "1d" }),
      yf.chart("TLT",    { period1, interval: "1d" }),
    ]);

    const closes = (r: typeof vixR): number[] =>
      r.status === "fulfilled"
        ? r.value.quotes.filter((q) => q.close != null).map((q) => q.close as number)
        : [];

    const vix   = closes(vixR);
    const vix3m = closes(vix3mR);
    const qqq   = closes(qqqR);
    const hyg   = closes(hygR);
    const spy   = closes(spyR);
    const tnx   = closes(tnxR);
    const tlt   = closes(tltR);

    const readings: SignalReading[] = [];

    // 1) VIX term structure
    if (vix.length > 0 && vix3m.length > 0) {
      const v = vix[vix.length - 1];
      const v3 = vix3m[vix3m.length - 1];
      const term = v / v3;
      readings.push(buildReading(
        "vixTerm",
        "VIX / VIX3M",
        term,
        term.toFixed(3),
        vixTermBin(term),
      ));
    } else {
      readings.push(buildReading("vixTerm", "VIX / VIX3M", null, "—", null));
    }

    // 2) VIX 1-day spike
    if (vix.length >= 2) {
      const v = vix[vix.length - 1];
      const vPrev = vix[vix.length - 2];
      const spike = ((v - vPrev) / vPrev) * 100;
      readings.push(buildReading(
        "vixSpike",
        "VIX 1-day change",
        spike,
        `${spike >= 0 ? "+" : ""}${spike.toFixed(1)}%`,
        vixSpikeBin(spike),
      ));
    } else {
      readings.push(buildReading("vixSpike", "VIX 1-day change", null, "—", null));
    }

    // 3) QQQ vs 200d MA (trend filter — needed first for RSI in-trend signal)
    const ma200 = sma(qqq, 200);
    const last = qqq[qqq.length - 1] ?? null;
    const inUptrend = ma200 != null && last != null && last > ma200;
    if (ma200 != null && last != null) {
      const pct = ((last / ma200) - 1) * 100;
      readings.push(buildReading(
        "pctAbove200ma",
        "QQQ vs 200d MA",
        pct,
        `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
        pctAbove200maBin(pct),
      ));
    } else {
      readings.push(buildReading("pctAbove200ma", "QQQ vs 200d MA", null, "—", null));
    }

    // 3b) 20d realized vol, ranked against trailing 252d of itself
    const rvPct = realizedVol20Pctile(qqq);
    if (rvPct != null) {
      readings.push(buildReading(
        "realizedVol20Pct",
        "20d vol percentile",
        rvPct,
        `${rvPct.toFixed(0)}th pctile`,
        realizedVol20PctBin(rvPct),
      ));
    } else {
      readings.push(buildReading("realizedVol20Pct", "20d vol percentile", null, "—", null));
    }

    // 4) RSI(2) within trend context
    const rsi2 = rsi(qqq, 2);
    if (rsi2 != null && ma200 != null) {
      readings.push(buildReading(
        "rsi2InTrend",
        "RSI(2) + trend",
        rsi2,
        inUptrend ? `${rsi2.toFixed(1)} (uptrend)` : `${rsi2.toFixed(1)} (downtrend)`,
        rsi2Bin(rsi2, inUptrend),
      ));
    } else {
      readings.push(buildReading("rsi2InTrend", "RSI(2) + trend", null, "—", null));
    }

    // 5) HYG 5d − SPY 5d
    if (hyg.length > 5 && spy.length > 5) {
      const hyg5d = ((hyg[hyg.length - 1] - hyg[hyg.length - 6]) / hyg[hyg.length - 6]) * 100;
      const spy5d = ((spy[spy.length - 1] - spy[spy.length - 6]) / spy[spy.length - 6]) * 100;
      const div = hyg5d - spy5d;
      readings.push(buildReading(
        "hygSpyDiv",
        "HYG − SPY (5d)",
        div,
        `${div >= 0 ? "+" : ""}${div.toFixed(2)}%`,
        hygSpyDivBin(div),
      ));
    } else {
      readings.push(buildReading("hygSpyDiv", "HYG − SPY (5d)", null, "—", null));
    }

    // 6) 10y yield 20d change — informational context, not counted toward verdict
    //    (correlated with existing signals; adding to vote pool lowers selectivity)
    if (tnx.length >= 21) {
      const change = tnx[tnx.length - 1] - tnx[tnx.length - 21];
      readings.push(buildReading(
        "tnxMom20", "10y yield 20d Δ", change,
        `${change >= 0 ? "+" : ""}${change.toFixed(2)}pp`,
        tnxMom20Bin(change), true,
      ));
    } else {
      readings.push(buildReading("tnxMom20", "10y yield 20d Δ", null, "—", null, true));
    }

    // 7) TLT 20d return — informational context, not counted toward verdict
    if (tlt.length >= 21) {
      const tltMom = ((tlt[tlt.length - 1] - tlt[tlt.length - 21]) / tlt[tlt.length - 21]) * 100;
      readings.push(buildReading(
        "tltMom20", "TLT 20d return", tltMom,
        `${tltMom >= 0 ? "+" : ""}${tltMom.toFixed(2)}%`,
        tltMom20Bin(tltMom), true,
      ));
    } else {
      readings.push(buildReading("tltMom20", "TLT 20d return", null, "—", null, true));
    }

    const verdict = buildVerdict(readings);

    // Build base payload (without accuracy yet)
    const basePayload: Omit<VerdictPayload, "accuracy" | "recentHistory"> = {
      cachedAt: Date.now(),
      baselineAvgReturn5d: STATS.baselineAvgReturn5d,
      yearsHistory: STATS.yearsHistory,
      totalSamples: STATS.totalSamples,
      ...verdict,
      signals: readings,
    };

    // Persistence is best-effort — never break the page if Supabase is misconfigured/down.
    let accuracy: AccuracyStats | null = null;
    let recentHistory: HistoryRow[] = [];
    try {
      await snapshotVerdict(basePayload as VerdictPayload);
      await backfillRealizedReturns();
      recentHistory = await loadRecentHistory(120);
      accuracy = computeAccuracy(recentHistory);
    } catch (e) {
      console.warn("[sentiment] persistence skipped:", e instanceof Error ? e.message : e);
    }

    const payload: VerdictPayload = { ...basePayload, accuracy, recentHistory: recentHistory.slice(0, 30) };

    cached = payload;
    cachedTime = Date.now();

    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}

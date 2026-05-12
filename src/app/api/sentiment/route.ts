import YahooFinance from "yahoo-finance2";
import statsData from "@/data/signal-stats.json";
import { getUpcomingEvents, type MacroEvent } from "@/lib/macroCalendar";
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

export type SignalKey = "vixTerm" | "vixSpike" | "qqq1dRet" | "pctAbove200ma" | "realizedVol20Pct" | "tnxMom20" | "skewLevel";

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
  upcomingEvents: MacroEvent[];    // FOMC/CPI events in the next 5 trading days
  baselineAvgReturn5d: number;
  yearsHistory: number;
  totalSamples: number;
  verdict: "lean-long" | "lean-short" | "chop";
  verdictLabel: string;
  expectedReturn5d: number;      // signal-weighted avg of bin returns (legacy)
  predictedReturn5d: number;     // OLS magnitude model output — headline forecast
  modelMae: number;              // training MAE of the magnitude model (in-sample)
  modelPearson: number;          // training pearson of the magnitude model (in-sample)
  edge: number;                  // expectedReturn5d - baseline (legacy)
  agreement: { up: number; down: number; neutral: number };
  signals: SignalReading[];
  accuracy: AccuracyStats | null;
  recentHistory: HistoryRow[];   // last 30 days for sparkline / list
}

// ── stats lookup ──────────────────────────────────────────────────────────

type StatBin = { label: string; count: number; avgReturn5d: number; hitRateUp: number; lowConfidence: boolean };
type MagnitudeModel = {
  intercept: number;
  coefficients: Record<SignalKey, number>;
  featureSignals: SignalKey[];
  trainN: number;
  mae: number;
  rmse: number;
  r2: number;
  pearson: number;
};
type Stats = typeof statsData & {
  signals: Record<SignalKey, StatBin[]>;
  magnitudeModel: MagnitudeModel;
};
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

function qqq1dRetBin(pct: number): string {
  if (pct < -2.0) return "<-2% (big down)";
  if (pct < -0.5) return "-2% – -0.5% (down)";
  if (pct <  0.5) return "-0.5% – +0.5% (flat)";
  if (pct <  2.0) return "+0.5% – +2% (up)";
  return ">+2% (big up)";
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

function skewLevelBin(v: number): string {
  if (v < 130) return "<130 (complacent)";
  if (v < 140) return "130 – 140 (moderate hedge)";
  if (v < 150) return "140 – 150";
  return ">150 (heavy protection)";
}

// ── indicator math ────────────────────────────────────────────────────────

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

// OLS magnitude model: predicted 5d return = intercept + Σ coef_k * bin_edge_k
// Missing signals contribute zero (model treats absent signal as no edge).
function predictMagnitude(signals: SignalReading[]): number {
  const model = STATS.magnitudeModel;
  let sum = model.intercept;
  const byKey = new Map(signals.map((s) => [s.key, s]));
  for (const sk of model.featureSignals) {
    const s = byKey.get(sk);
    const edge = s?.vsBaseline ?? 0;
    sum += model.coefficients[sk] * edge;
  }
  return Math.round(sum * 1000) / 1000;
}

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
  if (up >= 3 && down <= 1) {
    verdict = "lean-long";
    verdictLabel = "Bullish";
  } else if (down >= 3 && up <= 1) {
    verdict = "lean-short";
    verdictLabel = "Bearish";
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

    const [vixR, vix3mR, qqqR, tnxR, skewR] = await Promise.allSettled([
      yf.chart("^VIX",   { period1, interval: "1d" }),
      yf.chart("^VIX3M", { period1, interval: "1d" }),
      yf.chart("QQQ",    { period1, interval: "1d" }),
      yf.chart("^TNX",   { period1, interval: "1d" }),
      yf.chart("^SKEW",  { period1, interval: "1d" }),
    ]);

    const closes = (r: typeof vixR): number[] =>
      r.status === "fulfilled"
        ? r.value.quotes.filter((q) => q.close != null).map((q) => q.close as number)
        : [];

    const vix   = closes(vixR);
    const vix3m = closes(vix3mR);
    const qqq   = closes(qqqR);
    const tnx   = closes(tnxR);
    const skew  = closes(skewR);

    // Trading day strings for upcoming-event lookup
    const qqqDates: string[] = qqqR.status === "fulfilled"
      ? qqqR.value.quotes.filter((q) => q.date != null).map((q) => (q.date as Date).toISOString().slice(0, 10))
      : [];
    const lastTradingDate = qqqDates[qqqDates.length - 1] ?? new Date().toISOString().slice(0, 10);
    const upcomingEvents = getUpcomingEvents(qqqDates, lastTradingDate, 5);

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

    // 3) QQQ 1-day return
    if (qqq.length >= 2) {
      const ret1d = ((qqq[qqq.length - 1] - qqq[qqq.length - 2]) / qqq[qqq.length - 2]) * 100;
      readings.push(buildReading(
        "qqq1dRet",
        "QQQ 1-day return",
        ret1d,
        `${ret1d >= 0 ? "+" : ""}${ret1d.toFixed(2)}%`,
        qqq1dRetBin(ret1d),
      ));
    } else {
      readings.push(buildReading("qqq1dRet", "QQQ 1-day return", null, "—", null));
    }

    // 4) QQQ vs 200d MA
    const ma200 = sma(qqq, 200);
    const last = qqq[qqq.length - 1] ?? null;
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

    // 4) 10y yield 20d change — rising rates = headwind for QQQ (strongest bearish bin: −0.92% edge)
    if (tnx.length >= 21) {
      const change = tnx[tnx.length - 1] - tnx[tnx.length - 21];
      readings.push(buildReading(
        "tnxMom20", "10y yield 20d Δ", change,
        `${change >= 0 ? "+" : ""}${change.toFixed(2)}pp`,
        tnxMom20Bin(change),
      ));
    } else {
      readings.push(buildReading("tnxMom20", "10y yield 20d Δ", null, "—", null));
    }

    // 7) CBOE SKEW — second-strongest individual signal (r=0.089), counts toward verdict
    if (skew.length > 0) {
      const sv = skew[skew.length - 1];
      readings.push(buildReading(
        "skewLevel", "CBOE SKEW", sv,
        sv.toFixed(1),
        skewLevelBin(sv),
      ));
    } else {
      readings.push(buildReading("skewLevel", "CBOE SKEW", null, "—", null));
    }

    const verdict = buildVerdict(readings);
    const predictedReturn5d = predictMagnitude(readings);

    // Build base payload (without accuracy yet)
    const basePayload: Omit<VerdictPayload, "accuracy" | "recentHistory"> = {
      cachedAt: Date.now(),
      upcomingEvents,
      baselineAvgReturn5d: STATS.baselineAvgReturn5d,
      yearsHistory: STATS.yearsHistory,
      totalSamples: STATS.totalSamples,
      ...verdict,
      predictedReturn5d,
      modelMae: STATS.magnitudeModel.mae,
      modelPearson: STATS.magnitudeModel.pearson,
      signals: readings,
    };

    // Each persistence step is independently best-effort so a Yahoo Finance
    // hiccup during backfill doesn't wipe out the track record display.
    let accuracy: AccuracyStats | null = null;
    let recentHistory: HistoryRow[] = [];
    try { await snapshotVerdict(basePayload as VerdictPayload); }
    catch (e) { console.warn("[sentiment] snapshot failed:", e instanceof Error ? e.message : e); }
    try { await backfillRealizedReturns(); }
    catch (e) { console.warn("[sentiment] backfill failed:", e instanceof Error ? e.message : e); }
    try {
      recentHistory = await loadRecentHistory(260);
      accuracy = computeAccuracy(recentHistory);
    } catch (e) {
      console.warn("[sentiment] history load failed:", e instanceof Error ? e.message : e);
    }

    const payload: VerdictPayload = { ...basePayload, accuracy, recentHistory };

    cached = payload;
    cachedTime = Date.now();

    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}

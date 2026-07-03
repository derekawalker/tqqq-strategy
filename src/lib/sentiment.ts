/**
 * TQQQ regime scoring model — pure, framework-agnostic, client-safe.
 *
 * Both the API route (server) and the Sentiment page (client) import from here
 * so the score range, regime thresholds, and scoring-legend tiers can never
 * drift out of sync the way they did when each side hard-coded its own numbers.
 *
 * The model scores seven signals, sums them, and classifies the total into a
 * regime. Six of the signals are trend/price/vol measures that tend to move
 * together; the seventh — VIX term structure — is deliberately included because
 * it carries different (often leading) information from the VIX *level*.
 */

import { sma } from "./strategySignals";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Regime = "Risk-On" | "Neutral" | "Risk-Off";

export interface SignalScores {
  vs200: number;
  vs50: number;
  vix: number;
  momentum: number;
  stress: number;
  slope: number;
  term: number;
}

export interface DayScore {
  date: string;
  qqq: number;
  sma50: number | null;
  sma200: number | null;
  rsi: number;
  vix: number | null;
  vix3m: number | null;
  vixSlope: number | null;
  ratio: number | null; // VIX / VIX3M term-structure ratio
  drawdown20: number;
  sma200Slope: number | null; // 10-day % change of the 200-day SMA
  return10d: number;
  scores: SignalScores;
  total: number;
  regime: Regime;
}

// ---------------------------------------------------------------------------
// Scoring tiers — single source of truth for both scoring and the UI legend.
//
// Each tier lists the score it awards plus a human description and a colour the
// page uses to render the legend. `max`/`min` per signal are derived from these
// so the achievable total range is always correct.
// ---------------------------------------------------------------------------

export interface Tier {
  score: number;
  desc: string;
  color: "teal" | "gray" | "orange" | "red";
}

export interface SignalSpec {
  key: keyof SignalScores;
  label: string;
  tiers: Tier[];
}

export const SIGNAL_SPECS: SignalSpec[] = [
  {
    key: "vs200",
    label: "QQQ vs 200-day SMA",
    tiers: [
      { score: 2, desc: ">5% above", color: "teal" },
      { score: 1, desc: "1–5% above", color: "teal" },
      { score: 0, desc: "within ±1%", color: "gray" },
      { score: -1, desc: "1–5% below", color: "red" },
      { score: -2, desc: ">5% below", color: "red" },
    ],
  },
  {
    key: "vs50",
    label: "QQQ vs 50-day SMA",
    tiers: [
      { score: 2, desc: ">5% above", color: "teal" },
      { score: 1, desc: "1–5% above", color: "teal" },
      { score: 0, desc: "within ±1%", color: "gray" },
      { score: -1, desc: "1–5% below", color: "red" },
      { score: -2, desc: ">5% below", color: "red" },
    ],
  },
  {
    key: "vix",
    label: "VIX level",
    tiers: [
      { score: 1, desc: "VIX < 15", color: "teal" },
      { score: 0, desc: "VIX 15–20", color: "gray" },
      { score: -1, desc: "VIX 20–25 or rising fast", color: "orange" },
      { score: -2, desc: "VIX 25–35", color: "red" },
      { score: -3, desc: "VIX > 35", color: "red" },
    ],
  },
  {
    key: "momentum",
    label: "RSI (14-day)",
    tiers: [
      { score: 2, desc: "RSI 55–70 (strong)", color: "teal" },
      { score: 1, desc: "RSI 45–55", color: "teal" },
      { score: 0, desc: "RSI 35–45 or >70 (extended)", color: "gray" },
      { score: -1, desc: "RSI 30–35", color: "orange" },
      { score: -2, desc: "RSI < 30", color: "red" },
    ],
  },
  {
    key: "stress",
    label: "20-day drawdown",
    tiers: [
      { score: 1, desc: "< 1% (stable)", color: "teal" },
      { score: 0, desc: "1–5%", color: "gray" },
      { score: -1, desc: "5–10%", color: "orange" },
      { score: -2, desc: "10–20%", color: "red" },
      { score: -3, desc: "> 20%", color: "red" },
    ],
  },
  {
    key: "slope",
    label: "200-day SMA slope (10d)",
    tiers: [
      { score: 1, desc: "> +0.3% (rising)", color: "teal" },
      { score: 0, desc: "0 to +0.3% (flat)", color: "gray" },
      { score: -1, desc: "−0.3% to 0 (slowing)", color: "orange" },
      { score: -2, desc: "< −0.3% (declining)", color: "red" },
    ],
  },
  {
    key: "term",
    label: "VIX term structure (VIX ÷ VIX3M)",
    tiers: [
      { score: 1, desc: "< 0.90 (steep contango)", color: "teal" },
      { score: 0, desc: "0.90–1.00 (normal)", color: "gray" },
      { score: -1, desc: "1.00–1.05 (flattening)", color: "orange" },
      { score: -2, desc: "> 1.05 (backwardation)", color: "red" },
    ],
  },
];

const range = (tiers: Tier[]) => ({
  min: Math.min(...tiers.map((t) => t.score)),
  max: Math.max(...tiers.map((t) => t.score)),
});

/** Worst- and best-possible totals, derived from the tier tables above. */
export const SCORE_MIN = SIGNAL_SPECS.reduce((s, sp) => s + range(sp.tiers).min, 0);
export const SCORE_MAX = SIGNAL_SPECS.reduce((s, sp) => s + range(sp.tiers).max, 0);

// ---------------------------------------------------------------------------
// Regime thresholds + hysteresis
// ---------------------------------------------------------------------------

export const RISK_ON_MIN = 4; // score ≥ 4 → Risk-On
export const NEUTRAL_MIN = 0; // score ≥ 0 → Neutral, else Risk-Off
const HYSTERESIS = 1; // band that must be crossed to *leave* a regime

/**
 * Classify a score into a regime. When `prev` is supplied, a 1-point hysteresis
 * band is applied so the regime doesn't whipsaw on a single boundary-crossing
 * day — important because the suggested action ("Exit TQQQ") is expensive to
 * toggle.
 */
export function classifyRegime(score: number, prev?: Regime): Regime {
  if (prev === "Risk-On") {
    if (score >= RISK_ON_MIN - HYSTERESIS) return "Risk-On";
    if (score >= NEUTRAL_MIN - HYSTERESIS) return "Neutral";
    return "Risk-Off";
  }
  if (prev === "Risk-Off") {
    if (score <= NEUTRAL_MIN + HYSTERESIS) return "Risk-Off";
    if (score <= RISK_ON_MIN + HYSTERESIS) return "Neutral";
    return "Risk-On";
  }
  if (score >= RISK_ON_MIN) return "Risk-On";
  if (score >= NEUTRAL_MIN) return "Neutral";
  return "Risk-Off";
}

export function regimeAction(regime: Regime): string {
  if (regime === "Risk-On") return "Full TQQQ exposure OK. Add on dips (RSI < 40).";
  if (regime === "Neutral")
    return "Reduce size 25–50%. Trade QQQ instead of TQQQ. No aggressive leverage adds.";
  return "Exit TQQQ. Cash / SGOV / hedged exposure. No dip-buying.";
}

export interface RegimeThrottle {
  /** Same convention as strategySignals.ts: 1.0 = full buys, 0.0 = pause all buys. */
  multiplier: number;
  label: string;
}

/**
 * Maps the current regime to a ladder buy-throttle recommendation, so the
 * standing dip-buying ladder and the regime model give one consistent stance
 * instead of the ladder buying dips the regime model says to avoid. Advisory
 * only — the app doesn't place or cancel orders on its own.
 */
export function regimeThrottle(regime: Regime): RegimeThrottle {
  if (regime === "Risk-On") return { multiplier: 1, label: "Full size — buy every touched level." };
  if (regime === "Neutral")
    return { multiplier: 0.5, label: "Half size — consider buying half the normal share count per level." };
  return { multiplier: 0, label: "Paused — consider holding off new buys until the regime improves." };
}

/**
 * Regime-dependent sell-target percent for the ladder: a looser target in
 * Risk-On (let winners run with the trend) and a tighter one in Neutral/
 * Risk-Off (turn lots over faster for cash before a downtrend resumes,
 * rather than waiting for a bigger bounce that may not come). See
 * ladderSim.ts's `sellPctOverride` — each lot keeps the target it was
 * bought with even if the regime changes before it sells.
 */
export function regimeSellTargetPct(regime: Regime, riskOnPct = 5, otherPct = 3): number {
  return regime === "Risk-On" ? riskOnPct : otherPct;
}

// ---------------------------------------------------------------------------
// Per-signal scorers (pure)
// ---------------------------------------------------------------------------

function scoreVsMa(close: number, ma: number | null): number {
  if (ma == null) return 0;
  const pct = close / ma - 1;
  if (pct > 0.05) return 2;
  if (pct > 0.01) return 1;
  if (pct >= -0.01) return 0;
  if (pct >= -0.05) return -1;
  return -2;
}

function scoreVix(vix: number | null, vixSlope: number | null): number {
  if (vix == null) return 0;
  let s: number;
  if (vix < 15) s = 1;
  else if (vix < 20) s = 0;
  else if (vix < 25) s = -1;
  else if (vix < 35) s = -2;
  else s = -3;
  // A fast-rising VIX adds pressure even when the level is still benign.
  if (vixSlope != null && vixSlope > 2) s = Math.min(s, -1);
  return s;
}

function scoreMomentum(rsi: number): number {
  if (rsi >= 55 && rsi <= 70) return 2;
  if (rsi >= 45 && rsi < 55) return 1;
  if (rsi >= 35 && rsi < 45) return 0;
  if (rsi > 70) return 0; // overbought is "extended", not a green light
  if (rsi >= 30) return -1;
  return -2;
}

function scoreStress(dd20: number): number {
  if (dd20 <= -0.2) return -3;
  if (dd20 <= -0.1) return -2;
  if (dd20 <= -0.05) return -1;
  if (dd20 > -0.01) return 1;
  return 0;
}

function scoreSlope(sma200Slope: number | null): number {
  if (sma200Slope == null) return 0;
  if (sma200Slope > 0.3) return 1;
  if (sma200Slope > 0) return 0;
  if (sma200Slope > -0.3) return -1;
  return -2;
}

function scoreTerm(ratio: number | null): number {
  if (ratio == null) return 0;
  if (ratio < 0.9) return 1;
  if (ratio <= 1.0) return 0;
  if (ratio <= 1.05) return -1;
  return -2;
}

// ---------------------------------------------------------------------------
// Series builder
// ---------------------------------------------------------------------------

export interface SeriesInput {
  dates: string[];
  closes: number[];
  vix: (number | null)[]; // aligned to dates
  vix3m: (number | null)[]; // aligned to dates
}

/** 14-period Wilder RSI over a close series. */
export function rsi(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(50);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period && i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain += Math.max(delta, 0);
    avgLoss += Math.max(-delta, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const delta = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

/** Worst peak-to-trough drawdown over the trailing 20 closes ending at `i`. */
function drawdown20(closes: number[], i: number): number {
  const start = Math.max(0, i - 19);
  let peak = closes[start];
  let maxDD = 0;
  for (let k = start; k <= i; k++) {
    if (closes[k] > peak) peak = closes[k];
    const dd = closes[k] / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Score every day in the input series. Days are produced for every bar; days
 * without a 200-day SMA yet simply score 0 on the SMA-dependent signals.
 * The regime is computed sequentially so hysteresis carries forward correctly.
 */
export function computeSeries(input: SeriesInput): DayScore[] {
  const { dates, closes, vix, vix3m } = input;
  const n = closes.length;
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsiVals = rsi(closes, 14);

  const out: DayScore[] = [];
  let prevRegime: Regime | undefined;

  for (let i = 0; i < n; i++) {
    const close = closes[i];
    const ma50 = sma50[i];
    const ma200 = sma200[i];
    const v = vix[i] ?? null;
    const v3m = vix3m[i] ?? null;
    const vPrev = i >= 5 ? (vix[i - 5] ?? null) : null;
    const vixSlope = v != null && vPrev != null ? v - vPrev : null;
    const ratio = v != null && v3m != null && v3m !== 0 ? v / v3m : null;
    const dd20 = drawdown20(closes, i);
    const ma200Prev = i >= 10 ? sma200[i - 10] : null;
    const sma200Slope =
      ma200 != null && ma200Prev != null && ma200Prev !== 0
        ? ((ma200 - ma200Prev) / ma200Prev) * 100
        : null;
    const return10d = i >= 10 ? closes[i] / closes[i - 10] - 1 : 0;

    const scores: SignalScores = {
      vs200: scoreVsMa(close, ma200),
      vs50: scoreVsMa(close, ma50),
      vix: scoreVix(v, vixSlope),
      momentum: scoreMomentum(rsiVals[i]),
      stress: scoreStress(dd20),
      slope: scoreSlope(sma200Slope),
      term: scoreTerm(ratio),
    };
    const total =
      scores.vs200 + scores.vs50 + scores.vix + scores.momentum + scores.stress + scores.slope + scores.term;
    const regime = classifyRegime(total, prevRegime);
    prevRegime = regime;

    out.push({
      date: dates[i],
      qqq: close,
      sma50: ma50,
      sma200: ma200,
      rsi: Math.round(rsiVals[i] * 10) / 10,
      vix: v,
      vix3m: v3m,
      vixSlope,
      ratio,
      drawdown20: dd20,
      sma200Slope,
      return10d,
      scores,
      total,
      regime,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Backtest: forward returns bucketed by regime
// ---------------------------------------------------------------------------

export interface RegimeStat {
  regime: Regime;
  count: number;
  avgReturn: number; // mean forward QQQ return over the horizon
  winRate: number; // fraction of windows with positive forward return
  avgVol: number; // mean annualised volatility of daily returns over the horizon
}

export interface Backtest {
  horizonDays: number;
  sampleFrom: string;
  stats: RegimeStat[];
}

/**
 * For each day with a defined regime and a full forward window, record the
 * subsequent `horizonDays` QQQ return and bucket by that day's regime. This is
 * the evidence that the regime label actually separates good days from bad.
 * Only days with a valid 200-day SMA are counted (the model isn't meaningful
 * before then).
 */
export function backtestRegimes(series: DayScore[], horizonDays = 20): Backtest {
  const buckets = new Map<Regime, { rets: number[]; vols: number[] }>();
  let sampleFrom = "";
  for (let i = 0; i < series.length - horizonDays; i++) {
    const d = series[i];
    if (d.sma200 == null) continue;
    if (!sampleFrom) sampleFrom = d.date;
    const fwd = series[i + horizonDays].qqq / d.qqq - 1;

    // Annualised volatility of daily returns inside the forward window — the
    // metric that actually matters for a 3x ETF (volatility decay), and the one
    // that separates the regimes where average direction (mean-reversion) does
    // not.
    const daily: number[] = [];
    for (let k = 1; k <= horizonDays; k++) {
      daily.push(series[i + k].qqq / series[i + k - 1].qqq - 1);
    }
    const mean = daily.reduce((s, x) => s + x, 0) / daily.length;
    const variance = daily.reduce((s, x) => s + (x - mean) ** 2, 0) / daily.length;
    const vol = Math.sqrt(variance) * Math.sqrt(252);

    const b = buckets.get(d.regime) ?? { rets: [], vols: [] };
    b.rets.push(fwd);
    b.vols.push(vol);
    buckets.set(d.regime, b);
  }

  const order: Regime[] = ["Risk-On", "Neutral", "Risk-Off"];
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const stats: RegimeStat[] = order
    .filter((r) => buckets.has(r))
    .map((regime) => {
      const { rets, vols } = buckets.get(regime)!;
      return {
        regime,
        count: rets.length,
        avgReturn: mean(rets),
        winRate: rets.filter((x) => x > 0).length / rets.length,
        avgVol: mean(vols),
      };
    });

  return { horizonDays, sampleFrom, stats };
}

/** Number of trailing days (including today) the regime has held steady. */
export function daysInRegime(series: DayScore[]): number {
  if (series.length === 0) return 0;
  const current = series[series.length - 1].regime;
  let days = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].regime !== current) break;
    days++;
  }
  return days;
}

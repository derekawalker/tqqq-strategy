/**
 * Systemic Fragility & Euphoria Composite (SFEC)
 * ------------------------------------------------
 * A multi-factor, causal (no look-ahead) market-anomaly indicator built entirely
 * from free Yahoo Finance daily data. It blends two opposing sub-indices:
 *
 *   • FRAGILITY (crash risk) — hidden systemic stress that tends to lead price:
 *       - VIX term-structure inversion (^VIX / ^VIX3M): near-term fear > long-term
 *       - Credit stress (HYG/LQD): high-yield falling vs investment-grade
 *       - Bond volatility (^MOVE): rates-market disorder
 *       - Equity realized volatility (^GSPC 20d)
 *       - Drawdown from the trailing 1y high
 *
 *   • EUPHORIA (boom / melt-up) — exponential risk-on optimism:
 *       - Price extension above the 200d moving average
 *       - Trend quality (60d return / 60d volatility, a Sharpe-like ratio)
 *       - Copper/Gold ratio momentum (cyclical growth appetite)
 *       - Stocks-vs-bonds momentum (^GSPC / TLT)
 *       - RSI(14) distance from neutral
 *
 * Every raw feature is converted to a *rolling* z-score over a trailing window so
 * the indicator only ever uses information available on that day. The composite is
 * `euphoria - fragility`: strongly positive = boom, strongly negative = crash risk.
 *
 * All functions here are pure so they can be unit-tested without any network/IO.
 */

// ---------------------------------------------------------------------------
// Tunable parameters (kept in one place so the design is auditable / testable)
// ---------------------------------------------------------------------------

/**
 * Every setting is a field of `AnomalyParams` so the indicator can be tuned and
 * optimized. `DEFAULT_PARAMS` holds the production values; the exported scalar
 * constants below mirror the defaults for callers that only need a few of them.
 */
export interface AnomalyParams {
  // Factor lookbacks (trading days)
  zWindow: number; // rolling z-score window
  rvolWindow: number; // realized-vol lookback
  smaLong: number; // long moving average for extension
  sharpeWindow: number; // trend-quality lookback
  cgMomWindow: number; // copper/gold momentum lookback
  riskMomWindow: number; // stocks/bonds momentum lookback
  creditMomWindow: number; // credit-ratio momentum lookback
  rsiPeriod: number;
  ddWindow: number; // drawdown high lookback

  // Signal thresholds (composite z-units) with hysteresis to avoid whipsaws.
  crashEnter: number;
  crashExit: number;
  boomEuphoriaEnter: number;
  boomFragilityMax: number;
  boomEuphoriaExit: number;
  confirmDays: number;

  // Per-factor blend weights (order matches FRAGILITY_FACTORS / EUPHORIA_FACTORS).
  fragilityWeights: number[];
  euphoriaWeights: number[];
}

export const DEFAULT_PARAMS: AnomalyParams = {
  // zWindow shortened 252→189 and per-factor weights set by an out-of-sample
  // optimization (train 2011-2022, holdout 2022-2026): each weight is
  // proportional to that factor's cross-validated Spearman IC vs 21-day forward
  // returns, with the two noise factors pruned to 0. This lifted holdout IC
  // (21d −0.085→−0.098, 63d −0.035→−0.094) without overfitting. See the
  // git history / page methodology for the study. The signal remains
  // contrarian (high fragility marks bottoms), which is a structural property
  // of these coincident factors, not something weighting can change.
  zWindow: 189,
  rvolWindow: 20,
  smaLong: 200,
  sharpeWindow: 60,
  cgMomWindow: 60,
  riskMomWindow: 20,
  creditMomWindow: 20,
  rsiPeriod: 14,
  ddWindow: 252,
  crashEnter: 1.5,
  crashExit: 0.5,
  boomEuphoriaEnter: 1.0,
  boomFragilityMax: 0.75,
  boomEuphoriaExit: 0.25,
  confirmDays: 2,
  fragilityWeights: [0.23, 0.11, 0, 0.21, 0.23], // vixTS, creditStress, move(pruned), rvol, dd
  euphoriaWeights: [0.23, 0.26, 0, 0.18, 0.22], // ext, sharpe, cgMom(pruned), riskMom, rsi
};

export const FRAGILITY_FACTORS = ["vixTS", "creditStress", "move", "rvol", "dd"] as const;
export const EUPHORIA_FACTORS = ["ext", "sharpe", "cgMom", "riskMom", "rsi"] as const;

export const Z_WINDOW = DEFAULT_PARAMS.zWindow;
export const RVOL_WINDOW = DEFAULT_PARAMS.rvolWindow;
export const SMA_LONG = DEFAULT_PARAMS.smaLong;
export const SHARPE_WINDOW = DEFAULT_PARAMS.sharpeWindow;
export const CG_MOM_WINDOW = DEFAULT_PARAMS.cgMomWindow;
export const RISK_MOM_WINDOW = DEFAULT_PARAMS.riskMomWindow;
export const CREDIT_MOM_WINDOW = DEFAULT_PARAMS.creditMomWindow;
export const RSI_PERIOD = DEFAULT_PARAMS.rsiPeriod;
export const CRASH_ENTER = DEFAULT_PARAMS.crashEnter;
export const CRASH_EXIT = DEFAULT_PARAMS.crashExit;
export const BOOM_EUPHORIA_ENTER = DEFAULT_PARAMS.boomEuphoriaEnter;
export const BOOM_FRAGILITY_MAX = DEFAULT_PARAMS.boomFragilityMax;
export const BOOM_EUPHORIA_EXIT = DEFAULT_PARAMS.boomEuphoriaExit;
export const CONFIRM_DAYS = DEFAULT_PARAMS.confirmDays;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlignedRow {
  date: string; // ISO yyyy-mm-dd (UTC trading day)
  spx: number;
  vix: number;
  vix3m: number;
  move: number;
  hyg: number;
  lqd: number;
  tlt: number;
  tnx: number; // 10y yield (%)
  irx: number; // 13w T-bill yield (%)
  cper: number; // copper ETF
  gld: number; // gold ETF
}

export type SignalKind = "crash" | "boom" | "neutral";

export interface AnomalyPoint {
  date: string;
  spx: number;
  shortRate: number; // ^IRX 13-week T-bill yield (%), used as the cash return in backtests
  yieldCurve: number; // ^TNX - ^IRX (10y minus 3m), in percentage points
  fragility: number | null; // composite z-score (higher = more fragile)
  euphoria: number | null; // composite z-score (higher = more euphoric)
  composite: number | null; // euphoria - fragility
  signal: SignalKind;
}

export interface SeriesPoint {
  date: string;
  close: number;
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

/** Sample mean of a numeric slice (ignores NaN). */
export function mean(xs: number[]): number {
  const v = xs.filter((x) => Number.isFinite(x));
  if (v.length === 0) return NaN;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Sample standard deviation (n-1). Returns NaN for <2 finite points. */
export function std(xs: number[]): number {
  const v = xs.filter((x) => Number.isFinite(x));
  if (v.length < 2) return NaN;
  const m = mean(v);
  const ss = v.reduce((a, b) => a + (b - m) * (b - m), 0);
  return Math.sqrt(ss / (v.length - 1));
}

/**
 * Trailing rolling z-score of `series[i]` using the window
 * `[i-window+1 .. i]` (inclusive of today, fully causal). Returns null when
 * there isn't a full window of finite data or the window has zero variance.
 */
export function rollingZ(series: number[], i: number, window: number): number | null {
  if (i < window - 1) return null;
  const w = series.slice(i - window + 1, i + 1);
  if (w.some((x) => !Number.isFinite(x))) return null;
  const m = mean(w);
  const s = std(w);
  if (!Number.isFinite(s) || s === 0) return null;
  return (series[i] - m) / s;
}

/** n-period simple return at index i: series[i]/series[i-n] - 1. */
export function pctChange(series: number[], i: number, n: number): number {
  if (i < n || !Number.isFinite(series[i]) || !Number.isFinite(series[i - n]) || series[i - n] === 0) {
    return NaN;
  }
  return series[i] / series[i - n] - 1;
}

/** Daily log returns; ret[0] is NaN (no prior bar). */
export function logReturns(closes: number[]): number[] {
  return closes.map((c, i) => (i === 0 || closes[i - 1] <= 0 || c <= 0 ? NaN : Math.log(c / closes[i - 1])));
}

/** Annualized realized volatility from daily log returns over a trailing window. */
export function realizedVol(returns: number[], i: number, window: number): number {
  if (i < window) return NaN;
  const w = returns.slice(i - window + 1, i + 1);
  const s = std(w);
  return Number.isFinite(s) ? s * Math.sqrt(252) : NaN;
}

/** Simple moving average ending at i; NaN until a full window exists. */
export function sma(series: number[], i: number, window: number): number {
  if (i < window - 1) return NaN;
  return mean(series.slice(i - window + 1, i + 1));
}

/**
 * Wilder's RSI as a full series (same length as input). Values before the
 * period is filled are NaN. Range 0..100; 50 = neutral.
 */
export function rsiSeries(closes: number[], period = RSI_PERIOD): number[] {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Drawdown magnitude (0..1) from the trailing `window`-day high, inclusive. */
export function drawdown(closes: number[], i: number, window: number): number {
  const start = Math.max(0, i - window + 1);
  let hi = -Infinity;
  for (let j = start; j <= i; j++) if (Number.isFinite(closes[j]) && closes[j] > hi) hi = closes[j];
  if (!Number.isFinite(hi) || hi <= 0) return NaN;
  return (hi - closes[i]) / hi;
}

/** Equal-weight average of the finite z-scores; null if none are available. */
export function blendZ(zs: (number | null)[]): number | null {
  const v = zs.filter((z): z is number => z != null && Number.isFinite(z));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/**
 * Weighted average of finite z-scores using `weights` (same order/length).
 * Missing factors are dropped and the remaining weights renormalized, so a
 * warm-up gap in one factor doesn't bias the blend. Null if nothing is finite.
 */
export function blendZWeighted(zs: (number | null)[], weights: number[]): number | null {
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    const w = weights[i] ?? 0;
    if (z != null && Number.isFinite(z) && w !== 0) {
      sum += z * w;
      wsum += Math.abs(w);
    }
  }
  return wsum === 0 ? null : sum / wsum;
}

// ---------------------------------------------------------------------------
// Series alignment
// ---------------------------------------------------------------------------

/**
 * Align many raw ticker series onto the SPX trading-day axis. For every SPX
 * date, each other series contributes its value on that date, or the most recent
 * prior value (forward-fill) if that day is missing. Leading rows where any
 * series has no prior value are dropped so downstream features start clean.
 */
export function alignSeries(series: Record<keyof Omit<AlignedRow, "date">, SeriesPoint[]>): AlignedRow[] {
  const keys = Object.keys(series) as (keyof Omit<AlignedRow, "date">)[];
  const maps = new Map<string, Map<string, number>>();
  for (const k of keys) {
    const m = new Map<string, number>();
    for (const p of series[k]) if (Number.isFinite(p.close)) m.set(p.date, p.close);
    maps.set(k, m);
  }

  const spxDates = series.spx.filter((p) => Number.isFinite(p.close)).map((p) => p.date);
  const sortedDates = [...spxDates].sort();

  const last: Record<string, number> = {};
  const rows: AlignedRow[] = [];
  for (const date of sortedDates) {
    const row: Partial<AlignedRow> = { date };
    let complete = true;
    for (const k of keys) {
      const v = maps.get(k)!.get(date);
      if (v != null) last[k] = v;
      if (last[k] == null) complete = false;
      else (row as Record<string, number>)[k] = last[k];
    }
    if (complete) rows.push(row as AlignedRow);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Build the raw (pre-z-score) factor series for each sub-index. Exposed so the
 * optimizer can measure each factor's predictive power independently and so
 * `computeAnomaly` has a single source of truth for factor definitions. Arrays
 * are returned in FRAGILITY_FACTORS / EUPHORIA_FACTORS order.
 */
export function buildFactors(rows: AlignedRow[], p: AnomalyParams = DEFAULT_PARAMS) {
  const spx = rows.map((r) => r.spx);
  const ret = logReturns(spx);

  const vixTS = rows.map((r) => (r.vix3m > 0 ? r.vix / r.vix3m : NaN)); // >1 = backwardation
  const creditRatio = rows.map((r) => (r.lqd > 0 ? r.hyg / r.lqd : NaN));
  const moveLvl = rows.map((r) => r.move);
  const rvol = rows.map((_, i) => realizedVol(ret, i, p.rvolWindow));
  const dd = rows.map((_, i) => drawdown(spx, i, p.ddWindow));

  const ext = rows.map((_, i) => {
    const m = sma(spx, i, p.smaLong);
    return Number.isFinite(m) && m > 0 ? (spx[i] - m) / m : NaN;
  });
  const sharpe = rows.map((_, i) => {
    if (i < p.sharpeWindow) return NaN;
    const w = ret.slice(i - p.sharpeWindow + 1, i + 1);
    const s = std(w);
    return Number.isFinite(s) && s > 0 ? mean(w) / s : NaN;
  });
  const cgRatio = rows.map((r) => (r.gld > 0 ? r.cper / r.gld : NaN));
  const cgMom = cgRatio.map((_, i) => pctChange(cgRatio, i, p.cgMomWindow));
  const riskRatio = rows.map((r) => (r.tlt > 0 ? r.spx / r.tlt : NaN));
  const riskMom = riskRatio.map((_, i) => pctChange(riskRatio, i, p.riskMomWindow));
  // Credit STRESS = negative momentum of HYG/LQD (ratio falling => widening spreads).
  const creditStress = creditRatio.map((_, i) => -pctChange(creditRatio, i, p.creditMomWindow));
  const rsi = rsiSeries(spx, p.rsiPeriod);

  return {
    fragility: [vixTS, creditStress, moveLvl, rvol, dd], // matches FRAGILITY_FACTORS
    euphoria: [ext, sharpe, cgMom, riskMom, rsi], // matches EUPHORIA_FACTORS
  };
}

/**
 * Compute the full SFEC time series from aligned daily rows. Output rows mirror
 * the input dates; sub-index/composite values are null until enough trailing
 * history exists for the z-score window. Pass `params` to evaluate alternative
 * settings (the optimizer does this); omit for production defaults.
 */
export function computeAnomaly(rows: AlignedRow[], params: AnomalyParams = DEFAULT_PARAMS): AnomalyPoint[] {
  const n = rows.length;
  const { fragility: fFac, euphoria: eFac } = buildFactors(rows, params);
  const w = params.zWindow;

  const out: AnomalyPoint[] = [];
  let state: SignalKind = "neutral";
  let crashStreak = 0;
  let boomStreak = 0;

  for (let i = 0; i < n; i++) {
    const fragility = blendZWeighted(
      fFac.map((s) => rollingZ(s, i, w)),
      params.fragilityWeights,
    );
    const euphoria = blendZWeighted(
      eFac.map((s) => rollingZ(s, i, w)),
      params.euphoriaWeights,
    );
    const composite = fragility != null && euphoria != null ? euphoria - fragility : null;

    // Signal state machine: confirmation to enter, hysteresis to exit.
    if (fragility != null && euphoria != null) {
      const crashArmed = fragility >= params.crashEnter;
      const boomArmed = euphoria >= params.boomEuphoriaEnter && fragility < params.boomFragilityMax;
      crashStreak = crashArmed ? crashStreak + 1 : 0;
      boomStreak = boomArmed ? boomStreak + 1 : 0;

      if (state === "crash") {
        if (fragility < params.crashExit) state = "neutral";
      } else if (state === "boom") {
        if (euphoria < params.boomEuphoriaExit || fragility >= params.crashEnter) state = "neutral";
      }
      // Crash takes priority over boom when both somehow qualify.
      if (state !== "crash" && crashStreak >= params.confirmDays) state = "crash";
      else if (state === "neutral" && boomStreak >= params.confirmDays) state = "boom";
    }

    out.push({
      date: rows[i].date,
      spx: rows[i].spx,
      shortRate: rows[i].irx,
      yieldCurve: rows[i].tnx - rows[i].irx,
      fragility,
      euphoria,
      composite,
      signal: fragility == null ? "neutral" : state,
    });
  }
  return out;
}

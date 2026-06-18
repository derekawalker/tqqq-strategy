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

export const Z_WINDOW = 252; // ~1 trading year trailing window for z-scores
export const RVOL_WINDOW = 20; // realized-vol lookback (days)
export const SMA_LONG = 200; // long moving average for extension
export const SHARPE_WINDOW = 60; // trend-quality lookback
export const CG_MOM_WINDOW = 60; // copper/gold momentum lookback
export const RISK_MOM_WINDOW = 20; // stocks/bonds momentum lookback
export const CREDIT_MOM_WINDOW = 20; // credit-ratio momentum lookback
export const RSI_PERIOD = 14;

// Signal thresholds (in composite z-units) with hysteresis to avoid whipsaws.
export const CRASH_ENTER = 1.5; // fragility z to arm a crash signal
export const CRASH_EXIT = 0.5; // fragility z to stand down
export const BOOM_EUPHORIA_ENTER = 1.0;
export const BOOM_FRAGILITY_MAX = 0.75; // boom only allowed when fragility is calm
export const BOOM_EUPHORIA_EXIT = 0.25;
export const CONFIRM_DAYS = 2; // consecutive days required to flip state

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
 * Compute the full SFEC time series from aligned daily rows. Output rows mirror
 * the input dates; sub-index/composite values are null until enough trailing
 * history exists for the z-score window.
 */
export function computeAnomaly(rows: AlignedRow[]): AnomalyPoint[] {
  const n = rows.length;
  const spx = rows.map((r) => r.spx);
  const ret = logReturns(spx);

  // --- raw feature series (full length) ---
  const vixTS = rows.map((r) => (r.vix3m > 0 ? r.vix / r.vix3m : NaN)); // >1 = backwardation
  const creditRatio = rows.map((r) => (r.lqd > 0 ? r.hyg / r.lqd : NaN));
  const moveLvl = rows.map((r) => r.move);
  const rvol = rows.map((_, i) => realizedVol(ret, i, RVOL_WINDOW));
  const dd = rows.map((_, i) => drawdown(spx, i, Z_WINDOW));

  const ext = rows.map((_, i) => {
    const m = sma(spx, i, SMA_LONG);
    return Number.isFinite(m) && m > 0 ? (spx[i] - m) / m : NaN;
  });
  const sharpe = rows.map((_, i) => {
    if (i < SHARPE_WINDOW) return NaN;
    const w = ret.slice(i - SHARPE_WINDOW + 1, i + 1);
    const s = std(w);
    return Number.isFinite(s) && s > 0 ? mean(w) / s : NaN;
  });
  const cgRatio = rows.map((r) => (r.gld > 0 ? r.cper / r.gld : NaN));
  const cgMom = cgRatio.map((_, i) => pctChange(cgRatio, i, CG_MOM_WINDOW));
  const riskRatio = rows.map((r) => (r.tlt > 0 ? r.spx / r.tlt : NaN));
  const riskMom = riskRatio.map((_, i) => pctChange(riskRatio, i, RISK_MOM_WINDOW));
  // Credit STRESS = negative momentum of HYG/LQD (ratio falling => widening spreads).
  const creditStress = creditRatio.map((_, i) => -pctChange(creditRatio, i, CREDIT_MOM_WINDOW));
  const rsi = rsiSeries(spx, RSI_PERIOD);

  // --- assemble per-day output with rolling z-scores + signal state machine ---
  const out: AnomalyPoint[] = [];
  let state: SignalKind = "neutral";
  let crashStreak = 0;
  let boomStreak = 0;

  for (let i = 0; i < n; i++) {
    const fragility = blendZ([
      rollingZ(vixTS, i, Z_WINDOW),
      rollingZ(creditStress, i, Z_WINDOW),
      rollingZ(moveLvl, i, Z_WINDOW),
      rollingZ(rvol, i, Z_WINDOW),
      rollingZ(dd, i, Z_WINDOW),
    ]);
    const euphoria = blendZ([
      rollingZ(ext, i, Z_WINDOW),
      rollingZ(sharpe, i, Z_WINDOW),
      rollingZ(cgMom, i, Z_WINDOW),
      rollingZ(riskMom, i, Z_WINDOW),
      rollingZ(rsi, i, Z_WINDOW),
    ]);
    const composite = fragility != null && euphoria != null ? euphoria - fragility : null;

    // Signal state machine: confirmation to enter, hysteresis to exit.
    if (fragility != null && euphoria != null) {
      const crashArmed = fragility >= CRASH_ENTER;
      const boomArmed = euphoria >= BOOM_EUPHORIA_ENTER && fragility < BOOM_FRAGILITY_MAX;
      crashStreak = crashArmed ? crashStreak + 1 : 0;
      boomStreak = boomArmed ? boomStreak + 1 : 0;

      if (state === "crash") {
        if (fragility < CRASH_EXIT) state = "neutral";
      } else if (state === "boom") {
        if (euphoria < BOOM_EUPHORIA_EXIT || fragility >= CRASH_ENTER) state = "neutral";
      }
      // Crash takes priority over boom when both somehow qualify.
      if (state !== "crash" && crashStreak >= CONFIRM_DAYS) state = "crash";
      else if (state === "neutral" && boomStreak >= CONFIRM_DAYS) state = "boom";
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

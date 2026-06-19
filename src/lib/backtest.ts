/**
 * Backtest & leading-indicator validation for the SFEC anomaly signal.
 *
 * Two complementary questions are answered here:
 *
 *  1. STRATEGY P&L — if you had acted on the signal (crash → T-bills, boom →
 *     leveraged equity, neutral → benchmark), how would the equity curve and
 *     risk-adjusted metrics compare to simply buying and holding the benchmark?
 *
 *  2. LEADING-INDICATOR ACCURACY — independent of any trading rule, does the
 *     signal actually *precede* market moves? The forward-return event study
 *     measures average future returns and directional hit-rates conditional on
 *     the signal state, so we can see whether crash days are followed by declines
 *     and boom days by gains (vs. the unconditional baseline).
 *
 * All functions are pure. To avoid look-ahead in the P&L, the position on day i
 * is set from the signal observed on day i-1 (a realistic one-day execution lag).
 */

import type { AnomalyPoint, SignalKind } from "./anomaly";
import { mean, std } from "./anomaly";

const TRADING_DAYS = 252;

export interface StrategyOptions {
  /** Equity exposure when the signal is "boom" (e.g. 3 for a 3× leveraged ETF). */
  boomLeverage: number;
  /** Equity exposure when "neutral" (1 = benchmark). */
  neutralLeverage: number;
  /** Equity exposure when "crash" (0 = fully in cash earning the T-bill rate). */
  crashLeverage: number;
}

export const DEFAULT_OPTIONS: StrategyOptions = {
  boomLeverage: 3,
  neutralLeverage: 1,
  crashLeverage: 0,
};

/**
 * Two ways to act on the signal:
 *  - "trend": take the signal at face value — risk-on in booms, cash in crashes.
 *  - "contrarian": fade it — because the signal is empirically a mean-reversion
 *    indicator (high fragility marks bottoms, euphoria precedes weakness), this
 *    stays invested through crashes and steps aside (to cash) during euphoria.
 */
export type StrategyMode = "trend" | "contrarian";

/**
 * Map a mode + leverage knob to per-state exposures. In contrarian mode the
 * leverage applies to the crash state (buy the dip); in trend mode it applies
 * to the boom state (ride the melt-up). Neutral is always the benchmark.
 */
export function strategyOptionsFor(mode: StrategyMode, leverage: number): StrategyOptions {
  return mode === "contrarian"
    ? { crashLeverage: leverage, neutralLeverage: 1, boomLeverage: 0 }
    : { crashLeverage: 0, neutralLeverage: 1, boomLeverage: leverage };
}

export interface EquityPoint {
  date: string;
  strategy: number; // growth of $1
  benchmark: number; // buy & hold growth of $1
  signal: SignalKind;
}

export interface PerfMetrics {
  totalReturn: number;
  cagr: number;
  annVol: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number; // negative number (e.g. -0.34)
  calmar: number;
}

export interface ForwardRow {
  horizon: number; // trading days ahead
  all: number; // unconditional mean forward return
  crash: number | null; // mean forward return on crash-signal days
  boom: number | null;
  neutral: number | null;
  crashHitRate: number | null; // P(forward return < 0 | crash) — crash "accuracy"
  boomHitRate: number | null; // P(forward return > 0 | boom) — boom "accuracy"
  crashDays: number;
  boomDays: number;
}

export interface BacktestResult {
  equity: EquityPoint[];
  strategy: PerfMetrics;
  benchmark: PerfMetrics;
  forward: ForwardRow[];
  signalDays: Record<SignalKind, number>;
}

export interface TradeSignal {
  date: string;
  spx: number;
  action: "buy" | "sell";
}

/**
 * Collapse the crash/boom/neutral state stream into a single discrete BUY/SELL
 * signal — the combined actionable read. Because the indicator is contrarian, a
 * crash-state onset (fear) is a BUY and a boom-state onset (greed) is a SELL.
 * One event per state transition (the entry day), so it can be drawn as entry/
 * exit markers on the price chart.
 */
export function tradeSignals(points: AnomalyPoint[]): TradeSignal[] {
  const out: TradeSignal[] = [];
  let prev: SignalKind = "neutral";
  for (const p of points) {
    if (p.signal !== prev) {
      if (p.signal === "crash") out.push({ date: p.date, spx: p.spx, action: "buy" });
      else if (p.signal === "boom") out.push({ date: p.date, spx: p.spx, action: "sell" });
      prev = p.signal;
    }
  }
  return out;
}

function exposureFor(signal: SignalKind, opts: StrategyOptions): number {
  if (signal === "crash") return opts.crashLeverage;
  if (signal === "boom") return opts.boomLeverage;
  return opts.neutralLeverage;
}

/** Max drawdown of an equity curve as a negative fraction. */
export function maxDrawdown(equity: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = v / peak - 1;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

/**
 * Risk-adjusted metrics from a daily-return series and its equity curve.
 * `dailyCashRate` is the per-day risk-free rate used for Sharpe/Sortino excess.
 */
export function performance(rets: number[], equity: number[], dailyCashRate: number[]): PerfMetrics {
  const n = rets.length;
  if (n === 0) {
    return { totalReturn: 0, cagr: 0, annVol: 0, sharpe: 0, sortino: 0, maxDrawdown: 0, calmar: 0 };
  }
  const totalReturn = equity[equity.length - 1] / equity[0] - 1;
  const cagr = Math.pow(equity[equity.length - 1] / equity[0], TRADING_DAYS / n) - 1;
  const annVol = std(rets) * Math.sqrt(TRADING_DAYS);

  const excess = rets.map((r, i) => r - (dailyCashRate[i] ?? 0));
  const annExcess = mean(excess) * TRADING_DAYS;
  const downside = excess.map((e) => (e < 0 ? e : 0));
  const downsideDev = Math.sqrt(mean(downside.map((d) => d * d))) * Math.sqrt(TRADING_DAYS);

  const dd = maxDrawdown(equity);
  return {
    totalReturn,
    cagr,
    annVol,
    sharpe: annVol > 0 ? annExcess / annVol : 0,
    sortino: downsideDev > 0 ? annExcess / downsideDev : 0,
    maxDrawdown: dd,
    calmar: dd < 0 ? cagr / Math.abs(dd) : 0,
  };
}

/**
 * Forward-return event study: for each horizon, the mean SPX forward return
 * conditional on the current signal, plus directional hit-rates. This is the
 * core "is it a leading indicator?" test — it uses the raw signal, not the
 * traded strategy, so it isn't influenced by leverage assumptions.
 */
export function forwardStudy(points: AnomalyPoint[], horizons = [5, 21, 63]): ForwardRow[] {
  const spx = points.map((p) => p.spx);
  const n = points.length;

  return horizons.map((h) => {
    const all: number[] = [];
    const crash: number[] = [];
    const boom: number[] = [];
    const neutral: number[] = [];
    for (let i = 0; i + h < n; i++) {
      const fwd = spx[i + h] / spx[i] - 1;
      all.push(fwd);
      if (points[i].signal === "crash") crash.push(fwd);
      else if (points[i].signal === "boom") boom.push(fwd);
      else neutral.push(fwd);
    }
    const avg = (xs: number[]) => (xs.length ? mean(xs) : null);
    const rate = (xs: number[], pred: (x: number) => boolean) =>
      xs.length ? xs.filter(pred).length / xs.length : null;
    return {
      horizon: h,
      all: mean(all),
      crash: avg(crash),
      boom: avg(boom),
      neutral: avg(neutral),
      crashHitRate: rate(crash, (x) => x < 0),
      boomHitRate: rate(boom, (x) => x > 0),
      crashDays: crash.length,
      boomDays: boom.length,
    };
  });
}

/**
 * Run the full backtest. `points` should already be restricted to the
 * post-warm-up region (where the signal is live); callers typically filter on
 * `composite != null` first.
 */
export function backtest(
  points: AnomalyPoint[],
  opts: StrategyOptions = DEFAULT_OPTIONS,
  horizons = [5, 21, 63],
): BacktestResult {
  const signalDays: Record<SignalKind, number> = { crash: 0, boom: 0, neutral: 0 };
  for (const p of points) signalDays[p.signal]++;

  const stratRets: number[] = [];
  const benchRets: number[] = [];
  const cashRates: number[] = [];
  const equity: EquityPoint[] = [];
  let stratEq = 1;
  let benchEq = 1;

  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      equity.push({ date: points[i].date, strategy: 1, benchmark: 1, signal: points[i].signal });
      continue;
    }
    const benchRet = points[i].spx / points[i - 1].spx - 1;
    // Position is set by YESTERDAY's signal (one-day execution lag, no look-ahead).
    const exposure = exposureFor(points[i - 1].signal, opts);
    const dailyCash = points[i - 1].shortRate / 100 / TRADING_DAYS;
    // Capital not in equity earns the cash rate (matters when exposure < 1).
    const stratRet = exposure * benchRet + (1 - exposure) * dailyCash;

    stratEq *= 1 + stratRet;
    benchEq *= 1 + benchRet;
    stratRets.push(stratRet);
    benchRets.push(benchRet);
    cashRates.push(dailyCash);
    equity.push({ date: points[i].date, strategy: stratEq, benchmark: benchEq, signal: points[i].signal });
  }

  const stratEqArr = equity.map((e) => e.strategy);
  const benchEqArr = equity.map((e) => e.benchmark);

  return {
    equity,
    strategy: performance(stratRets, stratEqArr, cashRates),
    benchmark: performance(benchRets, benchEqArr, cashRates),
    forward: forwardStudy(points, horizons),
    signalDays,
  };
}

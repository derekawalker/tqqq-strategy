/**
 * Daily market advice: a 3-message system — "trade as normal", "get out of the
 * market", or "get back in" — built on what the turning-point study showed each
 * indicator is actually good at:
 *
 *  - GET OUT uses a trend break (price falling decisively below its long moving
 *    average), because the euphoria factors do NOT reliably lead market tops —
 *    several major tops (e.g. Feb 2025) had no euphoria warning at all. So the
 *    exit reacts to the downtrend itself rather than trying to predict the top.
 *
 *  - GET BACK IN uses the composite hitting a capitulation extreme, because the
 *    fragility factors DO mark bottoms with lead time (the composite was already
 *    deeply negative 5-10 days before the 2018, 2020 and 2025 lows). This lets
 *    you re-enter near the low instead of waiting for price to climb all the way
 *    back above the moving average. A confirmed move back above the average is a
 *    fallback re-entry for slower recoveries.
 *
 * Confirmation (consecutive days) + a hysteresis band keep switches infrequent
 * so the advice is actionable rather than whipsawing. Pure / no IO.
 */

import { sma, type AnomalyPoint } from "./anomaly";
import { performance, type PerfMetrics } from "./backtest";

export interface AdviceParams {
  maPeriod: number; // long moving average for the trend test
  band: number; // hysteresis band around the MA (fraction, e.g. 0.03 = ±3%)
  confirmDays: number; // consecutive days required to flip the trend stance
  capitulation: number; // composite z below which to snap back in (buy the panic)
}

export const DEFAULT_ADVICE: AdviceParams = {
  maPeriod: 200,
  band: 0.03,
  confirmDays: 3,
  capitulation: -3,
};

export type Stance = "in" | "out";
export type AdviceAction = "normal" | "get-out" | "get-back-in";

export interface AdvicePoint {
  date: string;
  spx: number;
  ma: number | null;
  stance: Stance;
  action: AdviceAction; // what to DO today ("normal" = no change)
  reason: string;
}

/**
 * Produce the daily advice series. Pass the FULL computeAnomaly output (all
 * rows, including warm-up) so the moving average can be computed over complete
 * price history; advice only changes once the MA is available.
 */
export function dailyAdvice(points: AnomalyPoint[], p: AdviceParams = DEFAULT_ADVICE): AdvicePoint[] {
  const spx = points.map((pt) => pt.spx);
  const out: AdvicePoint[] = [];
  let stance: Stance = "in";
  let belowN = 0;
  let aboveN = 0;

  for (let i = 0; i < points.length; i++) {
    const maRaw = sma(spx, i, p.maPeriod);
    const ma = Number.isFinite(maRaw) ? maRaw : null;
    let action: AdviceAction = "normal";
    let reason = "";

    if (ma != null) {
      const below = spx[i] < ma * (1 - p.band);
      const above = spx[i] > ma * (1 + p.band);
      belowN = below ? belowN + 1 : 0;
      aboveN = above ? aboveN + 1 : 0;
      const comp = points[i].composite;
      const pctBand = Math.round(p.band * 100);

      if (stance === "in") {
        if (belowN >= p.confirmDays) {
          stance = "out";
          action = "get-out";
          reason = `S&P ${pctBand}%+ below its ${p.maPeriod}-day average for ${p.confirmDays} days — downtrend confirmed`;
        }
      } else {
        if (comp != null && comp < p.capitulation) {
          stance = "in";
          action = "get-back-in";
          reason = `Capitulation extreme (composite ${comp.toFixed(1)}) — fear levels that historically mark bottoms`;
        } else if (aboveN >= p.confirmDays) {
          stance = "in";
          action = "get-back-in";
          reason = `S&P back ${pctBand}%+ above its ${p.maPeriod}-day average for ${p.confirmDays} days — uptrend resumed`;
        }
      }
    }

    if (action === "normal") {
      reason = stance === "in" ? "Uptrend intact — stay invested, trade as normal" : "Downtrend — stay out / in cash";
    }

    out.push({ date: points[i].date, spx: spx[i], ma, stance, action, reason });
  }
  return out;
}

export interface AdviceEquityPoint {
  date: string;
  strategy: number;
  benchmark: number;
  stance: Stance;
}

export interface AdviceBacktest {
  equity: AdviceEquityPoint[];
  strategy: PerfMetrics;
  benchmark: PerfMetrics;
  switches: number; // number of get-out / get-back-in changes
  pctInMarket: number;
}

/**
 * Backtest following the advice: invested (1×) when stance is "in", in cash
 * earning the T-bill rate when "out". Position uses the prior day's stance
 * (1-day execution lag). Begins once the moving average is available.
 */
export function backtestAdvice(advice: AdvicePoint[], points: AnomalyPoint[]): AdviceBacktest {
  const start = advice.findIndex((a) => a.ma != null);
  const equity: AdviceEquityPoint[] = [];
  const stratRets: number[] = [];
  const benchRets: number[] = [];
  const cashRates: number[] = [];
  let stratEq = 1;
  let benchEq = 1;
  let switches = 0;
  let inDays = 0;
  let counted = 0;

  if (start < 0) {
    return {
      equity,
      strategy: performance([], [], []),
      benchmark: performance([], [], []),
      switches: 0,
      pctInMarket: 0,
    };
  }

  for (let i = start; i < points.length; i++) {
    if (advice[i].action !== "normal") switches++;
    if (i === start) {
      equity.push({ date: points[i].date, strategy: 1, benchmark: 1, stance: advice[i].stance });
      continue;
    }
    const benchRet = points[i].spx / points[i - 1].spx - 1;
    const invested = advice[i - 1].stance === "in";
    const dailyCash = points[i - 1].shortRate / 100 / 252;
    const stratRet = invested ? benchRet : dailyCash;

    stratEq *= 1 + stratRet;
    benchEq *= 1 + benchRet;
    stratRets.push(stratRet);
    benchRets.push(benchRet);
    cashRates.push(dailyCash);
    counted++;
    if (invested) inDays++;
    equity.push({ date: points[i].date, strategy: stratEq, benchmark: benchEq, stance: advice[i].stance });
  }

  return {
    equity,
    strategy: performance(stratRets, equity.map((e) => e.strategy), cashRates),
    benchmark: performance(benchRets, equity.map((e) => e.benchmark), cashRates),
    switches,
    pctInMarket: counted > 0 ? inDays / counted : 0,
  };
}

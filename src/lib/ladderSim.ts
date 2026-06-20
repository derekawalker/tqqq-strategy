/**
 * Daily backtest of the TQQQ ladder (the strategy in computeLevels), with an
 * optional "pause buying" mask from the quick-bear circuit breaker.
 *
 * Ladder mechanics (limit-order model on daily bars, using the intraday range):
 *  - 88 levels; level n buys at anchor·(1 − stepPct·n/100) and sells that lot at
 *    its buyPrice·(1 + sellPct/100). Lot sizing is geometric (reductionFactor),
 *    normalized so deploying every level costs ≈ startingCash.
 *  - Each day: sell any owned lot whose sell limit is inside the day's range
 *    (high ≥ sellPrice), then — unless paused — buy any un-owned lot whose buy
 *    limit is touched (low ≤ buyPrice). Using high/low (not just close) captures
 *    the intraday level touches a ladder actually trades on. A lot bought today
 *    can't also be sold today (no same-day round trip) — calibration against
 *    hourly TQQQ shows this lands within ~16% of true intraday harvest, whereas
 *    close-only understates it ~35% and same-day round trips overstate it ~40%.
 *  - Re-anchor: when flat (no lots) and the close makes a new high above the
 *    anchor, the grid trails up.
 *
 * This is a simplified, fixed-size ladder (sizing uses startingCash, realized
 * profit accumulates as cash). Absolute returns depend on the anchor/params, so
 * it's meant for an apples-to-apples comparison of ladder vs. ladder + breaker —
 * the breaker's value (avoided drawdown / preserved dry powder) is robust to the
 * exact ladder assumptions.
 */

import { computeLevels, type Level } from "./levels";

export interface LadderParams {
  startingCash: number;
  stepPct: number; // % step between levels (the app uses 1)
  sellPct: number; // % gain target per lot
  reductionFactor: number;
  reanchorPct: number; // re-anchor up when a new high exceeds the anchor by this fraction
}

export const DEFAULT_LADDER: LadderParams = {
  startingCash: 100000,
  stepPct: 1,
  sellPct: 5,
  reductionFactor: 1,
  reanchorPct: 0,
};

export interface LadderResult {
  equity: { date: string; value: number }[];
  finalValue: number;
  totalReturn: number;
  maxDrawdown: number;
  realizedProfit: number;
  buys: number;
  sells: number;
  /** Worst single-day deployed fraction (lots' market value / equity) — exposure. */
  peakInvested: number;
}

interface Bar {
  date: string;
  close: number;
  high?: number; // intraday range; falls back to close when absent
  low?: number;
}

// computeLevels hard-codes a 1% step / 88 levels; rebuild with our stepPct.
// (computeLevels' geometric normalization divides by zero at R=1, so handle the
// uniform case here.)
function levelsAt(anchor: number, p: LadderParams): Level[] {
  const N = 88;
  const R = p.reductionFactor;
  if (p.stepPct === 1 && R !== 1) return computeLevels(p.startingCash, anchor, p.sellPct, R);
  const K = R === 1 ? 1 / N : (1 - R) / (1 - Math.pow(R, N));
  return Array.from({ length: N }, (_, n) => {
    const buyPrice = anchor * (1 - 0.01 * p.stepPct * n);
    const alloc = p.startingCash * (R === 1 ? 1 / N : K * Math.pow(R, n));
    const shares = Math.round(alloc / buyPrice);
    return { n, buyPrice, sellPrice: buyPrice * (1 + p.sellPct / 100), shares, cost: 0, purchased: false };
  });
}

/**
 * Run the ladder over `bars`. `paused[i]` (optional, aligned to bars) suppresses
 * buying on that day (the circuit breaker). Returns the equity curve and stats.
 */
export function simulateLadder(bars: Bar[], p: LadderParams = DEFAULT_LADDER, paused?: boolean[]): LadderResult {
  if (bars.length === 0) {
    return { equity: [], finalValue: 0, totalReturn: 0, maxDrawdown: 0, realizedProfit: 0, buys: 0, sells: 0, peakInvested: 0 };
  }
  let anchor = bars[0].close;
  let levels = levelsAt(anchor, p);
  const owned = new Array(levels.length).fill(false);
  let cash = p.startingCash;
  let realized = 0;
  let buys = 0;
  let sells = 0;
  let peakInvested = 0;

  const equity: { date: string; value: number }[] = [];

  for (let i = 0; i < bars.length; i++) {
    const close = bars[i].close;
    const hi = bars[i].high ?? close;
    const lo = bars[i].low ?? close;

    // 1) Sells: any owned lot whose sell limit is inside the day's range.
    for (let n = 0; n < levels.length; n++) {
      if (owned[n] && hi >= levels[n].sellPrice) {
        cash += levels[n].shares * levels[n].sellPrice;
        realized += levels[n].shares * (levels[n].sellPrice - levels[n].buyPrice);
        owned[n] = false;
        sells++;
      }
    }

    // 2) Buys: un-owned lots whose buy limit is touched (unless paused). A lot
    //    bought today is NOT eligible to sell today (no same-day round trip).
    if (!paused?.[i]) {
      for (let n = 0; n < levels.length; n++) {
        if (!owned[n] && lo <= levels[n].buyPrice) {
          const cost = levels[n].shares * levels[n].buyPrice;
          if (levels[n].shares > 0 && cash >= cost) {
            cash -= cost;
            owned[n] = true;
            buys++;
          }
        }
      }
    }

    // 3) Re-anchor the grid up when flat and the close makes a new high.
    const anyOwned = owned.some(Boolean);
    if (!anyOwned && close > anchor * (1 + p.reanchorPct)) {
      anchor = close;
      levels = levelsAt(anchor, p);
      owned.fill(false);
    }

    // 4) Mark to market at the close.
    let lotValue = 0;
    for (let n = 0; n < levels.length; n++) if (owned[n]) lotValue += levels[n].shares * close;
    const value = cash + lotValue;
    equity.push({ date: bars[i].date, value });
    if (value > 0) peakInvested = Math.max(peakInvested, lotValue / value);
  }

  const start = equity[0].value;
  const finalValue = equity[equity.length - 1].value;
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const e of equity) {
    if (e.value > peak) peak = e.value;
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, e.value / peak - 1);
  }

  return {
    equity,
    finalValue,
    totalReturn: finalValue / start - 1,
    maxDrawdown,
    realizedProfit: realized,
    buys,
    sells,
    peakInvested,
  };
}

import type { Level } from "./levels";

/**
 * Market-stat + adaptive-grid helpers for the Optimized Levels page.
 *
 * This module is intentionally standalone: it never touches the static ladder in levels.ts
 * (computeLevels / matchLevel / computeCurrentLevel), so position attribution on the existing
 * pages is unaffected. The Optimized Levels page owns no positions, so it can recompute a fully
 * vol-adaptive grid on every refresh without any history to mis-map.
 */

export type Regime = "risk-on" | "neutral" | "risk-off";

/** Annualized volatility (%) from the trailing `window` daily closes, oldest→newest. */
export function annualizedVol(closes: number[], window = 20): number {
  if (closes.length < window + 1) return 0;
  const recent = closes.slice(-(window + 1));
  const rets: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    if (prev > 0 && recent[i] > 0) rets.push(Math.log(recent[i] / prev));
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/** Simple moving average of the trailing `window` closes; 0 if there aren't enough. */
export function sma(closes: number[], window = 200): number {
  if (closes.length < window) return 0;
  const recent = closes.slice(-window);
  return recent.reduce((a, b) => a + b, 0) / window;
}

/** Per-day moving average aligned to `closes`; null until `window` points are available. */
export function rollingSma(closes: number[], window: number): (number | null)[] {
  return closes.map((_, i) => (i + 1 >= window ? sma(closes.slice(0, i + 1), window) : null));
}

/** Per-day annualized vol (%) aligned to `closes`; null until `window`+1 points are available. */
export function rollingVol(closes: number[], window: number): (number | null)[] {
  return closes.map((_, i) => (i >= window ? annualizedVol(closes.slice(0, i + 1), window) : null));
}

/**
 * Regime from price vs its long moving average, with a symmetric dead-band (%) so price hovering
 * around the average doesn't whipsaw the signal. risk-on above the band, risk-off below it.
 */
export function computeRegime(price: number, movingAvg: number, bandPercent = 1.5): Regime {
  if (movingAvg <= 0) return "neutral";
  const pct = ((price - movingAvg) / movingAvg) * 100;
  if (pct > bandPercent) return "risk-on";
  if (pct < -bandPercent) return "risk-off";
  return "neutral";
}

/** Scale `base` by current/baseline vol, clamped to [min, max]. Falls back to `base` if no baseline. */
export function scaleByVol(base: number, rv: number, baseRv: number, min: number, max: number): number {
  if (baseRv <= 0) return base;
  return Math.min(max, Math.max(min, base * (rv / baseRv)));
}

export interface AdaptiveLevelParams {
  levelStartingCash: number;
  initialLotPrice: number;
  reductionFactor: number;
  /** Percent gap between adjacent rungs, e.g. 1.4 for 1.4%. Applied geometrically. */
  spacingPercent: number;
  /** Percent above each buy price to target as the sell, e.g. 7 for 7%. */
  sellPercent: number;
  count?: number;
}

/**
 * Adaptive buy/sell ladder. Spacing is geometric — `buyPrice = initialLotPrice · (1 − s)^n` — so it
 * stays positive at any spacing (the static ladder's arithmetic `1 − 0.01n` goes negative once
 * spacing widens past ~1.1%). Capital allocation reuses the same geometric reductionFactor curve as
 * computeLevels so the two ladders are comparable apples-to-apples.
 */
export function computeAdaptiveLevels(p: AdaptiveLevelParams): Level[] {
  const count = p.count ?? 88;
  const R = p.reductionFactor;
  const K = (1 - R) / (1 - Math.pow(R, count));
  const step = 1 - p.spacingPercent / 100;

  return Array.from({ length: count }, (_, n) => {
    const buyPrice = p.initialLotPrice * Math.pow(step, n);
    const allocated = p.levelStartingCash * K * Math.pow(R, n);
    const shares = Math.round(allocated / buyPrice);
    const cost = shares * buyPrice;
    const sellPrice = buyPrice * (1 + p.sellPercent / 100);
    return { n, buyPrice, sellPrice, shares, cost, purchased: false };
  });
}

export interface OptimizedLevel extends Level {
  /** true = adaptive (not-yet-owned) rung; false = locked static rung at/below the current level. */
  optimized: boolean;
}

export interface MergeOptions {
  initialLotPrice: number;
  reductionFactor: number;
  /** Adaptive spacing (%) for the prospective rungs below the current level. */
  spacingPercent: number;
  /** Adaptive sell target (%) for the prospective rungs. */
  sellPercent: number;
  levelStartingCash: number;
  count?: number;
}

/**
 * Ladder where rungs you already own keep their static buy price / shares (your real basis) and
 * rungs below the current level go adaptive. Owned rungs still take the *optimized sell %* for their
 * sell target, so the whole sell column reflects the current target. The adaptive rungs continue
 * *geometrically from the last owned rung's buy price*, so the two halves join continuously and stay
 * monotonic at any spacing (anchoring the adaptive half back at initialLotPrice could otherwise
 * overlap the owned half when vol pushes spacing below the static 1%).
 *
 * `staticLevels` is the canonical ladder from computeLevels; pass `currentLevel = -1` (nothing owned)
 * to get a fully adaptive ladder anchored at initialLotPrice.
 */
export function buildMergedLadder(
  staticLevels: Level[],
  currentLevel: number,
  opts: MergeOptions,
): OptimizedLevel[] {
  const count = opts.count ?? 88;
  const R = opts.reductionFactor;
  const K = (1 - R) / (1 - Math.pow(R, count));
  const step = 1 - opts.spacingPercent / 100;

  const result: OptimizedLevel[] = [];
  for (let n = 0; n < count; n++) {
    if (n <= currentLevel && staticLevels[n]) {
      // Keep the real basis (static buy/shares/cost); use the optimized sell target.
      const lvl = staticLevels[n];
      result.push({ ...lvl, sellPrice: lvl.buyPrice * (1 + opts.sellPercent / 100), optimized: false });
      continue;
    }
    const buyPrice = n === 0 ? opts.initialLotPrice : result[n - 1].buyPrice * step;
    const allocated = opts.levelStartingCash * K * Math.pow(R, n);
    const shares = Math.round(allocated / buyPrice);
    const cost = shares * buyPrice;
    const sellPrice = buyPrice * (1 + opts.sellPercent / 100);
    result.push({ n, buyPrice, sellPrice, shares, cost, purchased: false, optimized: true });
  }
  return result;
}

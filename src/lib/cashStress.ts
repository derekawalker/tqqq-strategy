/**
 * Cash double-commitment stress test: in a fast drop, the ladder's unpurchased
 * buy levels AND any open short TQQQ puts' assignment cost draw on the same
 * cash pool at the same time. Nothing else in the app reconciles this — the
 * put safety-level buffer only spaces strikes, it doesn't guarantee cash.
 *
 * Pure, no I/O — feed it levels/positions/price and it reports, at a sweep of
 * hypothetical prices, how much cash would be needed vs. what's on hand.
 */

import type { Level } from "./levels";

export interface ShortPut {
  strike: number;
  shortQty: number;
}

export interface CashStressPoint {
  /** Hypothetical TQQQ price for this scenario. */
  price: number;
  /** Percent move from the current price (negative = down). */
  pctFromCurrent: number;
  /** Cost of unpurchased ladder levels whose buy limit is at/above this price. */
  ladderCash: number;
  /** Assignment cost of open short TQQQ puts whose strike is at/above this price. */
  putCollateral: number;
  /** ladderCash + putCollateral. */
  totalNeeded: number;
  /** totalNeeded - cashAvailable. Positive = shortfall. */
  shortfall: number;
}

/**
 * Sweep hypothetical prices from current price down to `maxDropPct` (e.g. 0.6
 * for -60%) in `stepPct` increments, computing cash demand at each.
 *
 * @param levels           full ladder (from computeLevels)
 * @param ownedLevelIndices indices of levels currently held (bought, not yet sold)
 * @param shortPuts        open short TQQQ puts (exclude long hedge puts — those
 *                          are QQQ and don't create assignment cash demand)
 * @param currentPrice     current TQQQ price
 * @param cashAvailable    cash on hand (e.g. cashAvailableForTrading)
 */
export function computeCashStress(opts: {
  levels: Level[];
  ownedLevelIndices: Set<number>;
  shortPuts: ShortPut[];
  currentPrice: number;
  cashAvailable: number;
  maxDropPct?: number; // default 0.6 (-60%)
  stepPct?: number; // default 0.05 (5% steps)
}): CashStressPoint[] {
  const {
    levels,
    ownedLevelIndices,
    shortPuts,
    currentPrice,
    cashAvailable,
    maxDropPct = 0.6,
    stepPct = 0.05,
  } = opts;

  if (currentPrice <= 0) return [];

  const unpurchased = levels.filter((l) => !ownedLevelIndices.has(l.n));
  const points: CashStressPoint[] = [];

  for (let drop = 0; drop <= maxDropPct + 1e-9; drop += stepPct) {
    const price = currentPrice * (1 - drop);

    const ladderCash = unpurchased
      .filter((l) => l.buyPrice >= price)
      .reduce((sum, l) => sum + l.cost, 0);

    const putCollateral = shortPuts
      .filter((p) => p.strike >= price)
      .reduce((sum, p) => sum + p.strike * 100 * p.shortQty, 0);

    const totalNeeded = ladderCash + putCollateral;

    points.push({
      price,
      pctFromCurrent: -drop * 100,
      ladderCash,
      putCollateral,
      totalNeeded,
      shortfall: totalNeeded - cashAvailable,
    });
  }

  return points;
}

/** The worst (largest) shortfall across a stress sweep, or null if none/empty. */
export function worstShortfall(points: CashStressPoint[]): CashStressPoint | null {
  if (points.length === 0) return null;
  return points.reduce((worst, p) => (p.shortfall > worst.shortfall ? p : worst));
}

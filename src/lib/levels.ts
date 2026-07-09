export interface Level {
  n: number;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  cost: number;
  purchased: boolean;
}

/**
 * Match a fill to the closest level index by share count. Returns -1 if no level has that
 * share count. When multiple levels share the same count, price is used as a tiebreaker.
 */
export function matchLevel(levels: Level[], shares: number, price: number): number {
  const candidates = levels
    .map((l, i) => ({ i, diff: Math.min(Math.abs(l.buyPrice - price), Math.abs(l.sellPrice - price)) }))
    .filter((_, i) => levels[i].shares === shares);
  if (candidates.length === 0) return -1;
  return candidates.reduce((best, c) => (c.diff < best.diff ? c : best)).i;
}

export interface LevelOrderCounts {
  /** Counts keyed by level index for orders that matched a level. */
  byLevel: Map<number, { buys: number; sells: number }>;
  /** Counts keyed by share count for orders that matched no level. */
  unmatched: Map<number, { buys: number; sells: number }>;
}

/**
 * Bucket working orders per level. Each order is assigned to exactly one level —
 * the one with the matching share count whose buy/sell price is closest to the
 * order's limit price — so two levels that happen to share a share count don't
 * both claim the same order.
 */
export function countOrdersByLevel(
  levels: Level[],
  orders: { side: "BUY" | "SELL"; shares: number; limitPrice: number }[],
): LevelOrderCounts {
  const byLevel = new Map<number, { buys: number; sells: number }>();
  const unmatched = new Map<number, { buys: number; sells: number }>();
  for (const o of orders) {
    const idx = matchLevel(levels, o.shares, o.limitPrice);
    const map = idx === -1 ? unmatched : byLevel;
    const key = idx === -1 ? o.shares : idx;
    const c = map.get(key) ?? { buys: 0, sells: 0 };
    if (o.side === "BUY") c.buys++;
    else c.sells++;
    map.set(key, c);
  }
  return { byLevel, unmatched };
}

export interface FillOrder {
  side: "BUY" | "SELL";
  shares: number;
  fillPrice: number;
}

/**
 * Given a list of fills (sorted newest first) and computed levels, returns the
 * current level index (highest owned level), or -1 if nothing is owned.
 */
export function computeCurrentLevel(levels: Level[], orders: FillOrder[]): number {
  const lastFillSide = new Map<number, "BUY" | "SELL">();
  for (const o of orders) {
    const idx = matchLevel(levels, o.shares, o.fillPrice);
    if (idx === -1) continue;
    if (!lastFillSide.has(idx)) lastFillSide.set(idx, o.side);
  }

  const ownedIndices = new Set(
    [...lastFillSide.entries()].filter(([, side]) => side === "BUY").map(([i]) => i)
  );

  let currentLevel = ownedIndices.size > 0 ? Math.max(...ownedIndices) : -1;

  for (const o of orders) {
    if (o.side !== "SELL") continue;
    const idx = matchLevel(levels, o.shares, o.fillPrice);
    if (idx === -1) continue;
    if (lastFillSide.get(idx) !== "SELL") continue;
    if (currentLevel >= idx) currentLevel = idx - 1;
    break;
  }

  return currentLevel;
}

export function computeLevels(
  levelStartingCash: number,
  initialLotPrice: number,
  sellPercentage: number, // e.g. 5 for 5%
  reductionFactor: number
): Level[] {
  const R = reductionFactor;
  const K = (1 - R) / (1 - Math.pow(R, 88));

  return Array.from({ length: 88 }, (_, n) => {
    const buyPrice = initialLotPrice * (1 - 0.01 * n);
    const allocated = levelStartingCash * K * Math.pow(R, n);
    const shares = Math.round(allocated / buyPrice);
    const cost = shares * buyPrice;
    const sellPrice = buyPrice * (1 + sellPercentage / 100);
    return { n, buyPrice, sellPrice, shares, cost, purchased: false };
  });
}

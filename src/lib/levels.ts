export interface Level {
  n: number;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  cost: number;
  purchased: boolean;
}

/**
 * Match an order or fill to a level by share count. Returns -1 if no level has that
 * share count. When multiple levels share the same count, price is the tiebreaker —
 * against the side's own price (buys vs buyPrice, sells vs sellPrice). With a small
 * sell percentage a level's sell lands almost exactly on the next-higher level's buy,
 * so comparing against both prices would hand one level's sells to its neighbour.
 */
export function matchLevel(levels: Level[], side: "BUY" | "SELL", shares: number, price: number): number {
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i].shares !== shares) continue;
    const diff = Math.abs((side === "BUY" ? levels[i].buyPrice : levels[i].sellPrice) - price);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * The level the current price sits in: the one with the highest buy price at or
 * below `price`. Buy prices step by 1% of the initial lot price but each sell is only
 * sellPercentage above its own (lower) buy, so [buy, sell] bands leave gaps deeper in
 * the ladder — using the next level's buy as the upper bound covers them. Returns -1
 * when the price is below the whole ladder.
 */
export function levelForPrice(levels: Level[], price: number): number {
  for (let i = 0; i < levels.length; i++) {
    if (price >= levels[i].buyPrice) return i;
  }
  return -1;
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
    const idx = matchLevel(levels, o.side, o.shares, o.limitPrice);
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
  limitPrice?: number;
}

/**
 * Match a fill to its level. Prefers the order's limit price, which is the level's own
 * price: a limit that fills with price improvement (a gap through several levels at the
 * open) can execute nearer a neighbouring level with the same share count.
 */
export function matchFill(levels: Level[], o: FillOrder): number {
  return matchLevel(levels, o.side, o.shares, o.limitPrice ?? o.fillPrice);
}

/**
 * Given a list of fills (sorted newest first) and computed levels, returns the
 * current level index (highest owned level), or -1 if nothing is owned.
 */
export function computeCurrentLevel(levels: Level[], orders: FillOrder[]): number {
  const lastFillSide = new Map<number, "BUY" | "SELL">();
  for (const o of orders) {
    const idx = matchFill(levels, o);
    if (idx === -1) continue;
    if (!lastFillSide.has(idx)) lastFillSide.set(idx, o.side);
  }

  const ownedIndices = new Set(
    [...lastFillSide.entries()].filter(([, side]) => side === "BUY").map(([i]) => i)
  );

  let currentLevel = ownedIndices.size > 0 ? Math.max(...ownedIndices) : -1;

  for (const o of orders) {
    if (o.side !== "SELL") continue;
    const idx = matchFill(levels, o);
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

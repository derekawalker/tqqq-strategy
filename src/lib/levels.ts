export interface Level {
  n: number;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  cost: number;
  purchased: boolean;
}

/** Match a fill (shares + price) to the closest level index. Returns -1 if no match within $0.01. */
export function matchLevel(levels: Level[], shares: number, price: number): number {
  const candidates = levels
    .map((l, i) => ({ i, diff: Math.min(Math.abs(l.buyPrice - price), Math.abs(l.sellPrice - price)) }))
    .filter((_, i) => levels[i].shares === shares)
    .filter((c) => c.diff <= 0.01);
  if (candidates.length === 0) return -1;
  return candidates.reduce((best, c) => (c.diff < best.diff ? c : best)).i;
}

export function computeLevels(
  startingCash: number,
  initialLotPrice: number,
  sellPercentage: number, // e.g. 5 for 5%
  reductionFactor: number
): Level[] {
  const R = reductionFactor;
  const K = (1 - R) / (1 - Math.pow(R, 88));

  return Array.from({ length: 88 }, (_, n) => {
    const buyPrice = initialLotPrice * (1 - 0.01 * n);
    const allocated = startingCash * K * Math.pow(R, n);
    const shares = Math.round(allocated / buyPrice);
    const cost = shares * buyPrice;
    const sellPrice = buyPrice * (1 + sellPercentage / 100);
    return { n, buyPrice, sellPrice, shares, cost, purchased: false };
  });
}

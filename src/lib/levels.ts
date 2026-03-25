export interface Level {
  n: number;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  cost: number;
  purchased: boolean;
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

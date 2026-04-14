import { useMemo } from "react";
import { useApp } from "@/lib/context/AppContext";
import { computeLevels, Level } from "@/lib/levels";

export interface LevelsSummary {
  levels: Level[];
  currentLevel: number;
  ownedLevels: Level[];
}

/** Match a fill (shares + price) to the closest level index, checking both buy and sell prices. Returns -1 if no share match or price is too far off. */
function matchLevel(levels: Level[], shares: number, price: number): number {
  const candidates = levels
    .map((l, i) => ({ i, diff: Math.min(Math.abs(l.buyPrice - price), Math.abs(l.sellPrice - price)) }))
    .filter((_, i) => levels[i].shares === shares)
    .filter((c) => c.diff <= 0.01); // must be within $0.01 of level's buy or sell price
  if (candidates.length === 0) return -1;
  return candidates.reduce((best, c) => (c.diff < best.diff ? c : best)).i;
}

export function useLevels(): LevelsSummary | null {
  const { activeAccount, filledOrders } = useApp();
  const s = activeAccount?.settings;

  const levels = useMemo(() => {
    if (!s?.startingCash || !s?.initialLotPrice || !s?.sellPercentage || !s?.reductionFactor) return null;
    return computeLevels(s.startingCash, s.initialLotPrice, s.sellPercentage, s.reductionFactor);
  }, [s]);

  return useMemo(() => {
    if (!levels) return null;

    // For each level, find the most recent fill (BUY or SELL).
    // If the most recent fill was a BUY → owned. SELL → not owned.
    // filledOrders is sorted newest first.
    const resetDate = s?.levelResetDate ?? null;
    const relevantOrders = resetDate
      ? filledOrders.filter((o) => new Date(o.time) >= resetDate)
      : filledOrders;

    const lastFillSide = new Map<number, "BUY" | "SELL">();
    for (const o of relevantOrders) {
      const idx = matchLevel(levels, o.shares, o.fillPrice);
      if (idx === -1) continue;
      if (!lastFillSide.has(idx)) lastFillSide.set(idx, o.side);
    }

    // If all shares are 0, settings are likely misconfigured
    if (levels.every((l) => l.shares === 0)) return null;

    const ownedIndices = new Set(
      [...lastFillSide.entries()].filter(([, side]) => side === "BUY").map(([i]) => i)
    );

    // currentLevel = highest owned level index
    let currentLevel = ownedIndices.size > 0 ? Math.max(...ownedIndices) : -1;

    // Sell-based cap: the most recent sell tells us which level was just exited.
    // currentLevel can't be higher than that level index - 1.
    // relevantOrders is sorted newest first, so find the first SELL that matches a level.
    for (const o of relevantOrders) {
      if (o.side !== "SELL") continue;
      const idx = matchLevel(levels, o.shares, o.fillPrice);
      if (idx === -1) continue;
      if (currentLevel >= idx) currentLevel = idx - 1;
      break;
    }


    const ownedLevels = levels.filter((_, i) => ownedIndices.has(i) && i <= currentLevel);

    return { levels, currentLevel, ownedLevels };
  }, [levels, filledOrders]);
}

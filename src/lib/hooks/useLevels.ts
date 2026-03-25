import { useMemo } from "react";
import { useApp } from "@/lib/context/AppContext";
import { computeLevels, Level } from "@/lib/levels";

export interface LevelsSummary {
  levels: Level[];
  currentLevel: number;
  ownedLevels: Level[];
}

/** Match a fill (shares + price) to the closest level index. Returns -1 if no share match. */
function matchLevel(levels: Level[], shares: number, price: number): number {
  const candidates = levels
    .map((l, i) => ({ i, diff: Math.abs(l.buyPrice - price) }))
    .filter((_, i) => levels[i].shares === shares);
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
    const lastFillSide = new Map<number, "BUY" | "SELL">();
    for (const o of filledOrders) {
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
    const currentLevel = ownedIndices.size > 0 ? Math.max(...ownedIndices) : -1;
    const ownedLevels = levels.filter((_, i) => ownedIndices.has(i));

    return { levels, currentLevel, ownedLevels };
  }, [levels, filledOrders]);
}

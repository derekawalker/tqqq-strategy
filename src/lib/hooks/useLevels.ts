import { useMemo } from "react";
import { useApp } from "@/lib/context/AppContext";
import { computeLevels, computeCurrentLevel, matchLevel, Level } from "@/lib/levels";

export interface LevelsSummary {
  levels: Level[];
  currentLevel: number;
  ownedLevels: Level[];
}

export function useLevels(): LevelsSummary | null {
  const { activeAccount, filledOrders } = useApp();
  const s = activeAccount?.settings;

  const levels = useMemo(() => {
    if (!s?.levelStartingCash || !s?.initialLotPrice || !s?.sellPercentage || !s?.reductionFactor) return null;
    return computeLevels(s.levelStartingCash, s.initialLotPrice, s.sellPercentage, s.reductionFactor);
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

    // If all shares are 0, settings are likely misconfigured
    if (levels.every((l) => l.shares === 0)) return null;

    const currentLevel = computeCurrentLevel(levels, relevantOrders);

    // ownedLevels: levels whose most recent fill was a BUY, capped at currentLevel
    const lastFillSide = new Map<number, "BUY" | "SELL">();
    for (const o of relevantOrders) {
      const idx = matchLevel(levels, o.shares, o.fillPrice);
      if (idx === -1) continue;
      if (!lastFillSide.has(idx)) lastFillSide.set(idx, o.side);
    }
    const ownedIndices = new Set(
      [...lastFillSide.entries()].filter(([, side]) => side === "BUY").map(([i]) => i)
    );
    const ownedLevels = levels.filter((_, i) => ownedIndices.has(i) && i <= currentLevel);

    return { levels, currentLevel, ownedLevels };
  }, [levels, filledOrders]);
}

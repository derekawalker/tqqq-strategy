import { useMemo } from "react";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { matchLevel } from "@/lib/levels";

/** Total cost of open BUY working orders that are not already owned levels. */
export function usePendingBuyCost(): number | null {
  const { workingOrders } = useApp();
  const levelsSummary = useLevels();

  return useMemo(() => {
    if (!levelsSummary) return null;

    const ownedLevelIndices = new Set(levelsSummary.ownedLevels.map((l) => l.n));

    // Each level counts once even with duplicate orders on it.
    const pendingIndices = new Set<number>();
    for (const o of workingOrders) {
      if (o.side !== "BUY") continue;
      const idx = matchLevel(levelsSummary.levels, o.shares, o.limitPrice);
      if (idx >= 0 && !ownedLevelIndices.has(idx)) pendingIndices.add(idx);
    }

    let total = 0;
    for (const idx of pendingIndices) {
      const level = levelsSummary.levels[idx];
      total += level.shares * level.buyPrice;
    }
    return total;
  }, [workingOrders, levelsSummary]);
}

import { useMemo } from "react";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";

/** Total cost of open BUY working orders that are not already owned levels. */
export function usePendingBuyCost(): number | null {
  const { workingOrders } = useApp();
  const levelsSummary = useLevels();

  return useMemo(() => {
    if (!levelsSummary) return null;

    // Build share-count → level-index map once (O(n) instead of repeated findIndex)
    const shareToIdx = new Map<number, number>();
    levelsSummary.levels.forEach((l, i) => shareToIdx.set(l.shares, i));

    const ownedLevelIndices = new Set(
      levelsSummary.ownedLevels.map((l) => shareToIdx.get(l.shares) ?? -1)
    );

    const counts = new Map<number, { buys: number; buyPrice: number | null }>();
    for (const o of workingOrders) {
      if (o.side !== "BUY") continue;
      const idx = shareToIdx.get(o.shares) ?? -1;
      const buyPrice = idx >= 0 ? levelsSummary.levels[idx].buyPrice : null;
      const existing = counts.get(o.shares);
      counts.set(o.shares, { buys: (existing?.buys ?? 0) + 1, buyPrice });
    }

    let total = 0;
    for (const [shares, { buys, buyPrice }] of counts) {
      if (buys === 0 || buyPrice == null) continue;
      const idx = shareToIdx.get(shares) ?? -1;
      if (idx >= 0 && ownedLevelIndices.has(idx)) continue;
      total += shares * buyPrice;
    }
    return total;
  }, [workingOrders, levelsSummary]);
}

import { useMemo } from "react";
import { useApp } from "@/lib/context/AppContext";
import { computeLevels, Level } from "@/lib/levels";

export interface LevelsSummary {
  levels: Level[];
  currentLevel: number; // -1 if unknown
  ownedLevels: Level[];
}

export function useLevels(): LevelsSummary | null {
  const { activeAccount, quote } = useApp();
  const s = activeAccount?.settings;

  const levels = useMemo(() => {
    if (!s?.startingCash || !s?.initialLotPrice || !s?.sellPercentage || !s?.reductionFactor) return null;
    return computeLevels(s.startingCash, s.initialLotPrice, s.sellPercentage, s.reductionFactor);
  }, [s]);

  return useMemo(() => {
    if (!levels) return null;

    const currentLevel = quote.loading
      ? -1
      : levels.reduce((max, { n, buyPrice, sellPrice }) =>
          quote.price >= buyPrice && quote.price <= sellPrice ? n : max, -1);

    const ownedLevels = currentLevel >= 0 ? levels.slice(0, currentLevel + 1) : [];

    return { levels, currentLevel, ownedLevels };
  }, [levels, quote]);
}

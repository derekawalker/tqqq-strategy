import { useMemo } from "react";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { useSentiment } from "@/lib/hooks/useSentiment";
import {
  optionQueueActions,
  ladderQueueActions,
  regimeQueueActions,
  buildActionQueue,
  type QueueAction,
} from "@/lib/dashboardActions";

/**
 * Aggregates short-option exit signals, near-spot ladder buys/sells, and
 * regime advisories into one sorted queue for the dashboard. Fetches its own
 * sentiment data client-side; returns null while the minimum data needed
 * hasn't loaded yet.
 */
export function useActionQueue(): QueueAction[] | null {
  const { optionPositions, workingOrders, quote } = useApp();
  const levelsSummary = useLevels();
  const sentiment = useSentiment();

  const shortOptions = useMemo(
    () => optionPositions.filter((p) => p.underlyingSymbol === "TQQQ" && p.shortQty > 0),
    [optionPositions],
  );

  return useMemo(() => {
    if (!levelsSummary) return null;

    const ownedLevelIndices = new Set(levelsSummary.ownedLevels.map((l) => l.n));

    return buildActionQueue(
      optionQueueActions(shortOptions),
      ladderQueueActions(levelsSummary.levels, ownedLevelIndices, quote.price, workingOrders),
      sentiment ? regimeQueueActions(sentiment.regime, sentiment.daysInRegime) : [],
    );
  }, [levelsSummary, shortOptions, quote.price, workingOrders, sentiment]);
}

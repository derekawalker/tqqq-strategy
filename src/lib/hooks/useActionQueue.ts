import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { useSentiment } from "@/lib/hooks/useSentiment";
import {
  optionQueueActions,
  ladderQueueActions,
  regimeQueueActions,
  hedgeQueueActions,
  buildActionQueue,
  type QueueAction,
} from "@/lib/dashboardActions";
import { hedgeTodos } from "@/lib/hedgeReview";
import { hedgePositions, tqqqIvFromVxn } from "@/lib/putProgram";
import { mergeHedgeSettings } from "@/lib/hedgeSettings";

/** ^VXN (for the TQQQ put model) and spot ^VIX (for the VIX harvest line). */
function useHedgeMarket(): { vxn: number | null; vix: number | null } {
  const [market, setMarket] = useState<{ vxn: number | null; vix: number | null }>({ vxn: null, vix: null });
  useEffect(() => {
    let cancelled = false;
    const num = (url: string, key: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (typeof j?.[key] === "number" ? (j[key] as number) : null))
        .catch(() => null);
    Promise.all([num("/api/iv-rank", "vxnPct"), num("/api/quote?symbol=%5EVIX", "price")]).then(([vxn, vix]) => {
      if (!cancelled) setMarket({ vxn, vix });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return market;
}

/**
 * Aggregates short-option exit signals, near-spot ladder buys/sells, hedge
 * harvests/rolls, and regime advisories into one sorted queue for the
 * dashboard. Fetches its own sentiment and hedge market data client-side;
 * returns null while the minimum data needed hasn't loaded yet.
 */
export function useActionQueue(): QueueAction[] | null {
  const { optionPositions, workingOrders, quote, filledOptionOrders, activeAccount } = useApp();
  const levelsSummary = useLevels();
  const sentiment = useSentiment();
  const { vxn, vix } = useHedgeMarket();

  const shortOptions = useMemo(
    () => optionPositions.filter((p) => p.underlyingSymbol === "TQQQ" && p.shortQty > 0),
    [optionPositions],
  );

  const hedgeActions = useMemo(() => {
    const s = mergeHedgeSettings(activeAccount?.settings.hedgeSettings);
    return hedgeQueueActions(
      hedgeTodos({
        positions: hedgePositions(optionPositions, filledOptionOrders, s.excludedSymbols),
        putPlan: null,
        vixPlan: null,
        tqqqSpot: quote.price,
        baseIv: vxn != null ? tqqqIvFromVxn(vxn) : 0,
        putDte: s.putDte,
        vixDte: s.vixDte,
        vix,
        monetizeVix: s.monetizeVix,
      }),
    );
  }, [optionPositions, filledOptionOrders, activeAccount, quote.price, vxn, vix]);

  return useMemo(() => {
    if (!levelsSummary) return null;

    const ownedLevelIndices = new Set(levelsSummary.ownedLevels.map((l) => l.n));

    return buildActionQueue(
      hedgeActions,
      optionQueueActions(shortOptions),
      ladderQueueActions(levelsSummary.levels, ownedLevelIndices, quote.price, workingOrders),
      sentiment ? regimeQueueActions(sentiment.regime, sentiment.daysInRegime) : [],
    );
  }, [levelsSummary, hedgeActions, shortOptions, quote.price, workingOrders, sentiment]);
}

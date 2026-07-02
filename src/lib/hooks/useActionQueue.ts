import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { useSentiment } from "@/lib/hooks/useSentiment";
import { buildTranchePlan } from "@/lib/hedgeTranches";
import { buildHedgeActions } from "@/lib/hedgeActions";
import {
  hedgeQueueActions,
  optionQueueActions,
  ladderQueueActions,
  regimeQueueActions,
  buildActionQueue,
  type QueueAction,
} from "@/lib/dashboardActions";

const HEDGE_INSTRUMENT = "QQQ" as const;
const HEDGE_BUDGET_PCT = 3;

interface HedgeMarketData {
  qqqPrice: number | null;
  tqqqPrice: number | null;
  vxnPct: number | null;
  error?: string;
}

/**
 * Aggregates hedge actions, short-option exit signals, near-spot ladder
 * buys/sells, and regime advisories into one sorted queue for the dashboard.
 * Fetches its own market/sentiment data client-side; returns null while the
 * minimum data needed hasn't loaded yet.
 */
export function useActionQueue(): QueueAction[] | null {
  const { activeAccount, balances, optionPositions, workingOrders, quote } = useApp();
  const levelsSummary = useLevels();
  const sentiment = useSentiment();

  const [hedgeMarket, setHedgeMarket] = useState<HedgeMarketData | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/put-hedge")
      .then((r) => r.json())
      .then((d: HedgeMarketData) => { if (!cancelled && !d.error) setHedgeMarket(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const hedgePuts = useMemo(
    () => optionPositions.filter((p) => p.underlyingSymbol === HEDGE_INSTRUMENT && p.putCall === "PUT" && p.longQty > 0),
    [optionPositions],
  );
  const shortOptions = useMemo(
    () => optionPositions.filter((p) => p.underlyingSymbol === "TQQQ" && p.shortQty > 0),
    [optionPositions],
  );

  const activeTqqqValue = balances.find((b) => b.accountNumber === activeAccount?.accountNumber)?.tqqqValue ?? 0;
  const qqqSpot = hedgeMarket?.qqqPrice ?? null;

  const hedgePlan = useMemo(
    () =>
      qqqSpot !== null && activeTqqqValue > 0
        ? buildTranchePlan({
            tqqqValue: activeTqqqValue,
            spot: qqqSpot,
            vxnPct: hedgeMarket?.vxnPct ?? null,
            annualBudgetPct: HEDGE_BUDGET_PCT / 100,
            instrument: HEDGE_INSTRUMENT,
          })
        : null,
    [qqqSpot, activeTqqqValue, hedgeMarket?.vxnPct],
  );

  return useMemo(() => {
    if (!levelsSummary) return null;

    const hedgeItems = buildHedgeActions(hedgePlan, hedgePuts, qqqSpot, hedgeMarket?.vxnPct ?? null);
    const ownedLevelIndices = new Set(levelsSummary.ownedLevels.map((l) => l.n));

    return buildActionQueue(
      hedgeQueueActions(hedgeItems),
      optionQueueActions(shortOptions),
      ladderQueueActions(levelsSummary.levels, ownedLevelIndices, quote.price, workingOrders),
      sentiment ? regimeQueueActions(sentiment.regime, sentiment.daysInRegime) : [],
    );
  }, [levelsSummary, hedgePlan, hedgePuts, qqqSpot, hedgeMarket?.vxnPct, shortOptions, quote.price, workingOrders, sentiment]);
}

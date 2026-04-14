import { useState, useEffect, useMemo } from "react";
import { useApp } from "@/lib/context/AppContext";
import type { Candle } from "@/app/api/chart/route";

const candleCache: Record<string, { tick: number; data: Candle[] }> = {};

/**
 * Fetches and caches TQQQ candles for the given range.
 * Returns { candles, loading }. Data persists across remounts via module-level cache.
 */
export function useChartCandles(range: "1d" | "1w" | "1m") {
  const { quoteTick } = useApp();
  const [fetchedData, setFetchedData] = useState<{ range: string; tick: number; data: Candle[] } | null>(null);

  const candles = useMemo((): Candle[] => {
    const c = candleCache[range];
    if (c?.tick === quoteTick) return c.data;
    if (fetchedData?.range === range && fetchedData?.tick === quoteTick) return fetchedData.data;
    return [];
  }, [range, quoteTick, fetchedData]);

  const loading = candles.length === 0 &&
    candleCache[range]?.tick !== quoteTick &&
    !(fetchedData?.range === range && fetchedData?.tick === quoteTick);

  useEffect(() => {
    if (candleCache[range]?.tick === quoteTick) return;
    let cancelled = false;
    fetch(`/api/chart?range=${range}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          candleCache[range] = { tick: quoteTick, data };
          setFetchedData({ range, tick: quoteTick, data });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [quoteTick, range]);

  return { candles, loading };
}

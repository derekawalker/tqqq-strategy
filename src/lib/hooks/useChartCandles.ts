import { useState, useEffect, useMemo } from "react";
import { useApp } from "@/lib/context/AppContext";
import type { Candle } from "@/app/api/chart/route";

const candleCache: Record<string, { tick: number; data: Candle[] }> = {};

/**
 * Fetches and caches candles for the given symbol and range.
 * Returns { candles, loading }. Data persists across remounts via module-level cache.
 */
export function useChartCandles(range: "1d" | "1w" | "1m", symbol = "TQQQ") {
  const { quoteTick } = useApp();
  const [fetchedData, setFetchedData] = useState<{ range: string; tick: number; data: Candle[] } | null>(null);

  const key = `${symbol}:${range}`;

  const candles = useMemo((): Candle[] => {
    const c = candleCache[key];
    if (c?.tick === quoteTick) return c.data;
    if (fetchedData?.range === key && fetchedData?.tick === quoteTick) return fetchedData.data;
    return [];
  }, [key, quoteTick, fetchedData]);

  const loading = candles.length === 0 &&
    candleCache[key]?.tick !== quoteTick &&
    !(fetchedData?.range === key && fetchedData?.tick === quoteTick);

  useEffect(() => {
    if (candleCache[key]?.tick === quoteTick) return;
    let cancelled = false;
    fetch(`/api/chart?range=${range}&symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          candleCache[key] = { tick: quoteTick, data };
          setFetchedData({ range: key, tick: quoteTick, data });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [quoteTick, range, symbol, key]);

  return { candles, loading };
}

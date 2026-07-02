import { useEffect, useState } from "react";
import type { Regime } from "@/lib/sentiment";

export interface SentimentData {
  regime: Regime;
  daysInRegime: number;
  error?: string;
}

/** Fetches the current regime from /api/sentiment. Returns null until loaded. */
export function useSentiment(): SentimentData | null {
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sentiment")
      .then((r) => r.json())
      .then((d: SentimentData) => { if (!cancelled && !d.error) setSentiment(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return sentiment;
}

export interface DailyBar {
  close: number;
  date: string; // "M/D"
  dow: number;  // 0=Sun…6=Sat
}

/**
 * Format a date as "M/D" in UTC.
 *
 * Yahoo's daily bars carry UTC timestamps and we label them with getUTC*, so the
 * synthetic live "today" bar must use the same basis — otherwise, near a UTC day
 * boundary, a local-time label won't match the last historical bar and the live
 * price gets appended as a duplicate day instead of replacing today's bar.
 */
export function dayLabelUTC(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * Merge the live quote into the daily bars: replace today's bar if the series already
 * has one, otherwise append a new bar. Returns the input unchanged when there is no
 * live price. Pure — does not mutate `bars`.
 */
export function appendLiveQuote(
  bars: DailyBar[],
  livePrice: number | null | undefined,
  now: Date,
): DailyBar[] {
  if (livePrice == null) return bars;
  const todayLabel = dayLabelUTC(now);
  const last = bars[bars.length - 1];
  if (last && last.date === todayLabel) {
    const next = bars.slice();
    next[next.length - 1] = { ...last, close: livePrice };
    return next;
  }
  return [...bars, { close: livePrice, date: todayLabel, dow: now.getUTCDay() }];
}

/**
 * Trend over the trailing `window` closes: 1 if strictly rising, -1 if strictly
 * falling, 0 if mixed or there aren't enough closes.
 */
export function computeTrend(closes: number[], window = 6): number {
  if (closes.length < window) return 0;
  const w = closes.slice(-window);
  const allUp = w.every((c, i) => i === 0 || c > w[i - 1]);
  const allDown = w.every((c, i) => i === 0 || c < w[i - 1]);
  return allUp ? 1 : allDown ? -1 : 0;
}

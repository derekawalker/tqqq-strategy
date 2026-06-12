/** One day's total account value per account, keyed by account number. */
export interface BalanceSnapshot {
  date: string; // YYYY-MM-DD
  values: Record<string, number>;
}

// ~2 years of daily snapshots — generous for a chart, small enough to live in the settings blob.
const MAX_SNAPSHOTS = 730;

/** True if `history` has no entry for `dateKey` yet — i.e. today's snapshot still needs recording. */
export function needsSnapshot(history: BalanceSnapshot[], dateKey: string): boolean {
  return !history.some((s) => s.date === dateKey);
}

/**
 * Append today's balances as a new snapshot, replacing any existing same-day entry (so a later,
 * more-complete refresh on the same day corrects an earlier partial one). Keeps history sorted by
 * date and capped to the most recent MAX_SNAPSHOTS days.
 */
export function recordSnapshot(
  history: BalanceSnapshot[],
  dateKey: string,
  values: Record<string, number>
): BalanceSnapshot[] {
  const next = [...history.filter((s) => s.date !== dateKey), { date: dateKey, values }].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  return next.length > MAX_SNAPSHOTS ? next.slice(next.length - MAX_SNAPSHOTS) : next;
}

export type HistoryRange = "1m" | "3m" | "6m" | "1y" | "all";

const RANGE_DAYS: Record<HistoryRange, number | null> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
  all: null,
};

export interface AccountSeriesPoint {
  date: string;
  value: number;
}

/** Returns YYYY-MM-DD `days` before `dateKey`. */
function subtractDays(dateKey: string, days: number): string {
  const d = new Date(dateKey + "T00:00:00");
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString("en-CA");
}

/**
 * Extracts one account's value series for the given range, oldest first. Days where the account
 * has no recorded value (e.g. before the account existed) are dropped rather than zero-filled.
 */
export function getAccountSeries(
  history: BalanceSnapshot[],
  accountNumber: string,
  range: HistoryRange,
  today: string
): AccountSeriesPoint[] {
  const days = RANGE_DAYS[range];
  const cutoff = days != null ? subtractDays(today, days) : null;
  return history
    .filter((s) => s.values[accountNumber] != null && (cutoff == null || s.date >= cutoff))
    .map((s) => ({ date: s.date, value: s.values[accountNumber] }));
}

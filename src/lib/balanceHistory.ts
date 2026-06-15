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
 * True if today's snapshot is absent, or present but missing a value for any of `accountNumbers`.
 * Lets a later refresh fill in accounts (e.g. a second broker) that weren't loaded when the day's
 * first snapshot was taken, instead of the day being considered "done" after a partial record.
 */
export function needsSnapshotUpdate(
  history: BalanceSnapshot[],
  dateKey: string,
  accountNumbers: string[]
): boolean {
  const existing = history.find((s) => s.date === dateKey);
  if (!existing) return true;
  return accountNumbers.some((n) => existing.values[n] == null);
}

/**
 * Record today's balances, merging into any existing same-day entry so a later, more-complete
 * refresh adds accounts (or corrects values) without dropping accounts captured earlier in the day.
 * Keeps history sorted by date and capped to the most recent MAX_SNAPSHOTS days.
 */
export function recordSnapshot(
  history: BalanceSnapshot[],
  dateKey: string,
  values: Record<string, number>
): BalanceSnapshot[] {
  const existing = history.find((s) => s.date === dateKey);
  const mergedValues = existing ? { ...existing.values, ...values } : values;
  const next = [
    ...history.filter((s) => s.date !== dateKey),
    { date: dateKey, values: mergedValues },
  ].sort((a, b) => a.date.localeCompare(b.date));
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

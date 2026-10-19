import { after } from "next/server";
import type { FilledOrder, FilledOptionOrder, ExpiredOptionOrder } from "@/lib/schwab/parse";
import type { Transaction } from "@/app/api/schwab/data/route";
import { readSetting, writeSetting } from "@/lib/settings";

/**
 * Persisted account history, so a data load only asks the broker for what's new.
 *
 * Fills, option fills, expirations and dividend/interest records never change once they're a
 * few days old, yet the data routes used to re-scan a full year of them on every cold start
 * (3–25s on Schwab). The settled part is now stored in the `settings` table per account, and
 * each load fetches only from the stored cutoff to now.
 *
 * Both brokers return an order in a date-range query if it *filled* in that range, even when it
 * was entered long before (Schwab matches the order's entered→closed lifetime, tastytrade its
 * terminal time). So a GTC ladder order placed weeks ago that fills today always comes back in
 * the recent fetch, and the stored part never needs revisiting.
 */
export interface AccountHistory {
  filled: FilledOrder[];
  filledOptions: FilledOptionOrder[];
  expiredOptions: ExpiredOptionOrder[];
  transactions: Transaction[];
}

interface StoredHistory extends AccountHistory {
  /** Everything with a time before this is stored; nothing after it is. */
  cutoff: string;
  /** When the full year was last fetched from the broker. */
  fullAt: string;
}

const DAY_MS = 864e5;
const YEAR_MS = 365 * DAY_MS;
// Records younger than this aren't stored: fees, partial fills and back-dated postings can
// still change them.
const SETTLE_MS = 7 * DAY_MS;
// The recent fetch starts this far before the stored cutoff, so nothing at the seam is lost.
const OVERLAP_MS = DAY_MS;
// Once a day, re-fetch the whole year in the background to self-heal anything the store missed.
const FULL_REFRESH_MS = DAY_MS;

const KEYS = ["filled", "filledOptions", "expiredOptions", "transactions"] as const;

// A record without a usable time sorts as newest, so it's always taken from the live fetch
// and never stored.
const timeOf = (r: { time: string }) => {
  const t = Date.parse(r.time);
  return Number.isNaN(t) ? Infinity : t;
};

function mapLists(h: AccountHistory, fn: <T extends { time: string }>(list: T[]) => T[]): AccountHistory {
  return {
    filled: fn(h.filled),
    filledOptions: fn(h.filledOptions),
    expiredOptions: fn(h.expiredOptions),
    transactions: fn(h.transactions),
  };
}

/** Records in [from, to), newest first. */
export function slice(h: AccountHistory, from: number, to: number): AccountHistory {
  return mapLists(h, (list) =>
    list.filter((r) => timeOf(r) >= from && timeOf(r) < to).sort((a, b) => timeOf(b) - timeOf(a)),
  );
}

/**
 * Stored records before `seam` plus live records from `seam` on. Each record comes from exactly
 * one side, so nothing is double-counted and live data wins wherever the two overlap.
 */
export function mergeHistory(stored: AccountHistory, live: AccountHistory, seam: number): AccountHistory {
  const older = slice(stored, -Infinity, seam);
  const newer = slice(live, seam, Infinity);
  return {
    filled: [...newer.filled, ...older.filled],
    filledOptions: [...newer.filledOptions, ...older.filledOptions],
    expiredOptions: [...newer.expiredOptions, ...older.expiredOptions],
    transactions: [...newer.transactions, ...older.transactions],
  };
}

/** Earliest opening fill per option symbol — what groups a position's legs and dates it. */
export function optionOpenDates(filledOptions: FilledOptionOrder[]): Map<string, string> {
  const opens = new Map<string, string>();
  for (const o of filledOptions) {
    if (o.instruction !== "SELL_TO_OPEN" && o.instruction !== "BUY_TO_OPEN") continue;
    const prev = opens.get(o.symbol);
    if (!prev || timeOf(o) < Date.parse(prev)) opens.set(o.symbol, o.time);
  }
  return opens;
}

function save(key: string, history: AccountHistory, now: number, fullAt: string): Promise<void> {
  const cutoff = now - SETTLE_MS;
  const stored: StoredHistory = {
    ...slice(history, now - YEAR_MS, cutoff),
    cutoff: new Date(cutoff).toISOString(),
    fullAt,
  };
  return writeSetting(key, stored);
}

/**
 * The account's last year of history: stored records plus a live fetch of everything since the
 * stored cutoff. `fetchRange` asks the broker for every record in [from, to].
 */
export async function loadAccountHistory(
  broker: "schwab" | "tastytrade",
  accountNumber: string,
  fetchRange: (from: Date, to: Date) => Promise<AccountHistory>,
): Promise<AccountHistory> {
  const key = `history:${broker}:${accountNumber}`;
  const now = Date.now();
  const yearAgo = now - YEAR_MS;
  const fetchFull = () => fetchRange(new Date(yearAgo), new Date(now));

  const stored = await readSetting<StoredHistory>(key).catch(() => null);
  const valid = stored && KEYS.every((k) => Array.isArray(stored[k])) && !Number.isNaN(Date.parse(stored.cutoff));
  if (!valid) {
    const full = await fetchFull();
    after(() => save(key, full, now, new Date(now).toISOString()).catch(() => {}));
    return slice(full, yearAgo, Infinity);
  }

  const seam = Math.max(Date.parse(stored.cutoff) - OVERLAP_MS, yearAgo);
  // Start a day earlier than the seam so records just past it are built with their full context
  // (tastytrade merges partial fills that land minutes apart).
  const live = await fetchRange(new Date(seam - OVERLAP_MS), new Date(now));
  const merged = slice(mergeHistory(stored, live, seam), yearAgo, Infinity);

  if (now - Date.parse(stored.fullAt) > FULL_REFRESH_MS) {
    after(() =>
      fetchFull()
        .then((full) => save(key, full, now, new Date(now).toISOString()))
        .catch(() => {}),
    );
  } else if (now - SETTLE_MS - Date.parse(stored.cutoff) > DAY_MS) {
    after(() => save(key, merged, now, stored.fullAt).catch(() => {}));
  }
  return merged;
}

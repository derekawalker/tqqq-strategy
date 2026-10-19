import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AccountHistory } from "./accountHistory";

// after() callbacks run once the response is sent; collect them so tests can run them explicitly.
const pending: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => pending.push(fn) }));

const store = new Map<string, unknown>();
vi.mock("@/lib/settings", () => ({
  readSetting: vi.fn(async (k: string) => store.get(k) ?? null),
  writeSetting: vi.fn(async (k: string, v: unknown) => void store.set(k, structuredClone(v))),
}));

const { loadAccountHistory, mergeHistory, optionOpenDates } = await import("./accountHistory");

const DAY = 864e5;
const NOW = Date.parse("2026-10-19T16:00:00Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const KEY = "history:schwab:123";

const fill = (orderId: number, daysAgo: number) =>
  ({ orderId, accountNumber: "123", side: "BUY", shares: 1, fillPrice: 1, total: 1, fees: 0, time: at(daysAgo) }) as const;

const empty = (): AccountHistory => ({ filled: [], filledOptions: [], expiredOptions: [], transactions: [] });
const withFills = (...f: ReturnType<typeof fill>[]): AccountHistory => ({ ...empty(), filled: [...f] });

/** A fake broker holding `all`; returns the records in each requested range. */
function broker(all: AccountHistory) {
  return vi.fn(async (from: Date, to: Date): Promise<AccountHistory> => {
    const inRange = <T extends { time: string }>(l: T[]) =>
      l.filter((r) => Date.parse(r.time) >= from.getTime() && Date.parse(r.time) <= to.getTime());
    return {
      filled: inRange(all.filled),
      filledOptions: inRange(all.filledOptions),
      expiredOptions: inRange(all.expiredOptions),
      transactions: inRange(all.transactions),
    };
  });
}

async function flushAfter() {
  while (pending.length) await pending.shift()!();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  store.clear();
  pending.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("mergeHistory", () => {
  it("takes stored records before the seam and live records from it on, with no duplicates", () => {
    const stored = withFills(fill(1, 20), fill(2, 9), fill(3, 8.5));
    const live = withFills(fill(3, 8.5), fill(4, 2), fill(2, 9));
    const seam = NOW - 8.75 * DAY;
    expect(mergeHistory(stored, live, seam).filled.map((o) => o.orderId)).toEqual([4, 3, 2, 1]);
  });
});

describe("optionOpenDates", () => {
  it("keeps the earliest opening fill per symbol and ignores closes", () => {
    const opt = (instruction: string, daysAgo: number) =>
      ({ orderId: 1, accountNumber: "123", instruction, underlyingSymbol: "QQQ", symbol: "QQQ P", contracts: 1, fillPrice: 1, total: 1, fees: 0, time: at(daysAgo) }) as never;
    const opens = optionOpenDates([opt("BUY_TO_OPEN", 5), opt("SELL_TO_CLOSE", 30), opt("BUY_TO_OPEN", 10)]);
    expect(opens.get("QQQ P")).toBe(at(10));
  });
});

describe("loadAccountHistory", () => {
  it("fetches the whole year on the first load and stores only settled records", async () => {
    const fetch = broker(withFills(fill(1, 400), fill(2, 100), fill(3, 2)));
    const h = await loadAccountHistory("schwab", "123", fetch);

    expect(h.filled.map((o) => o.orderId)).toEqual([3, 2]); // older than a year is dropped
    expect(fetch).toHaveBeenCalledWith(new Date(NOW - 365 * DAY), new Date(NOW));

    await flushAfter();
    const saved = store.get(KEY) as AccountHistory & { cutoff: string };
    expect(saved.filled.map((o) => o.orderId)).toEqual([2]); // the 2-day-old fill isn't settled yet
    expect(saved.cutoff).toBe(at(7));
  });

  it("afterwards only fetches from just before the stored cutoff, and still sees every record", async () => {
    const all = withFills(fill(1, 100), fill(2, 2));
    await loadAccountHistory("schwab", "123", broker(all));
    await flushAfter();

    // A GTC order entered long ago fills now: the broker reports it at its fill time.
    all.filled.push(fill(3, 0.01));
    const fetch = broker(all);
    const h = await loadAccountHistory("schwab", "123", fetch);

    expect(h.filled.map((o) => o.orderId)).toEqual([3, 2, 1]);
    const [from] = fetch.mock.calls[0];
    expect(from.getTime()).toBe(NOW - 9 * DAY); // cutoff 7d, minus a day of seam, minus a day of context
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("re-saves once the cutoff can move forward a day, without refetching the year", async () => {
    await loadAccountHistory("schwab", "123", broker(withFills(fill(1, 100))));
    await flushAfter();

    vi.setSystemTime(NOW + 0.5 * DAY);
    const all = withFills(fill(1, 100), fill(2, 3));
    await loadAccountHistory("schwab", "123", broker(all));
    expect(pending).toHaveLength(0); // half a day on: nothing to store yet

    vi.setSystemTime(NOW + 0.9 * DAY);
    store.set(KEY, { ...(store.get(KEY) as object), cutoff: at(9) }); // pretend the cutoff lags
    const fetch = broker(all);
    await loadAccountHistory("schwab", "123", fetch);
    await flushAfter();
    expect(fetch).toHaveBeenCalledTimes(1); // the save reuses the merged result
    expect((store.get(KEY) as { cutoff: string }).cutoff).toBe(new Date(NOW + 0.9 * DAY - 7 * DAY).toISOString());
  });

  it("refetches the full year in the background once a day to self-heal", async () => {
    await loadAccountHistory("schwab", "123", broker(withFills(fill(1, 100))));
    await flushAfter();

    vi.setSystemTime(NOW + 1.5 * DAY);
    // A record the store missed (e.g. posted late with an old date) is picked up by the daily full fetch.
    const fetch = broker(withFills(fill(1, 100), fill(9, 60)));
    const h = await loadAccountHistory("schwab", "123", fetch);
    expect(h.filled.map((o) => o.orderId)).toEqual([1]);

    await flushAfter();
    expect(fetch).toHaveBeenCalledTimes(2);
    const next = await loadAccountHistory("schwab", "123", broker(withFills()));
    expect(next.filled.map((o) => o.orderId)).toEqual([9, 1]);
  });

  it("falls back to a full fetch when the stored value is unreadable", async () => {
    store.set(KEY, { junk: true });
    const fetch = broker(withFills(fill(1, 100)));
    expect((await loadAccountHistory("schwab", "123", fetch)).filled).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(new Date(NOW - 365 * DAY), new Date(NOW));
  });
});

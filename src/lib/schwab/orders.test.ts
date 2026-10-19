import { describe, it, expect, vi } from "vitest";
import { fetchAllOrders } from "./orders";
import type { RawSchwabOrder } from "./parse";

const DAY = 864e5;
const from = new Date("2026-01-01T00:00:00Z");
const to = new Date("2026-12-31T00:00:00Z");

// One order a day through the year
const all: RawSchwabOrder[] = Array.from({ length: 360 }, (_, i) => ({
  orderId: i + 1,
  enteredTime: new Date(from.getTime() + i * DAY + 3600e3).toISOString(),
  closeTime: new Date(from.getTime() + i * DAY + 3600e3).toISOString(),
}));

// Mimics Schwab: orders in the window, newest first, truncated to the newest `cap`
function schwab(cap: number) {
  return vi.fn(async (f: string, t: string) =>
    all
      .filter((o) => o.enteredTime >= new Date(f).toISOString() && o.enteredTime <= new Date(t).toISOString())
      .sort((a, b) => b.enteredTime.localeCompare(a.enteredTime))
      .slice(0, cap),
  );
}

describe("fetchAllOrders", () => {
  it("pages back past Schwab's per-request cap to get every order", async () => {
    // ~30 orders per 30-day window, so a cap of 10 forces paging inside each window
    const page = schwab(10);
    const orders = await fetchAllOrders(page, from, to);
    expect(orders).toHaveLength(360);
    expect(new Set(orders.map((o) => o.orderId)).size).toBe(360);
  });

  it("gets every order when no request is truncated", async () => {
    const page = schwab(1000);
    const orders = await fetchAllOrders(page, from, to);
    expect(orders).toHaveLength(360);
    expect(new Set(orders.map((o) => o.orderId)).size).toBe(360);
  });

  it("fetches the windows in parallel instead of one after another", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const inner = schwab(1000);
    const page = async (f: string, t: string) => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return inner(f, t);
    };
    await fetchAllOrders(page, from, to);
    expect(maxInFlight).toBeGreaterThanOrEqual(12);
  });

  it("covers the whole range with windows that touch end to end", async () => {
    const page = vi.fn<(f: string, t: string) => Promise<RawSchwabOrder[]>>(async () => []);
    await fetchAllOrders(page, from, to);
    const ranges = page.mock.calls
      .map(([f, t]) => [new Date(f).getTime(), new Date(t).getTime()])
      .sort((a, b) => a[0] - b[0]);
    expect(ranges[0][0]).toBe(from.getTime());
    expect(ranges.at(-1)![1]).toBe(to.getTime());
    for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBe(ranges[i - 1][1]);
  });

  it("makes one call per window when every window is empty", async () => {
    const page = vi.fn(async () => []);
    expect(await fetchAllOrders(page, from, to)).toEqual([]);
    expect(page).toHaveBeenCalledTimes(13);
  });
});

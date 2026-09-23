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
    const page = schwab(100);
    const orders = await fetchAllOrders(page, from, to);
    expect(orders).toHaveLength(360);
    expect(new Set(orders.map((o) => o.orderId)).size).toBe(360);
    expect(page.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("stops after one extra call when the first page wasn't truncated", async () => {
    const page = schwab(1000);
    expect(await fetchAllOrders(page, from, to)).toHaveLength(360);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("returns nothing for an empty window in one call", async () => {
    const page = vi.fn(async () => []);
    expect(await fetchAllOrders(page, from, to)).toEqual([]);
    expect(page).toHaveBeenCalledTimes(1);
  });
});

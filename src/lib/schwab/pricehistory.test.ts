import { describe, it, expect, vi, beforeEach } from "vitest";
import { priceHistoryQuery, getIntradayHistoryBack } from "./pricehistory";

const schwabFetch = vi.fn();
vi.mock("./client", () => ({ schwabFetch: (...args: unknown[]) => schwabFetch(...args) }));

const ok = (candles: unknown[]) => ({ ok: true, json: async () => ({ candles }) });

describe("priceHistoryQuery", () => {
  it("builds a minute pricehistory query with the expected params", () => {
    const q = priceHistoryQuery("TQQQ", {
      frequencyType: "minute",
      frequency: 5,
      startDate: 1700000000123,
      endDate: 1700086400000,
      needExtendedHoursData: false,
    });
    const p = new URLSearchParams(q);
    expect(p.get("symbol")).toBe("TQQQ");
    expect(p.get("frequencyType")).toBe("minute");
    expect(p.get("frequency")).toBe("5");
    expect(p.get("startDate")).toBe("1700000000123"); // floored epoch ms
    expect(p.get("endDate")).toBe("1700086400000");
    expect(p.get("needExtendedHoursData")).toBe("false");
  });

  it("omits unset optional params and defaults extended-hours to false", () => {
    const p = new URLSearchParams(priceHistoryQuery("TQQQ", {}));
    expect(p.has("frequency")).toBe(false);
    expect(p.has("startDate")).toBe(false);
    expect(p.get("needExtendedHoursData")).toBe("false");
  });
});

describe("getIntradayHistoryBack", () => {
  beforeEach(() => schwabFetch.mockReset());

  it("walks backward and stops after consecutive empty windows", async () => {
    const now = Date.now();
    // newest window has data, the next two are empty -> should stop (stopAfterEmpty=2)
    schwabFetch
      .mockResolvedValueOnce(ok([{ datetime: now - 1000, open: 1, high: 1, low: 1, close: 1, volume: 0 }]))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([{ datetime: now - 9e9, open: 9, high: 9, low: 9, close: 9, volume: 0 }]));

    const candles = await getIntradayHistoryBack("TQQQ", 5, { maxMonths: 12, stopAfterEmpty: 2 });
    expect(schwabFetch).toHaveBeenCalledTimes(3); // one with data + two empties, then bail
    expect(candles).toHaveLength(1);
    expect(candles[0].close).toBe(1);
  });

  it("de-dupes and returns ascending by datetime", async () => {
    schwabFetch
      .mockResolvedValueOnce(ok([
        { datetime: 200, open: 2, high: 2, low: 2, close: 2, volume: 0 },
        { datetime: 100, open: 1, high: 1, low: 1, close: 1, volume: 0 },
      ]))
      .mockResolvedValueOnce(ok([{ datetime: 100, open: 1, high: 1, low: 1, close: 1, volume: 0 }]))
      .mockResolvedValue(ok([]));

    const candles = await getIntradayHistoryBack("TQQQ", 5, { maxMonths: 12, stopAfterEmpty: 2 });
    expect(candles.map((c) => c.datetime)).toEqual([100, 200]);
  });
});

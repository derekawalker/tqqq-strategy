import { describe, it, expect } from "vitest";
import { dayLabelUTC, appendLiveQuote, computeTrend, type DailyBar } from "./trend";

describe("dayLabelUTC", () => {
  it("formats as M/D in UTC", () => {
    expect(dayLabelUTC(new Date("2026-06-14T12:00:00Z"))).toBe("6/14");
    expect(dayLabelUTC(new Date("2026-01-03T00:00:00Z"))).toBe("1/3");
  });

  it("uses the UTC day even when local time is the previous day", () => {
    // 2026-06-14T01:00:00Z is still June 13 in US time zones, but the bar belongs to the 14th
    expect(dayLabelUTC(new Date("2026-06-14T01:00:00Z"))).toBe("6/14");
  });
});

describe("appendLiveQuote", () => {
  const bars: DailyBar[] = [
    { close: 100, date: "6/12", dow: 5 },
    { close: 101, date: "6/13", dow: 6 },
  ];

  it("appends a new bar when the series has no entry for today", () => {
    const now = new Date("2026-06-14T15:00:00Z");
    const next = appendLiveQuote(bars, 105, now);
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ close: 105, date: "6/14", dow: 0 });
  });

  it("replaces today's bar instead of duplicating it", () => {
    const now = new Date("2026-06-13T18:00:00Z");
    const next = appendLiveQuote(bars, 102, now);
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ close: 102, date: "6/13", dow: 6 });
  });

  it("does not duplicate today's bar near the UTC boundary (regression)", () => {
    // Last bar is today's (6/14); a live quote at 00:30 UTC must still match and replace it.
    const todayBars: DailyBar[] = [...bars, { close: 103, date: "6/14", dow: 0 }];
    const now = new Date("2026-06-14T00:30:00Z");
    const next = appendLiveQuote(todayBars, 104, now);
    expect(next).toHaveLength(3);
    expect(next[2].close).toBe(104);
  });

  it("returns the bars unchanged when there is no live price", () => {
    const now = new Date("2026-06-14T15:00:00Z");
    expect(appendLiveQuote(bars, null, now)).toBe(bars);
    expect(appendLiveQuote(bars, undefined, now)).toBe(bars);
  });

  it("does not mutate the input array", () => {
    const now = new Date("2026-06-14T15:00:00Z");
    appendLiveQuote(bars, 105, now);
    expect(bars).toHaveLength(2);
  });
});

describe("computeTrend", () => {
  it("returns 1 for strictly rising closes", () => {
    expect(computeTrend([1, 2, 3, 4, 5, 6])).toBe(1);
  });

  it("returns -1 for strictly falling closes", () => {
    expect(computeTrend([6, 5, 4, 3, 2, 1])).toBe(-1);
  });

  it("returns 0 for mixed closes", () => {
    expect(computeTrend([1, 2, 3, 4, 5, 4])).toBe(0);
  });

  it("returns 0 when a value repeats (not strictly monotonic)", () => {
    expect(computeTrend([1, 2, 3, 3, 5, 6])).toBe(0);
  });

  it("returns 0 when there aren't enough closes", () => {
    expect(computeTrend([1, 2, 3, 4, 5])).toBe(0);
  });

  it("only considers the trailing window", () => {
    expect(computeTrend([9, 8, 1, 2, 3, 4, 5, 6])).toBe(1);
  });
});

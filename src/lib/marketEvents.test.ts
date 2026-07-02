import { describe, it, expect } from "vitest";
import { nextEvent, eventGuidance, MARKET_EVENTS, type MarketEvent } from "./marketEvents";

const events: MarketEvent[] = [
  { date: "2026-07-10", kind: "cpi", label: "CPI release" },
  { date: "2026-07-29", kind: "fomc", label: "FOMC decision" },
];

describe("nextEvent", () => {
  it("finds an event exactly at the lookahead boundary", () => {
    const today = new Date("2026-07-07T12:00:00Z");
    const result = nextEvent(events, today, 3);
    expect(result?.date).toBe("2026-07-10");
    expect(result?.daysAway).toBe(3);
  });

  it("returns null when nothing falls within the lookahead window", () => {
    const today = new Date("2026-07-01T12:00:00Z");
    expect(nextEvent(events, today, 3)).toBeNull();
  });

  it("returns the nearer of two events when both are in range", () => {
    const today = new Date("2026-07-27T12:00:00Z");
    const wideEvents: MarketEvent[] = [
      { date: "2026-07-29", kind: "fomc", label: "FOMC decision" },
      { date: "2026-07-28", kind: "cpi", label: "CPI release" },
    ];
    const result = nextEvent(wideEvents, today, 5);
    expect(result?.date).toBe("2026-07-28");
  });

  it("includes an event happening today (daysAway 0)", () => {
    const today = new Date("2026-07-29T12:00:00Z");
    const result = nextEvent(events, today, 3);
    expect(result?.date).toBe("2026-07-29");
    expect(result?.daysAway).toBe(0);
  });

  it("excludes events that have already passed", () => {
    const today = new Date("2026-07-11T12:00:00Z");
    const result = nextEvent(events, today, 30);
    expect(result?.date).toBe("2026-07-29");
  });

  it("is timezone-safe around day boundaries (late-night local time)", () => {
    // 11:59pm local shouldn't shift which calendar day "today" is relative to UTC-parsed events.
    const today = new Date("2026-07-07T23:59:00");
    const result = nextEvent(events, today, 3);
    expect(result?.date).toBe("2026-07-10");
  });
});

describe("eventGuidance", () => {
  it("returns distinct, non-empty guidance for each event kind", () => {
    expect(eventGuidance("fomc").length).toBeGreaterThan(0);
    expect(eventGuidance("cpi").length).toBeGreaterThan(0);
    expect(eventGuidance("fomc")).not.toBe(eventGuidance("cpi"));
  });
});

describe("MARKET_EVENTS", () => {
  it("is sorted chronologically", () => {
    for (let i = 1; i < MARKET_EVENTS.length; i++) {
      expect(MARKET_EVENTS[i].date >= MARKET_EVENTS[i - 1].date).toBe(true);
    }
  });

  it("contains only valid YYYY-MM-DD dates", () => {
    for (const e of MARKET_EVENTS) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

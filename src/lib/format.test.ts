import { describe, it, expect } from "vitest";
import { fmt, fmtDate, fmtDateShort, toDateKey, fmtDateKey, fmtTime, weekStart, createMask } from "./format";

describe("fmt", () => {
  it("formats with 2 decimal places by default", () => {
    expect(fmt(1234.5)).toBe("1,234.50");
  });

  it("formats with 0 decimal places", () => {
    expect(fmt(1234.5, 0)).toBe("1,235");
  });

  it("adds thousands separator", () => {
    expect(fmt(1000000, 0)).toBe("1,000,000");
  });
});

describe("toDateKey", () => {
  it("returns YYYY-MM-DD format", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("fmtDateKey", () => {
  it("converts YYYY-MM-DD to M/D/YY", () => {
    expect(fmtDateKey("2026-01-05")).toBe("1/5/26");
  });
});

describe("weekStart", () => {
  it("returns the Sunday of the given week", () => {
    // 2026-04-14 is a Tuesday; Sunday of that week is 2026-04-12
    expect(weekStart("2026-04-14")).toBe("2026-04-12");
  });

  it("returns the same day if already a Sunday", () => {
    // 2026-04-12 is a Sunday
    expect(weekStart("2026-04-12")).toBe("2026-04-12");
  });
});

describe("createMask", () => {
  it("returns the value unchanged when privacy is off", () => {
    const mask = createMask(false);
    expect(mask("$1,234")).toBe("$1,234");
  });

  it("replaces value with bullets when privacy is on", () => {
    const mask = createMask(true);
    expect(mask("$1,234")).toBe("••••");
  });
});

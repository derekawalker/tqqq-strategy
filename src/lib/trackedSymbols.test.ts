import { describe, it, expect } from "vitest";
import { isTrackedOptionUnderlying, isReadableOptionType } from "./trackedSymbols";

describe("isTrackedOptionUnderlying", () => {
  it("takes the ladder's underlying", () => {
    expect(isTrackedOptionUnderlying("TQQQ")).toBe(true);
  });

  it("takes QQQ, where the older hedge lived", () => {
    expect(isTrackedOptionUnderlying("QQQ")).toBe(true);
  });

  it("takes VIX under every root a broker might use", () => {
    expect(isTrackedOptionUnderlying("VIX")).toBe(true);
    expect(isTrackedOptionUnderlying("$VIX")).toBe(true);
    expect(isTrackedOptionUnderlying("VIXW")).toBe(true);
  });

  it("ignores everything else", () => {
    expect(isTrackedOptionUnderlying("SPY")).toBe(false);
    expect(isTrackedOptionUnderlying("NVDA")).toBe(false);
  });

  it("survives a missing symbol", () => {
    expect(isTrackedOptionUnderlying(null)).toBe(false);
    expect(isTrackedOptionUnderlying(undefined)).toBe(false);
    expect(isTrackedOptionUnderlying("")).toBe(false);
  });
});

describe("isReadableOptionType", () => {
  it("takes equity options", () => {
    expect(isReadableOptionType("Equity Option")).toBe(true);
  });

  it("takes index options, whatever the broker calls them", () => {
    // VIX is an index option; brokers differ on the label.
    expect(isReadableOptionType("Index Option")).toBe(true);
  });

  it("refuses futures options — different multiplier, different symbol format", () => {
    expect(isReadableOptionType("Future Option")).toBe(false);
  });

  it("refuses anything that isn't an option", () => {
    expect(isReadableOptionType("Equity")).toBe(false);
    expect(isReadableOptionType("Future")).toBe(false);
    expect(isReadableOptionType(undefined)).toBe(false);
  });
});

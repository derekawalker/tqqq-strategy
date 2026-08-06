import { describe, it, expect } from "vitest";
import {
  mergeHedgeSettings,
  isCustomised,
  DEFAULT_HEDGE_SETTINGS,
  type HedgeSettings,
} from "./hedgeSettings";

describe("mergeHedgeSettings", () => {
  it("returns the defaults for an account that never configured a hedge", () => {
    expect(mergeHedgeSettings(null)).toEqual(DEFAULT_HEDGE_SETTINGS);
    expect(mergeHedgeSettings(undefined)).toEqual(DEFAULT_HEDGE_SETTINGS);
  });

  it("keeps saved values", () => {
    const merged = mergeHedgeSettings({ budgetPct: 5, maxEntryVix: 30 });
    expect(merged.budgetPct).toBe(5);
    expect(merged.maxEntryVix).toBe(30);
  });

  it("fills fields a blob saved before they existed is missing", () => {
    // An old blob with only the original knobs.
    const old = { budgetPct: 4, putSharePct: 70 } as Partial<HedgeSettings>;
    const merged = mergeHedgeSettings(old);
    expect(merged.budgetPct).toBe(4);
    expect(merged.putSharePct).toBe(70);
    expect(merged.monetizeVix).toBe(DEFAULT_HEDGE_SETTINGS.monetizeVix);
    expect(merged.volOfVol).toBe(DEFAULT_HEDGE_SETTINGS.volOfVol);
  });

  it("ignores values that came back from JSON as the wrong type", () => {
    const junk = { budgetPct: "5", putDelta: null, vixDte: NaN } as unknown as Partial<HedgeSettings>;
    const merged = mergeHedgeSettings(junk);
    expect(merged.budgetPct).toBe(DEFAULT_HEDGE_SETTINGS.budgetPct);
    expect(merged.putDelta).toBe(DEFAULT_HEDGE_SETTINGS.putDelta);
    expect(merged.vixDte).toBe(DEFAULT_HEDGE_SETTINGS.vixDte);
  });

  it("accepts zero as a real value rather than treating it as missing", () => {
    expect(mergeHedgeSettings({ driftBandPct: 0 }).driftBandPct).toBe(0);
  });

  it("never mutates the defaults", () => {
    mergeHedgeSettings({ budgetPct: 9 });
    expect(DEFAULT_HEDGE_SETTINGS.budgetPct).toBe(3);
  });

  it("covers every field the defaults declare", () => {
    const merged = mergeHedgeSettings({});
    for (const key of Object.keys(DEFAULT_HEDGE_SETTINGS)) {
      expect(typeof merged[key as keyof HedgeSettings]).toBe("number");
    }
  });
});

describe("isCustomised", () => {
  it("is false for untouched defaults", () => {
    expect(isCustomised(DEFAULT_HEDGE_SETTINGS)).toBe(false);
    expect(isCustomised(mergeHedgeSettings(null))).toBe(false);
  });

  it("is true once any field is changed", () => {
    expect(isCustomised({ ...DEFAULT_HEDGE_SETTINGS, budgetPct: 5 })).toBe(true);
    expect(isCustomised({ ...DEFAULT_HEDGE_SETTINGS, monetizeVix: 55 })).toBe(true);
  });
});

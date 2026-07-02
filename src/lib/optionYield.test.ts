import { describe, it, expect } from "vitest";
import { estimateCallSale, estimatePutSale, GOOD_SALE_YIELD_PCT, GOOD_SALE_MAX_DELTA } from "./optionYield";

describe("estimateCallSale", () => {
  it("annualized yield is premium / spot, annualized over dte", () => {
    const spot = 80, strike = 88, dte = 30, iv = 0.6;
    const econ = estimateCallSale(spot, strike, dte, iv);
    const expectedYield = (econ.premiumPerContract / 100 / spot) * (365 / dte) * 100;
    expect(econ.annualizedYieldPct).toBeCloseTo(expectedYield, 6);
  });

  it("delta is positive/bounded and shrinks for deeper OTM strikes", () => {
    const nearMoney = estimateCallSale(80, 84, 14, 0.6);
    const farOtm = estimateCallSale(80, 100, 14, 0.6);
    expect(nearMoney.delta).toBeGreaterThan(0);
    expect(nearMoney.delta).toBeLessThan(1);
    expect(farOtm.delta).toBeLessThan(nearMoney.delta);
  });

  it("flags a good sale only when yield clears the threshold and delta stays low", () => {
    // Rich premium (high IV, near strike) -> high yield but likely high delta too.
    const rich = estimateCallSale(80, 82, 14, 1.2);
    // Far OTM, low IV -> low yield, low delta.
    const cheap = estimateCallSale(80, 110, 14, 0.15);
    expect(cheap.goodSale).toBe(false);
    expect(cheap.annualizedYieldPct).toBeLessThan(GOOD_SALE_YIELD_PCT);
    // A rich-but-high-delta sale should never be flagged even if yield clears.
    if (rich.delta > GOOD_SALE_MAX_DELTA) {
      expect(rich.goodSale).toBe(false);
    }
  });

  it("returns zero yield for zero/negative dte", () => {
    const econ = estimateCallSale(80, 88, 0, 0.6);
    expect(econ.annualizedYieldPct).toBe(0);
  });
});

describe("estimatePutSale", () => {
  it("annualized yield is premium / (strike collateral), annualized over dte", () => {
    const spot = 80, strike = 72, dte = 30, iv = 0.6;
    const econ = estimatePutSale(spot, strike, dte, iv);
    const expectedYield = (econ.premiumPerContract / 100 / strike) * (365 / dte) * 100;
    expect(econ.annualizedYieldPct).toBeCloseTo(expectedYield, 6);
  });

  it("delta magnitude shrinks for deeper OTM (lower) strikes", () => {
    const nearMoney = estimatePutSale(80, 76, 14, 0.6);
    const farOtm = estimatePutSale(80, 55, 14, 0.6);
    expect(farOtm.delta).toBeLessThan(nearMoney.delta);
  });

  it("a deep, cheap put is never flagged a good sale", () => {
    const cheap = estimatePutSale(80, 40, 14, 0.2);
    expect(cheap.annualizedYieldPct).toBeLessThan(GOOD_SALE_YIELD_PCT);
    expect(cheap.goodSale).toBe(false);
  });
});

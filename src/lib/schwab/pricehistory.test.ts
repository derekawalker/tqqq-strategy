import { describe, it, expect } from "vitest";
import { priceHistoryQuery } from "./pricehistory";

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

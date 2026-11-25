import { describe, it, expect } from "vitest";
import { sessionPrice } from "./liveQuote";

const base = { regularMarketPrice: 50, preMarketPrice: 49, postMarketPrice: 51 };

describe("sessionPrice", () => {
  it("uses the regular price in regular hours", () => {
    expect(sessionPrice({ ...base, marketState: "REGULAR" })).toBe(50);
  });

  it("uses the extended-hours price for that session", () => {
    expect(sessionPrice({ ...base, marketState: "PRE" })).toBe(49);
    expect(sessionPrice({ ...base, marketState: "POSTPOST" })).toBe(51);
  });

  it("falls back to the regular price when the extended price is missing", () => {
    expect(sessionPrice({ regularMarketPrice: 50, marketState: "POST" })).toBe(50);
  });
});

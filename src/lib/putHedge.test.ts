import { describe, it, expect } from "vitest";
import { normCdf, bsPut } from "./putHedge";

describe("normCdf", () => {
  it("is 0.5 at the mean and symmetric", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 4);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe("bsPut", () => {
  it("returns intrinsic value at expiry", () => {
    expect(bsPut(90, 100, 0, 0.3)).toBeCloseTo(10, 6); // ITM
    expect(bsPut(110, 100, 0, 0.3)).toBeCloseTo(0, 6); // OTM
  });

  it("is worth more than intrinsic before expiry (time value)", () => {
    const price = bsPut(100, 100, 0.5, 0.25);
    expect(price).toBeGreaterThan(0);
    // ATM put with no intrinsic value must be all time value.
    expect(price).toBeGreaterThan(2);
  });

  it("satisfies put-call parity: C - P = S e^-qT - K e^-rT", () => {
    const s = 100,
      k = 95,
      t = 0.75,
      sigma = 0.2,
      r = 0.04;
    const put = bsPut(s, k, t, sigma, r, 0);
    // C = S - K e^-rT + P
    const call = s - k * Math.exp(-r * t) + put;
    // Independent BS call for cross-check.
    const sqrtT = Math.sqrt(t);
    const d1 = (Math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    const bsCall = s * normCdf(d1) - k * Math.exp(-r * t) * normCdf(d2);
    expect(call).toBeCloseTo(bsCall, 4);
  });

  it("is monotonically more expensive with higher vol", () => {
    const lo = bsPut(100, 90, 0.5, 0.15);
    const hi = bsPut(100, 90, 0.5, 0.45);
    expect(hi).toBeGreaterThan(lo);
  });
});

import { describe, it, expect } from "vitest";
import { normCdf, normPdf, bsPut, bsPutGreeks, strikeForDelta } from "./putHedge";

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

describe("normPdf", () => {
  it("peaks at 0 and is symmetric", () => {
    expect(normPdf(0)).toBeCloseTo(0.3989422804, 8);
    expect(normPdf(1)).toBeCloseTo(normPdf(-1), 10);
  });
});

describe("bsPutGreeks", () => {
  it("price matches bsPut", () => {
    const g = bsPutGreeks(100, 95, 0.5, 0.25, 0.04, 0);
    expect(g.price).toBeCloseTo(bsPut(100, 95, 0.5, 0.25, 0.04, 0), 10);
  });

  it("delta is negative and bounded by [-1, 0]; deeper OTM puts have smaller |delta|", () => {
    const atm = bsPutGreeks(100, 100, 0.5, 0.3).delta;
    const otm = bsPutGreeks(100, 80, 0.5, 0.3).delta;
    expect(atm).toBeLessThan(0);
    expect(atm).toBeGreaterThan(-1);
    expect(Math.abs(otm)).toBeLessThan(Math.abs(atm));
  });

  it("delta matches a finite-difference of price wrt spot", () => {
    const s = 100, k = 90, t = 0.5, sig = 0.3;
    const h = 0.01;
    const fd = (bsPut(s + h, k, t, sig) - bsPut(s - h, k, t, sig)) / (2 * h);
    expect(bsPutGreeks(s, k, t, sig).delta).toBeCloseTo(fd, 4);
  });

  it("vega matches a finite-difference wrt vol (per vol point)", () => {
    const s = 100, k = 90, t = 0.5, sig = 0.3;
    const h = 0.0001;
    const fdPerVolPoint = (bsPut(s, k, t, sig + h) - bsPut(s, k, t, sig - h)) / (2 * h) / 100;
    expect(bsPutGreeks(s, k, t, sig).vega).toBeCloseTo(fdPerVolPoint, 3);
  });

  it("at expiry returns intrinsic with delta -1 (ITM) / 0 (OTM)", () => {
    expect(bsPutGreeks(90, 100, 0, 0.3)).toMatchObject({ price: 10, delta: -1, theta: 0, vega: 0 });
    expect(bsPutGreeks(110, 100, 0, 0.3)).toMatchObject({ price: 0, delta: 0 });
  });
});

describe("strikeForDelta", () => {
  it("round-trips: the returned strike prices back to ~the target delta", () => {
    for (const target of [0.1, 0.2, 0.3, 0.45]) {
      const k = strikeForDelta(72, 0.5, 0.5, target);
      const d = bsPutGreeks(72, k, 0.5, 0.5).delta;
      expect(Math.abs(d)).toBeCloseTo(target, 2);
    }
  });

  it("a smaller target delta yields a deeper-OTM (lower) strike", () => {
    const shallow = strikeForDelta(72, 0.5, 0.5, 0.3);
    const deep = strikeForDelta(72, 0.5, 0.5, 0.1);
    expect(deep).toBeLessThan(shallow);
  });
});

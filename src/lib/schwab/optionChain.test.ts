import { describe, it, expect } from "vitest";
import { parsePutChain, pickExpiry, nearestStrike } from "./optionChain";

// Minimal Schwab `chains` response: two expiries, a few strikes, with the kinds
// of dirty data the parser must survive (missing mark, -999 vol, no quote).
const RAW = {
  status: "SUCCESS",
  putExpDateMap: {
    "2026-07-17:30": {
      "480.0": [
        { strikePrice: 480, bid: 5.0, ask: 5.4, mark: 5.2, volatility: 22.5, delta: -0.3, openInterest: 1200, daysToExpiration: 30 },
      ],
      "440.0": [
        // no mark → fall back to bid/ask mid (3.0)
        { strikePrice: 440, bid: 2.8, ask: 3.2, volatility: 28.1, delta: -0.15, openInterest: 800, daysToExpiration: 30 },
      ],
      "400.0": [
        // dead strike: no quotes at all → mark resolves to 0, IV null
        { strikePrice: 400, bid: 0, ask: 0, last: 0, volatility: -999, openInterest: 0, daysToExpiration: 30 },
      ],
    },
    "2026-08-21:65": {
      "470.0": [
        { strikePrice: 470, bid: 8.0, ask: 8.6, mark: 8.3, volatility: 23.4, delta: -0.32, openInterest: 500, daysToExpiration: 65 },
      ],
    },
  },
};

describe("parsePutChain", () => {
  it("flattens the exp/strike map and resolves marks + IV", () => {
    const quotes = parsePutChain(RAW);
    expect(quotes).toHaveLength(4);
    const k480 = quotes.find((q) => q.strike === 480)!;
    expect(k480.expiry).toBe("2026-07-17");
    expect(k480.mark).toBeCloseTo(5.2, 6);
    expect(k480.iv).toBeCloseTo(0.225, 6);

    const k440 = quotes.find((q) => q.strike === 440)!;
    expect(k440.mark).toBeCloseTo(3.0, 6); // bid/ask mid fallback

    const dead = quotes.find((q) => q.strike === 400)!;
    expect(dead.mark).toBe(0);
    expect(dead.iv).toBeNull(); // -999 vol → null
  });

  it("returns sorted, and tolerates an empty response", () => {
    expect(parsePutChain({})).toEqual([]);
    const quotes = parsePutChain(RAW);
    for (let i = 1; i < quotes.length; i++) {
      const prev = quotes[i - 1];
      const cur = quotes[i];
      expect(prev.expiry <= cur.expiry).toBe(true);
    }
  });
});

describe("pickExpiry", () => {
  it("chooses the expiry closest to the target DTE", () => {
    const quotes = parsePutChain(RAW);
    expect(pickExpiry(quotes, 60)).toBe("2026-08-21"); // 65d beats 30d
    expect(pickExpiry(quotes, 25)).toBe("2026-07-17"); // 30d beats 65d
    expect(pickExpiry([], 60)).toBeNull();
  });
});

describe("nearestStrike", () => {
  it("snaps to the nearest quotable strike in the chosen expiry", () => {
    const quotes = parsePutChain(RAW);
    const pick = nearestStrike(quotes, "2026-07-17", 455);
    expect(pick?.strike).toBe(440); // 440 closer to 455 than 480
  });

  it("skips dead strikes with no usable mark", () => {
    const quotes = parsePutChain(RAW);
    // 400 is closest to a 405 target, but it has no quote → must fall to 440.
    const pick = nearestStrike(quotes, "2026-07-17", 405);
    expect(pick?.strike).toBe(440);
  });
});

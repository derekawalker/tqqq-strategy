import { describe, it, expect } from "vitest";
import { vxnBand, brokerHealthPayload, itmNearExpiry } from "./route";
import type { OptionPosition } from "@/lib/schwab/parse";

describe("brokerHealthPayload", () => {
  it("alerts once when the link goes down", () => {
    expect(brokerHealthPayload(false, true)?.title).toBe("Schwab connection lost");
  });

  it("stays quiet while it is still down", () => {
    expect(brokerHealthPayload(true, true)).toBeNull();
  });

  it("says so when it comes back", () => {
    expect(brokerHealthPayload(true, false)?.title).toBe("Schwab reconnected");
  });

  it("stays quiet while it is healthy", () => {
    expect(brokerHealthPayload(false, false)).toBeNull();
  });

  it("points at the app, where the reconnect button lives", () => {
    expect(brokerHealthPayload(false, true)?.url).toBe("/");
  });

  it("reuses one tag, so an outage replaces its own notification", () => {
    expect(brokerHealthPayload(false, true)?.tag).toBe(
      brokerHealthPayload(true, false)?.tag,
    );
  });
});

describe("vxnBand", () => {
  it("classifies calm, elevated, high, and panic bands at their boundaries", () => {
    expect(vxnBand(10)).toBe("calm");
    expect(vxnBand(24.9)).toBe("calm");
    expect(vxnBand(25)).toBe("elevated");
    expect(vxnBand(34.9)).toBe("elevated");
    expect(vxnBand(35)).toBe("high"); // PUT_SPREAD_VXN_THRESHOLD
    expect(vxnBand(49.9)).toBe("high");
    expect(vxnBand(50)).toBe("panic"); // VIX_PAUSE_THRESHOLD
    expect(vxnBand(80)).toBe("panic");
  });
});

describe("itmNearExpiry", () => {
  const NOW = new Date("2026-11-25T15:00:00").getTime();
  const opt = (o: Partial<OptionPosition>): OptionPosition => ({
    accountNumber: "A1",
    symbol: "TQQQ  261127P00050000",
    underlyingSymbol: "TQQQ",
    putCall: "PUT",
    strike: 50,
    expiry: "2026-11-27",
    shortQty: 1,
    longQty: 0,
    marketValue: 0,
    averagePrice: 0,
    openedAt: null,
    ...o,
  });

  it("flags an ITM short put near expiry and alerts once", () => {
    const r = itmNearExpiry([opt({})], 48, [], NOW);
    expect(r.flagged).toEqual(["TQQQ  261127P00050000"]);
    expect(r.payloads).toHaveLength(1);
    expect(r.payloads[0].body).toContain("3d left");
  });

  it("keeps flagging but doesn't re-alert an already-flagged contract", () => {
    const r = itmNearExpiry([opt({})], 48, ["TQQQ  261127P00050000"], NOW);
    expect(r.flagged).toHaveLength(1);
    expect(r.payloads).toHaveLength(0);
  });

  it("handles calls: ITM when spot is above the strike", () => {
    const call = opt({ putCall: "CALL", symbol: "TQQQ  261127C00050000" });
    expect(itmNearExpiry([call], 52, [], NOW).flagged).toHaveLength(1);
    expect(itmNearExpiry([call], 48, [], NOW).flagged).toHaveLength(0);
  });

  it("ignores OTM, far-dated, long, and non-TQQQ positions", () => {
    const r = itmNearExpiry(
      [
        opt({ strike: 45 }), // OTM put
        opt({ expiry: "2026-12-18" }), // > 5 DTE
        opt({ shortQty: 0, longQty: 1 }), // long hedge
        opt({ underlyingSymbol: "QQQ" }),
      ],
      48,
      [],
      NOW,
    );
    expect(r.flagged).toHaveLength(0);
  });

  it("de-dupes the same contract held in two accounts (Schwab + tastytrade)", () => {
    const r = itmNearExpiry([opt({}), opt({ accountNumber: "5WT00001" })], 48, [], NOW);
    expect(r.flagged).toHaveLength(1);
    expect(r.payloads).toHaveLength(1);
  });
});

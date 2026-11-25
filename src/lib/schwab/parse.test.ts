import { describe, it, expect } from "vitest";
import { flattenOrders, parseOptionPositions, type RawSchwabOrder } from "./parse";

const order = (orderId: number, children: RawSchwabOrder[] = []): RawSchwabOrder =>
  ({ orderId, enteredTime: "", childOrderStrategies: children }) as unknown as RawSchwabOrder;

describe("flattenOrders", () => {
  it("lists parents and their nested children", () => {
    const ids = flattenOrders([order(1, [order(2, [order(3)])]), order(4)]).map((o) => o.orderId);
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it("keeps one copy of an order that arrives both nested and top-level", () => {
    // Adjacent date windows: one returns the child under its trigger parent, the next returns it alone
    const ids = flattenOrders([order(1, [order(2)]), order(2)]).map((o) => o.orderId);
    expect(ids).toEqual([1, 2]);
  });
});

describe("parseOptionPositions", () => {
  const short = {
    instrument: { assetType: "OPTION", symbol: "TQQQ  261218P00045000", underlyingSymbol: "TQQQ", putCall: "PUT" },
    shortQuantity: 2,
    longQuantity: 0,
    marketValue: -300,
    averagePrice: 2.1,
  };

  it("parses strike and expiry from the OCC symbol when Schwab omits them", () => {
    const [p] = parseOptionPositions([short], "A1");
    expect(p).toMatchObject({ strike: 45, expiry: "2026-12-18", putCall: "PUT", shortQty: 2, openedAt: null });
  });

  it("fills openedAt from the caller's map", () => {
    const opened = new Map([["TQQQ  261218P00045000", "2026-11-01T14:00:00Z"]]);
    expect(parseOptionPositions([short], "A1", opened)[0].openedAt).toBe("2026-11-01T14:00:00Z");
  });

  it("skips equities, untracked underlyings, and flat positions", () => {
    const rows = [
      { instrument: { assetType: "EQUITY", symbol: "TQQQ" }, longQuantity: 100 },
      { ...short, instrument: { ...short.instrument, underlyingSymbol: "AAPL" } },
      { ...short, shortQuantity: 0 },
    ];
    expect(parseOptionPositions(rows, "A1")).toEqual([]);
  });
});

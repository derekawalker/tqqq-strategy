import { describe, it, expect } from "vitest";
import { dteAtPurchase, autoIncluded, buildBudgetOrders, computeBudgetSpend, HEDGE_MIN_DTE } from "./hedgeBudget";
import type { FilledOptionOrder } from "./schwab/parse";

function order(overrides: Partial<FilledOptionOrder>): FilledOptionOrder {
  return {
    orderId: 1,
    accountNumber: "1",
    instruction: "BUY_TO_OPEN",
    underlyingSymbol: "QQQ",
    symbol: "QQQ  260619P00400000",
    contracts: 1,
    fillPrice: 5,
    total: -500,
    fees: -0.65,
    time: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("dteAtPurchase", () => {
  it("computes days between fill time and the OCC-encoded expiry", () => {
    // Symbol expiry 26-06-19 (2026-06-19), fill 2026-01-15 -> ~155 days
    const dte = dteAtPurchase("QQQ  260619P00400000", "2026-01-15T00:00:00.000Z");
    expect(dte).not.toBeNull();
    expect(dte!).toBeGreaterThan(150);
    expect(dte!).toBeLessThan(160);
  });

  it("returns null for a symbol that doesn't match the OCC pattern", () => {
    expect(dteAtPurchase("garbage", "2026-01-15T00:00:00.000Z")).toBeNull();
  });
});

describe("autoIncluded", () => {
  it("includes long-dated buys and excludes short-dated ones", () => {
    expect(autoIncluded(HEDGE_MIN_DTE)).toBe(true);
    expect(autoIncluded(HEDGE_MIN_DTE - 1)).toBe(false);
  });

  it("defaults to included when DTE is unknown", () => {
    expect(autoIncluded(null)).toBe(true);
  });
});

describe("buildBudgetOrders", () => {
  it("only includes BUY_TO_OPEN puts for the given instrument and year", () => {
    const orders = [
      order({ orderId: 1, underlyingSymbol: "QQQ", instruction: "BUY_TO_OPEN" }),
      order({ orderId: 2, underlyingSymbol: "TQQQ", instruction: "BUY_TO_OPEN" }), // wrong instrument
      order({ orderId: 3, underlyingSymbol: "QQQ", instruction: "SELL_TO_CLOSE" }), // wrong instruction
      order({ orderId: 4, underlyingSymbol: "QQQ", instruction: "BUY_TO_OPEN", time: "2024-01-15T00:00:00.000Z" }), // wrong year
    ];
    const result = buildBudgetOrders(orders, new Set(), "QQQ", 2026);
    expect(result.map((o) => o.id)).toEqual([1]);
  });

  it("excludes short-dated buys by default and includes long-dated ones", () => {
    const orders = [
      order({ orderId: 1, symbol: "QQQ  260619P00400000", time: "2026-06-01T00:00:00.000Z" }), // ~18 days -> short
      order({ orderId: 2, symbol: "QQQ  270101P00400000", time: "2026-01-15T00:00:00.000Z" }), // ~350 days -> long
    ];
    const result = buildBudgetOrders(orders, new Set(), "QQQ", 2026);
    const short = result.find((o) => o.id === 1)!;
    const long = result.find((o) => o.id === 2)!;
    expect(short.autoExcluded).toBe(true);
    expect(short.included).toBe(false);
    expect(long.autoExcluded).toBe(false);
    expect(long.included).toBe(true);
  });

  it("XORs the auto rule with a manual flip", () => {
    const orders = [order({ orderId: 1, symbol: "QQQ  260619P00400000", time: "2026-06-01T00:00:00.000Z" })]; // auto-excluded
    const flipped = new Set([1]);
    const result = buildBudgetOrders(orders, flipped, "QQQ", 2026);
    expect(result[0].included).toBe(true); // flipped from excluded -> included
  });

  it("parses strike from the OCC symbol and premium as an absolute value", () => {
    const orders = [order({ orderId: 1, symbol: "QQQ  260619P00400000", total: -750 })];
    const result = buildBudgetOrders(orders, new Set(), "QQQ", 2026);
    expect(result[0].strike).toBe(400);
    expect(result[0].premium).toBe(750);
  });
});

describe("computeBudgetSpend", () => {
  it("nets paid premium against recovered premium on the same symbols", () => {
    const buy = order({ orderId: 1, symbol: "QQQ  260619P00400000", instruction: "BUY_TO_OPEN", total: -500 });
    const close = order({ orderId: 2, symbol: "QQQ  260619P00400000", instruction: "SELL_TO_CLOSE", total: 200, time: "2026-03-01T00:00:00.000Z" });
    const budgetOrders = buildBudgetOrders([buy], new Set(), "QQQ", 2026);
    const spend = computeBudgetSpend([buy, close], budgetOrders, 2026);
    expect(spend.paid).toBe(500);
    expect(spend.recovered).toBe(200);
  });

  it("ignores closes on symbols that weren't included in the budget", () => {
    const buy = order({ orderId: 1, symbol: "QQQ  260619P00400000", time: "2026-06-01T00:00:00.000Z" }); // short-dated, excluded
    const close = order({ orderId: 2, symbol: "QQQ  260619P00400000", instruction: "SELL_TO_CLOSE", total: 200 });
    const budgetOrders = buildBudgetOrders([buy], new Set(), "QQQ", 2026);
    const spend = computeBudgetSpend([buy, close], budgetOrders, 2026);
    expect(spend.paid).toBe(0);
    expect(spend.recovered).toBe(0);
  });

  it("ignores closes from a different year", () => {
    const buy = order({ orderId: 1, symbol: "QQQ  260619P00400000", total: -500 });
    const close = order({ orderId: 2, symbol: "QQQ  260619P00400000", instruction: "SELL_TO_CLOSE", total: 200, time: "2027-03-01T00:00:00.000Z" });
    const budgetOrders = buildBudgetOrders([buy], new Set(), "QQQ", 2026);
    const spend = computeBudgetSpend([buy, close], budgetOrders, 2026);
    expect(spend.paid).toBe(500);
    expect(spend.recovered).toBe(0);
  });
});

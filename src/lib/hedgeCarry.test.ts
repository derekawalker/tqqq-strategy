import { describe, it, expect } from "vitest";
import { computeHedgeCarry } from "./hedgeCarry";
import type { FilledOptionOrder } from "./schwab/parse";

function order(overrides: Partial<FilledOptionOrder>): FilledOptionOrder {
  return {
    orderId: 1,
    accountNumber: "1",
    instruction: "SELL_TO_OPEN",
    underlyingSymbol: "TQQQ",
    symbol: "TQQQ 260619C00090000",
    contracts: 1,
    fillPrice: 2,
    total: 200,
    fees: -0.65,
    time: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeHedgeCarry", () => {
  it("sums TQQQ option cash flow (credits, debits, and fees) as option income", () => {
    const orders = [
      order({ orderId: 1, instruction: "SELL_TO_OPEN", total: 200, fees: -0.65 }),
      order({ orderId: 2, instruction: "BUY_TO_CLOSE", total: -80, fees: -0.65 }),
    ];
    const carry = computeHedgeCarry(orders, new Set(), 2026);
    expect(carry.optionIncomeYtd).toBeCloseTo(200 - 0.65 - 80 - 0.65, 6);
  });

  it("excludes QQQ orders from option income (that's the hedge, not the income book)", () => {
    const orders = [
      order({ orderId: 1, underlyingSymbol: "TQQQ", instruction: "SELL_TO_OPEN", total: 200, fees: 0 }),
      order({ orderId: 2, underlyingSymbol: "QQQ", instruction: "SELL_TO_OPEN", total: 500, fees: 0 }),
    ];
    const carry = computeHedgeCarry(orders, new Set(), 2026);
    expect(carry.optionIncomeYtd).toBe(200);
  });

  it("excludes option income from a different year", () => {
    const orders = [
      order({ orderId: 1, total: 200, fees: 0, time: "2026-01-15T00:00:00.000Z" }),
      order({ orderId: 2, total: 300, fees: 0, time: "2025-01-15T00:00:00.000Z" }),
    ];
    const carry = computeHedgeCarry(orders, new Set(), 2026);
    expect(carry.optionIncomeYtd).toBe(200);
  });

  it("computes hedge spend as paid minus recovered on the QQQ budget", () => {
    const orders = [
      order({
        orderId: 1,
        underlyingSymbol: "QQQ",
        symbol: "QQQ  270101P00400000", // long-dated -> included by default
        instruction: "BUY_TO_OPEN",
        total: -500,
        fees: 0,
        time: "2026-01-15T00:00:00.000Z",
      }),
      order({
        orderId: 2,
        underlyingSymbol: "QQQ",
        symbol: "QQQ  270101P00400000",
        instruction: "SELL_TO_CLOSE",
        total: 150,
        fees: 0,
        time: "2026-03-01T00:00:00.000Z",
      }),
    ];
    const carry = computeHedgeCarry(orders, new Set(), 2026);
    expect(carry.hedgeSpendYtd).toBe(500 - 150);
  });

  it("net carry is option income minus hedge spend", () => {
    const orders = [
      order({ orderId: 1, underlyingSymbol: "TQQQ", instruction: "SELL_TO_OPEN", total: 1000, fees: 0 }),
      order({
        orderId: 2,
        underlyingSymbol: "QQQ",
        symbol: "QQQ  270101P00400000",
        instruction: "BUY_TO_OPEN",
        total: -400,
        fees: 0,
        time: "2026-01-15T00:00:00.000Z",
      }),
    ];
    const carry = computeHedgeCarry(orders, new Set(), 2026);
    expect(carry.optionIncomeYtd).toBe(1000);
    expect(carry.hedgeSpendYtd).toBe(400);
    expect(carry.netCarry).toBe(600);
  });

  it("defaults to the current calendar year when none is given", () => {
    const currentYear = new Date().getFullYear();
    const orders = [order({ time: new Date().toISOString(), total: 100, fees: 0 })];
    const carry = computeHedgeCarry(orders, new Set());
    expect(carry.year).toBe(currentYear);
    expect(carry.optionIncomeYtd).toBe(100);
  });
});

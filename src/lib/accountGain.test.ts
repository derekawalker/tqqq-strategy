import { describe, it, expect } from "vitest";
import { computeAccountGain } from "./accountGain";
import type { Transaction } from "@/app/api/schwab/data/route";

const NOW = new Date("2026-07-08T12:00:00Z").getTime();

function tx(partial: Partial<Transaction>): Transaction {
  return {
    activityId: 1,
    accountNumber: "A1",
    time: "2026-06-01T12:00:00Z",
    description: "",
    symbol: null,
    amount: 0,
    category: "transfer",
    ...partial,
  };
}

describe("computeAccountGain", () => {
  it("computes plain gain with no transfers", () => {
    const r = computeAccountGain({
      initialCash: 10000,
      startingDate: new Date("2026-01-08T12:00:00Z"),
      currentValue: 11000,
      transactions: [],
      accountNumber: "A1",
      now: NOW,
    });
    expect(r.totalGain).toBe(1000);
    expect(r.totalGainPct).toBeCloseTo(10);
    // ~181 days in strategy → roughly doubled when annualized
    expect(r.annualROI).toBeCloseTo((10 / 181) * 365, 0);
    expect(r.netTransfers).toBe(0);
  });

  it("excludes a deposit from the gain and adds it to the basis", () => {
    const r = computeAccountGain({
      initialCash: 10000,
      startingDate: new Date("2026-01-08T12:00:00Z"),
      currentValue: 16000, // 10k start + 5k deposit + 1k real gain
      transactions: [tx({ amount: 5000 })],
      accountNumber: "A1",
      now: NOW,
    });
    expect(r.totalGain).toBe(1000);
    expect(r.totalGainPct).toBeCloseTo((1000 / 15000) * 100);
    expect(r.netTransfers).toBe(5000);
  });

  it("excludes a withdrawal from the loss and keeps the basis", () => {
    const r = computeAccountGain({
      initialCash: 10000,
      startingDate: new Date("2026-01-08T12:00:00Z"),
      currentValue: 8000, // withdrew 3k, so really +1k
      transactions: [tx({ amount: -3000 })],
      accountNumber: "A1",
      now: NOW,
    });
    expect(r.totalGain).toBe(1000);
    expect(r.totalGainPct).toBeCloseTo(10);
    expect(r.netTransfers).toBe(-3000);
  });

  it("ignores transfers from other accounts, other categories, and before startingDate", () => {
    const r = computeAccountGain({
      initialCash: 10000,
      startingDate: new Date("2026-01-08T12:00:00Z"),
      currentValue: 11000,
      transactions: [
        tx({ amount: 5000, accountNumber: "B2" }),
        tx({ amount: 400, category: "dividend" }),
        tx({ amount: 7000, time: "2025-12-01T12:00:00Z" }),
      ],
      accountNumber: "A1",
      now: NOW,
    });
    expect(r.totalGain).toBe(1000);
    expect(r.netTransfers).toBe(0);
  });

  it("sums transfers across accounts when accountNumber is null (combined view)", () => {
    const r = computeAccountGain({
      initialCash: 20000,
      startingDate: null,
      currentValue: 26000,
      transactions: [tx({ amount: 5000 }), tx({ amount: -1000, accountNumber: "B2" })],
      accountNumber: null,
      now: NOW,
    });
    expect(r.netTransfers).toBe(4000);
    expect(r.totalGain).toBe(2000);
    expect(r.annualROI).toBeNull(); // no starting date
  });

  it("returns nulls but still reports transfers when balance is missing", () => {
    const r = computeAccountGain({
      initialCash: null,
      startingDate: null,
      currentValue: null,
      transactions: [tx({ amount: 5000 })],
      accountNumber: "A1",
      now: NOW,
    });
    expect(r.totalGain).toBeNull();
    expect(r.totalGainPct).toBeNull();
    expect(r.netTransfers).toBe(5000);
  });
});

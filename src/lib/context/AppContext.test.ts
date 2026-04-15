import { describe, it, expect } from "vitest";
import { deserializeAccount } from "./AppContext";
import type { Account } from "./AppContext";

function makeAccount(overrides: Partial<Account["settings"]> = {}): Account {
  return {
    accountNumber: "123",
    accountName: "Test",
    color: "blue",
    settings: {
      initialCash: 100000,
      levelStartingCash: 100000,
      startingDate: null,
      initialLotPrice: 70,
      sellPercentage: 5,
      reductionFactor: 0.95,
      orderWarnBelow: 3,
      orderBuffer: 5,
      callSafetyLevels: 8,
      putSafetyLevels: 8,
      levelResetDate: null,
      ...overrides,
    },
  };
}

describe("deserializeAccount", () => {
  it("leaves null dates as null", () => {
    const result = deserializeAccount(makeAccount());
    expect(result.settings.startingDate).toBeNull();
    expect(result.settings.levelResetDate).toBeNull();
  });

  it("converts startingDate string to Date object", () => {
    // Simulates what JSON.parse produces from a stored account
    const raw = makeAccount({ startingDate: "2026-01-01T12:00:00.000Z" as unknown as Date });
    const result = deserializeAccount(raw);
    expect(result.settings.startingDate).toBeInstanceOf(Date);
    expect(result.settings.startingDate?.getFullYear()).toBe(2026);
  });

  it("converts levelResetDate string to Date object", () => {
    // This is the regression: without this conversion, levelResetDate stayed
    // as a string after localStorage load, causing NaN comparisons in useLevels
    // that filtered out ALL fills and made options tables appear empty.
    const raw = makeAccount({ levelResetDate: "2026-04-14T00:00:00.000Z" as unknown as Date });
    const result = deserializeAccount(raw);
    expect(result.settings.levelResetDate).toBeInstanceOf(Date);
    // Use UTC getters to avoid timezone-dependent failures
    expect(result.settings.levelResetDate?.getUTCFullYear()).toBe(2026);
    expect(result.settings.levelResetDate?.getUTCMonth()).toBe(3); // April = 3
    expect(result.settings.levelResetDate?.getUTCDate()).toBe(14);
  });

  it("preserves all other settings unchanged", () => {
    const account = makeAccount({ initialCash: 250000, levelStartingCash: 250000, sellPercentage: 1.64 });
    const result = deserializeAccount(account);
    expect(result.settings.initialCash).toBe(250000);
    expect(result.settings.levelStartingCash).toBe(250000);
    expect(result.settings.sellPercentage).toBe(1.64);
    expect(result.accountNumber).toBe("123");
    expect(result.color).toBe("blue");
  });
});

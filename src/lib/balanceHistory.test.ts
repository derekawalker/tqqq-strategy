import { describe, it, expect } from "vitest";
import { needsSnapshot, recordSnapshot, getAccountSeries, type BalanceSnapshot } from "./balanceHistory";

// ── needsSnapshot ────────────────────────────────────────────────────────────

describe("needsSnapshot", () => {
  it("is true when history is empty", () => {
    expect(needsSnapshot([], "2026-06-12")).toBe(true);
  });

  it("is false when an entry for that date already exists", () => {
    const history: BalanceSnapshot[] = [{ date: "2026-06-12", values: { A: 100 } }];
    expect(needsSnapshot(history, "2026-06-12")).toBe(false);
  });

  it("is true when only other dates exist", () => {
    const history: BalanceSnapshot[] = [{ date: "2026-06-11", values: { A: 100 } }];
    expect(needsSnapshot(history, "2026-06-12")).toBe(true);
  });
});

// ── recordSnapshot ───────────────────────────────────────────────────────────

describe("recordSnapshot", () => {
  it("appends a new day", () => {
    const history: BalanceSnapshot[] = [{ date: "2026-06-11", values: { A: 100 } }];
    const next = recordSnapshot(history, "2026-06-12", { A: 110 });
    expect(next).toEqual([
      { date: "2026-06-11", values: { A: 100 } },
      { date: "2026-06-12", values: { A: 110 } },
    ]);
  });

  it("replaces an existing same-day entry instead of duplicating it", () => {
    const history: BalanceSnapshot[] = [{ date: "2026-06-12", values: { A: 100 } }];
    const next = recordSnapshot(history, "2026-06-12", { A: 105 });
    expect(next).toEqual([{ date: "2026-06-12", values: { A: 105 } }]);
  });

  it("keeps the result sorted by date regardless of input order", () => {
    const history: BalanceSnapshot[] = [
      { date: "2026-06-10", values: { A: 90 } },
      { date: "2026-06-12", values: { A: 110 } },
    ];
    const next = recordSnapshot(history, "2026-06-11", { A: 100 });
    expect(next.map((s) => s.date)).toEqual(["2026-06-10", "2026-06-11", "2026-06-12"]);
  });

  it("caps history at 730 entries by dropping the oldest", () => {
    const history: BalanceSnapshot[] = Array.from({ length: 730 }, (_, i) => ({
      date: `day-${String(i).padStart(4, "0")}`,
      values: { A: i },
    }));
    const next = recordSnapshot(history, "day-9999", { A: 999 });
    expect(next).toHaveLength(730);
    expect(next[0].date).toBe("day-0001");
    expect(next[next.length - 1].date).toBe("day-9999");
  });
});

// ── getAccountSeries ─────────────────────────────────────────────────────────

describe("getAccountSeries", () => {
  const history: BalanceSnapshot[] = [
    { date: "2025-01-01", values: { A: 1000 } },
    { date: "2026-01-01", values: { A: 1100 } },
    { date: "2026-05-14", values: { A: 1150 } },
    { date: "2026-06-12", values: { A: 1200, B: 500 } },
  ];

  it("returns the full series for 'all'", () => {
    expect(getAccountSeries(history, "A", "all", "2026-06-12")).toEqual([
      { date: "2025-01-01", value: 1000 },
      { date: "2026-01-01", value: 1100 },
      { date: "2026-05-14", value: 1150 },
      { date: "2026-06-12", value: 1200 },
    ]);
  });

  it("filters to the trailing window for '1m'", () => {
    expect(getAccountSeries(history, "A", "1m", "2026-06-12")).toEqual([
      { date: "2026-05-14", value: 1150 },
      { date: "2026-06-12", value: 1200 },
    ]);
  });

  it("drops days where the account has no recorded value", () => {
    expect(getAccountSeries(history, "B", "all", "2026-06-12")).toEqual([{ date: "2026-06-12", value: 500 }]);
  });

  it("returns an empty array for an unknown account", () => {
    expect(getAccountSeries(history, "Z", "all", "2026-06-12")).toEqual([]);
  });
});

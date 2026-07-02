import { describe, it, expect } from "vitest";
import { closeRec, spacingLabel, buildHedgeActions, daysUntil } from "./hedgeActions";
import { buildTranchePlan } from "./hedgeTranches";
import type { OptionPosition } from "./schwab/parse";

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function put(overrides: Partial<OptionPosition>): OptionPosition {
  return {
    accountNumber: "1",
    symbol: "QQQ_TEST",
    underlyingSymbol: "QQQ",
    putCall: "PUT",
    strike: 400,
    expiry: isoInDays(180),
    shortQty: 0,
    longQty: 1,
    marketValue: 500,
    averagePrice: 5,
    openedAt: null,
    ...overrides,
  };
}

describe("closeRec", () => {
  it("flags expiring within 5 days regardless of P&L", () => {
    const pos = put({ expiry: isoInDays(3) });
    expect(closeRec(pos, 500, null).action).toBe("expiring");
  });

  it("flags monetize when delta crosses the threshold", () => {
    const pos = put({ expiry: isoInDays(180) });
    const rec = closeRec(pos, 500, { price: 20, delta: -0.5, theta: 0, vega: 0 });
    expect(rec.action).toBe("close-profit");
  });

  it("flags monetize on a large percentage gain even with modest delta", () => {
    // averagePrice 5, marketValue must be > 2.5x cost (250% of 500 = 1250) to clear PROFIT_TAKE_PCT (1.5)
    const pos = put({ expiry: isoInDays(180), averagePrice: 5, longQty: 1, marketValue: 1300 });
    const rec = closeRec(pos, 500, { price: 13, delta: -0.1, theta: 0, vega: 0 });
    expect(rec.action).toBe("close-profit");
  });

  it("flags deeply ITM (spot well below strike) as a close-profit harvest", () => {
    const pos = put({ strike: 400, expiry: isoInDays(180), averagePrice: 5, marketValue: 500 });
    const rec = closeRec(pos, 300, { price: 5, delta: -0.2, theta: 0, vega: 0 }); // 300 < 400*0.88=352
    expect(rec.action).toBe("close-profit");
  });

  it("flags roll-soon inside the roll window but outside the expiring window", () => {
    const pos = put({ expiry: isoInDays(15) }); // ROLL_AT_DTE is 21
    const rec = closeRec(pos, 500, { price: 5, delta: -0.1, theta: 0, vega: 0 });
    expect(rec.action).toBe("roll-soon");
  });

  it("holds when far from expiry, not deeply ITM, and no big gain", () => {
    const pos = put({ expiry: isoInDays(120), strike: 400, averagePrice: 5, marketValue: 500 });
    const rec = closeRec(pos, 500, { price: 5, delta: -0.1, theta: 0, vega: 0 });
    expect(rec.action).toBe("hold");
  });
});

describe("spacingLabel", () => {
  it("labels weekly cadence for short spacing", () => {
    expect(spacingLabel(7)).toBe("~weekly");
    expect(spacingLabel(0)).toBe("—");
  });

  it("labels multi-week cadence in weeks, multi-month in months", () => {
    expect(spacingLabel(21)).toBe("~every 3 wks");
    expect(spacingLabel(90)).toBe("~every 3 mo");
  });
});

describe("buildHedgeActions", () => {
  it("prioritizes an expiring position above everything else", () => {
    const openPuts = [put({ expiry: isoInDays(2), strike: 400 })];
    const actions = buildHedgeActions(null, openPuts, 500, 20);
    expect(actions[0].kind).toBe("expiring");
    expect(actions[0].daysAway).toBe(0);
  });

  it("produces a healthy roll-later action with correct days-away for a distant expiry", () => {
    const expiry = isoInDays(100);
    const openPuts = [put({ expiry, strike: 300, averagePrice: 2, marketValue: 200 })];
    const actions = buildHedgeActions(null, openPuts, 500, 20);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("roll-later");
    // ROLL_AT_DTE = 21, so days-away = dte - 21 (computed the same way daysUntil rounds, to avoid time-of-day flakiness)
    expect(actions[0].daysAway).toBe(Math.max(0, daysUntil(expiry) - 21));
  });

  it("adds a buy-now action when a tranche plan has capacity and nothing is open yet", () => {
    const plan = buildTranchePlan({ tqqqValue: 200_000, spot: 500, vxnPct: 22, annualBudgetPct: 0.03 });
    const actions = buildHedgeActions(plan, [], 500, 22);
    const buyActions = actions.filter((a) => a.kind === "buy-now");
    expect(buyActions.length).toBeGreaterThan(0);
    for (const a of buyActions) expect(a.daysAway).toBe(0);
  });

  it("defers only the crash leg (not catastrophe) when VXN spikes above the panic threshold", () => {
    const plan = buildTranchePlan({ tqqqValue: 200_000, spot: 500, vxnPct: 55, annualBudgetPct: 0.06 });
    const actions = buildHedgeActions(plan, [], 500, 55); // VIX_PAUSE_THRESHOLD is 50
    const deferred = actions.filter((a) => a.kind === "vxn-defer");
    const boughtNow = actions.filter((a) => a.kind === "buy-now");
    expect(deferred.some((a) => a.title.includes("Crash"))).toBe(true);
    expect(boughtNow.some((a) => a.title.includes("Catastrophe"))).toBe(true);
  });

  it("sorts the combined list soonest-first, ties broken by priority", () => {
    const openPuts = [
      put({ expiry: isoInDays(100), strike: 300, averagePrice: 2, marketValue: 200 }), // roll-later, far out
      put({ expiry: isoInDays(2), strike: 400 }), // expiring, now
    ];
    const actions = buildHedgeActions(null, openPuts, 500, 20);
    expect(actions[0].kind).toBe("expiring");
    for (let i = 1; i < actions.length; i++) {
      expect(actions[i].daysAway).toBeGreaterThanOrEqual(actions[i - 1].daysAway);
    }
  });
});

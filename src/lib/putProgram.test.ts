import { describe, it, expect } from "vitest";
import {
  strikeForDelta,
  planProgram,
  scenarioTable,
  tqqqIvFromVxn,
  isHedgeFill,
  hedgeLots,
  hedgeSpend,
  hedgeSpendBySleeve,
  qqqPutsInTqqqTerms,
  openContractsBySleeve,
  budgetStatus,
  type ProgramInput,
} from "./putProgram";

const TQQQ = 72.335;
const IV = tqqqIvFromVxn(24.3); // ^VXN 24.3 x the TQQQ leverage multiple
const SHARES = 1602;
const ACCOUNT = 265881;

const base: ProgramInput = {
  accountValue: ACCOUNT,
  tqqqShares: SHARES,
  tqqqSpot: TQQQ,
  baseIv: IV,
  dte: 60,
  budgetPctPerYear: 3,
  targetDelta: 0.1,
  driftBandPct: 25,
  currentContracts: 0,
};

describe("tqqqIvFromVxn", () => {
  it("scales the index vol by the leverage multiple", () => {
    expect(tqqqIvFromVxn(24.3)).toBeCloseTo(0.729, 6);
  });
});

describe("strikeForDelta", () => {
  it("finds a strike below spot for a low delta", () => {
    const k = strikeForDelta(TQQQ, IV, 60, 0.1)!;
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(TQQQ);
  });

  it("puts a higher delta closer to the money", () => {
    expect(strikeForDelta(TQQQ, IV, 60, 0.3)!).toBeGreaterThan(
      strikeForDelta(TQQQ, IV, 60, 0.1)!,
    );
  });

  it("reaches further out when vol is higher", () => {
    expect(strikeForDelta(TQQQ, 1.2, 60, 0.1)!).toBeLessThan(
      strikeForDelta(TQQQ, 0.5, 60, 0.1)!,
    );
  });

  it("rejects a delta at or above the money", () => {
    expect(strikeForDelta(TQQQ, IV, 60, 0.5)).toBeNull();
    expect(strikeForDelta(TQQQ, IV, 60, 0)).toBeNull();
  });
});

describe("planProgram", () => {
  const plan = planProgram(base)!;

  it("sets the strike from delta, on the $1 grid", () => {
    expect(plan.strike % 1).toBe(0);
    expect(Math.abs(plan.delta)).toBeCloseTo(0.1, 1);
    expect(plan.otmPct).toBeGreaterThan(0);
  });

  it("splits the annual budget across cycles", () => {
    expect(plan.annualBudget).toBeCloseTo(ACCOUNT * 0.03, 6);
    expect(plan.cycleBudget).toBeCloseTo(plan.annualBudget * (60 / 365), 6);
  });

  it("gives finer resolution than QQQ would — one contract covers 100 shares", () => {
    expect(plan.notionalContracts).toBe(Math.floor(SHARES / 100));
  });

  it("is budget-bound at this account size, not notional-bound", () => {
    expect(plan.binding).toBe("budget");
    expect(plan.budgetContracts).toBeLessThan(plan.notionalContracts);
    expect(plan.targetContracts).toBe(plan.budgetContracts);
  });

  it("never spends more than the cycle budget", () => {
    expect(plan.cycleCost).toBeLessThanOrEqual(plan.cycleBudget);
    expect(plan.annualCostPct).toBeLessThanOrEqual(3.001);
  });

  it("reports partial coverage — 3% cannot buy the whole position", () => {
    expect(plan.coveragePct).toBeGreaterThan(0);
    expect(plan.coveragePct).toBeLessThan(100);
  });

  it("becomes notional-bound when few shares are held", () => {
    const early = planProgram({ ...base, tqqqShares: 100 })!;
    expect(early.binding).toBe("notional");
    expect(early.cycleCost).toBeLessThan(early.cycleBudget);
  });

  it("buys nothing when the ladder holds nothing", () => {
    const flat = planProgram({ ...base, tqqqShares: 0 })!;
    expect(flat.targetContracts).toBe(0);
    expect(flat.cycleCost).toBe(0);
  });

  it("spends only its share when the budget is split with another layer", () => {
    const split = planProgram({ ...base, budgetShare: 0.8 })!;
    expect(split.annualBudget).toBeCloseTo(plan.annualBudget * 0.8, 6);
    expect(split.targetContracts).toBeLessThanOrEqual(plan.targetContracts);
  });

  it("buys more as the budget grows", () => {
    const rich = planProgram({ ...base, budgetPctPerYear: 6 })!;
    expect(rich.targetContracts).toBeGreaterThan(plan.targetContracts);
  });

  describe("rebalancing", () => {
    it("says buy when nothing is open", () => {
      expect(plan.action).toBe("buy");
      expect(plan.actionContracts).toBe(plan.targetContracts);
    });

    it("holds when already at target", () => {
      const at = planProgram({ ...base, currentContracts: plan.targetContracts })!;
      expect(at.action).toBe("hold");
      expect(at.actionContracts).toBe(0);
      expect(at.driftPct).toBe(0);
    });

    it("holds inside the drift band rather than churning on spreads", () => {
      const near = planProgram({ ...base, currentContracts: plan.targetContracts - 1 })!;
      expect(near.driftPct).toBeLessThan(25);
      expect(near.action).toBe("hold");
    });

    it("sells when overweight beyond the band", () => {
      const over = planProgram({ ...base, currentContracts: plan.targetContracts + 5 })!;
      expect(over.action).toBe("sell");
      expect(over.actionContracts).toBe(5);
    });

    it("unwinds everything once the ladder is flat", () => {
      const flat = planProgram({ ...base, tqqqShares: 0, currentContracts: 3 })!;
      expect(flat.action).toBe("sell");
      expect(flat.actionContracts).toBe(3);
    });

    it("respects a wider band", () => {
      const loose = planProgram({
        ...base,
        currentContracts: plan.targetContracts - 1,
        driftBandPct: 90,
      })!;
      expect(loose.action).toBe("hold");
    });
  });
});

describe("scenarioTable", () => {
  const plan = planProgram(base)!;
  const moves = [-0.15, -0.3, -0.5, -0.7];
  const rows = scenarioTable(plan, SHARES, TQQQ, moves);

  it("returns a row per move", () => {
    expect(rows).toHaveLength(moves.length);
  });

  it("loses more on the shares the deeper the drop", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].sharesPl).toBeLessThan(rows[i - 1].sharesPl);
    }
  });

  it("offsets more of the loss the deeper the crash", () => {
    expect(rows[rows.length - 1].offsetPct).toBeGreaterThan(rows[0].offsetPct);
  });

  it("costs the premium when the puts expire worthless", () => {
    const mild = scenarioTable(plan, SHARES, TQQQ, [0.05])[0];
    expect(mild.putPl).toBeCloseTo(-plan.cycleCost, 6);
  });

  it("never claims to offset more than the loss", () => {
    for (const r of rows) expect(r.offsetPct).toBeLessThanOrEqual(100);
  });

  it("is worth far more with a vol shock than at expiry intrinsic", () => {
    // A fast -30% with IV tripling and time left is the realistic crash case.
    const floor = scenarioTable(plan, SHARES, TQQQ, [-0.3])[0];
    const shocked = scenarioTable(plan, SHARES, TQQQ, [-0.3], {
      iv: IV * 2.5,
      daysLeft: 40,
    })[0];
    expect(shocked.putPl).toBeGreaterThan(floor.putPl);
    expect(shocked.offsetPct).toBeGreaterThan(floor.offsetPct);
  });
});

describe("isHedgeFill", () => {
  const leg = (over: Partial<Parameters<typeof isHedgeFill>[0]> = {}) => ({
    underlyingSymbol: "TQQQ",
    symbol: "TQQQ  260515P00056000",
    instruction: "BUY_TO_OPEN" as const,
    ...over,
  });

  it("counts a bought TQQQ put", () => {
    expect(isHedgeFill(leg())).toBe(true);
  });

  it("counts a bought QQQ put — the older hedge lived there", () => {
    expect(isHedgeFill(leg({ underlyingSymbol: "QQQ", symbol: "QQQ   260515P00480000" }))).toBe(true);
  });

  it("counts closing a hedge put, so the credit comes back off the budget", () => {
    expect(isHedgeFill(leg({ instruction: "SELL_TO_CLOSE" }))).toBe(true);
  });

  it("leaves the ladder's sold puts alone", () => {
    expect(isHedgeFill(leg({ instruction: "SELL_TO_OPEN" }))).toBe(false);
    expect(isHedgeFill(leg({ instruction: "BUY_TO_CLOSE" }))).toBe(false);
  });

  it("leaves bought calls alone — a long call is a direction bet, not insurance", () => {
    expect(isHedgeFill(leg({ symbol: "TQQQ  260515C00090000" }))).toBe(false);
  });

  it("counts VIX in any form, calls included", () => {
    expect(isHedgeFill(leg({ underlyingSymbol: "VIX", symbol: "VIX   260916C00025000" }))).toBe(true);
    expect(isHedgeFill(leg({ underlyingSymbol: "$VIX", symbol: "VIXW  260916C00025000" }))).toBe(true);
  });

  it("ignores underlyings outside the hedge", () => {
    expect(isHedgeFill(leg({ underlyingSymbol: "SPY", symbol: "SPY   260515P00500000" }))).toBe(false);
  });
});

describe("hedgeLots", () => {
  const since = new Date("2026-01-01");
  const BTO = "BUY_TO_OPEN" as const;
  const STC = "SELL_TO_CLOSE" as const;
  const P56 = "TQQQ  260515P00056000";
  const P50 = "TQQQ  260619P00050000";
  const orders = [
    { symbol: P56, contracts: 2, underlyingSymbol: "TQQQ", instruction: BTO, total: -1300, fees: -1.3, time: "2026-02-01" },
    { symbol: P56, contracts: 1, underlyingSymbol: "TQQQ", instruction: BTO, total: -700, fees: -0.7, time: "2026-02-10" },
    { symbol: P56, contracts: 1, underlyingSymbol: "TQQQ", instruction: STC, total: 400, fees: -0.5, time: "2026-03-01" },
    { symbol: P50, contracts: 2, underlyingSymbol: "TQQQ", instruction: BTO, total: -900, fees: -1.0, time: "2026-04-01" },
  ];

  it("groups every fill of one contract into a single lot", () => {
    const lots = hedgeLots(orders, since);
    expect(lots).toHaveLength(2);
    const p56 = lots.find((l) => l.symbol === P56)!;
    expect(p56.contracts).toBe(3);
    expect(p56.closedContracts).toBe(1);
    expect(p56.openContracts).toBe(2);
    expect(p56.cost).toBeCloseTo(1300 + 1.3 + 700 + 0.7, 6);
    expect(p56.proceeds).toBeCloseTo(400 - 0.5, 6);
  });

  it("prices opens and closes per share, fees included", () => {
    const p56 = hedgeLots(orders, since).find((l) => l.symbol === P56)!;
    expect(p56.openPrice).toBeCloseTo(2002 / 300, 6);
    expect(p56.closePrice).toBeCloseTo(399.5 / 100, 6);
  });

  it("reads strike, expiry and right off the OCC symbol", () => {
    const p56 = hedgeLots(orders, since).find((l) => l.symbol === P56)!;
    expect(p56.strike).toBe(56);
    expect(p56.expiry).toBe("2026-05-15");
    expect(p56.putCall).toBe("PUT");
  });

  it("leaves an unclosed lot without a close price", () => {
    const p50 = hedgeLots(orders, since).find((l) => l.symbol === P50)!;
    expect(p50.closePrice).toBeNull();
    expect(p50.openContracts).toBe(2);
  });

  it("still lists a close whose open predates the window", () => {
    const stray = [
      { symbol: "TQQQ  260220P00048000", contracts: 2, underlyingSymbol: "TQQQ", instruction: STC, total: 250, fees: -0.4, time: "2026-01-15" },
    ];
    const [lot] = hedgeLots(stray, since);
    expect(lot.contracts).toBe(0);
    expect(lot.openPrice).toBeNull();
    expect(lot.openContracts).toBe(0);
    expect(lot.proceeds).toBeCloseTo(249.6, 6);
  });

  it("nets opens against closes across the whole set", () => {
    expect(hedgeSpend(hedgeLots(orders, since))).toBeCloseTo(
      1300 + 1.3 + 700 + 0.7 - 400 + 0.5 + 900 + 1.0,
      6,
    );
  });

  it("drops a lot struck off by hand", () => {
    const lots = hedgeLots(orders, since);
    const kept = hedgeSpend(lots, new Set([P56]));
    expect(kept).toBeCloseTo(901, 6);
    expect(kept).toBeLessThan(hedgeSpend(lots));
  });

  it("ignores fills before the window", () => {
    const older = [
      { symbol: P56, contracts: 4, underlyingSymbol: "TQQQ", instruction: BTO, total: -5000, fees: 0, time: "2025-06-01" },
      ...orders,
    ];
    expect(hedgeSpend(hedgeLots(older, since))).toBeCloseTo(hedgeSpend(hedgeLots(orders, since)), 6);
  });

  it("leaves the ladder's short puts out", () => {
    const withCsp = [
      ...orders,
      { symbol: "TQQQ  260515P00040000", contracts: 3, underlyingSymbol: "TQQQ", instruction: "SELL_TO_OPEN" as const, total: 900, fees: -2, time: "2026-02-05" },
    ];
    expect(hedgeLots(withCsp, since)).toHaveLength(2);
  });

  it("sorts newest first", () => {
    const lots = hedgeLots(orders, since);
    expect(lots[0].symbol).toBe(P50);
  });

  describe("tenor and holding period", () => {
    const now = new Date("2026-05-01T12:00:00");

    it("measures the tenor from the first buy to expiry", () => {
      const p56 = hedgeLots(orders, since, now).find((l) => l.symbol === P56)!;
      // Bought 2026-02-01 for a 2026-05-15 expiry.
      expect(p56.openDte).toBe(103);
    });

    it("stops the clock on a fully closed lot", () => {
      const closed = [
        { symbol: P56, contracts: 2, underlyingSymbol: "TQQQ", instruction: BTO, total: -1300, fees: -1.3, time: "2026-02-01" },
        { symbol: P56, contracts: 2, underlyingSymbol: "TQQQ", instruction: STC, total: 900, fees: -0.5, time: "2026-02-20" },
      ];
      expect(hedgeLots(closed, since, now)[0].daysHeld).toBe(19);
    });

    it("runs the clock to today while any of it is still held", () => {
      const p50 = hedgeLots(orders, since, now).find((l) => l.symbol === P50)!;
      // Opened 2026-04-01, never closed.
      expect(p50.daysHeld).toBe(30);
    });

    it("leaves both blank on a close-only lot", () => {
      const stray = [
        { symbol: P56, contracts: 2, underlyingSymbol: "TQQQ", instruction: STC, total: 250, fees: -0.4, time: "2026-01-15" },
      ];
      const [lot] = hedgeLots(stray, since, now);
      expect(lot.openDte).toBeNull();
      expect(lot.daysHeld).toBeNull();
    });
  });

  describe("short-dated trades", () => {
    // Bought 2026-02-02 for a 2026-02-06 expiry: a 4-day punt, not a hedge.
    const WEEKLY = "TQQQ  260206P00055000";
    const dayTrade = [
      { symbol: WEEKLY, contracts: 5, underlyingSymbol: "TQQQ", instruction: BTO, total: -585, fees: -0.2, time: "2026-02-02T14:30:00" },
      { symbol: WEEKLY, contracts: 5, underlyingSymbol: "TQQQ", instruction: STC, total: 615, fees: -0.2, time: "2026-02-02T19:05:00" },
    ];

    it("drops a put bought inside the minimum tenor", () => {
      expect(hedgeLots(dayTrade, since)).toHaveLength(0);
    });

    it("keeps the whole lot when the buy was far enough out", () => {
      // Same round trip, but opened 38 days from expiry.
      const real = dayTrade.map((o) => ({ ...o, symbol: P56, time: "2026-04-07T14:30:00" }));
      const [lot] = hedgeLots(real, since);
      expect(lot.contracts).toBe(5);
      expect(lot.closedContracts).toBe(5);
    });

    it("keeps a hedge closed near its expiry — tenor is judged at the buy", () => {
      const held = [
        { symbol: P56, contracts: 3, underlyingSymbol: "TQQQ", instruction: BTO, total: -900, fees: -0.3, time: "2026-03-01" },
        { symbol: P56, contracts: 3, underlyingSymbol: "TQQQ", instruction: STC, total: 1200, fees: -0.3, time: "2026-05-12" },
      ];
      const [lot] = hedgeLots(held, since);
      expect(lot.contracts).toBe(3);
      expect(lot.proceeds).toBeCloseTo(1199.7, 6);
    });

    it("keeps a short-dated VIX call — the floor is a put rule", () => {
      // A front-month VIX call is the sleeve working, not a day trade: deferred
      // futures barely move when spot spikes.
      const frontMonth = [
        { symbol: "VIX   260819C00025000", contracts: 16, underlyingSymbol: "VIX", instruction: BTO, total: -400, fees: -0.5, time: "2026-08-07" },
      ];
      const [lot] = hedgeLots(frontMonth, since);
      expect(lot.contracts).toBe(16);
      expect(lot.openDte).toBe(12);
    });

    it("keeps a close-only lot, whose open is out of reach", () => {
      const stray = [
        { symbol: WEEKLY, contracts: 5, underlyingSymbol: "TQQQ", instruction: STC, total: 615, fees: -0.2, time: "2026-02-02" },
      ];
      expect(hedgeLots(stray, since)).toHaveLength(1);
    });
  });
});

describe("qqqPutsInTqqqTerms", () => {
  const QQQ = 590;

  it("converts by notional, allowing for the leverage", () => {
    // 590 / (72.5 x 3) — one QQQ put is about 2.7 TQQQ puts.
    expect(qqqPutsInTqqqTerms(1, QQQ, 72.5)).toBeCloseTo(590 / 217.5, 6);
  });

  it("scales with the contract count", () => {
    expect(qqqPutsInTqqqTerms(3, QQQ, 72.5)).toBeCloseTo(3 * qqqPutsInTqqqTerms(1, QQQ, 72.5), 6);
  });

  it("needs fewer TQQQ puts per QQQ put as TQQQ rises", () => {
    expect(qqqPutsInTqqqTerms(1, QQQ, 90)).toBeLessThan(qqqPutsInTqqqTerms(1, QQQ, 72.5));
  });

  it("returns nothing without prices", () => {
    expect(qqqPutsInTqqqTerms(2, 0, 72.5)).toBe(0);
    expect(qqqPutsInTqqqTerms(2, QQQ, 0)).toBe(0);
  });
});

describe("openContractsBySleeve", () => {
  const since = new Date("2026-01-01");
  const BTO = "BUY_TO_OPEN" as const;
  const STC = "SELL_TO_CLOSE" as const;
  const T = "TQQQ  260515P00056000";
  const Q = "QQQ   261231P00575000";
  const V = "VIX   260916C00025000";
  const orders = [
    { symbol: T, contracts: 4, underlyingSymbol: "TQQQ", instruction: BTO, total: -1300, fees: -1, time: "2026-02-01" },
    { symbol: Q, contracts: 2, underlyingSymbol: "QQQ", instruction: BTO, total: -2600, fees: -1, time: "2026-06-25" },
    { symbol: V, contracts: 12, underlyingSymbol: "VIX", instruction: BTO, total: -1200, fees: -1, time: "2026-08-07" },
  ];

  it("keeps each underlying apart", () => {
    expect(openContractsBySleeve(hedgeLots(orders, since))).toEqual({
      tqqqPuts: 4,
      qqqPuts: 2,
      vix: 12,
    });
  });

  it("counts what is still open, not what was bought", () => {
    const half = [
      ...orders,
      { symbol: T, contracts: 3, underlyingSymbol: "TQQQ", instruction: STC, total: 900, fees: -1, time: "2026-03-01" },
    ];
    expect(openContractsBySleeve(hedgeLots(half, since)).tqqqPuts).toBe(1);
  });

  it("drops a lot struck off by hand", () => {
    const held = openContractsBySleeve(hedgeLots(orders, since), new Set([V]));
    expect(held.vix).toBe(0);
    expect(held.qqqPuts).toBe(2);
  });
});

describe("hedgeSpendBySleeve", () => {
  const since = new Date("2026-01-01");
  const BTO = "BUY_TO_OPEN" as const;
  const STC = "SELL_TO_CLOSE" as const;
  const P56 = "TQQQ  260515P00056000";
  const QQQP = "QQQ   261231P00575000";
  const VIXC = "VIX   260916C00025000";
  const orders = [
    { symbol: P56, contracts: 2, underlyingSymbol: "TQQQ", instruction: BTO, total: -1300, fees: -1.3, time: "2026-02-01" },
    { symbol: QQQP, contracts: 1, underlyingSymbol: "QQQ", instruction: BTO, total: -1316, fees: -0.5, time: "2026-06-25" },
    { symbol: VIXC, contracts: 12, underlyingSymbol: "VIX", instruction: BTO, total: -1200, fees: -1, time: "2026-08-07" },
  ];

  it("puts QQQ and TQQQ puts on one side, VIX on the other", () => {
    const s = hedgeSpendBySleeve(hedgeLots(orders, since));
    expect(s.put).toBeCloseTo(1301.3 + 1316.5, 6);
    expect(s.vix).toBeCloseTo(1201, 6);
  });

  it("totals to the same figure hedgeSpend reports", () => {
    const lots = hedgeLots(orders, since);
    expect(hedgeSpendBySleeve(lots).total).toBeCloseTo(hedgeSpend(lots), 6);
  });

  it("honours the hand-picked exclusions", () => {
    const lots = hedgeLots(orders, since);
    const s = hedgeSpendBySleeve(lots, new Set([VIXC]));
    expect(s.vix).toBe(0);
    expect(s.total).toBeCloseTo(hedgeSpend(lots, new Set([VIXC])), 6);
  });

  it("nets a closing credit off its own sleeve", () => {
    const closed = [
      ...orders,
      { symbol: VIXC, contracts: 12, underlyingSymbol: "VIX", instruction: STC, total: 1500, fees: -1, time: "2026-08-20" },
    ];
    expect(hedgeSpendBySleeve(hedgeLots(closed, since)).vix).toBeCloseTo(1201 - 1499, 6);
  });
});

describe("budgetStatus", () => {
  it("measures pace against the calendar", () => {
    const mid = budgetStatus(8000, 4000, new Date("2026-07-02T00:00:00"));
    expect(mid.yearElapsed).toBeCloseTo(0.5, 1);
    expect(mid.onPaceSpend).toBeCloseTo(4000, -2);
    expect(Math.abs(mid.overPace)).toBeLessThan(200);
  });

  it("flags overspending", () => {
    const hot = budgetStatus(8000, 7000, new Date("2026-04-01T00:00:00"));
    expect(hot.overPace).toBeGreaterThan(0);
    expect(hot.remaining).toBe(1000);
  });

  it("flags underspending", () => {
    expect(budgetStatus(8000, 500, new Date("2026-10-01T00:00:00")).overPace).toBeLessThan(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  optionQueueActions,
  ladderQueueActions,
  regimeQueueActions,
  hedgeQueueActions,
  buildActionQueue,
  OPTION_PROFIT_CAPTURE_PCT,
} from "./dashboardActions";
import type { Level } from "./levels";
import type { OptionPosition } from "./schwab/parse";
import type { WorkingOrder } from "./schwab/parse";
import type { HedgeActionItem } from "./hedgeActions";

function level(n: number, buyPrice: number, sellPrice: number, shares: number): Level {
  return { n, buyPrice, sellPrice, shares, cost: shares * buyPrice, purchased: false };
}

function position(overrides: Partial<OptionPosition>): OptionPosition {
  return {
    accountNumber: "1",
    symbol: "TEST",
    underlyingSymbol: "TQQQ",
    putCall: "CALL",
    strike: 90,
    expiry: "2027-01-01",
    shortQty: 1,
    longQty: 0,
    marketValue: -100,
    averagePrice: 2,
    openedAt: null,
    ...overrides,
  };
}

describe("optionQueueActions", () => {
  it("flags close-profit once captured percentage clears the threshold", () => {
    // credit = 2*1*100 = 200; costToClose 80 -> captured = (200-80)/200 = 0.60 >= 0.5
    const pos = position({ averagePrice: 2, shortQty: 1, marketValue: -80 });
    const actions = optionQueueActions([pos]);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("option-close-profit");
    expect(actions[0].daysAway).toBe(0);
  });

  it("produces no action for a position below the capture threshold, regardless of DTE", () => {
    // TQQQ options are tied to ladder levels and mostly held to expiration/assignment
    // by design, so nearness to expiry alone should never trigger a warning here.
    const pos = position({ averagePrice: 2, shortQty: 1, marketValue: -180 }); // captured = 10%
    const actions = optionQueueActions([pos]);
    expect(actions).toHaveLength(0);
  });

  it("ignores positions with no short quantity", () => {
    const pos = position({ shortQty: 0 });
    expect(optionQueueActions([pos])).toHaveLength(0);
  });

  it("threshold constant matches the documented exit rule", () => {
    expect(OPTION_PROFIT_CAPTURE_PCT).toBe(0.5);
  });
});

describe("ladderQueueActions", () => {
  const levels: Level[] = [
    level(0, 100, 105, 10),
    level(1, 90, 94.5, 10),
    level(2, 80, 84, 10),
  ];

  it("flags an unowned level near spot with no matching working order as a buy-due action", () => {
    const actions = ladderQueueActions(levels, new Set(), 100, []);
    expect(actions.some((a) => a.kind === "ladder-buy-due" && a.title.includes("level 0"))).toBe(true);
  });

  it("does not flag a buy when a matching working order already exists", () => {
    const workingOrders: WorkingOrder[] = [
      { orderId: 1, accountNumber: "1", side: "BUY", shares: 10, limitPrice: 100, enteredTime: "", status: "WORKING" },
    ];
    const actions = ladderQueueActions(levels, new Set(), 100, workingOrders);
    expect(actions.some((a) => a.kind === "ladder-buy-due")).toBe(false);
  });

  it("flags an owned level's sell price near spot as a sell-due action", () => {
    const actions = ladderQueueActions(levels, new Set([1]), 94.5, []);
    expect(actions.some((a) => a.kind === "ladder-sell-due" && a.title.includes("level 1"))).toBe(true);
  });

  it("does not flag levels far from the current price", () => {
    const actions = ladderQueueActions(levels, new Set(), 80, []); // level 0's buy price (100) is 25% away
    expect(actions.some((a) => a.title.includes("level 0"))).toBe(false);
  });

  it("returns nothing for a non-positive current price", () => {
    expect(ladderQueueActions(levels, new Set(), 0, [])).toEqual([]);
  });
});

describe("regimeQueueActions", () => {
  it("produces nothing when Risk-On", () => {
    expect(regimeQueueActions("Risk-On", 10)).toEqual([]);
  });

  it("flags Risk-Off at top priority", () => {
    const actions = regimeQueueActions("Risk-Off", 5);
    expect(actions).toHaveLength(1);
    expect(actions[0].color).toBe("red");
    expect(actions[0].priority).toBe(0);
  });

  it("flags Neutral at lower priority than Risk-Off", () => {
    const [neutral] = regimeQueueActions("Neutral", 5);
    const [riskOff] = regimeQueueActions("Risk-Off", 5);
    expect(neutral.priority).toBeGreaterThan(riskOff.priority);
  });

  it("notes when the regime just changed", () => {
    const [action] = regimeQueueActions("Risk-Off", 1);
    expect(action.title).toContain("just changed");
  });
});

describe("hedgeQueueActions", () => {
  it("maps hedge action items to queue actions tagged with the hedge source and href", () => {
    const items: HedgeActionItem[] = [
      { kind: "expiring", priority: 0, color: "red", title: "t", detail: "d", daysAway: 0 },
    ];
    const [action] = hedgeQueueActions(items);
    expect(action.source).toBe("hedge");
    expect(action.href).toBe("/hedge");
    expect(action.kind).toBe("expiring");
  });
});

describe("buildActionQueue", () => {
  it("merges groups and sorts by daysAway then priority", () => {
    const a = { kind: "expiring", source: "hedge", priority: 0, daysAway: 5, title: "a", detail: "", color: "red", href: "/hedge" } as const;
    const b = { kind: "option-close-profit", source: "options", priority: 1, daysAway: 0, title: "b", detail: "", color: "teal", href: "/options" } as const;
    const c = { kind: "ladder-buy-due", source: "ladder", priority: 3, daysAway: 0, title: "c", detail: "", color: "teal", href: "/working-orders" } as const;
    const queue = buildActionQueue([a], [b, c]);
    expect(queue.map((q) => q.title)).toEqual(["b", "c", "a"]);
  });
});

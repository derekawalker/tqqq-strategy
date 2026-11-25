import { describe, it, expect } from "vitest";
import {
  hedgeTodos,
  putBuyClimate,
  vixBuyClimate,
  daysUntil,
  positionLabel,
  type HedgeReviewInput,
} from "./hedgeReview";
import { planProgram, tqqqIvFromVxn, hedgePositions } from "./putProgram";
import { hedgeQueueActions } from "./dashboardActions";
import type { OptionPosition } from "./schwab/parse";

const NOW = new Date("2026-08-06T12:00:00");
const TQQQ = 72.335;
const IV = tqqqIvFromVxn(24.3);

/** Expiry `days` out from NOW, as "YYYY-MM-DD". */
function expiryIn(days: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function put(over: Partial<OptionPosition> = {}): OptionPosition {
  return {
    accountNumber: "A",
    symbol: "TQQQ  261016P00060000",
    underlyingSymbol: "TQQQ",
    putCall: "PUT",
    strike: 60,
    expiry: expiryIn(60),
    shortQty: 0,
    longQty: 3,
    marketValue: 900,
    averagePrice: 3,
    openedAt: null,
    ...over,
  };
}

const putPlan = planProgram({
  accountValue: 265881,
  tqqqShares: 1602,
  tqqqSpot: TQQQ,
  baseIv: IV,
  dte: 60,
  budgetPctPerYear: 3,
  targetDelta: 0.1,
  driftBandPct: 25,
  currentContracts: 0,
});

const base: HedgeReviewInput = {
  positions: [],
  putPlan,
  vixPlan: null,
  tqqqSpot: TQQQ,
  baseIv: IV,
  putDte: 60,
  vixDte: 45,
  vix: 18,
  monetizeVix: 40,
  now: NOW,
};

describe("daysUntil", () => {
  it("counts calendar days to expiry", () => {
    expect(daysUntil(expiryIn(21), NOW)).toBe(21);
  });

  it("floors an expired contract at zero", () => {
    expect(daysUntil(expiryIn(-5), NOW)).toBe(0);
  });
});

describe("positionLabel", () => {
  it("names the contract the way an order ticket would", () => {
    expect(positionLabel(put({ expiry: "2026-10-16" }))).toBe("TQQQ $60 put · Oct 16");
  });
});

describe("putBuyClimate", () => {
  it("calls cheap vol a good day, whatever the tape did", () => {
    const v = putBuyClimate(18);
    expect(v.climate).toBe("good");
    expect(v.message).toContain("18th percentile");
  });

  it("calls rich vol a poor day", () => {
    expect(putBuyClimate(82).climate).toBe("poor");
  });

  it("sits neutral through the middle of the range", () => {
    expect(putBuyClimate(59).climate).toBe("neutral");
    expect(putBuyClimate(30).climate).toBe("good");
    expect(putBuyClimate(70).climate).toBe("poor");
  });

  it("still says something without a reading", () => {
    const v = putBuyClimate(null);
    expect(v.climate).toBe("neutral");
    expect(v.message.length).toBeGreaterThan(0);
  });
});

describe("vixBuyClimate", () => {
  it("calls a quiet week a good time to add convexity", () => {
    const v = vixBuyClimate(-11.3);
    expect(v.climate).toBe("good");
    expect(v.message).toContain("11.3%");
  });

  it("calls a spike a poor time — the premium has already moved", () => {
    expect(vixBuyClimate(18).climate).toBe("poor");
  });

  it("lets the entry gate override a falling week", () => {
    const v = vixBuyClimate(-11.3, { vix: 26, maxEntryVix: 20 });
    expect(v.climate).toBe("poor");
    expect(v.message).toContain("entry cap");
  });

  it("treats a small move as noise rather than signal", () => {
    expect(vixBuyClimate(4.9).climate).toBe("neutral");
    expect(vixBuyClimate(-4.9).climate).toBe("neutral");
  });

  it("always says something", () => {
    expect(vixBuyClimate(0).message.length).toBeGreaterThan(0);
  });
});

describe("hedgeTodos", () => {
  it("holds a mid-life, low-delta put", () => {
    const todos = hedgeTodos({ ...base, positions: [put()] });
    const hold = todos.find((t) => t.kind === "hold");
    expect(hold?.contracts).toBe(3);
    expect(hold?.delta).toBeLessThan(0.6);
  });

  it("rolls a put inside the decay window", () => {
    const todos = hedgeTodos({ ...base, positions: [put({ expiry: expiryIn(14) })] });
    expect(todos[0].kind).toBe("roll");
    expect(todos[0].daysToExpiry).toBe(14);
  });

  it("harvests a put whose delta has run past the line", () => {
    // A $90 strike against a $72 spot is deep in the money.
    const todos = hedgeTodos({ ...base, positions: [put({ strike: 90 })] });
    expect(todos[0].kind).toBe("harvest");
    expect(todos[0].delta).toBeGreaterThanOrEqual(0.6);
  });

  it("harvests on gain alone, even at a low delta", () => {
    // Paid $3, now marked $15 — a 400% gain.
    const todos = hedgeTodos({
      ...base,
      positions: [put({ averagePrice: 3, marketValue: 4500 })],
    });
    expect(todos[0].kind).toBe("harvest");
    expect(todos[0].gainPct).toBeCloseTo(400, 0);
  });

  it("reports open P/L against what was paid", () => {
    const todos = hedgeTodos({ ...base, positions: [put({ averagePrice: 2, marketValue: 900 })] });
    const held = todos.find((t) => t.symbol != null);
    expect(held?.pl).toBeCloseTo(300, 6);
    expect(held?.gainPct).toBeCloseTo(50, 6);
  });

  it("ignores short puts — those belong to the ladder", () => {
    const todos = hedgeTodos({ ...base, positions: [put({ longQty: 0, shortQty: 3 })] });
    expect(todos.every((t) => t.symbol === null)).toBe(true);
  });

  it("asks for the contracts the plan is short of", () => {
    const todos = hedgeTodos({ ...base, positions: [] });
    const open = todos.find((t) => t.kind === "open");
    expect(open?.contracts).toBe(putPlan?.targetContracts);
    expect(open?.title).toContain("Open");
  });

  it("puts the urgent verdicts first", () => {
    const todos = hedgeTodos({
      ...base,
      positions: [put(), put({ symbol: "TQQQ  260828P00090000", strike: 90 })],
    });
    expect(todos.map((t) => t.kind)).toEqual(["harvest", "open", "hold"]);
  });

  it("harvests the VIX sleeve once spot clears the monetize level", () => {
    const vixCall: OptionPosition = {
      ...put(),
      symbol: "VIX   260916C00025000",
      underlyingSymbol: "VIX",
      putCall: "CALL",
      strike: 25,
      longQty: 4,
    };
    const todos = hedgeTodos({ ...base, positions: [vixCall], vix: 44 });
    expect(todos[0].kind).toBe("harvest");
    expect(todos[0].detail).toContain("44.0");
  });
});

describe("roll text without a put plan (dashboard)", () => {
  it("reopens a put at the put tenor, not the VIX one", () => {
    const todos = hedgeTodos({ ...base, putPlan: null, positions: [put({ expiry: expiryIn(10) })] });
    expect(todos[0].kind).toBe("roll");
    expect(todos[0].detail).toContain("reopen at 60d");
  });
});

describe("hedgePositions", () => {
  const fill = (symbol: string, time: string, instruction = "BUY_TO_OPEN") => ({ symbol, time, instruction });
  const dayTrade = put({ symbol: "TQQQ  260808P00070000", expiry: "2026-08-08", longQty: 5 });
  const hedge = put({ symbol: "TQQQ  261016P00060000", expiry: "2026-10-16" });

  it("keeps a put bought at 21+ DTE and drops one bought inside it", () => {
    const fills = [fill("TQQQ  260808P00070000", "2026-08-06T14:00:00Z"), fill("TQQQ  261016P00060000", "2026-07-01T14:00:00Z")];
    const kept = hedgePositions([dayTrade, hedge], fills as never);
    expect(kept.map((p) => p.symbol)).toEqual([hedge.symbol]);
  });

  it("keeps a put with no buy in the history (bought before the window)", () => {
    expect(hedgePositions([hedge], [])).toHaveLength(1);
  });

  it("drops hand-excluded symbols, whatever their padding", () => {
    expect(hedgePositions([hedge], [], ["TQQQ261016P00060000"])).toHaveLength(0);
  });

  it("keeps VIX calls regardless of tenor and drops short positions", () => {
    const vixCall = put({ symbol: "VIX   260819C00025000", underlyingSymbol: "VIX", putCall: "CALL", expiry: "2026-08-19" });
    const shortPut = put({ shortQty: 1, longQty: 0 });
    const fills = [fill("VIX   260819C00025000", "2026-08-05T14:00:00Z")];
    expect(hedgePositions([vixCall, shortPut], fills as never).map((p) => p.symbol)).toEqual([vixCall.symbol]);
  });
});

describe("hedgeQueueActions", () => {
  it("surfaces harvests and rolls only, linked to /hedge", () => {
    const todos = hedgeTodos({
      ...base,
      putPlan: null,
      positions: [
        put({ expiry: expiryIn(10) }), // roll
        put({ symbol: "TQQQ  261120P00050000", strike: 50, expiry: expiryIn(90) }), // hold
      ],
    });
    const actions = hedgeQueueActions(todos);
    expect(actions.map((a) => a.kind)).toEqual(["hedge-roll"]);
    expect(actions[0].href).toBe("/hedge");
  });
});

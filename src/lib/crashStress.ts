/**
 * Whole-book crash stress test: reprices the current TQQQ ladder position,
 * the short option book (covered calls / cash-secured puts), and the QQQ put
 * hedge under instant, severe shocks — spot down and IV up together, since a
 * real crash moves both at once. This complements the historical Hedge
 * backtest (which answers "how would this have done") by answering "if this
 * happens tomorrow, where does *today's actual book* land?"
 *
 * TQQQ's return over a fast crash is NOT naive 3x QQQ: as a daily-reset
 * leveraged fund it loses extra ground to volatility decay, more so the
 * faster/more volatile the move. Modeled with the standard leveraged-ETF
 * decay formula (Cheng & Madhavan, "The Dynamics of Leveraged and Inverse
 * ETFs", 2009): for leverage L over T trading days at realized daily vol σ,
 *
 *   logReturn_ETF ≈ L · logReturn_index − 0.5 · L · (L−1) · σ² · T
 *
 * Calibrated at a 15-trading-day crash window (~3 weeks — a fast, violent
 * move, not a slow grind), this reproduces this app's own documented crash
 * anchors (see hedgeTranches.ts: QQQ −25% ≈ TQQQ −55–60%; QQQ −35% ≈ TQQQ
 * −75%+) closely when σ is derived from each scenario's shocked VXN.
 *
 * Pure, no I/O — feed it current positions/prices and a scenario list.
 */

import { bsPutGreeks, bsCallGreeks } from "./putHedge";
import { ivFor, IV_SCALE, DIV_YIELD } from "./hedgeTranches";
import { computeCashStress } from "./cashStress";
import type { Level } from "./levels";
import type { OptionPosition } from "./schwab/parse";

const TQQQ_LEVERAGE = 3;
/** Trading days assumed for the shock to play out — see module doc for calibration. */
const CRASH_WINDOW_DAYS = 15;
/** Calendar-day equivalent, used to age option DTEs forward into the shocked scenario. */
const CRASH_WINDOW_CALENDAR_DAYS = 21;
const TRADING_DAYS_PER_YEAR = 252;
const RISK_FREE = 0.04;

/**
 * TQQQ's total return over a fast QQQ crash, accounting for leveraged-ETF
 * volatility decay. `qqqDropPct` and `annualizedVolPct` are both positive
 * (e.g. 0.25 and 50 for a −25% move at 50% annualized vol); returns a
 * negative fraction (e.g. −0.60 for a 60% TQQQ drop).
 */
export function tqqqReturnForShock(
  qqqDropPct: number,
  annualizedVolPct: number,
  days = CRASH_WINDOW_DAYS,
): number {
  const sigma = Math.max(0, annualizedVolPct) / 100 / Math.sqrt(TRADING_DAYS_PER_YEAR);
  const logReturnQqq = Math.log(Math.max(1e-6, 1 - qqqDropPct));
  const decay = 0.5 * TQQQ_LEVERAGE * (TQQQ_LEVERAGE - 1) * sigma * sigma * days;
  const logReturnTqqq = TQQQ_LEVERAGE * logReturnQqq - decay;
  return Math.exp(logReturnTqqq) - 1;
}

export interface CrashScenario {
  label: string;
  /** Instantaneous QQQ drop, e.g. 0.10 for −10%. */
  qqqDropPct: number;
  /** Shocked ^VXN level (annualized vol %) for this scenario. */
  shockedVxnPct: number;
}

export const DEFAULT_CRASH_SCENARIOS: CrashScenario[] = [
  { label: "QQQ −10%", qqqDropPct: 0.10, shockedVxnPct: 35 },
  { label: "QQQ −20%", qqqDropPct: 0.20, shockedVxnPct: 50 },
  { label: "QQQ −30%", qqqDropPct: 0.30, shockedVxnPct: 70 },
  { label: "QQQ −40%", qqqDropPct: 0.40, shockedVxnPct: 90 },
];

export interface CrashStressRow {
  scenario: CrashScenario;
  qqqShockedPrice: number;
  tqqqShockedPrice: number;
  /** Negative — TQQQ's modeled return over the shock. */
  tqqqReturnPct: number;
  /** $ loss on the current TQQQ share position (positive = loss). */
  tqqqPositionLoss: number;
  /** $ gain on the open QQQ put hedge (positive = protective gain). */
  hedgePayoff: number;
  /** $ change in the short TQQQ option book's cost-to-close (positive = loss, negative = gain). */
  shortBookDamage: number;
  /** Cash needed for unpurchased ladder levels + short-put assignment at the shocked price. */
  ladderCashNeeded: number;
  /** tqqqPositionLoss − hedgePayoff + shortBookDamage. */
  netDrawdown: number;
}

/** Age an option's DTE forward by the crash window, floored at 0. */
function shockedDte(currentDte: number): number {
  return Math.max(0, currentDte - CRASH_WINDOW_CALENDAR_DAYS);
}

/** Current per-share mark for an open position, from its live market value. */
function currentMarkPerShare(pos: OptionPosition, qty: number): number {
  return qty > 0 ? Math.abs(pos.marketValue) / (qty * 100) : 0;
}

export function runCrashStress(opts: {
  qqqSpot: number;
  tqqqSpot: number;
  /** Days-until-expiry lookup for each option position (avoids a date dependency in this pure module). */
  dteFor: (position: OptionPosition) => number;
  tqqqShares: number;
  /** Open QQQ long puts (the hedge). */
  hedgePuts: OptionPosition[];
  /** Open TQQQ short calls/puts (the covered-call / CSP income book). */
  shortOptions: OptionPosition[];
  levels: Level[];
  ownedLevelIndices: Set<number>;
  cashAvailable: number;
  scenarios?: CrashScenario[];
}): CrashStressRow[] {
  const {
    qqqSpot,
    tqqqSpot,
    dteFor,
    tqqqShares,
    hedgePuts,
    shortOptions,
    levels,
    ownedLevelIndices,
    cashAvailable,
    scenarios = DEFAULT_CRASH_SCENARIOS,
  } = opts;

  return scenarios.map((scenario) => {
    const qqqShockedPrice = qqqSpot * (1 - scenario.qqqDropPct);
    const tqqqReturnPct = tqqqReturnForShock(scenario.qqqDropPct, scenario.shockedVxnPct);
    const tqqqShockedPrice = tqqqSpot * (1 + tqqqReturnPct);
    const tqqqPositionLoss = tqqqShares * tqqqSpot * -tqqqReturnPct;

    const hedgeBaseIv = (scenario.shockedVxnPct / 100) * IV_SCALE.QQQ;
    let hedgePayoff = 0;
    for (const pos of hedgePuts) {
      if (pos.longQty <= 0) continue;
      const current = currentMarkPerShare(pos, pos.longQty);
      const dte = shockedDte(dteFor(pos));
      const iv = ivFor(hedgeBaseIv, pos.strike / qqqShockedPrice);
      const shocked = bsPutGreeks(qqqShockedPrice, pos.strike, dte / 365, iv, RISK_FREE, DIV_YIELD.QQQ).price;
      hedgePayoff += (shocked - current) * 100 * pos.longQty;
    }

    const shortBaseIv = (scenario.shockedVxnPct / 100) * IV_SCALE.TQQQ;
    let shortBookDamage = 0;
    for (const pos of shortOptions) {
      if (pos.shortQty <= 0) continue;
      const current = currentMarkPerShare(pos, pos.shortQty);
      const dte = shockedDte(dteFor(pos));
      const iv = ivFor(shortBaseIv, pos.strike / tqqqShockedPrice);
      const shocked =
        pos.putCall === "PUT"
          ? bsPutGreeks(tqqqShockedPrice, pos.strike, dte / 365, iv, RISK_FREE, DIV_YIELD.TQQQ).price
          : bsCallGreeks(tqqqShockedPrice, pos.strike, dte / 365, iv, RISK_FREE, DIV_YIELD.TQQQ).price;
      shortBookDamage += (shocked - current) * 100 * pos.shortQty;
    }

    const shortPuts = shortOptions
      .filter((p) => p.putCall === "PUT" && p.shortQty > 0)
      .map((p) => ({ strike: p.strike, shortQty: p.shortQty }));
    const cashPoints = computeCashStress({
      levels,
      ownedLevelIndices,
      shortPuts,
      currentPrice: tqqqShockedPrice,
      cashAvailable,
      maxDropPct: 0,
      stepPct: 1,
    });
    const ladderCashNeeded = cashPoints[0]?.totalNeeded ?? 0;

    return {
      scenario,
      qqqShockedPrice,
      tqqqShockedPrice,
      tqqqReturnPct,
      tqqqPositionLoss,
      hedgePayoff,
      shortBookDamage,
      ladderCashNeeded,
      netDrawdown: tqqqPositionLoss - hedgePayoff + shortBookDamage,
    };
  });
}

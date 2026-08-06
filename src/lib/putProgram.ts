/**
 * Budgeted TQQQ put program hedging the ladder's shares.
 *
 * The rule is a fixed annual spend — a percent of account value — rather than a
 * coverage target, because at any sane budget full coverage is unaffordable:
 * 3% of account forces strikes deep enough that an ordinary drop pays nothing.
 * Partial coverage at a useful strike is the only honest shape, so the budget
 * picks the size and the delta picks the strike.
 *
 * Puts are written on TQQQ itself rather than QQQ. QQQ is more efficient per
 * dollar, but one QQQ contract is ~20% of full coverage and roughly a third of
 * a cycle's budget, so coverage cannot track a share count that moves every
 * time the ladder fills a rung. A TQQQ contract is ~6% of coverage, giving
 * three times the resolution — and it hedges the actual holding, with no
 * leverage-mapping or Nasdaq-vs-S&P basis approximation in between.
 *
 * Strike is set by delta, not by a fixed percentage, so the program behaves
 * consistently across vol regimes: it reaches further out when vol spikes and
 * pulls in when premium is thin.
 *
 * Pricing comes from the app's shared Black-Scholes pricer (@/lib/blackScholes)
 * and implied-vol surface (@/lib/volModel). Pure, no I/O.
 */

import { bsPutGreeks } from "./blackScholes";
import { ivFor, IV_SCALE, DIV_YIELD } from "./volModel";

const RISK_FREE = 0.04;

/** TQQQ lists puts on a $1 grid. */
export const TQQQ_STRIKE_INCREMENT = 1;

/** TQQQ's options run ~3x the ^VXN index vol. */
export function tqqqIvFromVxn(vxn: number): number {
  return (vxn / 100) * IV_SCALE.TQQQ;
}

/**
 * Strike whose put delta matches `targetDelta` (given as a positive magnitude,
 * e.g. 0.10). Put delta rises toward 0.5 as the strike approaches spot, so the
 * search brackets from deep out-of-the-money up to at-the-money.
 */
export function strikeForDelta(
  spot: number,
  baseIv: number,
  dte: number,
  targetDelta: number,
  div = DIV_YIELD.TQQQ,
): number | null {
  if (spot <= 0 || dte <= 0 || targetDelta <= 0 || targetDelta >= 0.5) return null;
  const t = dte / 365;
  const deltaAt = (k: number) =>
    Math.abs(bsPutGreeks(spot, k, t, ivFor(baseIv, k / spot), RISK_FREE, div).delta);

  let lo = spot * 0.2; // very low delta
  let hi = spot; // ~0.5 delta
  if (deltaAt(hi) < targetDelta || deltaAt(lo) > targetDelta) return null;

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (deltaAt(mid) > targetDelta) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export interface ProgramInput {
  accountValue: number;
  /** TQQQ shares currently held by the ladder. */
  tqqqShares: number;
  tqqqSpot: number;
  /** TQQQ's at-the-money implied vol as a decimal. */
  baseIv: number;
  dte: number;
  /** Annual spend as a percent of account value, e.g. 3. */
  budgetPctPerYear: number;
  /** Share of that budget going to this layer, 0–1. Defaults to all of it. */
  budgetShare?: number;
  /** Target put delta magnitude, e.g. 0.10. */
  targetDelta: number;
  /** Rebalance only once coverage drifts this far from target, in percent. */
  driftBandPct: number;
  /** Contracts already open. */
  currentContracts: number;
  strikeIncrement?: number;
}

export type RebalanceAction = "buy" | "sell" | "hold";

export interface ProgramPlan {
  strike: number;
  /** Modeled premium per contract. */
  pricePerContract: number;
  delta: number;
  /** How far the strike sits below spot, as a positive percent. */
  otmPct: number;

  annualBudget: number;
  /** Budget apportioned to one `dte`-length cycle. */
  cycleBudget: number;

  /** Contracts the cycle budget affords. */
  budgetContracts: number;
  /** Contracts needed to cover every share one-for-one. */
  notionalContracts: number;
  /** What to actually hold — the lesser of the two. */
  targetContracts: number;
  /** Which constraint is doing the work. */
  binding: "budget" | "notional";

  /** Share of the held shares covered, as a percent. */
  coveragePct: number;
  /** Cost of holding `targetContracts` for one cycle. */
  cycleCost: number;
  /** That cost annualized, as a percent of account value. */
  annualCostPct: number;

  action: RebalanceAction;
  /** Contracts to trade to reach target. Zero when holding. */
  actionContracts: number;
  /** How far the current position sits from target, in percent. */
  driftPct: number;
}

/**
 * Size the program for today.
 *
 * Two constraints bound the position and the smaller wins: the budget, and the
 * shares actually worth covering. Early in a ladder's life the share count is
 * small and notional binds — there is no reason to spend the full budget
 * insuring shares you do not own. Once deployed, budget binds and coverage is
 * deliberately partial.
 */
export function planProgram(input: ProgramInput): ProgramPlan | null {
  const {
    accountValue,
    tqqqShares,
    tqqqSpot,
    baseIv,
    dte,
    budgetPctPerYear,
    targetDelta,
    driftBandPct,
    currentContracts,
  } = input;
  const share = input.budgetShare ?? 1;
  const inc = input.strikeIncrement ?? TQQQ_STRIKE_INCREMENT;

  const ideal = strikeForDelta(tqqqSpot, baseIv, dte, targetDelta);
  if (ideal == null || accountValue <= 0) return null;
  const strike = Math.max(inc, Math.round(ideal / inc) * inc);

  const g = bsPutGreeks(
    tqqqSpot,
    strike,
    dte / 365,
    ivFor(baseIv, strike / tqqqSpot),
    RISK_FREE,
    DIV_YIELD.TQQQ,
  );
  const pricePerContract = g.price * 100;
  if (pricePerContract <= 0) return null;

  const annualBudget = accountValue * (budgetPctPerYear / 100) * share;
  const cycleBudget = annualBudget * (dte / 365);

  const budgetContracts = Math.floor(cycleBudget / pricePerContract);
  // One TQQQ contract covers exactly 100 shares — no leverage mapping needed.
  const notionalContracts = Math.floor(tqqqShares / 100);
  const targetContracts = Math.max(0, Math.min(budgetContracts, notionalContracts));

  const cycleCost = targetContracts * pricePerContract;

  // Drift is measured against target; with no target, any open position is drift.
  const diff = targetContracts - currentContracts;
  const driftPct =
    targetContracts > 0
      ? (Math.abs(diff) / targetContracts) * 100
      : currentContracts > 0
        ? 100
        : 0;
  const action: RebalanceAction =
    diff === 0 || driftPct < driftBandPct ? "hold" : diff > 0 ? "buy" : "sell";

  return {
    strike,
    pricePerContract,
    delta: g.delta,
    otmPct: ((tqqqSpot - strike) / tqqqSpot) * 100,
    annualBudget,
    cycleBudget,
    budgetContracts,
    notionalContracts,
    targetContracts,
    binding: budgetContracts <= notionalContracts ? "budget" : "notional",
    coveragePct: tqqqShares > 0 ? ((targetContracts * 100) / tqqqShares) * 100 : 0,
    cycleCost,
    annualCostPct: accountValue > 0 ? ((cycleCost * (365 / dte)) / accountValue) * 100 : 0,
    action,
    actionContracts: action === "hold" ? 0 : Math.abs(diff),
    driftPct,
  };
}

export interface ScenarioRow {
  /** TQQQ move as a decimal, e.g. -0.30. */
  tqqqMove: number;
  /** Loss on the TQQQ shares. */
  sharesPl: number;
  /** Put payoff, net of the cycle's cost. */
  putPl: number;
  net: number;
  /** Share of the share loss the puts offset, as a percent. */
  offsetPct: number;
}

/**
 * What the put layer does across a set of TQQQ moves.
 *
 * When `shockedIv` is given the puts are marked with time left and that vol,
 * which is how a real crash plays out — a fast drop lifts implied vol and the
 * puts gain far more than intrinsic. Omit it for the expiry-intrinsic floor.
 */
export function scenarioTable(
  plan: ProgramPlan,
  tqqqShares: number,
  tqqqSpot: number,
  tqqqMoves: number[],
  shocked?: { iv: number; daysLeft: number },
): ScenarioRow[] {
  return tqqqMoves.map((tqqqMove) => {
    const sharesPl = tqqqShares * tqqqSpot * tqqqMove;
    const at = tqqqSpot * (1 + tqqqMove);
    const value = shocked
      ? bsPutGreeks(
          at,
          plan.strike,
          Math.max(shocked.daysLeft, 0) / 365,
          ivFor(shocked.iv, plan.strike / at),
          RISK_FREE,
          DIV_YIELD.TQQQ,
        ).price *
        100 *
        plan.targetContracts
      : Math.max(plan.strike - at, 0) * 100 * plan.targetContracts;
    const putPl = value - plan.cycleCost;
    return {
      tqqqMove,
      sharesPl,
      putPl,
      net: sharesPl + putPl,
      offsetPct: sharesPl < 0 ? (Math.min(putPl, -sharesPl) / -sharesPl) * 100 : 0,
    };
  });
}

/** A filled option leg, as recorded by the brokers' order feeds. */
interface FilledLeg {
  underlyingSymbol: string;
  instruction: "SELL_TO_OPEN" | "BUY_TO_CLOSE" | "BUY_TO_OPEN" | "SELL_TO_CLOSE";
  /** Signed: positive = credit received, negative = debit paid. */
  total: number;
  fees: number;
  time: string;
}

/** A filled option leg with enough identity to group fills into a contract. */
interface FilledContractLeg extends FilledLeg {
  /** OCC symbol, e.g. "TQQQ  260515P00056000". */
  symbol: string;
  contracts: number;
}

/**
 * Shortest tenor the hedge ever opens at.
 *
 * The program's own expiry choices start at 30 days and it rolls out before 21,
 * so a put bought nearer than this is a short-dated trade — a 0DTE punt, a
 * weekly, an earnings hedge — not part of the program. Without this floor the
 * budget swallows every fast round trip on the same underlying, which is by far
 * the largest source of wrong rows: those trades are usually the majority of
 * bought-put fills and often the largest tickets.
 */
export const MIN_HEDGE_DTE = 21;

/** Whole days between a fill's timestamp and an expiry date. */
function dteAt(time: string, expiry: string): number {
  const opened = new Date(time.slice(0, 10)).getTime();
  const expires = new Date(expiry).getTime();
  return Math.round((expires - opened) / 86_400_000);
}

/** Strike, expiry and right, read off the tail of an OCC symbol. */
function occDetails(symbol: string) {
  const m = symbol.replace(/\s+/g, "").match(/(\d{6})([CP])(\d{8})$/);
  if (!m) return { putCall: null, strike: null, expiry: null };
  const [, date, pc, strikeRaw] = m;
  return {
    putCall: (pc === "C" ? "CALL" : "PUT") as "CALL" | "PUT",
    strike: parseInt(strikeRaw, 10) / 1000,
    expiry: `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)}`,
  };
}

/** One hedge contract's spend inside the budget window, opens netted with closes. */
export interface HedgeLot {
  symbol: string;
  underlyingSymbol: string;
  putCall: "CALL" | "PUT" | null;
  strike: number | null;
  expiry: string | null;
  /** Contracts bought to open inside the window. */
  contracts: number;
  /** Contracts sold to close inside the window. */
  closedContracts: number;
  /** Still held out of this window's opens. */
  openContracts: number;
  openedAt: string | null;
  closedAt: string | null;
  /** Weighted-average debit per share, fees included. Null when the window caught only closes. */
  openPrice: number | null;
  /** Weighted-average credit per share, fees included. Null while nothing has been closed. */
  closePrice: number | null;
  /** Dollars paid to open, fees included. */
  cost: number;
  /** Dollars recovered by closing, fees included. */
  proceeds: number;
  /** Days from the buy to expiry — the tenor {@link MIN_HEDGE_DTE} judges. */
  openDte: number | null;
  /** Days from the buy to the close, or to today while any of it is still held. */
  daysHeld: number | null;
}

/**
 * Whether a fill can be hedge spend at all.
 *
 * Two rules, and both matter. Only the *long* side counts: the ladder sells
 * cash-secured puts and covered calls on TQQQ, and folding those credits in
 * would understate hedge spend — sell enough premium and the budget would look
 * untouched while the hedge quietly ran over. And on the equity underlyings
 * only *puts* count, because a bought TQQQ call is a directional trade, not
 * insurance. VIX products are long-only convexity in any form, so they pass on
 * the instruction alone.
 *
 * This is deliberately a coarse net: it catches the right kind of fill, not the
 * right intent. A put bought for some other reason still lands here, which is
 * why the page lets individual lots be excluded by hand.
 */
export function isHedgeFill(leg: Pick<FilledContractLeg, "underlyingSymbol" | "symbol" | "instruction">): boolean {
  if (leg.instruction !== "BUY_TO_OPEN" && leg.instruction !== "SELL_TO_CLOSE") return false;
  const underlying = leg.underlyingSymbol.replace(/^\$/, "").toUpperCase();
  if (underlying.startsWith("VIX")) return true;
  if (underlying === "QQQ" || underlying === "TQQQ") {
    return occDetails(leg.symbol).putCall === "PUT";
  }
  return false;
}

/**
 * Every fill {@link isHedgeFill} accepts since `since`, grouped per contract so
 * the budget can be itemised and hand-edited, less anything opened inside
 * {@link MIN_HEDGE_DTE}. Fees count — on a 3% budget they are not a rounding
 * error.
 *
 * Grouping is by OCC symbol, so repeated buys of one contract read as a single
 * lot. A close whose open happened before the window still gets a row — its
 * credit counts against this year's spend, and hiding it would make the rows
 * disagree with the total.
 */
export function hedgeLots(
  orders: FilledContractLeg[],
  since: Date,
  now = new Date(),
): HedgeLot[] {
  const lots = new Map<string, HedgeLot>();

  const lotFor = (o: FilledContractLeg) => {
    const key = o.symbol.trim();
    let lot = lots.get(key);
    if (!lot) {
      lot = {
        symbol: key,
        underlyingSymbol: o.underlyingSymbol,
        ...occDetails(key),
        contracts: 0,
        closedContracts: 0,
        openContracts: 0,
        openedAt: null,
        closedAt: null,
        openPrice: null,
        closePrice: null,
        cost: 0,
        proceeds: 0,
        openDte: null,
        daysHeld: null,
      };
      lots.set(key, lot);
    }
    return lot;
  };

  for (const o of orders) {
    if (!isHedgeFill(o)) continue;
    if (new Date(o.time) < since) continue;
    const lot = lotFor(o);
    if (o.instruction === "BUY_TO_OPEN") {
      lot.contracts += o.contracts;
      lot.cost += -(o.total + o.fees);
      if (!lot.openedAt || o.time < lot.openedAt) lot.openedAt = o.time;
    } else {
      lot.closedContracts += o.contracts;
      lot.proceeds += o.total + o.fees;
      if (!lot.closedAt || o.time > lot.closedAt) lot.closedAt = o.time;
    }
  }

  return [...lots.values()]
    // Tenor is judged per lot, not per fill: the close of a genuine hedge lands
    // days from expiry by design, so testing the sell would throw away the
    // credit while keeping its cost. Only how far out it was *bought* matters.
    .filter(
      (lot) =>
        lot.openedAt == null ||
        lot.expiry == null ||
        dteAt(lot.openedAt, lot.expiry) >= MIN_HEDGE_DTE,
    )
    .map((lot) => {
      const openContracts = Math.max(lot.contracts - lot.closedContracts, 0);
      // A lot still partly held is measured to today; one fully closed stops at
      // its last sell.
      const until = openContracts > 0 || !lot.closedAt ? now.toISOString() : lot.closedAt;
      return {
        ...lot,
        openContracts,
        openPrice: lot.contracts > 0 ? lot.cost / (lot.contracts * 100) : null,
        closePrice: lot.closedContracts > 0 ? lot.proceeds / (lot.closedContracts * 100) : null,
        openDte: lot.openedAt && lot.expiry ? dteAt(lot.openedAt, lot.expiry) : null,
        daysHeld: lot.openedAt ? dteAt(lot.openedAt, until.slice(0, 10)) : null,
      };
    })
    .sort((a, b) => (b.openedAt ?? b.closedAt ?? "").localeCompare(a.openedAt ?? a.closedAt ?? ""));
}

/**
 * Net dollars the kept lots have cost — what was paid to open, less anything
 * recovered by closing. `excluded` holds OCC symbols struck off by hand.
 */
export function hedgeSpend(lots: HedgeLot[], excluded: Set<string> = new Set()): number {
  return lots.reduce(
    (spent, lot) => (excluded.has(lot.symbol) ? spent : spent + lot.cost - lot.proceeds),
    0,
  );
}

/** Where the year's spend stands against the budget, pace included. */
export interface BudgetStatus {
  annualBudget: number;
  spent: number;
  remaining: number;
  /** Fraction of the year elapsed, 0–1. */
  yearElapsed: number;
  /** What should have been spent by now to be exactly on pace. */
  onPaceSpend: number;
  /** Positive = spending faster than budget allows. */
  overPace: number;
}

export function budgetStatus(annualBudget: number, spent: number, now = new Date()): BudgetStatus {
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear() + 1, 0, 1);
  const yearElapsed = (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
  const onPaceSpend = annualBudget * yearElapsed;
  return {
    annualBudget,
    spent,
    remaining: annualBudget - spent,
    yearElapsed,
    onPaceSpend,
    overPace: spent - onPaceSpend,
  };
}

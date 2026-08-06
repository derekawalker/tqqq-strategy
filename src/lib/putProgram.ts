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

/**
 * Net dollars spent on the hedge since `since`, counting both what was paid to
 * open and anything recovered by closing. Fees count — on a 3% budget they are
 * not a rounding error.
 *
 * Only the *long* side counts. The ladder sells cash-secured TQQQ puts on the
 * same underlying, and folding those credits in here would understate hedge
 * spend — sell enough premium and the budget would look untouched while the
 * hedge quietly ran over. Long opens and their closes only.
 */
export function hedgeSpendSince(orders: FilledLeg[], since: Date, symbols: string[]): number {
  let spent = 0;
  for (const o of orders) {
    if (!symbols.includes(o.underlyingSymbol)) continue;
    if (o.instruction !== "BUY_TO_OPEN" && o.instruction !== "SELL_TO_CLOSE") continue;
    if (new Date(o.time) < since) continue;
    spent -= o.total + o.fees;
  }
  return spent;
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

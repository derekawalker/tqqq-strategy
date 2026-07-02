/**
 * Hedge net carry: option income YTD (the TQQQ covered-call/CSP book) minus
 * hedge spend YTD (the QQQ put budget, from hedgeBudget.ts). Tail hedges
 * routinely get abandoned after a long quiet stretch because the cost is
 * visible every month and the offset isn't — putting both numbers on one
 * card is meant to remove that psychological pressure to skip a scheduled
 * hedge buy.
 */

import type { FilledOptionOrder } from "./schwab/parse";
import { buildBudgetOrders, computeBudgetSpend } from "./hedgeBudget";

export interface HedgeCarry {
  year: number;
  /** Realized net cash flow from selling TQQQ covered calls/CSPs this year (credits − debits − fees). */
  optionIncomeYtd: number;
  /** Premium paid on the QQQ hedge budget this year, net of premium recovered. */
  hedgeSpendYtd: number;
  /** optionIncomeYtd − hedgeSpendYtd. */
  netCarry: number;
}

/**
 * @param filledOptionOrders  all filled option orders for the active account (any instrument/year)
 * @param flippedBudgetIds    order IDs the user manually flipped from the DTE-based hedge-budget default
 * @param year                defaults to the current calendar year
 */
export function computeHedgeCarry(
  filledOptionOrders: FilledOptionOrder[],
  flippedBudgetIds: Set<number>,
  year = new Date().getFullYear(),
): HedgeCarry {
  const optionIncomeYtd = filledOptionOrders
    .filter((o) => o.underlyingSymbol === "TQQQ" && new Date(o.time).getFullYear() === year)
    .reduce((sum, o) => sum + o.total + o.fees, 0);

  const budgetOrders = buildBudgetOrders(filledOptionOrders, flippedBudgetIds, "QQQ", year);
  const { paid, recovered } = computeBudgetSpend(filledOptionOrders, budgetOrders, year);
  const hedgeSpendYtd = paid - recovered;

  return {
    year,
    optionIncomeYtd,
    hedgeSpendYtd,
    netCarry: optionIncomeYtd - hedgeSpendYtd,
  };
}

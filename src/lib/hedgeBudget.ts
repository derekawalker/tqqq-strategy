/**
 * QQQ-put hedge budget tracking — which buys count toward the annual hedge
 * budget, and how much has been spent net of premium recovered by closing
 * those same contracts. Extracted from the Hedge page's Put Hedge panel so
 * the net-carry card (dashboardActions.ts / HedgeCarryCard) can reuse the
 * exact same "what counts as the hedge" rule instead of re-deriving it.
 */

import type { FilledOptionOrder } from "./schwab/parse";

/** Buys opened with fewer DTE than this default to *excluded* — they're short-term
 *  trades, not the long-dated hedge. */
export const HEDGE_MIN_DTE = 45;

/** Days-to-expiry at purchase: expiry (parsed from the OCC symbol) minus the fill date. */
export function dteAtPurchase(symbol: string, time: string): number | null {
  const m = symbol.match(/(\d{2})(\d{2})(\d{2})[CP]\d{8}$/);
  if (!m) return null;
  const expiry = Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], 23, 59, 59);
  return Math.round((expiry - new Date(time).getTime()) / 86_400_000);
}

/** Default include state: count it as the hedge only if opened long-dated (≥ HEDGE_MIN_DTE). */
export function autoIncluded(dte: number | null): boolean {
  return dte === null ? true : dte >= HEDGE_MIN_DTE;
}

export interface BudgetOrder {
  id: number;
  time: string;
  symbol: string;
  strike: number;
  contracts: number;
  premium: number;
  dteAtPurchase: number | null;
  /** True when the DTE rule auto-excludes this buy (short-dated, non-hedge). */
  autoExcluded: boolean;
  included: boolean;
}

/**
 * This year's put buys for `instrument`, with include state = DTE default
 * XOR the user's manual flip (`flippedBudgetIds`).
 */
export function buildBudgetOrders(
  filledOptionOrders: FilledOptionOrder[],
  flippedBudgetIds: Set<number>,
  instrument: string,
  year = new Date().getFullYear(),
): BudgetOrder[] {
  return filledOptionOrders
    .filter(
      (o) =>
        o.underlyingSymbol === instrument &&
        o.instruction === "BUY_TO_OPEN" &&
        /P\d{8}$/.test(o.symbol) &&
        new Date(o.time).getFullYear() === year,
    )
    .map((o) => {
      const m = o.symbol.match(/P(\d{8})$/);
      const dte = dteAtPurchase(o.symbol, o.time);
      const auto = autoIncluded(dte);
      const included = auto !== flippedBudgetIds.has(o.orderId); // XOR with manual flip
      return {
        id: o.orderId,
        time: o.time,
        symbol: o.symbol,
        strike: m ? parseInt(m[1], 10) / 1000 : 0,
        contracts: o.contracts,
        premium: Math.abs(o.total),
        dteAtPurchase: dte,
        autoExcluded: !auto,
        included,
      };
    })
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}

export interface BudgetSpend {
  /** Premium paid on the included buys this year. */
  paid: number;
  /** Premium recovered by closing those same (included) contracts this year. */
  recovered: number;
}

/**
 * YTD hedge spend: premium paid on the *included* buys, less premium recovered
 * by closing those same contracts (matched by OCC symbol).
 */
export function computeBudgetSpend(
  filledOptionOrders: FilledOptionOrder[],
  budgetOrders: BudgetOrder[],
  year = new Date().getFullYear(),
): BudgetSpend {
  const includedSymbols = new Set(budgetOrders.filter((o) => o.included).map((o) => o.symbol));
  const paid = budgetOrders.filter((o) => o.included).reduce((s, o) => s + o.premium, 0);
  let recovered = 0;
  for (const o of filledOptionOrders) {
    if (o.instruction !== "SELL_TO_CLOSE") continue;
    if (!includedSymbols.has(o.symbol)) continue;
    if (new Date(o.time).getFullYear() !== year) continue;
    recovered += Math.abs(o.total);
  }
  return { paid, recovered };
}

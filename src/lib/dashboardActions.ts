/**
 * Unified daily action queue: aggregates hedge actions, short-option exit
 * signals, near-spot ladder buys/sells, and regime changes into one ordered
 * checklist so the dashboard answers "what do I need to do today?" without
 * visiting four separate pages. Pure — the UI layer supplies already-fetched
 * data and maps `kind` to an icon/href.
 */

import type { Level } from "./levels";
import type { OptionPosition } from "./schwab/parse";
import type { WorkingOrder } from "./schwab/parse";
import { type HedgeActionItem } from "./hedgeActions";
import type { Regime } from "./sentiment";
import { regimeAction } from "./sentiment";

export type QueueSource = "hedge" | "options" | "ladder" | "regime";

export type QueueActionKind =
  | HedgeActionItem["kind"]
  | "option-close-profit"
  | "option-manage-dte"
  | "ladder-buy-due"
  | "ladder-sell-due"
  | "regime-caution";

export interface QueueAction {
  kind: QueueActionKind;
  source: QueueSource;
  priority: number;
  /** Days until this step is due (0 = act now). */
  daysAway: number;
  title: string;
  detail: string;
  color: string;
  href: string;
}

/** Wrap the hedge panel's own prioritized list into unified queue items. */
export function hedgeQueueActions(actions: HedgeActionItem[]): QueueAction[] {
  return actions.map((a) => ({
    kind: a.kind,
    source: "hedge",
    priority: a.priority,
    daysAway: a.daysAway,
    title: a.title,
    detail: a.detail,
    color: a.color,
    href: "/hedge",
  }));
}

/** Close at 50–65% of max profit captured, or manage at 21 DTE — whichever fires first. */
export const OPTION_PROFIT_CAPTURE_PCT = 0.5;
export const OPTION_MANAGE_DTE = 21;
/** Only surface positions coming due soon, not every healthy position far from expiry. */
const OPTION_LOOKAHEAD_DAYS = 14;

/**
 * Exit-mechanics signals for the short TQQQ option book (covered calls / CSPs).
 * `dteFor` is injected so this module stays a pure function of its inputs
 * (no `Date.now()` call baked in), matching the crashStress.ts convention.
 */
export function optionQueueActions(
  shortOptions: OptionPosition[],
  dteFor: (position: OptionPosition) => number,
): QueueAction[] {
  const actions: QueueAction[] = [];
  for (const pos of shortOptions) {
    if (pos.shortQty <= 0) continue;
    const dte = dteFor(pos);
    const credit = pos.averagePrice * pos.shortQty * 100;
    const costToClose = Math.abs(pos.marketValue);
    const capturedPct = credit > 0 ? (credit - costToClose) / credit : 0;
    const label = `${pos.underlyingSymbol} $${pos.strike} ${pos.putCall === "PUT" ? "put" : "call"}`;
    // Negative capture means the position has moved against the seller (costs more to close
    // than was collected) — phrase as "down X%", not a confusing negative "captured" number.
    const captureLabel =
      capturedPct >= 0 ? `${(capturedPct * 100).toFixed(0)}% captured` : `down ${(-capturedPct * 100).toFixed(0)}%`;

    if (capturedPct >= OPTION_PROFIT_CAPTURE_PCT) {
      actions.push({
        kind: "option-close-profit",
        source: "options",
        priority: 1,
        daysAway: 0,
        title: `${label} — ${(capturedPct * 100).toFixed(0)}% captured, close & redeploy`,
        detail: `Credit ${credit.toFixed(0)}, cost to close ${costToClose.toFixed(0)}. Past the 50% capture line — diminishing theta from here isn't worth the remaining gamma risk.`,
        color: "teal",
        href: "/options",
      });
    } else if (dte <= OPTION_MANAGE_DTE) {
      actions.push({
        kind: "option-manage-dte",
        source: "options",
        priority: 2,
        daysAway: Math.max(0, dte - OPTION_MANAGE_DTE),
        title: `${label} — ${dte}d DTE, roll or close`,
        detail: `${captureLabel}, and inside the ${OPTION_MANAGE_DTE}-day management window — gamma risk rises fast from here.`,
        color: "yellow",
        href: "/options",
      });
    } else if (dte - OPTION_MANAGE_DTE <= OPTION_LOOKAHEAD_DAYS) {
      actions.push({
        kind: "option-manage-dte",
        source: "options",
        priority: 4,
        daysAway: dte - OPTION_MANAGE_DTE,
        title: `${label} — reaches ${OPTION_MANAGE_DTE}d DTE soon`,
        detail: `${dte}d left. Will need management in ${dte - OPTION_MANAGE_DTE}d if not closed for profit first.`,
        color: "gray",
        href: "/options",
      });
    }
  }
  return actions;
}

/** How close (as a fraction of price) a level counts as "near spot" / actionable now. */
const LADDER_NEAR_PCT = 0.02;
/** How close a working order's limit must sit to a level's price to count as already covering it. */
const WORKING_ORDER_MATCH_TOLERANCE = 0.01;

function hasMatchingWorkingOrder(
  workingOrders: WorkingOrder[],
  side: "BUY" | "SELL",
  shares: number,
  price: number,
): boolean {
  return workingOrders.some(
    (o) =>
      o.side === side &&
      o.shares === shares &&
      Math.abs(o.limitPrice - price) <= price * WORKING_ORDER_MATCH_TOLERANCE,
  );
}

/**
 * Flag ladder buy/sell levels within LADDER_NEAR_PCT of the current price that
 * don't already have a matching working order — i.e., a rung the ladder
 * should be acting on that isn't queued at the broker yet.
 */
export function ladderQueueActions(
  levels: Level[],
  ownedLevelIndices: Set<number>,
  currentPrice: number,
  workingOrders: WorkingOrder[],
): QueueAction[] {
  if (currentPrice <= 0) return [];
  const actions: QueueAction[] = [];
  const band = currentPrice * LADDER_NEAR_PCT;

  for (const level of levels) {
    const owned = ownedLevelIndices.has(level.n);
    if (!owned && Math.abs(level.buyPrice - currentPrice) <= band && level.buyPrice >= currentPrice - band) {
      if (!hasMatchingWorkingOrder(workingOrders, "BUY", level.shares, level.buyPrice)) {
        actions.push({
          kind: "ladder-buy-due",
          source: "ladder",
          priority: 3,
          daysAway: 0,
          title: `Ladder buy due — level ${level.n} at $${level.buyPrice.toFixed(2)}`,
          detail: `${level.shares} sh at $${level.buyPrice.toFixed(2)} — no matching working order found.`,
          color: "teal",
          href: "/working-orders",
        });
      }
    }
    if (owned && Math.abs(level.sellPrice - currentPrice) <= band) {
      if (!hasMatchingWorkingOrder(workingOrders, "SELL", level.shares, level.sellPrice)) {
        actions.push({
          kind: "ladder-sell-due",
          source: "ladder",
          priority: 3,
          daysAway: 0,
          title: `Ladder sell due — level ${level.n} at $${level.sellPrice.toFixed(2)}`,
          detail: `${level.shares} sh at $${level.sellPrice.toFixed(2)} — no matching working order found.`,
          color: "teal",
          href: "/working-orders",
        });
      }
    }
  }
  return actions;
}

/** Advisory reminder when the regime isn't Risk-On — no action needed when everything's fine. */
export function regimeQueueActions(regime: Regime, daysInRegime: number): QueueAction[] {
  if (regime === "Risk-On") return [];
  return [
    {
      kind: "regime-caution",
      source: "regime",
      priority: regime === "Risk-Off" ? 0 : 5,
      daysAway: 0,
      title: `Regime: ${regime}${daysInRegime <= 1 ? " (just changed)" : ` — ${daysInRegime}d`}`,
      detail: regimeAction(regime),
      color: regime === "Risk-Off" ? "red" : "orange",
      href: "/sentiment",
    },
  ];
}

/** Merge and sort all sources into one chronological, urgency-tiebroken queue. */
export function buildActionQueue(...groups: QueueAction[][]): QueueAction[] {
  return groups.flat().sort((a, b) => a.daysAway - b.daysAway || a.priority - b.priority);
}

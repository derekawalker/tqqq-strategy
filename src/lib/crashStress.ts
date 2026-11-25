/**
 * What the rest of the book does in a crash episode, next to the hedge.
 *
 * The Hedge page's episode table started with shares vs. hedge. That flatters
 * the hedge whenever short options are open or the ladder still has rungs below
 * spot: cash-secured puts go deep in the money and the ladder keeps buying all
 * the way down, and both of those losses land in the same episode the hedge is
 * meant to offset. Pure, no I/O.
 */

import { bsCallGreeks, bsPutGreeks } from "./blackScholes";
import { ivFor, DIV_YIELD } from "./volModel";
import type { Level } from "./levels";
import type { OptionPosition } from "./schwab/parse";

const RISK_FREE = 0.04;

export interface EpisodeShock {
  /** Peak-to-trough TQQQ move, e.g. -0.55. */
  tqqqMove: number;
  /** Calendar days from peak to trough. */
  days: number;
  /** Annualised TQQQ implied vol at the trough (decimal). */
  iv: number;
}

function daysUntil(expiry: string, now: Date): number {
  const ms = new Date(expiry + "T23:59:59").getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/**
 * Mark-to-market change on the short TQQQ options over the episode, as if it
 * started today. Price falls linearly from spot to the trough over `days`; an
 * option expiring part way settles at intrinsic on the path price that day,
 * anything still alive is marked at the trough with the episode's vol.
 * Negative = loss. Covered calls gain in a crash and are counted too.
 */
export function shortOptionsPl(
  positions: OptionPosition[],
  spot: number,
  shock: EpisodeShock,
  now = new Date(),
): number {
  if (spot <= 0) return 0;
  let pl = 0;
  for (const p of positions) {
    if (p.underlyingSymbol !== "TQQQ" || p.shortQty <= 0) continue;
    const dte = daysUntil(p.expiry, now);
    const elapsed = Math.min(dte, shock.days);
    const s = spot * (1 + shock.tqqqMove * (shock.days > 0 ? elapsed / shock.days : 1));
    const left = Math.max(dte - shock.days, 0) / 365;
    const sigma = ivFor(shock.iv, p.strike / s);
    const price =
      p.putCall === "PUT"
        ? bsPutGreeks(s, p.strike, left, sigma, RISK_FREE, DIV_YIELD.TQQQ).price
        : bsCallGreeks(s, p.strike, left, sigma, RISK_FREE, DIV_YIELD.TQQQ).price;
    const currentValue = Math.abs(p.marketValue);
    pl += currentValue - price * 100 * p.shortQty;
  }
  return pl;
}

export interface LadderShock {
  /** Cash the unpurchased rungs between spot and the trough would take. */
  cost: number;
  /** Those buys marked at the trough. Negative = loss. */
  pl: number;
}

/** Ladder rungs below spot that fill on the way down, marked at the trough. */
export function ladderBuysAtTrough(
  levels: Level[],
  ownedLevelIndices: Set<number>,
  spot: number,
  tqqqMove: number,
): LadderShock {
  const trough = spot * (1 + tqqqMove);
  let cost = 0;
  let pl = 0;
  for (const l of levels) {
    if (ownedLevelIndices.has(l.n) || l.shares <= 0) continue;
    if (l.buyPrice >= spot || l.buyPrice < trough) continue;
    cost += l.shares * l.buyPrice;
    pl += l.shares * (trough - l.buyPrice);
  }
  return { cost, pl };
}

/** Cash short TQQQ puts would take if assigned at or above the trough. */
export function putAssignmentCash(positions: OptionPosition[], trough: number): number {
  return positions
    .filter((p) => p.underlyingSymbol === "TQQQ" && p.putCall === "PUT" && p.shortQty > 0 && p.strike >= trough)
    .reduce((sum, p) => sum + p.strike * 100 * p.shortQty, 0);
}

/**
 * Shared implied-vol model for option pricing off the ^VXN input: per-underlying
 * IV scaling, dividend yields, and the equity/index put skew.
 *
 * ^VXN is QQQ's own 30-day implied vol index, so it *is* QQQ's ATM IV; TQQQ
 * options run roughly the leverage multiple of it. Keeping both the scale and
 * the skew here means every modeled premium in the app (option-selling yield
 * estimates, what-if pricing) uses one vol surface instead of each caller
 * rolling its own and drifting out of sync.
 *
 * Pure, no I/O.
 */

/** Underlyings this app models options on. */
export type OptionUnderlying = "QQQ" | "TQQQ";

/** IV multiplier vs ^VXN: TQQQ options run ~3× the index implied vol. */
export const IV_SCALE: Record<OptionUnderlying, number> = { QQQ: 1, TQQQ: 3 };

/** Dividend yield of each underlying. */
export const DIV_YIELD: Record<OptionUnderlying, number> = { QQQ: 0.006, TQQQ: 0 };

/** Linear vol skew: deeper-OTM puts carry richer IV than the ATM ^VXN level. */
export const SKEW = 0.8;

/**
 * Skew-adjusted implied vol for a given moneyness (strike / spot). Deeper-OTM
 * puts (moneyness < 1) carry richer IV than the ATM level; OTM calls
 * (moneyness > 1) are left at the base IV — this models the equity/index put
 * skew, not a symmetric smile, which matches how TQQQ/QQQ options actually
 * trade.
 */
export function ivFor(baseIv: number, moneyness: number): number {
  return baseIv * (1 + SKEW * Math.max(0, 1 - moneyness));
}

/**
 * Per-strike economics for the option-selling ladder (covered calls / cash-
 * secured puts): modeled premium, delta, and annualized yield for a
 * hypothetical sale at a target DTE. Turns the strike grid from "here's
 * where you *could* sell" into "here's what's actually paying today."
 *
 * Pricing shares the same Black-Scholes + skew model as the hedge pricer
 * (@/lib/putHedge, @/lib/hedgeTranches) so a TQQQ strike's modeled premium
 * here and the hedge's modeled premium there never drift out of sync.
 */

import { bsPutGreeks, bsCallGreeks } from "./putHedge";

/** Annualized yield (%) at/above which a sale is flagged as attractive. */
export const GOOD_SALE_YIELD_PCT = 15;

/**
 * Delta ceiling for the "good sale" flag — high-delta rows carry high
 * assignment risk even when the yield looks rich, so they're excluded even
 * if the yield threshold clears.
 */
export const GOOD_SALE_MAX_DELTA = 0.35;

const RISK_FREE = 0.04;

export interface SaleEconomics {
  /** Modeled premium for one contract (100 shares), in dollars. */
  premiumPerContract: number;
  /** Absolute delta (assignment-probability proxy). */
  delta: number;
  /** Annualized return on the relevant basis (shares for calls, collateral for puts), as a percent. */
  annualizedYieldPct: number;
  /** True when yield clears the threshold at an acceptable (not-too-high) delta. */
  goodSale: boolean;
}

function toSaleEconomics(
  price: number,
  delta: number,
  yieldBasis: number,
  dte: number,
): SaleEconomics {
  const annualizedYieldPct =
    yieldBasis > 0 && dte > 0 ? (price / yieldBasis) * (365 / dte) * 100 : 0;
  const absDelta = Math.abs(delta);
  return {
    premiumPerContract: price * 100,
    delta: absDelta,
    annualizedYieldPct,
    goodSale: annualizedYieldPct >= GOOD_SALE_YIELD_PCT && absDelta <= GOOD_SALE_MAX_DELTA,
  };
}

/**
 * Covered-call economics for a hypothetical sale at `strike`, `dte` days out.
 * Yield is annualized return on the underlying shares (yield-on-shares).
 */
export function estimateCallSale(
  spot: number,
  strike: number,
  dte: number,
  iv: number,
  div = 0,
): SaleEconomics {
  const g = bsCallGreeks(spot, strike, dte / 365, iv, RISK_FREE, div);
  return toSaleEconomics(g.price, g.delta, spot, dte);
}

/**
 * Cash-secured-put economics for a hypothetical sale at `strike`, `dte` days
 * out. Yield is annualized return on collateral (strike × 100).
 */
export function estimatePutSale(
  spot: number,
  strike: number,
  dte: number,
  iv: number,
  div = 0,
): SaleEconomics {
  const g = bsPutGreeks(spot, strike, dte / 365, iv, RISK_FREE, div);
  return toSaleEconomics(g.price, g.delta, strike, dte);
}

/**
 * Black-Scholes put pricing — used to estimate hedge premiums when no live
 * option chain is available. Pure, no I/O.
 */

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation. */
export function normCdf(x: number): number {
  // erf(z) approximation, |error| < 1.5e-7
  const z = x / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

/** Standard normal PDF. */
export function normPdf(x: number): number {
  return 0.3989422804014327 * Math.exp(-0.5 * x * x);
}

/**
 * Black-Scholes price of a European put.
 *
 * @param s     spot price of the option's underlying
 * @param k     strike
 * @param tYears time to expiry in years (<= 0 returns intrinsic value)
 * @param sigma annualized implied vol as a decimal (0.20 = 20%)
 * @param r     annual risk-free rate (decimal)
 * @param q     annual dividend yield of the underlying (decimal)
 */
export function bsPut(
  s: number,
  k: number,
  tYears: number,
  sigma: number,
  r = 0.04,
  q = 0,
): number {
  if (tYears <= 0 || sigma <= 0) return Math.max(k - s, 0); // intrinsic
  const sqrtT = Math.sqrt(tYears);
  const d1 = (Math.log(s / k) + (r - q + 0.5 * sigma * sigma) * tYears) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return k * Math.exp(-r * tYears) * normCdf(-d2) - s * Math.exp(-q * tYears) * normCdf(-d1);
}

export interface PutGreeks {
  /** Price per share (× 100 for one contract). */
  price: number;
  /** Put delta — negative, in [−1, 0]. */
  delta: number;
  /** Theta per calendar day, per share (negative = time decay costs you). */
  theta: number;
  /** Vega per 1 vol point (0.01 change in sigma), per share. */
  vega: number;
}

export interface CallGreeks {
  /** Price per share (× 100 for one contract). */
  price: number;
  /** Call delta — positive, in [0, 1]. */
  delta: number;
  /** Theta per calendar day, per share (negative = time decay costs you). */
  theta: number;
  /** Vega per 1 vol point (0.01 change in sigma), per share. */
  vega: number;
}

/**
 * Black-Scholes call price plus the greeks used to estimate covered-call
 * income (delta as an assignment-probability proxy, price for annualized
 * yield). Same params as {@link bsPutGreeks}. At/after expiry returns
 * intrinsic with delta of 1 (ITM) or 0 (OTM) and zero theta/vega.
 */
export function bsCallGreeks(
  s: number,
  k: number,
  tYears: number,
  sigma: number,
  r = 0.04,
  q = 0,
): CallGreeks {
  if (tYears <= 0 || sigma <= 0) {
    const intrinsic = Math.max(s - k, 0);
    return { price: intrinsic, delta: s > k ? 1 : 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(tYears);
  const d1 = (Math.log(s / k) + (r - q + 0.5 * sigma * sigma) * tYears) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const price = s * Math.exp(-q * tYears) * normCdf(d1) - k * Math.exp(-r * tYears) * normCdf(d2);
  const delta = Math.exp(-q * tYears) * normCdf(d1);
  const thetaYr =
    -(s * Math.exp(-q * tYears) * normPdf(d1) * sigma) / (2 * sqrtT) -
    r * k * Math.exp(-r * tYears) * normCdf(d2) +
    q * s * Math.exp(-q * tYears) * normCdf(d1);
  const vega = (s * Math.exp(-q * tYears) * normPdf(d1) * sqrtT) / 100;
  return { price, delta, theta: thetaYr / 365, vega };
}

/**
 * Black-Scholes put price plus the greeks the hedge logic needs.
 * Same params as {@link bsPut}. At/after expiry returns intrinsic with
 * delta of −1 (ITM) or 0 (OTM) and zero theta/vega.
 */
export function bsPutGreeks(
  s: number,
  k: number,
  tYears: number,
  sigma: number,
  r = 0.04,
  q = 0,
): PutGreeks {
  if (tYears <= 0 || sigma <= 0) {
    const intrinsic = Math.max(k - s, 0);
    return { price: intrinsic, delta: s < k ? -1 : 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(tYears);
  const d1 = (Math.log(s / k) + (r - q + 0.5 * sigma * sigma) * tYears) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const price = k * Math.exp(-r * tYears) * normCdf(-d2) - s * Math.exp(-q * tYears) * normCdf(-d1);
  const delta = -Math.exp(-q * tYears) * normCdf(-d1);
  const thetaYr =
    -(s * Math.exp(-q * tYears) * normPdf(d1) * sigma) / (2 * sqrtT) +
    r * k * Math.exp(-r * tYears) * normCdf(-d2) -
    q * s * Math.exp(-q * tYears) * normCdf(-d1);
  const vega = (s * Math.exp(-q * tYears) * normPdf(d1) * sqrtT) / 100;
  return { price, delta, theta: thetaYr / 365, vega };
}

/**
 * Solve for the put strike that gives a target (absolute) delta, by bisection.
 * Returns a strike rounded to the nearest $0.50. Used to target strikes by delta
 * (e.g. "the 0.20-delta put") and to project roll costs off live spot + IV.
 *
 * @param targetDelta absolute delta to hit (0.20 → a −0.20-delta put)
 */
export function strikeForDelta(
  s: number,
  tYears: number,
  sigma: number,
  targetDelta: number,
  r = 0.04,
  q = 0,
): number {
  let lo = s * 0.3; // deep OTM puts → small |delta|
  let hi = s * 1.2; // ITM puts → |delta| → 1
  const tgt = -Math.abs(targetDelta);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const d = bsPutGreeks(s, mid, tYears, sigma, r, q).delta;
    // Higher strike → more negative (lower) delta.
    if (d < tgt) hi = mid;
    else lo = mid;
  }
  return Math.round(((lo + hi) / 2) * 2) / 2;
}

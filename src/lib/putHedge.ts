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

/**
 * VIX call sleeve — the convex layer alongside the TQQQ put program.
 *
 * ## What this can and cannot tell you
 *
 * VIX options settle on **VIX futures**, not on spot VIX, and this app has no
 * futures curve. What it has is ^VIX (30-day) and ^VIX3M (93-day) spot indices,
 * so {@link vixForward} interpolates between them to *approximate* the forward
 * an option of a given tenor would price against. That approximation is the
 * weak point: in steep contango the real future sits above this estimate, and
 * in backwardation below it, so modeled premiums here are indicative only.
 * Enter your actual fills to track spend — do not treat these as quotes.
 *
 * Pricing uses Black-76 (an option on a forward) with a vol-of-vol input. VIX
 * is mean-reverting and right-skewed, which Black-76 does not capture, so it
 * understates far-OTM calls. Again: indicative.
 *
 * ## Why the entry gate exists
 *
 * VIX calls are worth buying when vol is cheap and worth *monetizing* when it
 * is not. Buying a spike is the classic way to lose money on tail insurance —
 * you pay peak premium for protection against an event already underway, and
 * VIX mean-reverts within days. {@link planVixLayer} refuses to open new
 * positions above `maxEntryVix`, and flags monetizing above `monetizeVix`.
 *
 * Pure, no I/O.
 */

import { normCdf } from "./blackScholes";

/** Tenor of the ^VIX index, in days. */
const VIX_TENOR = 30;
/** Tenor of the ^VIX3M index, in days. */
const VIX3M_TENOR = 93;

/**
 * Approximate the VIX forward for a `dte`-day option by interpolating between
 * the 30-day and 93-day vol indices, flat outside that range.
 *
 * This stands in for the VIX futures curve the app does not have. It captures
 * the term structure's *direction* — contango lifts the forward above spot,
 * backwardation pulls it below — but not its true level.
 */
export function vixForward(vix: number, vix3m: number | null, dte: number): number {
  if (vix3m == null || !Number.isFinite(vix3m)) return vix;
  if (dte <= VIX_TENOR) return vix;
  if (dte >= VIX3M_TENOR) return vix3m;
  const w = (dte - VIX_TENOR) / (VIX3M_TENOR - VIX_TENOR);
  return vix + (vix3m - vix) * w;
}

/**
 * Black-76 call on a forward. `volOfVol` is the implied vol *of VIX itself*,
 * which runs far higher than equity vol — 80–120% is typical for OTM VIX calls.
 */
export function priceVixCall(
  forward: number,
  strike: number,
  dte: number,
  volOfVol: number,
  r = 0.04,
): { price: number; delta: number } {
  const t = Math.max(dte, 0) / 365;
  if (t <= 0 || volOfVol <= 0 || forward <= 0) {
    return { price: Math.max(forward - strike, 0), delta: forward > strike ? 1 : 0 };
  }
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(forward / strike) + 0.5 * volOfVol * volOfVol * t) / (volOfVol * sqrtT);
  const d2 = d1 - volOfVol * sqrtT;
  const df = Math.exp(-r * t);
  return { price: df * (forward * normCdf(d1) - strike * normCdf(d2)), delta: df * normCdf(d1) };
}

export type VixAction = "buy" | "sell" | "hold";

export interface VixLayerInput {
  accountValue: number;
  /** Whole-program annual spend as a percent of account, e.g. 3. */
  budgetPctPerYear: number;
  /** Share of that budget for this sleeve, 0–1. */
  budgetShare: number;
  dte: number;
  /** Spot ^VIX. */
  vix: number;
  /** Spot ^VIX3M, or null when unavailable. */
  vix3m: number | null;
  /** Strike as points above the forward, e.g. 10 buys the forward+10 call. */
  strikeOffset: number;
  /** Implied vol of VIX, as a decimal. */
  volOfVol: number;
  /** Refuse to open new positions when spot VIX is at or above this. */
  maxEntryVix: number;
  /** Flag taking profit when spot VIX is at or above this. */
  monetizeVix: number;
  currentContracts: number;
}

export interface VixLayerPlan {
  /** Interpolated forward this tenor prices against. */
  forward: number;
  strike: number;
  /** Modeled premium per contract (VIX options are $100 multiplier). */
  pricePerContract: number;
  delta: number;
  annualBudget: number;
  cycleBudget: number;
  /** Contracts the cycle budget affords. */
  budgetContracts: number;
  targetContracts: number;
  cycleCost: number;
  annualCostPct: number;
  /** True when spot VIX is too high to open new positions. */
  gated: boolean;
  /** True when spot VIX is high enough that taking profit is the move. */
  monetize: boolean;
  action: VixAction;
  actionContracts: number;
  /** Plain-language reason, for the UI. */
  note: string;
}

/**
 * Size the VIX sleeve for today, honoring the entry gate.
 *
 * The gate only blocks *buying*. Selling stays available at any vol level —
 * an elevated VIX is precisely when the sleeve should be harvested, not held.
 */
export function planVixLayer(input: VixLayerInput): VixLayerPlan | null {
  const {
    accountValue,
    budgetPctPerYear,
    budgetShare,
    dte,
    vix,
    vix3m,
    strikeOffset,
    volOfVol,
    maxEntryVix,
    monetizeVix,
    currentContracts,
  } = input;
  if (accountValue <= 0 || vix <= 0 || dte <= 0) return null;

  const forward = vixForward(vix, vix3m, dte);
  // VIX strikes list in whole points.
  const strike = Math.max(1, Math.round(forward + strikeOffset));
  const o = priceVixCall(forward, strike, dte, volOfVol);
  const pricePerContract = o.price * 100;

  const annualBudget = accountValue * (budgetPctPerYear / 100) * budgetShare;
  const cycleBudget = annualBudget * (dte / 365);
  const budgetContracts =
    pricePerContract > 0 ? Math.floor(cycleBudget / pricePerContract) : 0;

  const gated = vix >= maxEntryVix;
  const monetize = vix >= monetizeVix && currentContracts > 0;

  // Gated means hold what you have and buy nothing; monetize means sell.
  const targetContracts = monetize ? 0 : gated ? currentContracts : budgetContracts;
  const diff = targetContracts - currentContracts;

  let action: VixAction = "hold";
  if (monetize && currentContracts > 0) action = "sell";
  else if (!gated && diff > 0) action = "buy";
  else if (diff < 0) action = "sell";

  const note = monetize
    ? `VIX ${vix.toFixed(1)} is at or above the ${monetizeVix} monetize level — take the spike.`
    : gated
      ? `VIX ${vix.toFixed(1)} is at or above the ${maxEntryVix} entry cap — hold, don't add.`
      : `VIX ${vix.toFixed(1)} is below the ${maxEntryVix} entry cap — safe to add.`;

  const held = action === "sell" ? currentContracts + diff : targetContracts;
  const cycleCost = Math.max(0, held) * pricePerContract;

  return {
    forward,
    strike,
    pricePerContract,
    delta: o.delta,
    annualBudget,
    cycleBudget,
    budgetContracts,
    targetContracts,
    cycleCost,
    annualCostPct: accountValue > 0 ? ((cycleCost * (365 / dte)) / accountValue) * 100 : 0,
    gated,
    monetize,
    action,
    actionContracts: Math.abs(diff),
    note,
  };
}

/**
 * Payoff of the sleeve if VIX settles at `vixAtExpiry`, net of what it cost.
 *
 * VIX options cash-settle against the VRO opening print, which can differ
 * materially from the index level — another reason to read these as indicative.
 */
export function vixPayoff(plan: VixLayerPlan, contracts: number, vixAtExpiry: number): number {
  return Math.max(vixAtExpiry - plan.strike, 0) * 100 * contracts - plan.cycleCost;
}

/** A historical episode, used to ground the scenario table in real prints. */
export interface Episode {
  label: string;
  /** TQQQ move over the episode. */
  tqqqMove: number;
  /** Peak VIX printed during it. */
  vixPeak: number;
  /** Rough length in days. */
  days: number;
}

/**
 * Episodes measured from Yahoo daily history. These are what actually happened,
 * which beats inventing round-number scenarios — note that the deepest
 * drawdown (2022) produced the *weakest* VIX response.
 */
export const EPISODES: Episode[] = [
  { label: "Feb 2018 volmageddon", tqqqMove: -0.3, vixPeak: 37.3, days: 14 },
  { label: "Aug 2024 unwind", tqqqMove: -0.35, vixPeak: 38.6, days: 20 },
  { label: "Apr 2025", tqqqMove: -0.55, vixPeak: 52.3, days: 48 },
  { label: "Mar 2020 COVID", tqqqMove: -0.7, vixPeak: 82.7, days: 33 },
  { label: "2022 bear (slow)", tqqqMove: -0.79, vixPeak: 36.5, days: 283 },
];

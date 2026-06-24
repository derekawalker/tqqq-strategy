/**
 * Convexity-ladder put hedge for a TQQQ position, tuned for a buy-the-dip
 * strategy: don't pay up to insure ordinary 10–15% dips (you're busy buying
 * those) — spend on the long-bear and catastrophe tail instead.
 *
 *   - Crash       (−30% OTM on TQQQ) — liquid strikes, core long-bear cover.
 *   - Catastrophe (−50% OTM on TQQQ) — deep tail insurance; big payoff in a
 *                              2008/2020-style crash, still listed/tradeable.
 *   - Workhorse   (~20% OTM on TQQQ) — shallow cover for ordinary drawdowns.
 *                              Off by default (budgetShare 0); kept here so open
 *                              positions at that depth still classify/display.
 *
 * Sizing uses *two* constraints and takes the smaller:
 *   1. Budget — each active tranche gets a share of the annual premium budget
 *      (a % of TQQQ value) and buys what that affords.
 *   2. Notional cap — a ceiling on how much TQQQ notional a tranche may cover,
 *      so the cheap deep tranches don't balloon into hundreds of unfillable
 *      lottery-ticket contracts when handed a big budget slice.
 *
 * Premiums are modeled with the same Black-Scholes used by the backtester, off
 * the ^VXN implied-vol input, with a mild linear skew so the deep-OTM tranches
 * aren't priced too cheaply (real put skew makes tails richer than ATM IV) — or
 * replaced by live option-chain marks via an optional resolver.
 *
 * All functions here are pure — feed them current prices and a budget.
 */

import { bsPut } from "./putHedge";

export type TrancheKey = "workhorse" | "crash" | "catastrophe";

/** The put underlying used to hedge the TQQQ position. */
export type HedgeInstrument = "QQQ" | "TQQQ";

export interface TrancheDef {
  key: TrancheKey;
  label: string;
  desc: string;
  /** Strike / spot. 0.88 = a 12%-out-of-the-money put. */
  moneyness: number;
  /** Fraction of the annual premium budget allotted to this tranche. 0 = off. */
  budgetShare: number;
  /** Ceiling on TQQQ notional this tranche may cover, as a multiple of TQQQ
   *  value — caps cheap deep tranches so they don't balloon in contract count. */
  maxCoverage: number;
  /** Mantine color name for badges/rows. */
  color: string;
}

/**
 * Tranche sets per put instrument. The QQQ depths hedge QQQ −25% / −35% moves;
 * the TQQQ depths hedge the *same* scenarios, but because TQQQ falls ~2.3–3× as
 * fast, the equivalent strikes are far deeper (a QQQ −25% bear ≈ TQQQ −55–60%).
 * TQQQ puts hedge the held position directly, so coverage is ~1× notional, not 3×.
 */
export const TRANCHE_SETS: Record<HedgeInstrument, TrancheDef[]> = {
  QQQ: [
    {
      key: "crash",
      label: "Crash",
      desc: "Core long-bear / fast-crash cover (≈ QQQ −25%).",
      moneyness: 0.75,
      budgetShare: 0.6,
      maxCoverage: 3,
      color: "orange",
    },
    {
      key: "catastrophe",
      label: "Catastrophe",
      desc: "Deep tail insurance (≈ QQQ −35%) — cheap, max convexity in a 2008/2020 event.",
      moneyness: 0.65,
      budgetShare: 0.4,
      maxCoverage: 1.5,
      color: "red",
    },
    {
      key: "workhorse",
      label: "Workhorse",
      desc: "Near-the-money cover for ordinary dips. Off by default — you buy those dips.",
      moneyness: 0.88,
      budgetShare: 0,
      maxCoverage: 2,
      color: "teal",
    },
  ],
  TQQQ: [
    {
      key: "crash",
      label: "Crash",
      desc: "Core long-bear cover — TQQQ −30% OTM. Liquid strikes, activates in a serious correction.",
      moneyness: 0.70,
      budgetShare: 0.6,
      maxCoverage: 1.5,
      color: "orange",
    },
    {
      key: "catastrophe",
      label: "Catastrophe",
      desc: "Deep tail insurance — TQQQ −50% OTM. High convexity in a 2008/2020-style crash.",
      moneyness: 0.50,
      budgetShare: 0.4,
      maxCoverage: 1.0,
      color: "red",
    },
    {
      key: "workhorse",
      label: "Workhorse",
      desc: "Shallow TQQQ cover for ordinary dips. Off by default — you buy those dips.",
      moneyness: 0.82,
      budgetShare: 0,
      maxCoverage: 1.5,
      color: "teal",
    },
  ],
};

/** Default (QQQ) tranche set — kept for callers that don't pick an instrument. */
export const TRANCHES: TrancheDef[] = TRANCHE_SETS.QQQ;

/** IV multiplier vs ^VXN: TQQQ options run ~3× the index implied vol. */
const IV_SCALE: Record<HedgeInstrument, number> = { QQQ: 1, TQQQ: 3 };
/** Dividend yield of the put underlying. */
const DIV_YIELD: Record<HedgeInstrument, number> = { QQQ: 0.006, TQQQ: 0 };

/** Default days to expiry to buy at (QQQ). */
export const HEDGE_DTE = 60;
/**
 * Suggested DTE per instrument. Deep-OTM TQQQ puts have no market at 60 days —
 * the bids/asks only show up ~90 days out — so TQQQ buys longer-dated.
 */
export const HEDGE_DTE_BY_INSTRUMENT: Record<HedgeInstrument, number> = { QQQ: 60, TQQQ: 90 };
/** Roll/replace a clip once it decays to this many days left. */
export const ROLL_AT_DTE = 21;
/** Dollar-cost-average each tranche's target over this many weekly clips. */
export const WEEKS_PER_CYCLE = 5;

const RISK_FREE = 0.04;
/** Linear vol skew: deeper-OTM puts carry richer IV than the ATM ^VXN level. */
const SKEW = 0.8;
/** Fallback IV (as a fraction) when ^VXN is unavailable. */
const DEFAULT_IV = 0.22;

/** Skew-adjusted implied vol for a given moneyness. */
function ivFor(baseIv: number, moneyness: number): number {
  return baseIv * (1 + SKEW * Math.max(0, 1 - moneyness));
}

/**
 * Classify an open put into a tranche by its moneyness (strike / current spot),
 * for the given instrument. Returns null for near-the-money puts that aren't part
 * of the laddered hedge. Boundaries sit halfway between adjacent tranche strikes.
 */
export function classifyTranche(
  moneyness: number,
  instrument: HedgeInstrument = "QQQ",
): TrancheKey | null {
  const defs = [...TRANCHE_SETS[instrument]].sort((a, b) => b.moneyness - a.moneyness);
  if (defs.length === 0 || moneyness > defs[0].moneyness + 0.07) return null;
  for (let i = 0; i < defs.length; i++) {
    const lower = i + 1 < defs.length ? (defs[i].moneyness + defs[i + 1].moneyness) / 2 : -Infinity;
    if (moneyness >= lower) return defs[i].key;
  }
  return defs[defs.length - 1].key;
}

/** A live quote for a strike, supplied by an option-chain resolver. */
export interface TrancheQuote {
  /** Actual listed strike (may differ from the ideal model strike). */
  strike: number;
  /** Mark price per share, in dollars. */
  mark: number;
  /** Annualized IV as a decimal, if known. */
  iv?: number | null;
}

/** Resolves a tranche's ideal strike to a real listed contract, or null. */
export type ChainResolver = (idealStrike: number) => TrancheQuote | null;

export interface TranchePlan {
  def: TrancheDef;
  /** Recommended strike — the real listed strike when priced off a live chain. */
  strike: number;
  /** Full standing-stack target, in contracts. */
  targetContracts: number;
  /** Contracts to buy in a single weekly clip while building toward target. */
  weeklyContracts: number;
  /** Premium to open one contract today, in dollars (live mark or modeled). */
  estPremiumPerContract: number;
  /** Estimated annual carry for the full target, in dollars. */
  estAnnualPremium: number;
  /** Dollars of the annual budget allotted to this tranche. */
  annualBudget: number;
  /** True when the premium came from a live option-chain mark, not the model. */
  live: boolean;
}

/**
 * Build the per-tranche buy plan for one account's TQQQ exposure.
 *
 * @param tqqqValue       current TQQQ market value to hedge
 * @param spot            current spot of the put underlying (QQQ or TQQQ price)
 * @param vxnPct          ^VXN level (e.g. 22 for 22%); null → DEFAULT_IV
 * @param annualBudgetPct annual premium budget as a fraction of tqqqValue
 *                        (0.02 = 2%/yr)
 * @param instrument      put underlying (default "QQQ"); "TQQQ" uses deeper
 *                        strikes and ~3× IV
 */
export function buildTranchePlan(opts: {
  tqqqValue: number;
  spot: number;
  vxnPct: number | null;
  annualBudgetPct: number;
  instrument?: HedgeInstrument;
  /** Optional live option-chain resolver; when it returns a quote, real marks
   *  and the real listed strike replace the Black-Scholes estimate. */
  resolver?: ChainResolver;
}): TranchePlan[] {
  const { tqqqValue, spot, vxnPct, annualBudgetPct, resolver } = opts;
  const instrument = opts.instrument ?? "QQQ";
  const dte = HEDGE_DTE_BY_INSTRUMENT[instrument];
  const baseIv = (vxnPct != null && vxnPct > 0 ? vxnPct / 100 : DEFAULT_IV) * IV_SCALE[instrument];
  const div = DIV_YIELD[instrument];
  const totalBudget = Math.max(0, tqqqValue) * Math.max(0, annualBudgetPct);
  const rollsPerYear = 365 / dte;

  return TRANCHE_SETS[instrument].filter((def) => def.budgetShare > 0).map((def) => {
    const idealStrike = Math.max(1, Math.round(spot * def.moneyness));

    // Prefer a live mark; fall back to the skew-adjusted Black-Scholes model.
    const quote = resolver?.(idealStrike) ?? null;
    const live = quote != null && quote.mark > 0;
    let strike: number;
    let estPremiumPerContract: number;
    if (live) {
      strike = quote!.strike;
      estPremiumPerContract = quote!.mark * 100;
    } else {
      strike = idealStrike;
      const iv = ivFor(baseIv, def.moneyness);
      estPremiumPerContract = bsPut(spot, strike, dte / 365, iv, RISK_FREE, div) * 100;
    }

    const annualPerContract = estPremiumPerContract * rollsPerYear;
    const annualBudget = totalBudget * def.budgetShare;

    // Two ceilings: what the budget affords, and a sane notional cap.
    const budgetTarget =
      annualPerContract > 0 ? Math.floor(annualBudget / annualPerContract) : 0;
    const notionalPerContract = strike * 100;
    const coverTarget =
      notionalPerContract > 0
        ? Math.floor((def.maxCoverage * Math.max(0, tqqqValue)) / notionalPerContract)
        : 0;
    const targetContracts = Math.max(0, Math.min(budgetTarget, coverTarget));
    const weeklyContracts =
      targetContracts > 0 ? Math.max(1, Math.ceil(targetContracts / WEEKS_PER_CYCLE)) : 0;

    return {
      def,
      strike,
      targetContracts,
      weeklyContracts,
      estPremiumPerContract,
      estAnnualPremium: targetContracts * annualPerContract,
      annualBudget,
      live,
    };
  });
}

/** Total estimated annual premium across all tranches in a plan, in dollars. */
export function planAnnualCost(plan: TranchePlan[]): number {
  return plan.reduce((s, t) => s + t.estAnnualPremium, 0);
}

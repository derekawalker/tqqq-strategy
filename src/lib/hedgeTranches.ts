/**
 * Convexity-ladder put hedge for a TQQQ position, tuned for a buy-the-dip
 * strategy: don't pay up to insure ordinary 10–15% dips (you're busy buying
 * those) — spend on the long-bear and catastrophe tail instead.
 *
 * Strategy (QQQ instrument, recommended):
 *   - Crash       (~0.15Δ, 180-day puts) — core long-bear cover.
 *   - Catastrophe (~0.07Δ, 365-day LEAPS) — deep tail insurance, max convexity.
 *   - Workhorse   (~0.30Δ) — off by default; you buy ordinary dips.
 *
 * Strikes are solved to hit each tranche's target delta off live spot + ^VXN,
 * so depth adapts with vol. Each leg targets a standing ladder of N contracts
 * (whatever the budget affords); you buy them one (clip) at a time, spaced
 * evenly across the holding period so entries/expiries stagger, and roll at
 * ROLL_AT_DTE. On a small budget N may be just 1–3 contracts, so the cadence
 * stretches automatically rather than forcing a fractional monthly buy.
 *
 * A QQQ −25% move ≈ TQQQ −55–60%; QQQ −35% ≈ TQQQ −75%+.
 * Using QQQ puts instead of TQQQ puts: far more liquid, tighter spreads,
 * tradeable at any DTE. TQQQ puts remain available as an alternate instrument.
 *
 * Sizing uses two constraints and takes the smaller:
 *   1. Budget  — each active tranche gets a share of the annual premium budget
 *      (a % of TQQQ value) and buys what that affords at its target DTE.
 *   2. Notional cap — a ceiling on how much TQQQ notional a tranche may cover.
 *
 * Premiums are modeled with Black-Scholes off the ^VXN implied-vol input, with
 * a mild linear skew so deep-OTM tranches aren't priced too cheaply — or
 * replaced by live option-chain marks via an optional resolver.
 *
 * All functions here are pure — feed them current prices and a budget.
 */

import { bsPut, strikeForDelta } from "./putHedge";

export type TrancheKey = "workhorse" | "crash" | "catastrophe";

/** The put underlying used to hedge the TQQQ position. */
export type HedgeInstrument = "QQQ" | "TQQQ";

export interface TrancheDef {
  key: TrancheKey;
  label: string;
  desc: string;
  /**
   * Target put delta (absolute). The buy strike is solved to hit this off live
   * spot + VXN, so depth adapts with vol (in a spike the strike pushes deeper
   * OTM for the same delta). 0.20 = the −0.20-delta put.
   */
  targetDelta: number;
  /**
   * Nominal strike/spot, used only as a classification anchor for bucketing
   * open puts into tranches and as a fallback when spot/IV aren't available.
   * 0.75 ≈ a 25%-OTM put on QQQ at normal vol.
   */
  moneyness: number;
  /** Fraction of the annual premium budget allotted to this tranche. 0 = off. */
  budgetShare: number;
  /** Ceiling on TQQQ notional this tranche may cover, as a multiple of TQQQ value. */
  maxCoverage: number;
  /** Mantine color name for badges/rows. */
  color: string;
  /** Days to expiry to target when buying this tranche. */
  dte: number;
}

/**
 * Tranche sets per put instrument.
 *
 * QQQ (recommended): 6-month crash puts + 1-year catastrophe LEAPS.
 * TQQQ: legacy instrument with 90-day puts at equivalent depths.
 */
export const TRANCHE_SETS: Record<HedgeInstrument, TrancheDef[]> = {
  QQQ: [
    {
      key: "crash",
      label: "Crash",
      desc: "Core long-bear cover (~0.15Δ) — 6-month puts, staggered into a ladder.",
      targetDelta: 0.15,
      moneyness: 0.78,
      budgetShare: 0.6,
      maxCoverage: 3,
      color: "orange",
      dte: 180,
    },
    {
      key: "catastrophe",
      label: "Catastrophe",
      desc: "Deep tail insurance (~0.07Δ) — 1-year LEAPS, staggered into a ladder.",
      targetDelta: 0.07,
      moneyness: 0.68,
      budgetShare: 0.4,
      maxCoverage: 1.5,
      color: "red",
      dte: 365,
    },
    {
      key: "workhorse",
      label: "Workhorse",
      desc: "Near-the-money cover for ordinary dips. Off by default — you buy those dips.",
      targetDelta: 0.30,
      moneyness: 0.88,
      budgetShare: 0,
      maxCoverage: 2,
      color: "teal",
      dte: 60,
    },
  ],
  TQQQ: [
    {
      key: "crash",
      label: "Crash",
      desc: "Core long-bear cover (~0.20Δ on TQQQ). Liquid strikes, activates in a serious correction.",
      targetDelta: 0.20,
      moneyness: 0.70,
      budgetShare: 0.6,
      maxCoverage: 1.5,
      color: "orange",
      dte: 90,
    },
    {
      key: "catastrophe",
      label: "Catastrophe",
      desc: "Deep tail insurance (~0.10Δ on TQQQ). High convexity in a 2008/2020-style crash.",
      targetDelta: 0.10,
      moneyness: 0.50,
      budgetShare: 0.4,
      maxCoverage: 1.0,
      color: "red",
      dte: 90,
    },
    {
      key: "workhorse",
      label: "Workhorse",
      desc: "Shallow TQQQ cover for ordinary dips. Off by default — you buy those dips.",
      targetDelta: 0.30,
      moneyness: 0.82,
      budgetShare: 0,
      maxCoverage: 1.5,
      color: "teal",
      dte: 60,
    },
  ],
};

/** Default (QQQ) tranche set — kept for callers that don't pick an instrument. */
export const TRANCHES: TrancheDef[] = TRANCHE_SETS.QQQ;

/** IV multiplier vs ^VXN: TQQQ options run ~3× the index implied vol. */
export const IV_SCALE: Record<HedgeInstrument, number> = { QQQ: 1, TQQQ: 3 };
/** Dividend yield of the put underlying. */
export const DIV_YIELD: Record<HedgeInstrument, number> = { QQQ: 0.006, TQQQ: 0 };

/** Fallback DTE per instrument when a tranche doesn't specify one. */
export const HEDGE_DTE_BY_INSTRUMENT: Record<HedgeInstrument, number> = { QQQ: 180, TQQQ: 90 };
/** Roll/replace a clip once it decays to this many days left. */
export const ROLL_AT_DTE = 21;
/**
 * Pause buying the *crash* leg only when ^VXN is above this — and only on a
 * genuine panic spike, not ordinary bear-market vol. Backtests showed a 25
 * threshold left you nearly unhedged through the 2022 slow grind (VXN lived in
 * the 25–40 band the whole way down); 50 blocks only true spikes. The cheap
 * catastrophe leg is exempt entirely — it's a lottery ticket you always keep on.
 */
export const VIX_PAUSE_THRESHOLD = 50;
/** Close half a position when it has gained this fraction of its cost basis. */
export const PROFIT_TAKE_PCT = 1.5;
/** Monetize a put once its |delta| reaches this — the crash harvest trigger. */
export const MONETIZE_DELTA = 0.45;
/** Linear vol skew used for live greeks/pricing (matches the model SKEW). */
export const LIVE_SKEW = 0.8;

const RISK_FREE = 0.04;
/** Linear vol skew: deeper-OTM puts carry richer IV than the ATM ^VXN level. */
const SKEW = 0.8;
/** Fallback IV (as a fraction) when ^VXN is unavailable. */
const DEFAULT_IV = 0.22;

/**
 * Skew-adjusted implied vol for a given moneyness (strike / spot). Deeper-OTM
 * puts (moneyness < 1) carry richer IV than the ATM level; OTM calls
 * (moneyness > 1) are left at the base IV — this models the equity/index put
 * skew, not a symmetric smile, which matches how TQQQ/QQQ options actually
 * trade. Exported so option-selling yield estimates (Options page) share the
 * same skew model as the hedge pricer instead of drifting out of sync.
 */
export function ivFor(baseIv: number, moneyness: number): number {
  return baseIv * (1 + SKEW * Math.max(0, 1 - moneyness));
}

/**
 * Strike that hits a target put delta off live spot + IV. Because the skew makes
 * IV depend on the strike, solve as a short fixed point: an ATM-IV first pass,
 * then refine the IV at that strike's moneyness and re-solve. Returns a $0.50-grid
 * strike (the resolver snaps it to a real listed contract).
 */
export function deltaStrike(
  spot: number,
  targetDelta: number,
  dte: number,
  baseIv: number,
  div: number,
): number {
  const T = Math.max(dte, 1) / 365;
  let strike = strikeForDelta(spot, T, baseIv, targetDelta, RISK_FREE, div);
  for (let i = 0; i < 2; i++) {
    const iv = ivFor(baseIv, strike / spot);
    strike = strikeForDelta(spot, T, iv, targetDelta, RISK_FREE, div);
  }
  return Math.max(1, strike);
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
  /** Effective DTE used for this tranche. */
  dte: number;
  /** Full standing-ladder target, in whole contracts (what the budget affords). */
  targetContracts: number;
  /** Whole contracts to buy in a single clip (≥1 while the ladder is short of target). */
  clipContracts: number;
  /** Days to space buys apart so the ladder's expiries stagger across the hold. */
  spacingDays: number;
  /** Premium to open one contract today, in dollars (live mark or modeled). */
  estPremiumPerContract: number;
  /** Estimated annual carry for the full target, in dollars. */
  estAnnualPremium: number;
  /** Dollars of the annual budget allotted to this tranche. */
  annualBudget: number;
  /** Out-of-pocket cost of one clip, in dollars (clipContracts × premium). */
  perBuyCost: number;
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
 *                        (0.03 = 3%/yr)
 * @param instrument      put underlying (default "QQQ")
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
  const baseIv = (vxnPct != null && vxnPct > 0 ? vxnPct / 100 : DEFAULT_IV) * IV_SCALE[instrument];
  const div = DIV_YIELD[instrument];
  const totalBudget = Math.max(0, tqqqValue) * Math.max(0, annualBudgetPct);

  return TRANCHE_SETS[instrument].filter((def) => def.budgetShare > 0).map((def) => {
    const dte = def.dte;
    const rollsPerYear = 365 / dte;
    // Strike is solved to hit the tranche's target delta off live spot + IV.
    const idealStrike = deltaStrike(spot, def.targetDelta, dte, baseIv, div);

    const quote = resolver?.(idealStrike) ?? null;
    const live = quote != null && quote.mark > 0;
    let strike: number;
    let estPremiumPerContract: number;
    if (live) {
      strike = quote!.strike;
      estPremiumPerContract = quote!.mark * 100;
    } else {
      strike = idealStrike;
      const iv = ivFor(baseIv, strike / spot);
      estPremiumPerContract = bsPut(spot, strike, dte / 365, iv, RISK_FREE, div) * 100;
    }

    const annualPerContract = estPremiumPerContract * rollsPerYear;
    const annualBudget = totalBudget * def.budgetShare;

    const budgetTarget =
      annualPerContract > 0 ? Math.floor(annualBudget / annualPerContract) : 0;
    const notionalPerContract = strike * 100;
    const coverTarget =
      notionalPerContract > 0
        ? Math.floor((def.maxCoverage * Math.max(0, tqqqValue)) / notionalPerContract)
        : 0;
    const targetContracts = Math.max(0, Math.min(budgetTarget, coverTarget));

    // Adaptive staggering: buy whole contracts, never finer than weekly. The
    // standing ladder of `targetContracts` is built one clip at a time; if it's
    // big enough to want >52 buys/yr, each clip holds more than one contract.
    const annualContractBuys = targetContracts * rollsPerYear;
    const clipContracts =
      targetContracts > 0 ? Math.max(1, Math.ceil(annualContractBuys / 52)) : 0;
    // Number of buys to build the ladder, spread evenly across the hold so the
    // expiries stagger; tiny ladders (1 contract) just hold-and-roll.
    const buysToBuild = clipContracts > 0 ? Math.ceil(targetContracts / clipContracts) : 0;
    const spacingDays = buysToBuild > 0 ? Math.round(dte / buysToBuild) : 0;
    const perBuyCost = clipContracts * estPremiumPerContract;

    return {
      def,
      strike,
      dte,
      targetContracts,
      clipContracts,
      spacingDays,
      estPremiumPerContract,
      estAnnualPremium: targetContracts * annualPerContract,
      annualBudget,
      perBuyCost,
      live,
    };
  });
}

/** Total estimated annual premium across all tranches in a plan, in dollars. */
export function planAnnualCost(plan: TranchePlan[]): number {
  return plan.reduce((s, t) => s + t.estAnnualPremium, 0);
}

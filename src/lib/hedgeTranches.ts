/**
 * Convexity-ladder put hedge for a TQQQ position, tuned for a buy-the-dip
 * strategy: don't pay up to insure ordinary 10–15% dips (you're busy buying
 * those) — spend on the long-bear and catastrophe tail instead.
 *
 * Strategy (QQQ instrument, recommended):
 *   - Crash       (−25% OTM on QQQ, 180-day puts, Jan + Jul)
 *                 Core long-bear cover. Rolls twice a year; liquid strikes.
 *   - Catastrophe (−35% OTM on QQQ, 365-day LEAPS, Jan only)
 *                 Deep tail insurance. Annual buy; maximum theta efficiency.
 *   - Workhorse   (~12% OTM) — off by default; you buy ordinary dips.
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

import { bsPut } from "./putHedge";

export type TrancheKey = "workhorse" | "crash" | "catastrophe";

/** The put underlying used to hedge the TQQQ position. */
export type HedgeInstrument = "QQQ" | "TQQQ";

export interface TrancheDef {
  key: TrancheKey;
  label: string;
  desc: string;
  /** Strike / spot. 0.75 = a 25%-out-of-the-money put on QQQ. */
  moneyness: number;
  /** Fraction of the annual premium budget allotted to this tranche. 0 = off. */
  budgetShare: number;
  /** Ceiling on TQQQ notional this tranche may cover, as a multiple of TQQQ value. */
  maxCoverage: number;
  /** Mantine color name for badges/rows. */
  color: string;
  /** Days to expiry to target when buying this tranche. */
  dte: number;
  /** Calendar months (0-indexed) in which DCA clips for this tranche are bought. */
  buyMonths: readonly number[];
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
      desc: "Core long-bear cover (≈ QQQ −25%) — 6-month puts, rolled twice a year.",
      moneyness: 0.75,
      budgetShare: 0.6,
      maxCoverage: 3,
      color: "orange",
      dte: 180,
      buyMonths: [0, 6] as const, // Jan + Jul
    },
    {
      key: "catastrophe",
      label: "Catastrophe",
      desc: "Deep tail insurance (≈ QQQ −35%) — annual LEAPS, maximum theta efficiency.",
      moneyness: 0.65,
      budgetShare: 0.4,
      maxCoverage: 1.5,
      color: "red",
      dte: 365,
      buyMonths: [0] as const, // Jan only
    },
    {
      key: "workhorse",
      label: "Workhorse",
      desc: "Near-the-money cover for ordinary dips. Off by default — you buy those dips.",
      moneyness: 0.88,
      budgetShare: 0,
      maxCoverage: 2,
      color: "teal",
      dte: 60,
      buyMonths: [] as const,
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
      dte: 90,
      buyMonths: [0, 6] as const,
    },
    {
      key: "catastrophe",
      label: "Catastrophe",
      desc: "Deep tail insurance — TQQQ −50% OTM. High convexity in a 2008/2020-style crash.",
      moneyness: 0.50,
      budgetShare: 0.4,
      maxCoverage: 1.0,
      color: "red",
      dte: 90,
      buyMonths: [0] as const,
    },
    {
      key: "workhorse",
      label: "Workhorse",
      desc: "Shallow TQQQ cover for ordinary dips. Off by default — you buy those dips.",
      moneyness: 0.82,
      budgetShare: 0,
      maxCoverage: 1.5,
      color: "teal",
      dte: 60,
      buyMonths: [] as const,
    },
  ],
};

/** Default (QQQ) tranche set — kept for callers that don't pick an instrument. */
export const TRANCHES: TrancheDef[] = TRANCHE_SETS.QQQ;

/** IV multiplier vs ^VXN: TQQQ options run ~3× the index implied vol. */
const IV_SCALE: Record<HedgeInstrument, number> = { QQQ: 1, TQQQ: 3 };
/** Dividend yield of the put underlying. */
const DIV_YIELD: Record<HedgeInstrument, number> = { QQQ: 0.006, TQQQ: 0 };

/** Fallback DTE per instrument when a tranche doesn't specify one. */
export const HEDGE_DTE_BY_INSTRUMENT: Record<HedgeInstrument, number> = { QQQ: 180, TQQQ: 90 };
/** Roll/replace a clip once it decays to this many days left. */
export const ROLL_AT_DTE = 21;
/** Dollar-cost-average each tranche's window target over this many weekly clips. */
export const WEEKS_PER_CYCLE = 3;
/** Number of DCA clips per buy window (= WEEKS_PER_CYCLE). */
export const DCA_WEEKS = 3;
/** Calendar days in a DCA window (first ~3 weeks of the buy month). */
export const DCA_WINDOW_DAYS = 21;
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

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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

/** Status of the buy window for a tranche relative to a given date. */
export interface BuyWindowStatus {
  /** True when today falls within the DCA window (first DCA_WINDOW_DAYS of a buy month). */
  inWindow: boolean;
  /** Which clip (1–DCA_WEEKS) if in window; null otherwise. */
  clip: number | null;
  /** Start date of the next buy window (the one after the current one if in window). */
  nextWindowDate: Date;
  /** Calendar days until nextWindowDate; 0 when currently in a window. */
  daysUntilNext: number;
  /** Short month label of the next (or current) window, e.g. "Jul". */
  periodLabel: string;
}

/** Find the first buy month strictly after the given month (wraps to next year). */
function findNextWindow(
  buyMonths: readonly number[],
  afterMonth: number,
  afterYear: number,
): { date: Date; label: string } {
  for (let i = 1; i <= 12; i++) {
    const m = (afterMonth + i) % 12;
    const y = afterYear + Math.floor((afterMonth + i) / 12);
    if (buyMonths.includes(m)) return { date: new Date(y, m, 1), label: MONTH_NAMES[m] };
  }
  return { date: new Date(afterYear + 1, buyMonths[0], 1), label: MONTH_NAMES[buyMonths[0]] };
}

/**
 * Returns the buy-window status for a tranche on the given date.
 * "In window" = first DCA_WINDOW_DAYS calendar days of a buy month.
 */
export function buyWindowStatus(def: TrancheDef, today: Date = new Date()): BuyWindowStatus {
  const m = today.getMonth();
  const d = today.getDate();
  const y = today.getFullYear();
  const months = def.buyMonths;

  if (!months || months.length === 0) {
    return { inWindow: false, clip: null, nextWindowDate: new Date(9999, 0, 1), daysUntilNext: 999999, periodLabel: '' };
  }

  if (months.includes(m) && d >= 1 && d <= DCA_WINDOW_DAYS) {
    const clip = Math.min(DCA_WEEKS, Math.ceil(d / 7));
    const next = findNextWindow(months, m, y);
    return { inWindow: true, clip, nextWindowDate: next.date, daysUntilNext: 0, periodLabel: MONTH_NAMES[m] };
  }

  // Past the window this month, or a non-buy month — find upcoming window.
  const next = findNextWindow(months, m, y);
  const msUntil = next.date.getTime() - today.getTime();
  return {
    inWindow: false,
    clip: null,
    nextWindowDate: next.date,
    daysUntilNext: Math.max(0, Math.ceil(msUntil / 86_400_000)),
    periodLabel: next.label,
  };
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
  /** Dollars to spend in a single DCA clip (annualBudget / totalClipsPerYear). */
  perClipBudget: number;
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
    const idealStrike = Math.max(1, Math.round(spot * def.moneyness));

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

    const totalClipsPerYear = def.buyMonths.length * DCA_WEEKS;
    const perClipBudget = totalClipsPerYear > 0 ? annualBudget / totalClipsPerYear : 0;

    return {
      def,
      strike,
      dte,
      targetContracts,
      weeklyContracts,
      estPremiumPerContract,
      estAnnualPremium: targetContracts * annualPerContract,
      annualBudget,
      perClipBudget,
      live,
    };
  });
}

/** Total estimated annual premium across all tranches in a plan, in dollars. */
export function planAnnualCost(plan: TranchePlan[]): number {
  return plan.reduce((s, t) => s + t.estAnnualPremium, 0);
}

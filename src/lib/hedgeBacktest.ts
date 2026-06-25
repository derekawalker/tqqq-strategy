/**
 * Backtest the put-hedge overlay against history, to answer the only question
 * that matters before real money rides on it: *what would this hedge have done
 * in 2018 Q4 / Feb–Mar 2020 / all of 2022 — how much drawdown did it spare, and
 * what did that protection cost in premium?*
 *
 * Model
 * -----
 *  - The thing hedged is a static buy-and-hold TQQQ notional (isolates the
 *    overlay's effect from the dip-buy ladder, which is simulated elsewhere).
 *  - Protection is QQQ puts. QQQ is the liquid instrument; a QQQ −25% move ≈
 *    TQQQ −55–60%. Puts are priced with Black-Scholes off ^VXN — the Nasdaq-100
 *    implied-vol index, i.e. QQQ's *own* ATM vol — with a linear skew so OTM
 *    strikes are richer. VXN spiking in a selloff is what makes the puts pay
 *    (vega), so feeding real VXN history is essential, not cosmetic.
 *  - Buys dollar-cost-average toward a per-tranche target stack on a fixed
 *    cadence, gated by an annual premium budget and a VXN ceiling. Lots roll at
 *    a DTE floor and monetize when their delta crosses a trigger (the crash
 *    harvest) — proceeds are booked as recovered premium / dry powder.
 *
 * Accounting (per day, all pure):
 *    hedgeCash  −= premium on every buy, += proceeds on every sell
 *    openMark    = Σ current model value of open puts
 *    equityWith  = tqqqValue + hedgeCash + openMark
 *    equityNaked = tqqqValue
 * The gap between the two curves, and their respective max drawdowns, is the
 * hedge's verdict. Net cost = −(hedgeCash + openMark) at the end.
 *
 * Pure: feed it aligned QQQ/TQQQ bars + a VXN lookup and a config.
 */

import { bsPutGreeks } from "./putHedge";
import { TRANCHE_SETS, type HedgeInstrument, type TrancheKey } from "./hedgeTranches";

export interface HedgeBar {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface HedgeBacktestConfig {
  /** Put underlying. Default "QQQ". */
  instrument?: HedgeInstrument;
  /** Starting TQQQ position value to hedge. */
  tqqqStartValue: number;
  /** Annual premium budget as a fraction of current TQQQ value (0.03 = 3%/yr). */
  annualBudgetPct: number;
  /** Roll a lot once it decays to this many days left. */
  rollAtDte: number;
  /** Monetize a lot when its |delta| reaches this (the crash harvest). */
  monetizeDelta: number;
  /** Also monetize when a lot's gain reaches this fraction of cost (e.g. 1.5). */
  monetizeGainPct: number;
  /** Skip new buys when VXN (in %) is above this — vol too rich. */
  vxnPauseThreshold: number;
  /** Trading days between DCA clips. Default 5 (~weekly). */
  buyEveryDays?: number;
  /** Clips to spread a tranche's target over while building. Default 3. */
  dcaClips?: number;
  /** Annualized risk-free rate. Default 0.04. */
  riskFree?: number;
  /** Linear vol skew: deep-OTM puts carry richer IV than ATM VXN. Default 0.8. */
  skew?: number;
  /** Fallback IV (fraction) when VXN is missing for a day. Default 0.22. */
  defaultIv?: number;
}

export interface HedgeBacktestPoint {
  date: string;
  /** Equity of the hedged book (TQQQ + put overlay, net of premium). */
  withHedge: number;
  /** Equity of the naked TQQQ position. */
  naked: number;
  /** Mark value of all open puts that day. */
  putValue: number;
  /** Cumulative premium paid minus proceeds recovered (the running carry). */
  netHedgeCash: number;
}

export interface HedgeBacktestStats {
  /** Max drawdown of the naked TQQQ book (negative). */
  maxDrawdownNaked: number;
  /** Max drawdown of the hedged book (negative). */
  maxDrawdownHedged: number;
  /** Drawdown spared = naked − hedged (positive = hedge helped), in fraction. */
  drawdownReduced: number;
  totalPremiumPaid: number;
  totalProceeds: number;
  /** Net hedge cost over the run = premium − proceeds − residual value (positive = cost). */
  netHedgeCost: number;
  /** Net cost as a fraction of the starting TQQQ value. */
  netHedgeCostPct: number;
  /** Largest single-day mark value the puts reached (peak protection). */
  peakPutValue: number;
  /** Final equity of the hedged book. */
  finalHedged: number;
  /** Final equity of the naked book. */
  finalNaked: number;
  buys: number;
  sells: number;
}

export interface HedgeBacktestResult {
  curve: HedgeBacktestPoint[];
  stats: HedgeBacktestStats;
}

interface OpenLot {
  tranche: TrancheKey;
  strike: number;
  contracts: number;
  /** Days-to-expiry as a calendar count from entry. */
  expiryDate: string;
  entryDte: number;
  costPerShare: number; // premium paid per share (×100 = per contract)
  moneyness: number; // strike/spot at entry
}

const IV_SCALE: Record<HedgeInstrument, number> = { QQQ: 1, TQQQ: 3 };
const DIV_YIELD: Record<HedgeInstrument, number> = { QQQ: 0.006, TQQQ: 0 };

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Run the overlay over aligned QQQ + TQQQ daily bars (same dates, ascending),
 * with a date→VXN(%) lookup. Returns the two equity curves and the verdict.
 */
export function runHedgeBacktest(
  qqq: HedgeBar[],
  tqqq: HedgeBar[],
  vxnByDate: Map<string, number>,
  cfg: HedgeBacktestConfig,
): HedgeBacktestResult {
  const instrument = cfg.instrument ?? "QQQ";
  const tranches = TRANCHE_SETS[instrument].filter((t) => t.budgetShare > 0);
  const buyEveryDays = cfg.buyEveryDays ?? 5;
  const dcaClips = cfg.dcaClips ?? 3;
  const r = cfg.riskFree ?? 0.04;
  const skew = cfg.skew ?? 0.8;
  const defaultIv = cfg.defaultIv ?? 0.22;
  const ivScale = IV_SCALE[instrument];
  const div = DIV_YIELD[instrument];

  // Align TQQQ to QQQ dates.
  const tqqqByDate = new Map(tqqq.map((b) => [b.date, b.close]));

  const n = qqq.length;
  if (n === 0) {
    return {
      curve: [],
      stats: {
        maxDrawdownNaked: 0, maxDrawdownHedged: 0, drawdownReduced: 0,
        totalPremiumPaid: 0, totalProceeds: 0, netHedgeCost: 0, netHedgeCostPct: 0,
        peakPutValue: 0, finalHedged: 0, finalNaked: 0, buys: 0, sells: 0,
      },
    };
  }

  const tqqqShares = cfg.tqqqStartValue / (tqqqByDate.get(qqq[0].date) ?? qqq[0].close);

  const ivFor = (baseIv: number, moneyness: number) =>
    baseIv * (1 + skew * Math.max(0, 1 - moneyness));

  // Price a put + greeks at a given spot, strike, days-to-expiry, and VXN level.
  const priceAt = (spot: number, strike: number, dte: number, vxnPct: number | undefined) => {
    const baseIv = (vxnPct != null && vxnPct > 0 ? vxnPct / 100 : defaultIv) * ivScale;
    const iv = ivFor(baseIv, strike / spot);
    return bsPutGreeks(spot, strike, Math.max(dte, 0) / 365, iv, r, div);
  };

  let open: OpenLot[] = [];
  let hedgeCash = 0;
  let premiumPaid = 0;
  let proceeds = 0;
  let buys = 0;
  let sells = 0;
  let peakPutValue = 0;

  // Annual budget governor — reset on calendar-year rollover.
  let curYear = qqq[0].date.slice(0, 4);
  let premiumThisYear = 0;

  const curve: HedgeBacktestPoint[] = [];

  for (let i = 0; i < n; i++) {
    const date = qqq[i].date;
    const spot = qqq[i].close;
    const vxn = vxnByDate.get(date);
    const tqqqClose = tqqqByDate.get(date) ?? tqqq.find((b) => b.date >= date)?.close ?? spot;
    const tqqqValue = tqqqShares * tqqqClose;

    if (date.slice(0, 4) !== curYear) {
      curYear = date.slice(0, 4);
      premiumThisYear = 0;
    }

    // 1) Mark open lots; monetize or roll where triggered.
    const survivors: OpenLot[] = [];
    for (const lot of open) {
      const dte = daysBetween(date, lot.expiryDate);
      const g = priceAt(spot, lot.strike, dte, vxn);
      const gainPct = lot.costPerShare > 0 ? (g.price - lot.costPerShare) / lot.costPerShare : 0;

      const monetize = Math.abs(g.delta) >= cfg.monetizeDelta || gainPct >= cfg.monetizeGainPct;
      const roll = dte <= cfg.rollAtDte;

      if (monetize || roll) {
        const sale = g.price * lot.contracts * 100;
        hedgeCash += sale;
        proceeds += sale;
        sells++;
      } else {
        survivors.push(lot);
      }
    }
    open = survivors;

    // 2) DCA buys on cadence, gated by budget + VXN.
    const vxnElevated = vxn != null && vxn > cfg.vxnPauseThreshold;
    if (i % buyEveryDays === 0 && !vxnElevated) {
      const annualBudget = tqqqValue * cfg.annualBudgetPct;
      for (const def of tranches) {
        const dte = def.dte;
        const strike = Math.max(1, Math.round(spot * def.moneyness));
        const g = priceAt(spot, strike, dte, vxn);
        if (g.price <= 0) continue;
        const premPerContract = g.price * 100;

        // Target stack: budget-capped and notional-capped (mirrors buildTranchePlan).
        const trancheAnnualBudget = annualBudget * def.budgetShare;
        const annualPerContract = premPerContract * (365 / dte);
        const budgetTarget = annualPerContract > 0 ? Math.floor(trancheAnnualBudget / annualPerContract) : 0;
        const coverTarget = Math.floor((def.maxCoverage * tqqqValue) / (strike * 100));
        const target = Math.max(0, Math.min(budgetTarget, coverTarget));

        const openContracts = open
          .filter((l) => l.tranche === def.key)
          .reduce((s, l) => s + l.contracts, 0);
        if (openContracts >= target) continue;

        const clip = Math.max(1, Math.ceil(target / dcaClips));
        const want = Math.min(clip, target - openContracts);

        const budgetLeft = annualBudget - premiumThisYear;
        const affordable = premPerContract > 0 ? Math.floor(budgetLeft / premPerContract) : 0;
        const buyN = Math.max(0, Math.min(want, affordable));
        if (buyN <= 0) continue;

        const cost = buyN * premPerContract;
        hedgeCash -= cost;
        premiumPaid += cost;
        premiumThisYear += cost;
        buys++;
        open.push({
          tranche: def.key,
          strike,
          contracts: buyN,
          expiryDate: addDays(date, dte),
          entryDte: dte,
          costPerShare: g.price,
          moneyness: def.moneyness,
        });
      }
    }

    // 3) Mark open puts for equity.
    let putValue = 0;
    for (const lot of open) {
      const dte = daysBetween(date, lot.expiryDate);
      putValue += priceAt(spot, lot.strike, dte, vxn).price * lot.contracts * 100;
    }
    peakPutValue = Math.max(peakPutValue, putValue);

    curve.push({
      date,
      withHedge: tqqqValue + hedgeCash + putValue,
      naked: tqqqValue,
      putValue,
      netHedgeCash: hedgeCash,
    });
  }

  const maxDd = (key: "withHedge" | "naked") => {
    let peak = -Infinity;
    let dd = 0;
    for (const p of curve) {
      const v = p[key];
      if (v > peak) peak = v;
      if (peak > 0) dd = Math.min(dd, v / peak - 1);
    }
    return dd;
  };

  const maxDrawdownNaked = maxDd("naked");
  const maxDrawdownHedged = maxDd("withHedge");
  const last = curve[curve.length - 1];
  const residual = last.putValue;
  // What the overlay subtracted from terminal equity: premium spent, less
  // proceeds recovered, less the value still sitting in open puts.
  const netCost = -(hedgeCash + residual);

  return {
    curve,
    stats: {
      maxDrawdownNaked,
      maxDrawdownHedged,
      drawdownReduced: maxDrawdownHedged - maxDrawdownNaked, // both negative; positive = improvement
      totalPremiumPaid: premiumPaid,
      totalProceeds: proceeds,
      netHedgeCost: netCost,
      netHedgeCostPct: cfg.tqqqStartValue > 0 ? netCost / cfg.tqqqStartValue : 0,
      peakPutValue,
      finalHedged: last.withHedge,
      finalNaked: last.naked,
      buys,
      sells,
    },
  };
}

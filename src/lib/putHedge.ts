/**
 * Systematic put-hedge backtester.
 *
 * Goal: size and tune a *rolling long-put overlay* on a leveraged equity
 * position (e.g. TQQQ) so that it cuts the worst drawdowns for the least
 * possible premium bleed.
 *
 * There is no historical option-chain data in this project, so option premiums
 * are *modeled* with Black-Scholes using a market implied-vol input (e.g. ^VIX
 * for SPY puts, ^VXN for QQQ puts). Because that IV already embeds the volatility
 * risk premium, the modeled premiums are realistically expensive — i.e. this does
 * NOT understate the cost of carry the way a realized-vol model would.
 *
 * The overlay is *self-financing*: every roll, the expiring/old put is liquidated
 * into the held asset and the new premium is funded by selling a sliver of the
 * held asset. So the hedged equity curve already nets out the premium drag — no
 * separate cash sleeve to reason about.
 *
 * All functions are pure (no I/O). Feed them aligned price + IV series.
 */

// ---------------------------------------------------------------------------
// Black-Scholes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One trading day, with the held asset, the put's underlying, and its IV. */
export interface HedgeBar {
  date: string; // YYYY-MM-DD
  heldClose: number; // price of the asset you own (e.g. TQQQ)
  putClose: number; // price of the put's underlying (e.g. QQQ — same as heldClose for a direct hedge)
  iv: number; // annualized implied vol of the put underlying, as a decimal
}

export interface PutHedgeParams {
  /** Strike / spot at entry. 0.90 = a 10%-out-of-the-money put. */
  moneyness: number;
  /** Calendar days to expiry at entry. */
  dteDays: number;
  /** Roll cadence in calendar days. Omit / null = hold each put to expiry. */
  rollEveryDays?: number | null;
  /** Put-underlying notional to cover, as a multiple of held-portfolio value.
   *  1.0 fully hedges a direct position; for QQQ puts hedging TQQQ you'll want
   *  ~3 to match delta exposure. 0 disables the hedge. */
  coverageRatio: number;
  riskFreeRate?: number; // default 0.04
  dividendYield?: number; // of the put underlying, default 0
  /** Round-trip frictions (commission + slippage) as bps of premium. */
  costBps?: number;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface HedgeEquityPoint {
  date: string;
  hedged: number; // growth of $1, premium drag already netted out
  unhedged: number; // growth of $1, buy & hold of the held asset
}

export interface PutHedgeResult {
  params: PutHedgeParams;
  equity: HedgeEquityPoint[];
  hedgedMaxDD: number; // negative, e.g. -0.42
  unhedgedMaxDD: number; // negative
  hedgedCagr: number;
  unhedgedCagr: number;
  totalPremiumPaid: number; // cumulative, per $1 of starting capital
  totalPutPayoff: number; // cumulative proceeds from puts, per $1
  /** Annual return given up to run the hedge = unhedgedCagr - hedgedCagr.
   *  Negative means the hedge *added* return over the window. */
  annualBleed: number;
  /** How much shallower the worst drawdown got (positive = better). */
  ddReduction: number;
  /** Average premium spent per year, per $1 of starting capital. */
  premiumPerYear: number;
  /** The objective: drawdown reduction per unit of annual bleed.
   *  Infinity when the hedge both cut drawdown and added return. */
  efficiency: number;
  /** Drawdown reduction per annual premium dollar. Unlike `efficiency` this
   *  never saturates (premium is always > 0 for an active hedge), so it cleanly
   *  separates lean cheap hedges from oversized ones inside the Infinity bucket. */
  protectionPerPremium: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / MS_PER_DAY;
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(date) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Max drawdown of a value series as a negative fraction (e.g. -0.34). */
export function maxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = v / peak - 1;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

function cagr(values: number[], firstDate: string, lastDate: string): number {
  if (values.length < 2) return 0;
  const years = daysBetween(firstDate, lastDate) / 365;
  if (years <= 0) return 0;
  const growth = values[values.length - 1] / values[0];
  if (growth <= 0) return -1;
  return Math.pow(growth, 1 / years) - 1;
}

/**
 * Align a held-asset series with the put underlying's series and an IV lookup,
 * keeping only dates present in all three. Use this to build [HedgeBar]s before
 * calling [simulatePutHedge].
 */
export function alignHedgeBars(
  held: { date: string; close: number }[],
  putUnderlying: { date: string; close: number }[],
  ivByDate: Map<string, number>,
): HedgeBar[] {
  const putByDate = new Map(putUnderlying.map((b) => [b.date, b.close]));
  const out: HedgeBar[] = [];
  for (const h of held) {
    const putClose = putByDate.get(h.date);
    const iv = ivByDate.get(h.date);
    if (putClose == null || iv == null || !isFinite(iv) || iv <= 0) continue;
    out.push({ date: h.date, heldClose: h.close, putClose, iv });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * Run the rolling-put overlay over a series of [HedgeBar]s, starting from $1
 * of the held asset. Returns the hedged vs unhedged equity curves and the
 * cost/protection metrics.
 */
export function simulatePutHedge(bars: HedgeBar[], params: PutHedgeParams): PutHedgeResult {
  if (bars.length === 0) {
    throw new Error("simulatePutHedge: need at least one bar");
  }
  const r = params.riskFreeRate ?? 0.04;
  const q = params.dividendYield ?? 0;
  const fee = (params.costBps ?? 0) / 1e4;
  const rollEvery = params.rollEveryDays ?? params.dteDays;

  const start = bars[0];
  let heldUnits = 1 / start.heldClose; // $1 in the held asset
  let putShares = 0; // put-underlying shares currently covered
  let strike = 0;
  let expiry: string | null = null;
  let lastRoll = start.date;

  let totalPremium = 0;
  let totalPayoff = 0;

  const equity: HedgeEquityPoint[] = [];

  for (let i = 0; i < bars.length; i++) {
    const { date, heldClose, putClose, iv } = bars[i];

    // Mark the existing put to market.
    let putVal = 0;
    if (putShares > 0 && expiry) {
      const t = Math.max(0, daysBetween(date, expiry) / 365);
      putVal = bsPut(putClose, strike, t, iv, r, q);
    }

    const expired = expiry != null && date >= expiry;
    const dueToRoll = daysBetween(lastRoll, date) >= rollEvery;
    const needNewPut = i === 0 || expired || dueToRoll;

    // Liquidate the old put into cash → sweep into the held asset.
    if (i > 0 && putShares > 0 && (expired || dueToRoll)) {
      const proceeds = putShares * putVal * (1 - fee);
      heldUnits += proceeds / heldClose;
      totalPayoff += proceeds;
      putShares = 0;
    }

    if (needNewPut && params.coverageRatio > 0) {
      const heldValue = heldUnits * heldClose;
      const newStrike = params.moneyness * putClose;
      const price = bsPut(putClose, newStrike, params.dteDays / 365, iv, r, q);
      const cover = (params.coverageRatio * heldValue) / putClose; // shares
      const premium = cover * price * (1 + fee);
      heldUnits -= premium / heldClose; // self-finance from the held asset
      totalPremium += premium;
      putShares = cover;
      strike = newStrike;
      expiry = addDays(date, params.dteDays);
      lastRoll = date;
      putVal = price;
    }

    const hedged = heldUnits * heldClose + putShares * putVal;
    equity.push({ date, hedged, unhedged: heldClose / start.heldClose });
  }

  const last = bars[bars.length - 1];
  const hedgedSeries = equity.map((e) => e.hedged);
  const unhedgedSeries = equity.map((e) => e.unhedged);

  const hedgedMaxDD = maxDrawdown(hedgedSeries);
  const unhedgedMaxDD = maxDrawdown(unhedgedSeries);
  const hedgedCagr = cagr(hedgedSeries, start.date, last.date);
  const unhedgedCagr = cagr(unhedgedSeries, start.date, last.date);

  const years = Math.max(daysBetween(start.date, last.date) / 365, 1e-9);
  const premiumPerYear = totalPremium / years;
  const annualBleed = unhedgedCagr - hedgedCagr;
  const ddReduction = hedgedMaxDD - unhedgedMaxDD; // positive = shallower
  const efficiency = annualBleed <= 1e-6 ? Infinity : ddReduction / annualBleed;
  const protectionPerPremium = premiumPerYear > 1e-9 ? ddReduction / premiumPerYear : 0;

  return {
    params,
    equity,
    hedgedMaxDD,
    unhedgedMaxDD,
    hedgedCagr,
    unhedgedCagr,
    totalPremiumPaid: totalPremium,
    totalPutPayoff: totalPayoff,
    annualBleed,
    ddReduction,
    premiumPerYear,
    efficiency,
    protectionPerPremium,
  };
}

// ---------------------------------------------------------------------------
// Multi-leg ladder
// ---------------------------------------------------------------------------

/** One rolling-put leg of a ladder (e.g. a crash tranche or catastrophe tranche). */
export interface LadderLeg {
  /** Strike / spot at entry. 0.75 = a 25%-out-of-the-money put. */
  moneyness: number;
  dteDays: number;
  /** Roll cadence in calendar days. Omit / null = hold to expiry. */
  rollEveryDays?: number | null;
  /** Put-underlying notional to cover, as a multiple of held-portfolio value. */
  coverageRatio: number;
}

export interface LadderResult {
  equity: HedgeEquityPoint[];
  hedgedMaxDD: number;
  unhedgedMaxDD: number;
  hedgedCagr: number;
  unhedgedCagr: number;
  totalPremiumPaid: number;
  totalPutPayoff: number;
  annualBleed: number;
  ddReduction: number;
  premiumPerYear: number;
}

/**
 * Simulate several rolling-put legs at once over a shared held position — the
 * multi-tranche generalization of [simulatePutHedge]. Each leg keeps its own
 * strike / expiry / roll cadence; all of them self-finance from (and liquidate
 * into) the single held asset, so the returned equity already nets out the
 * combined premium drag. Legs are processed in array order each bar, so a later
 * leg sizes off the held value remaining after earlier legs trade that day.
 */
export function simulateLadderHedge(
  bars: HedgeBar[],
  legs: LadderLeg[],
  opts: { riskFreeRate?: number; dividendYield?: number; costBps?: number } = {},
): LadderResult {
  if (bars.length === 0) throw new Error("simulateLadderHedge: need at least one bar");
  const r = opts.riskFreeRate ?? 0.04;
  const q = opts.dividendYield ?? 0;
  const fee = (opts.costBps ?? 0) / 1e4;

  const start = bars[0];
  let heldUnits = 1 / start.heldClose;
  const st = legs.map((leg) => ({
    leg,
    rollEvery: leg.rollEveryDays ?? leg.dteDays,
    putShares: 0,
    strike: 0,
    expiry: null as string | null,
    lastRoll: start.date,
  }));

  let totalPremium = 0;
  let totalPayoff = 0;
  const equity: HedgeEquityPoint[] = [];

  for (let i = 0; i < bars.length; i++) {
    const { date, heldClose, putClose, iv } = bars[i];
    let putfolio = 0;

    for (const s of st) {
      let putVal = 0;
      if (s.putShares > 0 && s.expiry) {
        const t = Math.max(0, daysBetween(date, s.expiry) / 365);
        putVal = bsPut(putClose, s.strike, t, iv, r, q);
      }

      const expired = s.expiry != null && date >= s.expiry;
      const dueToRoll = daysBetween(s.lastRoll, date) >= s.rollEvery;
      const needNew = i === 0 || expired || dueToRoll;

      if (i > 0 && s.putShares > 0 && (expired || dueToRoll)) {
        const proceeds = s.putShares * putVal * (1 - fee);
        heldUnits += proceeds / heldClose;
        totalPayoff += proceeds;
        s.putShares = 0;
      }

      if (needNew && s.leg.coverageRatio > 0) {
        const heldValue = heldUnits * heldClose;
        const newStrike = s.leg.moneyness * putClose;
        const price = bsPut(putClose, newStrike, s.leg.dteDays / 365, iv, r, q);
        const cover = (s.leg.coverageRatio * heldValue) / putClose;
        const premium = cover * price * (1 + fee);
        heldUnits -= premium / heldClose;
        totalPremium += premium;
        s.putShares = cover;
        s.strike = newStrike;
        s.expiry = addDays(date, s.leg.dteDays);
        s.lastRoll = date;
        putVal = price;
      }

      putfolio += s.putShares * putVal;
    }

    equity.push({ date, hedged: heldUnits * heldClose + putfolio, unhedged: heldClose / start.heldClose });
  }

  const last = bars[bars.length - 1];
  const hedgedSeries = equity.map((e) => e.hedged);
  const unhedgedSeries = equity.map((e) => e.unhedged);
  const hedgedMaxDD = maxDrawdown(hedgedSeries);
  const unhedgedMaxDD = maxDrawdown(unhedgedSeries);
  const hedgedCagr = cagr(hedgedSeries, start.date, last.date);
  const unhedgedCagr = cagr(unhedgedSeries, start.date, last.date);
  const years = Math.max(daysBetween(start.date, last.date) / 365, 1e-9);

  return {
    equity,
    hedgedMaxDD,
    unhedgedMaxDD,
    hedgedCagr,
    unhedgedCagr,
    totalPremiumPaid: totalPremium,
    totalPutPayoff: totalPayoff,
    annualBleed: unhedgedCagr - hedgedCagr,
    ddReduction: hedgedMaxDD - unhedgedMaxDD,
    premiumPerYear: totalPremium / years,
  };
}

// ---------------------------------------------------------------------------
// Parameter sweep
// ---------------------------------------------------------------------------

export interface SweepGrid {
  moneyness: number[];
  dteDays: number[];
  /** Fixed calendar roll cadence in days. null entry = hold to expiry. */
  rollEveryDays?: (number | null)[];
  /**
   * Roll when this many days remain — the way the strategy actually rolls.
   * Converted per-DTE to a cadence of `dteDays - rollAtDte`. null = hold to
   * expiry. Takes precedence over `rollEveryDays` when set.
   */
  rollAtDte?: (number | null)[];
  /** Drop combos whose holding window (dteDays - rollEvery) is shorter than this. */
  minHoldDays?: number;
  coverageRatio: number[];
  riskFreeRate?: number;
  dividendYield?: number;
  costBps?: number;
}

/**
 * Cartesian sweep over the grid, returning every result sorted best-first by
 * `efficiency` (drawdown reduction per unit of annual bleed). Ties — including
 * the large Infinity bucket where the hedge added return over the window — break
 * toward `protectionPerPremium`, which favors lean, cheap hedges over oversized
 * ones that only look free in hindsight. Combos that don't reduce drawdown are
 * dropped.
 */
export function sweepPutHedge(bars: HedgeBar[], grid: SweepGrid): PutHedgeResult[] {
  const minHold = grid.minHoldDays ?? 0;
  const results: PutHedgeResult[] = [];

  for (const moneyness of grid.moneyness) {
    for (const dteDays of grid.dteDays) {
      // Roll-at-DTE (the strategy's real rule) converts to a per-DTE cadence;
      // otherwise fall back to a fixed calendar cadence.
      const cadences: (number | null)[] = grid.rollAtDte
        ? grid.rollAtDte.map((rad) => (rad == null ? null : dteDays - rad))
        : (grid.rollEveryDays ?? [null]);
      for (const rollEveryDays of cadences) {
        // Skip degenerate combos held for only a handful of days before rolling.
        if (rollEveryDays != null && rollEveryDays < minHold) continue;
        for (const coverageRatio of grid.coverageRatio) {
          results.push(
            simulatePutHedge(bars, {
              moneyness,
              dteDays,
              rollEveryDays,
              coverageRatio,
              riskFreeRate: grid.riskFreeRate,
              dividendYield: grid.dividendYield,
              costBps: grid.costBps,
            }),
          );
        }
      }
    }
  }

  return results
    .filter((r) => r.ddReduction > 0)
    .sort((a, b) => {
      if (b.efficiency !== a.efficiency) return b.efficiency - a.efficiency;
      return b.protectionPerPremium - a.protectionPerPremium;
    });
}

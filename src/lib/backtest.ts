/**
 * Pure intraday grid backtest engine — no I/O, safe to import anywhere (server route, CLI, tests).
 *
 * Replays OHLC bars through a buy/sell ladder that re-anchors to the current price when it sells fully
 * flat (reset-on-flat) and optionally every N days. A GridParams config layers vol-adaptive spacing/sell
 * and a 200-DMA regime rule on top. Data fetching (Yahoo) lives in src/lib/marketData.ts; the CLI's
 * extra Supabase wiring lives in scripts/backtestEngine.ts. Both build on this module.
 */
import { type Level } from "./levels";
import { annualizedVol, sma, computeRegime, computeAdaptiveLevels, scaleByVol } from "./adaptiveLevels";

export const DAY = 86_400_000;

export interface Bar { date: Date; high: number; low: number; close: number; open: number }
export interface DailyStat { date: string; vol20: number; baseline: number; regime: string }
export interface Lot { shares: number; buyFill: number; sellTarget: number; level: number }
export interface Trade { date: string; side: "BUY" | "SELL"; level: number; shares: number; price: number }

/** Arithmetic ladder matching computeLevels but with a configurable spacing % (1% = the static grid). */
export function ladder(cash: number, anchor: number, sellPct: number, R: number, spacingPct: number): Level[] {
  const K = (1 - R) / (1 - Math.pow(R, 88));
  return Array.from({ length: 88 }, (_, n) => {
    const buyPrice = anchor * (1 - 0.01 * spacingPct * n);
    const shares = buyPrice > 0 ? Math.round((cash * K * Math.pow(R, n)) / buyPrice) : 0;
    return { n, buyPrice, sellPrice: buyPrice * (1 + sellPct / 100), shares, cost: shares * buyPrice, purchased: false };
  });
}

export function buildDailyStats(tqqq: { date: string; close: number }[], qqq: { date: string; close: number }[]): DailyStat[] {
  const tClose = tqqq.map((d) => d.close);
  const qDates = qqq.map((d) => d.date);
  const qClose = qqq.map((d) => d.close);
  return tqqq.map((d, i) => {
    const vol20 = annualizedVol(tClose.slice(0, i + 1), 20);
    const baseline = annualizedVol(tClose.slice(0, i + 1), Math.min(252, i));
    let qi = qDates.indexOf(d.date);
    if (qi < 0) qi = qClose.length - 1;
    const sma200 = sma(qClose.slice(0, qi + 1), 200);
    return { date: d.date, vol20, baseline, regime: computeRegime(qClose[qi], sma200) };
  });
}

/** Returns a lookup that yields the daily stat as-of the trading day *before* `day` (no lookahead). */
export function statByPriorDay(stats: DailyStat[]): (day: string) => DailyStat {
  return (day: string) => {
    let chosen = stats[0];
    for (const s of stats) { if (s.date < day) chosen = s; else break; }
    return chosen;
  };
}

export interface EquityPoint { date: string; equity: number }
export interface SimResult {
  totalReturnPct: number; realized: number; buys: number; sells: number;
  maxDDPct: number; maxDeployed: number; resets: number; equityCurve?: EquityPoint[]; trades?: Trade[];
}
export interface SimOpts { resetOnFlat: boolean; trackEquity?: boolean; trackTrades?: boolean }

export function simulate(
  bars: Bar[],
  startingCash: number,
  buildLadder: (anchor: number, day: string) => Level[],
  buysAllowed: (day: string) => boolean,
  opts: SimOpts = { resetOnFlat: true },
): SimResult {
  let cash = startingCash;
  const owned = new Map<number, Lot>(); // keyed by current-ladder index
  let anchor = bars[0].open;
  let day = "";
  let allow = true;
  let ladderLevels = buildLadder(anchor, bars[0].date.toISOString().slice(0, 10));
  let resets = 0, buys = 0, sells = 0, realized = 0, maxDeployed = 0, peak = startingCash, maxDD = 0;
  const equityCurve: EquityPoint[] = [];
  const trades: Trade[] = [];

  for (const bar of bars) {
    const d = bar.date.toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      allow = buysAllowed(d);
      ladderLevels = buildLadder(anchor, d);
    }
    // Sells. A level freed this bar can't re-buy until next bar.
    const soldThisBar = new Set<number>();
    for (const [idx, lot] of owned) {
      if (bar.high >= lot.sellTarget) {
        cash += lot.shares * lot.sellTarget;
        realized += (lot.sellTarget - lot.buyFill) * lot.shares;
        if (opts.trackTrades) trades.push({ date: bar.date.toISOString(), side: "SELL", level: lot.level, shares: lot.shares, price: lot.sellTarget });
        owned.delete(idx); soldThisBar.add(idx); sells++;
      }
    }
    if (allow) {
      for (let i = 0; i < ladderLevels.length; i++) {
        if (owned.has(i) || soldThisBar.has(i)) continue;
        const lvl = ladderLevels[i];
        if (lvl.shares <= 0) continue;
        const cost = lvl.shares * lvl.buyPrice;
        if (bar.low <= lvl.buyPrice && cash >= cost) {
          cash -= cost;
          owned.set(i, { shares: lvl.shares, buyFill: lvl.buyPrice, sellTarget: lvl.sellPrice, level: i });
          if (opts.trackTrades) trades.push({ date: bar.date.toISOString(), side: "BUY", level: i, shares: lvl.shares, price: lvl.buyPrice });
          buys++;
        }
      }
    }
    // Reset-on-flat: fully out → re-center the ladder on the current price so we re-enter at level 0.
    if (opts.resetOnFlat && owned.size === 0 && Math.abs(bar.close - anchor) / anchor > 1e-9) {
      anchor = bar.close; ladderLevels = buildLadder(anchor, d); resets++;
    }
    let invested = 0;
    for (const lot of owned.values()) invested += lot.shares * bar.close;
    maxDeployed = Math.max(maxDeployed, invested);
    const equity = cash + invested;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);
    if (opts.trackEquity) equityCurve.push({ date: bar.date.toISOString(), equity });
  }
  const end = cash + [...owned.values()].reduce((s, l) => s + l.shares * bars[bars.length - 1].close, 0);
  return {
    totalReturnPct: (end / startingCash - 1) * 100, realized, buys, sells,
    maxDDPct: maxDD * 100, maxDeployed, resets,
    ...(opts.trackEquity ? { equityCurve } : {}), ...(opts.trackTrades ? { trades } : {}),
  };
}

// ── Strategy config: one parameter set, runnable through simulate ─────────────
export type RegimeMode = "none" | "pause" | "widen"; // none = always buy; pause = no buys risk-off; widen = 2× spacing risk-off
export type VolMode = "off" | "on";                  // on = scale spacing & sell by realized vol / baseline, clamped
export interface GridParams { spacing: number; sell: number; R: number; regime: RegimeMode; vol: VolMode }

/** The spacing % and sell % actually in effect for a given prior-day stat: vol-adaptive scaling
 *  (clamped) plus the risk-off widen. With vol=off and regime≠widen these are just the base values. */
export function effectiveSpacingSell(p: GridParams, s: DailyStat): { spacing: number; sell: number } {
  let spacing = p.spacing;
  let sell = p.sell;
  if (p.vol === "on") {
    spacing = scaleByVol(spacing, s.vol20, s.baseline, p.spacing * 0.5, p.spacing * 3);
    sell = scaleByVol(sell, s.vol20, s.baseline, p.sell * 0.5, p.sell * 2);
  }
  if (p.regime === "widen" && s.regime === "risk-off") spacing *= 2;
  return { spacing, sell };
}

/** Ladder builder for a GridParams set, using the geometric computeAdaptiveLevels engine (valid at any
 *  spacing). Folds in vol-adaptive scaling and the risk-off widen, read as-of the prior trading day. */
export function buildConfigLadder(cash: number, p: GridParams, priorDay: (d: string) => DailyStat) {
  return (anchor: number, day: string) => {
    const { spacing, sell } = effectiveSpacingSell(p, priorDay(day));
    return computeAdaptiveLevels({ levelStartingCash: cash, initialLotPrice: anchor, reductionFactor: p.R, spacingPercent: spacing, sellPercent: sell });
  };
}

/** Run one GridParams config through the simulator (reset-on-flat always on). */
export function runConfig(bars: Bar[], cash: number, p: GridParams, priorDay: (d: string) => DailyStat, trackEquity = false, trackTrades = false): SimResult {
  const build = buildConfigLadder(cash, p, priorDay);
  const buysAllowed = (day: string) => (p.regime === "pause" ? priorDay(day).regime !== "risk-off" : true);
  return simulate(bars, cash, build, buysAllowed, { resetOnFlat: true, trackEquity, trackTrades });
}

/** Risk-adjusted score: return per point of max drawdown (Calmar-ish), maxDD floored so a near-zero
 *  drawdown can't produce an absurd ratio. */
export const riskAdj = (r: SimResult) => r.totalReturnPct / Math.max(r.maxDDPct, 1);

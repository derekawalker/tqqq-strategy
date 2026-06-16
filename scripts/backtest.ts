/**
 * Intraday backtest: static ladder vs vol-adaptive+regime ladder vs widen-on-risk-off ladder.
 *
 *   npm run backtest -- [--interval 5m] [--days 60] [--account 5WX69341] [--no-reset] [--reset-days N]
 *
 * Replays intraday TQQQ bars through each strategy with the same starting cash. The ladder
 * re-anchors to the current price whenever the grid sells fully flat (reset-on-flat, default on) and
 * optionally every N days (--reset-days). Daily TQQQ drives adaptive spacing/sell %, daily QQQ drives
 * the 200-DMA regime; both read as-of the prior trading day (no lookahead). Grid-only — no options.
 */
import YahooFinance from "yahoo-finance2";
import { createClient } from "@supabase/supabase-js";
import { type Level } from "../src/lib/levels";
import { computeAdaptiveLevels, annualizedVol, sma, computeRegime, scaleByVol } from "../src/lib/adaptiveLevels";

/** Arithmetic ladder matching computeLevels but with a configurable spacing % (1% = the static grid). */
function ladder(cash: number, anchor: number, sellPct: number, R: number, spacingPct: number): Level[] {
  const K = (1 - R) / (1 - Math.pow(R, 88));
  return Array.from({ length: 88 }, (_, n) => {
    const buyPrice = anchor * (1 - 0.01 * spacingPct * n);
    const shares = buyPrice > 0 ? Math.round((cash * K * Math.pow(R, n)) / buyPrice) : 0;
    return { n, buyPrice, sellPrice: buyPrice * (1 + sellPct / 100), shares, cost: shares * buyPrice, purchased: false };
  });
}

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const DAY = 86_400_000;

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

type Interval = "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "1d";
const INTERVAL = arg("interval", "5m") as Interval;
const DAYS = parseInt(arg("days", "60"), 10);
const ACCOUNT = arg("account", "5WX69341");
const RESET_ON_FLAT = !has("no-reset");
const RESET_DAYS = parseInt(arg("reset-days", "0"), 10) || 0;

interface Bar { date: Date; high: number; low: number; close: number; open: number }
interface DailyStat { date: string; vol20: number; baseline: number; regime: string }
interface Lot { shares: number; buyFill: number; sellTarget: number }

async function getSettings() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("settings").select("value").eq("key", "accounts").single();
  const accts = (data?.value ?? []) as Array<{ accountNumber: string; settings: Record<string, number> }>;
  const a = accts.find((x) => x.accountNumber === ACCOUNT) ?? accts[0];
  const s = a.settings;
  return { accountNumber: a.accountNumber, startingCash: s.levelStartingCash, sellPct: s.sellPercentage, R: s.reductionFactor };
}

async function dailyCloses(symbol: string): Promise<{ date: string; close: number }[]> {
  const r = await yf.chart(symbol, { period1: new Date(Date.now() - (DAYS + 420) * DAY), interval: "1d" });
  return (r.quotes ?? [])
    .filter((q) => q.close != null && q.date != null)
    .map((q) => ({ date: (q.date as Date).toISOString().slice(0, 10), close: q.close as number }));
}

async function intradayBars(): Promise<Bar[]> {
  const r = await yf.chart("TQQQ", { period1: new Date(Date.now() - DAYS * DAY), interval: INTERVAL });
  return (r.quotes ?? [])
    .filter((q) => q.high != null && q.low != null && q.close != null && q.open != null && q.date != null)
    .map((q) => ({ date: q.date as Date, high: q.high as number, low: q.low as number, close: q.close as number, open: q.open as number }));
}

function buildDailyStats(tqqq: { date: string; close: number }[], qqq: { date: string; close: number }[]): DailyStat[] {
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

interface SimResult { totalReturnPct: number; realized: number; buys: number; sells: number; maxDDPct: number; maxDeployed: number; resets: number }

function simulate(
  bars: Bar[],
  startingCash: number,
  buildLadder: (anchor: number, day: string) => Level[],
  buysAllowed: (day: string) => boolean,
): SimResult {
  let cash = startingCash;
  const owned = new Map<number, Lot>(); // keyed by current-ladder index
  const legacy: Lot[] = [];             // lots carried across a periodic reset (sell-only)
  let anchor = bars[0].open;
  let day = "";
  let allow = true;
  let ladder = buildLadder(anchor, bars[0].date.toISOString().slice(0, 10));
  let lastReset = bars[0].date.getTime();
  let resets = 0, buys = 0, sells = 0, realized = 0, maxDeployed = 0, peak = startingCash, maxDD = 0;

  const reanchor = (price: number, d: string) => {
    for (const lot of owned.values()) legacy.push(lot); // keep open lots; they sell off on their targets
    owned.clear();
    anchor = price;
    ladder = buildLadder(anchor, d);
    resets++;
  };

  for (const bar of bars) {
    const d = bar.date.toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      allow = buysAllowed(d);
      ladder = buildLadder(anchor, d);
      if (RESET_DAYS && bar.date.getTime() - lastReset >= RESET_DAYS * DAY) { reanchor(bar.open, d); lastReset = bar.date.getTime(); }
    }
    // Sells (legacy lots first, then current-ladder lots). A level freed this bar can't re-buy until next bar.
    for (let i = legacy.length - 1; i >= 0; i--) {
      if (bar.high >= legacy[i].sellTarget) {
        cash += legacy[i].shares * legacy[i].sellTarget;
        realized += (legacy[i].sellTarget - legacy[i].buyFill) * legacy[i].shares;
        legacy.splice(i, 1); sells++;
      }
    }
    const soldThisBar = new Set<number>();
    for (const [idx, lot] of owned) {
      if (bar.high >= lot.sellTarget) {
        cash += lot.shares * lot.sellTarget;
        realized += (lot.sellTarget - lot.buyFill) * lot.shares;
        owned.delete(idx); soldThisBar.add(idx); sells++;
      }
    }
    if (allow) {
      for (let i = 0; i < ladder.length; i++) {
        if (owned.has(i) || soldThisBar.has(i)) continue;
        const lvl = ladder[i];
        if (lvl.shares <= 0) continue;
        const cost = lvl.shares * lvl.buyPrice;
        if (bar.low <= lvl.buyPrice && cash >= cost) {
          cash -= cost;
          owned.set(i, { shares: lvl.shares, buyFill: lvl.buyPrice, sellTarget: lvl.sellPrice });
          buys++;
        }
      }
    }
    // Reset-on-flat: fully out → re-center the ladder on the current price so we re-enter at level 0.
    if (RESET_ON_FLAT && owned.size === 0 && legacy.length === 0 && Math.abs(bar.close - anchor) / anchor > 1e-9) {
      anchor = bar.close; ladder = buildLadder(anchor, d); resets++;
    }
    let invested = 0;
    for (const lot of owned.values()) invested += lot.shares * bar.close;
    for (const lot of legacy) invested += lot.shares * bar.close;
    maxDeployed = Math.max(maxDeployed, invested);
    const equity = cash + invested;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);
  }
  const end = cash + [...owned.values(), ...legacy].reduce((s, l) => s + l.shares * bars[bars.length - 1].close, 0);
  return { totalReturnPct: (end / startingCash - 1) * 100, realized, buys, sells, maxDDPct: maxDD * 100, maxDeployed, resets };
}

async function main() {
  const cfg = await getSettings();
  const [bars, tqqqD, qqqD] = await Promise.all([intradayBars(), dailyCloses("TQQQ"), dailyCloses("QQQ")]);
  if (bars.length === 0) { console.error("No intraday bars returned."); return; }
  const stats = buildDailyStats(tqqqD, qqqD);
  const statByPriorDay = (day: string): DailyStat => {
    let chosen = stats[0];
    for (const s of stats) { if (s.date < day) chosen = s; else break; }
    return chosen;
  };

  console.log(`\nAccount ${cfg.accountNumber} · cash $${cfg.startingCash.toLocaleString()} · sell ${cfg.sellPct}% · R ${cfg.R}`);
  console.log(`Window: ${INTERVAL} bars / ${DAYS}d · re-anchor: reset-on-flat ${RESET_ON_FLAT ? "ON" : "off"}${RESET_DAYS ? `, every ${RESET_DAYS}d` : ""}\n`);

  // Static: fixed 1% spacing, fixed sell %, always buy.
  const staticRes = simulate(bars, cfg.startingCash, (anchor) => ladder(cfg.startingCash, anchor, cfg.sellPct, cfg.R, 1), () => true);

  // Flexible: vol-adaptive spacing/sell %, buys paused below the 200-DMA.
  const flexRes = simulate(
    bars, cfg.startingCash,
    (anchor, day) => {
      const s = statByPriorDay(day);
      const spacing = scaleByVol(1, s.vol20, s.baseline, 0.5, 3);
      const sell = scaleByVol(cfg.sellPct, s.vol20, s.baseline, cfg.sellPct * 0.5, cfg.sellPct * 2);
      return computeAdaptiveLevels({ levelStartingCash: cfg.startingCash, initialLotPrice: anchor, reductionFactor: cfg.R, spacingPercent: spacing, sellPercent: sell });
    },
    (day) => statByPriorDay(day).regime !== "risk-off",
  );

  // Widen: keep buying below the 200-DMA, but space buys 2% apart instead of 1%.
  const widenRes = simulate(
    bars, cfg.startingCash,
    (anchor, day) => ladder(cfg.startingCash, anchor, cfg.sellPct, cfg.R, statByPriorDay(day).regime === "risk-off" ? 2 : 1),
    () => true,
  );

  const bhShares = cfg.startingCash / bars[0].open;
  const bhRet = ((bhShares * bars[bars.length - 1].close) / cfg.startingCash - 1) * 100;
  const riskOffDays = stats.filter((s) => s.regime === "risk-off").length;
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
  const row = (label: string, r: SimResult) =>
    label.padEnd(11) + pct(r.totalReturnPct).padEnd(10) +
    `realized ${usd(r.realized)}`.padEnd(20) + `maxDD ${r.maxDDPct.toFixed(1)}%`.padEnd(14) +
    `trips ${Math.min(r.buys, r.sells)}`.padEnd(12) + `resets ${r.resets}`;

  console.log("Strategy   Return    Realized            MaxDD         Round-trips  Re-anchors");
  console.log("─".repeat(92));
  console.log(row("Static", staticRes));
  console.log(row("Flexible", flexRes));
  console.log(row("Widen-2%", widenRes));
  console.log("Buy&Hold".padEnd(11) + pct(bhRet).padEnd(10) + `(all ${usd(cfg.startingCash)} held in TQQQ)`);
  console.log("─".repeat(92));
  console.log(`Regime risk-off ${riskOffDays}/${stats.length} days · TQQQ ${bars[0].open.toFixed(2)} → ${bars[bars.length - 1].close.toFixed(2)} over window\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

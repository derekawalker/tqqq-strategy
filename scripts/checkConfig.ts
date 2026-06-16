/**
 * Pin ONE grid config and run it across several market regimes side-by-side, against the live config
 * and buy & hold. This is the confirmation step after optimize.ts: a sweep finds the best params per
 * window, but the only way to know a config is robust (not curve-fit to one regime) is to hold it
 * fixed and watch it across a bull, a bear, and a choppy window at once.
 *
 *   npm run check -- [--spacing 2] [--sell 6] [--R 0.94] [--regime pause] [--vol on] [--account ...]
 *
 * Defaults are the recommendation that came out of the sweeps. The bull window uses 5m intraday bars
 * (~58d, the most Yahoo serves); bear/chop use daily bars over historical ranges, so their fills are
 * coarser (≤1 round-trip per level per day) — trust the cross-regime *ranking*, not absolute bps.
 */
import {
  type Interval, type DateRange, type GridParams, type SimResult,
  getSettings, dailyCloses, intradayBars, buildDailyStats, statByPriorDay, runConfig, riskAdj,
} from "./backtestEngine";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const ACCOUNT = arg("account", "5WX69341");
const PINNED: GridParams = {
  spacing: parseFloat(arg("spacing", "2")),
  sell: parseFloat(arg("sell", "6")),
  R: parseFloat(arg("R", "0.94")),
  regime: arg("regime", "pause") as GridParams["regime"],
  vol: arg("vol", "on") as GridParams["vol"],
};

interface Window { name: string; interval: Interval; days: number; range?: DateRange }
const WINDOWS: Window[] = [
  { name: "Bull (recent ~58d, 5m)", interval: "5m", days: 58 },
  { name: "Bear 2022 (1d)", interval: "1d", days: 60, range: { from: "2022-01-01", to: "2022-12-31" } },
  { name: "Chop 2015–16 (1d)", interval: "1d", days: 60, range: { from: "2015-01-01", to: "2016-12-31" } },
];

const pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
const label = (p: GridParams) =>
  `s=${p.spacing} sell=${p.sell} R=${p.R} ${p.regime} vol=${p.vol}`;
const cell = (r: SimResult) => `${pct(r.totalReturnPct)} / DD ${r.maxDDPct.toFixed(0)}% / ${riskAdj(r).toFixed(2)}`;

async function evalWindow(w: Window, cfg: Awaited<ReturnType<typeof getSettings>>) {
  const [bars, tqqqD, qqqD] = await Promise.all([
    intradayBars(w.interval, w.days, w.range), dailyCloses("TQQQ", w.days, w.range), dailyCloses("QQQ", w.days, w.range),
  ]);
  if (bars.length === 0) return null;
  const priorDay = statByPriorDay(buildDailyStats(tqqqD, qqqD));
  const liveP: GridParams = { spacing: 1, sell: cfg.sellPct, R: cfg.R, regime: "none", vol: "off" };
  const pinned = runConfig(bars, cfg.startingCash, PINNED, priorDay);
  const live = runConfig(bars, cfg.startingCash, liveP, priorDay);
  const bh = ((cfg.startingCash / bars[0].open) * bars[bars.length - 1].close / cfg.startingCash - 1) * 100;
  return { pinned, live, bh, bars: bars.length };
}

async function main() {
  const cfg = await getSettings(ACCOUNT);
  console.log(`\nAccount ${cfg.accountNumber} · cash $${cfg.startingCash.toLocaleString()} · live = s=1 sell=${cfg.sellPct}% R=${cfg.R}`);
  console.log(`Pinned config: ${label(PINNED)}`);
  console.log("Cells show  Return / MaxDD / Ret÷DD\n");

  const results = await Promise.all(WINDOWS.map((w) => evalWindow(w, cfg)));

  console.log("Window".padEnd(26) + "Pinned config".padEnd(26) + "Live config".padEnd(26) + "Buy & Hold");
  console.log("─".repeat(96));
  WINDOWS.forEach((w, i) => {
    const r = results[i];
    if (!r) { console.log(w.name.padEnd(26) + "(no data)"); return; }
    console.log(w.name.padEnd(26) + cell(r.pinned).padEnd(26) + cell(r.live).padEnd(26) + pct(r.bh));
  });
  console.log("─".repeat(96) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });

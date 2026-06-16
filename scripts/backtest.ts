/**
 * Intraday backtest: static ladder vs vol-adaptive+regime ladder vs widen-on-risk-off ladder.
 *
 *   npm run backtest -- [--interval 5m] [--days 60] [--account 5WX69341] [--no-reset]
 *
 * Replays intraday TQQQ bars through each strategy with the same starting cash. The ladder
 * re-anchors to the current price whenever the grid sells fully flat (reset-on-flat, default on).
 * Daily TQQQ drives adaptive spacing/sell %, daily QQQ drives the 200-DMA regime; both read as-of the
 * prior trading day (no lookahead). Grid-only — no options.
 *
 * For a full parameter sweep that finds the best-performing config, see scripts/optimize.ts.
 */
import { computeAdaptiveLevels, scaleByVol } from "../src/lib/adaptiveLevels";
import {
  type Interval, type SimResult,
  ladder, simulate, getSettings, dailyCloses, intradayBars, buildDailyStats, statByPriorDay,
} from "./backtestEngine";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const INTERVAL = arg("interval", "5m") as Interval;
const DAYS = parseInt(arg("days", "60"), 10);
const ACCOUNT = arg("account", "5WX69341");
const RESET_ON_FLAT = !has("no-reset");

async function main() {
  const cfg = await getSettings(ACCOUNT);
  const [bars, tqqqD, qqqD] = await Promise.all([
    intradayBars(INTERVAL, DAYS), dailyCloses("TQQQ", DAYS), dailyCloses("QQQ", DAYS),
  ]);
  if (bars.length === 0) { console.error("No intraday bars returned."); return; }
  const stats = buildDailyStats(tqqqD, qqqD);
  const priorDay = statByPriorDay(stats);
  const opts = { resetOnFlat: RESET_ON_FLAT };

  console.log(`\nAccount ${cfg.accountNumber} · cash $${cfg.startingCash.toLocaleString()} · sell ${cfg.sellPct}% · R ${cfg.R}`);
  console.log(`Window: ${INTERVAL} bars / ${DAYS}d · re-anchor: reset-on-flat ${RESET_ON_FLAT ? "ON" : "off"}\n`);

  // Static: fixed 1% spacing, fixed sell %, always buy.
  const staticRes = simulate(bars, cfg.startingCash, (anchor) => ladder(cfg.startingCash, anchor, cfg.sellPct, cfg.R, 1), () => true, opts);

  // Flexible: vol-adaptive spacing/sell %, buys paused below the 200-DMA.
  const flexRes = simulate(
    bars, cfg.startingCash,
    (anchor, day) => {
      const s = priorDay(day);
      const spacing = scaleByVol(1, s.vol20, s.baseline, 0.5, 3);
      const sell = scaleByVol(cfg.sellPct, s.vol20, s.baseline, cfg.sellPct * 0.5, cfg.sellPct * 2);
      return computeAdaptiveLevels({ levelStartingCash: cfg.startingCash, initialLotPrice: anchor, reductionFactor: cfg.R, spacingPercent: spacing, sellPercent: sell });
    },
    (day) => priorDay(day).regime !== "risk-off",
    opts,
  );

  // Widen: keep buying below the 200-DMA, but space buys 2% apart instead of 1%.
  const widenRes = simulate(
    bars, cfg.startingCash,
    (anchor, day) => ladder(cfg.startingCash, anchor, cfg.sellPct, cfg.R, priorDay(day).regime === "risk-off" ? 2 : 1),
    () => true,
    opts,
  );

  // Tight-1%: on high realized-vol days, sell at just 1% to cycle more trades; normal otherwise.
  const tightRes = simulate(
    bars, cfg.startingCash,
    (anchor, day) => {
      const s = priorDay(day);
      return ladder(cfg.startingCash, anchor, s.vol20 > s.baseline ? 1 : cfg.sellPct, cfg.R, 1);
    },
    () => true,
    opts,
  );

  // Combo: widen buys to 2% in risk-off AND tighten sells to 1% on high-vol days.
  const comboRes = simulate(
    bars, cfg.startingCash,
    (anchor, day) => {
      const s = priorDay(day);
      return ladder(cfg.startingCash, anchor, s.vol20 > s.baseline ? 1 : cfg.sellPct, cfg.R, s.regime === "risk-off" ? 2 : 1);
    },
    () => true,
    opts,
  );

  const bhShares = cfg.startingCash / bars[0].open;
  const bhRet = ((bhShares * bars[bars.length - 1].close) / cfg.startingCash - 1) * 100;
  const riskOffDays = stats.filter((s) => s.regime === "risk-off").length;
  const highVolDays = stats.filter((s) => s.vol20 > s.baseline).length;
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
  console.log(row("Tight-1%", tightRes));
  console.log(row("Combo", comboRes));
  console.log("Buy&Hold".padEnd(11) + pct(bhRet).padEnd(10) + `(all ${usd(cfg.startingCash)} held in TQQQ)`);
  console.log("─".repeat(92));
  console.log(`Risk-off ${riskOffDays}/${stats.length} days · high-vol ${highVolDays}/${stats.length} days · TQQQ ${bars[0].open.toFixed(2)} → ${bars[bars.length - 1].close.toFixed(2)}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

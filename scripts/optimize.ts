/**
 * Parameter sweep over the intraday grid strategy. Fetches the bars/daily stats ONCE, then replays
 * thousands of parameter combinations in memory and ranks them by raw return and by risk-adjusted
 * return (return ÷ maxDD). Every config is also re-run on the most recent half of the window as a
 * cheap overfit check — a config that only wins on the full window but collapses on the recent half
 * is a curve fit, not an edge.
 *
 *   npm run optimize -- [--interval 5m] [--days 60] [--account 5WX69341] [--top 15]
 *
 * Ladders use the geometric computeAdaptiveLevels engine so any spacing stays positive/monotonic
 * (the arithmetic static ladder goes negative past ~1.1% spacing). Daily TQQQ drives adaptive
 * spacing/sell, daily QQQ drives the 200-DMA regime; both read as-of the prior trading day. The grid
 * always re-anchors on flat (reset-on-flat); there is no periodic-reset knob.
 *
 * Swept knobs:
 *   spacing %     gap between buy rungs
 *   sell %        target above each buy
 *   R             capital-allocation reduction factor across rungs
 *   regime        none | pause (no buys risk-off) | widen (2× spacing risk-off)
 *   vol           off | on (scale spacing & sell by realized vol / baseline, clamped)
 */
import {
  type Interval, type SimResult, type DateRange, type GridParams,
  getSettings, dailyCloses, intradayBars, buildDailyStats, statByPriorDay, runConfig, riskAdj,
} from "./backtestEngine";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

// Historical window via --from/--to (ISO dates) forces daily bars (intraday history is ~60d only).
const RANGE: DateRange | undefined = arg("from", "") && arg("to", "")
  ? { from: arg("from", ""), to: arg("to", "") } : undefined;
const INTERVAL = arg("interval", RANGE ? "1d" : "5m") as Interval;
const DAYS = parseInt(arg("days", "60"), 10);
const ACCOUNT = arg("account", "5WX69341");
const TOP = parseInt(arg("top", "15"), 10);

// ── Sweep grid ──────────────────────────────────────────────────────────────
// --wide expands the meaningful levers (spacing/sell/R) past the original edges and prunes the
// regime/vol dimensions, which proved inert in a low-risk-off window — keeps the run fast while
// probing where the optimum actually peaks.
const WIDE = has("wide");
const SPACINGS = WIDE ? [0.25, 0.35, 0.5, 0.65, 0.75, 1, 1.5] : [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const SELLS = WIDE ? [6, 8, 10, 12, 15, 20, 25] : [1, 2, 3, 4, 5, 6, 7, 8, 10];
const RS = WIDE ? [0.82, 0.85, 0.88, 0.9, 0.92] : [0.9, 0.92, 0.94, 0.96, 0.98];
const REGIMES = (WIDE ? ["none"] : ["none", "pause", "widen"]) as GridParams["regime"][];
const VOLS = (WIDE ? ["off"] : ["off", "on"]) as GridParams["vol"][];

interface Row { p: GridParams; full: SimResult; recent: SimResult }

const pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
const label = (p: GridParams) =>
  `s=${p.spacing.toFixed(2)} sell=${String(p.sell).padStart(2)} R=${p.R} ${p.regime.padEnd(5)} vol=${p.vol.padEnd(3)}`;

function table(title: string, rows: Row[]) {
  console.log(`\n${title}`);
  console.log("─".repeat(108));
  console.log("  " + "Config".padEnd(52) + "Return".padEnd(10) + "MaxDD".padEnd(9) + "Ret/DD".padEnd(9) + "Trips".padEnd(8) + "Recent½");
  for (const { p, full, recent } of rows) {
    console.log(
      "  " + label(p).padEnd(52) +
      pct(full.totalReturnPct).padEnd(10) +
      `${full.maxDDPct.toFixed(1)}%`.padEnd(9) +
      riskAdj(full).toFixed(2).padEnd(9) +
      String(Math.min(full.buys, full.sells)).padEnd(8) +
      pct(recent.totalReturnPct),
    );
  }
}

async function main() {
  const cfg = await getSettings(ACCOUNT);
  const [bars, tqqqD, qqqD] = await Promise.all([
    intradayBars(INTERVAL, DAYS, RANGE), dailyCloses("TQQQ", DAYS, RANGE), dailyCloses("QQQ", DAYS, RANGE),
  ]);
  if (bars.length === 0) { console.error("No intraday bars returned."); return; }
  const stats = buildDailyStats(tqqqD, qqqD);
  const priorDay = statByPriorDay(stats);
  const recentBars = bars.slice(Math.floor(bars.length / 2)); // most recent half, overfit check

  const total = SPACINGS.length * SELLS.length * RS.length * REGIMES.length * VOLS.length;
  console.log(`\nAccount ${cfg.accountNumber} · cash $${cfg.startingCash.toLocaleString()} · base sell ${cfg.sellPct}% · base R ${cfg.R}`);
  const windowLabel = RANGE ? `${RANGE.from}→${RANGE.to}` : `${DAYS}d`;
  console.log(`Window: ${INTERVAL} bars / ${windowLabel} (${bars.length} bars, recent½ = ${recentBars.length}) · sweeping ${total.toLocaleString()} configs\n`);

  const t0 = Date.now();
  const rows: Row[] = [];
  for (const spacing of SPACINGS)
    for (const sell of SELLS)
      for (const R of RS)
        for (const regime of REGIMES)
          for (const vol of VOLS) {
            const p: GridParams = { spacing, sell, R, regime, vol };
            rows.push({ p, full: runConfig(bars, cfg.startingCash, p, priorDay), recent: runConfig(recentBars, cfg.startingCash, p, priorDay) });
          }

  // Baselines
  const bhShares = cfg.startingCash / bars[0].open;
  const bhRet = ((bhShares * bars[bars.length - 1].close) / cfg.startingCash - 1) * 100;
  const bhRecent = ((cfg.startingCash / recentBars[0].open * recentBars[recentBars.length - 1].close) / cfg.startingCash - 1) * 100;
  const liveP: GridParams = { spacing: 1, sell: cfg.sellPct, R: cfg.R, regime: "none", vol: "off" };
  const live: Row = { p: liveP, full: runConfig(bars, cfg.startingCash, liveP, priorDay), recent: runConfig(recentBars, cfg.startingCash, liveP, priorDay) };

  const byReturn = [...rows].sort((a, b) => b.full.totalReturnPct - a.full.totalReturnPct);
  // Risk-adjusted, but only configs that actually traded and beat buy&hold's drawdown profile.
  const byRiskAdj = [...rows]
    .filter((r) => Math.min(r.full.buys, r.full.sells) >= 5)
    .sort((a, b) => riskAdj(b.full) - riskAdj(a.full));

  console.log(`Swept ${rows.length.toLocaleString()} configs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  table("BASELINES", [
    { p: liveP, full: live.full, recent: live.recent },
  ]);
  console.log("  " + "Buy & Hold".padEnd(52) + pct(bhRet).padEnd(10) + "—".padEnd(9) + "—".padEnd(9) + "—".padEnd(8) + pct(bhRecent));

  table(`TOP ${TOP} BY RETURN`, byReturn.slice(0, TOP));
  table(`TOP ${TOP} BY RISK-ADJUSTED RETURN (return ÷ maxDD, ≥5 round-trips)`, byRiskAdj.slice(0, TOP));

  // Recommendation: best risk-adjusted config whose recent-half return is also positive (robustness),
  // breaking ties toward higher raw return.
  const robust = byRiskAdj
    .filter((r) => r.recent.totalReturnPct > 0 && r.full.totalReturnPct > bhRet)
    .sort((a, b) => riskAdj(b.full) - riskAdj(a.full) || b.full.totalReturnPct - a.full.totalReturnPct);
  const best = robust[0] ?? byReturn[0];
  console.log("\n" + "═".repeat(108));
  console.log("RECOMMENDATION (best risk-adjusted config that also beats buy&hold and stays positive on the recent half):");
  console.log("  " + label(best.p));
  console.log(`  full window: ${pct(best.full.totalReturnPct)} · maxDD ${best.full.maxDDPct.toFixed(1)}% · ret/DD ${riskAdj(best.full).toFixed(2)} · ${Math.min(best.full.buys, best.full.sells)} round-trips`);
  console.log(`  recent half: ${pct(best.recent.totalReturnPct)} · maxDD ${best.recent.maxDDPct.toFixed(1)}%`);
  console.log(`  vs buy&hold ${pct(bhRet)} · vs live config ${pct(live.full.totalReturnPct)}`);
  console.log("═".repeat(108) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });

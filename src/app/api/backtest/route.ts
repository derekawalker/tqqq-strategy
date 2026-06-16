/**
 * POST /api/backtest — run up to two grid configs over one market window and return their metrics
 * plus normalized equity curves for side-by-side charting, alongside the live config and buy & hold.
 *
 * The slow part is the Yahoo pull; it's cached per-window so the two scenarios (and re-runs as the
 * user tweaks knobs) reuse one fetch. Daily bars are used for historical ranges (intraday history is
 * only ~60 days); recent windows use intraday bars.
 */
import { intradayBars, dailyCloses, type Interval, type DateRange } from "@/lib/marketData";
import { buildDailyStats, statByPriorDay, runConfig, riskAdj, effectiveSpacingSell, type Bar, type DailyStat, type GridParams, type Trade } from "@/lib/backtest";
import { getCached, setCached } from "@/lib/ttlCache";

const CACHE_TTL_MS = 5 * 60_000;
const CHART_POINTS = 160; // downsample target for the equity curves

interface WindowSpec { interval: Interval; days: number; range?: DateRange }
interface ReqBody {
  startingCash: number;
  sellPct: number; // live config sell %
  R: number;       // live config reduction factor
  window: WindowSpec;
  scenarios: { name: string; params: GridParams }[];
}

interface ScenarioOut {
  name: string; params?: GridParams;
  // Realized [min, max] of the spacing % and sell % actually in effect across the window (they vary
  // day-to-day when vol-adaptive is on or widen fires). Equal min/max ⇒ it never changed.
  spacingRange?: [number, number]; sellRange?: [number, number];
  totalReturnPct: number; maxDDPct: number; retDD: number; roundTrips: number; realized: number; resets: number;
}

async function loadWindow(w: WindowSpec): Promise<{ bars: Bar[]; stats: DailyStat[] } | null> {
  const key = `bt:${w.interval}:${w.days}:${w.range?.from ?? ""}:${w.range?.to ?? ""}`;
  const cached = getCached<{ bars: Bar[]; stats: DailyStat[] }>(key, CACHE_TTL_MS);
  if (cached) return cached;
  const [bars, tqqqD, qqqD] = await Promise.all([
    intradayBars(w.interval, w.days, w.range),
    dailyCloses("TQQQ", w.days, w.range),
    dailyCloses("QQQ", w.days, w.range),
  ]);
  if (bars.length === 0) return null;
  const data = { bars, stats: buildDailyStats(tqqqD, qqqD) };
  setCached(key, data);
  return data;
}

interface DayDetail { buys: number; sells: number; net: number; trades: Trade[] }
/** Bucket a scenario's trades by calendar day: buy/sell counts, net shares, and the fills themselves. */
function tradesByDay(trades: Trade[]): Map<string, DayDetail> {
  const m = new Map<string, DayDetail>();
  for (const t of trades) {
    const d = t.date.slice(0, 10);
    const e = m.get(d) ?? { buys: 0, sells: 0, net: 0, trades: [] };
    if (t.side === "BUY") { e.buys++; e.net += t.shares; } else { e.sells++; e.net -= t.shares; }
    e.trades.push(t);
    m.set(d, e);
  }
  return m;
}

/** Pick ~CHART_POINTS evenly-spaced indices, always including the last bar. */
function sampleIndices(n: number): number[] {
  if (n <= CHART_POINTS) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (CHART_POINTS - 1);
  const idx = Array.from({ length: CHART_POINTS }, (_, i) => Math.round(i * step));
  idx[idx.length - 1] = n - 1;
  return [...new Set(idx)];
}

export async function POST(req: Request) {
  let body: ReqBody;
  try { body = (await req.json()) as ReqBody; }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { startingCash, sellPct, R, window, scenarios } = body;
  if (!startingCash || !window || !Array.isArray(scenarios)) {
    return Response.json({ error: "Missing startingCash, window, or scenarios" }, { status: 400 });
  }

  let loaded: { bars: Bar[]; stats: DailyStat[] } | null;
  try { loaded = await loadWindow(window); }
  catch (err) { return Response.json({ error: err instanceof Error ? err.message : "fetch failed" }, { status: 502 }); }
  if (!loaded) return Response.json({ error: "No bars returned for that window" }, { status: 404 });

  const { bars, stats } = loaded;
  const priorDay = statByPriorDay(stats);
  const intraday = window.interval !== "1d";
  const fmtLabel = (iso: string) => {
    const d = new Date(iso);
    const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    return intraday ? `${md} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : md;
  };

  // Live config + buy & hold as fixed reference series.
  const liveP: GridParams = { spacing: 1, sell: sellPct, R, regime: "none", vol: "off" };
  // Only the two user scenarios (not Live/B&H) record per-trade detail for the day-by-day comparison.
  const runners: { name: string; params: GridParams; logTrades: boolean }[] = [
    ...scenarios.slice(0, 2).map((s, i) => ({ name: s.name || `Scenario ${String.fromCharCode(65 + i)}`, params: s.params, logTrades: true })),
    { name: "Live config", params: liveP, logTrades: false },
  ];

  // Distinct prior-day stats used across the window — drives the realized spacing/sell ranges below.
  const dayStats = [...new Set(bars.map((b) => b.date.toISOString().slice(0, 10)))].map(priorDay);
  const rangeFor = (p: GridParams): Pick<ScenarioOut, "spacingRange" | "sellRange"> => {
    let smin = Infinity, smax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (const st of dayStats) {
      const { spacing, sell } = effectiveSpacingSell(p, st);
      smin = Math.min(smin, spacing); smax = Math.max(smax, spacing);
      vmin = Math.min(vmin, sell); vmax = Math.max(vmax, sell);
    }
    return { spacingRange: [+smin.toFixed(2), +smax.toFixed(2)], sellRange: [+vmin.toFixed(2), +vmax.toFixed(2)] };
  };

  const series: Record<string, number[]> = {};
  const results: ScenarioOut[] = [];
  const tradesByName: Record<string, Trade[]> = {};
  for (const r of runners) {
    const sim = runConfig(bars, startingCash, r.params, priorDay, true, r.logTrades);
    results.push({
      name: r.name, params: r.params, ...rangeFor(r.params),
      totalReturnPct: sim.totalReturnPct, maxDDPct: sim.maxDDPct, retDD: riskAdj(sim),
      roundTrips: Math.min(sim.buys, sim.sells), realized: sim.realized, resets: sim.resets,
    });
    series[r.name] = (sim.equityCurve ?? []).map((p) => (p.equity / startingCash - 1) * 100);
    if (r.logTrades) tradesByName[r.name] = sim.trades ?? [];
  }

  // Buy & hold.
  const bhShares = startingCash / bars[0].open;
  series["Buy & Hold"] = bars.map((b) => ((bhShares * b.close) / startingCash - 1) * 100);
  const bhRet = series["Buy & Hold"][bars.length - 1];
  let bhPeak = -Infinity, bhDD = 0;
  for (const b of bars) { const eq = bhShares * b.close; bhPeak = Math.max(bhPeak, eq); bhDD = Math.max(bhDD, (bhPeak - eq) / bhPeak); }
  results.push({ name: "Buy & Hold", totalReturnPct: bhRet, maxDDPct: bhDD * 100, retDD: bhRet / Math.max(bhDD * 100, 1), roundTrips: 0, realized: 0, resets: 0 });

  // Merge curves into one downsampled chart array keyed by time label.
  const idx = sampleIndices(bars.length);
  const chart = idx.map((i) => {
    const row: Record<string, string | number> = { label: fmtLabel(bars[i].date.toISOString()) };
    for (const name of Object.keys(series)) row[name] = +series[name][i].toFixed(2);
    return row;
  });

  // Per-day trade comparison for the two scenarios; flag days where their activity differs.
  const [nameA, nameB] = runners.slice(0, 2).map((r) => r.name);
  const dayA = tradesByDay(tradesByName[nameA] ?? []);
  const dayB = tradesByDay(tradesByName[nameB] ?? []);
  const allDays = [...new Set([...dayA.keys(), ...dayB.keys()])].sort();
  const zero: DayDetail = { buys: 0, sells: 0, net: 0, trades: [] };
  const tradeDays = allDays.map((date) => {
    const a = dayA.get(date) ?? zero;
    const b = dayB.get(date) ?? zero;
    const diff = a.buys !== b.buys || a.sells !== b.sells || a.net !== b.net;
    return { date, a, b, diff };
  });
  const diffDays = tradeDays.filter((d) => d.diff).length;

  const riskOffDays = stats.filter((s) => s.regime === "risk-off").length;
  return Response.json({
    meta: {
      bars: bars.length, interval: window.interval,
      tqqqStart: +bars[0].open.toFixed(2), tqqqEnd: +bars[bars.length - 1].close.toFixed(2),
      riskOffDays, totalDays: stats.length,
    },
    results,
    chart,
    seriesNames: Object.keys(series),
    trades: { names: [nameA, nameB], days: tradeDays, diffDays },
  });
}

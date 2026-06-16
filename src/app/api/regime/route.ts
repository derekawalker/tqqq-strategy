import YahooFinance from "yahoo-finance2";
import { annualizedVol, sma, rollingSma, rollingVol, computeRegime, scaleByVol, type Regime } from "@/lib/adaptiveLevels";
import { getCached, setCached } from "@/lib/ttlCache";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface RegimePricePoint { date: string; price: number; sma200: number }
export interface VolPoint { date: string; vol: number }

export interface RegimeData {
  regime: Regime;
  qqqPrice: number;
  sma200: number;
  pctVsSma: number;
  realizedVol: number;   // current 20-day annualized TQQQ vol (%)
  baselineVol: number;   // trailing ~1y annualized TQQQ vol (%)
  suggestedSpacing: number; // %
  suggestedSell: number;    // %
  qqqSeries: RegimePricePoint[]; // QQQ close + 200-DMA, recent window
  volSeries: VolPoint[];         // TQQQ 20-day annualized vol, recent window
}

// The base spacing the static 1% ladder uses; suggestions scale around it.
const BASE_SPACING = 1;
const SPACING_MIN = 0.5;
const SPACING_MAX = 3;
const SERIES_DAYS = 130; // trading days of history to chart
const CACHE_TTL_MS = 5 * 60_000; // regime/vol move slowly; one Yahoo pull per 5 min is plenty

const mdLabel = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

export async function GET(req: Request) {
  // Base sell% comes from the caller's settings so the suggestion scales around their own target.
  const baseSell = Number(new URL(req.url).searchParams.get("baseSell")) || 5;

  if (process.env.DEMO_MODE === "true") {
    const qqqSeries: RegimePricePoint[] = Array.from({ length: 40 }, (_, i) => ({
      date: `D${i + 1}`,
      price: 500 + i * 1.1 + Math.sin(i / 3) * 8,
      sma200: 498 + i * 0.9,
    }));
    const volSeries: VolPoint[] = Array.from({ length: 40 }, (_, i) => ({
      date: `D${i + 1}`,
      vol: 50 + Math.sin(i / 4) * 10,
    }));
    return Response.json({
      regime: "risk-on", qqqPrice: 540, sma200: 505, pctVsSma: 6.9,
      realizedVol: 48, baselineVol: 55, suggestedSpacing: BASE_SPACING, suggestedSell: baseSell,
      qqqSeries, volSeries,
    } satisfies RegimeData);
  }

  const cacheKey = `regime:${baseSell}`;
  const cached = getCached<RegimeData>(cacheKey, CACHE_TTL_MS);
  if (cached) return Response.json(cached);

  try {
    const period1 = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const [qqq, tqqq] = await Promise.all([
      yf.chart("QQQ", { period1, interval: "1d" }),
      yf.chart("TQQQ", { period1, interval: "1d" }),
    ]);

    const qqqDated = (qqq.quotes ?? [])
      .filter((q) => q.close != null && q.date != null)
      .map((q) => ({ date: q.date as Date, close: q.close as number }));
    const tqqqDated = (tqqq.quotes ?? [])
      .filter((q) => q.close != null && q.date != null)
      .map((q) => ({ date: q.date as Date, close: q.close as number }));

    const qqqCloses = qqqDated.map((d) => d.close);
    const tqqqCloses = tqqqDated.map((d) => d.close);

    const qqqPrice = qqqCloses.at(-1) ?? 0;
    const sma200 = sma(qqqCloses, 200);
    const regime = computeRegime(qqqPrice, sma200);
    const pctVsSma = sma200 > 0 ? ((qqqPrice - sma200) / sma200) * 100 : 0;

    const realizedVol = annualizedVol(tqqqCloses, 20);
    // Baseline = trailing ~1y vol, so "high vol" is measured against this account's own normal.
    const baselineVol = annualizedVol(tqqqCloses, Math.min(252, tqqqCloses.length - 1));

    const volSpacing = scaleByVol(BASE_SPACING, realizedVol, baselineVol, SPACING_MIN, SPACING_MAX);
    // In risk-on, a vol spike should not push rungs further apart — that causes missed buys as
    // price surges. Cap at base spacing so vol can only tighten the grid during a rally.
    // In risk-off, widen to at least 2% to deploy more slowly into a drawdown.
    const spacingAfterVol = regime === "risk-on" ? Math.min(volSpacing, BASE_SPACING) : volSpacing;
    const suggestedSpacing = regime === "risk-off" ? Math.max(2, spacingAfterVol) : spacingAfterVol;
    const suggestedSell = scaleByVol(baseSell, realizedVol, baselineVol, baseSell * 0.5, baseSell * 2);

    // Chart series: align the rolling 200-DMA / 20-day vol to dates, keep the recent window.
    const smaArr = rollingSma(qqqCloses, 200);
    const volArr = rollingVol(tqqqCloses, 20);
    const qqqStart = Math.max(0, qqqDated.length - SERIES_DAYS);
    const volStart = Math.max(0, tqqqDated.length - SERIES_DAYS);
    const qqqSeries: RegimePricePoint[] = qqqDated
      .slice(qqqStart)
      .map((d, k) => ({ date: mdLabel(d.date), price: d.close, sma200: smaArr[qqqStart + k] }))
      .filter((p): p is RegimePricePoint => p.sma200 != null);
    const volSeries: VolPoint[] = tqqqDated
      .slice(volStart)
      .map((d, k) => ({ date: mdLabel(d.date), vol: volArr[volStart + k] }))
      .filter((p): p is VolPoint => p.vol != null);

    const data: RegimeData = {
      regime, qqqPrice, sma200, pctVsSma, realizedVol, baselineVol, suggestedSpacing, suggestedSell,
      qqqSeries, volSeries,
    };
    setCached(cacheKey, data);
    return Response.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}

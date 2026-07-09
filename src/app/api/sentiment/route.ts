/**
 * TQQQ Regime Dashboard — data endpoint.
 *
 * Fetches QQQ, ^VIX and ^VIX3M daily bars from Yahoo Finance, scores the regime
 * model in @/lib/sentiment for every historical day, and returns:
 *   - the current regime + per-signal breakdown
 *   - how long the current regime has held (hysteresis-aware)
 *   - a 1-year history series (incl. the score line) for charting
 *   - a regime backtest: forward QQQ returns bucketed by regime
 *
 * All scoring lives in @/lib/sentiment so the page and server share one source
 * of truth for tiers, the score range, and thresholds.
 */

import { fetchYahooDaily } from "@/lib/yahoo";
import {
  computeSeries,
  backtestRegimes,
  daysInRegime,
  regimeAction,
  type SeriesInput,
} from "@/lib/sentiment";
import { getCached, setCached } from "@/lib/ttlCache";

const CACHE_KEY = "sentiment-data";
// Daily-bar data — a short server cache still keeps the page fresh while
// collapsing the bursts from the dashboard, working-orders, and sentiment
// pages each triggering their own 3-symbol Yahoo fetch.
const CACHE_TTL_MS = 10 * 60_000;

export async function GET(req: Request) {
  try {
    // ?fresh=1 (the page's Refresh button) forces a live pull.
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    if (!fresh) {
      const cached = getCached<Record<string, unknown>>(CACHE_KEY, CACHE_TTL_MS);
      if (cached) return Response.json(cached);
    }
    // ~6 years gives a meaningful backtest sample while staying a single fetch.
    const [qqqBars, vixBars, vix3mBars] = await Promise.all([
      fetchYahooDaily("QQQ", 6),
      fetchYahooDaily("^VIX", 6),
      fetchYahooDaily("^VIX3M", 6),
    ]);

    if (qqqBars.length < 210) {
      return Response.json({ error: "Not enough QQQ history" }, { status: 502 });
    }

    const dates = qqqBars.map((b) => b.date);
    const closes = qqqBars.map((b) => b.close);
    const vixByDate = new Map(vixBars.map((b) => [b.date, b.close]));
    const vix3mByDate = new Map(vix3mBars.map((b) => [b.date, b.close]));

    const input: SeriesInput = {
      dates,
      closes,
      vix: dates.map((d) => vixByDate.get(d) ?? null),
      vix3m: dates.map((d) => vix3mByDate.get(d) ?? null),
    };

    const series = computeSeries(input);
    const latest = series[series.length - 1];
    const backtest = backtestRegimes(series, 20);
    const heldDays = daysInRegime(series);

    // Trend structure label (price / 50 / 200 stacking).
    let trendLabel: "Bull" | "Caution" | "Bear";
    if (latest.sma200 != null && latest.sma50 != null) {
      if (latest.qqq >= latest.sma50 && latest.sma50 >= latest.sma200) trendLabel = "Bull";
      else if (latest.sma50 >= latest.sma200) trendLabel = "Caution";
      else trendLabel = "Bear";
    } else {
      trendLabel = "Caution";
    }

    // VIX trend label now reflects the 5-day *slope*, not the level.
    const vixTrend =
      latest.vixSlope == null
        ? "Stable"
        : latest.vixSlope > 1
          ? "Rising"
          : latest.vixSlope < -1
            ? "Falling"
            : "Stable";

    const m = latest.scores;
    const termLabel =
      latest.ratio == null
        ? "—"
        : latest.ratio < 0.9
          ? "Contango"
          : latest.ratio <= 1.0
            ? "Normal"
            : latest.ratio <= 1.05
              ? "Flattening"
              : "Backwardation";

    // 1-year chart series, including the regime score line.
    const history = series.slice(-252).map((d) => ({
      date: d.date,
      qqq: d.qqq,
      sma50: d.sma50,
      sma200: d.sma200,
      rsi: d.rsi,
      vix: d.vix,
      score: d.total,
      regime: d.regime,
    }));

    const payload = {
      asOf: latest.date,
      regime: latest.regime,
      score: latest.total,
      action: regimeAction(latest.regime),
      daysInRegime: heldDays,
      signals: {
        trend: {
          label: trendLabel,
          qqq: latest.qqq,
          sma50: latest.sma50,
          sma200: latest.sma200,
          vs50Score: m.vs50,
          vs200Score: m.vs200,
        },
        volatility: {
          vix: latest.vix,
          vixSlope: latest.vixSlope,
          score: m.vix,
          label: vixTrend,
        },
        momentum: {
          rsi: latest.rsi,
          return10d: latest.return10d,
          score: m.momentum,
          label: m.momentum > 0 ? "Healthy" : m.momentum === 0 ? "Neutral" : "Stressed",
        },
        stress: {
          drawdown20: latest.drawdown20,
          score: m.stress,
          label: m.stress >= 0 ? "Low" : m.stress === -1 ? "Caution" : "High",
        },
        slope: {
          sma200Slope: latest.sma200Slope,
          score: m.slope,
          label:
            m.slope > 0 ? "Rising" : m.slope === 0 ? "Flat" : m.slope === -1 ? "Slowing" : "Declining",
        },
        term: {
          ratio: latest.ratio,
          vix3m: latest.vix3m,
          score: m.term,
          label: termLabel,
        },
      },
      backtest,
      history,
    };
    setCached(CACHE_KEY, payload);
    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}

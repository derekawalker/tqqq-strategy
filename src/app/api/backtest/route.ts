import { getIntradayHistoryBack } from "@/lib/schwab/pricehistory";
import { getStoredSimBars } from "@/lib/polygon";
import { simulateLadder, type LadderParams } from "@/lib/ladderSim";
import { candlesToBars, buyHoldCurve, downsample, coveredSpan, dailyTable } from "@/lib/intradayBacktest";
import { fetchYahooDaily, yahooByDate, type YahooBar } from "@/lib/yahoo";
import {
  sma,
  maHysteresisThrottle,
  vixHysteresisThrottle,
  combineThrottles,
} from "@/lib/strategySignals";
import { computeSeries, regimeSellTargetPct, type SeriesInput } from "@/lib/sentiment";
import type { SimBar } from "@/lib/intradayBacktest";

// ---------------------------------------------------------------------------
// Timeframe config
// ---------------------------------------------------------------------------

type Timeframe = "intraday" | "1y" | "3y" | "5y" | "10y" | "max";

const DAILY_RANGE: Record<Exclude<Timeframe, "intraday">, number | "max"> = {
  "1y":  1,
  "3y":  3,
  "5y":  5,
  "10y": 10,
  "max": "max",
};

function yahooToSimBars(bars: YahooBar[]): SimBar[] {
  return bars.map((b) => ({ date: b.date, close: b.close, high: b.high, low: b.low }));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScenarioParams {
  label?: string;
  startingCash: number;
  sellPct: number;
  reductionFactor: number;
  stepPct?: number;
  levels?: number;
  reanchorPct?: number;
  slippageBps?: number;
  maGateEnabled?: boolean;
  maStopPeriod?: number;
  maResumePeriod?: number;
  vixGateEnabled?: boolean;
  vixStop?: number;
  vixResume?: number;
  balanceGateEnabled?: boolean;
  balanceGatePct?: number;
  balanceResumeReboundPct?: number;
  reserveEnabled?: boolean;
  reservePct?: number;
  tranche1Pct?: number;
  tranche2Pct?: number;
  // Regime-dependent sell target: sellPct (Risk-On) / regimeOtherSellPct
  // (Neutral or Risk-Off) per lot, based on the sentiment model's regime on
  // the day the lot was bought — see sentiment.ts's regimeSellTargetPct.
  regimeSellTargetEnabled?: boolean;
  regimeOtherSellPct?: number;
  // Core-and-ladder split: this fraction (0-100) of startingCash is bought
  // once at the anchor and held for good; the ladder runs on the remainder.
  corePct?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPct(curve: { date: string; value: number }[]): { date: string; value: number }[] {
  if (curve.length === 0) return [];
  const start = curve[0].value;
  if (start === 0) return curve;
  return curve.map((p) => ({ date: p.date, value: (p.value / start) * 100 }));
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawScenarios: ScenarioParams[] = Array.isArray(body.scenarios)
      ? body.scenarios.slice(0, 3)
      : [body];
    const timeframe: Timeframe = body.timeframe ?? "intraday";

    if (rawScenarios.length === 0) {
      return Response.json({ error: "At least one scenario is required" }, { status: 400 });
    }
    for (const s of rawScenarios) {
      if (!(Number(s.startingCash) > 0) || !(Number(s.sellPct) > 0) || !(Number(s.reductionFactor) > 0)) {
        return Response.json(
          { error: "Each scenario needs positive startingCash, sellPct, and reductionFactor" },
          { status: 400 },
        );
      }
    }

    const startDate: string | undefined = body.startDate;
    const endDate: string | undefined = body.endDate;

    // Shared MA lookup for the price chart overlay lines.
    const maByDate = new Map<string, { sma50: number | null; sma200: number | null }>();
    function buildMaByDate(sourceBars: SimBar[]) {
      const closes = sourceBars.map((b) => b.close);
      const s50 = sma(closes, 50);
      const s200 = sma(closes, 200);
      sourceBars.forEach((b, i) => {
        maByDate.set(b.date.slice(0, 10), { sma50: s50[i], sma200: s200[i] });
      });
    }

    // ------------------------------------------------------------------
    // Fetch bars
    // ------------------------------------------------------------------
    let allBars: SimBar[];
    let maBars: SimBar[]; // extended history for MA signal warm-up
    let barFreq: string;

    if (timeframe === "intraday") {
      let intradayBars = await getStoredSimBars().catch(() => []);
      let source = "polygon";
      if (intradayBars.length === 0) {
        const candles = await getIntradayHistoryBack("TQQQ", 5);
        intradayBars = candlesToBars(candles);
        source = "schwab";
      }
      if (intradayBars.length === 0) {
        return Response.json(
          { error: "No intraday bar data available. Sync Polygon data or connect to Schwab." },
          { status: 502 },
        );
      }
      allBars = intradayBars;
      barFreq = `5-min (${source})`;
      // Use daily bars for MA computation so 50/200 MA lines are daily, not 5-min.
      const dailyForMa = await fetchYahooDaily("TQQQ", 3).catch(() => []);
      maBars = dailyForMa.length > 0 ? yahooToSimBars(dailyForMa) : allBars;
      buildMaByDate(maBars);
    } else {
      const range = DAILY_RANGE[timeframe];
      const maFetchRange: number | "max" = range === "max" ? "max" : (range as number) + 1;
      const [yahooTqqq, yahooMaExtra] = await Promise.all([
        fetchYahooDaily("TQQQ", range),
        maFetchRange !== range ? fetchYahooDaily("TQQQ", maFetchRange).catch(() => null) : Promise.resolve(null),
      ]);
      if (yahooTqqq.length === 0) {
        return Response.json(
          { error: "No TQQQ daily bar data returned from Yahoo Finance." },
          { status: 502 },
        );
      }
      allBars = yahooToSimBars(yahooTqqq);
      maBars = yahooMaExtra ? yahooToSimBars(yahooMaExtra) : allBars;
      barFreq = "daily (Yahoo Finance)";
      buildMaByDate(maBars);
    }

    let bars = allBars;
    if (startDate) bars = bars.filter((b) => b.date.slice(0, 10) >= startDate);
    if (endDate)   bars = bars.filter((b) => b.date.slice(0, 10) <= endDate);
    if (bars.length === 0) {
      return Response.json({ error: "No bars in the selected date range." }, { status: 400 });
    }

    const span = { ...coveredSpan(bars), barFreq };

    // ------------------------------------------------------------------
    // External VIX data (only fetched when at least one scenario needs it)
    // ------------------------------------------------------------------
    const needsRegime = rawScenarios.some((s) => s.regimeSellTargetEnabled);
    const needsVix = rawScenarios.some((s) => s.vixGateEnabled) || needsRegime;
    const externalRange: number | "max" = timeframe === "intraday" ? 3 : DAILY_RANGE[timeframe];
    const vixBars = needsVix
      ? await fetchYahooDaily("^VIX", externalRange).catch(() => [])
      : [];
    const vixByDate = yahooByDate(vixBars);

    // ------------------------------------------------------------------
    // Regime series (only computed when at least one scenario needs it) —
    // scored off QQQ + ^VIX + ^VIX3M, same model as the Sentiment page.
    // Extended range (+1y) gives the 200-day SMA time to warm up.
    // ------------------------------------------------------------------
    const regimeByDate = new Map<string, ReturnType<typeof computeSeries>[number]["regime"]>();
    if (needsRegime) {
      const regimeRange: number | "max" =
        timeframe === "intraday" ? 3 : DAILY_RANGE[timeframe] === "max" ? "max" : (DAILY_RANGE[timeframe] as number) + 1;
      const [qqqBars, vix3mBars] = await Promise.all([
        fetchYahooDaily("QQQ", regimeRange).catch(() => []),
        fetchYahooDaily("^VIX3M", regimeRange).catch(() => []),
      ]);
      if (qqqBars.length > 0) {
        const vix3mByDate = yahooByDate(vix3mBars);
        const input: SeriesInput = {
          dates: qqqBars.map((b) => b.date),
          closes: qqqBars.map((b) => b.close),
          vix: qqqBars.map((b) => vixByDate.get(b.date) ?? null),
          vix3m: qqqBars.map((b) => vix3mByDate.get(b.date) ?? null),
        };
        for (const day of computeSeries(input)) regimeByDate.set(day.date.slice(0, 10), day.regime);
      }
    }

    // ------------------------------------------------------------------
    // Run each scenario
    // ------------------------------------------------------------------
    const scenarios = rawScenarios.map((s, i) => {
      const label = s.label?.trim() || String.fromCharCode(65 + i);

      const throttles: number[][] = [];

      if (s.maGateEnabled) {
        // Compute on maBars for warm-up, then project onto bars by date.
        const full = maHysteresisThrottle(maBars, s.maStopPeriod ?? 200, s.maResumePeriod ?? 200);
        const byDate = new Map<string, number>();
        maBars.forEach((b, idx) => byDate.set(b.date.slice(0, 10), full[idx]));
        throttles.push(bars.map((b) => byDate.get(b.date.slice(0, 10)) ?? 1));
      }
      if (s.vixGateEnabled) {
        throttles.push(vixHysteresisThrottle(bars, vixByDate, s.vixStop ?? 25, s.vixResume ?? 20));
      }

      const throttle = throttles.length > 0 ? combineThrottles(...throttles) : undefined;

      const params: LadderParams = {
        startingCash: Number(s.startingCash),
        stepPct: Number(s.stepPct) > 0 ? Number(s.stepPct) : 1,
        sellPct: Number(s.sellPct),
        reductionFactor: Number(s.reductionFactor),
        reanchorPct: Number(s.reanchorPct) > 0 ? Number(s.reanchorPct) / 100 : 0,
        levels: Number(s.levels) > 0 ? Math.round(Number(s.levels)) : 88,
        slippageBps: Number(s.slippageBps) > 0 ? Number(s.slippageBps) : 0,
        reservePct: 0,
        ...(s.balanceGateEnabled ? {
          balanceGatePct: s.balanceGatePct ?? 85,
          balanceResumeReboundPct: s.balanceResumeReboundPct ?? 5,
        } : {}),
        ...(s.reserveEnabled ? {
          reservePct: Number(s.reservePct) > 0 ? Number(s.reservePct) : 0,
          ...(Number(s.tranche1Pct) > 0 ? { tranche1Threshold: -Math.abs(Number(s.tranche1Pct)) } : {}),
          ...(Number(s.tranche2Pct) > 0 ? { tranche2Threshold: -Math.abs(Number(s.tranche2Pct)) } : {}),
        } : {}),
        ...(Number(s.corePct) > 0 ? { corePct: Math.min(100, Number(s.corePct)) } : {}),
      };

      const sellPctOverride = s.regimeSellTargetEnabled
        ? bars.map((b) =>
            regimeSellTargetPct(
              regimeByDate.get(b.date.slice(0, 10)) ?? "Risk-On",
              Number(s.sellPct),
              Number(s.regimeOtherSellPct) > 0 ? Number(s.regimeOtherSellPct) : 3,
            ),
          )
        : undefined;

      const result = simulateLadder(bars, params, throttle, sellPctOverride);

      // Visual-only signals for strategies that don't produce a throttle.
      const visualSignals: number[][] = [];
      if (result.balanceGatePaused) {
        visualSignals.push(result.balanceGatePaused.map((p) => p ? 0 : 1));
      }

      let signalCurve: { date: string; value: number }[] | undefined;
      if (throttle || visualSignals.length > 0) {
        const dailyMin = new Map<string, number>();
        bars.forEach((b, idx) => {
          const day = b.date.slice(0, 10);
          let t = throttle ? Math.max(0, Math.min(1, throttle[idx])) : 1;
          for (const sig of visualSignals) t = Math.min(t, Math.max(0, Math.min(1, sig[idx])));
          const existing = dailyMin.get(day);
          dailyMin.set(day, existing === undefined ? t : Math.min(existing, t));
        });
        signalCurve = downsample(bars.map((b) => ({
          date: b.date,
          value: dailyMin.get(b.date.slice(0, 10)) ?? 1,
        })));
      }

      return {
        label,
        stats: {
          finalValue: result.finalValue,
          totalReturn: result.totalReturn,
          maxDrawdown: result.maxDrawdown,
          realizedProfit: result.realizedProfit,
          buys: result.buys,
          sells: result.sells,
          peakInvested: result.peakInvested,
        },
        strategy: toPct(downsample(result.equity)),
        daily: dailyTable(result.equity),
        signalCurve,
        strategyLabels: [
          ...(s.maGateEnabled    ? [`MA gate: stop <${s.maStopPeriod ?? 200}d, resume >${s.maResumePeriod ?? 200}d`] : []),
          ...(s.vixGateEnabled   ? [`VIX gate: stop >${s.vixStop ?? 25}, resume <${s.vixResume ?? 20}`] : []),
          ...(s.balanceGateEnabled  ? [`Balance gate: stop <${s.balanceGatePct ?? 85}% of start, resume +${s.balanceResumeReboundPct ?? 5}%`] : []),
          ...(s.reserveEnabled && Number(s.reservePct) > 0 ? [`Reserve: hold ${s.reservePct}%, deploy at −${Math.abs(Number(s.tranche1Pct)) || "?"}% / −${Math.abs(Number(s.tranche2Pct)) || "?"}%`] : []),
          ...(s.regimeSellTargetEnabled ? [`Regime sell target: ${s.sellPct}% Risk-On / ${Number(s.regimeOtherSellPct) > 0 ? s.regimeOtherSellPct : 3}% Neutral-Risk-Off`] : []),
          ...(Number(s.corePct) > 0 ? [`Core-and-ladder: ${Math.min(100, Number(s.corePct))}% held permanently, ladder runs on the rest`] : []),
        ],
      };
    });

    const benchmarkCurve = buyHoldCurve(bars, Number(rawScenarios[0].startingCash));
    const benchmark = toPct(downsample(benchmarkCurve));

    const tqqqPrice = downsample(bars.map((b) => ({ date: b.date, value: b.close }))).map((p) => {
      const ma = maByDate.get(p.date.slice(0, 10));
      return { ...p, sma50: ma?.sma50 ?? null, sma200: ma?.sma200 ?? null };
    });

    return Response.json({ span, benchmark, tqqqPrice, scenarios });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const status = message.includes("Not authenticated") ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}

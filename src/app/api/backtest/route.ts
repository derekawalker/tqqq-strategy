import { getIntradayHistoryBack } from "@/lib/schwab/pricehistory";
import { getStoredSimBars } from "@/lib/polygon";
import { simulateLadder, type LadderParams } from "@/lib/ladderSim";
import { candlesToBars, buyHoldCurve, downsample, coveredSpan, dailyTable } from "@/lib/intradayBacktest";
import { fetchYahooDaily, yahooByDate, type YahooBar } from "@/lib/yahoo";
import {
  sma,
  maGateThrottle,
  vixGateThrottle,
  atrStepPcts,
  gcThrottle,
  combineThrottles,
  type DailyPrice,
} from "@/lib/strategySignals";
import type { SimBar } from "@/lib/intradayBacktest";

// ---------------------------------------------------------------------------
// Timeframe config
// ---------------------------------------------------------------------------

type Timeframe = "intraday" | "1y" | "3y" | "5y" | "10y" | "max";

/** Maps a non-intraday timeframe to a Yahoo Finance range parameter. */
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
  maEnabled?: boolean;
  maPeriod?: number;
  maSymbol?: "TQQQ" | "QQQ";
  vixEnabled?: boolean;
  vixFloor?: number;
  vixCeiling?: number;
  atrEnabled?: boolean;
  atrPeriod?: number;
  atrStepMin?: number;
  atrStepMax?: number;
  reserveEnabled?: boolean;
  reservePct?: number;
  tranche1Threshold?: number;
  tranche2Threshold?: number;
  gcEnabled?: boolean;
  gcFastPeriod?: number;
  gcSlowPeriod?: number;
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

    // Optional date-range filter applied after fetching.
    const startDate: string | undefined = body.startDate;
    const endDate: string | undefined = body.endDate;

    // Shared MA lookup built inside the intraday/daily branches below.
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
    // Fetch bars based on timeframe
    // ------------------------------------------------------------------
    let allBars: SimBar[]; // full history — used for MA computation
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
    } else {
      const range = DAILY_RANGE[timeframe];
      // Fetch 1 extra year beyond the display range so SMA200 has full warm-up at
      // the very first visible bar. Both responses are cached for 1 hr.
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
      barFreq = "daily (Yahoo Finance)";
      // Build maByDate from the extended bars if available, else from allBars.
      const maBars = yahooMaExtra ? yahooToSimBars(yahooMaExtra) : allBars;
      buildMaByDate(maBars);
    }

    // For intraday, maByDate is still empty — fill from allBars.
    if (maByDate.size === 0) buildMaByDate(allBars);

    // Slice to requested date range for the simulation.
    let bars = allBars;
    if (startDate) bars = bars.filter((b) => b.date.slice(0, 10) >= startDate);
    if (endDate)   bars = bars.filter((b) => b.date.slice(0, 10) <= endDate);

    if (bars.length === 0) {
      return Response.json({ error: "No bars in the selected date range." }, { status: 400 });
    }

    const span = { ...coveredSpan(bars), barFreq };

    // ------------------------------------------------------------------
    // External signal data (VIX, QQQ) — fetch enough history for any MA
    // ------------------------------------------------------------------
    const needsVix = rawScenarios.some((s) => s.vixEnabled);
    const needsQqq = rawScenarios.some((s) => s.maEnabled && s.maSymbol === "QQQ");

    // For daily timeframes, use the same range so dates align; for intraday,
    // 3 years of daily data is plenty for a 200-day MA warm-up.
    const externalRange: number | "max" = timeframe === "intraday"
      ? 3
      : DAILY_RANGE[timeframe];

    const [vixBars, qqqBars] = await Promise.all([
      needsVix ? fetchYahooDaily("^VIX", externalRange).catch(() => []) : Promise.resolve([]),
      needsQqq ? fetchYahooDaily("QQQ", externalRange).catch(() => []) : Promise.resolve([]),
    ]);
    const vixByDate = yahooByDate(vixBars);
    const qqqPrices: DailyPrice[] = qqqBars.map((b) => ({ date: b.date, close: b.close }));

    // ------------------------------------------------------------------
    // Run each scenario
    // ------------------------------------------------------------------
    const scenarios = rawScenarios.map((s, i) => {
      const label = s.label?.trim() || String.fromCharCode(65 + i);

      const throttles: number[][] = [];

      if (s.maEnabled) {
        const period = s.maPeriod ?? 200;
        const external = s.maSymbol === "QQQ" ? qqqPrices : undefined;
        throttles.push(maGateThrottle(bars, period, external));
      }
      if (s.vixEnabled) {
        throttles.push(vixGateThrottle(bars, vixByDate, s.vixFloor ?? 15, s.vixCeiling ?? 35));
      }
      if (s.gcEnabled) {
        throttles.push(gcThrottle(bars, s.gcFastPeriod ?? 50, s.gcSlowPeriod ?? 200));
      }

      const throttle = throttles.length > 0 ? combineThrottles(...throttles) : undefined;

      const stepPctByBar = s.atrEnabled
        ? atrStepPcts(bars, s.atrPeriod ?? 14, s.atrStepMin ?? 0.5, s.atrStepMax ?? 2.5)
        : undefined;

      const params: LadderParams = {
        startingCash: Number(s.startingCash),
        stepPct: 1,
        sellPct: Number(s.sellPct),
        reductionFactor: Number(s.reductionFactor),
        reanchorPct: 0,
        reservePct: s.reserveEnabled ? (s.reservePct ?? 30) : 0,
        tranche1Threshold: s.reserveEnabled ? (s.tranche1Threshold ?? -15) : undefined,
        tranche2Threshold: s.reserveEnabled ? (s.tranche2Threshold ?? -30) : undefined,
      };

      const result = simulateLadder(bars, params, throttle, stepPctByBar);

      // Build a per-day min-throttle curve for chart shading.
      // For intraday bars, multiple bars share a day — take the minimum throttle for the day.
      let signalCurve: { date: string; value: number }[] | undefined;
      if (throttle) {
        const dailyMin = new Map<string, number>();
        bars.forEach((b, idx) => {
          const day = b.date.slice(0, 10);
          const t = typeof throttle[idx] === "boolean"
            ? (throttle[idx] ? 0 : 1)
            : Math.max(0, Math.min(1, throttle[idx] as number));
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
      };
    });

    const benchmarkCurve = buyHoldCurve(bars, Number(rawScenarios[0].startingCash));
    const benchmark = toPct(downsample(benchmarkCurve));

    // TQQQ price curve with server-computed MAs (warm-up from full history).
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

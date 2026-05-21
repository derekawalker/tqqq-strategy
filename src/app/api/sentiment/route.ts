import YahooFinance from "yahoo-finance2";
import { FEATURE_NAMES, normalize, predictProb, predictMagnitude, volAdjustedPrediction } from "@/lib/mlModels";
import { computeFeaturesAt, alignSeries, featuresToArray } from "@/lib/features";
import {
  loadModelCoefficients,
  upsertDailyFeatures,
  backfillRealizedReturns,
  loadRecentPredictions,
  computePredictionAccuracy,
  type PredictionAccuracy,
  type DailyRow,
} from "@/lib/predictionHistory";
import { getUpcomingEvents, type MacroEvent } from "@/lib/macroCalendar";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

function nextWeekday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const RET_UP_THRESH = 0.15;
const RET_DOWN_THRESH = -0.15;

function toDir(predictedRet: number, qqq5dRet?: number | null): "up" | "down" | "flat" {
  let upThresh = RET_UP_THRESH;
  let downThresh = RET_DOWN_THRESH;

  // Momentum adjustment: strong trends override weak predictions
  if (qqq5dRet != null) {
    if (qqq5dRet > 3) {
      upThresh = -0.1;   // easier to call up on strong uptrend
      downThresh = -0.8; // harder to call down
    } else if (qqq5dRet < -3) {
      // After big down days, expect reversion (easier to call up)
      upThresh = 0.0;    // predict any positive return as up
      downThresh = 0.2;  // harder to call down (need strong signal)
    }
  }

  if (predictedRet > upThresh) return "up";
  if (predictedRet < downThresh) return "down";
  return "flat";
}

// ── types ──────────────────────────────────────────────────────────────────────

export interface FeatureReading {
  key: (typeof FEATURE_NAMES)[number];
  name: string;
  value: number | null;
  display: string;
  normalizedValue: number | null;
}

export interface PredictionPayload {
  cachedAt: number;
  lastTradingDate: string;
  predictionDate: string;        // the trading day this prediction is for
  direction: "up" | "down" | "flat";
  probUp: number;
  predictedRet: number;
  features: FeatureReading[];
  modelFittedAt: string | null;
  modelTrainN: number | null;
  modelDirectionAccuracy: number | null;
  modelMagnitudeMae: number | null;
  recentPrices: { date: string; close: number; predicted?: true }[];  // last 5 closes + projected next day
  recentHistory: DailyRow[];       // last 120 rows — for the verdict grid
  fullHistory: DailyRow[];          // all available rows — for verdict stats
  accuracy: PredictionAccuracy | null;
  upcomingEvents: MacroEvent[];
  noModel: boolean;   // true when model_coefficients not yet populated
}

const FEATURE_DISPLAY_NAMES: Record<string, string> = {
  qqq1dRet:       "QQQ 1d return",
  qqq3dRet:       "QQQ 3d return",
  qqq5dRet:       "QQQ 5d return",
  vixLevel:       "VIX level",
  vix1dChange:    "VIX 1d change",
  vixTerm:        "VIX / VIX3M",
  pctAbove200ma:  "QQQ vs 200d MA",
  realizedVol20d: "20d realized vol",
  tnxMom20d:      "10y yield 20d Δ",
  volRatio:       "Volume vs 20d avg",
  rsi14:          "RSI(14)",
  daysSinceHigh:  "Days since 20d high",
  hyIefMom20d:    "HY/IEF 20d Δ",
  moveLevel:      "MOVE (bond vol)",
};

// ── cache ──────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 20 * 60 * 1000;
let cached: PredictionPayload | null = null;
let cachedTime = 0;

// ── backfill ────────────────────────────────────────────────────────────────────

async function backfillMissingPredictions(
  dates: string[],
  qqqCloses: number[],
  qqqVolumes: number[],
  vixCloses: number[],
  vix3mCloses: number[],
  tnxCloses: number[],
  hygCloses: number[],
  iefCloses: number[],
  moveCloses: number[],
  model: Awaited<ReturnType<typeof loadModelCoefficients>>,
  lastIdx: number,
  rebuild = false, // when true, regenerate ALL predictions (use after formula changes)
) {
  if (!model) return;

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  let targetIdxs: number[];

  if (rebuild) {
    // Regenerate predictions for every available trading day.
    targetIdxs = [];
    for (let i = 0; i <= lastIdx; i++) targetIdxs.push(i);
  } else {
    // Default: fill gaps in the last 30 trading days only.
    const lookbackStart = Math.max(0, lastIdx - 60);
    const { data: existing } = await sb
      .from("daily_features")
      .select("date")
      .not("predicted_direction", "is", null)
      .gte("date", dates[lookbackStart])
      .order("date", { ascending: false });

    const existingDates = new Set(existing?.map((r) => r.date as string) ?? []);
    const startIdx = Math.max(0, lastIdx - 30);
    targetIdxs = [];
    for (let i = startIdx; i <= lastIdx; i++) {
      if (!existingDates.has(dates[i])) targetIdxs.push(i);
    }
  }

  if (targetIdxs.length === 0) return;

  // Inference helper
  const runInference = (features: ReturnType<typeof computeFeaturesAt>) => {
    if (!model || !features) return null;
    const rawVec = featuresToArray(features);
    const means = FEATURE_NAMES.map((n) => model.featureMeans[n]);
    const stdevs = FEATURE_NAMES.map((n) => model.featureStdevs[n]);
    const normVec = normalize(rawVec, means, stdevs);
    const probUp = Math.round(predictProb(normVec, model.logisticWeights) * 10000) / 10000;
    const rawOls = predictMagnitude(normVec, model.olsWeights);
    const predictedRet = Math.round(
      volAdjustedPrediction(rawOls, features.realizedVol20d, model.featureMeans["realizedVol20d"], model.magnitudePearson) * 10000,
    ) / 10000;
    return { probUp, predictedRet, direction: toDir(predictedRet) };
  };

  // Generate predictions for target indices
  for (const idx of targetIdxs) {
    const features = computeFeaturesAt(
      idx, qqqCloses, qqqVolumes, vixCloses, vix3mCloses, tnxCloses,
      hygCloses, iefCloses, moveCloses,
      dates[idx],
    );

    const inf = runInference(features);
    if (!inf) continue;

    await sb.from("daily_features").upsert({
      date: dates[idx],
      qqq_close: qqqCloses[idx],
      predicted_direction: inf.direction,
      predicted_prob_up: inf.probUp,
      predicted_1d_ret: inf.predictedRet,
      updated_at: new Date().toISOString(),
    }, { onConflict: "date" });
  }
}

// ── route ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const force = params.has("force");
    const rebuild = params.has("rebuild");
    if (!force && !rebuild && cached && Date.now() - cachedTime < CACHE_TTL_MS) {
      return Response.json(cached);
    }

    // 400 calendar days is enough for the 200-day MA on live predictions.
    // On rebuild, pull back far enough to cover the entire stored history
    // (~1600 calendar days = ~4 years of trading data).
    const lookbackDays = rebuild ? 1800 : 400;
    const period1 = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const [qqqR, vixR, vix3mR, tnxR, hygR, iefR, moveR] = await Promise.allSettled([
      yf.chart("QQQ",    { period1, interval: "1d" }),
      yf.chart("^VIX",   { period1, interval: "1d" }),
      yf.chart("^VIX3M", { period1, interval: "1d" }),
      yf.chart("^TNX",   { period1, interval: "1d" }),
      yf.chart("HYG",    { period1, interval: "1d" }),
      yf.chart("IEF",    { period1, interval: "1d" }),
      yf.chart("^MOVE",  { period1, interval: "1d" }),
    ]);

    const toSeries = (r: typeof vixR) =>
      r.status === "fulfilled"
        ? r.value.quotes
            .filter((q) => q.close != null && q.date != null)
            .map((q) => ({
              date: (q.date as Date).toISOString().slice(0, 10),
              close: q.close as number,
            }))
        : [];

    const qqq = qqqR.status === "fulfilled"
      ? qqqR.value.quotes
          .filter((q) => q.close != null && q.date != null && q.volume != null)
          .map((q) => ({
            date: (q.date as Date).toISOString().slice(0, 10),
            close: q.close as number,
            volume: q.volume as number,
          }))
      : [];
    const vix  = toSeries(vixR);
    const vix3m = toSeries(vix3mR);
    const tnx  = toSeries(tnxR);
    const hyg  = toSeries(hygR);
    const ief  = toSeries(iefR);
    const move = toSeries(moveR);

    const { dates, qqqCloses, qqqVolumes, vixCloses, vix3mCloses, tnxCloses, hygCloses, iefCloses, moveCloses } =
      alignSeries(qqq, vix, vix3m, tnx, hyg, ief, move);

    const lastIdx = dates.length - 1;
    const lastDate = dates[lastIdx];

    // Next trading day: use next date in series if available, else next weekday
    const predictionDate = dates[lastIdx + 1] ?? nextWeekday(lastDate);

    // Compute today's feature vector
    const rawFeatures = computeFeaturesAt(
      lastIdx, qqqCloses, qqqVolumes, vixCloses, vix3mCloses, tnxCloses,
      hygCloses, iefCloses, moveCloses,
      lastDate,
    );

    // Upcoming macro events
    const upcomingEvents = getUpcomingEvents(dates, lastDate, 5);

    // Load model
    const model = await loadModelCoefficients();

    // Build feature readings (for display even without a model)
    const featureReadings: FeatureReading[] = FEATURE_NAMES.map((key, i) => {
      const raw = rawFeatures ? featuresToArray(rawFeatures)[i] : null;
      let normalizedValue: number | null = null;

      if (raw != null && model) {
        normalizedValue = Math.round(
          ((raw - model.featureMeans[key]) / (model.featureStdevs[key] || 1)) * 1000,
        ) / 1000;
      }

      return {
        key,
        name: FEATURE_DISPLAY_NAMES[key] ?? key,
        value: raw,
        display: formatFeature(key, raw),
        normalizedValue,
      };
    });

    // Run inference helper
    function runInference(features: ReturnType<typeof computeFeaturesAt>) {
      if (!model || !features) return null;
      const rawVec = featuresToArray(features);
      const means = FEATURE_NAMES.map((n) => model.featureMeans[n]);
      const stdevs = FEATURE_NAMES.map((n) => model.featureStdevs[n]);
      const normVec = normalize(rawVec, means, stdevs);
      const probUp = Math.round(predictProb(normVec, model.logisticWeights) * 10000) / 10000;
      const rawOls = predictMagnitude(normVec, model.olsWeights);
      const predictedRet = Math.round(
        volAdjustedPrediction(rawOls, features.realizedVol20d, model.featureMeans["realizedVol20d"], model.magnitudePearson) * 10000,
      ) / 10000;
      return { probUp, predictedRet, direction: toDir(predictedRet, features.qqq5dRet) };
    }

    // Tomorrow's prediction (from lastIdx features)
    let direction: "up" | "down" | "flat" = "flat";
    let probUp = 0.5;
    let predictedRet = 0;
    const tomorrowInf = runInference(rawFeatures);
    if (tomorrowInf) ({ direction, probUp, predictedRet } = tomorrowInf);

    // Best-effort: snapshot today's features + prediction, backfill realized
    if (rawFeatures) {
      try {
        await upsertDailyFeatures([rawFeatures]);
        // Store prediction on today's row
        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        await sb.from("daily_features").upsert({
          date: lastDate,
          qqq_close: rawFeatures.qqqClose,
          predicted_direction: direction,
          predicted_prob_up: probUp,
          predicted_1d_ret: predictedRet,
          updated_at: new Date().toISOString(),
        }, { onConflict: "date" });
      } catch (e) {
        console.warn("[prediction] snapshot failed:", e instanceof Error ? e.message : e);
      }
      try {
        const qqqByDate = new Map(qqq.map((d) => [d.date, d.close]));
        await backfillRealizedReturns(qqqByDate);
      } catch (e) {
        console.warn("[prediction] backfill failed:", e instanceof Error ? e.message : e);
      }
    }

    // Backfill missing predictions before loading history.
    // With ?rebuild=1, regenerate every historical prediction (use this after
    // changing volAdjustedPrediction or other inference logic).
    try {
      await backfillMissingPredictions(
        dates, qqqCloses, qqqVolumes, vixCloses, vix3mCloses, tnxCloses,
        hygCloses, iefCloses, moveCloses,
        model, lastIdx, rebuild,
      );
    } catch (e) {
      console.warn("[prediction] backfill predictions failed:", e instanceof Error ? e.message : e);
    }

    // Load history + accuracy
    let recentHistory: DailyRow[] = [];
    let fullHistory: DailyRow[] = [];
    let accuracy: PredictionAccuracy | null = null;
    try {
      recentHistory = await loadRecentPredictions(120);
      fullHistory = await loadRecentPredictions(1200);
      accuracy = computePredictionAccuracy(recentHistory);
    } catch (e) {
      console.warn("[prediction] history load failed:", e instanceof Error ? e.message : e);
    }

    // Last 5 actual closes + projected next-day close.
    // Use the aligned series (dates/qqqCloses) so last5 can never include
    // predictionDate as an actual point — which would happen if Yahoo Finance
    // returns QQQ data for 5/18 before VIX/TNX data catches up.
    const last5Start = Math.max(0, lastIdx - 4);
    const last5 = dates
      .slice(last5Start, lastIdx + 1)
      .map((date, j) => ({ date, close: qqqCloses[last5Start + j] }));
    const lastClose = qqqCloses[lastIdx] ?? null;
    const projectedClose = lastClose != null
      ? Math.round(lastClose * (1 + predictedRet / 100) * 100) / 100
      : null;
    const recentPrices: PredictionPayload["recentPrices"] = [
      ...last5,
      ...(projectedClose != null ? [{ date: predictionDate, close: projectedClose, predicted: true as const }] : []),
    ];

    const payload: PredictionPayload = {
      cachedAt: Date.now(),
      lastTradingDate: lastDate,
      predictionDate,
      direction,
      probUp,
      predictedRet,
      features: featureReadings,
      modelFittedAt: model?.fittedAt ?? null,
      modelTrainN: model?.trainN ?? null,
      modelDirectionAccuracy: model?.directionAccuracy ?? null,
      modelMagnitudeMae: model?.magnitudeMae ?? null,
      recentPrices,
      recentHistory,
      fullHistory,
      accuracy,
      upcomingEvents,
      noModel: model == null,
    };

    cached = payload;
    cachedTime = Date.now();

    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

function formatFeature(key: string, value: number | null): string {
  if (value == null) return "—";
  const pct = (v: number, decimals = 2) =>
    `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
  switch (key) {
    case "qqq1dRet":
    case "qqq3dRet":
    case "qqq5dRet":
    case "vix1dChange":
    case "pctAbove200ma":
    case "realizedVol20d":
      return pct(value);
    case "vixLevel":
      return value.toFixed(1);
    case "vixTerm":
      return value.toFixed(3);
    case "tnxMom20d":
      return `${value >= 0 ? "+" : ""}${value.toFixed(2)}pp`;
    case "volRatio":
      return `${value.toFixed(2)}x`;
    case "rsi14":
      return value.toFixed(1);
    case "daysSinceHigh":
      return value.toFixed(0);
    case "hyIefMom20d":
      return pct(value);
    case "moveLevel":
      return value.toFixed(1);
    default:
      return value.toFixed(2);
  }
}

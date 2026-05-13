import YahooFinance from "yahoo-finance2";
import { FEATURE_NAMES, normalize, predictProb, predictMagnitude } from "@/lib/mlModels";
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

// Thresholds on probUp (P(next day QQQ > +0.5%)).
// Model's probUp distribution: median ~0.34, p80 ~0.42, p20 ~0.30.
// These asymmetric thresholds target ~20% up / ~15% down / ~65% flat.
const PROB_UP_THRESH = 0.42;
const PROB_DOWN_THRESH = 0.30;

function toDir(probUp: number): "up" | "down" | "flat" {
  if (probUp > PROB_UP_THRESH) return "up";
  if (probUp < PROB_DOWN_THRESH) return "down";
  return "flat";
}

// ── types ──────────────────────────────────────────────────────────────────────

export interface FeatureReading {
  key: (typeof FEATURE_NAMES)[number];
  name: string;
  value: number | null;
  display: string;
  normalizedValue: number | null;
  olsContribution: number | null;   // how much this feature pushes the magnitude prediction
}

export interface PredictionPayload {
  cachedAt: number;
  lastTradingDate: string;
  direction: "up" | "down" | "flat";
  probUp: number;
  predictedRet: number;
  features: FeatureReading[];
  modelFittedAt: string | null;
  modelTrainN: number | null;
  modelDirectionAccuracy: number | null;
  modelMagnitudeMae: number | null;
  modelMagnitudePearson: number | null;
  recentHistory: DailyRow[];
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
  skewLevel:      "CBOE SKEW",
};

// ── cache ──────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 20 * 60 * 1000;
let cached: PredictionPayload | null = null;
let cachedTime = 0;

// ── route ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.has("force");
    if (!force && cached && Date.now() - cachedTime < CACHE_TTL_MS) {
      return Response.json(cached);
    }

    // Need 400 calendar days for 200d MA computation
    const period1 = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

    const [qqqR, vixR, vix3mR, tnxR, skewR] = await Promise.allSettled([
      yf.chart("QQQ",    { period1, interval: "1d" }),
      yf.chart("^VIX",   { period1, interval: "1d" }),
      yf.chart("^VIX3M", { period1, interval: "1d" }),
      yf.chart("^TNX",   { period1, interval: "1d" }),
      yf.chart("^SKEW",  { period1, interval: "1d" }),
    ]);

    const toSeries = (r: typeof qqqR) =>
      r.status === "fulfilled"
        ? r.value.quotes
            .filter((q) => q.close != null && q.date != null)
            .map((q) => ({
              date: (q.date as Date).toISOString().slice(0, 10),
              close: q.close as number,
            }))
        : [];

    const qqq  = toSeries(qqqR);
    const vix  = toSeries(vixR);
    const vix3m = toSeries(vix3mR);
    const tnx  = toSeries(tnxR);
    const skew = toSeries(skewR);

    const { dates, qqqCloses, vixCloses, vix3mCloses, tnxCloses, skewByDate } =
      alignSeries(qqq, vix, vix3m, tnx, skew);

    const lastIdx = dates.length - 1;
    const lastDate = dates[lastIdx];

    // Compute today's feature vector
    const rawFeatures = computeFeaturesAt(
      lastIdx, qqqCloses, vixCloses, vix3mCloses, tnxCloses,
      skewByDate.get(lastDate) ?? null,
      lastDate,
    );

    // Upcoming macro events
    const upcomingEvents = getUpcomingEvents(dates, lastDate, 5);

    // Load model
    const model = await loadModelCoefficients();

    // Build feature readings (for display even without a model)
    const featureReadings: FeatureReading[] = FEATURE_NAMES.map((key, i) => {
      const raw = rawFeatures ? featuresToArray(rawFeatures, model?.featureMeans[key] ?? 135)[i] : null;
      let normalizedValue: number | null = null;
      let olsContribution: number | null = null;

      if (raw != null && model) {
        normalizedValue = Math.round(
          ((raw - model.featureMeans[key]) / (model.featureStdevs[key] || 1)) * 1000,
        ) / 1000;
        olsContribution = Math.round(
          normalizedValue * model.olsWeights[i + 1] * 1000,
        ) / 1000;
      }

      return {
        key,
        name: FEATURE_DISPLAY_NAMES[key] ?? key,
        value: raw,
        display: formatFeature(key, raw),
        normalizedValue,
        olsContribution,
      };
    });

    // Run inference
    let direction: "up" | "down" | "flat" = "flat";
    let probUp = 0.5;
    let predictedRet = 0;

    if (model && rawFeatures) {
      const skewFallback = model.featureMeans["skewLevel"] ?? 135;
      const rawVec = featuresToArray(rawFeatures, skewFallback);
      const means = FEATURE_NAMES.map((n) => model.featureMeans[n]);
      const stdevs = FEATURE_NAMES.map((n) => model.featureStdevs[n]);
      const normVec = normalize(rawVec, means, stdevs);

      probUp = Math.round(predictProb(normVec, model.logisticWeights) * 10000) / 10000;
      predictedRet = Math.round(predictMagnitude(normVec, model.olsWeights) * 10000) / 10000;
      direction = toDir(probUp);
    }

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

    // Load history + accuracy
    let recentHistory: DailyRow[] = [];
    let accuracy: PredictionAccuracy | null = null;
    try {
      recentHistory = await loadRecentPredictions(120);
      accuracy = computePredictionAccuracy(recentHistory);
    } catch (e) {
      console.warn("[prediction] history load failed:", e instanceof Error ? e.message : e);
    }

    const payload: PredictionPayload = {
      cachedAt: Date.now(),
      lastTradingDate: lastDate,
      direction,
      probUp,
      predictedRet,
      features: featureReadings,
      modelFittedAt: model?.fittedAt ?? null,
      modelTrainN: model?.trainN ?? null,
      modelDirectionAccuracy: model?.directionAccuracy ?? null,
      modelMagnitudeMae: model?.magnitudeMae ?? null,
      modelMagnitudePearson: model?.magnitudePearson ?? null,
      recentHistory,
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
    case "skewLevel":
      return value.toFixed(1);
    default:
      return value.toFixed(2);
  }
}

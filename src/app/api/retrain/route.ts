import YahooFinance from "yahoo-finance2";
import {
  FEATURE_NAMES,
  fitLogistic,
  fitOLS,
  computeNormParams,
  normalize,
  predictProb,
  predictMagnitude,
  computePearson,
  type ModelCoefficients,
} from "@/lib/mlModels";
import { computeFeaturesAt, alignSeries, featuresToArray } from "@/lib/features";
import {
  upsertDailyFeatures,
  backfillRealizedReturns,
  loadTrainingRows,
  saveModelCoefficients,
} from "@/lib/predictionHistory";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const RET_UP_THRESH = 0.5;
const RET_DOWN_THRESH = -0.5;

function toDir(predictedRet: number): "up" | "down" | "flat" {
  if (predictedRet > RET_UP_THRESH) return "up";
  if (predictedRet < RET_DOWN_THRESH) return "down";
  return "flat";
}

export async function POST() {
  try {
    // Fetch 400 calendar days — enough for 200d MA (≈280 trading days)
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

    if (qqq.length < 210) {
      return Response.json({ error: "Insufficient QQQ history" }, { status: 500 });
    }

    const { dates, qqqCloses, vixCloses, vix3mCloses, tnxCloses, skewByDate } =
      alignSeries(qqq, vix, vix3m, tnx, skew);

    // Build QQQ close map for backfill
    const qqqByDate = new Map(qqq.map((d) => [d.date, d.close]));

    // Compute feature rows for all aligned days and upsert to Supabase
    const featureRows = [];
    for (let i = 0; i < dates.length; i++) {
      const f = computeFeaturesAt(
        i, qqqCloses, vixCloses, vix3mCloses, tnxCloses,
        skewByDate.get(dates[i]) ?? null,
        dates[i],
      );
      if (f) featureRows.push(f);
    }

    // Upsert in batches to stay under payload limits
    const BATCH = 100;
    for (let i = 0; i < featureRows.length; i += BATCH) {
      await upsertDailyFeatures(featureRows.slice(i, i + BATCH));
    }

    // Backfill realized returns for rows that now have next-day data
    const backfilled = await backfillRealizedReturns(qqqByDate);

    // ── refit model ────────────────────────────────────────────────────────────

    const trainingRows = await loadTrainingRows();
    if (trainingRows.length < 50) {
      return Response.json(
        { error: `Not enough training data: only ${trainingRows.length} rows with realized returns` },
        { status: 422 },
      );
    }

    // Impute null skewLevel with column mean
    const skewValues = trainingRows
      .map((r) => r.skewLevel)
      .filter((v): v is number => v != null);
    const skewMean = skewValues.length > 0
      ? skewValues.reduce((s, v) => s + v, 0) / skewValues.length
      : 135;

    // Build raw feature matrix and targets
    const Xraw: number[][] = [];
    const yDir: number[] = [];    // binary: 1 = up
    const yMag: number[] = [];

    for (const row of trainingRows) {
      if (row.realized1dRet == null) continue;
      const feat: import("@/lib/features").RawFeatures = {
        date: row.date,
        qqqClose: row.qqqClose,
        qqq1dRet: row.qqq1dRet!,
        qqq3dRet: row.qqq3dRet!,
        qqq5dRet: row.qqq5dRet!,
        vixLevel: row.vixLevel!,
        vix1dChange: row.vix1dChange!,
        vixTerm: row.vixTerm!,
        pctAbove200ma: row.pctAbove200ma!,
        realizedVol20d: row.realizedVol20d!,
        tnxMom20d: row.tnxMom20d!,
        skewLevel: row.skewLevel,
      };
      Xraw.push(featuresToArray(feat, skewMean));
      yDir.push(row.realized1dRet > 0.5 ? 1 : 0);
      yMag.push(row.realized1dRet);
    }

    // Normalize
    const { means, stdevs } = computeNormParams(Xraw);
    const Xnorm = Xraw.map((row) => normalize(row, means, stdevs));

    // Fit models
    const logisticWeights = fitLogistic(Xnorm, yDir);
    const olsWeights = fitOLS(Xnorm, yMag);

    // Compute training metrics
    const yDirPred = Xnorm.map((x) => (predictProb(x, logisticWeights) > 0.5 ? 1 : 0));
    const correct = yDirPred.filter((p, i) => p === yDir[i]).length;
    const dirAcc = correct / yDir.length;

    const yMagPred = Xnorm.map((x) => predictMagnitude(x, olsWeights));
    const magErrs = yMagPred.map((p, i) => Math.abs(p - yMag[i]));
    const magnitudeMae = magErrs.reduce((s, e) => s + e, 0) / magErrs.length;
    const magnitudePearson = computePearson(yMagPred, yMag);

    const featureMeans = Object.fromEntries(
      FEATURE_NAMES.map((name, i) => [name, means[i]])
    ) as Record<(typeof FEATURE_NAMES)[number], number>;

    const featureStdevs = Object.fromEntries(
      FEATURE_NAMES.map((name, i) => [name, stdevs[i]])
    ) as Record<(typeof FEATURE_NAMES)[number], number>;

    const coef: ModelCoefficients = {
      fittedAt: new Date().toISOString(),
      trainN: trainingRows.length,
      featureNames: [...FEATURE_NAMES],
      featureMeans,
      featureStdevs,
      logisticWeights,
      olsWeights,
      directionAccuracy: Math.round(dirAcc * 10000) / 10000,
      magnitudeMae: Math.round(magnitudeMae * 1000) / 1000,
      magnitudePearson: Math.round(magnitudePearson * 10000) / 10000,
    };

    await saveModelCoefficients(coef);

    return Response.json({
      ok: true,
      trainN: coef.trainN,
      featureRowsUpserted: featureRows.length,
      backfilledReturns: backfilled,
      fittedAt: coef.fittedAt,
      directionAccuracy: coef.directionAccuracy,
      magnitudeMae: coef.magnitudeMae,
      magnitudePearson: coef.magnitudePearson,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[retrain]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

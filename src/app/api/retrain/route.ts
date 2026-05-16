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
  stdev,
  volAdjustedPrediction,
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

export async function POST() {
  try {
    // Fetch 5 years — covers all training rows so we can compute the new
    // features (vol_ratio, rsi_14, days_since_high) for the full history.
    const period1 = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000);

    const [qqqR, vixR, vix3mR, tnxR] = await Promise.allSettled([
      yf.chart("QQQ",    { period1, interval: "1d" }),
      yf.chart("^VIX",   { period1, interval: "1d" }),
      yf.chart("^VIX3M", { period1, interval: "1d" }),
      yf.chart("^TNX",   { period1, interval: "1d" }),
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

    if (qqq.length < 210) {
      return Response.json({ error: "Insufficient QQQ history" }, { status: 500 });
    }

    const { dates, qqqCloses, qqqVolumes, vixCloses, vix3mCloses, tnxCloses } =
      alignSeries(qqq, vix, vix3m, tnx);

    // Build QQQ close map for backfill
    const qqqByDate = new Map(qqq.map((d) => [d.date, d.close]));

    // Compute feature rows for all aligned days and upsert to Supabase
    const featureRows = [];
    for (let i = 0; i < dates.length; i++) {
      const f = computeFeaturesAt(
        i, qqqCloses, qqqVolumes, vixCloses, vix3mCloses, tnxCloses,
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

    // Build raw feature matrix and targets
    const Xraw: number[][] = [];
    const yDir: number[] = [];    // binary: 1 = up (>0.25%), 0 = down/flat (≤0.25%)
    const yMag: number[] = [];

    for (const row of trainingRows) {
      if (row.realized1dRet == null) continue;
      if (
        row.volRatio == null ||
        row.rsi14 == null ||
        row.daysSinceHigh == null
      ) {
        continue; // skip rows that haven't been backfilled with new features
      }
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
        volRatio: row.volRatio,
        rsi14: row.rsi14,
        daysSinceHigh: row.daysSinceHigh,
      };
      Xraw.push(featuresToArray(feat));
      yDir.push(row.realized1dRet > 0.25 ? 1 : 0);
      yMag.push(row.realized1dRet);
    }

    if (Xraw.length === 0) {
      return Response.json(
        { error: `No training rows have the new features (vol_ratio, rsi_14, days_since_high). Yahoo data: ${qqq.length} bars, feature rows computed: ${featureRows.length}` },
        { status: 422 },
      );
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
    const olsPredictionStd = stdev(yMagPred);

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
      olsPredictionStd: Math.round(olsPredictionStd * 10000) / 10000,
      directionAccuracy: Math.round(dirAcc * 10000) / 10000,
      magnitudeMae: Math.round(magnitudeMae * 1000) / 1000,
      magnitudePearson: Math.round(magnitudePearson * 10000) / 10000,
    };

    await saveModelCoefficients(coef);

    // ── repredict history ──────────────────────────────────────────────────────

    console.log("[retrain] starting history repredict");
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: historyRows } = await sb
      .from("daily_features")
      .select("*")
      .not("qqq_1d_ret", "is", null)
      .not("qqq_close", "is", null)
      .order("date", { ascending: false })
      .limit(2000);

    if (historyRows && historyRows.length > 0) {
      // Build all updates first, then send in batches via upsert (much faster
      // than sequential per-row updates).
      const updates: {
        date: string;
        predicted_direction: string;
        predicted_prob_up: number;
        predicted_1d_ret: number;
        updated_at: string;
      }[] = [];
      const now = new Date().toISOString();
      const means = FEATURE_NAMES.map((n) => coef.featureMeans[n]);
      const stdevs = FEATURE_NAMES.map((n) => coef.featureStdevs[n]);

      for (const row of historyRows) {
        const feat = {
          date: row.date,
          qqqClose: row.qqq_close,
          qqq1dRet: row.qqq_1d_ret,
          qqq3dRet: row.qqq_3d_ret,
          qqq5dRet: row.qqq_5d_ret,
          vixLevel: row.vix_level,
          vix1dChange: row.vix_1d_change,
          vixTerm: row.vix_term,
          pctAbove200ma: row.pct_above_200ma,
          realizedVol20d: row.realized_vol_20d,
          tnxMom20d: row.tnx_mom_20d,
          volRatio: row.vol_ratio,
          rsi14: row.rsi_14,
          daysSinceHigh: row.days_since_high,
        };

        if (
          feat.qqq1dRet == null ||
          feat.qqq3dRet == null ||
          feat.qqq5dRet == null ||
          feat.vixLevel == null ||
          feat.vix1dChange == null ||
          feat.vixTerm == null ||
          feat.pctAbove200ma == null ||
          feat.realizedVol20d == null ||
          feat.tnxMom20d == null ||
          feat.volRatio == null ||
          feat.rsi14 == null ||
          feat.daysSinceHigh == null
        ) {
          continue;
        }

        const rawVec = featuresToArray(feat as import("@/lib/features").RawFeatures);
        const normVec = normalize(rawVec, means, stdevs);

        const probUp = Math.round(predictProb(normVec, coef.logisticWeights) * 10000) / 10000;
        const rawOls = predictMagnitude(normVec, coef.olsWeights);
        const predictedRet = Math.round(
          volAdjustedPrediction(
            rawOls,
            feat.realizedVol20d,
            coef.featureMeans["realizedVol20d"],
            coef.magnitudePearson,
          ) * 10000,
        ) / 10000;

        const direction = toDir(predictedRet, feat.qqq5dRet);

        updates.push({
          date: row.date as string,
          predicted_direction: direction,
          predicted_prob_up: probUp,
          predicted_1d_ret: predictedRet,
          updated_at: now,
        });
      }

      // Send batched upserts (200 per call)
      const BATCH = 200;
      for (let i = 0; i < updates.length; i += BATCH) {
        await sb.from("daily_features").upsert(updates.slice(i, i + BATCH), { onConflict: "date" });
      }
      console.log(`[retrain] repredicted ${updates.length} rows in ${Math.ceil(updates.length / BATCH)} batches`);
    }

    return Response.json({
      ok: true,
      trainN: coef.trainN,
      featureRowsUpserted: featureRows.length,
      backfilledReturns: backfilled,
      repredictedHistoryRows: historyRows?.length ?? 0,
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

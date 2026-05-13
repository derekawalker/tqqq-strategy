/**
 * Backfill predictions for all historical daily_features rows that have
 * features but no predicted_direction yet. Uses the currently stored model.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-predictions.ts
 */

import { createClient } from "@supabase/supabase-js";
import { FEATURE_NAMES, normalize, predictProb, predictMagnitude, volAdjustedPrediction } from "@/lib/mlModels";
import { featuresToArray } from "@/lib/features";
import { loadModelCoefficients } from "@/lib/predictionHistory";
import type { RawFeatures } from "@/lib/features";

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const model = await loadModelCoefficients();
  if (!model) {
    console.error("No model found in model_coefficients. Click Retrain in the app first.");
    process.exit(1);
  }
  console.log(`Model fitted ${model.fittedAt.slice(0, 10)}, trained on ${model.trainN} rows.`);

  // Load all rows that have features but no prediction yet
  const { data, error } = await sb
    .from("daily_features")
    .select("date, qqq_close, qqq_1d_ret, qqq_3d_ret, qqq_5d_ret, vix_level, vix_1d_change, vix_term, pct_above_200ma, realized_vol_20d, tnx_mom_20d, skew_level")
    .not("qqq_1d_ret", "is", null)
    .order("date", { ascending: true })
    .limit(10000);

  if (error) { console.error(error.message); process.exit(1); }
  if (!data || data.length === 0) {
    console.log("No rows to backfill — all rows already have predictions.");
    return;
  }

  console.log(`Backfilling predictions for ${data.length} rows...`);

  const skewFallback = model.featureMeans["skewLevel"] ?? 135;
  const means = FEATURE_NAMES.map((n) => model.featureMeans[n]);
  const stdevs = FEATURE_NAMES.map((n) => model.featureStdevs[n]);

  const RET_UP_THRESH = 0.5;
  const RET_DOWN_THRESH = -0.5;

  const BATCH = 100;
  let updated = 0;

  for (let i = 0; i < data.length; i += BATCH) {
    const batch = data.slice(i, i + BATCH);
    const updates = batch.map((row) => {
      const feat: RawFeatures = {
        date: row.date as string,
        qqqClose: row.qqq_close as number,
        qqq1dRet: row.qqq_1d_ret as number,
        qqq3dRet: row.qqq_3d_ret as number,
        qqq5dRet: row.qqq_5d_ret as number,
        vixLevel: row.vix_level as number,
        vix1dChange: row.vix_1d_change as number,
        vixTerm: row.vix_term as number,
        pctAbove200ma: row.pct_above_200ma as number,
        realizedVol20d: row.realized_vol_20d as number,
        tnxMom20d: row.tnx_mom_20d as number,
        skewLevel: row.skew_level as number | null,
      };

      const rawVec = featuresToArray(feat, skewFallback);
      const normVec = normalize(rawVec, means, stdevs);
      const probUp = Math.round(predictProb(normVec, model.logisticWeights) * 10000) / 10000;
      const rawOls = predictMagnitude(normVec, model.olsWeights);
      const predicted1dRet = Math.round(
        volAdjustedPrediction(
          rawOls,
          feat.realizedVol20d,
          model.featureMeans["realizedVol20d"],
          model.magnitudePearson,
        ) * 10000,
      ) / 10000;
      const direction = predicted1dRet > RET_UP_THRESH ? "up" : predicted1dRet < RET_DOWN_THRESH ? "down" : "flat";

      return {
        date: feat.date,
        qqq_close: feat.qqqClose,
        predicted_direction: direction,
        predicted_prob_up: probUp,
        predicted_1d_ret: predicted1dRet,
        updated_at: new Date().toISOString(),
      };
    });

    const { error: upsertErr } = await sb
      .from("daily_features")
      .upsert(updates, { onConflict: "date" });

    if (upsertErr) {
      console.error(`Batch ${Math.floor(i / BATCH) + 1} failed:`, upsertErr.message);
    } else {
      updated += batch.length;
      process.stdout.write(`\r  ${updated}/${data.length} rows updated`);
    }
  }

  console.log(`\nDone. ${updated} rows backfilled.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Supabase interaction for the 1-day prediction model.
//
// Required tables (run once in the Supabase SQL editor):
//
//   create table public.daily_features (
//     date date primary key,
//     qqq_close numeric not null,
//     qqq_1d_ret numeric,
//     qqq_3d_ret numeric,
//     qqq_5d_ret numeric,
//     vix_level numeric,
//     vix_1d_change numeric,
//     vix_term numeric,
//     pct_above_200ma numeric,
//     realized_vol_20d numeric,
//     tnx_mom_20d numeric,
//     skew_level numeric,
//     -- Added later: vol_ratio, rsi_14, days_since_high, hy_ief_mom_20d, move_level
//     -- (run as a follow-up ALTER TABLE if upgrading an existing instance)
//     vol_ratio numeric,
//     rsi_14 numeric,
//     days_since_high numeric,
//     hy_ief_mom_20d numeric,
//     move_level numeric,
//     predicted_direction text,
//     predicted_prob_up numeric,
//     predicted_1d_ret numeric,
//     realized_1d_ret numeric,
//     created_at timestamptz default now(),
//     updated_at timestamptz default now()
//   );
//
//   create table public.model_coefficients (
//     id int primary key default 1,
//     fitted_at timestamptz not null,
//     train_n int not null,
//     feature_names jsonb not null,
//     feature_means jsonb not null,
//     feature_stdevs jsonb not null,
//     logistic_weights jsonb not null,
//     ols_weights jsonb not null,
//     direction_accuracy numeric,
//     magnitude_mae numeric,
//     magnitude_pearson numeric,
//     updated_at timestamptz default now()
//   );

import { createClient } from "@supabase/supabase-js";
import type { ModelCoefficients, FeatureName } from "./mlModels";
import type { RawFeatures } from "./features";

function supabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── model coefficients ────────────────────────────────────────────────────────

export async function loadModelCoefficients(): Promise<ModelCoefficients | null> {
  const { data } = await supabase()
    .from("model_coefficients")
    .select("*")
    .eq("id", 1)
    .single();

  if (!data) return null;

  return {
    fittedAt: data.fitted_at as string,
    trainN: data.train_n as number,
    featureNames: data.feature_names as FeatureName[],
    featureMeans: data.feature_means as Record<FeatureName, number>,
    featureStdevs: data.feature_stdevs as Record<FeatureName, number>,
    logisticWeights: data.logistic_weights as number[],
    olsWeights: data.ols_weights as number[],
    olsPredictionStd: (data.ols_prediction_std as number) ?? 0.25,
    directionAccuracy: data.direction_accuracy as number,
    magnitudeMae: data.magnitude_mae as number,
    magnitudePearson: data.magnitude_pearson as number,
  };
}

export async function saveModelCoefficients(coef: ModelCoefficients): Promise<void> {
  await supabase()
    .from("model_coefficients")
    .upsert({
      id: 1,
      fitted_at: coef.fittedAt,
      train_n: coef.trainN,
      feature_names: coef.featureNames,
      feature_means: coef.featureMeans,
      feature_stdevs: coef.featureStdevs,
      logistic_weights: coef.logisticWeights,
      ols_weights: coef.olsWeights,
      ols_prediction_std: coef.olsPredictionStd,
      direction_accuracy: coef.directionAccuracy,
      magnitude_mae: coef.magnitudeMae,
      magnitude_pearson: coef.magnitudePearson,
      updated_at: new Date().toISOString(),
    });
}

// ── daily features ────────────────────────────────────────────────────────────

export interface DailyRow {
  date: string;
  qqqClose: number;
  qqq1dRet: number | null;
  qqq3dRet: number | null;
  qqq5dRet: number | null;
  vixLevel: number | null;
  vix1dChange: number | null;
  vixTerm: number | null;
  pctAbove200ma: number | null;
  realizedVol20d: number | null;
  tnxMom20d: number | null;
  volRatio: number | null;
  rsi14: number | null;
  daysSinceHigh: number | null;
  hyIefMom20d: number | null;
  moveLevel: number | null;
  predictedDirection: string | null;
  predictedProbUp: number | null;
  predicted1dRet: number | null;
  realized1dRet: number | null;
}

export async function upsertDailyFeatures(rows: RawFeatures[]): Promise<void> {
  if (rows.length === 0) return;
  const records = rows.map((r) => ({
    date: r.date,
    qqq_close: r.qqqClose,
    qqq_1d_ret: r.qqq1dRet,
    qqq_3d_ret: r.qqq3dRet,
    qqq_5d_ret: r.qqq5dRet,
    vix_level: r.vixLevel,
    vix_1d_change: r.vix1dChange,
    vix_term: r.vixTerm,
    pct_above_200ma: r.pctAbove200ma,
    realized_vol_20d: r.realizedVol20d,
    tnx_mom_20d: r.tnxMom20d,
    vol_ratio: r.volRatio,
    rsi_14: r.rsi14,
    days_since_high: r.daysSinceHigh,
    hy_ief_mom_20d: r.hyIefMom20d,
    move_level: r.moveLevel,
    updated_at: new Date().toISOString(),
  }));
  await supabase()
    .from("daily_features")
    .upsert(records, { onConflict: "date" });
}

export async function upsertPrediction(
  date: string,
  direction: string,
  probUp: number,
  predicted1dRet: number,
): Promise<void> {
  await supabase()
    .from("daily_features")
    .upsert(
      {
        date,
        qqq_close: 0,           // will be overwritten if features already exist
        predicted_direction: direction,
        predicted_prob_up: probUp,
        predicted_1d_ret: predicted1dRet,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "date" },
    );
}

// Backfill realized_1d_ret for any rows in daily_features where it's null
// but the next trading day's close is now available in the provided qqqByDate map.
export async function backfillRealizedReturns(
  qqqByDate: Map<string, number>,
): Promise<number> {
  const { data: pending } = await supabase()
    .from("daily_features")
    .select("date, qqq_close")
    .is("realized_1d_ret", null)
    .not("qqq_close", "is", null)
    .order("date", { ascending: true })
    .limit(60);

  if (!pending || pending.length === 0) return 0;

  const tradingDays = [...qqqByDate.keys()].sort();
  const dayIndex = new Map(tradingDays.map((d, i) => [d, i]));

  let updated = 0;
  for (const row of pending) {
    const date = row.date as string;
    const startClose = row.qqq_close as number;
    const idx = dayIndex.get(date);
    if (idx == null) continue;
    const nextDate = tradingDays[idx + 1];
    if (!nextDate) continue;
    const endClose = qqqByDate.get(nextDate);
    if (!endClose) continue;

    const realized = ((endClose - startClose) / startClose) * 100;
    await supabase()
      .from("daily_features")
      .update({
        realized_1d_ret: Math.round(realized * 10000) / 10000,
        updated_at: new Date().toISOString(),
      })
      .eq("date", date);
    updated++;
  }
  return updated;
}

// Load all training rows: features complete + realized return available.
export async function loadTrainingRows(): Promise<DailyRow[]> {
  const { data } = await supabase()
    .from("daily_features")
    .select(
      "date, qqq_close, qqq_1d_ret, qqq_3d_ret, qqq_5d_ret, vix_level, vix_1d_change, vix_term, pct_above_200ma, realized_vol_20d, tnx_mom_20d, vol_ratio, rsi_14, days_since_high, hy_ief_mom_20d, move_level, predicted_direction, predicted_prob_up, predicted_1d_ret, realized_1d_ret",
    )
    .not("qqq_1d_ret", "is", null)
    .not("realized_1d_ret", "is", null)
    .order("date", { ascending: true });

  if (!data) return [];
  return data.map(mapRow);
}

// Load recent prediction history for accuracy display (most recent first).
export async function loadRecentPredictions(limit = 120): Promise<DailyRow[]> {
  const { data } = await supabase()
    .from("daily_features")
    .select(
      "date, qqq_close, qqq_1d_ret, qqq_3d_ret, qqq_5d_ret, vix_level, vix_1d_change, vix_term, pct_above_200ma, realized_vol_20d, tnx_mom_20d, vol_ratio, rsi_14, days_since_high, hy_ief_mom_20d, move_level, predicted_direction, predicted_prob_up, predicted_1d_ret, realized_1d_ret",
    )
    .not("predicted_direction", "is", null)
    .order("date", { ascending: false })
    .limit(limit);

  if (!data) return [];
  return data.map(mapRow);
}

function mapRow(r: Record<string, unknown>): DailyRow {
  return {
    date: r.date as string,
    qqqClose: r.qqq_close as number,
    qqq1dRet: r.qqq_1d_ret as number | null,
    qqq3dRet: r.qqq_3d_ret as number | null,
    qqq5dRet: r.qqq_5d_ret as number | null,
    vixLevel: r.vix_level as number | null,
    vix1dChange: r.vix_1d_change as number | null,
    vixTerm: r.vix_term as number | null,
    pctAbove200ma: r.pct_above_200ma as number | null,
    realizedVol20d: r.realized_vol_20d as number | null,
    tnxMom20d: r.tnx_mom_20d as number | null,
    volRatio: r.vol_ratio as number | null,
    rsi14: r.rsi_14 as number | null,
    daysSinceHigh: r.days_since_high as number | null,
    hyIefMom20d: r.hy_ief_mom_20d as number | null,
    moveLevel: r.move_level as number | null,
    predictedDirection: r.predicted_direction as string | null,
    predictedProbUp: r.predicted_prob_up as number | null,
    predicted1dRet: r.predicted_1d_ret as number | null,
    realized1dRet: r.realized_1d_ret as number | null,
  };
}

// ── accuracy stats ─────────────────────────────────────────────────────────────

export interface PredictionAccuracy {
  totalCalls: number;
  realizedCalls: number;
  directionAccuracy: number | null;  // fraction correct (up/down/flat)
  magnitudeMae: number | null;
  magnitudePearson: number | null;
  magnitudeBias: number | null;
  byDirection: Record<string, { n: number; hitRate: number; avgRealized: number }>;
}

export function computePredictionAccuracy(rows: DailyRow[]): PredictionAccuracy {
  const withPrediction = rows.filter((r) => r.predictedDirection != null);
  const realized = withPrediction.filter((r) => r.realized1dRet != null);

  const acc: PredictionAccuracy = {
    totalCalls: withPrediction.length,
    realizedCalls: realized.length,
    directionAccuracy: null,
    magnitudeMae: null,
    magnitudePearson: null,
    magnitudeBias: null,
    byDirection: {},
  };

  if (realized.length === 0) return acc;

  // Direction accuracy: predicted direction matches actual direction
  const UP_THRESH = 0.5;
  const DOWN_THRESH = -0.5;
  const actualDir = (ret: number) =>
    ret > UP_THRESH ? "up" : ret < DOWN_THRESH ? "down" : "flat";

  const correct = realized.filter(
    (r) => r.predictedDirection === actualDir(r.realized1dRet!),
  ).length;
  acc.directionAccuracy = correct / realized.length;

  // Per-direction breakdown
  for (const dir of ["up", "down", "flat"]) {
    const dirRows = realized.filter((r) => r.predictedDirection === dir);
    if (dirRows.length === 0) continue;
    const hits = dirRows.filter((r) => r.predictedDirection === actualDir(r.realized1dRet!)).length;
    const avgRealized =
      dirRows.reduce((s, r) => s + r.realized1dRet!, 0) / dirRows.length;
    acc.byDirection[dir] = {
      n: dirRows.length,
      hitRate: hits / dirRows.length,
      avgRealized: Math.round(avgRealized * 1000) / 1000,
    };
  }

  // Magnitude accuracy
  const magRows = realized.filter((r) => r.predicted1dRet != null);
  if (magRows.length > 0) {
    const errs = magRows.map((r) => r.predicted1dRet! - r.realized1dRet!);
    acc.magnitudeMae =
      Math.round((errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length) * 1000) / 1000;
    acc.magnitudeBias =
      Math.round((errs.reduce((s, e) => s + e, 0) / errs.length) * 1000) / 1000;

    if (magRows.length >= 3) {
      const xs = magRows.map((r) => r.predicted1dRet!);
      const ys = magRows.map((r) => r.realized1dRet!);
      const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
      const my = ys.reduce((s, v) => s + v, 0) / ys.length;
      let num = 0, dx2 = 0, dy2 = 0;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my;
        num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
      }
      const denom = Math.sqrt(dx2 * dy2);
      acc.magnitudePearson =
        denom > 0 ? Math.round((num / denom) * 10000) / 10000 : null;
    }
  }

  return acc;
}
